import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, Loader2Icon, MonitorIcon, MoonIcon, SunIcon, TruckIcon, Undo2Icon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dayBr } from '@/lib/format'
import { ALL_UNITS, useActiveUnit } from '@/lib/fretes'
import { type ScheduledPickup, SCHEDULE_STATUS } from '@/lib/coletas'
import { cn } from '@/lib/utils'

interface Data {
  today: string
  tomorrow: string
  carriers: { id: string; name: string; bySchedule: boolean }[]
  schedules: ScheduledPickup[]
}

export function FretesColetasPage() {
  return (
    <RequirePermission module="fretes_coletas">
      <Schedules />
    </RequirePermission>
  )
}

/**
 * Tela da expedição (quem controla o carregamento): um clique em "Manhã" ou "Tarde" na transportadora agenda a coleta;
 * embaixo, as coletas agendadas com "Chegou", "Coletou" e "Cancelar". O painel de TV mostra e avisa com som.
 */
function Schedules() {
  const qc = useQueryClient()
  const { can } = useAuth()
  const active = useActiveUnit()
  const unit = active.value && active.value !== ALL_UNITS ? active.value : null
  const [day, setDay] = useState<'HOJE' | 'AMANHA'>('HOJE')
  const q = useQuery({ queryKey: ['fretes', 'coletas-agendadas', unit], queryFn: () => api.get<Data>(`/fretes/coletas/agendadas${unit ? `?filial=${unit}` : ''}`), refetchInterval: 30_000 })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['fretes', 'coletas-agendadas'] })
  const add = useMutation({
    mutationFn: (v: { carrierId: string; period: 'MANHA' | 'TARDE' }) => api.post<{ id: string; duplicate: boolean }>('/fretes/coletas/agendadas', { transportadora: v.carrierId, filial: unit, dia: day, periodo: v.period }),
    onSuccess: (r, v) => {
      const name = q.data?.carriers.find((c) => c.id === v.carrierId)?.name ?? 'Transportadora'
      const when = `${day === 'HOJE' ? 'hoje' : 'amanhã'} à ${v.period === 'MANHA' ? 'manhã' : 'tarde'}`
      if (r.duplicate) toast.info(`${name} já estava agendada para ${when}.`)
      else toast.success(`${name}: coleta agendada para ${when}.`, { action: { label: 'Desfazer', onClick: () => move.mutate({ id: r.id, status: 'CANCELADA' }) } })
      refresh()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const move = useMutation({
    mutationFn: (v: { id: string; status: ScheduledPickup['status'] }) => api.patch(`/fretes/coletas/agendadas/${v.id}`, { situacao: v.status }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const d = q.data
  const canAdd = can('fretes_coletas', 'create')
  const open = (d?.schedules ?? []).filter((s) => s.status === 'AGENDADA' || s.status === 'COLETANDO')
  const done = (d?.schedules ?? []).filter((s) => s.date === d?.today && (s.status === 'COLETADA' || s.status === 'CANCELADA'))
  return (
    <div className="space-y-5">
      <PageHeader
        title="Agendar coletas"
        description="Um clique em Manhã ou Tarde na transportadora agenda a coleta. O painel da TV mostra e avisa com som quando agenda, quando está na hora e quando a transportadora está coletando."
        actions={
          <>
            <FilialSwitch active={active} />
            <Button variant="outline" asChild>
              <Link to="/fretes/painel-tv">
                <MonitorIcon aria-hidden /> Painel da TV
              </Link>
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <TableSkeleton />
      ) : q.error || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {canAdd && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold">Agendar para</p>
                <ToggleGroup type="single" variant="outline" value={day} onValueChange={(v) => v && setDay(v as 'HOJE' | 'AMANHA')} aria-label="Dia da coleta">
                  <ToggleGroupItem value="HOJE" className="px-4">
                    Hoje ({dayBr(d.today).slice(0, 5)})
                  </ToggleGroupItem>
                  <ToggleGroupItem value="AMANHA" className="px-4">
                    Amanhã ({dayBr(d.tomorrow).slice(0, 5)})
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {!d.carriers.length ? (
                <EmptyState icon={TruckIcon} title="Nenhuma transportadora de coleta" description="Cadastre as transportadoras em Fretes › Transportadoras (com a opção Coleta)." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {d.carriers.map((c) => {
                    const taken = (p: 'MANHA' | 'TARDE') => open.some((s) => s.carrierId === c.id && s.period === p && s.date === (day === 'HOJE' ? d.today : d.tomorrow))
                    return (
                      <div key={c.id} className={cn('space-y-2 rounded-lg border p-3', c.bySchedule && 'border-primary/40')}>
                        <p className="truncate font-semibold" title={c.name}>
                          {c.name}
                        </p>
                        {c.bySchedule && <p className="text-xs text-muted-foreground">Só vem quando agendada</p>}
                        <div className="grid grid-cols-2 gap-2">
                          {(['MANHA', 'TARDE'] as const).map((p) => (
                            <Button
                              key={p}
                              size="lg"
                              variant={taken(p) ? 'secondary' : 'outline'}
                              className="h-12"
                              disabled={add.isPending || taken(p)}
                              onClick={() => add.mutate({ carrierId: c.id, period: p })}
                              title={taken(p) ? 'Já agendada' : `Agendar ${day === 'HOJE' ? 'hoje' : 'amanhã'} à ${p === 'MANHA' ? 'manhã' : 'tarde'}`}
                            >
                              {taken(p) ? <CheckIcon aria-hidden /> : p === 'MANHA' ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
                              {p === 'MANHA' ? 'Manhã' : 'Tarde'}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-semibold">Coletas agendadas</h2>
            {!open.length ? (
              <p className="text-sm text-muted-foreground">Nenhuma coleta agendada em aberto.</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {open.map((s) => (
                  <div key={s.id} className={cn('flex flex-wrap items-center gap-3 p-3', s.status === 'COLETANDO' && 'bg-emerald-500/10')}>
                    <div className="min-w-48 flex-1">
                      <p className="font-semibold">{s.carrier}</p>
                      <p className="text-sm text-muted-foreground">
                        {s.date === d.today ? 'Hoje' : s.date === d.tomorrow ? 'Amanhã' : dayBr(s.date)} · {s.period === 'MANHA' ? 'Manhã' : 'Tarde'}
                        {s.unit ? ` · ${s.unit}` : ''} · agendada por {s.createdByName}
                      </p>
                    </div>
                    <Badge variant="outline" className={SCHEDULE_STATUS[s.status].badge}>
                      {SCHEDULE_STATUS[s.status].label}
                    </Badge>
                    <Can module="fretes_coletas" action="edit">
                      <div className="flex flex-wrap gap-2">
                        {s.status === 'AGENDADA' && (
                          <Button size="sm" disabled={move.isPending} onClick={() => move.mutate({ id: s.id, status: 'COLETANDO' })}>
                            <TruckIcon aria-hidden /> Chegou, coletando
                          </Button>
                        )}
                        {s.status === 'COLETANDO' && (
                          <Button size="sm" variant="ghost" disabled={move.isPending} onClick={() => move.mutate({ id: s.id, status: 'AGENDADA' })} title="Marquei sem querer">
                            <Undo2Icon aria-hidden /> Desfazer
                          </Button>
                        )}
                        <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate({ id: s.id, status: 'COLETADA' })}>
                          <CheckIcon aria-hidden /> Coletou
                        </Button>
                        <Button size="sm" variant="ghost" disabled={move.isPending} onClick={() => move.mutate({ id: s.id, status: 'CANCELADA' })}>
                          <XIcon aria-hidden /> Cancelar
                        </Button>
                      </div>
                    </Can>
                  </div>
                ))}
              </div>
            )}
            {move.isPending && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
          </section>

          {done.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-semibold text-muted-foreground">Encerradas hoje</h2>
              {done.map((s) => (
                <p key={s.id} className="text-sm text-muted-foreground">
                  {s.carrier} · {s.period === 'MANHA' ? 'manhã' : 'tarde'} · {SCHEDULE_STATUS[s.status].label.toLowerCase()}
                  {s.statusByName ? ` por ${s.statusByName}` : ''}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
