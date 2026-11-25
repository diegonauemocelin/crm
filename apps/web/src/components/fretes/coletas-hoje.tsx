import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, Loader2Icon, TruckIcon, Undo2Icon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type PickupRow, type ScheduledPickup, type TodayPickup, todayPickups, UNDO_COLLECTED_MIN } from '@/lib/coletas'
import { cn } from '@/lib/utils'

type Board = { rows: PickupRow[]; scheduled?: ScheduledPickup[] }

const hm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '')

/**
 * Coletas de hoje para a expedição marcar com um toque: as de horário fixo (inclusive quando a transportadora chega antes)
 * e as agendadas. "Chegou, coletando" muda o painel da TV na hora; "Coletou" pede volumes e notas (obrigatórios quando a
 * transportadora pede). Usada no app do celular e na tela Agendar coletas.
 */
export function ColetasHoje({ unit, big = false }: { unit: string | null; big?: boolean }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const edit = can('fretes_coletas', 'edit')
  const q = useQuery({ queryKey: ['fretes', 'coletas-hoje', unit], queryFn: () => api.get<Board>(`/fretes/painel-tv${unit ? `?filial=${unit}` : ''}`), refetchInterval: 20_000 })
  const [closing, setClosing] = useState<TodayPickup | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['fretes', 'coletas-hoje'] })
    void qc.invalidateQueries({ queryKey: ['fretes', 'coletas-agendadas'] })
    void qc.invalidateQueries({ queryKey: ['fretes', 'painel-tv'] })
  }
  const arrived = useMutation({
    mutationFn: (i: TodayPickup) => (i.record ? api.patch(`/fretes/coletas/agendadas/${i.record.id}`, { situacao: 'COLETANDO' }) : api.post('/fretes/coletas/chegou', { transportadora: i.carrierId, filial: i.unitId, horario: i.pickup })),
    onSuccess: (_r, i) => {
      toast.success(`${i.carrier}: coletando agora.`)
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const move = useMutation({
    mutationFn: (v: { id: string; status: ScheduledPickup['status'] }) => api.patch(`/fretes/coletas/agendadas/${v.id}`, { situacao: v.status }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (q.isLoading) return <TableSkeleton />
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const now = new Date()
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const items = todayPickups(q.data.rows, q.data.scheduled ?? [], now, today)
  if (!items.length) return <EmptyState icon={TruckIcon} title="Nenhuma coleta hoje" description="Sem coletas de horário fixo para hoje e nenhuma agendada." />
  const busy = arrived.isPending || move.isPending
  return (
    <div className="space-y-2">
      {items.map((i) => {
        const st = i.record?.status ?? null
        return (
          <div key={i.key} className={cn('rounded-xl border p-3', st === 'COLETANDO' && 'border-emerald-500/50 bg-emerald-500/10', st === 'COLETADA' && 'opacity-70')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn('truncate font-semibold', big && 'text-lg')}>{i.carrier}</p>
                <p className="text-sm text-muted-foreground">
                  {i.kind === 'FIXA' ? `Pedido até ${i.cutoff} · coleta às ${i.pickup}` : `Agendada · ${i.period === 'MANHA' ? 'manhã (08h–12h)' : 'tarde (13h–18h)'}`}
                  {i.unit ? ` · ${i.unit}` : ''}
                </p>
                {st === 'COLETANDO' && <p className="text-sm text-emerald-700 dark:text-emerald-300">Chegou às {hm(i.record?.arrivedAt ?? i.record?.statusAt)}{i.record?.statusByName ? ` · ${i.record.statusByName}` : ''}</p>}
                {st === 'COLETADA' && (
                  <p className="text-sm text-muted-foreground">
                    Coletou às {hm(i.record?.collectedAt ?? i.record?.statusAt)}
                    {i.record?.volumes !== null && i.record?.volumes !== undefined && ` · ${i.record.volumes} volume(s)`}
                    {i.record?.invoices !== null && i.record?.invoices !== undefined && ` · ${i.record.invoices} nota(s)`}
                  </p>
                )}
              </div>
              <Badge variant="outline" className={cn(st === 'COLETANDO' && 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300')}>
                {st === 'COLETANDO' ? 'Coletando agora' : st === 'COLETADA' ? 'Coletada' : i.kind === 'FIXA' ? 'Aguardando' : 'Agendada'}
              </Badge>
            </div>
            {edit && (
              <div className={cn('mt-2 grid gap-2', st === 'COLETADA' ? 'grid-cols-1' : 'grid-cols-2')}>
                {(st === null || st === 'AGENDADA') && (
                  <>
                    <Button size={big ? 'lg' : 'default'} className={cn(big && 'h-14 text-base')} disabled={busy} onClick={() => arrived.mutate(i)}>
                      <TruckIcon aria-hidden /> Chegou, coletando
                    </Button>
                    {i.record ? (
                      <Button size={big ? 'lg' : 'default'} variant="outline" className={cn(big && 'h-14 text-base')} disabled={busy} onClick={() => move.mutate({ id: i.record!.id, status: 'CANCELADA' })}>
                        <XIcon aria-hidden /> Não veio
                      </Button>
                    ) : (
                      <Button size={big ? 'lg' : 'default'} variant="outline" className={cn(big && 'h-14 text-base')} disabled={busy} onClick={() => setClosing(i)} title="Coletou sem ter marcado a chegada">
                        <CheckIcon aria-hidden /> Coletou
                      </Button>
                    )}
                  </>
                )}
                {st === 'COLETANDO' && (
                  <>
                    <Button size={big ? 'lg' : 'default'} className={cn(big && 'h-14 text-base')} disabled={busy} onClick={() => setClosing(i)}>
                      <CheckIcon aria-hidden /> Coletou
                    </Button>
                    <Button size={big ? 'lg' : 'default'} variant="ghost" className={cn(big && 'h-14 text-base')} disabled={busy} onClick={() => move.mutate({ id: i.record!.id, status: 'AGENDADA' })} title="Marquei sem querer">
                      <Undo2Icon aria-hidden /> Desfazer
                    </Button>
                  </>
                )}
                {st === 'COLETADA' && i.record?.statusAt && now.getTime() - new Date(i.record.statusAt).getTime() <= UNDO_COLLECTED_MIN * 60_000 && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => move.mutate({ id: i.record!.id, status: 'COLETANDO' })}>
                    <Undo2Icon aria-hidden /> Desfazer o Coletou
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}
      {busy && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
      {closing && <CollectDialog item={closing} onClose={() => setClosing(null)} onDone={refresh} />}
    </div>
  )
}

/** "Coletou": volumes e notas entregues (obrigatórios quando a transportadora pede). */
function CollectDialog({ item, onClose, onDone }: { item: TodayPickup; onClose: () => void; onDone: () => void }) {
  const [volumes, setVolumes] = useState('')
  const [invoices, setInvoices] = useState('')
  const req = item.countsRequired
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const save = useMutation({
    mutationFn: async () => {
      // Fixa ainda não marcada: registra a chegada e já fecha.
      let id = item.record?.id
      if (!id) id = (await api.post<{ id: string }>('/fretes/coletas/chegou', { transportadora: item.carrierId, filial: item.unitId, horario: item.pickup })).id
      return api.patch(`/fretes/coletas/agendadas/${id}`, { situacao: 'COLETADA', volumes: num(volumes), notas: num(invoices) })
    },
    onSuccess: () => {
      toast.success(`${item.carrier}: coleta encerrada.`)
      onDone()
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const missing = req && (volumes.trim() === '' || invoices.trim() === '')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.carrier} coletou</DialogTitle>
          <DialogDescription>{req ? 'Informe quantos volumes e quantas notas a transportadora levou (obrigatório para esta transportadora).' : 'Se quiser, informe quantos volumes e quantas notas a transportadora levou.'}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="col-vol">Volumes{req ? ' *' : ''}</Label>
            <Input id="col-vol" type="number" inputMode="numeric" min={0} value={volumes} onChange={(e) => setVolumes(e.target.value.replace(/\D/g, ''))} className="h-12 text-lg" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="col-nf">Notas fiscais{req ? ' *' : ''}</Label>
            <Input id="col-nf" type="number" inputMode="numeric" min={0} value={invoices} onChange={(e) => setInvoices(e.target.value.replace(/\D/g, ''))} className="h-12 text-lg" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button disabled={save.isPending || missing} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckIcon aria-hidden />} Encerrar coleta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
