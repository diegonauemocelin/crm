import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { DataNotes, DataTable, Section } from '@/components/marketing/blocos'
import { breakdownColumns, MktPage } from '@/components/marketing/shell'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth'
import { bucketLabel, type BreakdownRow, fmt, hoursText, type Meta, type Timing, useMkt, useMktFilters } from '@/lib/marketing'
import { Variation } from '@/components/marketing/blocos'

interface LeadsData extends Meta {
  summary: {
    leads: number
    previousLeads: number
    leadsVariation: number | null
    attended: number
    unattended: number
    qualified: number
    opportunities: number
    converted: number
    attendedRate: number | null
    qualifiedRate: number | null
    opportunityRate: number | null
    conversionRate: number | null
    identifiedShare: number | null
  }
  timings: { firstContact: Timing; opportunity: Timing; sale: Timing }
  series: { bucket: string; leads: number; attended: number; qualified: number; opportunities: number; sales: number }[]
  byChannel: BreakdownRow[]
  bySeller: BreakdownRow[]
  bySellerTiming: ({ key: string; label: string; leads: number } & LeadsData['timings'])[]
  byState: BreakdownRow[]
  byRegion: BreakdownRow[]
  byOrigin: BreakdownRow[]
  byCustomerType: BreakdownRow[]
  unattended: { id: string; leadAt: string; seller: string | null; state: string | null; channel: string; campaign: string | null }[]
}

function Metric({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <Card className="gap-1 py-3">
      <CardContent className="space-y-1 px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

const timingHint = (t: Timing) => (t.n ? `mediana ${hoursText(t.medianHours)} · ${t.n} atendimento(s)${t.missing ? ` · ${t.missing} sem o dado` : ''}` : 'sem dados no período')

/** CRM e leads de marketing: quantos chegaram, foram atendidos, viraram oportunidade e venda, e em quanto tempo. */
export function MktLeadsPage() {
  const { params, qs, set } = useMktFilters()
  const q = useMkt<LeadsData>('leads', qs)
  const { can } = useAuth()
  const d = q.data
  const s = d?.summary
  const config: ChartConfig = { leads: { label: 'Leads', color: 'var(--chart-1)' }, attended: { label: 'Atendidos', color: 'var(--chart-2)' }, sales: { label: 'Com venda', color: 'var(--chart-3)' } }
  return (
    <MktPage title="CRM e leads de marketing" description="Leads do Pré-Vendas por canal, atendimento, qualificação, oportunidade e venda, com os tempos de cada etapa. Nada é alterado no CRM." params={params} set={set}>
      {q.isLoading && <TableSkeleton rows={8} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && s && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Leads gerados" value={fmt(s.leads, 'int')} hint={`Anterior: ${fmt(s.previousLeads, 'int')}`}>
              <Variation k={{ value: s.leads, previous: s.previousLeads, variation: s.leadsVariation, better: 'up' }} />
            </Metric>
            <Metric label="Atendidos" value={fmt(s.attendedRate, 'pct')} hint={`${fmt(s.attended, 'int')} atendidos · ${fmt(s.unattended, 'int')} sem atendimento`} />
            <Metric label="Qualificados" value={fmt(s.qualifiedRate, 'pct')} hint={`${fmt(s.qualified, 'int')} leads`} />
            <Metric label="Oportunidades" value={fmt(s.opportunityRate, 'pct')} hint={`${fmt(s.opportunities, 'int')} leads`} />
            <Metric label="Compraram" value={fmt(s.conversionRate, 'pct')} hint={`${fmt(s.converted, 'int')} leads do período`} />
            <Metric label="Até o 1º atendimento" value={hoursText(d.timings.firstContact.avgHours)} hint={`média · ${timingHint(d.timings.firstContact)}`} />
            <Metric label="Até a oportunidade" value={hoursText(d.timings.opportunity.avgHours)} hint={`média · ${timingHint(d.timings.opportunity)}`} />
            <Metric label="Até a venda" value={hoursText(d.timings.sale.avgHours)} hint={`média · ${timingHint(d.timings.sale)}`} />
          </div>
          <p className="text-xs text-muted-foreground">
            Leads com canal identificado: {fmt(s.identifiedShare, 'pct')}. O tempo até a venda usa só vendas com data no histórico; os importados de planilha ficam fora dos tempos.
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leads, atendidos e com venda</CardTitle>
              <CardDescription>Pela data do lead, no agrupamento escolhido.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={config} className="aspect-auto h-64 w-full">
                <BarChart data={d.series} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={(b) => bucketLabel(String(b), d.granularity)} />
                  <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(b) => bucketLabel(String(b), d.granularity)} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="leads" fill="var(--color-leads)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  <Bar dataKey="attended" fill="var(--color-attended)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  <Bar dataKey="sales" fill="var(--color-sales)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Tabs defaultValue="canal">
            <TabsList className="flex-wrap">
              <TabsTrigger value="canal">Por canal</TabsTrigger>
              <TabsTrigger value="vendedor">Por vendedor</TabsTrigger>
              <TabsTrigger value="tempos">Tempos por vendedor</TabsTrigger>
              <TabsTrigger value="uf">Por estado</TabsTrigger>
              <TabsTrigger value="regiao">Por região</TabsTrigger>
              <TabsTrigger value="origem">Por origem do cadastro</TabsTrigger>
              <TabsTrigger value="tipo">Por tipo de cliente</TabsTrigger>
            </TabsList>
            {(
              [
                ['canal', 'Canal', d.byChannel],
                ['vendedor', 'Vendedor', d.bySeller],
                ['uf', 'Estado', d.byState],
                ['regiao', 'Região', d.byRegion],
                ['origem', 'Origem', d.byOrigin],
                ['tipo', 'Tipo de cliente', d.byCustomerType],
              ] as const
            ).map(([id, label, rows]) => (
              <TabsContent key={id} value={id}>
                <Section title={`Leads por ${label.toLowerCase()}`}>
                  <DataTable rows={rows as BreakdownRow[]} columns={breakdownColumns(label)} rowKey={(r) => r.key} exportName={`mkt-leads-${id}`} initialSort="leads" />
                </Section>
              </TabsContent>
            ))}
            <TabsContent value="tempos">
              <Section title="Tempos por vendedor" description="Média (e mediana) do lead até o 1º atendimento, até a oportunidade e até a venda.">
                <DataTable
                  rows={d.bySellerTiming}
                  rowKey={(r) => r.key}
                  exportName="mkt-tempos-vendedor"
                  initialSort="leads"
                  columns={[
                    { key: 'label', label: 'Vendedor', value: (r) => r.label },
                    { key: 'leads', label: 'Leads', unit: 'int', value: (r) => r.leads },
                    { key: 'fc', label: '1º atendimento (média)', unit: 'int', value: (r) => r.firstContact.avgHours, render: (r) => hoursText(r.firstContact.avgHours), csv: (r) => r.firstContact.avgHours },
                    { key: 'fcm', label: '1º atendimento (mediana)', unit: 'int', value: (r) => r.firstContact.medianHours, render: (r) => hoursText(r.firstContact.medianHours), csv: (r) => r.firstContact.medianHours, className: 'hidden md:table-cell' },
                    { key: 'op', label: 'Até oportunidade', unit: 'int', value: (r) => r.opportunity.avgHours, render: (r) => hoursText(r.opportunity.avgHours), csv: (r) => r.opportunity.avgHours },
                    { key: 'sa', label: 'Até venda', unit: 'int', value: (r) => r.sale.avgHours, render: (r) => hoursText(r.sale.avgHours), csv: (r) => r.sale.avgHours },
                  ]}
                />
              </Section>
            </TabsContent>
          </Tabs>

          <Section title="Leads sem atendimento" description="Os 50 mais recentes do período, em negociação e sem nenhuma ação registrada (os importados ficam de fora).">
            <DataTable
              rows={d.unattended}
              rowKey={(r) => r.id}
              exportName="mkt-leads-sem-atendimento"
              empty="Nenhum lead sem atendimento no período."
              columns={[
                { key: 'leadAt', label: 'Entrada', value: (r) => r.leadAt, render: (r) => formatDateTime(r.leadAt) },
                { key: 'channel', label: 'Canal', value: (r) => r.channel },
                { key: 'campaign', label: 'Campanha', value: (r) => r.campaign, className: 'hidden md:table-cell' },
                { key: 'seller', label: 'Vendedor', value: (r) => r.seller ?? 'Sem vendedor' },
                { key: 'state', label: 'UF', value: (r) => r.state, className: 'hidden sm:table-cell' },
                {
                  key: 'open',
                  label: 'Atendimento',
                  value: () => null,
                  render: (r) =>
                    can('pre_vendas', 'view') ? (
                      <Link className="text-sm underline underline-offset-4" to={`/pre-vendas?abrir=${r.id}`}>
                        Abrir
                      </Link>
                    ) : (
                      '—'
                    ),
                  csv: (r) => r.id,
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
