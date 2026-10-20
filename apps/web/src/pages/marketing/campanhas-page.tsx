import { ArrowLeftIcon, GitCompareIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { DataNotes, DataTable, KpiCard, Section, TrendChart } from '@/components/marketing/blocos'
import { breakdownColumns, MktPage } from '@/components/marketing/shell'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/lib/auth'
import { bucketLabel, type BreakdownRow, campaignPath, fmt, type Kpi, MKT_BASE, type Meta, useMkt, useMktFilters } from '@/lib/marketing'

interface CampaignList extends Meta {
  campaigns: BreakdownRow[]
}

/** Análise de campanhas: todas as campanhas de todos os canais, com investimento, resultado no CRM e retorno. */
export function CampanhasPage() {
  const { params, qs, set } = useMktFilters()
  const q = useMkt<CampaignList>('campanhas', qs)
  const [picked, setPicked] = useState<string[]>([])
  const navigate = useNavigate()
  const d = q.data
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length >= 6 ? p : [...p, key]))
  const cols = breakdownColumns('Campanha', { cost: true, media: true, qs, campaignLinks: true })
  cols.unshift({
    key: 'pick',
    label: '',
    value: () => null,
    csv: () => null,
    render: (r) => (r.key === '__loja' ? null : <Checkbox checked={picked.includes(r.key)} onCheckedChange={() => toggle(r.key)} aria-label={`Comparar ${r.label}`} />),
    className: 'w-8',
  })
  cols.splice(2, 0, { key: 'channel', label: 'Canal', value: (r) => (r.key === '__loja' ? 'Loja virtual' : (d?.campaigns.find((c) => c.key === r.key)?.channel ?? '')), render: (r) => <ChannelBadge channel={r.key === '__loja' ? 'loja' : (r.channel ?? '')} />, className: 'hidden md:table-cell' })
  return (
    <MktPage
      title="Análise de campanhas"
      description="Campanhas de todos os canais no período. Marque de 2 a 6 para comparar; clique no nome para investigar."
      params={params}
      set={set}
      actions={
        <Button size="sm" disabled={picked.length < 2} onClick={() => navigate(`${MKT_BASE}/campanhas-comparar?${qs}&chaves=${picked.map(encodeURIComponent).join(',')}`)}>
          <GitCompareIcon /> Comparar ({picked.length})
        </Button>
      }
    >
      {q.isLoading && <TableSkeleton rows={10} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Section title="Campanhas" description="Conversões da plataforma (contadas pelo Google) ficam separadas das vendas do CRM. Sem campanha identificada = lead do canal sem nome de campanha no link.">
            <DataTable rows={d.campaigns} columns={cols} rowKey={(r) => r.key} exportName="mkt-campanhas" initialSort="cost" />
          </Section>
          <DataNotes meta={d} />
        </>
      )}
    </MktPage>
  )
}

const CHANNEL_SHORT: Record<string, string> = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', tiktok_ads: 'TikTok Ads', outras_midias: 'Outra mídia', email: 'E-mail', busca_organica: 'Busca orgânica', social_organico: 'Social orgânico', indicacao: 'Indicação', direto: 'Direto', nao_identificado: 'Não identificado', loja: 'Loja virtual' }
function ChannelBadge({ channel }: { channel: string }) {
  return (
    <Badge variant="outline" className="font-normal whitespace-nowrap">
      {CHANNEL_SHORT[channel] ?? channel}
    </Badge>
  )
}

interface CampaignDetail extends Meta {
  key: string
  channel: string
  channelLabel: string
  name: string
  kpis: Kpi[]
  buckets: string[]
  totals: { impressions: number; clicks: number; platformConversions: number; cost: number | null }
  daily: { bucket: string; cost: number | null; clicks: number; impressions: number; leads: number; sales: number; revenue: number }[]
  byState: BreakdownRow[]
  byBrand: BreakdownRow[]
  byPartType: BreakdownRow[]
  bySeller: BreakdownRow[]
  similar: BreakdownRow[]
  records: { id: string; leadAt: string; saleAt: string | null; saleAtEstimated: boolean; status: string; value: number | null; seller: string | null; state: string | null; ad: string | null; term: string | null; how: string }[]
}

const STATUS: Record<string, string> = { SIM: 'Vendeu', NAO: 'Perdida', NEGOCIACAO: 'Em negociação' }
const HOW: Record<string, string> = { clique_google: 'clique no anúncio', origem_google: 'origem do cadastro', toque: 'visita/conversão', nenhum: '—' }

/** Ficha de uma campanha: indicadores, evolução, onde vende, quem atende, campanhas parecidas e os atendimentos de origem. */
export function CampanhaPage() {
  const { chave = '' } = useParams()
  const { params, qs, set } = useMktFilters()
  const { can } = useAuth()
  const q = useMkt<CampaignDetail>(`campanhas/${encodeURIComponent(chave)}`, qs)
  const [metric, setMetric] = useState<'cost' | 'leads' | 'sales' | 'revenue' | 'clicks'>('leads')
  const d = q.data
  const backQs = new URLSearchParams(qs)
  backQs.delete('campanha')
  const METRICS = { cost: ['Investimento', 'brl'], clicks: ['Cliques', 'int'], leads: ['Leads', 'int'], sales: ['Vendas', 'int'], revenue: ['Faturamento', 'brl'] } as const
  return (
    <MktPage
      title={d ? d.name : 'Campanha'}
      description={d ? `${d.channelLabel} · investigação da campanha no período` : 'Carregando a campanha...'}
      params={params}
      set={set}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to={`${MKT_BASE}/campanhas?${backQs}`}>
            <ArrowLeftIcon /> Todas as campanhas
          </Link>
        </Button>
      }
    >
      {q.isLoading && <TableSkeleton rows={10} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {d.kpis
              .filter((k) => ['investimento', 'leads', 'qualificados', 'oportunidades', 'vendas', 'faturamento', 'cpl', 'roas', 'conversao', 'ticket'].includes(k.id))
              .map((k) => (
                <KpiCard key={k.id} k={k} />
              ))}
          </div>
          {d.totals.cost !== null && (
            <p className="text-xs text-muted-foreground">
              Na plataforma: {fmt(d.totals.impressions, 'int')} impressões · {fmt(d.totals.clicks, 'int')} cliques · {fmt(d.totals.platformConversions, 'int')} conversões contadas pelo Google (não somam com as vendas do CRM).
            </p>
          )}

          <div className="space-y-2">
            <Select value={metric} onValueChange={(v) => setMetric(v as typeof metric)}>
              <SelectTrigger size="sm" className="w-48" aria-label="Indicador do gráfico">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(METRICS).map(([id, [label]]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TrendChart title={`${METRICS[metric][0]} por ${d.granularity === 'dia' ? 'dia' : 'período'}`} buckets={d.daily.map((x) => x.bucket)} series={d.daily.map((x) => x[metric])} unit={METRICS[metric][1]} granularity={d.granularity} kind="bar" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Por estado">
              <DataTable rows={d.byState} columns={breakdownColumns('Estado')} rowKey={(r) => r.key} exportName="mkt-campanha-estado" initialSort="leads" pageSize={10} />
            </Section>
            <Section title="Por vendedor">
              <DataTable rows={d.bySeller} columns={breakdownColumns('Vendedor')} rowKey={(r) => r.key} exportName="mkt-campanha-vendedor" initialSort="leads" pageSize={10} />
            </Section>
            <Section title="Por marca" description="Um atendimento com várias marcas conta em cada uma.">
              <DataTable rows={d.byBrand} columns={breakdownColumns('Marca')} rowKey={(r) => r.key} exportName="mkt-campanha-marca" initialSort="leads" pageSize={10} />
            </Section>
            <Section title="Por tipo de peça">
              <DataTable rows={d.byPartType} columns={breakdownColumns('Peça')} rowKey={(r) => r.key} exportName="mkt-campanha-peca" initialSort="leads" pageSize={10} />
            </Section>
          </div>

          <Section title="Campanhas parecidas" description={`Outras campanhas do canal ${d.channelLabel} no mesmo período, para comparar.`}>
            <DataTable rows={d.similar} columns={breakdownColumns('Campanha', { cost: true, qs, campaignLinks: true })} rowKey={(r) => r.key} initialSort="cost" pageSize={8} />
          </Section>

          <Section title="Atendimentos de origem" description="Os 200 mais recentes ligados à campanha (sem nome nem telefone; abra no Pré-Vendas para ver).">
            <DataTable
              rows={d.records}
              rowKey={(r) => r.id}
              exportName="mkt-campanha-atendimentos"
              columns={[
                { key: 'leadAt', label: 'Lead', value: (r) => r.leadAt, render: (r) => formatDateTime(r.leadAt) },
                { key: 'status', label: 'Situação', value: (r) => STATUS[r.status] ?? r.status },
                { key: 'saleAt', label: 'Venda', value: (r) => r.saleAt, render: (r) => (r.saleAt ? `${formatDateTime(r.saleAt)}${r.saleAtEstimated ? ' (estimada)' : ''}` : '—'), className: 'hidden md:table-cell' },
                { key: 'value', label: 'Valor', unit: 'brl', value: (r) => r.value },
                { key: 'seller', label: 'Vendedor', value: (r) => r.seller ?? 'Sem vendedor', className: 'hidden md:table-cell' },
                { key: 'state', label: 'UF', value: (r) => r.state, className: 'hidden sm:table-cell' },
                { key: 'how', label: 'Ligado por', value: (r) => HOW[r.how] ?? r.how, className: 'hidden lg:table-cell' },
                { key: 'adterm', label: 'Anúncio / termo', value: (r) => r.ad ?? r.term, className: 'hidden xl:table-cell' },
                {
                  key: 'open',
                  label: '',
                  value: () => null,
                  csv: (r) => r.id,
                  render: (r) =>
                    can('pre_vendas', 'view') ? (
                      <Link className="text-sm underline underline-offset-4" to={`/pre-vendas?abrir=${r.id}`}>
                        Abrir
                      </Link>
                    ) : null,
                },
              ]}
            />
          </Section>

          <DataNotes meta={d} />
        </>
      )}
    </MktPage>
  )
}

interface CompareData extends Meta {
  items: { key: string; name: string; channel: string; channelLabel: string; kpis: Kpi[]; buckets: string[] }[]
}

const COMPARE_KPIS = ['investimento', 'leads', 'qualificados', 'oportunidades', 'vendas', 'faturamento', 'cpl', 'cplQualificado', 'conversao', 'roas', 'ticket', 'semAtendimento']
const LINE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--muted-foreground)']

/** Comparação de 2 a 6 campanhas no mesmo período: indicadores lado a lado e a evolução de um indicador. */
export function CompararCampanhasPage() {
  const { params, qs, set } = useMktFilters()
  const keys = params.get('chaves') ?? ''
  const q = useMkt<CompareData>('campanhas-comparar', `${qs}&chaves=${encodeURIComponent(keys)}`, keys.split(',').length >= 2)
  const [metric, setMetric] = useState('leads')
  const d = q.data
  const config: ChartConfig = Object.fromEntries((d?.items ?? []).map((it, i) => [`c${i}`, { label: it.name, color: LINE_COLORS[i] }]))
  const buckets = d?.items[0]?.buckets ?? []
  const chartData = buckets.map((b, bi) => ({ b, ...Object.fromEntries((d?.items ?? []).map((it, i) => [`c${i}`, it.kpis.find((k) => k.id === metric)?.series[bi] ?? null])) }))
  const unit = d?.items[0]?.kpis.find((k) => k.id === metric)?.unit ?? 'int'
  return (
    <MktPage
      title="Comparar campanhas"
      description="As campanhas escolhidas no mesmo período e com os mesmos filtros."
      params={params}
      set={set}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to={`${MKT_BASE}/campanhas?${qs}`}>
            <ArrowLeftIcon /> Todas as campanhas
          </Link>
        </Button>
      }
    >
      {keys.split(',').length < 2 && <p className="text-sm text-muted-foreground">Escolha de 2 a 6 campanhas na Análise de campanhas.</p>}
      {q.isLoading && <TableSkeleton rows={8} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Card>
            <CardContent className="px-0 sm:px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Indicador</TableHead>
                    {d.items.map((it) => (
                      <TableHead key={it.key} className="text-right">
                        <Link to={campaignPath(it.key, qs)} className="underline-offset-4 hover:underline">
                          {it.name}
                        </Link>
                        <span className="block text-xs font-normal text-muted-foreground">{it.channelLabel}</span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMPARE_KPIS.map((id) => {
                    const label = d.items[0]?.kpis.find((k) => k.id === id)?.label ?? id
                    return (
                      <TableRow key={id}>
                        <TableCell className="font-medium">{label}</TableCell>
                        {d.items.map((it) => {
                          const k = it.kpis.find((x) => x.id === id)
                          return (
                            <TableCell key={it.key} className="text-right whitespace-nowrap tabular-nums">
                              {k ? fmt(k.value, k.unit) : '—'}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Evolução no período</CardTitle>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger size="sm" className="w-56" aria-label="Indicador do gráfico">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARE_KPIS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {d.items[0]?.kpis.find((k) => k.id === id)?.label ?? id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <ChartContainer config={config} className="aspect-auto h-64 w-full">
                <LineChart data={chartData} margin={{ left: 0, right: 12, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="b" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={(b) => bucketLabel(String(b), d.granularity)} />
                  <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v) => fmt(Number(v), unit)} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(b) => bucketLabel(String(b), d.granularity)} formatter={(v, n) => `${config[String(n)]?.label ?? ''}: ${fmt(Number(v), unit)}`} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  {d.items.map((_, i) => (
                    <Line key={i} dataKey={`c${i}`} type="monotone" stroke={`var(--color-c${i})`} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <DataNotes meta={d} />
        </>
      )}
    </MktPage>
  )
}
