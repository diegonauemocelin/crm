import { useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, BellIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'
import { int, type Kind, KIND_INFO } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

interface Alerts {
  alertHours: number
  total: number
  items: { kind: Kind; overdue: number }[]
}

/** Notificações internas: atendimentos repassados sem retorno do vendedor além do prazo configurado. */
export function AlertsBell({ className }: { className?: string }) {
  const { can } = useAuth()
  const enabled = can('pre_vendas') || can('pos_vendas')
  const q = useQuery({
    queryKey: ['atendimento-alertas'],
    queryFn: () => api.get<Alerts>('/atendimentos/alertas'),
    enabled,
    refetchInterval: 2 * 60_000,
  })
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
          {q.data && <p className="text-xs text-muted-foreground">Retorno do vendedor pendente há mais de {int.format(q.data.alertHours)} h</p>}
        </div>
        {total === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum atendimento aguardando retorno além do prazo.</p>
        ) : (
          <ul className="divide-y">
            {q.data?.items
              .filter((i) => i.overdue > 0)
              .map((i) => (
                <li key={i.kind}>
                  <Link to={`${KIND_INFO[i.kind].path}?overdue=true`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted">
                    <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
                    <span className="flex-1">
                      <strong>{int.format(i.overdue)}</strong> em {KIND_INFO[i.kind].title} sem retorno do vendedor
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
