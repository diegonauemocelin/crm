import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'
import { LessonCard, ModuleIntro, useTrailProgress } from '@/components/trilha'
import { InlineError, PageHeader } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { int, pctFmt } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { ALL_LESSONS, TRAIL, trailFor } from '@/lib/trilha'
import { cn } from '@/lib/utils'

export function TrilhaPage() {
  const { can, me } = useAuth()
  const progress = useTrailProgress()
  // Mesma consulta do progresso (cache compartilhado): só para mostrar o erro quando não carrega.
  const progressQ = useQuery({ queryKey: ['trilha'], queryFn: () => api.get<{ done: string[] }>('/me/trilha'), staleTime: 60_000 })
  const [scope, setScope] = useState<'meu' | 'tudo'>('meu')
  const mine = trailFor((m) => can(m))
  const modules = scope === 'meu' ? mine : TRAIL
  const lessons = mine.flatMap((m) => m.lessons)
  const doneMine = lessons.filter((l) => progress.done.has(l.id)).length
  const share = lessons.length ? doneMine / lessons.length : 0
  return (
    <div>
      <PageHeader title="Trilha de conhecimento" description={`O que fazer e como fazer em cada tela do sistema, para o seu perfil (${me?.role.name ?? ''}). Marque as lições que já domina.`} />
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                Seu progresso: {int.format(doneMine)} de {int.format(lessons.length)} lições
              </p>
              <span className="text-sm font-semibold tabular-nums">{pctFmt.format(share)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso na trilha">
              <div className="h-full rounded-full bg-[var(--chart-1)] transition-all" style={{ width: `${Math.round(share * 100)}%` }} />
            </div>
            {progressQ.error && <InlineError error={progressQ.error} onRetry={() => void progressQ.refetch()} />}
            <p className="text-xs text-muted-foreground">Dica: em qualquer tela, o botão “?” no topo abre o passo a passo dela.</p>
          </CardContent>
        </Card>

        <ToggleGroup type="single" variant="outline" size="sm" value={scope} onValueChange={(v) => v && setScope(v as 'meu' | 'tudo')} aria-label="Quais telas">
          <ToggleGroupItem value="meu" className="px-3">
            Para o meu perfil
          </ToggleGroupItem>
          <ToggleGroupItem value="tudo" className="px-3">
            Todas as telas
          </ToggleGroupItem>
        </ToggleGroup>

        {modules.map((m, i) => {
          const total = m.lessons.length
          const done = m.lessons.filter((l) => progress.done.has(l.id)).length
          const allowed = !m.module || can(m.module)
          return (
            <Collapsible key={m.key} defaultOpen={i < 2 && done < total}>
              <Card className={cn('gap-0', !allowed && 'opacity-70')}>
                <CollapsibleTrigger asChild>
                  <button type="button" className="group/trilha w-full text-left">
                    <CardHeader className="flex flex-row items-start justify-between gap-3 pb-4">
                      <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2 text-base">
                          {m.title}
                          {!allowed && <Badge variant="outline">fora do seu perfil</Badge>}
                        </CardTitle>
                        <CardDescription>{m.purpose}</CardDescription>
                      </div>
                      <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground tabular-nums">
                        {done}/{total}
                        <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]/trilha:rotate-180" />
                      </span>
                    </CardHeader>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-3 pb-6">
                    <ModuleIntro m={m} />
                    {m.lessons.map((l) => (
                      <LessonCard key={l.id} lesson={l} done={progress.done.has(l.id)} onToggle={() => progress.toggle(l.id)} disabled={progress.busy} />
                    ))}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )
        })}

        {can('usuarios') && <TeamProgress />}
      </div>
    </div>
  )
}

/** Progresso da equipe (quem administra usuários): lições concluídas por pessoa. */
function TeamProgress() {
  const q = useQuery({ queryKey: ['trilha-equipe'], queryFn: () => api.get<{ id: string; name: string; role: string; done: string[] }[]>('/me/trilha/equipe') })
  const valid = new Set(ALL_LESSONS.map((l) => l.id))
  if (q.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progresso da equipe</CardTitle>
        </CardHeader>
        <CardContent>
          <InlineError error={q.error} onRetry={() => void q.refetch()} />
        </CardContent>
      </Card>
    )
  }
  if (!q.data?.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Progresso da equipe</CardTitle>
        <CardDescription>Lições concluídas por cada pessoa (de todas as telas; cada perfil vê só as suas).</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead className="hidden sm:table-cell">Perfil</TableHead>
              <TableHead className="text-right">Lições concluídas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{u.role}</TableCell>
                <TableCell className="text-right tabular-nums">{int.format(u.done.filter((d) => valid.has(d)).length)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
