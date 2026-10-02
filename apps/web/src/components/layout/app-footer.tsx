import { useQuery } from '@tanstack/react-query'
import { ArrowUpCircleIcon, CheckCircle2Icon } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '@/lib/api'
import type { VersionInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

export function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<VersionInfo>('/system/version'),
    staleTime: 10 * 60_000,
  })
}

/** Rodapé fixo de todas as telas. O crédito de desenvolvimento não é configurável pelo whitelabel. */
export function AppFooter({ className, linkToUpdates = true }: { className?: string; linkToUpdates?: boolean }) {
  const { data } = useVersion()
  const version = data ? `v${data.version}` : ''

  const status = data?.updateAvailable ? (
    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
      <ArrowUpCircleIcon className="size-3.5" aria-hidden />
      Nova versão disponível: v{data.latestAvailable}
    </span>
  ) : data?.updateCheckEnabled ? (
    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <CheckCircle2Icon className="size-3.5" aria-hidden />
      Última versão instalada
    </span>
  ) : null

  return (
    <footer
      className={cn(
        'flex flex-col items-center justify-between gap-1 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row',
        className,
      )}
    >
      <p>
        Desenvolvido e mantido por <span className="font-medium text-foreground">Diego Naue Mocelin</span>
      </p>
      {data && (
        <p className="flex items-center gap-2">
          {linkToUpdates ? (
            <Link to="/atualizacoes" className="font-medium hover:text-foreground hover:underline">
              Versão {version}
            </Link>
          ) : (
            <span className="font-medium">Versão {version}</span>
          )}
          {status && (
            <>
              <span aria-hidden>·</span>
              {status}
            </>
          )}
        </p>
      )}
    </footer>
  )
}
