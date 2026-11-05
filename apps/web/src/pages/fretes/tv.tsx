import { useQuery } from '@tanstack/react-query'
import { MaximizeIcon, TruckIcon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { ErrorState, RequirePermission } from '@/components/page'
import { TvGate } from '@/components/tv-gate'
import { TvLinksButton } from '@/components/tv-links'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { board, type BoardItem, type PickupRow, span } from '@/lib/coletas'
import { ALL_UNITS, useActiveUnit } from '@/lib/fretes'
import { cn } from '@/lib/utils'

/**
 * Painel de coletas para a TV do comercial: quais transportadoras estão carregando, qual chega agora e qual em seguida,
 * e até que horas dá para tirar pedido para cada uma. O relógio é o do computador (a situação muda na hora); os
 * horários cadastrados são recarregados a cada 30 segundos.
 */
export function FretesTvPage() {
  return (
    <RequirePermission module="fretes_painel">
      <Tv />
    </RequirePermission>
  )
}

const STATUS: Record<BoardItem['status'], { label: string; chip: string; card: string }> = {
  CARREGANDO: { label: 'Carregando agora', chip: 'bg-emerald-500 text-emerald-950', card: 'border-emerald-400/70 bg-emerald-500/10' },
  CHEGANDO: { label: 'Chegando', chip: 'bg-[color:var(--brand)] text-[color:var(--brand-foreground)]', card: 'border-[color:var(--brand)] bg-[color:var(--brand)]/10' },
  EM_SEGUIDA: { label: 'Em seguida', chip: 'bg-sky-400 text-sky-950', card: 'border-sky-400/50 bg-white/[0.04]' },
  ABERTA: { label: 'Mais tarde', chip: 'bg-white/15 text-white', card: 'border-white/10 bg-white/[0.04]' },
  CORTE_ENCERRADO: { label: 'Mais tarde', chip: 'bg-white/15 text-white', card: 'border-white/10 bg-white/[0.04]' },
  COLETADO: { label: 'Coletado', chip: 'bg-white/10 text-white/60', card: 'border-white/5 bg-transparent opacity-60' },
}

type PanelData = { unit: string | null; rows: PickupRow[] }
const REFRESH = 30_000

function Tv() {
  const active = useActiveUnit()
  const { can } = useAuth()
  const unit = active.value && active.value !== ALL_UNITS ? active.value : null
  const q = useQuery({
    queryKey: ['fretes', 'painel-tv', unit],
    queryFn: () => api.get<PanelData>(`/fretes/painel-tv${unit ? `?filial=${unit}` : ''}`),
    refetchInterval: REFRESH,
  })
  return (
    <Board q={q} linkHint>
      <FilialSwitch active={active} />
      {can('fretes_painel', 'edit') && <TvLinksButton kind="COLETAS" variant="secondary" units={active.ctx.data?.units.filter((u) => u.active)} />}
    </Board>
  )
}

/** Painel aberto pelo link da TV (/tv/coletas/:token), sem login. */
export function FretesTvPublicPage() {
  const { token = '' } = useParams()
  return (
    <TvGate token={token}>
      <ColetasTv token={token} />
    </TvGate>
  )
}

function ColetasTv({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ['fretes', 'tv-publico', token],
    queryFn: () => api.get<PanelData>(`/fretes/tv/${encodeURIComponent(token)}`),
    refetchInterval: REFRESH,
    refetchIntervalInBackground: true,
    retry: (n, err) => (err as { status?: number }).status !== 404 && n < 3,
  })
  return (
    <div className="min-h-dvh bg-[#0d1117] p-4 md:p-6">
      <Board q={q} />
    </div>
  )
}

function Board({ q, children, linkHint }: { q: { data?: PanelData; error: Error | null; refetch: () => unknown }; children?: ReactNode; linkHint?: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const root = useRef<HTMLDivElement>(null)
  const items = board(q.data?.rows ?? [], now)
  return (
    <div ref={root} className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-[#0d1117] p-6 text-white md:-m-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-widest text-white/60 uppercase">Coletas de hoje{q.data?.unit ? ` · ${q.data.unit}` : ''}</p>
          <p className="text-6xl font-extrabold tabular-nums md:text-7xl">{now.toLocaleTimeString('pt-BR')}</p>
          <p className="text-lg text-white/70 capitalize">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 [&_[data-slot=select-trigger]]:bg-white/10 [&_[data-slot=select-trigger]]:text-white">
          {children}
          <Button variant="secondary" onClick={() => void root.current?.requestFullscreen?.()}>
            <MaximizeIcon aria-hidden /> Tela cheia
          </Button>
        </div>
      </header>

      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !items.length && (
        <div className="rounded-2xl border border-white/10 p-10 text-center text-white/70">
          <TruckIcon className="mx-auto mb-3 size-10" aria-hidden />
          <p className="text-xl font-semibold text-white">Nenhuma coleta hoje</p>
          {linkHint && (
            <p className="mt-1">
              Cadastre os horários em <Link to="/fretes/transportadoras" className="underline">Fretes › Transportadoras</Link> › Coletas (ponto de corte e hora da coleta).
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {items.map((i) => {
          const s = STATUS[i.status]
          const open = i.toCutoff > 0
          const urgent = open && i.toCutoff <= 30
          return (
            <article key={`${i.carrierId}-${i.unitId}-${i.pickup}`} className={cn('space-y-4 rounded-2xl border-2 p-5', s.card)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-3xl font-extrabold">{i.carrier}</h2>
                  <p className={cn('text-sm font-bold tracking-wide uppercase', i.mode === 'DESPACHO' ? 'text-amber-300' : 'text-sky-300')}>{i.mode === 'DESPACHO' ? 'Despacho · levar até a transportadora' : 'Coleta na empresa'}</p>
                  {(i.unit || i.note) && <p className="truncate text-white/60">{[i.unit, i.note].filter(Boolean).join(' · ')}</p>}
                </div>
                <span className={cn('shrink-0 rounded-full px-3 py-1 text-sm font-bold', s.chip)}>{s.label}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className={cn('rounded-xl p-3', open ? (urgent ? 'bg-red-500/20' : 'bg-white/10') : 'bg-white/5')}>
                  <p className="text-xs font-semibold tracking-widest text-white/60 uppercase">Pedido até</p>
                  <p className="text-4xl font-extrabold tabular-nums">{i.cutoff}</p>
                  <p className={cn('text-sm font-semibold', open ? (urgent ? 'text-red-300' : 'text-emerald-300') : 'text-white/50')}>{open ? `faltam ${span(i.toCutoff)}` : 'corte encerrado'}</p>
                </div>
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-xs font-semibold tracking-widest text-white/60 uppercase">{i.mode === 'DESPACHO' ? 'Despacho' : 'Coleta'}</p>
                  <p className="text-4xl font-extrabold tabular-nums">{i.pickup}</p>
                  <p className="text-sm font-semibold text-white/70">
                    {i.status === 'CARREGANDO' ? `saída em ${span(i.toPickup + i.minutes)}` : i.status === 'COLETADO' ? 'já saiu' : `chega em ${span(i.toPickup)}`}
                  </p>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
