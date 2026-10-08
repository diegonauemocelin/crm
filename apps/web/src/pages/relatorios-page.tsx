import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  ExternalLinkIcon,
  LayoutDashboardIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PinOffIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { Delta, HBar, Stat } from '@/components/atendimento/dashboard'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { ReportView } from '@/components/relatorios/report-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { brl, int, pctFmt } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { fmtDate, formatValue, periodText, RANGE_PRESETS, type ReportConfig, type ReportResult, type SavedReport, useCatalog } from '@/lib/relatorios'
import { cn } from '@/lib/utils'

const TABS = ['visao', 'painel', 'relatorios', 'ga4'] as const
type Tab = (typeof TABS)[number]

export function RelatoriosPage() {
  return (
    <RequirePermission module="relatorios">
      <Reports />
    </RequirePermission>
  )
}

function Reports() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS as readonly string[]).includes(params.get('aba') ?? '') ? (params.get('aba') as Tab) : 'visao'
  const { can } = useAuth()
  return (
    <>
      <PageHeader
        title="Dashboards e relatórios"
        description="Visão geral do marketing e das vendas, Google Analytics, e relatórios montados por você (que podem ir para o Painel)."
        actions={
          can('relatorios', 'create') && (
            <Button asChild>
              <Link to="/relatorios/novo">
                <PlusIcon /> Novo relatório
              </Link>
            </Button>
          )
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'visao' ? {} : { aba: v }, { replace: true })}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="relatorios">Relatórios salvos</TabsTrigger>
          <TabsTrigger value="ga4">Google Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="visao">
          <Overview />
        </TabsContent>
        <TabsContent value="painel">
          <Dashboard />
        </TabsContent>
        <TabsContent value="relatorios">
          <SavedList />
        </TabsContent>
        <TabsContent value="ga4">
          <Ga4 />
        </TabsContent>
      </Tabs>
    </>
  )
}

/** Seletor de período (atalhos + datas), usado na visão geral e no GA4. */
function useRange(initial = '30') {
  const [preset, setPreset] = useState<string>(initial)
  const [range, setRange] = useState<[string, string]>(() => RANGE_PRESETS.find((p) => p.id === initial)!.range() as [string, string])
  const control = (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {/* No celular os atalhos rolam para o lado em vez de alargar a página. */}
      <div className="min-w-0 max-w-full overflow-x-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={preset}
          onValueChange={(v) => {
            if (!v) return
            setPreset(v)
            const p = RANGE_PRESETS.find((x) => x.id === v)
            if (p) setRange(p.range() as [string, string])
          }}
          aria-label="Período"
        >
          {RANGE_PRESETS.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id} className="px-3">
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          className="h-8 w-36"
          aria-label="De"
          value={range[0]}
          max={range[1]}
          onChange={(e) => e.target.value && (setPreset(''), setRange([e.target.value, range[1]]))}
        />
        <span className="text-sm text-muted-foreground">até</span>
        <Input
          type="date"
          className="h-8 w-36"
          aria-label="Até"
          value={range[1]}
          min={range[0]}
          onChange={(e) => e.target.value && (setPreset(''), setRange([range[0], e.target.value]))}
        />
      </div>
    </div>
  )
  return { range, control }
}

// ---------------- Visão geral ----------------

interface Kpi {
  value: number | null
  previous: number | null
}
interface NamedRow {
  name: string | null
  values: (number | null)[]
}
interface OverviewData {
  period: {
    from: string
    to: string
    days: number
    previous: { from: string; to: string }
  }
  granularity: 'dia' | 'semana' | 'mes'
  kpis: Record<
    | 'visits'
    | 'visitors'
    | 'conversions'
    | 'leads'
    | 'orders'
    | 'revenue'
    | 'ticket'
    | 'abandoned'
    | 'abandonedValue'
    | 'emailsSent'
    | 'openRate'
    | 'clickRate'
    | 'records'
    | 'recordSales'
    | 'recordRevenue',
    Kpi
  >
  funnel: { key: string; label: string; value: number }[]
  timeline: {
    bucket: string
    visits?: number
    leads?: number
    revenue?: number
    salesValue?: number
  }[]
  visitsBySource: NamedRow[]
  leadsBySource: NamedRow[]
  revenueBySource: NamedRow[]
  conversionsByCapture: NamedRow[]
  landingPages: NamedRow[]
  devices: NamedRow[]
  campaigns: NamedRow[]
  recordsByOrigin: NamedRow[]
}

const DEVICE: Record<string, string> = {
  celular: 'Celular',
  tablet: 'Tablet',
  computador: 'Computador',
  app: 'App',
}
const nameOr = (n: string | null, fallback = 'Não informado') => n ?? fallback

function KpiStat({ label, kpi, format, lowerIsBetter, hint }: { label: string; kpi: Kpi; format: 'int' | 'brl' | 'pct'; lowerIsBetter?: boolean; hint?: string }) {
  return (
    <Stat
      label={label}
      value={formatValue(kpi.value, format)}
      delta={<Delta now={kpi.value} before={kpi.previous} lowerIsBetter={lowerIsBetter} asPoints={format === 'pct'} />}
      hint={hint}
    />
  )
}

function bucketText(b: string, g: OverviewData['granularity']) {
  return g === 'mes' ? `${b.slice(5, 7)}/${b.slice(2, 4)}` : `${b.slice(8, 10)}/${b.slice(5, 7)}`
}

function TimeChart({
  title,
  description,
  data,
  series,
  granularity,
  format,
}: {
  title: string
  description?: string
  data: OverviewData['timeline']
  series: {
    key: 'visits' | 'leads' | 'revenue' | 'salesValue'
    label: string
  }[]
  granularity: OverviewData['granularity']
  format: 'int' | 'brl'
}) {
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: `var(--chart-${i + 1})` }]))
  const rows = data.map((d) => Object.fromEntries([['bucket', d.bucket], ...series.map((s) => [s.key, d[s.key] ?? 0])]))
  const empty = rows.every((r) => series.every((s) => !r[s.key]))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description ?? `Por ${granularity === 'dia' ? 'dia' : granularity === 'semana' ? 'semana' : 'mês'}`}</CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-56 w-full">
            <LineChart data={rows} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(v: string) => bucketText(v, granularity)} />
              <YAxis tickLine={false} axisLine={false} width={format === 'brl' ? 72 : 40} allowDecimals={false} tickFormatter={(v: number) => formatValue(v, format, true)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(v) =>
                      granularity === 'semana' ? `Semana de ${fmtDate(String(v))}` : granularity === 'mes' ? bucketText(String(v), 'mes') : fmtDate(String(v))
                    }
                    formatter={(v, n) => (
                      <span className="flex w-full justify-between gap-3">
                        <span className="text-muted-foreground">{config[String(n)]?.label}</span>
                        <span className="tabular-nums">{formatValue(Number(v), format)}</span>
                      </span>
                    )}
                  />
                }
              />
              {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
              {series.map((s) => (
                <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function Funnel({ steps }: { steps: OverviewData['funnel'] }) {
  const max = Math.max(1, ...steps.map((s) => s.value))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Funil do período</CardTitle>
        <CardDescription>
          Do visitante do site ao cliente da loja. As etapas têm fontes diferentes (lead também chega pela loja e pelo WhatsApp), então a proporção só aparece quando uma etapa cabe
          na anterior.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const prev = i > 0 ? steps[i - 1]!.value : null
            return (
              <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <span className="text-sm">{s.label}</span>
                <span className="text-right text-sm font-semibold tabular-nums">
                  {int.format(s.value)}
                  {prev && s.value <= prev ? <span className="ml-2 text-xs font-normal text-muted-foreground">{pctFmt.format(s.value / prev)} da etapa anterior</span> : null}
                </span>
                <div className="col-span-2 h-2.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(s.value ? 1 : 0, (s.value / max) * 100)}%`,
                      background: 'var(--chart-1)',
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

function Overview() {
  const { range, control } = useRange('30')
  const q = useQuery({
    queryKey: ['relatorios-visao', range[0], range[1]],
    queryFn: () => api.get<OverviewData>(`/relatorios/visao-geral?from=${range[0]}&to=${range[1]}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
  const d = q.data
  const k = d?.kpis
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {control}
        {d && (
          <span className="text-xs text-muted-foreground">
            Comparando com {fmtDate(d.period.previous.from)} a {fmtDate(d.period.previous.to)}
          </span>
        )}
        {q.isFetching && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
      </div>
      {q.isLoading && <TableSkeleton rows={8} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && k && (
        <>
          <Section title="Site e captação">
            <KpiStat label="Visitas ao site" kpi={k.visits} format="int" hint={`${formatValue(k.visitors.value, 'int')} visitante(s)`} />
            <KpiStat label="Conversões" kpi={k.conversions} format="int" hint="Formulários, pop-ups e WhatsApp" />
            <KpiStat label="Leads novos" kpi={k.leads} format="int" hint="Sem contar importações" />
            <KpiStat
              label="Taxa de conversão do site"
              kpi={{
                value: k.visits.value ? (k.conversions.value ?? 0) / k.visits.value : null,
                previous: k.visits.previous ? (k.conversions.previous ?? 0) / k.visits.previous : null,
              }}
              format="pct"
              hint="Conversões ÷ visitas"
            />
          </Section>
          <Section title="Loja virtual">
            <KpiStat label="Receita (pedidos pagos)" kpi={k.revenue} format="brl" />
            <KpiStat label="Pedidos pagos" kpi={k.orders} format="int" />
            <KpiStat label="Ticket médio" kpi={k.ticket} format="brl" />
            <KpiStat label="Carrinhos abandonados" kpi={k.abandoned} format="int" lowerIsBetter hint={`${formatValue(k.abandonedValue.value, 'brl')} em produtos`} />
          </Section>
          <Section title="E-mail e atendimento">
            <KpiStat label="E-mails enviados" kpi={k.emailsSent} format="int" hint="Campanhas e automações" />
            <KpiStat label="Taxa de abertura" kpi={k.openRate} format="pct" hint={`Clique: ${formatValue(k.clickRate.value, 'pct')}`} />
            <KpiStat label="Atendimentos de Pré-Vendas" kpi={k.records} format="int" hint={`${formatValue(k.recordSales.value, 'int')} venda(s)`} />
            <KpiStat label="Valor vendido (Pré-Vendas)" kpi={k.recordRevenue} format="brl" />
          </Section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Funnel steps={d.funnel} />
            <TimeChart
              title="Receita"
              data={d.timeline}
              granularity={d.granularity}
              format="brl"
              series={[
                { key: 'revenue', label: 'Loja virtual (pagos)' },
                { key: 'salesValue', label: 'Pré-Vendas' },
              ]}
            />
            <TimeChart title="Visitas ao site" data={d.timeline} granularity={d.granularity} format="int" series={[{ key: 'visits', label: 'Visitas' }]} />
            <TimeChart title="Leads novos" data={d.timeline} granularity={d.granularity} format="int" series={[{ key: 'leads', label: 'Leads novos' }]} />
            <HBar
              title="Visitas por fonte / meio"
              valueLabel="Visitas"
              data={d.visitsBySource.map((r) => ({
                name: nameOr(r.name, 'Sem origem'),
                value: r.values[0] ?? 0,
              }))}
            />
            <HBar
              title="Leads novos por fonte"
              description="Fonte da primeira conversão"
              valueLabel="Leads"
              data={d.leadsBySource.map((r) => ({
                name: nameOr(r.name, 'Sem conversão rastreada'),
                value: r.values[0] ?? 0,
              }))}
            />
            <HBar
              title="Receita da loja por fonte do cliente"
              description="Pedidos pagos, pela fonte da primeira conversão do cliente"
              valueLabel="Receita"
              format={(v) => formatValue(v, 'brl', true)}
              data={d.revenueBySource.map((r) => ({
                name: nameOr(r.name, 'Sem origem rastreada'),
                value: r.values[0] ?? 0,
                extra: `${int.format(r.values[1] ?? 0)} pedido(s)`,
              }))}
              extra="pedidos"
            />
            <HBar
              title="Conversões por formulário, pop-up e botão"
              valueLabel="Conversões"
              data={d.conversionsByCapture.map((r) => ({
                name: nameOr(r.name, 'Removido'),
                value: r.values[0] ?? 0,
              }))}
            />
            <HBar
              title="Páginas de entrada"
              valueLabel="Visitas"
              data={d.landingPages.map((r) => ({
                name: (r.name ?? '—').replace(/^https?:\/\/[^/]+/, '') || '/',
                value: r.values[0] ?? 0,
              }))}
            />
            <HBar
              title="Dispositivos"
              valueLabel="Visitas"
              data={d.devices.map((r) => ({
                name: r.name ? (DEVICE[r.name] ?? r.name) : 'Não identificado',
                value: r.values[0] ?? 0,
              }))}
            />
            <HBar
              title="Atendimentos de Pré-Vendas por origem"
              valueLabel="Atendimentos"
              data={d.recordsByOrigin.map((r) => ({
                name: nameOr(r.name),
                value: r.values[0] ?? 0,
                extra: `${int.format(r.values[1] ?? 0)} venda(s)`,
              }))}
              extra="vendas"
            />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Campanhas de e-mail</CardTitle>
                <CardDescription>Enviadas no período (as que mais enviaram)</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {d.campaigns.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma campanha enviada no período.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Campanha</TableHead>
                        <TableHead className="text-right">Enviados</TableHead>
                        <TableHead className="text-right">Abertura</TableHead>
                        <TableHead className="pr-6 text-right">Clique</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.campaigns.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-56 truncate pl-6 font-medium">{c.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatValue(c.values[0], 'int')}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatValue(c.values[1], 'pct')}</TableCell>
                          <TableCell className="pr-6 text-right tabular-nums">{formatValue(c.values[2], 'pct')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            Visitas, páginas e conversões vêm do script de rastreamento do CRM (só páginas com o script instalado). Os números do Google Analytics estão na aba ao lado e podem ser
            diferentes, porque cada ferramenta conta de um jeito.
          </p>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </section>
  )
}

// ---------------- Painel ----------------

/** Relatórios sugeridos para montar o primeiro painel com um clique. */
const SUGGESTED: { name: string; width: 1 | 2; config: ReportConfig }[] = [
  {
    name: 'Receita da loja por mês',
    width: 2,
    config: {
      source: 'pedidos',
      dimensions: ['mes'],
      metrics: ['receita', 'pedidos_pagos', 'ticket'],
      filters: [],
      period: { preset: '12m' },
      chart: 'colunas',
      limit: 20,
      compare: true,
    },
  },
  {
    name: 'Leads novos por fonte',
    width: 1,
    config: {
      source: 'leads',
      dimensions: ['fonte'],
      metrics: ['leads'],
      filters: [{ field: 'entrada', op: 'diferente', values: ['importado'] }],
      period: { preset: '30' },
      chart: 'barras',
      limit: 10,
      compare: true,
    },
  },
  {
    name: 'Valor vendido por vendedor (Pré-Vendas)',
    width: 1,
    config: {
      source: 'atendimentos',
      dimensions: ['vendedor'],
      metrics: ['valor_vendido', 'vendas', 'conversao'],
      filters: [{ field: 'tipo', op: 'igual', values: ['PRE_VENDAS'] }],
      period: { preset: 'mes' },
      chart: 'barras',
      limit: 10,
      compare: true,
    },
  },
  {
    name: 'Carrinhos abandonados por dia',
    width: 1,
    config: {
      source: 'carrinhos',
      dimensions: ['dia'],
      metrics: ['abandonados', 'valor_abandonado'],
      filters: [],
      period: { preset: '30' },
      chart: 'colunas',
      limit: 50,
      compare: true,
    },
  },
  {
    name: 'Abertura dos e-mails por campanha',
    width: 1,
    config: {
      source: 'emails',
      dimensions: ['campanha'],
      metrics: ['taxa_abertura', 'taxa_clique', 'enviados'],
      filters: [],
      period: { preset: '90' },
      chart: 'tabela',
      limit: 10,
      compare: true,
    },
  },
  {
    name: 'Visitas ao site por dispositivo',
    width: 1,
    config: {
      source: 'visitas',
      dimensions: ['semana', 'dispositivo'],
      metrics: ['visitas'],
      filters: [],
      period: { preset: '90' },
      chart: 'colunas',
      limit: 20,
      compare: true,
    },
  },
  {
    name: 'Conversões no mês',
    width: 1,
    config: {
      source: 'conversoes',
      dimensions: [],
      metrics: ['conversoes', 'leads'],
      filters: [],
      period: { preset: 'mes' },
      chart: 'numero',
      limit: 20,
      compare: true,
    },
  },
]

function useSaved() {
  return useQuery({
    queryKey: ['relatorios-salvos'],
    queryFn: () => api.get<SavedReport[]>('/relatorios/salvos'),
  })
}

function Dashboard() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const catalog = useCatalog()
  const q = useSaved()
  const [creating, setCreating] = useState(false)
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data || !catalog.data) return <TableSkeleton rows={6} />
  const pinned = q.data.filter((r) => r.pinned)
  const available = new Set(catalog.data.sources.filter((s) => s.available).map((s) => s.key))

  const createSuggested = async () => {
    setCreating(true)
    try {
      for (const s of SUGGESTED.filter((x) => available.has(x.config.source))) {
        await api.post('/relatorios/salvos', {
          name: s.name,
          description: null,
          config: s.config,
          visibility: 'privado',
          pinned: true,
          width: s.width,
        })
      }
      await qc.invalidateQueries({ queryKey: ['relatorios-salvos'] })
      toast.success('Painel criado. Edite, remova ou compartilhe cada relatório quando quiser.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  if (pinned.length === 0) {
    return (
      <EmptyState
        icon={LayoutDashboardIcon}
        title="Seu painel está vazio"
        description='Monte relatórios no criador e ligue "Mostrar no Painel", ou comece com um painel sugerido (receita, leads por fonte, vendas por vendedor, carrinhos, e-mails e visitas).'
        action={
          can('relatorios', 'create') ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void createSuggested()} disabled={creating}>
                {creating ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Criar painel sugerido
              </Button>
              <Button variant="outline" asChild>
                <Link to="/relatorios/novo">
                  <PlusIcon /> Novo relatório
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {pinned.map((r, i) => (
        <DashboardCard key={r.id} report={r} first={i === 0} last={i === pinned.length - 1} />
      ))}
    </div>
  )
}

function DashboardCard({ report, first, last }: { report: SavedReport; first: boolean; last: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { can } = useAuth()
  const data = useQuery({
    queryKey: ['relatorio-dados', report.id, report.updatedAt],
    queryFn: () => api.get<ReportResult>(`/relatorios/salvos/${report.id}/dados`),
    staleTime: 60_000,
  })
  const editable = (report.mine || report.visibility === 'equipe') && can('relatorios', 'edit')
  const arrange = useMutation({
    mutationFn: (body: { pinned?: boolean; width?: 1 | 2; move?: 'up' | 'down' }) => api.post(`/relatorios/salvos/${report.id}/painel`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['relatorios-salvos'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Card className={cn('min-w-0', report.width === 2 && 'lg:col-span-2')}>
      <CardHeader>
        <CardTitle className="text-base">
          <Link to={`/relatorios/${report.id}`} className="hover:underline">
            {report.name}
          </Link>
        </CardTitle>
        <CardDescription>
          {data.data ? periodText(data.data.period) : '…'}
          {report.visibility === 'equipe' ? ' · da equipe' : ''}
          {report.description ? ` · ${report.description}` : ''}
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Opções de ${report.name}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/relatorios/${report.id}`)}>
                <ExternalLinkIcon /> Abrir {editable ? 'e editar' : ''}
              </DropdownMenuItem>
              {editable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={first} onSelect={() => arrange.mutate({ move: 'up' })}>
                    <ArrowUpIcon /> Mover para antes
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={last} onSelect={() => arrange.mutate({ move: 'down' })}>
                    <ArrowDownIcon /> Mover para depois
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => arrange.mutate({ width: report.width === 2 ? 1 : 2 })}>
                    <BarChart3Icon /> {report.width === 2 ? 'Metade da tela' : 'Largura inteira'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => arrange.mutate({ pinned: false })}>
                    <PinOffIcon /> Tirar do Painel
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent>
        {data.error ? (
          <p className="py-6 text-center text-sm text-destructive">{errorMessage(data.error)}</p>
        ) : data.data ? (
          <ReportView result={data.data} compact />
        ) : (
          <TableSkeleton rows={4} />
        )}
      </CardContent>
    </Card>
  )
}

// ---------------- Relatórios salvos ----------------

function SavedList() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const catalog = useCatalog()
  const q = useSaved()
  const pin = useMutation({
    mutationFn: (v: { id: string; pinned: boolean }) => api.post(`/relatorios/salvos/${v.id}/painel`, { pinned: v.pinned }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['relatorios-salvos'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <TableSkeleton rows={6} />
  const sourceName = new Map((catalog.data?.sources ?? []).map((s) => [s.key, s.label]))
  if (q.data.length === 0) {
    return (
      <EmptyState
        icon={BarChart3Icon}
        title="Nenhum relatório salvo"
        description="Monte um relatório escolhendo a fonte (leads, atendimentos, pedidos, carrinhos, e-mails, visitas ou conversões), como agrupar e o que medir."
        action={
          can('relatorios', 'create') ? (
            <Button asChild>
              <Link to="/relatorios/novo">
                <PlusIcon /> Novo relatório
              </Link>
            </Button>
          ) : undefined
        }
      />
    )
  }
  return (
    <Card className="py-0">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Relatório</TableHead>
              <TableHead>Fonte</TableHead>
              <TableHead>Quem vê</TableHead>
              <TableHead>Criado por</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead className="pr-6 text-right">No Painel</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((r) => {
              const editable = (r.mine || r.visibility === 'equipe') && can('relatorios', 'edit')
              return (
                <TableRow key={r.id}>
                  <TableCell className="pl-6">
                    <Link to={`/relatorios/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    {r.description && <p className="max-w-md truncate text-xs text-muted-foreground">{r.description}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{sourceName.get(r.config.source) ?? r.config.source}</TableCell>
                  <TableCell>
                    <Badge variant={r.visibility === 'equipe' ? 'secondary' : 'outline'}>{r.visibility === 'equipe' ? 'Equipe' : 'Só eu'}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{r.mine ? 'Você' : (r.createdByName ?? '—')}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(r.updatedAt)}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <Switch
                      checked={r.pinned}
                      disabled={!editable || pin.isPending}
                      onCheckedChange={(v) => pin.mutate({ id: r.id, pinned: v })}
                      aria-label={`Mostrar ${r.name} no Painel`}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}

// ---------------- Google Analytics ----------------

interface GaMetric {
  value: number
  previous: number | null
}
type GaRow = Record<string, string | number>
type Ga4Data =
  | { configured: false }
  | {
      configured: true
      fetchedAt: string
      period: {
        from: string
        to: string
        previous: { from: string; to: string }
      }
      totals: Record<string, GaMetric>
      daily: GaRow[]
      channels: GaRow[]
      sourceMedium: GaRow[]
      pages: GaRow[]
      devices: GaRow[]
      landingPages: GaRow[]
      regions: GaRow[]
      items: GaRow[]
    }

const CHANNEL: Record<string, string> = {
  'Organic Search': 'Busca orgânica',
  'Paid Search': 'Busca paga',
  Direct: 'Direto',
  'Organic Social': 'Social orgânico',
  'Paid Social': 'Social pago',
  Referral: 'Referência',
  Email: 'E-mail',
  'Organic Shopping': 'Shopping orgânico',
  'Paid Shopping': 'Shopping pago',
  Display: 'Display',
  'Cross-network': 'Várias redes',
  'Organic Video': 'Vídeo orgânico',
  'Paid Video': 'Vídeo pago',
  Affiliates: 'Afiliados',
  'Mobile Push Notifications': 'Notificações push',
  SMS: 'SMS',
  Unassigned: 'Não atribuído',
}
const GA_DEVICE: Record<string, string> = {
  mobile: 'Celular',
  desktop: 'Computador',
  tablet: 'Tablet',
  smart_tv: 'TV',
}
const seconds = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`)

function Ga4() {
  const { can } = useAuth()
  const { range, control } = useRange('30')
  const [refresh, setRefresh] = useState(0)
  const q = useQuery({
    queryKey: ['relatorios-ga4', range[0], range[1], refresh],
    queryFn: () => api.get<Ga4Data>(`/relatorios/ga4?from=${range[0]}&to=${range[1]}${refresh ? '&atualizar=1' : ''}`),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const d = q.data
  if (d && !d.configured) {
    return (
      <EmptyState
        icon={BarChart3Icon}
        title="Google Analytics não conectado"
        description="Conecte a propriedade GA4 do site (com uma conta de serviço só de leitura) para ver usuários, sessões, canais, páginas e receita aqui, ao lado dos números do CRM."
        action={
          can('configuracoes', 'view') ? (
            <Button asChild>
              <Link to="/configuracoes?aba=ga4">Configurar Google Analytics</Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Peça a um administrador para conectar em Configurações → Google Analytics.</p>
          )
        }
      />
    )
  }
  const t = d?.configured ? d.totals : null
  const m = (key: string) => t?.[key] ?? { value: 0, previous: null }
  const gaStat = (label: string, key: string, format: 'int' | 'brl' | 'pct' | 'time', hint?: string) => (
    <Stat
      label={label}
      value={format === 'time' ? seconds(m(key).value) : formatValue(m(key).value, format)}
      delta={<Delta now={m(key).value} before={m(key).previous} asPoints={format === 'pct'} />}
      hint={hint}
    />
  )
  const dailyConfig: ChartConfig = {
    sessions: { label: 'Sessões', color: 'var(--chart-1)' },
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {control}
        {d?.configured && (
          <span className="text-xs text-muted-foreground">
            Dados do Google de {formatDateTime(d.fetchedAt)}.{' '}
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setRefresh((n) => n + 1)} disabled={q.isFetching}>
              <RefreshCwIcon className={cn('size-3', q.isFetching && 'animate-spin')} /> Atualizar
            </Button>
          </span>
        )}
      </div>
      {q.isLoading && <TableSkeleton rows={8} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d?.configured && (
        <>
          <Section title="Público e engajamento">
            {gaStat('Usuários ativos', 'activeUsers', 'int', `${formatValue(m('newUsers').value, 'int')} novo(s)`)}
            {gaStat('Sessões', 'sessions', 'int')}
            {gaStat('Taxa de engajamento', 'engagementRate', 'pct')}
            {gaStat('Duração média da sessão', 'averageSessionDuration', 'time')}
          </Section>
          <Section title="Resultados">
            {gaStat('Visualizações de página', 'screenPageViews', 'int')}
            {gaStat('Eventos-chave (conversões)', 'keyEvents', 'int')}
            {gaStat('Compras', 'ecommercePurchases', 'int')}
            {gaStat('Receita (GA4)', 'purchaseRevenue', 'brl')}
          </Section>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Sessões por dia</CardTitle>
              </CardHeader>
              <CardContent>
                {d.daily.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
                ) : (
                  <ChartContainer config={dailyConfig} className="aspect-auto h-56 w-full">
                    <LineChart data={d.daily} margin={{ left: 0, right: 16, top: 8 }}>
                      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}`} />
                      <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={(v: number) => int.format(v)} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => fmtDate(String(v))} />} />
                      <Line dataKey="sessions" type="monotone" stroke="var(--color-sessions)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
            <HBar
              title="Sessões por canal"
              valueLabel="Sessões"
              data={d.channels.map((r) => ({
                name: CHANNEL[String(r.sessionDefaultChannelGroup)] ?? String(r.sessionDefaultChannelGroup),
                value: Number(r.sessions),
                extra: `${brl.format(Number(r.purchaseRevenue))}`,
              }))}
              extra="receita"
            />
            <HBar
              title="Origem / mídia"
              valueLabel="Sessões"
              data={d.sourceMedium.map((r) => ({
                name: String(r.sessionSourceMedium),
                value: Number(r.sessions),
                extra: `${int.format(Number(r.keyEvents))} evento(s)-chave`,
              }))}
              extra="eventos"
            />
            <HBar
              title="Páginas mais vistas"
              valueLabel="Visualizações"
              data={d.pages.map((r) => ({
                name: String(r.pagePath),
                value: Number(r.screenPageViews),
              }))}
            />
            <HBar
              title="Páginas de entrada"
              valueLabel="Sessões"
              data={d.landingPages.map((r) => ({
                name: String(r.landingPage) || '/',
                value: Number(r.sessions),
              }))}
            />
            <HBar
              title="Dispositivos"
              valueLabel="Sessões"
              data={d.devices.map((r) => ({
                name: GA_DEVICE[String(r.deviceCategory)] ?? String(r.deviceCategory),
                value: Number(r.sessions),
              }))}
            />
            <HBar
              title="Estados"
              valueLabel="Sessões"
              data={d.regions.map((r) => ({
                name: String(r.region) === '(not set)' ? 'Não identificado' : String(r.region),
                value: Number(r.sessions),
              }))}
            />
            <HBar
              title="Produtos que mais venderam (GA4)"
              valueLabel="Receita"
              format={(v) => formatValue(v, 'brl', true)}
              data={d.items
                .filter((r) => Number(r.itemRevenue) > 0)
                .map((r) => ({
                  name: String(r.itemName),
                  value: Number(r.itemRevenue),
                  extra: `${int.format(Number(r.itemsPurchased))} un.`,
                }))}
              extra="unidades"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Números do Google Analytics 4 (guardados por 15 minutos). Podem ser diferentes dos do CRM: o GA4 usa modelagem e amostragem, e bloqueadores de anúncio afetam cada
            ferramenta de um jeito.
          </p>
        </>
      )}
    </div>
  )
}
