import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, PrinterIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'

interface ReportMeta {
  id: string
  label: string
  cycleKey: string | null
  status: 'GERANDO' | 'PRONTO' | 'ERRO'
  error: string | null
  model: string
  total: number
  omitted: number
  createdBy: string | null
  createdAt: string
  finishedAt: string | null
  cost: number
}
interface LossResult {
  summary: string
  causes: { cause: string; count: number; clients: string[] }[]
  codes: { code: string; part: string; count: number; clients: string[] }[]
  decisions: { action: string; priority: 'alta' | 'media' | 'baixa'; why: string }[]
  people: { person: string; comment: string }[]
  records: string
  items: { id: string; client: string; person: string | null; stage: 'vendedor' | 'pre_venda'; date: string; reason: string | null; notes: string | null; codes: string[]; parts: string[]; answer: string; cause: string; action: string }[]
}
interface View {
  config: { model: string }
  keyConfigured: boolean
  models: { id: string; label: string }[]
  max: number
  reports: ReportMeta[]
}

const PRIORITY = { alta: { label: 'Alta', cls: 'bg-red-500/15 text-red-700 dark:text-red-300' }, media: { label: 'Média', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }, baixa: { label: 'Baixa', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' } }
const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const brDate = (s: string) => s.split('-').reverse().join('/')
const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Análise das perdas com IA (Claude): lê o motivo e as observações das pré-vendas perdidas e mostra as causas, os
 * códigos e as peças pedidas, o que foi respondido ao cliente e as decisões sugeridas. Só gestores.
 */
export function PerdasIa() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['relatorios', 'perdas-ia'],
    queryFn: () => api.get<View>('/relatorios/perdas-ia'),
    refetchInterval: (query) => (query.state.data?.reports.some((r) => r.status === 'GERANDO') ? 5000 : false),
  })
  const today = new Date()
  const [from, setFrom] = useState(() => isoDay(new Date(today.getTime() - 7 * 86_400_000)))
  const [to, setTo] = useState(() => isoDay(new Date(today.getTime() - 86_400_000)))
  const [selected, setSelected] = useState<string | null>(null)
  const reports = q.data?.reports ?? []
  const current = selected ?? reports.find((r) => r.status !== 'ERRO')?.id ?? reports[0]?.id ?? null

  const model = useMutation({
    mutationFn: (m: string) => api.put('/relatorios/perdas-ia/config', { model: m }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relatorios', 'perdas-ia'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const start = useMutation({
    mutationFn: () => api.post<ReportMeta>('/relatorios/perdas-ia', { from, to }),
    onSuccess: (r) => {
      setSelected(r.id)
      toast.success('Análise iniciada. Leva alguns minutos; a tela atualiza sozinha.')
      void qc.invalidateQueries({ queryKey: ['relatorios', 'perdas-ia'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton />
  const v = q.data

  return (
    <div className="space-y-4">
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5" aria-hidden /> Análise das perdas com IA
          </CardTitle>
          <CardDescription>
            O Claude lê o motivo e as observações das pré-vendas perdidas no período e aponta as causas, os códigos e as peças pedidas, o que foi respondido ao cliente e as decisões sugeridas. Usa o saldo da sua conta na Anthropic (o custo de cada relatório aparece abaixo); o resto do CRM continua no Gemini gratuito. Para a IA vão só códigos no lugar dos nomes, sem telefone, e-mail ou documento. Para receber no WhatsApp toda semana, marque “Análise das perdas com IA” no Resumo do vendedor (aba Relatórios agendados).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!v.keyConfigured && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Falta a chave da Anthropic (Claude). Cadastre em <Link to="/marketplaces/assistente/configuracoes" className="underline">Assistente ML › Configurações</Link> (Chaves de IA, Claude). A mesma chave serve aqui.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Modelo</Label>
              <Select value={v.config.model} onValueChange={(m) => model.mutate(m)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {v.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pia-from">De</Label>
              <Input id="pia-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pia-to">Até</Label>
              <Input id="pia-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button onClick={() => start.mutate()} disabled={start.isPending || !v.keyConfigured || reports.some((r) => r.status === 'GERANDO')}>
              {start.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SparklesIcon aria-hidden />} Gerar análise
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Até {v.max} perdas por relatório (as mais recentes, pela data em que a perda foi marcada). Período de até 3 meses.</p>
          {reports.length > 0 && (
            <div className="space-y-1.5">
              <Label>Relatórios gerados</Label>
              <Select value={current ?? undefined} onValueChange={setSelected}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reports.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label} · {r.status === 'GERANDO' ? 'gerando…' : r.status === 'ERRO' ? 'erro' : `${r.total} perda(s) · ${usd(r.cost)}`} · {r.createdBy ?? ''} {formatDateTime(r.createdAt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>
      {current && <Report id={current} meta={reports.find((r) => r.id === current) ?? null} />}
    </div>
  )
}

function Report({ id, meta }: { id: string; meta: ReportMeta | null }) {
  const q = useQuery({ queryKey: ['relatorios', 'perdas-ia', id, meta?.status], queryFn: () => api.get<ReportMeta & { result: LossResult | null }>(`/relatorios/perdas-ia/${id}`) })
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<'todas' | 'vendedor' | 'pre_venda'>('todas')
  useEffect(() => setSearch(''), [id])
  const r = q.data?.result
  const items = useMemo(() => {
    const t = search.trim().toLowerCase()
    return (r?.items ?? []).filter((i) => (stage === 'todas' || i.stage === stage) && (!t || [i.client, i.person, i.reason, i.notes, i.answer, i.cause, i.action, ...i.codes, ...i.parts].some((x) => x?.toLowerCase().includes(t))))
  }, [r, search, stage])

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton />
  const d = q.data
  if (d.status === 'GERANDO')
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2Icon className="animate-spin" aria-hidden /> Gerando a análise de {d.label}… leva alguns minutos.
        </CardContent>
      </Card>
    )
  if (d.status === 'ERRO' || !r)
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">Não foi possível gerar a análise de {d.label}: {d.error ?? 'erro desconhecido'}</CardContent>
      </Card>
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Perdas de {d.label}</h2>
          <p className="text-sm text-muted-foreground">
            {d.total} perda(s){d.omitted ? ` (${d.omitted} mais antigas ficaram fora da análise)` : ''} · {d.model} · custo aproximado {usd(d.cost)} · {d.cycleKey ? 'resumo semanal' : `gerado por ${d.createdBy ?? '—'}`} em {formatDateTime(d.createdAt)}
          </p>
        </div>
        <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
          <PrinterIcon aria-hidden /> Imprimir ou salvar PDF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resumo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="whitespace-pre-line">{r.summary}</p>
          {r.records && <p className="rounded-md bg-muted p-3 text-muted-foreground">Registros: {r.records}</p>}
        </CardContent>
      </Card>

      {r.decisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Decisões sugeridas</CardTitle>
            <CardDescription>Sugestões da IA a partir das observações. Confira antes de agir.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {r.decisions.map((x, i) => (
              <div key={i} className="flex gap-3 rounded-md border p-3 text-sm">
                <span className={`h-fit shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${PRIORITY[x.priority].cls}`}>{PRIORITY[x.priority].label}</span>
                <div>
                  <p className="font-medium">{x.action}</p>
                  {x.why && <p className="text-muted-foreground">{x.why}</p>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {r.causes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Causas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {r.causes.map((c, i) => (
                <div key={i}>
                  <p className="font-medium">
                    {c.cause} <Badge variant="secondary">{c.count}</Badge>
                  </p>
                  {c.clients.length > 0 && <p className="text-xs text-muted-foreground">{c.clients.join(', ')}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {r.codes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Códigos e peças pedidos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {r.codes.map((c, i) => (
                <div key={i}>
                  <p className="font-medium">
                    {c.code && <span className="font-mono">{c.code}</span>} {c.part} {c.count > 1 && <Badge variant="secondary">{c.count}x</Badge>}
                  </p>
                  {c.clients.length > 0 && <p className="text-xs text-muted-foreground">{c.clients.join(', ')}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {r.people.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por vendedor e atendente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {r.people.map((p, i) => (
              <p key={i}>
                <span className="font-medium">{p.person}:</span> {p.comment}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Perda por perda</CardTitle>
          <CardDescription>Cliente, vendedor ou atendente, motivo marcado, observação escrita e o que a IA identificou.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 print:hidden">
            <Input className="max-w-xs" placeholder="Buscar cliente, código, peça…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={stage} onValueChange={(x) => setStage(x as typeof stage)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="vendedor">Repassadas ao vendedor</SelectItem>
                <SelectItem value="pre_venda">Só na pré-venda</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Vendedor / atendente</TableHead>
                  <TableHead>Motivo e observação</TableHead>
                  <TableHead>Códigos e peças</TableHead>
                  <TableHead>Resposta informada</TableHead>
                  <TableHead>Causa e ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id} className="align-top">
                    <TableCell className="min-w-40">
                      <span className="font-medium">{i.client}</span>
                      <span className="block text-xs text-muted-foreground">{brDate(i.date)}</span>
                    </TableCell>
                    <TableCell className="min-w-36">
                      {i.person ?? '—'}
                      <span className="block text-xs text-muted-foreground">{i.stage === 'vendedor' ? 'vendedor' : 'só pré-venda'}</span>
                    </TableCell>
                    <TableCell className="min-w-64 max-w-md whitespace-normal">
                      <span className="font-medium">{i.reason ?? 'sem motivo'}</span>
                      {i.notes && <span className="block text-xs text-muted-foreground">{i.notes}</span>}
                    </TableCell>
                    <TableCell className="min-w-40 whitespace-normal">
                      {i.codes.map((c) => (
                        <span key={c} className="mr-1 inline-block rounded bg-muted px-1.5 font-mono text-xs">
                          {c}
                        </span>
                      ))}
                      {i.parts.length > 0 && <span className="block text-xs">{i.parts.join('; ')}</span>}
                      {!i.codes.length && !i.parts.length && <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="min-w-48 whitespace-normal text-sm">{i.answer || <span className="text-xs text-muted-foreground">não registrado</span>}</TableCell>
                    <TableCell className="min-w-48 whitespace-normal text-sm">
                      {i.cause}
                      {i.action && <span className="block text-xs text-muted-foreground">{i.action}</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhuma perda {search || stage !== 'todas' ? 'com esse filtro' : 'no período'}.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
