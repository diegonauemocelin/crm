import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, CircleHelpIcon, CircleIcon, GraduationCapIcon, LightbulbIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type Lesson, trailForRoute } from '@/lib/trilha'
import { cn } from '@/lib/utils'

export function useTrailProgress() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['trilha'], queryFn: () => api.get<{ done: string[] }>('/me/trilha'), staleTime: 60_000 })
  const mark = useMutation({
    mutationFn: (d: { id: string; done: boolean }) => api.put<{ done: string[] }>(`/me/trilha/${encodeURIComponent(d.id)}`, { done: d.done }),
    onSuccess: (r) => qc.setQueryData(['trilha'], r),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const done = new Set(q.data?.done ?? [])
  return { done, toggle: (id: string) => mark.mutate({ id, done: !done.has(id) }), busy: mark.isPending, loaded: !!q.data }
}

/** Uma lição: passos numerados, dica e o botão de concluída. */
export function LessonCard({ lesson, done, onToggle, disabled }: { lesson: Lesson; done: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div className={cn('space-y-2 rounded-lg border p-3', done && 'border-[#006300]/30 bg-[#006300]/5 dark:border-[#0ca30c]/30 dark:bg-[#0ca30c]/5')}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{lesson.title}</p>
        <Button type="button" size="sm" variant={done ? 'secondary' : 'outline'} className="h-7 shrink-0 px-2 text-xs" onClick={onToggle} disabled={disabled} aria-pressed={done}>
          {done ? <CheckCircle2Icon className="text-[#006300] dark:text-[#0ca30c]" /> : <CircleIcon />} {done ? 'Concluída' : 'Marcar como feita'}
        </Button>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {lesson.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {lesson.tip && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
          <LightbulbIcon className="mt-0.5 size-3.5 shrink-0" /> {lesson.tip}
        </p>
      )}
    </div>
  )
}

/** Botão "?" do topo: abre o "o que fazer e como fazer" da tela aberta. */
export function TrailHelp({ className }: { className?: string }) {
  const { pathname, search } = useLocation()
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const progress = useTrailProgress()
  const m = trailForRoute(pathname, search, (mod) => can(mod))
  return (
    <>
      <Button type="button" variant="ghost" size="icon" className={className} onClick={() => setOpen(true)} aria-label="Ajuda desta tela" title="Ajuda desta tela">
        <CircleHelpIcon />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{m ? m.title : 'Ajuda'}</SheetTitle>
            <SheetDescription>{m ? m.purpose : 'Esta tela ainda não tem passo a passo. Veja a trilha completa.'}</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            {m?.lessons.map((l) => (
              <LessonCard key={l.id} lesson={l} done={progress.done.has(l.id)} onToggle={() => progress.toggle(l.id)} disabled={progress.busy} />
            ))}
            <Button asChild variant="outline" className="w-full" onClick={() => setOpen(false)}>
              <Link to="/trilha">
                <GraduationCapIcon /> Ver a trilha completa
              </Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
