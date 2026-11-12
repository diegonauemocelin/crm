import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, BadgeDollarSignIcon, CalculatorIcon, ExternalLinkIcon, InfoIcon, LightbulbIcon, Loader2Icon, PercentIcon, RefreshCwIcon, RotateCcwIcon, SearchIcon, SettingsIcon, SparklesIcon, TagIcon, TicketIcon, UploadIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Can, EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, errorMessage } from '@/lib/api'
import { averageTax, ICMS_INTERNO, ICMS_REF_DATE, PIS_COFINS, type TaxRegime, taxForSale } from '@/lib/impostos-ref'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'

// ---------- Tipos da API ----------

interface Tip {
  level: 'alerta' | 'dica' | 'info'
  code: string
  text: string
}
interface Margin {
  price: number
  fee: number | null
  shipping: number | null
  tax: number | null
  extra: number
  cost: number | null
  fixedCost: number
  margin: number | null
  marginPct: number | null
  missing: string[]
}
interface Row {
  id: string
  title: string
  sku: string | null
  costKey: string
  permalink: string | null
  status: string | null
  listingType: string
  full: boolean
  freeShipping: boolean
  availableQuantity: number | null
  price: number | null
  salePrice: number | null
  promo: { type: string | null; price: number } | null
  cost: number | null
  costSource: string | null
  profitTarget?: { value: number; source: 'produto' | 'produto_pct' | 'produto_venda' | 'erp'; pct?: number } | null
  erpPrice?: number | null
  feeFixed?: number | null
  extraPct?: number
  fixedCost?: number
  costPercent: number | null
  costUpdatedAt: string | null
  feePct: number | null
  shippingNote: string | null
  taxPct: number | null
  taxLabel: string
  margin: Margin
  minPrice: number | null
  suggestedPrice: number | null
  competitorMin: number | null
  competitors?: Rival[]
  tips: Tip[]
  sales30: number | null
  sales60: number | null
  readError: string | null
  syncedAt: string
}
interface Config {
  marginMode?: 'CUSTO' | 'CUSTO_IMPOSTO' | 'PRECO'
  taxPct: number | null
  minMarginPct: number
  targetMarginPct: number | null
  fixedCostPerSale: number
  extraFeePct: number
  useNfeTaxes: boolean
}
interface ListData {
  total: number
  page: number
  synced: number
  config: Config
  taxes: { notes: number; overall: { pct: number; notes: number } | null; updatedAt: string | null }
  stats: { noCost: number; belowMin: number; loss: number; avgMarginPct: number | null }
  refresh: { total: number; done: number; errors: number; phase: string; lastError: string | null } | null
  queue: Record<string, number>
  items: Row[]
}
interface Change {
  id: string
  itemId: string | null
  itemTitle: string | null
  kind: string
  before: Record<string, unknown> | null
  after: Record<string, unknown>
  mlRef: string | null
  marginPctAfter: string | null
  status: string
  scheduledAt: string | null
  error: string | null
  createdByName: string | null
  sentAt: string | null
  createdAt: string
}
interface PreviewRow {
  itemId: string
  title: string
  sku: string | null
  before: { price: number | null; salePrice?: number | null; margin: number | null; marginPct: number | null }
  after: { price: number; start?: string; finish?: string; margin: number | null; marginPct: number | null } | null
  belowMin: boolean
  unknownMargin: boolean
  error: string | null
  warnings: string[]
}
interface Preview {
  rows: PreviewRow[]
  minMarginPct: number
  belowMin: number
  errors: number
}
type Action = { tipo: 'preco'; modo: 'valor' | 'percentual' | 'margem' | 'sugerido'; valor?: number } | { tipo: 'promocao'; modo: 'preco' | 'percentual'; valor: number; inicio: string; fim: string } | { tipo: 'encerrar_promocao' }
interface CouponForm {
  name: string
  subType: 'FIXED_AMOUNT' | 'FIXED_PERCENTAGE'
  fixedAmount: number | null
  fixedPercentage: number | null
  minPurchaseAmount: number
  maxPurchaseAmount: number | null
  budget: number
  start: string
  finish: string
  code: string | null
}

// ---------- Formatação ----------

const brl = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const parseNum = (s: string) => {
  const t = s.trim().replace(/\s/g, '')
  if (!t) return null
  const v = Number(/,\d{1,4}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(v) ? v : null
}
const today = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const ITEM_STATUS: Record<string, string> = { active: 'Ativo', paused: 'Pausado', closed: 'Finalizado', under_review: 'Em revisão' }
const KIND: Record<string, string> = { preco: 'Preço', promocao: 'Promoção', encerrar_promocao: 'Encerrar promoção', cupom: 'Cupom criado', cupom_item: 'Anúncio no cupom', encerrar_cupom: 'Cupom excluído' }
const STATUS: Record<string, string> = { AGENDADA: 'Agendada', PENDENTE: 'Na fila', ENVIANDO: 'Enviando', ENVIADA: 'Enviada', ERRO: 'Erro', CANCELADA: 'Cancelada', DESFEITA: 'Desfeita' }
const COST_SOURCE: Record<string, string> = { manual: 'manual', planilha: 'planilha', percentual: '% do preço', tcar: 'Tcar' }
const MISSING: Record<string, string> = { custo: 'sem custo', tarifa: 'sem tarifa', imposto: 'sem imposto', frete: 'sem o frete' }

function MarginCell({ m, min }: { m: Margin; min: number }) {
  if (m.margin === null) return <span className="text-xs text-muted-foreground">{m.missing.filter((x) => x !== 'frete').map((x) => MISSING[x]).join(', ')}</span>
  const low = m.marginPct !== null && m.marginPct < min
  return (
    <span className={cn('tabular-nums', low ? 'font-semibold text-destructive' : 'text-green-700 dark:text-green-500')}>
      {brl(m.margin)}
      <span className="block text-xs">
        {pct(m.marginPct)}
        {m.missing.includes('frete') ? ' · sem o frete' : ''}
      </span>
    </span>
  )
}

function TipIcon({ tip }: { tip: Tip | undefined }) {
  if (!tip) return null
  const Icon = tip.level === 'alerta' ? AlertTriangleIcon : tip.level === 'dica' ? LightbulbIcon : InfoIcon
  return <Icon className={cn('mt-0.5 size-4 shrink-0', tip.level === 'alerta' ? 'text-destructive' : tip.level === 'dica' ? 'text-amber-600' : 'text-muted-foreground')} />
}

// ---------- Página ----------

export function MarketplacePrecosPage() {
  usePageTitle('Preços e promoções')
  const qc = useQueryClient()
  const { can } = useAuth()
  const canEdit = can('marketplace_precos', 'edit')
  const [tab, setTab] = useState('anuncios')
  // Vindo do Planejamento: /marketplaces/precos?busca=MLB...
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('busca') ?? '')
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('busca') ?? '')
  const [status, setStatus] = useState('ativos')
  const [full, setFull] = useState('todos')
  const [problem, setProblem] = useState('todos')
  const [order, setOrder] = useState('margem')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [action, setAction] = useState<'preco' | 'promocao' | null>(null)
  const [review, setReview] = useState<{ ids: string[]; action: Action } | null>(null)
  const [bulk, setBulk] = useState(false)
  const [importing, setImporting] = useState(false)
  const [settings, setSettings] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => (setQ(search), setPage(1)), 350)
    return () => clearTimeout(t)
  }, [search])
  const filter = { situacao: status, full, ...(q ? { busca: q } : {}), ...(problem === 'sem_custo' ? { semCusto: true } : {}), ...(problem === 'margem_baixa' ? { margemBaixa: true } : {}) }
  const params = new URLSearchParams({ pagina: String(page), ordem: order, situacao: status, full, ...(q ? { busca: q } : {}), ...(problem === 'sem_custo' ? { semCusto: 'true' } : {}), ...(problem === 'margem_baixa' ? { margemBaixa: 'true' } : {}) })
  const list = useQuery({
    queryKey: ['precos-anuncios', params.toString()],
    queryFn: () => api.get<ListData>(`/marketplace-precos/anuncios?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.refresh || query.state.data?.queue.PENDENTE || query.state.data?.queue.ENVIANDO ? 4000 : false),
  })
  const refresh = useMutation({
    mutationFn: () => api.post<{ message: string }>('/marketplace-precos/ler', {}),
    onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['precos-anuncios'] })),
    onError: (e) => toast.error(errorMessage(e), { duration: 8000 }),
  })
  const d = list.data
  const items = d?.items ?? []
  const allOn = items.length > 0 && items.every((i) => selected.includes(i.id))
  const job = d?.refresh
  const queued = (d?.queue.PENDENTE ?? 0) + (d?.queue.ENVIANDO ?? 0)
  return (
    <RequirePermission module="marketplace_precos">
      <PageHeader
        title="Preços e promoções"
        description="Margem de cada anúncio do Mercado Livre com a tarifa e o frete da API oficial, o imposto das notas do Mercado Envios e o seu custo. Mude preço, crie desconto e cupom com revisão antes de enviar."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSettings(true)}>
              <SettingsIcon /> Configurações
            </Button>
            <Button onClick={() => refresh.mutate()} disabled={refresh.isPending || !!job}>
              {refresh.isPending || job ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Ler do Mercado Livre
            </Button>
          </div>
        }
      />
      {d && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Anúncios lidos', d.synced.toLocaleString('pt-BR')],
            ['Margem média', pct(d.stats.avgMarginPct)],
            [`Abaixo de ${pct(d.config.minMarginPct)}`, d.stats.belowMin.toLocaleString('pt-BR')],
            ['Com prejuízo', d.stats.loss.toLocaleString('pt-BR')],
            ['Sem custo', d.stats.noCost.toLocaleString('pt-BR')],
          ].map(([k, v]) => (
            <Card key={k} className="gap-1 px-4 py-3">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-xl font-semibold tabular-nums">{v}</p>
            </Card>
          ))}
        </div>
      )}
      {d && (
        <p className="mb-3 text-xs text-muted-foreground">
          Imposto: {d.taxes.overall ? `carga média de ${pct(d.taxes.overall.pct)} em ${d.taxes.notes} nota(s) do Mercado Envios` : 'sem notas do Mercado Envios'}
          {d.config.taxPct !== null ? ` · alíquota manual ${pct(d.config.taxPct)}` : ''} · margem mínima {pct(d.config.minMarginPct)} · alvo {d.config.targetMarginPct === null ? 'não configurada' : pct(d.config.targetMarginPct)}
        </p>
      )}
      {job && (
        <p className="mb-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
          <span>
            {job.phase === 'vendas' ? 'Lendo as vendas dos últimos 60 dias' : `Lendo os anúncios no Mercado Livre: ${job.done} de ${job.total}`}
            {job.errors ? ` · ${job.errors} com erro (${job.lastError ?? ''})` : ''}
          </span>
        </p>
      )}
      {queued > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-md border p-3 text-sm" role="status">
          <Loader2Icon className="size-4 shrink-0 animate-spin" /> Enviando ao Mercado Livre: {queued} na fila (um por segundo). Acompanhe no Histórico.
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="anuncios">Anúncios</TabsTrigger>
          <TabsTrigger value="cupons">Cupons</TabsTrigger>
          <TabsTrigger value="historico">Histórico{d?.queue.AGENDADA ? ` (${d.queue.AGENDADA} agendada)` : ''}</TabsTrigger>
        </TabsList>
        <TabsContent value="anuncios" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 flex-1">
              <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Título, MLB, SKU ou código" className="pl-8" aria-label="Buscar anúncios" />
            </div>
            <Select value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
              <SelectTrigger className="w-40" aria-label="Situação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativos">Ativos e pausados</SelectItem>
                <SelectItem value="active">Só ativos</SelectItem>
                <SelectItem value="paused">Só pausados</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={full} onValueChange={(v) => (setFull(v), setPage(1))}>
              <SelectTrigger className="w-36" aria-label="Full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Full e não Full</SelectItem>
                <SelectItem value="sim">Só Full</SelectItem>
                <SelectItem value="nao">Sem Full</SelectItem>
              </SelectContent>
            </Select>
            <Select value={problem} onValueChange={(v) => (setProblem(v), setPage(1))}>
              <SelectTrigger className="w-52" aria-label="Filtro de margem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as margens</SelectItem>
                <SelectItem value="margem_baixa">Margem abaixo do mínimo</SelectItem>
                <SelectItem value="sem_custo">Sem custo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={order} onValueChange={(v) => (setOrder(v), setPage(1))}>
              <SelectTrigger className="w-44" aria-label="Ordem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="margem">Menor margem primeiro</SelectItem>
                <SelectItem value="margem_desc">Maior margem primeiro</SelectItem>
                <SelectItem value="preco">Maior preço primeiro</SelectItem>
                <SelectItem value="titulo">Título</SelectItem>
              </SelectContent>
            </Select>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setBulk(true)}>
                  <CalculatorIcon /> Custo em massa
                </Button>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <UploadIcon /> Importar custos
                </Button>
              </>
            )}
          </div>
          {selected.length === 0 && canEdit && (d?.total ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">Marque os anúncios na caixa à esquerda para alterar preço, criar promoção ou cupom.</p>
          )}
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
              <span>{selected.length} selecionado(s)</span>
              <Button size="sm" onClick={() => setAction('preco')} disabled={selected.length > 200}>
                <BadgeDollarSignIcon /> Alterar preço
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReview({ ids: selected, action: { tipo: 'preco', modo: 'sugerido' } })} disabled={selected.length > 200 || d?.config.targetMarginPct === null}>
                <SparklesIcon /> Aplicar preço sugerido
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAction('promocao')} disabled={selected.length > 200}>
                <TagIcon /> Criar promoção
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReview({ ids: selected, action: { tipo: 'encerrar_promocao' } })} disabled={selected.length > 200}>
                <XIcon /> Encerrar promoção
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTab('cupons')}>
                <TicketIcon /> Criar cupom
              </Button>
              {selected.length > 200 && <span className="text-xs text-destructive">No máximo 200 por vez.</span>}
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Limpar seleção
              </Button>
            </div>
          )}
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !d ? (
            <TableSkeleton rows={6} />
          ) : !items.length ? (
            <EmptyState
              icon={BadgeDollarSignIcon}
              title={d.synced ? 'Nenhum anúncio com esses filtros' : 'Nenhum anúncio lido ainda'}
              description={d.synced ? 'Mude os filtros.' : 'Clique em Ler do Mercado Livre. Os anúncios vêm da sincronização do Assistente ML; a leitura busca preço, promoção, tarifa, frete e vendas.'}
            />
          ) : (
            <Card className="overflow-x-auto py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      <Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v ? [...new Set([...selected, ...items.map((i) => i.id)])] : selected.filter((s) => !items.some((i) => i.id === s)))} aria-label="Selecionar todos da página" />
                    </TableHead>
                    <TableHead>Anúncio</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="w-32">Custo</TableHead>
                    <TableHead className="text-right">Tarifa</TableHead>
                    <TableHead className="text-right">Frete</TableHead>
                    <TableHead className="text-right">Imposto</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                    <TableHead className="text-right">Mínimo / sugerido</TableHead>
                    <TableHead className="text-right">Concorrentes</TableHead>
                    <TableHead className="min-w-56">Dica</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.includes(r.id)} onCheckedChange={(v) => setSelected(v ? [...selected, r.id] : selected.filter((s) => s !== r.id))} aria-label={`Selecionar ${r.title}`} />
                      </TableCell>
                      <TableCell className="max-w-72">
                        <span className="line-clamp-1 font-medium">{r.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.id}
                          {r.sku ? ` · SKU ${r.sku}` : ''} · {r.listingType}
                          {r.full ? ' · Full' : ''}
                          {r.status && r.status !== 'active' ? ` · ${ITEM_STATUS[r.status] ?? r.status}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {r.promo ? (
                          <>
                            <span className="text-xs text-muted-foreground line-through">{brl(r.price)}</span>
                            <span className="block font-medium">{brl(r.promo.price)}</span>
                            <Badge variant="secondary" className="mt-0.5">
                              promoção
                            </Badge>
                          </>
                        ) : (
                          brl(r.price)
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <CostCell key={`${r.id}-${r.cost ?? ''}`} row={r} editable={canEdit} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {brl(r.margin.fee)}
                        {r.feePct !== null && <span className="block text-xs text-muted-foreground">{pct(r.feePct)}</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" title={r.shippingNote ?? undefined}>
                        {r.margin.shipping === null ? <span className="text-xs text-muted-foreground">não calculado</span> : r.freeShipping ? brl(r.margin.shipping) : <span className="text-xs text-muted-foreground">comprador</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" title={r.taxLabel}>
                        {brl(r.margin.tax)}
                        <span className="block text-xs text-muted-foreground">{pct(r.taxPct)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <MarginCell m={r.margin} min={d.config.minMarginPct} />
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap tabular-nums">
                        <span className="block text-muted-foreground">{brl(r.minPrice)}</span>
                        <span className="font-medium">{brl(r.suggestedPrice)}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap tabular-nums">
                        {r.competitors?.length ? (
                          r.competitors.map((c) => (
                            <span key={c.itemId} className="block" title={c.seller ?? c.itemId}>
                              {brl(c.price)}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-80">
                        {r.tips[0] ? (
                          <span className="flex gap-1.5 text-xs">
                            <TipIcon tip={r.tips[0]} />
                            <span className="line-clamp-2">{r.tips[0].text}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem pontos de atenção.</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          {d && d.total > 50 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <span>
                Página {page} de {Math.ceil(d.total / 50)}
              </span>
              <Button size="sm" variant="outline" disabled={page * 50 >= d.total} onClick={() => setPage(page + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="cupons">
          <CouponsTab selected={selected} onPick={() => setTab('anuncios')} />
        </TabsContent>
        <TabsContent value="historico">
          <HistoryTab />
        </TabsContent>
      </Tabs>
      {open && d && <ItemSheet id={open} config={d.config} onClose={() => setOpen(null)} onApply={(ids, a) => (setOpen(null), setReview({ ids, action: a }))} />}
      {action && <ActionDialog kind={action} count={selected.length} onClose={() => setAction(null)} onNext={(a) => (setAction(null), setReview({ ids: selected, action: a }))} />}
      {review && <ReviewDialog ids={review.ids} action={review.action} canEdit={canEdit} onClose={() => setReview(null)} onDone={() => (setReview(null), setSelected([]))} />}
      {bulk && <BulkCostDialog selected={selected} filter={filter} total={d?.total ?? 0} onClose={() => setBulk(false)} />}
      {importing && <ImportCostsDialog onClose={() => setImporting(false)} />}
      {settings && <SettingsDialog canEdit={canEdit} onClose={() => setSettings(false)} />}
    </RequirePermission>
  )
}

// ---------- Custo na linha ----------

function CostCell({ row, editable }: { row: Row; editable: boolean }) {
  const qc = useQueryClient()
  const [value, setValue] = useState(row.cost === null ? '' : String(row.cost).replace('.', ','))
  const save = useMutation({
    mutationFn: (cost: number | null) => api.put('/marketplace-precos/custos', { sku: row.costKey, cost }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['precos-anuncios'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const title = row.costSource ? `Origem: ${COST_SOURCE[row.costSource] ?? row.costSource}${row.costPercent !== null ? ` (${pct(row.costPercent)})` : ''}${row.costUpdatedAt ? ` · ${formatDateTime(row.costUpdatedAt)}` : ''}` : 'Sem custo'
  if (!editable) return <span title={title}>{brl(row.cost)}</span>
  const commit = () => {
    const v = value.trim() === '' ? null : parseNum(value)
    if (value.trim() !== '' && (v === null || v < 0)) return toast.error('Custo inválido.')
    if (v === row.cost) return
    save.mutate(v)
  }
  return (
    <div title={title}>
      <Input value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder="R$" inputMode="decimal" className="h-8 w-28 text-right tabular-nums" aria-label={`Custo do SKU ${row.sku ?? row.id}`} disabled={save.isPending} />
      {row.costSource && <span className="text-[11px] text-muted-foreground">{COST_SOURCE[row.costSource] ?? row.costSource}</span>}
    </div>
  )
}

// ---------- Ações ----------

function ActionDialog({ kind, count, onClose, onNext }: { kind: 'preco' | 'promocao'; count: number; onClose: () => void; onNext: (a: Action) => void }) {
  const [mode, setMode] = useState(kind === 'preco' ? 'valor' : 'percentual')
  const [value, setValue] = useState('')
  const [start, setStart] = useState(today())
  const [finish, setFinish] = useState(plusDays(today(), 7))
  const v = parseNum(value)
  const next = () => {
    if (mode !== 'sugerido' && v === null) return toast.error('Informe o valor.')
    if (kind === 'preco') onNext({ tipo: 'preco', modo: mode as 'valor', ...(mode === 'sugerido' ? {} : { valor: v! }) })
    else onNext({ tipo: 'promocao', modo: mode as 'preco', valor: v!, inicio: start, fim: finish })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === 'preco' ? 'Alterar preço' : 'Criar promoção (desconto individual)'}</DialogTitle>
          <DialogDescription>
            {count} anúncio(s). Na próxima tela você confere cada um antes de enviar.
            {kind === 'promocao' && ' O Mercado Livre aceita de 5% a menos de 80% de desconto, por até 14 dias, em anúncio ativo e novo, com reputação verde.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Como</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kind === 'preco' ? (
                  <>
                    <SelectItem value="valor">Preço novo (R$)</SelectItem>
                    <SelectItem value="percentual">Subir ou baixar % (ex.: 5 ou -5)</SelectItem>
                    <SelectItem value="margem">Preço para a margem de X%</SelectItem>
                    <SelectItem value="sugerido">Preço sugerido (margem alvo)</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="percentual">% de desconto</SelectItem>
                    <SelectItem value="preco">Preço promocional (R$)</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          {mode !== 'sugerido' && (
            <div className="space-y-1">
              <Label htmlFor="precos-valor">{mode === 'valor' || mode === 'preco' ? 'Valor (R$)' : mode === 'margem' ? 'Margem desejada (%)' : 'Percentual (%)'}</Label>
              <Input id="precos-valor" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus />
            </div>
          )}
          {kind === 'promocao' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="promo-ini">Início</Label>
                <Input id="promo-ini" type="date" min={today()} value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="promo-fim">Fim</Label>
                <Input id="promo-fim" type="date" min={start} max={plusDays(start, 14)} value={finish} onChange={(e) => setFinish(e.target.value)} />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">Início em data futura fica programado no próprio Mercado Livre.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={next}>Revisar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Revisão: antes → depois de cada anúncio e a margem; abaixo do mínimo exige "estou ciente". */
function ReviewDialog({ ids, action, canEdit, onClose, onDone }: { ids: string[]; action: Action; canEdit: boolean; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const [ack, setAck] = useState(false)
  const [schedule, setSchedule] = useState(false)
  const [when, setWhen] = useState('')
  const pv = useQuery({ queryKey: ['precos-previa', ids, action], queryFn: () => api.post<Preview>('/marketplace-precos/previa', { ids, acao: action }), staleTime: 0 })
  const send = useMutation({
    mutationFn: () => api.post<{ message: string }>('/marketplace-precos/enviar', { ids, acao: action, ciente: ack, ...(schedule && when ? { agendarPara: new Date(when).toISOString() } : {}) }),
    onSuccess: (r) => {
      toast.success(r.message, { duration: 8000 })
      void qc.invalidateQueries({ queryKey: ['precos-anuncios'] })
      void qc.invalidateQueries({ queryKey: ['precos-historico'] })
      onDone()
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 10000 }),
  })
  const p = pv.data
  const ok = p ? p.rows.filter((r) => !r.error && r.after).length : 0
  const title = action.tipo === 'preco' ? 'Revisar alteração de preço' : action.tipo === 'promocao' ? 'Revisar promoção' : 'Revisar encerramento da promoção'
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Confira cada anúncio. A margem usa a tarifa do Mercado Livre no preço novo, o frete atual, o imposto e o custo informados.</DialogDescription>
        </DialogHeader>
        {pv.error ? (
          <ErrorState error={pv.error} onRetry={() => void pv.refetch()} />
        ) : !p ? (
          <TableSkeleton rows={4} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Anúncio</TableHead>
                <TableHead className="text-right">Antes</TableHead>
                <TableHead className="text-right">Depois</TableHead>
                <TableHead className="text-right">Margem depois</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.rows.map((r) => (
                <TableRow key={r.itemId} className={cn(r.belowMin && 'bg-destructive/5')}>
                  <TableCell className="max-w-72">
                    <span className="line-clamp-1 font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.itemId}
                      {r.sku ? ` · ${r.sku}` : ''}
                    </span>
                    {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                    {r.warnings.map((w) => (
                      <p key={w} className="text-xs text-amber-700 dark:text-amber-500">
                        {w}
                      </p>
                    ))}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {brl(r.before.salePrice ?? r.before.price)}
                    <span className="block text-xs text-muted-foreground">{pct(r.before.marginPct)}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {r.after ? brl(r.after.price) : '—'}
                    {r.after?.start && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {r.after.start.split('-').reverse().join('/')} a {r.after.finish?.split('-').reverse().join('/')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={cn('text-right whitespace-nowrap tabular-nums', r.belowMin ? 'font-semibold text-destructive' : '')}>
                    {r.after ? (r.unknownMargin ? <span className="text-xs text-muted-foreground">sem dado</span> : `${brl(r.after.margin)} · ${pct(r.after.marginPct)}`) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {p && (
          <div className="space-y-3 text-sm">
            {p.errors > 0 && <p className="text-destructive">{p.errors} anúncio(s) com erro ficam de fora.</p>}
            {p.belowMin > 0 && (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
                <span>
                  Estou ciente: {p.belowMin} anúncio(s) ficam com margem abaixo do mínimo de {pct(p.minMarginPct)}.
                </span>
              </label>
            )}
            {action.tipo !== 'encerrar_promocao' && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <Switch checked={schedule} onCheckedChange={setSchedule} /> Agendar o envio
                </label>
                {schedule && <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-56" aria-label="Data e hora do envio" />}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          {canEdit ? (
            <Button onClick={() => send.mutate()} disabled={!p || !ok || send.isPending || (p.belowMin > 0 && !ack) || (schedule && !when)}>
              {send.isPending && <Loader2Icon className="animate-spin" />} {schedule ? `Agendar ${ok}` : `Enviar ${ok} ao Mercado Livre`}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Seu perfil só pode ver. Peça a quem tem permissão de editar para enviar.</span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Custos ----------

function BulkCostDialog({ selected, filter, total, onClose }: { selected: string[]; filter: Record<string, unknown>; total: number; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [scope, setScope] = useState(selected.length ? 'selecionados' : 'filtro')
  const [mode, setMode] = useState<'valor' | 'percentual'>('percentual')
  const [value, setValue] = useState('')
  const run = useMutation({
    mutationFn: () => api.post<{ message: string }>('/marketplace-precos/custos/massa', { selecao: scope === 'selecionados' ? { ids: selected } : scope === 'filtro' ? { filtro: filter } : { todos: true }, modo: mode, valor: parseNum(value) }),
    onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['precos-anuncios'] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const v = parseNum(value)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Custo em massa</DialogTitle>
          <DialogDescription>Grava o custo por SKU. Vale até sair a integração de custo da Tcar; o custo contábil nunca é copiado.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Para quais anúncios</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selected.length > 0 && <SelectItem value="selecionados">Os {selected.length} selecionados</SelectItem>}
                <SelectItem value="filtro">Os {total} do filtro atual</SelectItem>
                <SelectItem value="todos">Todos os anúncios</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Como</Label>
            <Select value={mode} onValueChange={(x) => setMode(x as 'valor')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentual">% sobre o preço de venda</SelectItem>
                <SelectItem value="valor">Mesmo valor (R$) para todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="custo-massa">{mode === 'valor' ? 'Custo (R$)' : 'Percentual do preço (%)'}</Label>
            <Input id="custo-massa" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={v === null || v < 0 || run.isPending}
            onClick={async () => {
              if (await confirm({ title: 'Gravar o custo?', description: 'O custo atual dos SKUs escolhidos é substituído.', confirmLabel: 'Gravar', destructive: false })) run.mutate()
            }}
          >
            {run.isPending && <Loader2Icon className="animate-spin" />} Gravar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportCostsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<{ imported: number; invalidCount: number; invalid: { line: number; reason: string }[] } | null>(null)
  const run = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('arquivo', file!)
      return api.post<{ imported: number; invalidCount: number; invalid: { line: number; reason: string }[] }>('/marketplace-precos/custos/planilha', fd)
    },
    onSuccess: (r) => (setResult(r), void qc.invalidateQueries({ queryKey: ['precos-anuncios'] })),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar custos</DialogTitle>
          <DialogDescription>Planilha Excel (.xlsx) ou CSV com as colunas SKU e custo (ex.: "sku;custo"). O cabeçalho é opcional.</DialogDescription>
        </DialogHeader>
        <Input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Planilha de custos" />
        {result && (
          <div className="space-y-1 text-sm">
            <p>{result.imported} SKU(s) com custo gravado.</p>
            {result.invalidCount > 0 && (
              <>
                <p className="text-destructive">{result.invalidCount} linha(s) com problema:</p>
                <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-xs">
                  {result.invalid.map((i) => (
                    <li key={i.line}>
                      Linha {i.line}: {i.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button disabled={!file || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Configurações e impostos ----------

/** Referência de impostos para venda a CPF (ICMS por UF + DIFAL + PIS/COFINS pelo regime): sugere a alíquota manual. */
function TaxReference({ onUse }: { onUse: (pct: number) => void }) {
  const [origin, setOrigin] = useState('SC')
  const [regime, setRegime] = useState<TaxRegime>('PRESUMIDO')
  const [dest, setDest] = useState('MEDIA')
  const [simples, setSimples] = useState('')
  const sp = parseNum(simples) ?? 0
  const est = dest === 'MEDIA' ? null : taxForSale(origin, dest, regime, sp)
  const value = est ? est.total : averageTax(origin, regime, sp)
  const ufs = Object.keys(ICMS_INTERNO).sort()
  return (
    <Card className="gap-2 p-4 text-sm">
      <p className="font-medium">Referência de impostos (venda para CPF)</p>
      <p className="text-xs text-muted-foreground">
        ICMS interno de cada estado ({ICMS_REF_DATE}, com fundo de pobreza): na venda para outro estado, interestadual (7% ou 12%) + DIFAL = alíquota do destino. PIS/COFINS pelo regime. Valores de referência: confira com a contabilidade (alguns estados têm divergência entre tabelas).
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <select aria-label="Estado de origem" className="h-9 rounded-md border bg-transparent px-2" value={origin} onChange={(e) => setOrigin(e.target.value)}>
          {ufs.map((u) => (
            <option key={u} value={u}>
              Origem {u}
            </option>
          ))}
        </select>
        <select aria-label="Regime tributário" className="h-9 rounded-md border bg-transparent px-2" value={regime} onChange={(e) => setRegime(e.target.value as TaxRegime)}>
          <option value="PRESUMIDO">Lucro Presumido</option>
          <option value="REAL">Lucro Real</option>
          <option value="SIMPLES">Simples Nacional</option>
        </select>
        <select aria-label="Destino" className="h-9 rounded-md border bg-transparent px-2" value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="MEDIA">Média do Brasil</option>
          {ufs.map((u) => (
            <option key={u} value={u}>
              Destino {u}
            </option>
          ))}
        </select>
        {regime === 'SIMPLES' && <Input aria-label="Alíquota efetiva do DAS (%)" placeholder="DAS efetivo (%)" inputMode="decimal" value={simples} onChange={(e) => setSimples(e.target.value)} />}
      </div>
      <p>
        {est && regime !== 'SIMPLES'
          ? `ICMS ${pct(est.icmsOrigin)}${est.difal ? ` + DIFAL ${pct(est.difal)}` : ''} + PIS/COFINS ${pct(est.pisCofins)} = `
          : regime === 'SIMPLES'
            ? 'Simples Nacional: a carga é a alíquota efetiva do DAS = '
            : `Média das 27 UFs (ICMS + DIFAL + PIS/COFINS ${pct(PIS_COFINS[regime as 'PRESUMIDO' | 'REAL'])}) = `}
        <strong>{pct(value)}</strong>
      </p>
      <div>
        <Button size="sm" variant="outline" onClick={() => onUse(value)}>
          Usar {pct(value)} como alíquota manual
        </Button>
      </div>
    </Card>
  )
}

const PROFIT_SOURCE: Record<string, string> = { produto_venda: '% do preço de venda informado no produto', produto: 'informado no produto', produto_pct: '% do custo informado no produto', erp: 'como o lucro líquido do ERP: preço de venda do ERP − custo − impostos' }

/** Lucro desejado do produto em R$ (o que tem que sobrar em cada venda no Mercado Livre) ou em % do custo. */
function ProfitEditor({ row: r }: { row: Row }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<'valor' | 'pct' | 'venda'>('valor')
  const save = useMutation({
    mutationFn: (clear: boolean) =>
      api.put('/marketplace-precos/lucro', { sku: r.costKey, profitValue: clear || mode !== 'valor' ? null : parseNum(value), profitPct: clear || mode !== 'pct' ? null : parseNum(value), profitSalePct: clear || mode !== 'venda' ? null : parseNum(value) }),
    onSuccess: () => {
      toast.success('Lucro do produto salvo.')
      setValue('')
      void qc.invalidateQueries({ queryKey: ['precos-anuncios'] })
      void qc.invalidateQueries({ queryKey: ['precos-anuncio', r.id] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card className="gap-2 p-3 text-sm">
      <p className="font-medium">Lucro desejado deste produto</p>
      <p className="text-muted-foreground">
        {r.profitTarget ? `${brl(r.profitTarget.value)} por unidade${r.profitTarget.pct !== undefined ? ` (${pct(r.profitTarget.pct)} do preço)` : ''} (${PROFIT_SOURCE[r.profitTarget.source]}).` : 'Não informado: o preço sugerido usa a margem alvo geral.'}
        {r.erpPrice ? ` Preço de venda no ERP: ${brl(r.erpPrice)}.` : ''}
      </p>
      {can('marketplace_precos', 'edit') && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Tipo do lucro" className="h-8 rounded-md border bg-transparent px-2" value={mode} onChange={(e) => setMode(e.target.value as 'valor' | 'pct' | 'venda')}>
            <option value="valor">R$ por unidade vendida</option>
            <option value="venda">% do preço de venda (% Lucro do ERP)</option>
            <option value="pct">% do custo</option>
          </select>
          <Input className="h-8 w-28" inputMode="decimal" placeholder={mode === 'valor' ? 'Ex.: 469,93' : 'Ex.: 50'} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button size="sm" disabled={!value.trim() || r.cost === null || save.isPending} onClick={() => save.mutate(false)}>
            Salvar
          </Button>
          {r.profitTarget && r.profitTarget.source !== 'erp' && (
            <Button size="sm" variant="ghost" onClick={() => save.mutate(true)}>
              Limpar
            </Button>
          )}
          {r.cost === null && <span className="text-xs text-muted-foreground">Informe o custo antes.</span>}
        </div>
      )}
    </Card>
  )
}

/** Memória de cálculo do preço sugerido: cada parcela e a conferência do lucro que sobra. */
function CalcMemory({ row: r }: { row: Row }) {
  const P = r.suggestedPrice
  if (P === null || r.cost === null || r.taxPct === null || r.feePct === null) return null
  const fee = Math.round(((P * r.feePct) / 100 + (r.feeFixed ?? 0)) * 100) / 100
  const tax = Math.round(((P * r.taxPct) / 100) * 100) / 100
  const extra = Math.round(((P * (r.extraPct ?? 0)) / 100) * 100) / 100
  const ship = r.margin.shipping ?? 0
  const fixed = r.fixedCost ?? 0
  const left = Math.round((P - fee - tax - extra - ship - r.cost - fixed) * 100) / 100
  const pctSum = r.feePct + r.taxPct + (r.extraPct ?? 0)
  const row = (label: string, v: string, strong = false) => (
    <div className={cn('flex justify-between gap-3 py-0.5', strong && 'font-semibold')}>
      <span>{label}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  )
  return (
    <Card className="gap-1 p-3 text-sm">
      <p className="font-medium">Memória de cálculo do preço sugerido</p>
      {row('Preço sugerido', brl(P), true)}
      {row(`− Tarifa do ML (${pct(r.feePct)}${r.feeFixed ? ` + ${brl(r.feeFixed)} fixa` : ''})`, brl(fee))}
      {row(`− Imposto (${pct(r.taxPct)} do preço)`, brl(tax))}
      {!!extra && row(`− Outras taxas (${pct(r.extraPct ?? 0)})`, brl(extra))}
      {row('− Frete', brl(ship))}
      {!!fixed && row('− Custo fixo por venda', brl(fixed))}
      {row('− Custo do produto', brl(r.cost))}
      {row('= Lucro que sobra', brl(left), true)}
      <p className="pt-1 text-xs text-muted-foreground">
        Conta: (custo + lucro + frete{fixed ? ' + custo fixo' : ''}{r.feeFixed ? ' + tarifa fixa' : ''}) ÷ (1 − {pct(pctSum)} de tarifa, imposto e taxas sobre o preço). A tarifa e o frete são os do preço atual do anúncio; o Mercado Livre pode cobrar diferente em outra faixa de preço.
      </p>
    </Card>
  )
}

function SettingsDialog({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const cfg = useQuery({ queryKey: ['precos-config'], queryFn: () => api.get<Config>('/marketplace-precos/configuracao') })
  const taxes = useQuery({ queryKey: ['precos-impostos'], queryFn: () => api.get<{ stored: number; notes: number; overall: { pct: number; notes: number } | null; skus: number; ncms: number; updatedAt: string | null }>('/marketplace-precos/impostos') })
  const [form, setForm] = useState<Record<string, string>>({})
  const [useNfe, setUseNfe] = useState(true)
  const [mode, setMode] = useState<'CUSTO' | 'CUSTO_IMPOSTO' | 'PRECO'>('CUSTO')
  useEffect(() => {
    if (!cfg.data) return
    const c = cfg.data
    const s = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))
    setForm({ taxPct: s(c.taxPct), minMarginPct: s(c.minMarginPct), targetMarginPct: s(c.targetMarginPct), fixedCostPerSale: s(c.fixedCostPerSale), extraFeePct: s(c.extraFeePct) })
    setUseNfe(c.useNfeTaxes)
    setMode(c.marginMode ?? 'CUSTO')
  }, [cfg.data])
  const save = useMutation({
    mutationFn: () =>
      api.put('/marketplace-precos/configuracao', {
        taxPct: parseNum(form.taxPct ?? ''),
        minMarginPct: parseNum(form.minMarginPct ?? '') ?? 0,
        targetMarginPct: parseNum(form.targetMarginPct ?? ''),
        fixedCostPerSale: parseNum(form.fixedCostPerSale ?? '') ?? 0,
        extraFeePct: parseNum(form.extraFeePct ?? '') ?? 0,
        useNfeTaxes: useNfe,
        marginMode: mode,
      }),
    onSuccess: () => {
      toast.success('Configurações salvas.')
      void qc.invalidateQueries({ queryKey: ['precos-config'] })
      void qc.invalidateQueries({ queryKey: ['precos-anuncios'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const recompute = useMutation({
    mutationFn: () => api.post<{ message: string }>('/marketplace-precos/impostos/recalcular'),
    onSuccess: (r) => {
      toast.success(r.message)
      void qc.invalidateQueries({ queryKey: ['precos-impostos'] })
      void qc.invalidateQueries({ queryKey: ['precos-anuncios'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const field = (key: string, label: string, hint: string) => (
    <div className="space-y-1">
      <Label htmlFor={`cfg-${key}`}>{label}</Label>
      <Input id={`cfg-${key}`} value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} inputMode="decimal" disabled={!canEdit} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
  const t = taxes.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurações da margem</DialogTitle>
          <DialogDescription>Valem para todos os anúncios desta tela.</DialogDescription>
        </DialogHeader>
        {!cfg.data ? (
          <TableSkeleton rows={3} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="cfg-mode">Como calcular a margem</Label>
              <select id="cfg-mode" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={mode} disabled={!canEdit} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="CUSTO">Margem somada ao custo do produto (custo + margem + imposto + tarifa + frete)</option>
                <option value="CUSTO_IMPOSTO">Margem sobre o custo do produto mais o imposto</option>
                <option value="PRECO">Margem ao final de todos os custos (sobre o preço de venda)</option>
              </select>
              <p className="text-xs text-muted-foreground">Vale para a margem % da lista, a margem mínima, a alvo e o preço sugerido.</p>
            </div>
            {field('minMarginPct', 'Margem mínima (%)', 'Abaixo dela a tela alerta e o envio pede "estou ciente".')}
            {field('targetMarginPct', 'Margem alvo (%)', 'Usada no preço sugerido. Vazio = não calcula.')}
            {field('fixedCostPerSale', 'Custo fixo por venda (R$)', 'Ex.: embalagem e etiqueta. Opcional.')}
            {field('extraFeePct', 'Outras taxas (%) sobre a venda', 'Ex.: devolução e antecipação. Opcional.')}
            {field('taxPct', 'Alíquota manual de imposto (%)', 'Só quando não houver notas do Mercado Envios. Vazio = não informada.')}
            <label className="flex items-center gap-2 self-start pt-6 text-sm">
              <Switch checked={useNfe} onCheckedChange={setUseNfe} disabled={!canEdit} /> Usar os impostos das notas do Mercado Envios
            </label>
          </div>
        )}
        {canEdit && <TaxReference onUse={(v) => setForm((f) => ({ ...f, taxPct: String(v).replace('.', ',') }))} />}
        <Card className="gap-2 p-4 text-sm">
          <p className="font-medium">Impostos pelas notas de venda</p>
          <p className="text-muted-foreground">
            O CRM lê as NF-e importadas em Fretes › Pedidos (Importar XML) e usa só as entregues pelo Mercado Envios: carga = ICMS, FCP, ST, DIFAL, IPI, PIS e COFINS ÷ valor dos produtos. Ordem: SKU, NCM, média geral e, por último, a alíquota manual. Reimportar um .zip antigo também ensina. Só as notas dos últimos 12 meses entram na média.
          </p>
          {t && (
            <p>
              {t.stored} nota(s) do Mercado Envios guardadas · {t.overall ? `média geral ${pct(t.overall.pct)} (${t.notes} nota(s))` : 'sem média ainda'} · {t.skus} SKU(s) e {t.ncms} NCM(s) com carga própria
              {t.updatedAt ? ` · atualizado em ${formatDateTime(t.updatedAt)}` : ''}
            </p>
          )}
          {canEdit && (
            <div>
              <Button size="sm" variant="outline" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
                {recompute.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Recalcular
              </Button>
            </div>
          )}
        </Card>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {canEdit && (
            <Button onClick={() => save.mutate()} disabled={save.isPending || !cfg.data}>
              {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Anúncio ----------

interface Rival {
  itemId: string
  title: string | null
  price: number
  permalink: string | null
  seller: string | null
  freeShipping: boolean
  source: 'CODIGO' | 'CATALOGO'
}

/** Os 2 concorrentes mais baratos: lojas cadastradas com o mesmo código e outros vendedores do mesmo produto do catálogo. */
function RivalsCard({ row, catalogProductId }: { row: Row; catalogProductId?: string | null }) {
  const list = row.competitors ?? []
  const now = row.salePrice ?? row.price
  return (
    <Card className="gap-2 px-4 py-3">
      <p className="text-sm font-medium">Preço de concorrentes (2 mais baratos)</p>
      {!list.length ? (
        <p className="text-xs text-muted-foreground">
          Nenhum concorrente encontrado. Cadastre lojas em Marketplaces › Concorrentes (compara pelo código){catalogProductId ? '' : '; este anúncio não está num produto do catálogo do Mercado Livre, então não há outros vendedores do mesmo produto'}.
        </p>
      ) : (
        list.map((c) => {
          const diff = now !== null && now > 0 ? ((c.price - now) / now) * 100 : null
          return (
            <div key={c.itemId} className="flex items-start justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0">
              <div className="min-w-0">
                <a href={c.permalink ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  {c.seller ?? c.itemId} <ExternalLinkIcon className="size-3" />
                </a>
                {c.title && <p className="line-clamp-1 text-xs text-muted-foreground">{c.title}</p>}
                <p className="text-xs text-muted-foreground">
                  {c.source === 'CATALOGO' ? 'Mesmo produto do catálogo do ML' : 'Loja concorrente, mesmo código'}
                  {c.freeShipping ? ' · frete grátis' : ''}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p className="font-medium">{brl(c.price)}</p>
                {diff !== null && <p className={cn('text-xs', diff < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400')}>{diff < 0 ? `${pct(Math.abs(Math.round(diff * 10) / 10))} abaixo do seu` : diff > 0 ? `${pct(Math.round(diff * 10) / 10)} acima do seu` : 'igual ao seu'}</p>}
              </div>
            </div>
          )
        })
      )}
    </Card>
  )
}

function ItemSheet({ id, config, onClose, onApply }: { id: string; config: Config; onClose: () => void; onApply: (ids: string[], a: Action) => void }) {
  const q = useQuery({ queryKey: ['precos-anuncio', id], queryFn: () => api.get<Row & { changes: Change[]; aiAvailable: boolean; catalogProductId?: string | null }>(`/marketplace-precos/anuncios/${id}`) })
  const ai = useMutation({ mutationFn: () => api.post<{ text: string }>(`/marketplace-precos/anuncios/${id}/dica-ia`), onError: (e) => toast.error(errorMessage(e), { duration: 8000 }) })
  const r = q.data
  const line = (k: string, v: string, hint?: string) => (
    <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right tabular-nums" title={hint}>
        {v}
      </span>
    </div>
  )
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6">{r?.title ?? id}</SheetTitle>
          <SheetDescription>
            {id}
            {r?.sku ? ` · SKU ${r.sku}` : ''}
            {r ? ` · ${r.listingType}${r.full ? ' · Full' : ''}` : ''}
          </SheetDescription>
        </SheetHeader>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !r ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            {r.permalink && (
              <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Ver no Mercado Livre <ExternalLinkIcon className="size-3.5" />
              </a>
            )}
            <Card className="gap-0 px-4 py-2">
              {line('Preço cheio', brl(r.price))}
              {r.promo && line('Preço em promoção', `${brl(r.promo.price)}${r.promo.type ? ` (${r.promo.type})` : ''}`)}
              {line('Tarifa do Mercado Livre', `${brl(r.margin.fee)} (${pct(r.feePct)})`)}
              {line('Frete', r.margin.shipping === null ? 'não calculado' : brl(r.margin.shipping), r.shippingNote ?? undefined)}
              {line('Imposto', `${brl(r.margin.tax)} (${pct(r.taxPct)}, ${r.taxLabel})`)}
              {line('Outras taxas', brl(r.margin.extra))}
              {line('Custo fixo por venda', brl(r.margin.fixedCost))}
              {line('Custo', `${brl(r.cost)}${r.costSource ? ` · ${COST_SOURCE[r.costSource] ?? r.costSource}` : ''}`)}
              {line('Margem', r.margin.margin === null ? 'sem dado' : `${brl(r.margin.margin)} (${pct(r.margin.marginPct)})`)}
              {line('Preço mínimo (margem zero)', brl(r.minPrice))}
              {line(
                r.profitTarget ? `Preço sugerido (lucro de ${brl(r.profitTarget.value)})` : `Preço sugerido${config.targetMarginPct !== null ? ` (${pct(config.targetMarginPct)})` : ''}`,
                brl(r.suggestedPrice),
              )}
              {line('Concorrente mais barato', brl(r.competitorMin))}
              {line('Vendas em 30 / 60 dias', r.sales30 === null ? 'não lidas' : `${r.sales30} / ${r.sales60}`)}
              {line('Lido em', formatDateTime(r.syncedAt))}
            </Card>
            {r.readError && <p className="text-xs text-destructive">{r.readError}</p>}
            <RivalsCard row={r} catalogProductId={r.catalogProductId} />
            <ProfitEditor row={r} />
            <CalcMemory row={r} />
            <div className="flex flex-wrap gap-2">
              {r.suggestedPrice !== null && (
                <Button size="sm" onClick={() => onApply([r.id], config.targetMarginPct !== null && !r.profitTarget ? { tipo: 'preco', modo: 'sugerido' } : { tipo: 'preco', modo: 'valor', valor: r.suggestedPrice! })}>
                  <PercentIcon /> Aplicar preço sugerido ({brl(r.suggestedPrice)})
                </Button>
              )}
              {r.aiAvailable && (
                <Button size="sm" variant="outline" onClick={() => ai.mutate()} disabled={ai.isPending}>
                  {ai.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Dica da IA
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Como melhorar</p>
              {r.tips.length ? (
                r.tips.map((t) => (
                  <p key={t.code} className="flex gap-2 text-sm">
                    <TipIcon tip={t} />
                    <span>{t.text}</span>
                  </p>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Sem pontos de atenção.</p>
              )}
              {ai.data && <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-line">{ai.data.text}</p>}
            </div>
            {r.changes.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Últimas alterações</p>
                {r.changes.map((c) => (
                  <p key={c.id} className="text-xs text-muted-foreground">
                    {formatDateTime(c.createdAt)} · {KIND[c.kind] ?? c.kind} · {STATUS[c.status] ?? c.status} · {c.createdByName ?? ''}
                    {c.error ? ` · ${c.error}` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ---------- Histórico ----------

function HistoryTab() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const [kind, setKind] = useState('todos')
  const [status, setStatus] = useState('todos')
  const params = new URLSearchParams({ ...(kind !== 'todos' ? { tipo: kind } : {}), ...(status !== 'todos' ? { status } : {}) })
  const q = useQuery({ queryKey: ['precos-historico', params.toString()], queryFn: () => api.get<{ total: number; rows: Change[] }>(`/marketplace-precos/historico?${params}`), refetchInterval: 5000 })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['precos-historico'] })
    void qc.invalidateQueries({ queryKey: ['precos-anuncios'] })
  }
  const undo = useMutation({ mutationFn: (id: string) => api.post<{ message: string }>(`/marketplace-precos/alteracoes/${id}/desfazer`), onSuccess: (r) => (toast.success(r.message), refresh()), onError: (e) => toast.error(errorMessage(e), { duration: 10000 }) })
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/marketplace-precos/alteracoes/${id}/cancelar`), onSuccess: () => (toast.success('Cancelado.'), refresh()), onError: (e) => toast.error(errorMessage(e)) })
  const value = (c: Change, side: 'before' | 'after') => {
    const v = c[side] as Record<string, unknown> | null
    if (!v) return '—'
    if (c.kind === 'cupom') return side === 'after' ? `${String(v.name ?? '')} ${v.coupon_code ? `(${String(v.coupon_code)})` : ''}` : '—'
    const p = typeof v.price === 'number' ? v.price : null
    return p === null ? '—' : `${brl(p)}${v.start ? ` · ${String(v.start).split('-').reverse().join('/')} a ${String(v.finish ?? '').split('-').reverse().join('/')}` : ''}`
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-48" aria-label="Tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {Object.entries(KIND).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as situações</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <TableSkeleton rows={4} />
      ) : !q.data.rows.length ? (
        <EmptyState icon={RotateCcwIcon} title="Nada no histórico" description="As alterações enviadas ou agendadas aparecem aqui, com o botão para desfazer." />
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Quando</TableHead>
                <TableHead>Anúncio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Antes</TableHead>
                <TableHead className="text-right">Depois</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4 text-xs whitespace-nowrap">
                    {formatDateTime(c.createdAt)}
                    <span className="block text-muted-foreground">{c.createdByName ?? ''}</span>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <span className="line-clamp-1">{c.itemTitle ?? c.mlRef ?? '—'}</span>
                    <span className="text-xs text-muted-foreground">{c.itemId ?? c.mlRef ?? ''}</span>
                    {c.error && <p className="text-xs text-destructive">{c.error}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{KIND[c.kind] ?? c.kind}</TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap tabular-nums">{value(c, 'before')}</TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap tabular-nums">
                    {value(c, 'after')}
                    {c.marginPctAfter !== null && <span className="block text-xs text-muted-foreground">margem {pct(Number(c.marginPctAfter))}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'ERRO' ? 'destructive' : c.status === 'ENVIADA' ? 'default' : 'secondary'}>{STATUS[c.status] ?? c.status}</Badge>
                    {c.scheduledAt && c.status === 'AGENDADA' && <span className="block text-xs text-muted-foreground">{formatDateTime(c.scheduledAt)}</span>}
                  </TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    {can('marketplace_precos', 'edit') && c.status === 'ENVIADA' && ['preco', 'promocao', 'cupom'].includes(c.kind) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={undo.isPending}
                        onClick={async () => {
                          if (await confirm({ title: 'Desfazer?', description: c.kind === 'preco' ? 'O preço anterior volta no Mercado Livre.' : c.kind === 'promocao' ? 'A promoção é encerrada no Mercado Livre.' : 'O cupom é excluído no Mercado Livre.', confirmLabel: 'Desfazer' })) undo.mutate(c.id)
                        }}
                      >
                        <RotateCcwIcon /> Desfazer
                      </Button>
                    )}
                    {can('marketplace_precos', 'edit') && ['AGENDADA', 'PENDENTE'].includes(c.status) && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(c.id)} disabled={cancel.isPending}>
                        <XIcon /> Cancelar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

// ---------- Cupons ----------

interface MlCoupon {
  id: string
  name?: string
  status?: string
  sub_type?: string
  fixed_amount?: number
  fixed_percentage?: number
  min_purchase_amount?: number
  max_purchase_amount?: number
  start_date?: string
  finish_date?: string
  coupon_code?: string
  budget?: number
  remaining_budget?: number
  used_coupons?: number
  createdBy: string | null
}
const COUPON_STATUS: Record<string, string> = { pending: 'Programado', started: 'Ativo', finished: 'Finalizado', deleted: 'Excluído' }

function CouponsTab({ selected, onPick }: { selected: string[]; onPick: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()
  const canEdit = can('marketplace_precos', 'edit')
  const [creating, setCreating] = useState(false)
  const q = useQuery({ queryKey: ['precos-cupons'], queryFn: () => api.get<{ coupons: MlCoupon[] }>('/marketplace-precos/cupons') })
  const end = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/marketplace-precos/cupons/${id}/encerrar`),
    onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['precos-cupons'] })),
    onError: (e) => toast.error(errorMessage(e), { duration: 10000 }),
  })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-muted-foreground">Cupom do vendedor (só Mercado Livre Brasil): desconto em valor ou %, sobre o total da compra dos anúncios do cupom, um uso por comprador, até 31 dias. O orçamento é da loja.</p>
        <Can module="marketplace_precos" action="edit">
          <Button onClick={() => setCreating(true)} disabled={!selected.length}>
            <TicketIcon /> Criar cupom {selected.length ? `(${selected.length} anúncio(s))` : ''}
          </Button>
        </Can>
      </div>
      {!selected.length && canEdit && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Para criar, marque os anúncios na aba Anúncios (a caixa à esquerda de cada um) e volte aqui.
          <Button size="sm" variant="outline" onClick={onPick}>
            Escolher anúncios
          </Button>
        </p>
      )}
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <TableSkeleton rows={3} />
      ) : !q.data.coupons.length ? (
        <EmptyState icon={TicketIcon} title="Nenhum cupom na conta" description="Os cupons do vendedor criados aqui ou no Mercado Livre aparecem nesta lista." />
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Cupom</TableHead>
                <TableHead>Desconto</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Orçamento</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.coupons.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <span className="font-medium">{c.name ?? c.id}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.id}
                      {c.coupon_code ? ` · código ${c.coupon_code}` : ' · sem código (todos os compradores)'}
                      {c.createdBy ? ` · criado por ${c.createdBy}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.sub_type === 'FIXED_PERCENTAGE' ? `${pct(c.fixed_percentage)} (até ${brl(c.max_purchase_amount)})` : brl(c.fixed_amount)}
                    <span className="block text-xs text-muted-foreground">compra mínima {brl(c.min_purchase_amount)}</span>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {c.start_date ? formatDateTime(c.start_date) : '—'} a {c.finish_date ? formatDateTime(c.finish_date) : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {brl(c.remaining_budget)} de {brl(c.budget)}
                    <span className="block text-xs text-muted-foreground">{c.used_coupons ?? 0} uso(s)</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{COUPON_STATUS[c.status ?? ''] ?? c.status ?? '—'}</Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {canEdit && (c.status === 'pending' || c.status === 'started') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={end.isPending}
                        onClick={async () => {
                          if (await confirm({ title: 'Excluir este cupom no Mercado Livre?', description: 'O cupom deixa de valer para os compradores.', confirmLabel: 'Excluir cupom' })) end.mutate(c.id)
                        }}
                      >
                        <XIcon /> Encerrar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {creating && <CouponDialog ids={selected} onClose={() => setCreating(false)} />}
    </div>
  )
}

function CouponDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', subType: 'FIXED_PERCENTAGE' as CouponForm['subType'], fixed: '', min: '', max: '', budget: '', start: plusDays(today(), 1), finish: plusDays(today(), 8), code: '' })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [ack, setAck] = useState(false)
  const coupon = (): CouponForm => ({
    name: f.name.trim(),
    subType: f.subType,
    fixedAmount: f.subType === 'FIXED_AMOUNT' ? parseNum(f.fixed) : null,
    fixedPercentage: f.subType === 'FIXED_PERCENTAGE' ? parseNum(f.fixed) : null,
    minPurchaseAmount: parseNum(f.min) ?? 0,
    maxPurchaseAmount: f.subType === 'FIXED_PERCENTAGE' ? parseNum(f.max) : null,
    budget: parseNum(f.budget) ?? 0,
    start: f.start,
    finish: f.finish,
    code: f.code.trim() ? f.code.trim().toUpperCase() : null,
  })
  const review = useMutation({ mutationFn: () => api.post<Preview>('/marketplace-precos/cupons/previa', { cupom: coupon(), ids }), onSuccess: setPreview, onError: (e) => toast.error(errorMessage(e), { duration: 8000 }) })
  const create = useMutation({
    mutationFn: () => api.post<{ message: string }>('/marketplace-precos/cupons', { cupom: coupon(), ids, ciente: ack }),
    onSuccess: (r) => {
      toast.success(r.message, { duration: 10000 })
      void qc.invalidateQueries({ queryKey: ['precos-cupons'] })
      void qc.invalidateQueries({ queryKey: ['precos-historico'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 10000 }),
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => (setF({ ...f, [k]: e.target.value }), setPreview(null))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Criar cupom do vendedor</DialogTitle>
          <DialogDescription>{ids.length} anúncio(s). O desconto vale sobre o total da compra desses anúncios; cada comprador usa uma vez.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cp-nome">Nome (só a loja vê)</Label>
            <Input id="cp-nome" value={f.name} onChange={set('name')} maxLength={60} />
          </div>
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={f.subType} onValueChange={(v) => (setF({ ...f, subType: v as CouponForm['subType'] }), setPreview(null))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXED_PERCENTAGE">Percentual (%)</SelectItem>
                <SelectItem value="FIXED_AMOUNT">Valor fixo (R$)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-desc">{f.subType === 'FIXED_PERCENTAGE' ? 'Desconto (%), de 5 a 80' : 'Desconto (R$)'}</Label>
            <Input id="cp-desc" value={f.fixed} onChange={set('fixed')} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-min">Compra mínima (R$)</Label>
            <Input id="cp-min" value={f.min} onChange={set('min')} inputMode="decimal" />
          </div>
          {f.subType === 'FIXED_PERCENTAGE' && (
            <div className="space-y-1">
              <Label htmlFor="cp-max">Desconto máximo por compra (R$)</Label>
              <Input id="cp-max" value={f.max} onChange={set('max')} inputMode="decimal" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="cp-orc">Orçamento total (R$)</Label>
            <Input id="cp-orc" value={f.budget} onChange={set('budget')} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-ini">Início</Label>
            <Input id="cp-ini" type="date" min={today()} value={f.start} onChange={set('start')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-fim">Fim (até 31 dias)</Label>
            <Input id="cp-fim" type="date" min={f.start} max={plusDays(f.start, 31)} value={f.finish} onChange={set('finish')} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="cp-cod">Código (opcional, até 10 letras ou números)</Label>
            <Input id="cp-cod" value={f.code} onChange={set('code')} maxLength={10} />
            <p className="text-xs text-muted-foreground">Com código, só quem tiver o código usa (o Mercado Livre junta as 5 primeiras letras do apelido da loja). Sem código, o Mercado Livre mostra o cupom para todos nos anúncios.</p>
          </div>
        </div>
        {preview && (
          <div className="space-y-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anúncio</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-right">Com o cupom (1 un.)</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.itemId} className={cn(r.belowMin && 'bg-destructive/5')}>
                    <TableCell className="max-w-64">
                      <span className="line-clamp-1">{r.title}</span>
                      {r.error && <span className="text-xs text-muted-foreground">{r.error}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brl(r.before.price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.after ? brl(r.after.price) : '—'}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', r.belowMin && 'font-semibold text-destructive')}>{r.after ? (r.unknownMargin ? 'sem dado' : `${brl(r.after.margin)} · ${pct(r.after.marginPct)}`) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {preview.belowMin > 0 && (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
                <span>
                  Estou ciente: {preview.belowMin} anúncio(s) ficam com margem abaixo do mínimo de {pct(preview.minMarginPct)} com o cupom.
                </span>
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {!preview ? (
            <Button onClick={() => review.mutate()} disabled={review.isPending || !f.name.trim()}>
              {review.isPending && <Loader2Icon className="animate-spin" />} Revisar
            </Button>
          ) : (
            <Button onClick={() => create.mutate()} disabled={create.isPending || (preview.belowMin > 0 && !ack)}>
              {create.isPending && <Loader2Icon className="animate-spin" />} Criar cupom no Mercado Livre
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
