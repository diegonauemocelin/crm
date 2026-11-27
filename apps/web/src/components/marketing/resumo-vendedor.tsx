import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, MessageCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MultiSelect } from '@/components/multi-select'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Frequency = 'SEMANAL' | 'QUINZENAL' | 'MENSAL'
interface WeeklyConfig {
  enabled: boolean
  frequency: Frequency
  sendDay: number
  toSellers: boolean
  time: string
  numberId: string | null
  allSellers: boolean
  sellerIds: string[]
  sections: string[]
  managerPhones: string[]
  gapMin: number
  gapMax: number
}
interface WeeklyView {
  config: WeeklyConfig
  sections: { key: string; label: string }[]
  cycle: { key: string; label: string }
  numbers: { id: string; name: string; status: string }[]
  sellers: { id: string; name: string; hasPhone: boolean; active: boolean }[]
  lastRun: { cycle: string; at: string | null; sellers: Record<string, string> } | null
  manager: { message: string; status: Record<string, string | null> }
  reports: { sellerId: string; seller: string; hasPhone: boolean; forwarded: number; sales: number; conversion: number | null; message: string; status: string | null; automatic: boolean }[]
}

const FIRST = '__primeiro__'
const GESTOR = '__gestor__'
/** +5547999998888 -> (47) 99999-8888 */
const readable = (ph: string) => {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(ph)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : ph
}
const STATUS: Record<string, string> = { ENVIADA: 'enviado', SEM_TELEFONE: 'sem telefone no cadastro' }
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const FREQ_LABEL: Record<Frequency, string> = { SEMANAL: 'Semanal', QUINZENAL: 'Quinzenal', MENSAL: 'Mensal' }
/** Dia do envio padrão ao trocar a frequência. */
const DEFAULT_DAY: Record<Frequency, number> = { SEMANAL: 5, QUINZENAL: 1, MENSAL: 1 }
/** Quando sai e o que cobre, pela frequência e pelo dia escolhido. */
const freqInfo = (f: Frequency, day: number) => {
  if (f === 'SEMANAL') {
    const w = WEEKDAYS[day] ?? 'sexta'
    const before = WEEKDAYS[(day + 6) % 7]
    return { label: 'Semanal', badge: w, sends: `toda ${w}`.replace('toda sábado', 'todo sábado').replace('toda domingo', 'todo domingo'), cycle: `os 7 dias antes do envio (de ${w} a ${before})` }
  }
  if (f === 'QUINZENAL') return { label: 'Quinzenal', badge: 'dias 1º e 16', sends: 'nos dias 1º e 16', cycle: 'de 1 a 15 (enviado no dia 16) e de 16 ao fim do mês (enviado no dia 1º)' }
  const d = day === 1 ? '1º' : String(day)
  return { label: 'Mensal', badge: `dia ${d}`, sends: `todo dia ${d}`, cycle: `do mês anterior inteiro (enviado no dia ${d})` }
}
const statusText = (s: string) => STATUS[s] ?? (s.startsWith('ERRO') ? s.replace(/^ERRO:\s*/, 'erro: ') : s.toLowerCase())

/**
 * Resumo do vendedor (semanal, quinzenal ou mensal): enviado para o WhatsApp do cadastro de cada vendedor que recebeu
 * clientes da pré-venda repassados e para os números informados. Fica em Marketing › Relatórios e alertas.
 */
export function ResumoVendedorCard({ slot = 1 }: { slot?: 1 | 2 }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const canEdit = can('mi_relatorios', 'edit') || can('cadastros', 'edit')
  const url = `/relatorios/resumo-vendedor${slot === 2 ? '?envio=2' : ''}`
  const id = `rv${slot}`
  const q = useQuery({ queryKey: ['resumo-vendedor', slot], queryFn: () => api.get<WeeklyView>(url) })
  const [d, setD] = useState<WeeklyConfig | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [managers, setManagers] = useState<string | null>(null)
  useEffect(() => {
    if (q.data && !d) {
      setD(q.data.config)
      setManagers(q.data.config.managerPhones.map(readable).join('\n'))
    }
  }, [q.data, d])
  const save = useMutation({
    mutationFn: (c: WeeklyConfig) => api.put<WeeklyConfig>(url, { ...c }),
    onSuccess: (c) => {
      toast.success(c.enabled ? `Resumo do vendedor ligado: sai ${freqInfo(c.frequency, c.sendDay).sends}, a partir das ${c.time}.` : 'Resumo do vendedor salvo (desligado).')
      void qc.invalidateQueries({ queryKey: ['resumo-vendedor', slot] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (q.isLoading || (q.data && !d)) return <TableSkeleton rows={3} />
  if (q.error || !q.data || !d) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const v = q.data
  const sellers = v.sellers.filter((s) => s.active || d.sellerIds.includes(s.id))
  const noPhone = sellers.filter((s) => !s.hasPhone && (d.allSellers || d.sellerIds.includes(s.id)))
  const managerList = (managers ?? '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(d.time) && (d.allSellers || d.sellerIds.length > 0) && d.sections.length > 0 && d.gapMin >= 1 && d.gapMax <= 60 && d.gapMin <= d.gapMax && (d.toSellers || managerList.length > 0)
  const freq = freqInfo(d.frequency, d.sendDay)
  const savedFreq = freqInfo(v.config.frequency, v.config.sendDay)
  const current = { ...d, managerPhones: managerList }
  const isManager = pick === GESTOR
  const shown = isManager ? undefined : (v.reports.find((x) => x.sellerId === pick) ?? v.reports[0])
  // A prévia segue o que está salvo: mudou as informações, salve para ver a mensagem nova.
  const pendingSave = JSON.stringify({ ...d, managerPhones: undefined }) !== JSON.stringify({ ...v.config, managerPhones: undefined }) || managerList.join() !== v.config.managerPhones.map(readable).join()
  const toggle = (k: string, on: boolean) => setD({ ...d, sections: on ? v.sections.map((s) => s.key).filter((x) => x === k || d.sections.includes(x)) : d.sections.filter((x) => x !== k) })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <MessageCircleIcon className="size-4" /> {slot === 2 ? 'Resumo do vendedor: 2º envio (WhatsApp)' : 'Resumo do vendedor (WhatsApp)'}
          {v.config.enabled ? <Badge>Ligado · {savedFreq.label.toLowerCase()}, {savedFreq.badge}, {v.config.time}</Badge> : <Badge variant="outline">Desligado</Badge>}
        </CardTitle>
        <CardDescription>
          {slot === 2 && 'Outro envio do mesmo resumo, com frequência, dia, horário e informações próprias (ex.: o mensal, com menos informações). '}
          Cada vendedor que recebeu clientes da pré-venda repassados no período recebe no WhatsApp do cadastro dele o resultado, com as informações escolhidas abaixo, e os números informados recebem o resumo da equipe. Quem não teve repasse no período não recebe.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            Enviar o resumo
            <Switch checked={d.enabled} onCheckedChange={(enabled) => setD({ ...d, enabled })} disabled={!canEdit} />
          </label>
          <div className="space-y-2">
            <Label htmlFor={`${id}-freq`}>Frequência</Label>
            <Select value={d.frequency} onValueChange={(x) => setD({ ...d, frequency: x as Frequency, sendDay: DEFAULT_DAY[x as Frequency] })} disabled={!canEdit}>
              <SelectTrigger id={`${id}-freq`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FREQ_LABEL) as Frequency[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {FREQ_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Período {freq.cycle}.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-day`}>Dia do envio</Label>
              {d.frequency === 'QUINZENAL' ? (
                <p className="flex h-9 items-center text-sm text-muted-foreground">Dias 1º e 16</p>
              ) : (
                <Select value={String(d.sendDay)} onValueChange={(x) => setD({ ...d, sendDay: Number(x) })} disabled={!canEdit}>
                  <SelectTrigger id={`${id}-day`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {d.frequency === 'SEMANAL'
                      ? WEEKDAYS.map((w, i) => (
                          <SelectItem key={w} value={String(i)}>
                            {w[0]!.toUpperCase() + w.slice(1)}
                          </SelectItem>
                        ))
                      : Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            Dia {n === 1 ? '1º' : n}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-time`}>A partir de (Brasília)</Label>
              <Input id={`${id}-time`} type="time" className="w-32" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} disabled={!canEdit} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${id}-number`}>Número que envia</Label>
              <Select value={d.numberId ?? FIRST} onValueChange={(x) => setD({ ...d, numberId: x === FIRST ? null : x })} disabled={!canEdit}>
                <SelectTrigger id={`${id}-number`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FIRST}>O primeiro número conectado</SelectItem>
                  {v.numbers.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.name}
                      {n.status !== 'CONECTADO' && ' (desconectado)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-start justify-between gap-3 text-sm">
            <span>
              Enviar para cada vendedor
              <span className="block text-xs text-muted-foreground">Desligado: só os números informados abaixo recebem (o resumo da equipe).</span>
            </span>
            <Switch checked={d.toSellers} onCheckedChange={(toSellers) => setD({ ...d, toSellers })} disabled={!canEdit} />
          </label>
          <div className="space-y-2">
            <Label>{d.toSellers ? 'Para quem' : 'Vendedores no resumo'}</Label>
            <Select value={d.allSellers ? 'todos' : 'escolhidos'} onValueChange={(x) => setD({ ...d, allSellers: x === 'todos' })} disabled={!canEdit}>
              <SelectTrigger className="w-full" aria-label="Para quem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os vendedores com repasse no ciclo</SelectItem>
                <SelectItem value="escolhidos">Só os vendedores escolhidos</SelectItem>
              </SelectContent>
            </Select>
            {!d.allSellers && <MultiSelect id={`${id}-sellers`} items={sellers} value={d.sellerIds} onChange={(sellerIds) => setD({ ...d, sellerIds })} placeholder="Escolha os vendedores" disabled={!canEdit} />}
            {d.toSellers && noPhone.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Sem WhatsApp no cadastro (não recebem): {noPhone.map((s) => s.name).join(', ')}. Preencha o telefone em Configurações › Vendedores.</p>}
          </div>
          <div className="space-y-2">
            <Label>Intervalo entre as mensagens</Label>
            <div className="flex items-center gap-2 text-sm">
              de
              <Input type="number" min={1} max={60} className="w-20" aria-label="Intervalo mínimo (minutos)" value={d.gapMin} onChange={(e) => setD({ ...d, gapMin: Number(e.target.value) })} disabled={!canEdit} />
              a
              <Input type="number" min={1} max={60} className="w-20" aria-label="Intervalo máximo (minutos)" value={d.gapMax} onChange={(e) => setD({ ...d, gapMax: Number(e.target.value) })} disabled={!canEdit} />
              minutos
            </div>
            <p className="text-xs text-muted-foreground">Uma mensagem por vez, com uma espera sorteada nesse intervalo antes da próxima, para o WhatsApp não tratar como spam. Com 10 vendedores e o padrão (2 a 10 min), o envio leva cerca de 1 hora.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-managers`}>{d.toSellers ? 'Também para estes números (opcional)' : 'Números que recebem'}</Label>
            <Textarea id={`${id}-managers`} rows={2} placeholder="WhatsApp, um por linha. Ex.: (47) 99999-8888" value={managers ?? ''} onChange={(e) => setManagers(e.target.value)} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">Cada número recebe uma mensagem só, com o total da equipe e uma linha por vendedor (ex.: gestor, diretoria).{d.toSellers ? ' Em branco, vai só para os vendedores.' : ''}</p>
            {!d.toSellers && !managerList.length && <p className="text-xs text-destructive">Informe ao menos um número.</p>}
          </div>
          <div className="space-y-2">
            <Label>O que vai no resumo</Label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {v.sections.map((s) => (
                <label key={s.key} className="flex items-start gap-2 text-sm">
                  <Checkbox checked={d.sections.includes(s.key)} onCheckedChange={(on) => toggle(s.key, on === true)} disabled={!canEdit} className="mt-0.5" /> {s.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Prévia: ciclo {v.cycle.label}</p>
          {!v.reports.length && <p className="text-sm text-muted-foreground">Nenhum cliente da pré-venda repassado a vendedores neste ciclo.</p>}
          {v.reports.length > 0 && (
            <>
              <Select value={isManager ? GESTOR : (shown?.sellerId ?? '')} onValueChange={setPick}>
                <SelectTrigger className="w-full" aria-label="Vendedor da prévia">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GESTOR}>Resumo da equipe{v.config.managerPhones.length ? ` (${v.config.managerPhones.length} número(s))` : ' (nenhum número informado)'}</SelectItem>
                  {v.reports.map((x) => (
                    <SelectItem key={x.sellerId} value={x.sellerId}>
                      {x.seller}: {x.forwarded} repassado(s), {x.sales} venda(s){x.status ? ` · ${statusText(x.status)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(isManager || shown) && <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{isManager ? v.manager.message : shown!.message}</pre>}
              {isManager && !v.config.managerPhones.length && <p className="text-xs text-muted-foreground">Informe os números e salve para eles receberem.</p>}
              {shown && !shown.hasPhone && <p className="text-xs text-amber-700 dark:text-amber-400">{shown.seller} não tem WhatsApp no cadastro: não recebe.</p>}
              {pendingSave && <p className="text-xs text-muted-foreground">Salve para a prévia mostrar as mudanças.</p>}
            </>
          )}
          {v.lastRun && (
            <p className="pt-2 text-xs text-muted-foreground">
              Último envio (ciclo de {v.lastRun.cycle.slice(8, 10)}/{v.lastRun.cycle.slice(5, 7)}){v.lastRun.at ? `, ${formatDateTime(v.lastRun.at)}` : ''}:{' '}
              {Object.values(v.lastRun.sellers).filter((s) => s === 'ENVIADA').length} enviado(s)
              {Object.values(v.lastRun.sellers).some((s) => s !== 'ENVIADA') && `, ${Object.values(v.lastRun.sellers).filter((s) => s !== 'ENVIADA').length} sem envio (telefone ou erro)`}.
            </p>
          )}
        </div>
      </CardContent>
      {canEdit && (
        <CardFooter>
          <Button onClick={() => save.mutate(current)} disabled={save.isPending || !valid}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
