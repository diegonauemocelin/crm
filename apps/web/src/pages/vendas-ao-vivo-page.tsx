import { useQuery } from '@tanstack/react-query'
import { ActivityIcon, ShoppingCartIcon, StoreIcon, UserRoundCheckIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { TrendChart } from '@/components/marketing/ui'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { money, moneyShort, num } from '@/lib/marketing'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'

type Origin = 'tudo' | 'atendimento' | 'ecommerce' | 'marketplace'
type Source = Exclude<Origin, 'tudo'>
interface Totals {
  sales: number
  orders: number
  ticket: number
}
interface Live {
  now: string
  origin: Origin
  today: Totals
  yesterdaySameTime: Totals
  yesterday: Totals
  bySource: (Totals & { source: Source })[]
  hours: { hour: number; today: number; yesterday: number }[]
  feed: { source: Source; at: string; value: number; title: string; city: string | null; state: string | null; who: string | null }[]
}

const ORIGINS: { key: Origin; label: string }[] = [
  { key: 'tudo', label: 'Tudo junto' },
  { key: 'atendimento', label: 'Atendimento' },
  { key: 'ecommerce', label: 'E-commerce' },
  { key: 'marketplace', label: 'Marketplace' },
]
const SOURCE: Record<Source, { label: string; icon: typeof StoreIcon; cls: string }> = {
  atendimento: { label: 'Atendimento', icon: UserRoundCheckIcon, cls: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200' },
  ecommerce: { label: 'E-commerce', icon: ShoppingCartIcon, cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200' },
  marketplace: { label: 'Marketplace', icon: StoreIcon, cls: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200' },
}
const REFRESH_MS = 30_000

const delta = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null)
const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const isToday = (iso: string, now: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) === new Date(now).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

/**
 * Vendas em tempo real: o que entrou hoje (atendimento, e-commerce e marketplace, juntos ou separados), comparado com
 * ontem até a mesma hora, por hora, e as últimas vendas. Atualiza sozinho a cada 30 segundos; venda nova pisca na lista.
 */
export function VendasAoVivoPage() {
  usePageTitle('Vendas em tempo real')
  const [origin, setOrigin] = useState<Origin>('tudo')
  const q = useQuery({ queryKey: ['vendas-ao-vivo', origin], queryFn: () => api.get<Live>(`/marketing/ao-vivo?origem=${origin}`), refetchInterval: REFRESH_MS, refetchIntervalInBackground: false })
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const keyOf = (s: Live['feed'][number]) => `${s.source}|${s.at}|${s.title}|${s.value}`
  useEffect(() => {
    if (!q.data) return
    const keys = q.data.feed.map(keyOf)
    // Na primeira carga (ou ao trocar a origem) nada é "novo"; depois, o que não estava na lista pisca.
    if (seen.current) setFresh(new Set(keys.filter((k) => !seen.current!.has(k))))
    seen.current = new Set(keys)
  }, [q.data])
  useEffect(() => {
    seen.current = null
  }, [origin])

  const d = q.data
  return (
    <RequirePermission module="relatorios">
      <PageHeader
        title="Vendas em tempo real"
        description={`Vendas de hoje em todos os canais, comparadas com ontem até a mesma hora. Atualiza sozinho a cada 30 segundos${d ? ` (última: ${time(d.now)})` : ''}.`}
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Origem">
          {ORIGINS.map((o) => (
            <Button key={o.key} size="sm" role="tab" aria-selected={origin === o.key} variant={origin === o.key ? 'default' : 'outline'} onClick={() => setOrigin(o.key)}>
              {o.label}
            </Button>
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn('size-2 rounded-full bg-emerald-500', q.isFetching && 'animate-pulse')} /> ao vivo
          </span>
        </div>
        {q.isLoading && <TableSkeleton rows={6} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {d && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Vendido hoje" value={money(d.today.sales)} change={delta(d.today.sales, d.yesterdaySameTime.sales)} hint={`ontem até esta hora: ${money(d.yesterdaySameTime.sales)}`} big />
              <Stat label="Vendas hoje" value={num(d.today.orders)} change={delta(d.today.orders, d.yesterdaySameTime.orders)} hint={`ontem até esta hora: ${num(d.yesterdaySameTime.orders)}`} />
              <Stat label="Ticket médio hoje" value={money(d.today.ticket)} hint={`ontem: ${money(d.yesterday.ticket)}`} />
              <Stat label="Ontem (dia inteiro)" value={money(d.yesterday.sales)} hint={`${num(d.yesterday.orders)} venda(s)`} />
            </div>
            {origin === 'tudo' && (
              <div className="grid gap-3 sm:grid-cols-3">
                {d.bySource.map((s) => {
                  const S = SOURCE[s.source]
                  return (
                    <Card key={s.source} className="gap-1 p-4">
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <S.icon className="size-4" /> {S.label}
                      </p>
                      <p className="text-xl font-semibold tabular-nums">{money(s.sales)}</p>
                      <p className="text-xs text-muted-foreground">{num(s.orders)} venda(s) hoje</p>
                    </Card>
                  )
                })}
              </div>
            )}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <TrendChart
                title="Vendas por hora"
                description="Hoje x ontem, no horário de Brasília."
                kind="bar"
                format={moneyShort}
                data={d.hours.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}h`, today: h.today, yesterday: h.yesterday }))}
                series={[
                  { key: 'yesterday', label: 'Ontem', color: 'var(--chart-4)' },
                  { key: 'today', label: 'Hoje', color: 'var(--chart-1)' },
                ]}
              />
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ActivityIcon className="size-4" /> Últimas vendas
                  </CardTitle>
                  <CardDescription>As mais novas primeiro (hoje e ontem).</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ul className="max-h-[22rem] divide-y overflow-auto">
                    {d.feed.map((s) => {
                      const S = SOURCE[s.source]
                      const k = keyOf(s)
                      return (
                        <li key={k} className={cn('flex items-center gap-3 px-4 py-2 text-sm transition-colors', fresh.has(k) && 'animate-pulse bg-primary/10')}>
                          <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{isToday(s.at, d.now) ? time(s.at) : 'ontem'}</span>
                          <Badge variant="secondary" className={cn('shrink-0 border-0', S.cls)}>
                            {S.label}
                          </Badge>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{s.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{[s.who, [s.city, s.state].filter(Boolean).join('/')].filter(Boolean).join(' · ') || '—'}</span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">{money(s.value)}</span>
                        </li>
                      )
                    })}
                    {!d.feed.length && <li className="px-4 py-6 text-center text-muted-foreground">Nenhuma venda hoje ou ontem nesta origem.</li>}
                  </ul>
                </CardContent>
              </Card>
            </div>
            <p className="text-xs text-muted-foreground">
              Atendimento: venda marcada no Pré-Vendas (na hora em que foi marcada). E-commerce e marketplace: pedidos pagos que chegam pela integração da loja virtual (o canal do pedido diz se é
              marketplace).
            </p>
          </>
        )}
      </div>
    </RequirePermission>
  )
}

function Stat({ label, value, change, hint, big }: { label: string; value: string; change?: number | null; hint?: string; big?: boolean }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('font-semibold tabular-nums', big ? 'text-3xl' : 'text-2xl')}>{value}</p>
      <p className="text-xs text-muted-foreground">
        {change !== undefined && change !== null && <span className={cn('mr-1 font-medium', change >= 0 ? 'text-emerald-600' : 'text-red-600')}>{change >= 0 ? `+${change}%` : `${change}%`}</span>}
        {hint}
      </p>
    </Card>
  )
}
