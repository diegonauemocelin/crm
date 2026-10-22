import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, Loader2Icon, PlugIcon, RefreshCwIcon, ShoppingBagIcon, StoreIcon, UnplugIcon } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { CopyField } from '@/components/copy-field'
import { type Col, SimpleTable } from '@/components/marketing/tabela'
import { DeltaTag, Kpi, MktFilters, TrendChart } from '@/components/marketing/ui'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dayBr, money, moneyShort, num, pct, times, useMktFilters } from '@/lib/marketing'
import { cn } from '@/lib/utils'

// ---------- Tipos ----------

interface Indicators {
  impressions: number
  clicks: number
  cost: number
  revenue: number
  directRevenue: number
  indirectRevenue: number
  units: number
  items: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  roas: number | null
  acos: number | null
  cvr: number | null
}
type Kpis = Indicators & { before: Indicators; delta: Partial<Record<'cost' | 'revenue' | 'clicks' | 'impressions' | 'roas' | 'acos' | 'items' | 'cpc', number | null>> }
interface SyncState {
  lastRunAt?: string
  lastOkAt?: string
  lastError?: string | null
  running?: boolean
}
interface MlConfigView {
  clientId: string
  hasSecret: boolean
  connected: boolean
  status: 'DESCONECTADO' | 'CONECTADO' | 'ERRO'
  nickname: string | null
  userId: string | null
  advertiserId: string | null
  siteId: string | null
  advertiserName: string | null
  displayAdvertiserId: string | null
  displayStatus: 'ATIVO' | 'NAO_HABILITADO' | null
  connectedAt: string | null
  connectedBy: string | null
  lastError: string | null
  redirectUri: string
}
interface CampaignRow extends Indicators {
  id: string
  name: string
  status: string | null
  strategy: string | null
  budget: number | null
  roasTarget: number | null
  acosTarget: number | null
  startDate: string | null
  endDate: string | null
}
interface AdRow extends Indicators {
  id: string
  title: string
  thumbnail: string | null
  externalId: string | null
  status: string | null
  campaign: string | null
}
interface MlPanel {
  period: { from: string; to: string; prevFrom: string; prevTo: string }
  config: MlConfigView
  sync: SyncState
  coverage: { from: string | null; to: string | null; rows: number }
  totals: { all: Kpis; pads: Kpis; display: Kpis }
  granularity: 'dia' | 'mes'
  series: { label: string; padsCost: number; displayCost: number; revenue: number; clicks: number }[]
  campaigns: CampaignRow[]
  display: CampaignRow[]
  ads: AdRow[]
}
interface Overview {
  period: { from: string; to: string; prevFrom: string; prevTo: string }
  mercadoLivre: Indicators & { connected: boolean; status: string; nickname: string | null; sync: SyncState; before: Indicators; delta: Partial<Record<'cost' | 'revenue' | 'roas' | 'acos', number | null>> }
  channels: { name: string; marketplace: boolean; orders: number; revenue: number; ticket: number | null; share: number | null; delta: number | null }[]
}

const STATUS_LABEL: Record<string, string> = { active: 'Ativa', paused: 'Pausada', ACTIVE: 'Ativa', PAUSED: 'Pausada', idle: 'Parada', hold: 'Em espera', finished: 'Encerrada', FINISHED: 'Encerrada' }
const statusText = (s: string | null) => (s ? (STATUS_LABEL[s] ?? s) : '—')

/** Uma linha dizendo de quando são os dados e se a última sincronização falhou. */
function SyncInfo({ sync, coverage }: { sync: SyncState; coverage?: MlPanel['coverage'] }) {
  return (
    <p className={cn('text-xs', sync.lastError ? 'text-red-600' : 'text-muted-foreground')}>
      {coverage ? (coverage.from ? `Dados de ${dayBr(coverage.from)} a ${dayBr(coverage.to!)} · ` : 'Ainda sem dados · ') : ''}Mercado Livre{' '}
      {sync.running ? 'sincronizando agora' : sync.lastOkAt ? `sincronizado em ${formatDateTime(sync.lastOkAt)}` : 'ainda não sincronizado pelo CRM'}
      {sync.lastError ? ` · última tentativa falhou: ${sync.lastError}` : ''}
    </p>
  )
}

// ---------- Visão geral ----------

export function MarketplacesVisaoPage() {
  return (
    <RequirePermission module="marketplaces">
      <Visao />
    </RequirePermission>
  )
}

function Visao() {
  const f = useMktFilters()
  const q = useQuery({ queryKey: ['mktp-visao', f.from, f.to], queryFn: () => api.get<Overview>(`/marketplaces/visao-geral?de=${f.from}&ate=${f.to}`), placeholderData: keepPreviousData })
  const d = q.data
  const ml = d?.mercadoLivre
  const cols: Col<Overview['channels'][number]>[] = [
    { label: 'Canal', value: (r) => <span className="flex items-center gap-2">{r.name}{r.marketplace && <Badge variant="secondary">Marketplace</Badge>}</span>, csv: (r) => r.name },
    { label: 'Vendas', value: (r) => num(r.orders), right: true, csv: (r) => r.orders },
    { label: 'Faturamento', value: (r) => money(r.revenue), right: true, csv: (r) => r.revenue },
    { label: 'Ticket médio', value: (r) => money(r.ticket), right: true, csv: (r) => r.ticket },
    { label: 'Participação', value: (r) => pct(r.share), right: true, csv: (r) => r.share },
    { label: 'Variação', value: (r) => <DeltaTag value={r.delta} />, right: true, csv: (r) => r.delta },
  ]
  return (
    <div>
      <PageHeader title="Marketplaces" description="Publicidade e vendas nos marketplaces. Hoje: Mercado Livre. A Shopee entra aqui na próxima etapa." />
      <div className="space-y-4">
        <MktFilters show="period" />
        {q.isLoading && <TableSkeleton rows={4} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && ml && (
          <>
            <div className="grid gap-3 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShoppingBagIcon className="size-4" /> Mercado Livre Ads
                      <Badge variant={ml.connected ? 'default' : 'secondary'}>{ml.connected ? `Conectado${ml.nickname ? `: ${ml.nickname}` : ''}` : ml.cost || ml.revenue ? 'Dados anteriores' : 'Não conectado'}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {dayBr(d.period.from)} a {dayBr(d.period.to)}, comparado com {dayBr(d.period.prevFrom)} a {dayBr(d.period.prevTo)}. Receita atribuída pelo Mercado Livre (até 14 dias depois do clique).
                    </CardDescription>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/marketplaces/mercado-livre?de=${f.from}&ate=${f.to}`}>Abrir painel</Link>
                  </Button>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Mini label="Investimento" value={money(ml.cost)} delta={ml.delta.cost} lowerIsBetter />
                  <Mini label="Receita atribuída" value={money(ml.revenue)} delta={ml.delta.revenue} />
                  <Mini label="ROAS" value={times(ml.roas)} delta={ml.delta.roas} />
                  <Mini label="ACOS" value={pct(ml.acos)} delta={ml.delta.acos} lowerIsBetter />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <StoreIcon className="size-4" /> Shopee <Badge variant="secondary">Em breve</Badge>
                  </CardTitle>
                  <CardDescription>Investimento, vendas e anúncios da Shopee vão aparecer aqui, no mesmo formato do Mercado Livre.</CardDescription>
                </CardHeader>
              </Card>
            </div>
            <SimpleTable
              title="Vendas por canal (loja virtual Magazord)"
              description="Pedidos pagos no período, pelo canal que a Magazord informa. Marketplaces marcados. Vendas do Mercado Livre feitas fora da Magazord não aparecem aqui."
              rows={d.channels}
              cols={cols}
              rowKey={(r) => r.name}
              exportName={`vendas-por-canal-${f.from}-${f.to}`}
              exportModule="marketplaces"
              empty="Sem pedidos da Magazord no período (ou a integração com a Magazord não está ligada)."
            />
          </>
        )}
      </div>
    </div>
  )
}

function Mini({ label, value, delta, lowerIsBetter }: { label: string; value: string; delta?: number | null; lowerIsBetter?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight">{value}</p>
      {delta !== undefined && <DeltaTag value={delta} lowerIsBetter={lowerIsBetter} />}
    </div>
  )
}

// ---------- Painel do Mercado Livre Ads ----------

export function MercadoLivreAdsPage() {
  return (
    <RequirePermission module="marketplaces">
      <MercadoLivre />
    </RequirePermission>
  )
}

const ALL = '__todas'

function MercadoLivre() {
  const f = useMktFilters()
  const [params, setParams] = useSearchParams()
  const campaign = params.get('campanha') ?? ''
  const { can } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['mktp-ml', f.from, f.to, campaign],
    queryFn: () => api.get<MlPanel>(`/marketplaces/mercado-livre?de=${f.from}&ate=${f.to}${campaign ? `&campanha=${campaign}` : ''}`),
    placeholderData: keepPreviousData,
  })
  const sync = useMutation({
    mutationFn: () => api.post<{ message: string }>('/marketplaces/mercado-livre/sincronizar'),
    onSuccess: (r) => {
      toast.success(r.message)
      void qc.invalidateQueries({ queryKey: ['mktp-ml'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = q.data
  const t = d?.totals.all
  const setCampaign = (v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v === ALL) next.delete('campanha')
        else next.set('campanha', v)
        return next
      },
      { replace: true },
    )
  return (
    <div>
      <PageHeader
        title="Mercado Livre Ads"
        description="Product Ads e Display Ads: investimento, receita atribuída, ROAS, ACOS, campanhas e anúncios. Só leitura: o CRM não altera nada na conta do Mercado Livre."
        actions={
          can('marketplaces', 'edit') && (
            <>
              {d?.config.connected && (
                <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending || d.sync.running}>
                  {sync.isPending || d.sync.running ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Sincronizar agora
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <Link to="/configuracoes?secao=marketplaces-conexoes">
                  <PlugIcon /> Conexão
                </Link>
              </Button>
            </>
          )
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-2">
          <MktFilters show="period" />
          {d && d.campaigns.length > 0 && (
            <Select value={campaign || ALL} onValueChange={setCampaign}>
              <SelectTrigger size="sm" className="w-64" aria-label="Campanha">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as campanhas</SelectItem>
                {d.campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && t && (
          <>
            <SyncInfo sync={d.sync} coverage={d.coverage} />
            {!d.config.connected && d.coverage.rows === 0 && (
              <EmptyState
                icon={ShoppingBagIcon}
                title="Mercado Livre ainda não conectado"
                description="Conecte a conta do Mercado Livre para ver investimento, vendas atribuídas, campanhas e anúncios."
                action={
                  can('marketplaces', 'edit') && (
                    <Button asChild size="sm">
                      <Link to="/configuracoes?secao=marketplaces-conexoes">Conectar o Mercado Livre</Link>
                    </Button>
                  )
                }
              />
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Kpi label="Investimento" value={money(t.cost)} delta={t.delta.cost} lowerIsBetter before={money(t.before.cost)} hint={`Product Ads ${moneyShort(d.totals.pads.cost)} · Display ${moneyShort(d.totals.display.cost)}`} />
              <Kpi label="Receita atribuída" value={money(t.revenue)} delta={t.delta.revenue} before={money(t.before.revenue)} hint={`Direta ${moneyShort(t.directRevenue)} · indireta ${moneyShort(t.indirectRevenue)}`} />
              <Kpi label="ROAS" value={times(t.roas)} delta={t.delta.roas} hint="Receita ÷ investimento (não é lucro)" />
              <Kpi label="ACOS" value={pct(t.acos)} delta={t.delta.acos} lowerIsBetter hint="Investimento ÷ receita" />
              <Kpi label="Cliques" value={num(t.clicks)} delta={t.delta.clicks} hint={`CTR ${pct(t.ctr)} · CPC ${money(t.cpc)}`} />
              <Kpi label="Vendas pelos anúncios" value={num(t.items)} delta={t.delta.items} hint={`${num(t.units)} unidades · conversão ${pct(t.cvr)}`} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <TrendChart
                title={`Investimento por ${d.granularity === 'mes' ? 'mês' : 'dia'}`}
                data={d.series}
                kind="bar"
                format={moneyShort}
                series={[
                  { key: 'padsCost', label: 'Product Ads', color: 'var(--chart-1)' },
                  { key: 'displayCost', label: 'Display', color: 'var(--chart-2)' },
                ]}
              />
              <TrendChart title={`Receita atribuída por ${d.granularity === 'mes' ? 'mês' : 'dia'}`} data={d.series} format={moneyShort} series={[{ key: 'revenue', label: 'Receita atribuída', color: 'var(--chart-3)' }]} />
            </div>
            <Tabs defaultValue="campanhas">
              <TabsList className="flex-wrap">
                <TabsTrigger value="campanhas">Campanhas Product Ads ({d.campaigns.length})</TabsTrigger>
                <TabsTrigger value="anuncios">Anúncios ({d.ads.length})</TabsTrigger>
                <TabsTrigger value="display">Display Ads ({d.display.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="campanhas">
                <SimpleTable title="Campanhas de Product Ads" rows={d.campaigns} cols={campaignCols(true)} rowKey={(r) => r.id} exportName={`ml-campanhas-${f.from}-${f.to}`} exportModule="marketplaces" />
              </TabsContent>
              <TabsContent value="anuncios">
                <SimpleTable
                  title="Anúncios (grupos de anúncios)"
                  description="Os 200 anúncios com mais investimento no período. No Mercado Livre, cada grupo é um item, uma família ou um produto de catálogo."
                  rows={d.ads}
                  cols={adCols}
                  rowKey={(r) => r.id}
                  exportName={`ml-anuncios-${f.from}-${f.to}`}
                  exportModule="marketplaces"
                />
              </TabsContent>
              <TabsContent value="display">
                {d.config.displayStatus === 'NAO_HABILITADO' && d.display.length === 0 ? (
                  <EmptyState title="Display Ads não habilitado" description="Esta conta não tem o Display Ads do Mercado Livre (é liberado pelo assessor comercial do Mercado Livre). O investimento de Display fica zerado." />
                ) : (
                  <SimpleTable title="Campanhas de Display Ads" description="Vendas pelo ponto de contato (padrão do Mercado Livre)." rows={d.display} cols={campaignCols(false)} rowKey={(r) => r.id} exportName={`ml-display-${f.from}-${f.to}`} exportModule="marketplaces" />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  )
}

function campaignCols(pads: boolean): Col<CampaignRow>[] {
  return [
    {
      label: 'Campanha',
      value: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium" title={r.name}>
            {r.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {statusText(r.status)}
            {r.strategy ? ` · ${r.strategy}` : ''}
            {pads && r.roasTarget ? ` · ROAS alvo ${times(r.roasTarget)}` : ''}
            {!pads && r.startDate ? ` · ${dayBr(r.startDate)}${r.endDate ? ` a ${dayBr(r.endDate)}` : ''}` : ''}
          </p>
        </div>
      ),
      csv: (r) => r.name,
    },
    ...(pads ? [{ label: 'Orçamento', value: (r: CampaignRow) => money(r.budget), right: true, csv: (r: CampaignRow) => r.budget }] : []),
    ...metricCols<CampaignRow>(),
  ]
}

function metricCols<T extends Indicators>(): Col<T>[] {
  return [
    { label: 'Investido', value: (r) => money(r.cost), right: true, csv: (r) => r.cost },
    { label: 'Impressões', value: (r) => num(r.impressions), right: true, csv: (r) => r.impressions },
    { label: 'Cliques', value: (r) => num(r.clicks), right: true, csv: (r) => r.clicks },
    { label: 'CPC', value: (r) => money(r.cpc), right: true, csv: (r) => r.cpc },
    { label: 'Vendas', value: (r) => num(r.items), right: true, csv: (r) => r.items },
    { label: 'Receita', value: (r) => money(r.revenue), right: true, csv: (r) => r.revenue },
    { label: 'ROAS', value: (r) => times(r.roas), right: true, csv: (r) => r.roas },
    { label: 'ACOS', value: (r) => pct(r.acos), right: true, csv: (r) => r.acos },
  ]
}

const adCols: Col<AdRow>[] = [
  {
    label: 'Anúncio',
    value: (r) => (
      <div className="flex min-w-0 items-center gap-3">
        {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" className="size-10 shrink-0 rounded-md object-cover" /> : <div className="size-10 shrink-0 rounded-md bg-muted" aria-hidden />}
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium" title={r.title}>
            {r.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {r.externalId ?? r.id}
            {r.campaign ? ` · ${r.campaign}` : ''}
          </p>
        </div>
      </div>
    ),
    csv: (r) => `${r.title} (${r.externalId ?? r.id})`,
  },
  ...metricCols<AdRow>(),
]

// ---------- Volta da autorização do Mercado Livre ----------

export function MlRetornoPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const done = useRef(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const code = params.get('code')
    const state = params.get('state')
    if (!code || !state) {
      setError(params.get('error_description') ?? params.get('error') ?? 'O Mercado Livre não devolveu a autorização. Tente conectar de novo.')
      return
    }
    api
      .post<{ nickname: string | null }>('/marketplaces/mercado-livre/retorno', { code, state })
      .then((r) => {
        toast.success(`Mercado Livre conectado${r.nickname ? `: ${r.nickname}` : ''}.`)
        navigate('/configuracoes?secao=marketplaces-conexoes', { replace: true })
      })
      .catch((err: unknown) => setError(errorMessage(err)))
  }, [params, navigate])
  return (
    <div>
      <PageHeader title="Conectando o Mercado Livre" />
      {error ? (
        <EmptyState
          icon={UnplugIcon}
          title="Não foi possível conectar"
          description={error}
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/configuracoes?secao=marketplaces-conexoes">Voltar para a conexão</Link>
            </Button>
          }
        />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Concluindo a autorização...
        </p>
      )}
    </div>
  )
}

// ---------- Conexões ----------

/** Endereço antigo: as conexões ficam em Configurações › Marketplaces. */
export function MarketplacesIntegracoesPage() {
  return <Navigate to="/configuracoes?secao=marketplaces-conexoes" replace />
}

/** Configurações › Marketplaces › Conexões (Mercado Livre e histórico do BI). */
export function MarketplacesConexoes() {
  return <Integracoes />
}

type ConfigResponse = MlConfigView & { sync: SyncState }

function Integracoes() {
  const { can } = useAuth()
  const edit = can('marketplaces', 'edit')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['mktp-ml-config'], queryFn: () => api.get<ConfigResponse>('/marketplaces/mercado-livre/config') })
  const c = q.data
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  useEffect(() => {
    if (c) setClientId(c.clientId)
  }, [c])
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['mktp-ml-config'] })
    void qc.invalidateQueries({ queryKey: ['mktp-ml'] })
    void qc.invalidateQueries({ queryKey: ['mktp-visao'] })
  }
  const run = <T,>(fn: () => Promise<T>, ok?: (r: T) => string | null) =>
    fn()
      .then((r) => {
        const m = ok?.(r)
        if (m) toast.success(m)
        refresh()
        return r
      })
      .catch((err: unknown) => {
        toast.error(errorMessage(err))
        return null
      })
  const [saving, setSaving] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const r = await run(() => api.put('/marketplaces/mercado-livre/credenciais', { clientId, clientSecret: secret || undefined }), () => 'Credenciais salvas.')
    if (r) setSecret('')
    setSaving(false)
  }
  const connect = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>('/marketplaces/mercado-livre/conectar').then((r) => {
        window.location.assign(r.url)
      }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const advertisers = useQuery({ queryKey: ['mktp-ml-anunciantes'], queryFn: () => api.get<{ advertiserId: string; name: string; siteId: string }[]>('/marketplaces/mercado-livre/anunciantes'), enabled: !!c?.connected && edit, retry: false })
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    await fn()
    setBusy(null)
  }
  if (q.isLoading) return <TableSkeleton rows={5} />
  if (q.error || !c) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const badge = c.connected ? (c.status === 'ERRO' ? <Badge variant="destructive">Precisa reconectar</Badge> : <Badge>Conectado</Badge>) : <Badge variant="secondary">Não conectado</Badge>
  return (
    <div>
      <PageHeader title="Conexões dos marketplaces" description="Contas dos marketplaces. O painel de Ads só lê os números: nunca altera anúncios, preços nem campanhas. As perguntas dos clientes ficam no Assistente ML." />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <ShoppingBagIcon className="size-4" /> Mercado Livre Ads {badge}
            </CardTitle>
            <CardDescription>
              {c.connected
                ? `Conta ${c.nickname ?? c.userId ?? ''}${c.connectedBy ? `, conectada por ${c.connectedBy}` : ''}${c.connectedAt ? ` em ${formatDateTime(c.connectedAt)}` : ''}. Sincroniza sozinho a cada 6 horas (os últimos 15 dias, porque o Mercado Livre atribui vendas até 14 dias depois do clique).`
                : 'Conecte a conta do Mercado Livre para o CRM buscar as campanhas de Product Ads e Display Ads. Na primeira vez, vêm os últimos 90 dias (limite do Mercado Livre).'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            {c.lastError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">{c.lastError}</p>}
            <SyncInfo sync={c.sync} />
            <section className="space-y-2">
              <p className="font-medium">1. Aplicativo no Mercado Livre</p>
              <p className="text-muted-foreground">
                Em{' '}
                <a className="underline" href="https://developers.mercadolivre.com.br/devcenter" target="_blank" rel="noreferrer">
                  developers.mercadolivre.com.br <ExternalLinkIcon className="inline size-3" />
                </a>
                , abra o aplicativo que o sistema anterior usava (ou crie um) e acrescente esta URI de redirecionamento. Permissões: publicidade e usuários (leitura) e Perguntas e respostas e Vendas (leitura e escrita, para o Assistente ML responder as perguntas).
              </p>
              <CopyField value={c.redirectUri} />
            </section>
            {edit && (
              <form className="space-y-2" onSubmit={(e) => void save(e)}>
                <p className="font-medium">2. Credenciais do aplicativo</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="ml-client">Client ID *</Label>
                    <Input id="ml-client" inputMode="numeric" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890123456" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ml-secret">Client Secret {c.hasSecret ? '(vazio mantém o atual)' : '*'}</Label>
                    <Input id="ml-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={c.hasSecret ? '••••••••' : ''} />
                  </div>
                </div>
                <Button type="submit" size="sm" disabled={saving || !clientId.trim() || (!secret && !c.hasSecret)}>
                  {saving && <Loader2Icon className="animate-spin" />} Salvar credenciais
                </Button>
              </form>
            )}
            {edit && (
              <section className="space-y-2">
                <p className="font-medium">3. Autorizar a conta</p>
                <p className="text-muted-foreground">Abre o Mercado Livre para entrar com a conta da Usaparts e autorizar. Quando o CRM conectar, a sincronização do sistema anterior para (o Mercado Livre aceita uma conexão por aplicativo).</p>
                <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending || !c.hasSecret || !c.clientId}>
                  {connect.isPending ? <Loader2Icon className="animate-spin" /> : <PlugIcon />} {c.connected ? 'Reconectar' : 'Conectar o Mercado Livre'}
                </Button>
              </section>
            )}
            {c.connected && edit && (
              <section className="space-y-2">
                <p className="font-medium">4. Anunciante do Product Ads</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={c.advertiserId ?? ''}
                    onValueChange={(v) => void act('adv', () => run(() => api.put('/marketplaces/mercado-livre/anunciante', { advertiserId: v }), () => 'Anunciante escolhido.'))}
                    disabled={!advertisers.data?.length}
                  >
                    <SelectTrigger size="sm" className="w-72" aria-label="Anunciante">
                      <SelectValue placeholder={advertisers.isLoading ? 'Buscando anunciantes...' : 'Escolha o anunciante'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(advertisers.data ?? (c.advertiserId ? [{ advertiserId: c.advertiserId, name: c.advertiserName ?? c.advertiserId, siteId: c.siteId ?? '' }] : [])).map((a) => (
                        <SelectItem key={a.advertiserId} value={a.advertiserId}>
                          {a.name} ({a.siteId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">Display Ads: {c.displayStatus === 'ATIVO' ? 'habilitado' : c.displayStatus === 'NAO_HABILITADO' ? 'não habilitado nesta conta' : 'ainda não verificado'}</span>
                </div>
                {advertisers.error && <p className="text-xs text-red-600">{errorMessage(advertisers.error)}</p>}
              </section>
            )}
            {c.connected && edit && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act('test', () => run(() => api.post<{ ok: boolean; message: string }>('/marketplaces/mercado-livre/testar'), (r) => (r.ok ? r.message : (toast.error(r.message), null))))}>
                  {busy === 'test' && <Loader2Icon className="animate-spin" />} Testar conexão
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy || !c.advertiserId || c.sync.running} onClick={() => void act('sync', () => run(() => api.post<{ message: string }>('/marketplaces/mercado-livre/sincronizar'), (r) => r.message))}>
                  {busy === 'sync' || c.sync.running ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Sincronizar agora
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={async () => {
                    const ok = await confirm({ title: 'Desconectar o Mercado Livre?', description: 'O CRM para de buscar os dados novos. O que já foi sincronizado continua nas telas. Para voltar, é preciso autorizar de novo.', confirmLabel: 'Desconectar Mercado Livre' })
                    if (ok) await act('off', () => run(() => api.post('/marketplaces/mercado-livre/desconectar'), () => 'Mercado Livre desconectado.'))
                  }}
                >
                  <UnplugIcon /> Desconectar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <StoreIcon className="size-4" /> Shopee <Badge variant="secondary">Em breve</Badge>
            </CardTitle>
            <CardDescription>A conexão com a Shopee entra na próxima etapa, no mesmo formato.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}

