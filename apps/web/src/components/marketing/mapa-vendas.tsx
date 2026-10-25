import brazilMap from '@svg-maps/brazil'
import { useQuery } from '@tanstack/react-query'
import { MapIcon } from 'lucide-react'
import { useState } from 'react'
import { ErrorState, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { money, num, useMktFilters } from '@/lib/marketing'
import { cn } from '@/lib/utils'

interface Cell {
  sales: number
  orders: number
  attendances: number
}
interface MapData {
  period: { from: string; to: string }
  origin: Origin
  states: (Cell & { uf: string; cities: (Cell & { city: string })[] })[]
  totals: Cell
  noState: Cell
}
/** Desenho do mapa: um caminho SVG por estado (id = sigla em minúsculas). */
const brazil = brazilMap as { viewBox: string; locations: { id: string; name: string; path: string }[] }

type Origin = 'tudo' | 'atendimento' | 'ecommerce' | 'marketplace'
type Mode = 'vendas' | 'alcance'

const ORIGINS: { key: Origin; label: string }[] = [
  { key: 'tudo', label: 'Tudo junto' },
  { key: 'atendimento', label: 'Atendimento' },
  { key: 'ecommerce', label: 'E-commerce' },
  { key: 'marketplace', label: 'Marketplace' },
]

/** Intensidade da cor (0 a 1) em raiz quadrada: estados pequenos ainda aparecem ao lado dos grandes. */
const level = (v: number, max: number) => (v > 0 && max > 0 ? 0.18 + 0.82 * Math.sqrt(v / max) : 0)
const fillOf = (t: number) => (t ? `color-mix(in srgb, var(--primary) ${Math.round(t * 100)}%, transparent)` : 'transparent')

/**
 * Mapa do Brasil por estado: a cor fica mais forte conforme o valor vendido (ou o alcance: vendas + atendimentos) e
 * estado sem nada fica sem cor. Passar o mouse mostra os números; clicar lista as cidades.
 * Desenho do mapa: @svg-maps/brazil (Victor Cazanave, CC BY 4.0).
 */
export function MapaVendas() {
  const f = useMktFilters()
  const [origin, setOrigin] = useState<Origin>('tudo')
  const [mode, setMode] = useState<Mode>('vendas')
  const [hover, setHover] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const q = new URLSearchParams(f.query)
  const de = q.get('de') ?? ''
  const ate = q.get('ate') ?? ''
  const data = useQuery({ queryKey: ['marketing-mapa', de, ate, origin], queryFn: () => api.get<MapData>(`/marketing/mapa?de=${de}&ate=${ate}&origem=${origin}`) })
  const byUf = new Map((data.data?.states ?? []).map((s) => [s.uf, s]))
  const metric = (c: Cell | undefined) => (!c ? 0 : mode === 'vendas' ? c.sales : c.orders + c.attendances)
  const max = Math.max(0, ...(data.data?.states ?? []).map(metric))
  const shown = hover ?? picked
  const cur = shown ? byUf.get(shown) : undefined
  const sel = picked ? byUf.get(picked) : undefined
  const nameOf = (uf: string) => brazil.locations.find((l) => l.id === uf.toLowerCase())?.name ?? uf

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MapIcon className="size-4" /> Mapa de vendas
          </CardTitle>
          <CardDescription>{mode === 'vendas' ? 'Onde a empresa vendeu: quanto mais forte a cor, maior o valor. Sem venda, sem cor.' : 'Onde a empresa já chegou: vendas e atendimentos de cada estado.'}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={mode === 'vendas' ? 'default' : 'outline'} onClick={() => setMode('vendas')}>
            Vendas (R$)
          </Button>
          <Button size="sm" variant={mode === 'alcance' ? 'default' : 'outline'} onClick={() => setMode('alcance')}>
            Onde já cheguei
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Origem">
          {ORIGINS.map((o) => (
            <Button key={o.key} size="sm" role="tab" aria-selected={origin === o.key} variant={origin === o.key ? 'secondary' : 'ghost'} onClick={() => setOrigin(o.key)}>
              {o.label}
            </Button>
          ))}
        </div>
        {data.isLoading && <TableSkeleton rows={4} />}
        {data.error && <ErrorState error={data.error} onRetry={() => data.refetch()} />}
        {data.data && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="relative">
              <svg viewBox={brazil.viewBox} className="h-auto w-full" role="img" aria-label="Mapa do Brasil por estado">
                {brazil.locations.map((l) => {
                  const uf = l.id.toUpperCase()
                  const c = byUf.get(uf)
                  const t = level(metric(c), max)
                  return (
                    <path
                      key={l.id}
                      d={l.path}
                      tabIndex={0}
                      aria-label={`${l.name}: ${money(c?.sales ?? 0)}`}
                      className={cn('cursor-pointer stroke-border outline-none transition-[fill]', (picked === uf || hover === uf) && 'stroke-foreground')}
                      style={{ fill: fillOf(t), strokeWidth: picked === uf || hover === uf ? 2 : 1 }}
                      onMouseEnter={() => setHover(uf)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(uf)}
                      onBlur={() => setHover(null)}
                      onClick={() => setPicked(picked === uf ? null : uf)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPicked(picked === uf ? null : uf)}
                    />
                  )
                })}
              </svg>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>Sem {mode === 'vendas' ? 'venda' : 'registro'}</span>
                <span className="h-2.5 w-4 rounded-sm border" />
                <span className="h-2.5 w-28 rounded-sm" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--primary) 18%, transparent), var(--primary))' }} />
                <span>{mode === 'vendas' ? money(max) : `${num(max)} (máx.)`}</span>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border p-3">
                <p className="font-medium">{shown ? nameOf(shown) : 'Brasil (todos os estados)'}</p>
                <dl className="mt-1 grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Vendas</dt>
                    <dd className="font-semibold tabular-nums">{money((shown ? cur?.sales : data.data.totals.sales) ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Pedidos</dt>
                    <dd className="font-semibold tabular-nums">{num((shown ? cur?.orders : data.data.totals.orders) ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Atendimentos</dt>
                    <dd className="font-semibold tabular-nums">{num((shown ? cur?.attendances : data.data.totals.attendances) ?? 0)}</dd>
                  </div>
                </dl>
              </div>
              {sel ? (
                <div className="rounded-lg border">
                  <p className="border-b px-3 py-2 font-medium">Cidades de {nameOf(sel.uf)}</p>
                  <ul className="max-h-64 divide-y overflow-auto">
                    {sel.cities.map((c) => (
                      <li key={c.city} className="flex justify-between gap-2 px-3 py-1.5">
                        <span className="truncate">{c.city}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {money(c.sales)} · {num(c.orders + c.attendances)}
                        </span>
                      </li>
                    ))}
                    {!sel.cities.length && <li className="px-3 py-2 text-muted-foreground">Sem cidade informada.</li>}
                  </ul>
                </div>
              ) : (
                <div className="rounded-lg border">
                  <p className="border-b px-3 py-2 font-medium">Estados</p>
                  <ul className="max-h-64 divide-y overflow-auto">
                    {data.data.states.map((s) => (
                      <li key={s.uf}>
                        <button type="button" className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted" onClick={() => setPicked(s.uf)}>
                          <span>{nameOf(s.uf)}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {money(s.sales)} · {num(s.orders + s.attendances)}
                          </span>
                        </button>
                      </li>
                    ))}
                    {!data.data.states.length && <li className="px-3 py-2 text-muted-foreground">Nenhuma venda ou atendimento com estado no período.</li>}
                  </ul>
                </div>
              )}
              {(data.data.noState.orders > 0 || data.data.noState.attendances > 0) && (
                <p className="text-xs text-muted-foreground">
                  Sem estado informado (fora do mapa): {money(data.data.noState.sales)} em {num(data.data.noState.orders)} venda(s) e {num(data.data.noState.attendances)} atendimento(s).
                </p>
              )}
              <p className="text-xs text-muted-foreground">Clique num estado para ver as cidades. E-commerce e marketplace usam o estado do cliente do pedido. Mapa: @svg-maps/brazil (CC BY 4.0).</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
