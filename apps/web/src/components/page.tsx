import { AlertTriangleIcon, InboxIcon, type LucideIcon, ShieldOffIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { Action } from '@/lib/types'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      {/* O título não é espremido pelos botões: quando não cabe tudo, os botões descem para a linha de baixo. */}
      <div className="min-w-0 flex-[1_1_20rem]">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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

/** O que aconteceu e o que fazer, pelo tipo de erro (sem permissão, registro apagado, servidor fora, outro). */
function errorKind(error: unknown) {
  const status = error instanceof ApiError ? error.status : 0
  if (status === 403) return { title: 'Sem permissão para ver isto', hint: 'Seu perfil de acesso não libera esta parte. Se precisar, peça ao administrador.', retry: false }
  if (status === 404) return { title: 'Não encontrado', hint: 'O registro pode ter sido excluído por outra pessoa ou o endereço mudou.', retry: false }
  if (status >= 502 || status === 503) return { title: 'O sistema está fora do ar por alguns instantes', hint: 'Normalmente é uma atualização. Aguarde alguns segundos e tente de novo.', retry: true }
  return { title: 'Não foi possível carregar', hint: null, retry: true }
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const k = errorKind(error)
  return (
    <div role="alert" className="flex flex-col items-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangleIcon className="mb-3 size-9 text-destructive" aria-hidden />
      <p className="font-medium">{k.title}</p>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">{errorMessage(error)}</p>
      {k.hint && k.hint !== errorMessage(error) && <p className="mt-1 max-w-lg text-sm text-muted-foreground">{k.hint}</p>}
      <div className="mt-4 flex gap-2">
        {onRetry && k.retry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        )}
        {!k.retry && (
          <Button variant="outline" size="sm" onClick={() => history.back()}>
            Voltar
          </Button>
        )}
      </div>
    </div>
  )
}

/** Erro pequeno para cartões e partes da tela (não ocupa a tela toda). */
export function InlineError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <AlertTriangleIcon className="size-4" aria-hidden /> {errorMessage(error)}
      {onRetry && (
        <button type="button" className="underline underline-offset-2 hover:no-underline" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </p>
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

/** 21/10/2026: para listas e tabelas (a data por extenso fica para textos corridos). */
export { dateShort as formatDateShort } from '@/lib/format'

/** Datas sem horário (ex.: data de uma versão) são gravadas em UTC; formatar em UTC evita exibir o dia anterior. */
export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value))
}
