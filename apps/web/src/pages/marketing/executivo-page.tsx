import { useState } from 'react'
import { Link } from 'react-router'
import { DataNotes, DataTable, KpiCard, Section, TrendChart } from '@/components/marketing/blocos'
import { breakdownColumns, MktPage } from '@/components/marketing/shell'
import { ErrorState, TableSkeleton } from '@/components/page'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type BreakdownRow, fmt, type Kpi, MKT_BASE, type Meta, useMkt, useMktFilters } from '@/lib/marketing'

interface Executive extends Meta {
  kpis: Kpi[]
  buckets: string[]
  totals: { crmSales: number; crmRevenue: number; storeOrders: number; storeRevenue: number; estimatedSaleDates: number; newCustomers: number; platformConversions: number; impressions: number; clicks: number }
  investmentByPlatform: { channel: string; label: string; connected: boolean; cost: number | null }[]
  byChannel: BreakdownRow[]
  byCampaign: BreakdownRow[]
  bySeller: BreakdownRow[]
  byState: BreakdownRow[]
  byRegion: BreakdownRow[]
  byUnit: BreakdownRow[]
  byBrand: BreakdownRow[]
  byPartType: BreakdownRow[]
}

/** Dashboard executivo (diretoria): indicadores consolidados, com comparação, histórico e as quebras que pedem decisão. */
export function ExecutivoPage() {
  const { params, qs, set } = useMktFilters()
  const q = useMkt<Executive>('executivo', qs)
  const [selected, setSelected] = useState('faturamento')
  const d = q.data
  const k = d?.kpis.find((x) => x.id === selected) ?? d?.kpis[0]
  return (
    <MktPage title="Dashboard executivo" description="Investimento, leads, vendas e retorno de todos os canais, com o período anterior e a tendência." params={params} set={set}>
      {q.isLoading && <TableSkeleton rows={8} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && k && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {d.kpis.map((x) => (
              <KpiCard key={x.id} k={x} onClick={x.value === null ? undefined : () => setSelected(x.id)} active={x.id === k.id} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Clique num indicador para ver a evolução dele no gráfico abaixo.</p>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <TrendChart title={`${k.label}: evolução`} description="Histórico no período, pelo agrupamento escolhido." buckets={d.buckets} series={k.series} unit={k.unit} granularity={d.granularity} kind={k.unit === 'int' || k.id === 'faturamento' || k.id === 'investimento' ? 'bar' : 'line'} />
            </div>
            <Card>
              <CardContent className="space-y-3 px-4 text-sm">
                <p className="font-medium">Composição das vendas</p>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Vendas do CRM (Pré-Vendas)</dt>
                  <dd className="text-right tabular-nums">{fmt(d.totals.crmSales, 'int')} · {fmt(d.totals.crmRevenue, 'brl')}</dd>
                  <dt className="text-muted-foreground">Pedidos da loja (sem repetir o CRM)</dt>
                  <dd className="text-right tabular-nums">{d.storeIncluded ? `${fmt(d.totals.storeOrders, 'int')} · ${fmt(d.totals.storeRevenue, 'brl')}` : 'fora do filtro'}</dd>
                  <dt className="text-muted-foreground">Clientes novos (1ª compra)</dt>
                  <dd className="text-right tabular-nums">{fmt(d.totals.newCustomers, 'int')}</dd>
                  <dt className="text-muted-foreground">Vendas com data estimada</dt>
                  <dd className="text-right tabular-nums">{fmt(d.totals.estimatedSaleDates, 'int')}</dd>
                </dl>
                <p className="font-medium">Investimento por plataforma</p>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  {d.investmentByPlatform.map((p) => (
                    <div key={p.channel} className="contents">
                      <dt className="text-muted-foreground">{p.label}</dt>
                      <dd className="text-right tabular-nums">{p.connected ? fmt(p.cost, 'brl') : 'não conectado'}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">Conversões contadas pelo Google: {fmt(d.totals.platformConversions, 'int')} (não somam com as vendas do CRM).</p>
              </CardContent>
            </Card>
          </div>

          <Section title="Retorno por canal" description="Leads, vendas e faturamento por canal de origem. Investimento, CPL e ROAS só onde há custo conectado.">
            <DataTable rows={d.byChannel} columns={breakdownColumns('Canal', { cost: true })} rowKey={(r) => r.key} exportName="mkt-canais" initialSort="revenue" />
          </Section>

          <Section title="Receita por campanha (maiores)" description={<>As 15 com mais faturamento. A lista completa está em <Link className="underline" to={`${MKT_BASE}/campanhas?${qs}`}>Análise de campanhas</Link>.</>}>
            <DataTable rows={d.byCampaign} columns={breakdownColumns('Campanha', { cost: true, qs, campaignLinks: true })} rowKey={(r) => r.key} exportName="mkt-campanhas-top" initialSort="revenue" />
          </Section>

          <Tabs defaultValue="vendedor">
            <TabsList className="flex-wrap">
              <TabsTrigger value="vendedor">Por vendedor</TabsTrigger>
              <TabsTrigger value="uf">Por estado</TabsTrigger>
              <TabsTrigger value="regiao">Por região</TabsTrigger>
              <TabsTrigger value="filial">Por filial</TabsTrigger>
              <TabsTrigger value="marca">Por marca</TabsTrigger>
              <TabsTrigger value="peca">Por peça</TabsTrigger>
            </TabsList>
            {(
              [
                ['vendedor', 'Vendedor', d.bySeller],
                ['uf', 'Estado', d.byState],
                ['regiao', 'Região', d.byRegion],
                ['filial', 'Filial', d.byUnit],
                ['marca', 'Marca', d.byBrand],
                ['peca', 'Tipo de peça', d.byPartType],
              ] as const
            ).map(([id, label, rows]) => (
              <TabsContent key={id} value={id}>
                <Section title={`Receita por ${label.toLowerCase()}`} description={id === 'marca' || id === 'peca' ? 'Um atendimento com várias marcas ou peças conta em cada uma: a soma passa do total.' : undefined}>
                  <DataTable rows={rows as BreakdownRow[]} columns={breakdownColumns(label)} rowKey={(r) => r.key} exportName={`mkt-por-${id}`} initialSort="revenue" />
                </Section>
              </TabsContent>
            ))}
          </Tabs>

          <DataNotes meta={d} />
        </>
      )}
    </MktPage>
  )
}
