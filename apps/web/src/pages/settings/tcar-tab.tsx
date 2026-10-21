import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, CopyIcon, KeyRoundIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from '@/lib/api'
import { int } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { FormError } from '../auth/auth-layout'

interface TcarConfig {
  enabled: boolean
  hasKey: boolean
  companyId: number | null
  branchId: number | null
  branchIds: number[]
  usedInField: string
  fullEveryHours: number
  incrementalMinutes: number
  urls: { ping: string; report: string }
  state: {
    lastPingAt: string | null
    instance: { hostname: string | null; ip: string | null; version: string | null } | null
    lastFullAt: string | null
    lastIncrementalAt: string | null
    fullRunning: boolean
    lastError: string | null
    lastErrorAt: string | null
    products: number
    pendingActions: number
  }
}

const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copiado.`), () => toast.error('Não foi possível copiar.'))

/** Configurações → Tcar (ERP): PingAlive (o servidor da Tcar chama o CRM) e a cópia dos produtos. */
export function TcarTab() {
  const q = useQuery({ queryKey: ['tcar-config'], queryFn: () => api.get<TcarConfig>('/tcar/config'), refetchInterval: 15_000 })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <TcarEditor key={`${q.data.hasKey}-${q.data.enabled}`} initial={q.data} />
      <TcarStatus c={q.data} />
    </div>
  )
}

function TcarEditor({ initial }: { initial: TcarConfig }) {
  const { can } = useAuth()
  const confirm = useConfirm()
  const canEdit = can('configuracoes', 'edit')
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [branches, setBranches] = useState(initial.branchIds.join(', '))
  const [usedIn, setUsedIn] = useState(initial.usedInField)
  const [fullHours, setFullHours] = useState(initial.fullEveryHours)
  const [incMinutes, setIncMinutes] = useState(initial.incrementalMinutes)
  const [key, setKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api.put<TcarConfig>('/tcar/config', {
        enabled,
        branchIds: branches.split(/[,;\s]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0),
        usedInField: usedIn.trim(),
        fullEveryHours: fullHours,
        incrementalMinutes: incMinutes,
      }),
    onSuccess: (v) => {
      qc.setQueryData(['tcar-config'], v)
      toast.success('Integração com a Tcar salva.')
    },
    onError: (err) => setError(errorMessage(err)),
  })
  const newKey = useMutation({
    mutationFn: () => api.post<{ key: string }>('/tcar/config/chave'),
    onSuccess: (r) => {
      setKey(r.key)
      void qc.invalidateQueries({ queryKey: ['tcar-config'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const ini = `[PingAlive]
Enabled=1

[PingAliveServer_1]
Enabled=1
ServerURL=${initial.urls.ping}
ReportURL=${initial.urls.report}
IntervalSeconds=10
APIKey=${key ?? '<chave gerada no CRM>'}`
  return (
    <Card>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          setError(null)
          save.mutate()
        }}
      >
        <CardHeader>
          <CardTitle>Tcar (ERP): consulta de produtos</CardTitle>
          <CardDescription>
            Pelo PingAlive: o servidor da Tcar, na rede da empresa, chama o CRM de tempos em tempos e executa só consultas de produtos. Não precisa abrir porta nem expor a Tcar na internet. A senha do usuário Tcar fica no servidor da Tcar, nunca no CRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-4 space-y-4">
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="space-y-2 rounded-md border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <KeyRoundIcon className="size-4" /> 1. Chave da integração
              </p>
              {key ? (
                <div className="space-y-2">
                  <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" /> Copie agora: a chave não aparece de novo. Ela vai só no arquivo da Tcar (não mande por WhatsApp ou e-mail).
                  </p>
                  <div className="flex gap-2">
                    <Input readOnly value={key} className="font-mono text-xs" aria-label="Chave da integração" />
                    <Button type="button" size="sm" variant="outline" onClick={() => copy(key, 'Chave')}>
                      <CopyIcon /> Copiar
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{initial.hasKey ? 'Chave já gerada (guardada só como resumo). Gerar outra invalida a anterior.' : 'Gere a chave e coloque no arquivo de configuração da Tcar.'}</p>
              )}
              <Button
                type="button"
                size="sm"
                variant={initial.hasKey ? 'outline' : 'default'}
                onClick={async () => {
                  if (
                    !initial.hasKey ||
                    (await confirm({
                      title: 'Gerar nova chave da Tcar?',
                      description: 'A chave atual para de funcionar na hora e a integração com a Tcar fica parada até a nova chave ser colocada no arquivo tcarwebserver.ini do servidor da Tcar (APIKey).',
                      confirmLabel: 'Gerar nova chave',
                    }))
                  )
                    newKey.mutate()
                }}
                disabled={newKey.isPending}
              >
                {newKey.isPending && <Loader2Icon className="animate-spin" />} {initial.hasKey ? 'Gerar nova chave' : 'Gerar chave'}
              </Button>
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">2. No servidor da Tcar (TI ou suporte Tcar)</p>
              <p className="text-xs text-muted-foreground">
                No arquivo <code>config/tcarwebserver.ini</code>, preencher a seção <code>[ServerIdentity]</code> (CompanyID, BranchID, APIKey, Version, ActionUserName e ActionPassword de um usuário Tcar só de consulta) e incluir:
              </p>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs leading-relaxed">{ini}</pre>
              <Button type="button" size="sm" variant="outline" onClick={() => copy(ini, 'Trecho')}>
                <CopyIcon /> Copiar trecho
              </Button>
            </div>
            <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
              <span>
                3. Ligar a integração
                <span className="block text-xs text-muted-foreground">Ligada, o CRM copia os produtos no primeiro contato e depois mantém atualizado.</span>
              </span>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tc-branches">Filiais com estoque na consulta</Label>
                <Input id="tc-branches" placeholder="Ex.: 1, 2, 3" value={branches} onChange={(e) => setBranches(e.target.value)} />
                <p className="text-xs text-muted-foreground">Códigos das filiais na Tcar. Em branco: só a filial do servidor.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tc-used">Campo do “utilizado em”</Label>
                <Input id="tc-used" placeholder="Ex.: epctb_utilizadoem" value={usedIn} onChange={(e) => setUsedIn(e.target.value)} />
                <p className="text-xs text-muted-foreground">A API da Tcar ainda não envia esse dado: peça ao suporte para incluir e informe aqui o nome do campo.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tc-full">Cópia completa (estoque e preço) a cada</Label>
                <div className="flex items-center gap-2">
                  <Input id="tc-full" type="number" min={1} max={48} className="w-24" value={fullHours} onChange={(e) => setFullHours(Number(e.target.value))} />
                  <span className="text-sm text-muted-foreground">horas</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tc-inc">Produtos alterados a cada</Label>
                <div className="flex items-center gap-2">
                  <Input id="tc-inc" type="number" min={2} max={240} className="w-24" value={incMinutes} onChange={(e) => setIncMinutes(Number(e.target.value))} />
                  <span className="text-sm text-muted-foreground">minutos</span>
                </div>
              </div>
            </div>
          </fieldset>
          <FormError message={error} />
        </CardContent>
        {canEdit && (
          <CardFooter className="mt-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  )
}

function TcarStatus({ c }: { c: TcarConfig }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const s = c.state
  const online = !!s.lastPingAt && Date.now() - Date.parse(s.lastPingAt) < 5 * 60_000
  const full = useMutation({
    mutationFn: () => api.post('/tcar/config/copiar-tudo'),
    onSuccess: () => {
      toast.success('Cópia completa pedida: começa no próximo contato da Tcar.')
      void qc.invalidateQueries({ queryKey: ['tcar-config'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const forget = useMutation({
    mutationFn: () => api.put('/tcar/config', { enabled: c.enabled, resetIdentity: true }),
    onSuccess: () => {
      toast.success('Empresa e filial esquecidas: o próximo contato define de novo.')
      void qc.invalidateQueries({ queryKey: ['tcar-config'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const rows: [string, string][] = [
    ['Último contato', s.lastPingAt ? formatDateTime(s.lastPingAt) : 'Nenhum ainda'],
    ['Servidor da Tcar', s.instance ? [s.instance.hostname, s.instance.version && `versão ${s.instance.version}`, s.instance.ip].filter(Boolean).join(' · ') : '—'],
    ['Empresa / filial', c.companyId ? `${c.companyId} / ${c.branchId ?? '—'}` : 'Definidas no primeiro contato'],
    ['Produtos copiados', int.format(s.products)],
    ['Última cópia completa', s.fullRunning ? 'Copiando agora…' : s.lastFullAt ? formatDateTime(s.lastFullAt) : '—'],
    ['Consultas na fila', int.format(s.pendingActions)],
  ]
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Situação
          <Badge variant="outline" className={online ? 'border-[#006300]/40 text-[#006300] dark:text-[#0ca30c]' : 'text-muted-foreground'}>
            {!c.enabled ? 'Desligada' : online ? 'Conectada' : 'Sem contato'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
        {s.lastError && (
          <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {s.lastError}
            {s.lastErrorAt ? ` (${formatDateTime(s.lastErrorAt)})` : ''}
          </p>
        )}
        {can('configuracoes', 'edit') && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => full.mutate()} disabled={full.isPending || !c.enabled}>
              <RefreshCwIcon /> Copiar tudo de novo
            </Button>
            {c.companyId && (
              <Button size="sm" variant="ghost" onClick={() => forget.mutate()} disabled={forget.isPending}>
                Esquecer empresa/filial
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
