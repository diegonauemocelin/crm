import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { PageHeader, RequirePermission } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { type BreakdownRow, campaignPath } from '@/lib/marketing'
import { MktFilters } from './filtros'
import type { Column } from './blocos'

/** Moldura das telas do Marketing Inteligente: permissão, título e filtros globais. */
export function MktPage({ title, description, module = 'mkt_paineis', params, set, compact, actions, children }: { title: string; description: string; module?: string; params?: URLSearchParams; set?: (p: Record<string, string | null>) => void; compact?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <RequirePermission module={module}>
      <div>
        <PageHeader
          title={title}
          description={description}
          actions={
            <>
              <Badge variant="outline" className="font-normal">
                Marketing Inteligente
              </Badge>
              {actions}
            </>
          }
        />
        <div className="space-y-4">
          {params && set && <MktFilters params={params} set={set} compact={compact} />}
          {children}
        </div>
      </div>
    </RequirePermission>
  )
}

/** Colunas padrão de uma quebra (canal, campanha, vendedor, estado...). `cost` inclui investimento, CPL e ROAS. */
export function breakdownColumns(dimLabel: string, opts: { cost?: boolean; media?: boolean; qs?: string; campaignLinks?: boolean } = {}): Column<BreakdownRow>[] {
  const cols: Column<BreakdownRow>[] = [
    {
      key: 'label',
      label: dimLabel,
      value: (r) => r.label,
      className: 'max-w-72',
      render: (r) =>
        opts.campaignLinks && r.key !== '__loja' ? (
          <Link to={campaignPath(r.key, opts.qs ?? '')} className="block truncate font-medium underline-offset-4 hover:underline" title={r.label}>
            {r.label}
          </Link>
        ) : (
          <span className="block truncate font-medium" title={r.label}>
            {r.label}
          </span>
        ),
    },
  ]
  if (opts.cost) cols.push({ key: 'cost', label: 'Investimento', unit: 'brl', value: (r) => r.cost })
  if (opts.media) {
    cols.push({ key: 'impressions', label: 'Impressões', unit: 'int', value: (r) => r.impressions, className: 'hidden xl:table-cell' })
    cols.push({ key: 'clicks', label: 'Cliques', unit: 'int', value: (r) => r.clicks, className: 'hidden lg:table-cell' })
    cols.push({ key: 'ctr', label: 'CTR', unit: 'pct', value: (r) => r.ctr, className: 'hidden xl:table-cell' })
    cols.push({ key: 'cpc', label: 'CPC', unit: 'brl', value: (r) => r.cpc, className: 'hidden xl:table-cell' })
  }
  cols.push(
    { key: 'leads', label: 'Leads', unit: 'int', value: (r) => r.leads },
    { key: 'qualified', label: 'Qualificados', unit: 'int', value: (r) => r.qualified, className: 'hidden md:table-cell' },
    { key: 'opportunities', label: 'Oportunidades', unit: 'int', value: (r) => r.opportunities, className: 'hidden lg:table-cell' },
    { key: 'sales', label: 'Vendas', unit: 'int', value: (r) => r.sales },
    { key: 'revenue', label: 'Faturamento', unit: 'brl', value: (r) => r.revenue },
    { key: 'conversion', label: 'Conversão', unit: 'pct', value: (r) => r.conversion, className: 'hidden md:table-cell' },
  )
  if (opts.cost) {
    cols.push({ key: 'cpl', label: 'CPL', unit: 'brl', value: (r) => r.cpl })
    cols.push({ key: 'roas', label: 'ROAS', unit: 'x', value: (r) => r.roas })
  }
  if (opts.media) cols.push({ key: 'platformConversions', label: 'Conv. na plataforma', unit: 'int', value: (r) => r.platformConversions, className: 'hidden xl:table-cell' })
  cols.push({ key: 'ticket', label: 'Ticket médio', unit: 'brl', value: (r) => r.ticket, className: 'hidden lg:table-cell' })
  return cols
}
