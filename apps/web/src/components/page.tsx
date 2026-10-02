import { AlertTriangleIcon, InboxIcon, type LucideIcon, ShieldOffIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { Action } from '@/lib/types'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon: Icon = InboxIcon, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
      <Icon className="mb-3 size-10 text-muted-foreground/60" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangleIcon className="mb-3 size-9 text-destructive" aria-hidden />
      <p className="font-medium">Não foi possível carregar</p>
      <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

/** Esconde a tela inteira quando o perfil não tem a permissão. O servidor também bloqueia; isto é só para a interface. */
export function RequirePermission({ module, action = 'view', children }: { module: string; action?: Action; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(module, action)) {
    return (
      <EmptyState
        icon={ShieldOffIcon}
        title="Acesso não liberado"
        description="Seu perfil de acesso não tem permissão para esta área. Fale com o administrador do sistema."
      />
    )
  }
  return <>{children}</>
}

/** Ações (botões) que só aparecem para quem tem a permissão. */
export function Can({ module, action, children }: { module: string; action: Action; children: ReactNode }) {
  const { can } = useAuth()
  return can(module, action) ? <>{children}</> : null
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
}

/** Datas sem horário (ex.: data de uma versão) são gravadas em UTC; formatar em UTC evita exibir o dia anterior. */
export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value))
}
