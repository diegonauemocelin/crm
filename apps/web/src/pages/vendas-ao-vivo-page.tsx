import { useQuery } from '@tanstack/react-query'
import { ActivityIcon, MaximizeIcon, ShoppingCartIcon, StoreIcon, UserRoundCheckIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { TrendChart } from '@/components/marketing/ui'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
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
  const { me } = useAuth()
  if (me?.layout === 'SISTEMAS') {
    return (
      <RequirePermission module="relatorios">
        <PainelTv d={d} origin={origin} setOrigin={setOrigin} loading={q.isLoading} error={q.error} retry={() => void q.refetch()} fetching={q.isFetching} fresh={fresh} keyOf={keyOf} />
      </RequirePermission>
    )
  }
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

/**
 * Visual "Por sistema" (telas aprovadas): painel escuro para deixar numa TV, com o total do dia em destaque, os canais,
 * hora a hora contra ontem e as últimas vendas. "Tela cheia" esconde o resto do sistema.
 */
function PainelTv({ d, origin, setOrigin, loading, error, retry, fetching, fresh, keyOf }: {
  d: Live | undefined
  origin: Origin
  setOrigin: (o: Origin) => void
  loading: boolean
  error: unknown
  retry: () => void
  fetching: boolean
  fresh: Set<string>
  keyOf: (s: Live['feed'][number]) => string
}) {
  const box = useRef<HTMLDivElement>(null)
  const full = () => {
    const el = box.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.().catch(() => undefined)
  }
  const change = d ? delta(d.today.sales, d.yesterdaySameTime.sales) : null
  const max = d ? Math.max(1, ...d.hours.map((h) => Math.max(h.today, h.yesterday))) : 1
  return (
    <div ref={box} className="-m-4 min-h-[calc(100svh-3.5rem)] space-y-5 overflow-auto bg-[#141213] p-5 text-[#f2f2f2] md:-m-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Vendas em tempo real</h1>
          <p className="flex items-center gap-2 text-sm text-[#cfc9c5]">
            <span className={cn('size-2.5 rounded-full bg-emerald-400', fetching && 'animate-pulse')} aria-hidden="true" /> Ao vivo{d ? ` · ${time(d.now)}` : ''} · atualiza a cada 30 segundos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Origem" className="flex rounded-xl border border-[#4c4849] p-1">
            {ORIGINS.map((o) => (
              <button
                key={o.key}
                type="button"
                role="tab"
                aria-selected={origin === o.key}
                onClick={() => setOrigin(o.key)}
                className={cn('min-h-9 rounded-lg px-3 text-sm font-semibold', origin === o.key ? 'bg-[color:var(--brand)] text-[color:var(--brand-foreground)]' : 'text-[#f2f2f2] hover:bg-white/10')}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Button onClick={full} className="min-h-11 bg-[color:var(--brand)] font-bold text-[color:var(--brand-foreground)] hover:opacity-90">
            <MaximizeIcon /> Tela cheia
          </Button>
        </div>
      </div>
      {loading && <p className="text-sm text-[#cfc9c5]">Carregando…</p>}
      {!!error && (
        <div className="rounded-xl bg-white p-4 text-foreground">
          <ErrorState error={error} onRetry={retry} />
        </div>
      )}
      {d && (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="space-y-5 rounded-2xl border border-[#343031] bg-[#1f1c1d] p-6">
              <p className="text-sm font-bold tracking-wider text-[#cfc9c5]">VENDIDO HOJE</p>
              <div className="flex flex-wrap items-baseline gap-4">
                <p className="text-5xl font-extrabold tracking-tight tabular-nums md:text-6xl">{money(d.today.sales)}</p>
                {change !== null && (
                  <p className={cn('text-base font-bold', change >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                    {change >= 0 ? `+${change}%` : `${change}%`} que ontem neste horário
                  </p>
                )}
              </div>
              <p className="text-sm text-[#cfc9c5]">
                {num(d.today.orders)} venda(s) hoje · ticket médio {money(d.today.ticket)} · ontem até esta hora {money(d.yesterdaySameTime.sales)} · ontem inteiro {money(d.yesterday.sales)}
              </p>
              {origin === 'tudo' && (
                <div className="grid gap-3 sm:grid-cols-3">
                  {d.bySource.map((s) => {
                    const S = SOURCE[s.source]
                    return (
                      <div key={s.source} className="space-y-1 rounded-xl bg-[#2a2627] p-4">
                        <p className="flex items-center gap-1.5 text-sm text-[#cfc9c5]">
                          <S.icon className="size-4" /> {S.label}
                        </p>
                        <p className="text-2xl font-extrabold tabular-nums">{money(s.sales)}</p>
                        <p className="text-sm text-[#cfc9c5]">{num(s.orders)} venda(s)</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
            <section className="space-y-3 rounded-2xl border border-[#343031] bg-[#1f1c1d] p-6">
              <p className="text-sm font-bold tracking-wider text-[#cfc9c5]">ÚLTIMAS VENDAS</p>
              <ul className="max-h-[26rem] space-y-2 overflow-auto">
                {d.feed.map((s) => {
                  const S = SOURCE[s.source]
                  const k = keyOf(s)
                  return (
                    <li key={k} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5', fresh.has(k) ? 'animate-pulse border-[color:var(--brand)] bg-[#2e2a2b]' : 'border-transparent bg-[#262223]')}>
                      <span className="shrink-0 rounded-md bg-[#f2f2f2] px-2 py-0.5 text-[11px] font-extrabold text-[#0d0d0d]">{S.label}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{s.title}</span>
                        <span className="block truncate text-xs text-[#cfc9c5]">
                          {[s.who, [s.city, s.state].filter(Boolean).join('/')].filter(Boolean).join(' · ') || '—'} · {isToday(s.at, d.now) ? time(s.at) : 'ontem'}
                        </span>
                      </span>
                      <span className="shrink-0 font-extrabold tabular-nums">{money(s.value)}</span>
                    </li>
                  )
                })}
                {!d.feed.length && <li className="py-6 text-center text-sm text-[#cfc9c5]">Nenhuma venda hoje ou ontem nesta origem.</li>}
              </ul>
            </section>
          </div>
          <section className="space-y-4 rounded-2xl border border-[#343031] bg-[#1f1c1d] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-bold tracking-wider text-[#cfc9c5]">HORA A HORA</p>
              <div className="flex gap-4 text-sm text-[#cfc9c5]">
                <span className="flex items-center gap-1.5"><i className="inline-block size-3 rounded-sm bg-[color:var(--brand)]" />Hoje</span>
                <span className="flex items-center gap-1.5"><i className="inline-block size-3 rounded-sm bg-[#6e6869]" />Ontem</span>
              </div>
            </div>
            <div role="img" aria-label="Vendas por hora, hoje comparado com ontem" className="flex h-56 items-end gap-2 border-b border-[#343031]">
              {d.hours.map((h) => (
                <div key={h.hour} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                  <div className="flex w-full items-end justify-center gap-0.5">
                    <div title={`${h.hour}h ontem: ${money(h.yesterday)}`} className="w-2/5 max-w-4 rounded-t bg-[#6e6869]" style={{ height: `${Math.round((h.yesterday / max) * 190)}px` }} />
                    <div title={`${h.hour}h hoje: ${money(h.today)}`} className="w-2/5 max-w-4 rounded-t bg-[color:var(--brand)]" style={{ height: `${Math.round((h.today / max) * 190)}px` }} />
                  </div>
                  <span className="text-[11px] text-[#cfc9c5]">{String(h.hour).padStart(2, '0')}h</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

