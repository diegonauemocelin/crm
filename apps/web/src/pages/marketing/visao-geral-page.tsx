import { Link } from 'react-router'
import { AttentionList, DataNotes, DataTable, KpiCard, Section, SourceBadge } from '@/components/marketing/blocos'
import { breakdownColumns, MktPage } from '@/components/marketing/shell'
import { ErrorState, formatDateTime, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { type Attention, type BreakdownRow, type Kpi, MKT_BASE, type Meta, type Source, useMkt, useMktFilters } from '@/lib/marketing'

interface Overview extends Meta {
  kpis: Kpi[]
  buckets: string[]
  channels: BreakdownRow[]
  attention: Attention[]
  health: { sources: Source[] }
}

/** Visão geral: os números principais, os canais, o que pede atenção e a situação das fontes de dados. */
export function VisaoGeralPage() {
  const { params, qs, set } = useMktFilters()
  const q = useMkt<Overview>('visao-geral', qs)
  const d = q.data
  return (
    <MktPage title="Visão geral de marketing" description="Resumo do período: investimento, leads, vendas, canais, pontos de atenção e a saúde das fontes de dados." params={params} set={set}>
      {q.isLoading && <TableSkeleton rows={8} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {d.kpis.map((k) => (
              <KpiCard key={k.id} k={k} />
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Section className="xl:col-span-2" title="Canais" description="De onde vieram os leads e as vendas do período, pela regra de atribuição.">
              <DataTable rows={d.channels} columns={breakdownColumns('Canal', { cost: true })} rowKey={(r) => r.key} exportName="mkt-visao-canais" initialSort="leads" pageSize={12} />
            </Section>
            <Section title="Pontos de atenção" description="Sinais para investigar, com os números. Correlação não é prova de causa.">
              <AttentionList items={d.attention} />
            </Section>
          </div>

          <Section
            title="Fontes de dados"
            description="O que já está ligado ao módulo. As contas que faltam serão conectadas na etapa final, em Configurações."
            actions={
              <Button asChild variant="outline" size="sm">
                <Link to={`${MKT_BASE}/integracoes`}>Ver integrações e qualidade</Link>
              </Button>
            }
          >
            <ul className="grid gap-2 px-4 sm:grid-cols-2 sm:px-0 xl:grid-cols-3">
              {d.health.sources.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-2 rounded-md border p-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.lastSync ? `Último dado: ${formatDateTime(s.lastSync)}` : s.detail}</p>
                  </div>
                  <SourceBadge status={s.status} />
                </li>
              ))}
            </ul>
          </Section>

          <DataNotes meta={d} />
        </>
      )}
    </MktPage>
  )
}
