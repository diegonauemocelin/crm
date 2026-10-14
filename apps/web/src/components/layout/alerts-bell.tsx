import { useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, BellIcon, ClockAlertIcon, HeadsetIcon, PhoneIcon, Undo2Icon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'
import { formatPhone, int, type Kind, KIND_INFO, whatsappLink } from '@/lib/atendimento'
import { beep, systemNotify } from '@/lib/chat-alerts'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

export interface Alerts {
  alertHours: number
  newRecordMinutes?: number
  total: number
  items: { kind: Kind; overdue: number }[]
  postSaleHours: number
  followOverdue: number
  returnedToMe: number
  /** Pré-vendas novas sem ninguém atender há mais do prazo (minutos). */
  waiting?: number
  fresh?: { id: string; name: string; leadAt: string; createdAt: string; origin: string | null; channel: string | null }[]
  overdueList?: { id: string; name: string; forwardedAt: string | null; seller: string | null; sellerPhone: string | null }[]
}

export function useAttendanceAlerts() {
  const { can } = useAuth()
  const enabled = can('pre_vendas') || can('pos_vendas')
  return useQuery({
    queryKey: ['atendimento-alertas'],
    queryFn: () => api.get<Alerts>('/atendimentos/alertas'),
    enabled,
    // Pré-venda nova precisa de aviso em minutos: consulta a cada 30 s.
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  })
}

/**
 * Aviso na hora: cada pré-venda nova (formulário, WhatsApp, chat) aparece na tela, com som e notificação do navegador.
 * A primeira consulta só guarda o que já existia; avisa o que chegar depois.
 */
export function AttendanceNotifier() {
  const q = useAttendanceAlerts()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const seen = useRef<Set<string> | null>(null)
  const fresh = q.data?.fresh
  useEffect(() => {
    if (!fresh) return
    if (!seen.current) {
      seen.current = new Set(fresh.map((r) => r.id))
      return
    }
    for (const r of fresh.filter((x) => !seen.current!.has(x.id))) {
      seen.current.add(r.id)
      const open = () => navigate(`/pre-vendas?abrir=${r.id}`)
      const from = [r.origin, r.channel].filter(Boolean).join(' · ')
      beep()
      systemNotify(`Nova pré-venda: ${r.name}`, from || 'Responda o cliente o quanto antes.', open, `prevenda-${r.id}`)
      if (pathname !== '/pre-vendas') toast(`Nova pré-venda: ${r.name}`, { description: from || 'Responda o cliente o quanto antes.', action: { label: 'Abrir', onClick: open }, duration: 15000 })
    }
  }, [fresh, navigate, pathname])
  return null
}

/** Notificações internas: atendimentos repassados sem retorno do vendedor além do prazo configurado. */
export function AlertsBell({ className }: { className?: string }) {
  const { can } = useAuth()
  const enabled = can('pre_vendas') || can('pos_vendas')
  const q = useAttendanceAlerts()
  if (!enabled) return null
  const total = q.data?.total ?? 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn('relative size-8', className)} aria-label={total ? `${total} alerta(s) de retorno pendente` : 'Notificações'}>
          <BellIcon />
          {total > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {total > 99 ? '99+' : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="font-medium">Notificações</p>
          <p className="text-xs text-muted-foreground">Pré-vendas aguardando, retorno do vendedor e pós-venda fora do prazo</p>
        </div>
        {total === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum atendimento fora do prazo.</p>
        ) : (
          <ul className="max-h-[70vh] divide-y overflow-y-auto">
            {!!q.data?.waiting && (
              <li>
                <Link to="/pre-vendas?waiting=true" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted">
                  <HeadsetIcon className="size-4 shrink-0 text-rose-600" />
                  <span className="flex-1">
                    <strong>{int.format(q.data.waiting)}</strong> pré-venda(s) nova(s) aguardando atendimento há mais de {int.format(q.data.newRecordMinutes ?? 10)} min. Responda o cliente.
                  </span>
                </Link>
              </li>
            )}
            {q.data?.items
              .filter((i) => i.overdue > 0)
              .map((i) => (
                <li key={i.kind}>
                  <Link to={`${KIND_INFO[i.kind].path}?overdue=true`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted">
                    <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
                    <span className="flex-1">
                      <strong>{int.format(i.overdue)}</strong> em {KIND_INFO[i.kind].title} sem retorno do vendedor (há mais de {int.format(q.data.alertHours)} h). Ligue para o vendedor e confira se ele falou com o cliente.
                    </span>
                  </Link>
                </li>
              ))}
            {(q.data?.overdueList ?? []).map((o) => (
              <li key={o.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                <Link to={`/pre-vendas?abrir=${o.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate font-medium">{o.name}</span>
                  <span className="block truncate text-muted-foreground">vendedor: {o.seller ?? 'sem vendedor'}</span>
                </Link>
                {o.sellerPhone && (
                  <>
                    <a href={`tel:${o.sellerPhone}`} className="inline-flex items-center gap-1 rounded border px-1.5 py-1 hover:bg-muted" title={`Ligar para ${o.seller ?? 'o vendedor'}: ${formatPhone(o.sellerPhone)}`}>
                      <PhoneIcon className="size-3" /> Ligar
                    </a>
                    {whatsappLink(o.sellerPhone) && (
                      <a href={whatsappLink(o.sellerPhone)!} target="_blank" rel="noreferrer noopener" className="rounded border px-1.5 py-1 hover:bg-muted" title="Chamar o vendedor no WhatsApp">
                        WhatsApp
                      </a>
                    )}
                  </>
                )}
              </li>
            ))}
            {!!q.data?.followOverdue && (
              <li>
                <Link to="/pos-vendas?followOverdue=true" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted">
                  <ClockAlertIcon className="size-4 shrink-0 text-rose-600" />
                  <span className="flex-1">
                    <strong>{int.format(q.data.followOverdue)}</strong> pós-venda(s) sem contato em {int.format(q.data.postSaleHours)} h
                  </span>
                </Link>
              </li>
            )}
            {!!q.data?.returnedToMe && (
              <li>
                <Link to="/pre-vendas?postSaleReturned=true" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted">
                  <Undo2Icon className="size-4 shrink-0 text-sky-600" />
                  <span className="flex-1">
                    <strong>{int.format(q.data.returnedToMe)}</strong> cliente(s) voltaram do pós-venda para você
                  </span>
                </Link>
              </li>
            )}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
