import { Link } from 'react-router'
import { DataNotes, DataTable, Section, Variation } from '@/components/marketing/blocos'
import { MktPage } from '@/components/marketing/shell'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Card, CardContent } from '@/components/ui/card'
import { fmt, type Meta, useMkt, useMktFilters, variationOf } from '@/lib/marketing'

interface Totals {
  sent: number
  failed: number
  opened: number
  clicked: number
  unsubscribed: number
  delivered: number
  attempted: number
  deliveryRate: number | null
  openRate: number | null
  clickRate: number | null
  unsubscribeRate: number | null
  sales: number
  revenue: number
}
interface EmailData extends Meta {
  openNote: string
  totals: Totals
  previous: Totals
  campaigns: (Totals & { id: string; name: string; subject: string; kind: 'campanha' | 'automacao'; firstSent: string | null })[]
}

function Box({ label, value, now, before, unit, better = 'up', hint }: { label: string; value: string; now: number | null; before: number | null; unit: 'int' | 'pct' | 'brl'; better?: 'up' | 'down'; hint?: string }) {
  return (
    <Card className="gap-1 py-3">
      <CardContent className="space-y-1 px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <Variation k={{ value: now, previous: before, variation: variationOf(now, before), better }} />
        <p className="text-xs text-muted-foreground">Anterior: {fmt(before, unit)}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/** E-mail marketing (a ferramenta do próprio CRM): entregas, aberturas registradas, cliques, descadastros e vendas de quem clicou. */
export function MktEmailPage() {
  const { params, qs, set } = useMktFilters()
  const q = useMkt<EmailData>('email', qs)
  const d = q.data
  const t = d?.totals
  const p = d?.previous
  return (
    <MktPage title="E-mail marketing" description="Resultados das campanhas e automações enviadas pelo CRM, com as vendas de quem clicou." params={params} set={set} compact>
      {q.isLoading && <TableSkeleton rows={8} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && t && p && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Box label="Entregues" value={fmt(t.delivered, 'int')} now={t.delivered} before={p.delivered} unit="int" hint={`${fmt(t.deliveryRate, 'pct')} das tentativas`} />
            <Box label="Rejeitados (falha)" value={fmt(t.failed, 'int')} now={t.failed} before={p.failed} unit="int" better="down" />
            <Box label="Abertura registrada" value={fmt(t.openRate, 'pct')} now={t.openRate} before={p.openRate} unit="pct" hint="Não é leitura real (veja a nota)." />
            <Box label="Cliques" value={fmt(t.clickRate, 'pct')} now={t.clickRate} before={p.clickRate} unit="pct" hint={`${fmt(t.clicked, 'int')} pessoas`} />
            <Box label="Descadastros" value={fmt(t.unsubscribeRate, 'pct')} now={t.unsubscribeRate} before={p.unsubscribeRate} unit="pct" better="down" hint={`${fmt(t.unsubscribed, 'int')} pessoas`} />
            <Box label="Vendas de quem clicou" value={fmt(t.revenue, 'brl')} now={t.revenue} before={p.revenue} unit="brl" hint={`${fmt(t.sales, 'int')} venda(s), último clique em até ${d.attribution.windowDays} dias`} />
          </div>
          <p className="text-xs text-muted-foreground">{d.openNote}</p>

          <Section title="Por campanha e automação" description={<>Detalhes de cada envio em <Link className="underline" to="/email-marketing/dashboard">Resultados do e-mail</Link>.</>}>
            <DataTable
              rows={d.campaigns}
              rowKey={(r) => r.id}
              exportName="mkt-email-campanhas"
              initialSort="firstSent"
              columns={[
                { key: 'name', label: 'Campanha', value: (r) => r.name, render: (r) => (
                  <div className="max-w-72">
                    <p className="truncate font-medium" title={r.name}>{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground" title={r.subject}>{r.kind === 'automacao' ? 'Automação · ' : ''}{r.subject}</p>
                  </div>
                ) },
                { key: 'firstSent', label: 'Primeiro envio', value: (r) => r.firstSent, render: (r) => formatDateTime(r.firstSent), className: 'hidden md:table-cell' },
                { key: 'delivered', label: 'Entregues', unit: 'int', value: (r) => r.delivered },
                { key: 'failed', label: 'Falhas', unit: 'int', value: (r) => r.failed, className: 'hidden lg:table-cell' },
                { key: 'openRate', label: 'Abertura reg.', unit: 'pct', value: (r) => r.openRate },
                { key: 'clickRate', label: 'Cliques', unit: 'pct', value: (r) => r.clickRate },
                { key: 'unsubscribeRate', label: 'Descadastro', unit: 'pct', value: (r) => r.unsubscribeRate, className: 'hidden lg:table-cell' },
                { key: 'sales', label: 'Vendas', unit: 'int', value: (r) => r.sales },
                { key: 'revenue', label: 'Faturamento', unit: 'brl', value: (r) => r.revenue },
              ]}
            />
          </Section>

          <DataNotes meta={d} />
        </>
      )}
    </MktPage>
  )
}
