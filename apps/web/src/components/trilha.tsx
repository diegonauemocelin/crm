import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, CircleHelpIcon, CircleIcon, GraduationCapIcon, LightbulbIcon, PlayCircleIcon } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type Lesson, type Media, type TrailModule, trailForRoute } from '@/lib/trilha'
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

/** Print da tela (clique para ampliar) ou vídeo curto mostrando a tela funcionando. Arquivo que falta some sem erro. */
export function TrailMedia({ media, className }: { media: Media; className?: string }) {
  const [zoom, setZoom] = useState(false)
  const [broken, setBroken] = useState(false)
  if (broken) return null
  if (media.kind === 'video') {
    return (
      <figure className={cn('space-y-1', className)}>
        <video src={media.src} controls muted playsInline preload="metadata" className="w-full rounded-md border bg-black" onError={() => setBroken(true)} aria-label={media.alt} />
        <figcaption className="flex items-center gap-1 text-xs text-muted-foreground">
          <PlayCircleIcon className="size-3.5" /> {media.alt}
        </figcaption>
      </figure>
    )
  }
  return (
    <>
      <button type="button" className={cn('block w-full overflow-hidden rounded-md border transition hover:opacity-90', className)} onClick={() => setZoom(true)} title="Clique para ampliar">
        <img src={media.src} alt={media.alt} loading="lazy" className="w-full" onError={() => setBroken(true)} />
      </button>
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-[min(96vw,1400px)] p-2 sm:max-w-[min(96vw,1400px)]">
          <DialogTitle className="sr-only">{media.alt}</DialogTitle>
          <img src={media.src} alt={media.alt} className="w-full rounded" />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Abertura do módulo: como a tela funciona e o print dela. */
export function ModuleIntro({ m }: { m: TrailModule }) {
  if (!m.howItWorks && !m.media) return null
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      {m.howItWorks && (
        <p className="text-sm">
          <span className="font-medium">Como funciona: </span>
          {m.howItWorks}
        </p>
      )}
      {m.media && <TrailMedia media={m.media} />}
    </div>
  )
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
      {lesson.media && <TrailMedia media={lesson.media} />}
      {lesson.tip && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
          <LightbulbIcon className="mt-0.5 size-3.5 shrink-0" /> {lesson.tip}
        </p>
      )}
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl + K', 'Buscar tela, lead ou cliente'],
  ['?', 'Abrir esta ajuda'],
  ['Esc', 'Fechar a janela aberta (pergunta antes se houver algo não salvo)'],
  ['Enter', 'Salvar a janela aberta'],
  ['Tab / Shift + Tab', 'Ir para o próximo / anterior campo'],
  ['Chat: Enter', 'Enviar a mensagem (Shift + Enter quebra a linha)'],
  ['Chat: /', 'Abrir as respostas rápidas'],
]

/** Atalhos de teclado do sistema (os mesmos em todas as telas). */
function Shortcuts() {
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Atalhos de teclado</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {SHORTCUTS.map(([k, v]) => (
          <Fragment key={k}>
            <dt>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
            </dt>
            <dd className="text-muted-foreground">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  )
}

/** Botão "?" do topo: abre o "o que fazer e como fazer" da tela aberta. */
export function TrailHelp({ className }: { className?: string }) {
  const { pathname, search } = useLocation()
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const progress = useTrailProgress()
  const m = trailForRoute(pathname, search, (mod) => can(mod))
  // "?" fora de um campo de texto abre a ajuda da tela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      e.preventDefault()
      setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <Button type="button" variant="ghost" size="icon" className={className} onClick={() => setOpen(true)} aria-label="Ajuda desta tela (?)">
        <CircleHelpIcon />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{m ? m.title : 'Ajuda'}</SheetTitle>
            <SheetDescription>{m ? m.purpose : 'Esta tela ainda não tem passo a passo. Veja a trilha completa.'}</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            {m && <ModuleIntro m={m} />}
            {m?.lessons.map((l) => (
              <LessonCard key={l.id} lesson={l} done={progress.done.has(l.id)} onToggle={() => progress.toggle(l.id)} disabled={progress.busy} />
            ))}
            <Shortcuts />
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
