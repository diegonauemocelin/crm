import { useQuery } from '@tanstack/react-query'
import { GiftIcon } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { todaySP } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Mine {
  month: string
  seller: string | null
  items: { giftId: string; name: string; quota: number; used: number; remaining: number; active: boolean }[]
  deliveries: { id: string; date: string; gift: string; customerCode: string; customerName: string | null; quantity: number; notes: string | null }[]
}

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const dateBR = (d: string) => d.split('-').reverse().join('/')

/** Atendimento Comercial › Meus brindes: o vendedor consulta o saldo do mês, o que usou e para quem. */
export function MeusBrindesPage() {
  const [month, setMonth] = useState(() => todaySP().slice(0, 7))
  const q = useQuery({ queryKey: ['brindes', 'meus', month], queryFn: () => api.get<Mine>(`/marketing/brindes/meus?mes=${month}`) })
  const d = q.data

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meus brindes"
        description="Quantos brindes você tem livres no mês, quantos já usou e para quais clientes."
        actions={<Input type="month" aria-label="Mês" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
      />
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d?.seller ? (
        <EmptyState icon={GiftIcon} title="Seu usuário não está ligado a um vendedor" description="Peça ao administrador para ligar seu usuário ao vendedor em Cadastros de atendimento." />
      ) : (
        <>
          {!d.items.length ? (
            <EmptyState icon={GiftIcon} title="Sem cota de brindes" description="O marketing ainda não definiu brindes por mês para você." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.items.map((i) => {
                const pct = i.quota ? Math.min(100, (i.used / i.quota) * 100) : 100
                return (
                  <Card key={i.giftId}>
                    <CardHeader className="pb-2">
                      <CardDescription>{i.name}</CardDescription>
                      <CardTitle className={cn('text-3xl tabular-nums', i.remaining === 0 && 'text-muted-foreground')}>
                        {i.remaining} <span className="text-base font-normal text-muted-foreground">{i.remaining === 1 ? 'livre' : 'livres'}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={i.used} aria-valuemax={i.quota} aria-label={`${i.name}: ${i.used} de ${i.quota} usados`}>
                        <div className={cn('h-full rounded-full', i.remaining === 0 ? 'bg-muted-foreground/40' : 'bg-[color:var(--brand)]')} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Usou {i.used} de {i.quota} em {monthLabel(d.month)}
                      </p>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Para quem foi</CardTitle>
              <CardDescription>{monthLabel(d.month)}</CardDescription>
            </CardHeader>
            <CardContent>
              {!d.deliveries.length ? (
                <p className="text-sm text-muted-foreground">Nenhum brinde entregue neste mês.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Brinde</TableHead>
                        <TableHead className="text-right">Qtd.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.deliveries.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="tabular-nums">{dateBR(r.date)}</TableCell>
                          <TableCell>
                            <span className="font-medium tabular-nums">{r.customerCode}</span>
                            {r.customerName && <span className="block text-xs text-muted-foreground">{r.customerName}</span>}
                            {r.notes && <span className="block text-xs text-muted-foreground">{r.notes}</span>}
                          </TableCell>
                          <TableCell>{r.gift}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
