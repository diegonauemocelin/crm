import { useQuery } from '@tanstack/react-query'
import { ArrowUpCircleIcon, CheckCircle2Icon, ExternalLinkIcon, GitCommitHorizontalIcon, PackageCheckIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useVersion } from '@/components/layout/app-footer'
import { ErrorState, formatDate, formatDateTime, PageHeader, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import type { ChangeType, Release } from '@/lib/types'
import { cn } from '@/lib/utils'

const TYPE_META: Record<ChangeType, { label: string; className: string }> = {
  novo: { label: 'Novo', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  melhoria: { label: 'Melhoria', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  correcao: { label: 'Correção', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  seguranca: { label: 'Segurança', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30' },
  infra: { label: 'Infraestrutura', className: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30' },
}

export function UpdatesPage() {
  const version = useVersion()
  const releases = useQuery({ queryKey: ['releases'], queryFn: () => api.get<Release[]>('/system/releases') })
  const [filter, setFilter] = useState<'todos' | ChangeType>('todos')

  const counts = useMemo(() => {
    const c: Partial<Record<ChangeType, number>> = {}
    for (const r of releases.data ?? []) for (const ch of r.changes) c[ch.type] = (c[ch.type] ?? 0) + 1
    return c
  }, [releases.data])

  const v = version.data

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Atualizações" description="Versão instalada e histórico detalhado de tudo o que o sistema recebeu." />

      <Card className="mb-6 overflow-hidden">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'var(--brand)', color: 'var(--brand-foreground)' }}
            aria-hidden
          >
            <PackageCheckIcon className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">Versão atual</p>
            <p className="text-3xl font-semibold tracking-tight">{v ? `v${v.version}` : '…'}</p>
            {v && (
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Publicada em {formatDate(v.releasedAt)}</span>
                <span className="inline-flex items-center gap-1">
                  <GitCommitHorizontalIcon className="size-3.5" />
                  {v.commit.slice(0, 7)}
                </span>
                <span>Build {formatDateTime(v.buildDate)}</span>
              </p>
            )}
          </div>
          {v &&
            (v.updateAvailable ? (
              <a
                href={v.latestUrl ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300"
              >
                <ArrowUpCircleIcon className="size-4" />
                v{v.latestAvailable} disponível
                <ExternalLinkIcon className="size-3.5" />
              </a>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2Icon className="size-4" />
                {v.updateCheckEnabled ? 'Última versão instalada' : 'Versão em execução'}
              </div>
            ))}
        </CardContent>
      </Card>

      <Tabs value={filter} onValueChange={(f) => setFilter(f as typeof filter)} className="mb-4">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="todos">Todas</TabsTrigger>
          {(Object.keys(TYPE_META) as ChangeType[])
            .filter((t) => counts[t])
            .map((t) => (
              <TabsTrigger key={t} value={t}>
                {TYPE_META[t].label} <span className="ml-1 text-muted-foreground">{counts[t]}</span>
              </TabsTrigger>
            ))}
        </TabsList>
      </Tabs>

      {releases.isLoading && <TableSkeleton rows={4} />}
      {releases.error && <ErrorState error={releases.error} onRetry={() => releases.refetch()} />}

      <ol className="relative space-y-6 border-l pl-6">
        {releases.data?.map((r) => {
          const changes = r.changes.filter((c) => filter === 'todos' || c.type === filter)
          if (changes.length === 0) return null
          const areas = [...new Set(changes.map((c) => c.area ?? 'Geral'))]
          return (
            <li key={r.version} className="relative">
              <span
                className={cn('absolute -left-[31px] top-5 size-3 rounded-full border-2 border-background', r.current ? 'ring-4 ring-[color:var(--brand)]/20' : 'bg-muted-foreground/40')}
                style={r.current ? { background: 'var(--brand)' } : undefined}
                aria-hidden
              />
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-lg">v{r.version}</CardTitle>
                    {r.current && <Badge>Instalada</Badge>}
                  </div>
                  <CardDescription>
                    <span className="font-medium text-foreground">{r.title}</span>
                    <br />
                    Publicada em {formatDate(r.releasedAt)} · instalada neste servidor em {formatDateTime(r.installedAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {areas.map((area) => (
                    <section key={area}>
                      <h3 className="mb-2 text-sm font-semibold">{area}</h3>
                      <ul className="space-y-2">
                        {changes
                          .filter((c) => (c.area ?? 'Geral') === area)
                          .map((c, i) => (
                            <li key={i} className="flex gap-2 text-sm">
                              <Badge variant="outline" className={cn('h-5 shrink-0 px-1.5 text-[11px]', TYPE_META[c.type]?.className)}>
                                {TYPE_META[c.type]?.label ?? c.type}
                              </Badge>
                              <span className="leading-5">{c.text}</span>
                            </li>
                          ))}
                      </ul>
                    </section>
                  ))}
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
