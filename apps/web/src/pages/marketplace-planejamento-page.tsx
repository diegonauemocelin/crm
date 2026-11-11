import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, CheckCircle2Icon, ClipboardCheckIcon, DownloadIcon, ExternalLinkIcon, InfoIcon, Loader2Icon, PlusIcon, RefreshCwIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Can, EmptyState, ErrorState, formatDate, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'

const brl = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
/** ROAS: quanto volta em vendas para cada R$ 1 investido em anúncios. */
const roasTxt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`)
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const int = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR'))
const parseNum = (s: string) => {
  const t = s.trim().replace(/\s/g, '')
  if (!t) return null
  const v = Number(/,\d{1,4}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(v) ? v : null
}
const thisMonth = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7)
const addMonths = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7)
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const ITEM_STATUS: Record<string, string> = { active: 'Ativo', paused: 'Pausado', closed: 'Finalizado' }
const precosLink = (id: string) => `/marketplaces/precos?busca=${id}`

function ClassBadge({ c }: { c: string }) {
  return <span className={cn('inline-flex size-6 items-center justify-center rounded text-xs font-bold', c === 'A' ? 'bg-green-600 text-white' : c === 'B' ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground')}>{c}</span>
}

function Bar({ value, max = 100, tone }: { value: number | null; max?: number; tone?: 'ok' | 'bad' }) {
  const w = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-muted">
      <div className={cn('h-full rounded', tone === 'bad' ? 'bg-destructive' : 'bg-primary')} style={{ width: `${w}%` }} />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  )
}

export function MarketplacePlanejamentoPage() {
  usePageTitle('Planejamento')
  const [tab, setTab] = useState('abc')
  return (
    <RequirePermission module="marketplace_planejamento">
      <PageHeader title="Planejamento" description="Mercado Livre: curva ABC e saúde do catálogo, auditoria da conta, metas, envio ao Full, sazonalidade, concorrência e DRE. Os números vêm dos pedidos lidos do Mercado Livre; custo, imposto e frete são os de Preços e promoções (marcados como estimados)." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3 flex-wrap">
          <TabsTrigger value="abc">Curva ABC</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
          <TabsTrigger value="metas">Metas</TabsTrigger>
          <TabsTrigger value="full">Full</TabsTrigger>
          <TabsTrigger value="sazonalidade">Sazonalidade e concorrência</TabsTrigger>
          <TabsTrigger value="dre">DRE</TabsTrigger>
        </TabsList>
        <TabsContent value="abc">
          <AbcTab />
        </TabsContent>
        <TabsContent value="auditoria">
          <AuditTab />
        </TabsContent>
        <TabsContent value="metas">
          <GoalsTab />
        </TabsContent>
        <TabsContent value="full">
          <FullTab />
        </TabsContent>
        <TabsContent value="sazonalidade">
          <SeasonTab />
        </TabsContent>
        <TabsContent value="dre">
          <DreTab />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  )
}

// ---------- Curva ABC ----------

interface AbcRow {
  id: string
  title: string
  sku: string | null
  brand: string | null
  status: string | null
  stock: number | null
  full: boolean
  units: number
  orders: number
  revenue: number
  contribution: number | null
  marginPct: number | null
  marginIncomplete: boolean
  lastSaleAt: string | null
  classRevenue: string
  classMargin: string
  quality: { score: number | null; level: string | null; pending: { area: string; text: string; warning: boolean }[]; experience: string | null; experienceColor: string | null; problems: string[]; syncedAt: string; error: string | null } | null
  alerts: { code: string; text: string }[]
}
interface AbcData {
  days: number
  sync: { lastOkAt?: string; lastError?: string | null; running?: boolean }
  syncing: boolean
  quality: { total: number; done: number; errors: number; lastError: string | null } | null
  minMarginPct: number
  classes: Record<'revenue' | 'margin', Record<'A' | 'B' | 'C', { items: number; revenue: number; contribution: number }>>
  alerts: Record<string, number>
  rows: AbcRow[]
}
const ALERTS: Record<string, string> = { sem_estoque: 'Sem estoque', pausado_com_estoque: 'Pausado com estoque', parado: 'Parado', sem_venda: 'Sem venda', margem_baixa: 'Margem baixa', prejuizo: 'Prejuízo' }

function SyncBar({ sync, syncing }: { sync: AbcData['sync']; syncing: boolean }) {
  const qc = useQueryClient()
  const run = useMutation({
    mutationFn: () => api.post<{ message: string }>('/marketplace-planejamento/pedidos/sincronizar'),
    onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['plan-abc'] })),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        Pedidos lidos do Mercado Livre {sync.lastOkAt ? `até ${formatDateTime(sync.lastOkAt)}` : 'ainda não'} (o Mercado Livre guarda 12 meses; a leitura repete a cada 6 horas).
        {sync.lastError ? ` Último erro: ${sync.lastError}` : ''}
      </span>
      <Can module="marketplace_planejamento" action="edit">
        <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending || syncing || !!sync.running}>
          {run.isPending || syncing || sync.running ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Ler pedidos agora
        </Button>
      </Can>
    </div>
  )
}

function AbcTab() {
  const qc = useQueryClient()
  const [days, setDays] = useState('90')
  const [metric, setMetric] = useState<'classRevenue' | 'classMargin'>('classRevenue')
  const [cls, setCls] = useState('todas')
  const [alert, setAlert] = useState('todos')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['plan-abc', days], queryFn: () => api.get<AbcData>(`/marketplace-planejamento/abc?dias=${days}`), refetchInterval: (x) => (x.state.data?.syncing || x.state.data?.quality ? 5000 : false) })
  const quality = useMutation({
    mutationFn: () => api.post<{ message: string }>('/marketplace-planejamento/qualidade/ler', {}),
    onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['plan-abc'] })),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const d = q.data
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (d?.rows ?? []).filter((r) => (cls === 'todas' || r[metric] === cls) && (alert === 'todos' || r.alerts.some((a) => a.code === alert)) && (!s || [r.id, r.title, r.sku, r.brand].some((v) => (v ?? '').toLowerCase().includes(s))))
  }, [d, cls, alert, search, metric])
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!d) return <TableSkeleton rows={6} />
  const k = metric === 'classRevenue' ? 'revenue' : 'margin'
  return (
    <div className="space-y-3">
      <SyncBar sync={d.sync} syncing={d.syncing} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['A', 'B', 'C'] as const).map((c) => (
          <Stat key={c} label={`Classe ${c} (${metric === 'classRevenue' ? 'faturamento' : 'margem'})`} value={`${d.classes[k][c].items} anúncio(s)`} hint={`${brl(d.classes[k][c].revenue)} · contribuição ${brl(d.classes[k][c].contribution)}`} />
        ))}
        <Stat label="Alertas" value={int(Object.values(d.alerts).reduce((s, v) => s + v, 0))} hint={Object.entries(d.alerts).filter(([, v]) => v).map(([kk, v]) => `${ALERTS[kk]}: ${v}`).join(' · ') || 'nenhum'} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Título, MLB, SKU ou marca" className="max-w-xs" aria-label="Buscar" />
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-36" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="60">60 dias</SelectItem>
            <SelectItem value="90">90 dias</SelectItem>
            <SelectItem value="180">180 dias</SelectItem>
          </SelectContent>
        </Select>
        <Select value={metric} onValueChange={(v) => setMetric(v as 'classRevenue')}>
          <SelectTrigger className="w-44" aria-label="Curva por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="classRevenue">Por faturamento</SelectItem>
            <SelectItem value="classMargin">Por margem (R$)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={cls} onValueChange={setCls}>
          <SelectTrigger className="w-32" aria-label="Classe">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="A">Classe A</SelectItem>
            <SelectItem value="B">Classe B</SelectItem>
            <SelectItem value="C">Classe C</SelectItem>
          </SelectContent>
        </Select>
        <Select value={alert} onValueChange={setAlert}>
          <SelectTrigger className="w-48" aria-label="Alerta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os anúncios</SelectItem>
            {Object.entries(ALERTS).map(([kk, v]) => (
              <SelectItem key={kk} value={kk}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Can module="marketplace_planejamento" action="edit">
          <Button size="sm" variant="outline" onClick={() => quality.mutate()} disabled={quality.isPending || !!d.quality}>
            {quality.isPending || d.quality ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Ler qualidade (200 que mais vendem)
          </Button>
        </Can>
        {d.quality && (
          <span className="text-xs text-muted-foreground">
            Qualidade: {d.quality.done} de {d.quality.total}
            {d.quality.errors ? ` · ${d.quality.errors} com erro` : ''}
          </span>
        )}
      </div>
      {!rows.length ? (
        <EmptyState icon={ClipboardCheckIcon} title="Nenhum anúncio" description={d.sync.lastOkAt ? 'Mude os filtros.' : 'Clique em Ler pedidos agora e, em Preços e promoções, em Ler do Mercado Livre.'} />
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Anúncio</TableHead>
                <TableHead>ABC</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead>Qualidade</TableHead>
                <TableHead>Alertas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 500).map((r) => (
                <Fragment key={r.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <TableCell className="max-w-72 pl-4">
                      <span className="line-clamp-1 font-medium">{r.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.id}
                        {r.sku ? ` · ${r.sku}` : ''}
                        {r.full ? ' · Full' : ''}
                        {r.status && r.status !== 'active' ? ` · ${ITEM_STATUS[r.status] ?? r.status}` : ''}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <ClassBadge c={r.classRevenue} /> <ClassBadge c={r.classMargin} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {int(r.units)}
                      <span className="block text-xs text-muted-foreground">{r.lastSaleAt ? `última ${formatDate(r.lastSaleAt)}` : 'sem venda'}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brl(r.revenue)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', r.marginPct !== null && r.marginPct < d.minMarginPct && 'font-semibold text-destructive')}>
                      {r.marginIncomplete ? <span className="text-xs text-muted-foreground">sem custo/imposto</span> : pct(r.marginPct)}
                      {r.contribution !== null && !r.marginIncomplete && <span className="block text-xs text-muted-foreground">{brl(r.contribution)}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.stock)}</TableCell>
                    <TableCell>{r.quality?.score != null ? <Badge variant={r.quality.score < 70 ? 'destructive' : 'secondary'}>{r.quality.score}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-64 text-xs">{r.alerts.map((a) => a.text).join(' ') || <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                  {open === r.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/30 pl-4 text-sm">
                        <div className="flex flex-wrap gap-6">
                          <div className="space-y-1">
                            <p className="font-medium">Qualidade do anúncio</p>
                            {r.quality ? (
                              <>
                                <p>
                                  Nota {r.quality.score ?? '—'} {r.quality.level ? `(${r.quality.level})` : ''} · lida em {formatDateTime(r.quality.syncedAt)}
                                </p>
                                {r.quality.pending.map((p) => (
                                  <p key={p.text} className={cn('text-xs', p.warning && 'text-destructive')}>
                                    • {p.area ? `${p.area}: ` : ''}
                                    {p.text}
                                  </p>
                                ))}
                                {r.quality.experience && <p className="text-xs">Experiência de compra: {r.quality.experience}</p>}
                                {r.quality.problems.map((p) => (
                                  <p key={p} className="text-xs text-destructive">
                                    • {p}
                                  </p>
                                ))}
                                {r.quality.error && <p className="text-xs text-muted-foreground">{r.quality.error}</p>}
                              </>
                            ) : (
                              <p className="text-xs text-muted-foreground">Ainda não lida (botão Ler qualidade).</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <p>{r.orders} pedido(s) no período</p>
                            <Link to={precosLink(r.id)} className="inline-flex items-center gap-1 text-primary hover:underline">
                              Abrir em Preços e promoções <ExternalLinkIcon className="size-3.5" />
                            </Link>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {rows.length > 500 && <p className="text-xs text-muted-foreground">Mostrando 500 de {rows.length}. Use os filtros.</p>}
    </div>
  )
}

// ---------- Auditoria ----------

interface Finding {
  level: 'alerta' | 'atencao' | 'ok'
  area: string
  text: string
}
interface Swot {
  id: string
  text: string
  createdByName: string | null
  createdAt: string
}

function AuditTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['plan-auditoria'], queryFn: () => api.get<{ summary: Record<string, Record<string, unknown> | null>; findings: Finding[]; swots: Swot[]; aiAvailable: boolean }>('/marketplace-planejamento/auditoria') })
  const swot = useMutation({
    mutationFn: () => api.post<Swot>('/marketplace-planejamento/auditoria/swot'),
    onSuccess: () => (toast.success('Análise SWOT gerada.'), void qc.invalidateQueries({ queryKey: ['plan-auditoria'] })),
    onError: (e) => toast.error(errorMessage(e), { duration: 8000 }),
  })
  const [shown, setShown] = useState<string | null>(null)
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  const d = q.data
  const current = d.swots.find((s) => s.id === shown) ?? d.swots[0]
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="gap-2 p-4">
        <p className="font-medium">Diagnóstico da conta</p>
        <p className="text-xs text-muted-foreground">Com o que o CRM tem: reputação (Mercado Livre), anúncios, qualidade lida, perguntas do Assistente ML, Mercado Livre Ads e margem estimada.</p>
        {d.findings.map((f) => (
          <p key={`${f.area}-${f.text}`} className="flex gap-2 text-sm">
            {f.level === 'alerta' ? <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" /> : f.level === 'atencao' ? <InfoIcon className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-green-600" />}
            <span>
              <b>{f.area}:</b> {f.text}
            </span>
          </p>
        ))}
      </Card>
      <Card className="gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Análise SWOT</p>
          <Can module="marketplace_planejamento" action="edit">
            <Button size="sm" onClick={() => swot.mutate()} disabled={swot.isPending || !d.aiAvailable}>
              {swot.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Gerar análise SWOT
            </Button>
          </Can>
        </div>
        {!d.aiAvailable && <p className="text-xs text-muted-foreground">Cadastre a chave gratuita do Gemini em Configurações › E-mail marketing para usar a IA.</p>}
        {d.swots.length > 1 && (
          <Select value={current?.id ?? ''} onValueChange={setShown}>
            <SelectTrigger className="w-64" aria-label="Análise">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {d.swots.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {formatDateTime(s.createdAt)} · {s.createdByName ?? ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {current ? <p className="text-sm whitespace-pre-line">{current.text}</p> : <p className="text-sm text-muted-foreground">Nenhuma análise ainda. A IA usa só o resumo de números ao lado (sem dados de clientes); cada análise fica guardada com a data para comparar.</p>}
      </Card>
    </div>
  )
}

// ---------- Metas ----------

interface Task {
  id: string
  title: string
  assigneeId: string | null
  assigneeName: string | null
  dueDate: string | null
  done: boolean
}
interface GoalData {
  month: string
  day: number
  days: number
  goal: { id: string; revenueTarget: string | null; marginPctTarget: string | null; acosTarget: string | null; notes: string | null; tasks: Task[] } | null
  revenue: { target: number | null; actual: number; pct: number | null; projection: number; projectionPct: number | null }
  marginPct: { target: number | null; actual: number | null; noCostPct: number | null }
  acos: { target: number | null; actual: number | null }
  roas: { target: number | null; actual: number | null; revenue: number; cost: number }
  users: { id: string; name: string }[]
}

function GoalsTab() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const canEdit = can('marketplace_planejamento', 'edit')
  const [month, setMonth] = useState(thisMonth())
  const q = useQuery({ queryKey: ['plan-metas', month], queryFn: () => api.get<GoalData>(`/marketplace-planejamento/metas?mes=${month}&canal=mercadolivre`) })
  const [form, setForm] = useState({ revenue: '', margin: '', acos: '', notes: '' })
  const g = q.data?.goal
  useEffect(() => {
    const s = (v: string | null | undefined) => (v === null || v === undefined ? '' : String(Number(v)).replace('.', ','))
    setForm({ revenue: s(g?.revenueTarget), margin: s(g?.marginPctTarget), acos: s(g?.acosTarget), notes: g?.notes ?? '' })
  }, [g])
  const refresh = () => void qc.invalidateQueries({ queryKey: ['plan-metas'] })
  const save = useMutation({
    mutationFn: () => api.put('/marketplace-planejamento/metas', { mes: month, canal: 'mercadolivre', revenueTarget: parseNum(form.revenue), marginPctTarget: parseNum(form.margin), acosTarget: parseNum(form.acos), notes: form.notes || null }),
    onSuccess: () => (toast.success('Meta salva.'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const [task, setTask] = useState({ title: '', assigneeId: '', dueDate: '' })
  const addTask = useMutation({
    mutationFn: () => api.post(`/marketplace-planejamento/metas/${g!.id}/tarefas`, { title: task.title, assigneeId: task.assigneeId || null, dueDate: task.dueDate || null }),
    onSuccess: () => (setTask({ title: '', assigneeId: '', dueDate: '' }), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const updTask = useMutation({ mutationFn: (p: { id: string; done: boolean }) => api.put(`/marketplace-planejamento/tarefas/${p.id}`, { done: p.done }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) })
  const delTask = useMutation({ mutationFn: (id: string) => api.post(`/marketplace-planejamento/tarefas/${id}/excluir`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) })
  const d = q.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setMonth(addMonths(month, -1))}>
          ‹
        </Button>
        <span className="min-w-40 text-center font-medium capitalize">{monthLabel(month)}</span>
        <Button size="sm" variant="outline" onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </Button>
        <Badge variant="secondary">Canal: Mercado Livre</Badge>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <TableSkeleton rows={4} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="gap-2 p-4">
              <p className="text-xs text-muted-foreground">Faturamento</p>
              <p className="text-xl font-semibold tabular-nums">{brl(d.revenue.actual)}</p>
              <p className="text-xs">Meta {brl(d.revenue.target)} · {pct(d.revenue.pct)}</p>
              <Bar value={d.revenue.pct} />
              {d.day > 0 && d.day < d.days && (
                <p className="text-xs text-muted-foreground">
                  Projeção pelo ritmo ({d.day} de {d.days} dias): {brl(d.revenue.projection)} {d.revenue.projectionPct !== null ? `(${pct(d.revenue.projectionPct)} da meta)` : ''}
                </p>
              )}
            </Card>
            <Card className="gap-2 p-4">
              <p className="text-xs text-muted-foreground">Margem de contribuição (estimada)</p>
              <p className="text-xl font-semibold tabular-nums">{d.marginPct.actual === null ? '—' : pct(d.marginPct.actual)}</p>
              <p className="text-xs">Meta {pct(d.marginPct.target)}</p>
              <Bar value={d.marginPct.actual} max={Math.max(1, d.marginPct.target ?? 30)} tone={d.marginPct.target !== null && d.marginPct.actual !== null && d.marginPct.actual < d.marginPct.target ? 'bad' : 'ok'} />
              {d.marginPct.actual === null && <p className="text-xs text-muted-foreground">Há vendas sem custo informado ({pct(d.marginPct.noCostPct)} do faturamento): informe os custos em Preços e promoções.</p>}
            </Card>
            <Card className="gap-2 p-4">
              <p className="text-xs text-muted-foreground">ACOS (Mercado Livre Ads)</p>
              <p className="text-xl font-semibold tabular-nums">{pct(d.acos.actual)}</p>
              <p className="text-xs">Meta: até {pct(d.acos.target)}</p>
              <Bar value={d.acos.actual} max={Math.max(1, (d.acos.target ?? 20) * 1.5)} tone={d.acos.target !== null && d.acos.actual !== null && d.acos.actual > d.acos.target ? 'bad' : 'ok'} />
            </Card>
            <Card className="gap-2 p-4">
              <p className="text-xs text-muted-foreground">ROAS (Mercado Livre Ads)</p>
              <p className="text-xl font-semibold tabular-nums">{roasTxt(d.roas.actual)}</p>
              <p className="text-xs">Meta: pelo menos {roasTxt(d.roas.target)}{d.roas.target !== null ? ` (igual ao ACOS de ${pct(d.acos.target)})` : ''}</p>
              <Bar value={d.roas.actual} max={Math.max(1, (d.roas.target ?? 5) * 1.5)} tone={d.roas.target !== null && d.roas.actual !== null && d.roas.actual < d.roas.target ? 'bad' : 'ok'} />
              <p className="text-xs text-muted-foreground">
                Vendas pelos anúncios {brl(d.roas.revenue)} · investimento {brl(d.roas.cost)}
              </p>
            </Card>
          </div>
          {canEdit && (
            <Card className="gap-3 p-4">
              <p className="font-medium">Meta do mês</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="meta-fat">Faturamento (R$)</Label>
                  <Input id="meta-fat" value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })} inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-mg">Margem de contribuição (%)</Label>
                  <Input id="meta-mg" value={form.margin} onChange={(e) => setForm({ ...form, margin: e.target.value })} inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-acos">ACOS máximo (%)</Label>
                  <Input id="meta-acos" value={form.acos} onChange={(e) => setForm({ ...form, acos: e.target.value })} inputMode="decimal" />
                </div>
              </div>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Observações (opcional)" maxLength={1000} aria-label="Observações" />
              <div>
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending && <Loader2Icon className="animate-spin" />} Salvar meta
                </Button>
              </div>
            </Card>
          )}
          <Card className="gap-2 p-4">
            <p className="font-medium">Tarefas</p>
            {!g ? (
              <p className="text-sm text-muted-foreground">Salve a meta do mês para adicionar tarefas.</p>
            ) : (
              <>
                {g.tasks.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 border-b py-1.5 text-sm last:border-0">
                    <Checkbox checked={t.done} disabled={!canEdit} onCheckedChange={(v) => updTask.mutate({ id: t.id, done: !!v })} aria-label={`Feito: ${t.title}`} />
                    <span className={cn('flex-1', t.done && 'text-muted-foreground line-through')}>{t.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.assigneeName ?? 'sem responsável'}
                      {t.dueDate ? ` · até ${formatDate(t.dueDate)}` : ''}
                    </span>
                    {canEdit && (
                      <Button size="icon-sm" variant="ghost" onClick={() => delTask.mutate(t.id)} aria-label="Excluir tarefa">
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder="Nova tarefa" className="min-w-60 flex-1" maxLength={200} aria-label="Nova tarefa" />
                    <Select value={task.assigneeId || 'ninguem'} onValueChange={(v) => setTask({ ...task, assigneeId: v === 'ninguem' ? '' : v })}>
                      <SelectTrigger className="w-48" aria-label="Responsável">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ninguem">Sem responsável</SelectItem>
                        {d.users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} className="w-40" aria-label="Prazo" />
                    <Button size="sm" onClick={() => addTask.mutate()} disabled={task.title.trim().length < 2 || addTask.isPending}>
                      <PlusIcon /> Adicionar
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// ---------- Full ----------

interface FullRow {
  id: string
  title: string
  sku: string | null
  isFull: boolean
  stock: number | null
  units30: number
  units60: number
  marginPct: number | null
  marginIncomplete: boolean
  dailyRate: number
  qty: number
  reason: string
  storageCost: number | null
}
interface PlanConfig {
  coverageDays: number
  fullWindowDays: 30 | 60
  fullMinMarginPct: number | null
  storageCostPerUnitMonth: number | null
  stalledDays: number
}

function FullTab() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['plan-full'], queryFn: () => api.get<{ config: PlanConfig; minMarginPct: number; rows: FullRow[] }>('/marketplace-planejamento/full') })
  const [f, setF] = useState({ coverage: '', window: '30', margin: '', storage: '', stalled: '' })
  const c = q.data?.config
  useEffect(() => {
    if (!c) return
    setF({ coverage: String(c.coverageDays), window: String(c.fullWindowDays), margin: c.fullMinMarginPct === null ? '' : String(c.fullMinMarginPct).replace('.', ','), storage: c.storageCostPerUnitMonth === null ? '' : String(c.storageCostPerUnitMonth).replace('.', ','), stalled: String(c.stalledDays) })
  }, [c])
  const save = useMutation({
    mutationFn: () => api.put('/marketplace-planejamento/configuracao', { coverageDays: parseNum(f.coverage) ?? 30, fullWindowDays: Number(f.window), fullMinMarginPct: parseNum(f.margin), storageCostPerUnitMonth: parseNum(f.storage), stalledDays: parseNum(f.stalled) ?? 60 }),
    onSuccess: () => (toast.success('Parâmetros salvos.'), void qc.invalidateQueries({ queryKey: ['plan-full'] }), void qc.invalidateQueries({ queryKey: ['plan-abc'] })),
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <TableSkeleton rows={5} />
  const d = q.data
  const editable = can('marketplace_planejamento', 'edit')
  return (
    <div className="space-y-4">
      <Card className="gap-3 p-4">
        <p className="font-medium">Parâmetros</p>
        <div className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="full-cob">Dias de cobertura</Label>
            <Input id="full-cob" value={f.coverage} onChange={(e) => setF({ ...f, coverage: e.target.value })} inputMode="numeric" disabled={!editable} />
          </div>
          <div className="space-y-1">
            <Label>Giro pelos últimos</Label>
            <Select value={f.window} onValueChange={(v) => setF({ ...f, window: v })} disabled={!editable}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="60">60 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="full-mg">Margem mínima (%)</Label>
            <Input id="full-mg" value={f.margin} onChange={(e) => setF({ ...f, margin: e.target.value })} placeholder={`${d.minMarginPct} (Preços)`} inputMode="decimal" disabled={!editable} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="full-arm">Armazenagem R$/un./mês</Label>
            <Input id="full-arm" value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value })} placeholder="não considerar" inputMode="decimal" disabled={!editable} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="full-par">Parado após (dias)</Label>
            <Input id="full-par" value={f.stalled} onChange={(e) => setF({ ...f, stalled: e.target.value })} inputMode="numeric" disabled={!editable} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">A API do Mercado Livre não informa o custo de armazenagem do Full: se quiser considerar, digite o valor da sua tabela. Sugestão = vendas/dia × dias de cobertura; fora do Full, limitado ao estoque; no Full, só a reposição.</p>
        {editable && (
          <div>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Salvar parâmetros
            </Button>
          </div>
        )}
      </Card>
      {!d.rows.length ? (
        <EmptyState icon={ClipboardCheckIcon} title="Nenhuma sugestão" description="Sem anúncio ativo com venda no período e margem acima do mínimo (ou o Full já cobre os dias pedidos)." />
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Anúncio</TableHead>
                <TableHead className="text-right">Vendas 30 / 60 dias</TableHead>
                <TableHead className="text-right">Vendas/dia</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead className="text-right">Enviar</TableHead>
                <TableHead className="text-right">Armazenagem (teto)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-72 pl-4">
                    <span className="line-clamp-1 font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.id}
                      {r.sku ? ` · ${r.sku}` : ''} · {r.isFull ? 'já no Full (reposição)' : 'fora do Full'}
                    </span>
                    <p className="text-xs text-muted-foreground">{r.reason}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.units30} / {r.units60}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.dailyRate.toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="text-right tabular-nums">{int(r.stock)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.marginIncomplete ? <span className="text-xs text-muted-foreground">sem custo</span> : pct(r.marginPct)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{int(r.qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.storageCost === null ? '—' : brl(r.storageCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

// ---------- Sazonalidade e concorrência ----------

interface SeasonMonth {
  month: number
  label: string
  revenue: number
  units: number
  years: number
  avgRevenue: number | null
  index: number | null
  strong: boolean
  weak: boolean
}
interface SeasonGroup {
  key: string
  title?: string
  revenue: number
  months: SeasonMonth[]
}

/** Valor curto para caber sobre a barra: R$ 12,3 mil. */
const shortBrl = (n: number) => (n >= 1000 ? `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : brl(n))

function SeasonChart({ months }: { months: SeasonMonth[] }) {
  const max = Math.max(1, ...months.map((m) => m.avgRevenue ?? 0))
  return (
    <div className="flex h-44 gap-1">
      {months.map((m) => (
        <div key={m.month} className="flex h-full flex-1 flex-col items-center gap-1" title={`${m.label}: ${brl(m.avgRevenue)} (índice ${m.index ?? '—'}; ${m.years} ano(s) com dado)`}>
          {/* A barra precisa de uma área com altura definida para o % funcionar. */}
          <div className="relative w-full flex-1">
            <div
              className={cn('absolute inset-x-0 bottom-0 rounded-t', m.strong ? 'bg-green-600' : m.weak ? 'bg-amber-500' : 'bg-primary/60')}
              style={{ height: `${((m.avgRevenue ?? 0) / max) * 100}%`, minHeight: m.avgRevenue ? 2 : 0 }}
            />
            {m.avgRevenue ? (
              <span className="absolute inset-x-0 text-center text-[10px] tabular-nums text-muted-foreground" style={{ bottom: `calc(${((m.avgRevenue ?? 0) / max) * 100}% + 2px)` }}>
                {shortBrl(m.avgRevenue)}
              </span>
            ) : null}
          </div>
          <span className="text-[10px] text-muted-foreground">{m.label}</span>
        </div>
      ))}
    </div>
  )
}

function Sparkline({ points }: { points: { date: string; price: number }[] }) {
  if (points.length < 2) return <span className="text-xs text-muted-foreground">{points.length ? brl(points[0]!.price) : 'sem histórico'}</span>
  const ps = points.map((p) => p.price)
  const min = Math.min(...ps)
  const max = Math.max(...ps)
  const w = 140
  const h = 32
  const xy = points.map((p, i) => `${(i / (points.length - 1)) * w},${max === min ? h / 2 : h - ((p.price - min) / (max - min)) * h}`).join(' ')
  return (
    <svg width={w} height={h} className="text-primary" role="img" aria-label={`Preço de ${brl(min)} a ${brl(max)}`}>
      <polyline points={xy} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

function SeasonTab() {
  const q = useQuery({ queryKey: ['plan-sazonalidade'], queryFn: () => api.get<{ from: string | null; to: string | null; monthsWithData: number; geral: SeasonGroup | null; brands: SeasonGroup[]; items: SeasonGroup[] }>('/marketplace-planejamento/sazonalidade') })
  const moves = useQuery({ queryKey: ['plan-concorrencia'], queryFn: () => api.get<{ since: string | null; rows: { itemId: string; title: string; store: string | null; permalink: string | null; first: number; last: number; changePct: number }[] }>('/marketplace-planejamento/concorrencia') })
  const [level, setLevel] = useState<'marca' | 'anuncio'>('marca')
  const [key, setKey] = useState('')
  const [item, setItem] = useState('')
  const hist = useQuery({ queryKey: ['plan-conc-item', item], enabled: /^ML[A-Z]\d{5,15}$/.test(item), queryFn: () => api.get<{ title: string | null; price: number | null; codes: string[]; series: { store: string; itemId: string; title: string | null; permalink: string | null; price: number | null; points: { date: string; price: number }[] }[] }>(`/marketplace-planejamento/concorrencia/${item}`) })
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <TableSkeleton rows={5} />
  const d = q.data
  const list = level === 'marca' ? d.brands : d.items
  const sel = list.find((x) => x.key === key) ?? list[0]
  return (
    <div className="space-y-4">
      <Card className="gap-3 p-4">
        <p className="font-medium">Vendas por mês do ano — geral</p>
        <p className="text-xs text-muted-foreground">
          {d.from ? `Pedidos de ${d.from} a ${d.to} (${d.monthsWithData} meses com dado). O Mercado Livre guarda 12 meses; o histórico cresce com o tempo.` : 'Sem pedidos lidos ainda (aba Curva ABC › Ler pedidos agora).'} Verde = mês forte (20% ou mais acima da média), laranja = fraco.
        </p>
        {d.geral && <SeasonChart months={d.geral.months} />}
      </Card>
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">Por</p>
          <Select value={level} onValueChange={(v) => (setLevel(v as 'marca'), setKey(''))}>
            <SelectTrigger className="w-36" aria-label="Agrupar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="marca">Marca</SelectItem>
              <SelectItem value="anuncio">Anúncio</SelectItem>
            </SelectContent>
          </Select>
          {list.length > 0 && (
            <Select value={sel?.key ?? ''} onValueChange={setKey}>
              <SelectTrigger className="w-80" aria-label={level === 'marca' ? 'Marca' : 'Anúncio'}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.map((x) => (
                  <SelectItem key={x.key} value={x.key}>
                    {(x.title ?? x.key).slice(0, 60)} · {brl(x.revenue)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {sel ? (
          <>
            <SeasonChart months={sel.months} />
            <p className="text-xs text-muted-foreground">Meses fortes: {sel.months.filter((m) => m.strong).map((m) => m.label).join(', ') || 'nenhum destacado'}.</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sem dados.</p>
        )}
      </Card>
      <Card className="gap-3 p-4">
        <p className="font-medium">Concorrência: quem mudou de preço nos últimos 30 dias</p>
        <p className="text-xs text-muted-foreground">Histórico gravado a cada leitura diária de Marketplaces › Concorrentes{moves.data?.since ? ` (desde ${formatDate(moves.data.since)})` : ''}.</p>
        {!moves.data ? (
          <TableSkeleton rows={3} />
        ) : !moves.data.rows.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma mudança registrada ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Anúncio do concorrente</TableHead>
                <TableHead className="text-right">De</TableHead>
                <TableHead className="text-right">Para</TableHead>
                <TableHead className="text-right">Variação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {moves.data.rows.slice(0, 30).map((r) => (
                <TableRow key={`${r.itemId}`}>
                  <TableCell className="max-w-72">
                    <span className="line-clamp-1">{r.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.store ?? ''} · {r.itemId}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.first)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.last)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', r.changePct < 0 ? 'text-destructive' : 'text-green-700')}>{pct(r.changePct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Label htmlFor="conc-item">Histórico dos concorrentes de um anúncio seu</Label>
          <Input id="conc-item" value={item} onChange={(e) => setItem(e.target.value.trim().toUpperCase())} placeholder="MLB..." className="w-48" />
        </div>
        {hist.error && <ErrorState error={hist.error} />}
        {hist.data && (
          <div className="space-y-1 text-sm">
            <p>
              {hist.data.title} · seu preço {brl(hist.data.price)} · códigos {hist.data.codes.join(', ') || 'nenhum'}
            </p>
            {!hist.data.series.length ? (
              <p className="text-muted-foreground">Nenhum concorrente com o mesmo código.</p>
            ) : (
              hist.data.series.map((s) => (
                <div key={`${s.store}-${s.itemId}`} className="flex flex-wrap items-center gap-3 border-b py-1 last:border-0">
                  <span className="min-w-56 flex-1">
                    {s.store} · {s.title ?? s.itemId}
                  </span>
                  <Sparkline points={s.points} />
                  <span className="w-24 text-right tabular-nums">{brl(s.price)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------- DRE ----------

interface DreRow {
  key: string
  label: string
  gross: number
  fees: number
  shipping: number
  ads: number
  taxes: number
  extra: number
  cogs: number
  fixed: number
  contribution: number
  contributionPct: number | null
  orders: number
  units: number
  noCostPct: number | null
  feesEstimated: number
  estimated: boolean
}

function DreTab() {
  const [from, setFrom] = useState(addMonths(thisMonth(), -5))
  const [to, setTo] = useState(thisMonth())
  const [by, setBy] = useState<'mes' | 'produto'>('mes')
  const params = `de=${from}&ate=${to}&por=${by}`
  const q = useQuery({ queryKey: ['plan-dre', params], queryFn: () => api.get<{ rows: DreRow[]; total: DreRow }>(`/marketplace-planejamento/dre?${params}`) })
  const exportCsv = useMutation({ mutationFn: () => api.download(`/marketplace-planejamento/dre/csv?${params}`, `dre-${from}-${to}.csv`), onError: (e) => toast.error(errorMessage(e)) })
  const lines: [keyof DreRow, string, boolean][] = [
    ['gross', 'Venda bruta', false],
    ['fees', 'Tarifas do Mercado Livre', false],
    ['shipping', 'Frete (estimado)', true],
    ['ads', 'Ads', false],
    ['taxes', 'Impostos (estimados)', true],
    ['extra', 'Outras taxas', true],
    ['cogs', 'Custo das peças', true],
    ['fixed', 'Custo fixo', true],
    ['contribution', 'Margem de contribuição', true],
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="dre-de">De</Label>
          <Input id="dre-de" type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dre-ate">Até</Label>
          <Input id="dre-ate" type="month" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <Select value={by} onValueChange={(v) => setBy(v as 'mes')}>
          <SelectTrigger className="w-40" aria-label="Agrupar por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mes">Por mês</SelectItem>
            <SelectItem value="produto">Por produto</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
          {exportCsv.isPending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Exportar CSV
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Canal: Mercado Livre. Tarifa = a do pedido (sale_fee); quando o pedido não traz, estimada pela tarifa do anúncio. Frete = custo atual do frete grátis do anúncio (estimado). Impostos = carga aprendida das notas do Mercado Envios (ou a alíquota manual). Custo = o cadastrado hoje em Preços e promoções. Ads = investimento do Mercado Livre Ads no mês (no DRE por produto só entra no total).
      </p>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <TableSkeleton rows={6} />
      ) : !q.data.rows.length ? (
        <EmptyState icon={ClipboardCheckIcon} title="Sem vendas no período" description="Leia os pedidos na aba Curva ABC." />
      ) : by === 'mes' ? (
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4" />
                {q.data.rows.map((r) => (
                  <TableHead key={r.key} className="text-right">
                    {r.label}
                  </TableHead>
                ))}
                <TableHead className="pr-4 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map(([k, label, est]) => (
                <TableRow key={k} className={cn(k === 'contribution' && 'font-semibold')}>
                  <TableCell className="pl-4 whitespace-nowrap">
                    {label}
                    {est && <span className="text-xs text-muted-foreground"> *</span>}
                  </TableCell>
                  {[...q.data.rows, q.data.total].map((r) => (
                    <TableCell key={r.key} className="text-right whitespace-nowrap tabular-nums">
                      {brl(r[k] as number)}
                      {k === 'contribution' && <span className="block text-xs font-normal text-muted-foreground">{pct(r.contributionPct)}</span>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="pl-4 text-xs text-muted-foreground">% das vendas sem custo informado</TableCell>
                {[...q.data.rows, q.data.total].map((r) => (
                  <TableCell key={r.key} className={cn('text-right text-xs tabular-nums', (r.noCostPct ?? 0) > 0 && 'text-destructive')}>
                    {pct(r.noCostPct)}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="pl-4 text-xs text-muted-foreground">Pedidos / unidades</TableCell>
                {[...q.data.rows, q.data.total].map((r) => (
                  <TableCell key={r.key} className="text-right text-xs tabular-nums">
                    {r.orders} / {r.units}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Produto</TableHead>
                <TableHead className="text-right">Venda bruta</TableHead>
                <TableHead className="text-right">Tarifas</TableHead>
                <TableHead className="text-right">Frete *</TableHead>
                <TableHead className="text-right">Impostos *</TableHead>
                <TableHead className="text-right">Custo *</TableHead>
                <TableHead className="text-right">Contribuição *</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...q.data.rows.slice(0, 300), q.data.total].map((r) => (
                <TableRow key={r.key} className={cn(r.key === 'total' && 'font-semibold')}>
                  <TableCell className="max-w-80 pl-4">
                    <span className="line-clamp-1">{r.label}</span>
                    {(r.noCostPct ?? 0) > 0 && <span className="text-xs text-destructive">sem custo em {pct(r.noCostPct)} das vendas</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.fees)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.shipping)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.taxes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.cogs)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {brl(r.contribution)}
                    <span className="block text-xs font-normal text-muted-foreground">{pct(r.contributionPct)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.units}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">* Estimado: depende do custo cadastrado, da carga de imposto aprendida e do frete atual do anúncio.</p>
    </div>
  )
}
