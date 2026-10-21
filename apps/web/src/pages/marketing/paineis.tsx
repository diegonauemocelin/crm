import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, BellRingIcon, CheckCircle2Icon, Loader2Icon, SparklesIcon, CircleAlertIcon, CirclePauseIcon, LightbulbIcon, XCircleIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { BreakdownTable, COLS, COMMERCIAL_COLS, CrmOnlyNotice, ExportButtons, FunnelView, Kpi, MEDIA_COLS, MktFilters, TrendChart, UpdatedLine } from '@/components/marketing/ui'
import { EmptyState, ErrorState, formatDateTime, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type Analysis, type BreakdownRow, downloadCsv, hours, money, moneyShort, num, pct, type Recommendation, times, useAnalysis, useMktFilters } from '@/lib/marketing'
import { cn } from '@/lib/utils'

/** Estrutura comum: cabeçalho, filtros, avisos e o conteúdo quando os dados chegam. */
export function Screen({ title, description, filters = 'all', extra, children }: { title: string; description: string; filters?: 'all' | 'period' | 'none'; extra?: Record<string, string>; children: (d: Analysis) => ReactNode }) {
  const f = useMktFilters()
  const q = new URLSearchParams(f.query)
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v)
  const a = useAnalysis(q.toString())
  return (
    <div>
      <PageHeader title={title} description={description} />
      <div className="space-y-4">
        {filters !== 'none' && <MktFilters show={filters === 'period' ? 'period' : 'all'} />}
        {a.isLoading && <TableSkeleton rows={6} />}
        {a.error && <ErrorState error={a.error} onRetry={() => a.refetch()} />}
        {a.data && (
          <>
            <UpdatedLine d={a.data} />
            <CrmOnlyNotice d={a.data} />
            <div className={cn('space-y-4 transition-opacity', a.isFetching && 'opacity-60')}>{children(a.data)}</div>
          </>
        )}
      </div>
    </div>
  )
}

export const spark = (d: Analysis, k: keyof Analysis['series'][number]) => d.series.map((s) => Number(s[k] ?? 0))

export function useDrill() {
  const f = useMktFilters()
  return (key: string) => (r: BreakdownRow) => f.set({ [key]: r.key })
}

// ---------- 1. Visão geral ----------

export function VisaoGeralPage() {
  return (
    <RequirePermission module="mi_executivo">
      <Screen title="Marketing Inteligente" description="Resumo de marketing e vendas do período, saúde das fontes e o que pede atenção." filters="period">
        {(d) => <VisaoGeral d={d} />}
      </Screen>
    </RequirePermission>
  )
}

const SCREENS = [
  { to: '/marketing/executivo', title: 'Dashboard executivo', text: 'Os indicadores da diretoria, com comparação e tendência.', module: 'mi_executivo' },
  { to: '/marketing/funil', title: 'Funil e atribuição', text: 'Do clique à venda, com as perdas de cada etapa.', module: 'mi_executivo' },
  { to: '/marketing/campanhas', title: 'Análise de campanhas', text: 'Investigar e comparar campanhas.', module: 'mi_executivo' },
  { to: '/marketing/google-ads', title: 'Google Ads', text: 'Investimento e retorno das campanhas do Google.', module: 'mi_midia' },
  { to: '/marketing/leads', title: 'CRM e leads de marketing', text: 'Atendimento, tempo de resposta, vendedores e regiões.', module: 'mi_comercial' },
  { to: '/marketing/email', title: 'E-mail marketing', text: 'Envios, cliques e vendas de quem clicou.', module: 'mi_comercial' },
  { to: '/marketing/recomendacoes', title: 'Recomendações', text: 'Diagnósticos com os números que os sustentam.', module: 'mi_ia' },
  { to: '/marketing/relatorios', title: 'Relatórios e alertas', text: 'Relatórios por e-mail, PDF e Excel na hora e alertas automáticos.', module: 'mi_relatorios' },
]

function VisaoGeral({ d }: { d: Analysis }) {
  const { can } = useAuth()
  const n = d.now
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Investimento" value={money(n.totalCost)} delta={d.deltas.totalCost} lowerIsBetter spark={spark(d, 'totalCost')} hint={n.fixedCost ? `mídia ${money(n.mediaCost)} + fixos ${money(n.fixedCost)}` : 'mídia paga'} />
        <Kpi label="Leads" value={num(n.leads)} delta={d.deltas.leads} spark={spark(d, 'leads')} />
        <Kpi label="Vendas" value={num(n.sales)} delta={d.deltas.sales} spark={spark(d, 'sales')} />
        <Kpi label="Faturamento" value={money(n.revenue)} delta={d.deltas.revenue} spark={spark(d, 'revenue')} hint="valor da venda no Pré-Vendas" />
        <Kpi label="Custo por lead" value={money(n.cpl)} delta={d.deltas.cpl} lowerIsBetter />
        <Kpi label="ROAS" value={times(n.roas)} delta={d.deltas.roas} hint="faturamento atribuído ÷ mídia" />
      </div>
      {can('mi_relatorios') && <RecentAlerts />}
      <div className="grid gap-4 lg:grid-cols-2">
        <RecList recs={d.recommendations.slice(0, 4)} more={can('mi_ia') && d.recommendations.length > 4 ? d.recommendations.length - 4 : 0} />
        <HealthCard compact />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SCREENS.filter((s) => can(s.module)).map((s) => (
          <Link key={s.to} to={s.to} className="group rounded-xl border p-4 transition-colors hover:border-[color:var(--brand)]">
            <p className="flex items-center justify-between font-medium">
              {s.title} <ArrowRightIcon className="size-4 opacity-50 group-hover:opacity-100" />
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
          </Link>
        ))}
      </div>
    </>
  )
}

/** Alertas disparados nos últimos 3 dias (configurados em Relatórios e alertas). */
function RecentAlerts() {
  const q = useQuery({
    queryKey: ['mkt-alertas'],
    queryFn: () => api.get<{ events: { at: string; ruleId: string; message: string }[] }>('/marketing/alertas'),
    staleTime: 60_000,
    select: (d) => ({ ...d, recent: d.events.filter((e) => Date.now() - Date.parse(e.at) < 3 * 86_400_000) }),
  })
  const recent = q.data?.recent ?? []
  if (!recent.length) return null
  return (
    <Card className="border-red-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRingIcon className="size-4 text-red-600" /> Alertas recentes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {recent.slice(0, 6).map((e) => (
          <p key={`${e.at}-${e.ruleId}`}>
            <span className="text-muted-foreground">{formatDateTime(e.at)}</span> · {e.message}
          </p>
        ))}
        <Link to="/marketing/relatorios" className="text-xs underline">
          Ver e configurar alertas
        </Link>
      </CardContent>
    </Card>
  )
}

// ---------- 2. Dashboard executivo ----------

export function ExecutivoPage() {
  return (
    <RequirePermission module="mi_executivo">
      <Screen title="Dashboard executivo" description="Investimento, leads, vendas e retorno de todos os canais, com comparação ao período anterior.">
        {(d) => (
          <>
            <div className="flex justify-end">
              <ExportButtons sections={['kpis', 'plataformas', 'campanhas', 'funil', 'vendedores', 'regioes', 'marcas', 'categorias', 'origens', 'recomendacoes']} />
            </div>
            <Executivo d={d} />
          </>
        )}
      </Screen>
    </RequirePermission>
  )
}

function Executivo({ d }: { d: Analysis }) {
  const n = d.now
  const b = d.before
  const drill = useDrill()
  const k = (label: string, key: keyof Analysis['now'], fmt: (v: number | null) => string, o: { lower?: boolean; spark?: keyof Analysis['series'][number]; hint?: string } = {}) => (
    <Kpi label={label} value={fmt(n[key] as number | null)} before={fmt(b[key] as number | null)} delta={d.deltas[key]} lowerIsBetter={o.lower} spark={o.spark ? spark(d, o.spark) : undefined} hint={o.hint} />
  )
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {k('Investimento total em marketing', 'totalCost', money, { lower: true, spark: 'totalCost', hint: `mídia ${money(n.mediaCost)}${n.fixedCost ? ` + fixos ${money(n.fixedCost)}` : ''}` })}
        {k('Leads gerados', 'leads', num, { spark: 'leads' })}
        {k('Leads qualificados', 'qualified', num, { spark: 'qualified', hint: d.rules.qualified === 'repassado' ? 'repassados ao vendedor' : 'repassados com retorno do vendedor' })}
        {k('Oportunidades', 'opportunities', num, { hint: 'repassados ao vendedor' })}
        {k('Vendas atribuídas ao marketing', 'mktSales', num, { hint: `de ${num(n.sales)} vendas no total` })}
        {k('Faturamento atribuído ao marketing', 'mktRevenue', money, { spark: 'mktRevenue', hint: `de ${money(n.revenue)} no total` })}
        {k('Custo por lead (CPL)', 'cpl', money, { lower: true, spark: 'cpl' })}
        {k('Custo por lead qualificado', 'cpql', money, { lower: true })}
        {k('CAC', 'cac', money, { lower: true, hint: `custo total ÷ ${num(n.newCustomers)} cliente(s) novo(s)` })}
        {k('Conversão lead → venda', 'conversionRate', pct, { spark: 'conversionRate' })}
        {k('ROAS de mídia', 'roas', times, { spark: 'roas', hint: 'faturamento atribuído ÷ investimento em mídia' })}
        {k('ROI estimado', 'roi', pct, { hint: `margem de ${pct(d.rules.marginPct)} sobre o faturamento atribuído, menos o custo total` })}
        {k('Ticket médio', 'ticket', money)}
        {k('Leads atendidos', 'attendedRate', pct)}
        {k('Leads sem atendimento', 'notAttendedRate', pct, { lower: true, hint: `${num(n.leads - n.attended)} lead(s)` })}
        {k('Oportunidades perdidas', 'lostRate', pct, { lower: true, hint: 'perdidas ÷ decididas (vendeu + perdeu)' })}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TrendChart title="Investimento x faturamento atribuído" data={d.series} series={[{ key: 'mediaCost', label: 'Investimento em mídia', color: 'var(--chart-2)' }, { key: 'mktRevenue', label: 'Faturamento atribuído', color: 'var(--chart-1)' }]} format={moneyShort} />
        <TrendChart title="Leads e vendas" kind="bar" data={d.series} series={[{ key: 'leads', label: 'Leads', color: 'var(--chart-1)' }, { key: 'sales', label: 'Vendas', color: 'var(--chart-3)' }]} />
      </div>
      <BreakdownTable title="Por plataforma (retorno por canal)" rows={d.byPlatform} columns={MEDIA_COLS} onPick={drill('plataforma')} exportName="marketing-por-plataforma" />
      <BreakdownTable title="Receita por campanha" rows={d.byCampaign} columns={MEDIA_COLS} onPick={drill('campanha')} exportName="marketing-por-campanha" limit={15} />
      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownTable title="Receita por vendedor" rows={d.bySeller} columns={[COLS.leads, COLS.sales, COLS.conversionRate, COLS.revenue, COLS.ticket]} onPick={drill('vendedor')} exportName="marketing-por-vendedor" limit={15} />
        <BreakdownTable title="Receita por região" rows={d.byRegion} columns={[COLS.leads, COLS.sales, COLS.conversionRate, COLS.revenue, COLS.ticket]} onPick={drill('regiao')} exportName="marketing-por-regiao" />
        <BreakdownTable title="Receita por estado" rows={d.byState} columns={[COLS.leads, COLS.sales, COLS.conversionRate, COLS.revenue, COLS.ticket]} onPick={drill('estado')} exportName="marketing-por-estado" limit={10} />
        <BreakdownTable title="Por marca da máquina" rows={d.byBrand} columns={[COLS.leads, COLS.sales, COLS.conversionRate, COLS.revenue]} onPick={drill('marca')} exportName="marketing-por-marca" limit={10} multi />
        <BreakdownTable title="Por tipo de peça" rows={d.byPartType} columns={[COLS.leads, COLS.sales, COLS.conversionRate, COLS.revenue]} onPick={drill('tipoPeca')} exportName="marketing-por-tipo-de-peca" limit={10} multi />
        <BreakdownTable title="Cliente novo ou recorrente" rows={d.byCliente} columns={[COLS.leads, COLS.sales, COLS.conversionRate, COLS.revenue, COLS.ticket]} onPick={drill('cliente')} />
      </div>
      <p className="text-xs text-muted-foreground">Clique numa linha para filtrar a tela por ela. Faturamento = valor da venda no Pré-Vendas (integração com o ERP prevista para depois).</p>
    </>
  )
}

// ---------- 8. CRM e leads de marketing ----------

export function LeadsMktPage() {
  return (
    <RequirePermission module="mi_comercial">
      <Screen title="CRM e leads de marketing" description="Quantos leads chegaram, quantos foram atendidos, em quanto tempo e quantos viraram venda, por canal, vendedor e região.">
        {(d) => <LeadsMkt d={d} />}
      </Screen>
    </RequirePermission>
  )
}

function LeadsMkt({ d }: { d: Analysis }) {
  const n = d.now
  const t = d.funnel.times
  const drill = useDrill()
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Leads gerados" value={num(n.leads)} delta={d.deltas.leads} spark={spark(d, 'leads')} hint={`${num(n.mktLeads)} de marketing`} />
        <Kpi label="Atendidos" value={pct(n.attendedRate)} delta={d.deltas.attendedRate} hint={`${num(n.attended)} lead(s)`} />
        <Kpi label="Sem atendimento" value={num(n.leads - n.attended)} hint={pct(n.notAttendedRate)} />
        <Kpi label="Qualificados" value={pct(n.qualificationRate)} delta={d.deltas.qualificationRate} hint={`${num(n.qualified)} lead(s)`} />
        <Kpi label="Tempo até repassar ao vendedor" value={hours(t.toForwardMedianHours)} hint={`mediana · média ${hours(t.toForwardHours)}`} />
        <Kpi label="Tempo até o retorno do vendedor" value={hours(t.toReturnMedianHours)} hint={`mediana · média ${hours(t.toReturnHours)}`} />
        <Kpi label="Vendas" value={num(n.sales)} delta={d.deltas.sales} hint={`conversão ${pct(n.conversionRate)}`} />
        <Kpi label="Oportunidades perdidas" value={pct(n.lostRate)} delta={d.deltas.lostRate} lowerIsBetter />
      </div>
      <BreakdownTable title="Por origem do lead" rows={d.byOrigin} columns={COMMERCIAL_COLS} onPick={drill('origem')} exportName="leads-por-origem" />
      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownTable title="Por vendedor" rows={d.bySeller} columns={COMMERCIAL_COLS.slice(0, 7)} onPick={drill('vendedor')} exportName="leads-por-vendedor" />
        <BreakdownTable title="Por filial" rows={d.byUnit} columns={COMMERCIAL_COLS.slice(0, 7)} onPick={drill('filial')} exportName="leads-por-filial" />
        <BreakdownTable title="Por região" rows={d.byRegion} columns={COMMERCIAL_COLS.slice(0, 7)} onPick={drill('regiao')} exportName="leads-por-regiao" />
        <BreakdownTable title="Por tipo de cliente" rows={d.byCustomerType} columns={COMMERCIAL_COLS.slice(0, 7)} onPick={drill('tipoCliente')} exportName="leads-por-tipo-de-cliente" />
      </div>
    </>
  )
}

// ---------- 9. E-mail marketing ----------

interface EmailData {
  period: { from: string; to: string }
  totals: { sent: number; failed: number; opened: number; clicked: number; unsubscribed: number; orders: number; revenue: number; openRate: number | null; clickRate: number | null; unsubRate: number | null }
  campaigns: { id: string; name: string; subject: string; kind: string; firstSent: string | null; sent: number; failed: number; opened: number; clicked: number; unsubscribed: number; openRate: number | null; clickRate: number | null; unsubRate: number | null; orders: number; revenue: number }[]
}

export function EmailMktPage() {
  return (
    <RequirePermission module="mi_comercial">
      <EmailMkt />
    </RequirePermission>
  )
}

function EmailMkt() {
  const f = useMktFilters()
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['mkt-email', f.from, f.to], queryFn: () => api.get<EmailData>(`/marketing/email?de=${f.from}&ate=${f.to}`) })
  const d = q.data
  return (
    <div>
      <PageHeader title="E-mail marketing" description="Envios, cliques, descadastros e vendas de quem clicou, por campanha (dados do e-mail marketing do CRM)." />
      <div className="space-y-4">
        <MktFilters show="period" />
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi label="Enviados" value={num(d.totals.sent)} hint={d.totals.failed ? `${num(d.totals.failed)} com erro` : undefined} />
              <Kpi label="Abertura registrada" value={pct(d.totals.openRate)} hint="pode ser maior que a real (privacidade do Apple Mail)" />
              <Kpi label="Cliques" value={pct(d.totals.clickRate)} hint={`${num(d.totals.clicked)} pessoa(s)`} />
              <Kpi label="Descadastros" value={pct(d.totals.unsubRate)} hint={`${num(d.totals.unsubscribed)} pessoa(s)`} />
              <Kpi label="Vendas de quem clicou" value={money(d.totals.revenue)} hint={`${num(d.totals.orders)} venda(s) em até 7 dias do clique`} />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por campanha</CardTitle>
                <CardDescription>Só recebe quem autorizou e-mail (LGPD). Cliques são mais confiáveis que aberturas.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {d.campaigns.length === 0 ? (
                  <EmptyState title="Nenhum envio no período" description="As campanhas de e-mail aparecem aqui assim que houver envios no período escolhido." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Campanha</TableHead>
                        <TableHead className="text-right">Enviados</TableHead>
                        <TableHead className="text-right">Abertura</TableHead>
                        <TableHead className="text-right">Cliques</TableHead>
                        <TableHead className="text-right">Descadastros</TableHead>
                        <TableHead className="text-right">Vendas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.campaigns.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="max-w-80 pl-6">
                            {can('email_marketing') ? (
                              <Link to={`/email-marketing/${c.id}`} className="font-medium hover:underline">
                                {c.name}
                              </Link>
                            ) : (
                              <span className="font-medium">{c.name}</span>
                            )}
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.kind === 'MODELO' ? 'Automação · ' : ''}
                              {c.subject}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{num(c.sent)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(c.openRate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(c.clickRate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(c.unsubRate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.orders ? `${num(c.orders)} · ${money(c.revenue)}` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- 10. Funil e atribuição ----------

const FUNNEL_DIMS = [
  { key: 'byPlatform', label: 'Plataforma' },
  { key: 'byCampaign', label: 'Campanha' },
  { key: 'byRegion', label: 'Região' },
  { key: 'byState', label: 'Estado' },
  { key: 'bySeller', label: 'Vendedor' },
  { key: 'byBrand', label: 'Marca' },
  { key: 'byPartType', label: 'Tipo de peça' },
  { key: 'byOrigin', label: 'Origem' },
] as const

export function FunilPage() {
  return (
    <RequirePermission module="mi_executivo">
      <Screen title="Funil e atribuição" description="Da impressão ao faturamento: volume, passagem entre etapas, tempo de avanço e onde se perde mais.">
        {(d) => <Funil d={d} />}
      </Screen>
    </RequirePermission>
  )
}

function Funil({ d }: { d: Analysis }) {
  const [dim, setDim] = useState<(typeof FUNNEL_DIMS)[number]['key']>('byPlatform')
  const t = d.funnel.times
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <FunnelView d={d} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Como é contado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              <b className="text-foreground">Atribuição:</b> {d.rules.attribution.model === 'primeiro' ? 'primeiro toque (a primeira campanha do lead)' : 'último toque (a campanha do contato)'}, janela de {d.rules.attribution.windowDays} dias.
            </p>
            <p>
              <b className="text-foreground">Lead qualificado:</b> {d.rules.qualified === 'repassado' ? 'repassado ao vendedor.' : 'repassado ao vendedor e com retorno do vendedor.'}
            </p>
            <p>
              <b className="text-foreground">Deduplicação:</b> um lead conta uma vez por etapa, mesmo com vários atendimentos; cada venda conta como um pedido.
            </p>
            <p>
              <b className="text-foreground">Tempo até repassar:</b> mediana {hours(t.toForwardMedianHours)}. <b className="text-foreground">Até o retorno:</b> mediana {hours(t.toReturnMedianHours)}.
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Funil comparado</CardTitle>
            <CardDescription>Passagem de cada etapa por recorte.</CardDescription>
          </div>
          <Select value={dim} onValueChange={(v) => setDim(v as typeof dim)}>
            <SelectTrigger size="sm" className="w-44" aria-label="Comparar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUNNEL_DIMS.map((x) => (
                <SelectItem key={x.key} value={x.key}>
                  Por {x.label.toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{FUNNEL_DIMS.find((x) => x.key === dim)?.label}</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Atendidos</TableHead>
                <TableHead className="text-right">Oportunidades</TableHead>
                <TableHead className="text-right">Qualificados</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">Custo acumulado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d[dim].slice(0, 30).map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="max-w-64 truncate pl-6 font-medium" title={r.name}>
                    {r.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.clicks ? num(r.clicks) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.leads)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.attended)} <span className="text-xs text-muted-foreground">{pct(r.attendedRate)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.opportunities)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.qualified)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.sales)} <span className="text-xs text-muted-foreground">{pct(r.conversionRate)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.mediaCost ? money(r.mediaCost) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}

// ---------- 11. Análise de campanhas ----------

export function CampanhasPage() {
  return (
    <RequirePermission module="mi_executivo">
      <Screen title="Análise de campanhas" description="Investigue uma campanha ou selecione duas ou mais para comparar no mesmo período.">
        {(d) => <Campanhas d={d} />}
      </Screen>
    </RequirePermission>
  )
}

const COMPARE_ROWS: { key: keyof BreakdownRow; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'mediaCost', label: 'Investimento', fmt: money },
  { key: 'clicks', label: 'Cliques', fmt: num },
  { key: 'ctr', label: 'CTR', fmt: pct },
  { key: 'cpc', label: 'CPC', fmt: money },
  { key: 'leads', label: 'Leads', fmt: num },
  { key: 'cpl', label: 'CPL', fmt: money },
  { key: 'qualified', label: 'Qualificados', fmt: num },
  { key: 'qualificationRate', label: 'Taxa de qualificação', fmt: pct },
  { key: 'attendedRate', label: 'Atendidos', fmt: pct },
  { key: 'sales', label: 'Vendas', fmt: num },
  { key: 'conversionRate', label: 'Conversão', fmt: pct },
  { key: 'revenue', label: 'Faturamento', fmt: money },
  { key: 'ticket', label: 'Ticket médio', fmt: money },
  { key: 'roas', label: 'ROAS', fmt: times },
  { key: 'platformConversions', label: 'Conversões na plataforma', fmt: num },
]

function Campanhas({ d }: { d: Analysis }) {
  const f = useMktFilters()
  const { can } = useAuth()
  const [picked, setPicked] = useState<string[]>([])
  const rows = d.byCampaign
  const chosen = rows.filter((r) => picked.includes(r.key))
  const focus = f.filters.campanha ? rows.find((r) => r.key === f.filters.campanha) : null
  return (
    <>
      {focus && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{focus.name}</CardTitle>
              <CardDescription>{focus.platform ? `${focus.platform === 'google' ? 'Google Ads' : focus.platform} · ` : ''}campanha selecionada: todos os números da tela estão filtrados por ela.</CardDescription>
            </div>
            <Button size="sm" variant="ghost" onClick={() => f.set({ campanha: null })}>
              Ver todas as campanhas
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi label="Investimento" value={money(d.now.mediaCost)} delta={d.deltas.mediaCost} lowerIsBetter spark={spark(d, 'mediaCost')} />
              <Kpi label="Leads" value={num(d.now.leads)} delta={d.deltas.leads} spark={spark(d, 'leads')} hint={`CPL ${money(d.now.cpl)}`} />
              <Kpi label="Qualificados" value={num(d.now.qualified)} delta={d.deltas.qualified} hint={`taxa ${pct(d.now.qualificationRate)}`} />
              <Kpi label="Vendas" value={num(d.now.sales)} delta={d.deltas.sales} hint={`conversão ${pct(d.now.conversionRate)}`} />
              <Kpi label="Faturamento" value={money(d.now.revenue)} delta={d.deltas.revenue} hint={`ROAS ${times(d.now.roas)}`} />
            </div>
            <TrendChart title="Leads e vendas no período" kind="bar" data={d.series} series={[{ key: 'leads', label: 'Leads', color: 'var(--chart-1)' }, { key: 'sales', label: 'Vendas', color: 'var(--chart-3)' }]} />
            <div className="grid gap-4 xl:grid-cols-3">
              <BreakdownTable title="Por estado" rows={d.byState} columns={[COLS.leads, COLS.sales, COLS.revenue]} limit={10} />
              <BreakdownTable title="Por tipo de peça" rows={d.byPartType} columns={[COLS.leads, COLS.sales, COLS.revenue]} limit={10} multi />
              <BreakdownTable title="Por vendedor" rows={d.bySeller} columns={[COLS.leads, COLS.sales, COLS.revenue]} limit={10} />
            </div>
          </CardContent>
        </Card>
      )}
      {chosen.length >= 2 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Comparação</CardTitle>
              <CardDescription>Mesmo período e mesmos filtros. Em verde, o melhor de cada linha.</CardDescription>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
              Limpar seleção
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Indicador</TableHead>
                  {chosen.map((c) => (
                    <TableHead key={c.key} className="max-w-48 text-right" title={c.name}>
                      <span className="line-clamp-2">{c.name}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {COMPARE_ROWS.map((row) => {
                  const lower = ['cpc', 'cpl'].includes(String(row.key))
                  const vals = chosen.map((c) => c[row.key] as number | null)
                  const valid = vals.filter((v): v is number => v !== null)
                  const best = valid.length > 1 ? (lower ? Math.min(...valid) : Math.max(...valid)) : null
                  return (
                    <TableRow key={String(row.key)}>
                      <TableCell className="pl-6 text-muted-foreground">{row.label}</TableCell>
                      {chosen.map((c, i) => (
                        <TableCell key={c.key} className={cn('text-right tabular-nums', best !== null && vals[i] === best && 'font-semibold text-[#006300] dark:text-[#0ca30c]')}>
                          {row.fmt(vals[i] ?? null)}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Campanhas do período</CardTitle>
            <CardDescription>Marque duas ou mais para comparar; clique no nome para investigar. Sem campanha identificada = lead de anúncio sem o número da campanha no link.</CardDescription>
          </div>
          {(can('mi_executivo', 'export') || can('mi_midia', 'export')) && rows.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => downloadCsv('campanhas', ['Campanha', ...COMPARE_ROWS.map((r) => r.label)], rows.map((r) => [r.name, ...COMPARE_ROWS.map((c) => r[c.key] as number | null)]))}>
              CSV
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <EmptyState title="Nenhuma campanha no período" description="As campanhas aparecem quando há investimento do Google Ads ou leads com campanha identificada." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-6" />
                  <TableHead>Campanha</TableHead>
                  {MEDIA_COLS.map((c) => (
                    <TableHead key={String(c.key)} className="text-right">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="pl-6">
                      {r.key !== '-' && (
                        <Checkbox
                          aria-label={`Comparar ${r.name}`}
                          checked={picked.includes(r.key)}
                          onCheckedChange={(v) => setPicked((p) => (v ? [...p, r.key].slice(-6) : p.filter((x) => x !== r.key)))}
                        />
                      )}
                    </TableCell>
                    <TableCell className="max-w-72">
                      {r.key === '-' ? (
                        <span className="text-muted-foreground">{r.name}</span>
                      ) : (
                        <button type="button" className="truncate text-left font-medium hover:underline" title={r.name} onClick={() => f.set({ campanha: r.key })}>
                          {r.name}
                        </button>
                      )}
                    </TableCell>
                    {MEDIA_COLS.map((c) => (
                      <TableCell key={String(c.key)} className="text-right tabular-nums">
                        {c.fmt(r[c.key] as number | null)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}

// ---------- 12. Recomendações ----------

export function RecomendacoesPage() {
  return (
    <RequirePermission module="mi_ia">
      <Screen title="Recomendações" description="Diagnósticos calculados com os números do período e do anterior. Nada é alterado nas plataformas: cada ação é decisão de uma pessoa.">
        {(d) => (
          <>
            <AiSummary />
            {d.recommendations.length === 0 ? (
              <EmptyState icon={LightbulbIcon} title="Nenhum ponto de atenção" description="Com os filtros e o período escolhidos, nenhuma regra encontrou um problema com amostra suficiente." />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {d.recommendations.map((r) => (
                  <RecCard key={r.id} r={r} />
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              As regras só rodam com amostra mínima (10 leads ou mais) e mostram a confiança pelo tamanho da amostra. Relações entre números (ex.: estado que converte mais) são correlações, não prova de causa.
            </p>
          </>
        )}
      </Screen>
    </RequirePermission>
  )
}

/** Resumo escrito pela IA (Gemini) com os números agregados do período e dos filtros. */
function AiSummary() {
  const f = useMktFilters()
  const ai = useMutation({ mutationFn: () => api.post<{ text: string; generatedAt: string; note: string }>(`/marketing/ia/resumo?${f.query}`) })
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <SparklesIcon className="size-4" /> Resumo pela IA
          </CardTitle>
          <CardDescription>A IA recebe só números agregados (plataformas, campanhas, regiões, marcas): nunca dados de clientes ou vendedores. Ela não altera nada.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => ai.mutate()} disabled={ai.isPending}>
          {ai.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {ai.data ? 'Gerar de novo' : 'Gerar resumo'}
        </Button>
      </CardHeader>
      {(ai.data || ai.error) && (
        <CardContent className="space-y-2 text-sm">
          {ai.error && <p className="text-red-600">{errorMessage(ai.error)}</p>}
          {ai.data && (
            <>
              <div className="whitespace-pre-wrap">{ai.data.text}</div>
              <p className="text-xs text-muted-foreground">
                {ai.data.note} Gerado em {formatDateTime(ai.data.generatedAt)}.
              </p>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

const PRIORITY = { alta: 'bg-red-500/15 text-red-700 dark:text-red-300', media: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', baixa: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' }

function RecCard({ r }: { r: Recommendation }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={PRIORITY[r.priority]} variant="outline">
            Prioridade {r.priority}
          </Badge>
          <Badge variant="outline">Confiança {r.confidence}</Badge>
          <Badge variant="secondary">{r.area}</Badge>
        </div>
        <CardTitle className="text-base">{r.problem}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {r.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p>
          <b>Impacto:</b> {r.impact}
        </p>
        <p>
          <b>Ação sugerida:</b> {r.action}
        </p>
        <p className="text-xs text-muted-foreground">
          Medir: {r.metric}. Validar: {r.validate} Fonte: {r.source}.
        </p>
      </CardContent>
    </Card>
  )
}

function RecList({ recs, more }: { recs: Recommendation[]; more: number }) {
  const { can } = useAuth()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">O que pede atenção</CardTitle>
        <CardDescription>Diagnósticos com amostra suficiente no período.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {recs.length === 0 && <p className="text-muted-foreground">Nada fora do normal no período.</p>}
        {recs.map((r) => (
          <div key={r.id} className="border-l-2 pl-3" style={{ borderColor: r.priority === 'alta' ? '#dc2626' : r.priority === 'media' ? '#d97706' : '#0284c7' }}>
            <p className="font-medium">{r.problem}</p>
            <p className="text-xs text-muted-foreground">{r.action}</p>
          </div>
        ))}
        {can('mi_ia') && (
          <Button asChild size="sm" variant="outline">
            <Link to="/marketing/recomendacoes">{more ? `Ver todas (+${more})` : 'Ver recomendações'}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- 15. Integrações e saúde dos dados ----------

interface Health {
  sources: { key: string; name: string; status: 'ok' | 'atencao' | 'erro' | 'desligado'; lastAt: string | null; detail: string; metrics: string }[]
}

const STATUS = {
  ok: { label: 'Funcionando', icon: CheckCircle2Icon, cls: 'text-[#006300] dark:text-[#0ca30c]' },
  atencao: { label: 'Atenção', icon: CircleAlertIcon, cls: 'text-amber-600' },
  erro: { label: 'Com erro', icon: XCircleIcon, cls: 'text-red-600' },
  desligado: { label: 'Não conectado', icon: CirclePauseIcon, cls: 'text-muted-foreground' },
}

export function HealthCard({ compact }: { compact?: boolean }) {
  const q = useQuery({ queryKey: ['mkt-saude'], queryFn: () => api.get<Health>('/marketing/saude'), staleTime: 60_000 })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saúde das fontes de dados</CardTitle>
        <CardDescription>O que está conectado e quando atualizou. Dados reais e estimativas ficam separados.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {q.isLoading && <TableSkeleton rows={4} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data?.sources
          .filter((s) => !compact || s.status !== 'desligado')
          .map((s) => {
            const st = STATUS[s.status]
            return (
              <div key={s.key} className="flex items-start gap-2">
                <st.icon className={cn('mt-0.5 size-4 shrink-0', st.cls)} aria-label={st.label} />
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.name} <span className={cn('text-xs font-normal', st.cls)}>· {st.label}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.lastAt ? `Última atualização: ${formatDateTime(s.lastAt)}. ` : ''}
                    {s.detail}
                  </p>
                  {!compact && <p className="text-xs text-muted-foreground">Traz: {s.metrics}.</p>}
                </div>
              </div>
            )
          })}
        {compact && (
          <Button asChild size="sm" variant="outline">
            <Link to="/marketing/integracoes">Ver todas as fontes</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function IntegracoesMktPage() {
  const { can } = useAuth()
  return (
    <RequirePermission module="mi_config">
      <Screen title="Integrações e saúde dos dados" description="Contas conectadas, última atualização, erros e a qualidade dos dados dos leads." filters="period">
        {(d) => {
          const q = d.quality
          const share = (a: number, b: number) => (b ? pct((a / b) * 100) : '—')
          return (
            <>
              <HealthCard />
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Qualidade dos dados dos leads</CardTitle>
                  <CardDescription>Atendimentos do Pré-Vendas do período ({num(q.records)}). Campo vazio vira “Não informado” nas análises.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Kpi label="Leads do Google com campanha identificada" value={share(q.googleWithCampaign, q.googleLeads)} hint={`${num(q.googleLeads - q.googleWithCampaign)} sem campanha`} />
                  <Kpi label="Com origem" value={share(q.withOrigin, q.records)} />
                  <Kpi label="Com estado (região)" value={share(q.withState, q.records)} />
                  <Kpi label="Com vendedor" value={share(q.withSeller, q.records)} />
                  <Kpi label="Com marca da máquina" value={share(q.withBrand, q.records)} />
                  <Kpi label="Com tipo de peça" value={share(q.withPartType, q.records)} />
                  <Kpi label="Possíveis duplicados" value={num(q.duplicates)} hint="mesmo lead mais de uma vez no mesmo dia (contado uma vez)" />
                </CardContent>
              </Card>
              {can('mi_config', 'edit') && (
                <Button asChild variant="outline">
                  <Link to="/configuracoes?secao=marketing-inteligente">Regras e contas em Configurações › Marketing Inteligente</Link>
                </Button>
              )}
            </>
          )
        }}
      </Screen>
    </RequirePermission>
  )
}
