import { LaptopIcon, SmartphoneIcon, TabletIcon } from 'lucide-react'
import { formatDateTime } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface Session {
  id: string
  device: string
  browser: string
  system: string
  ip: string | null
  startedAt: string
  lastSeenAt: string
  current: boolean
}

function DeviceIcon({ system }: { system: string }) {
  const Icon = system === 'iPhone' || system === 'Android' ? SmartphoneIcon : system === 'iPad' ? TabletIcon : LaptopIcon
  return <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
}

/** Lista de aparelhos conectados (usada em Meu perfil e, pelo administrador, em Usuários). */
export function SessionsList({ sessions, onRevoke, busyId }: { sessions: Session[]; onRevoke?: (s: Session) => void; busyId?: string | null }) {
  if (sessions.length === 0) return <p className="py-4 text-sm text-muted-foreground">Nenhum aparelho conectado.</p>
  return (
    <ul className="divide-y">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 py-3">
          <DeviceIcon system={s.system} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {s.device}
              {s.current && <Badge variant="secondary">Este aparelho</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              Entrou em {formatDateTime(s.startedAt)} · último uso {formatDateTime(s.lastSeenAt)}
              {s.ip ? ` · IP ${s.ip}` : ''}
            </p>
          </div>
          {onRevoke && !s.current && (
            <Button variant="outline" size="sm" onClick={() => onRevoke(s)} disabled={busyId === s.id}>
              Desconectar
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
