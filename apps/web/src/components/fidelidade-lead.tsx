import { useQuery } from '@tanstack/react-query'
import { AwardIcon } from 'lucide-react'
import { Link } from 'react-router'
import { ErrorState, TableSkeleton } from '@/components/page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { num } from '@/lib/format'
import { LevelBadge, type Summary, SummaryView } from '@/pages/marketing/fidelidade'

const useLoyalty = (leadId: string, enabled: boolean) => useQuery({ queryKey: ['fidelidade', 'lead', leadId], queryFn: () => api.get<Summary>(`/marketing/fidelidade/lead/${leadId}`), enabled })

/** Saldo e nível do cliente na Fidelidade (coluna da ficha do lead). */
export function FidelidadeLeadCard({ leadId }: { leadId: string }) {
  const { can } = useAuth()
  const q = useLoyalty(leadId, can('fidelidade', 'view'))
  if (!can('fidelidade', 'view') || !q.data?.member) return null
  const m = q.data.member
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AwardIcon className="size-4" /> Fidelidade
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Saldo</span>
          <span className="font-semibold tabular-nums">{num(m.balance)} pontos</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Nível</span>
          <LevelBadge level={m.level} />
        </div>
        {m.nextLevel && <p className="text-xs text-muted-foreground">Faltam {num(m.missing)} para {m.nextLevel.name}.</p>}
        {m.optedOut && <p className="text-xs text-amber-700">Saiu do programa.</p>}
        <Link to={`/fidelidade?aba=clientes&lead=${leadId}`} className="text-xs underline">
          Abrir na Fidelidade
        </Link>
      </CardContent>
    </Card>
  )
}

/** Aba Fidelidade da ficha do lead: extrato, resgates e avaliações. */
export function FidelidadeLeadTab({ leadId }: { leadId: string }) {
  const q = useLoyalty(leadId, true)
  if (q.isLoading) return <TableSkeleton rows={4} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data?.member) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Este lead ainda não está no programa de fidelidade (entra com o primeiro pedido pago da loja virtual).</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <SummaryView s={q.data}>
          <Link to={`/fidelidade?aba=clientes&lead=${leadId}`} className="text-sm underline">
            Ajustar pontos, resgatar ou enviar o link ao cliente
          </Link>
        </SummaryView>
      </CardContent>
    </Card>
  )
}
