/**
 * Ferramentas de conteúdo do Instagram em Postagens (espelham apps/api/src/postagens/conteudo-ig.ts): prévia do feed e
 * conferência da legenda, e o roteiro de Reels com nota das aberturas e o tempo de cada fala.
 */
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, CheckIcon, CopyIcon, Loader2Icon, SparklesIcon, XCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

type Status = 'ok' | 'atencao' | 'erro'
interface Check {
  status: Status
  label: string
  detail: string
}
interface CaptionCheck {
  preview: string
  truncated: boolean
  length: number
  hashtags: string[]
  checks: Check[]
}
interface HookScore {
  text: string
  score: number
  label: 'FORTE' | 'OK' | 'FRACO'
  weakest: string
  dealbreaker: string | null
}
interface Beat {
  start: number
  seconds: number
  text: string
  screen: string
  tag: 'GANCHO' | 'MEIO' | 'CHAMADA'
  long: boolean
}
interface ReelsCheck {
  hooks: HookScore[]
  sheet: { beats: Beat[]; total: number; words: number; notes: string[] }
}
type Line = { text: string; screen: string }

function useDebounced<T>(value: T, ms = 500) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const ICON: Record<Status, React.ReactNode> = {
  ok: <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />,
  atencao: <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />,
  erro: <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />,
}

export const splitKeywords = (s: string) => s.split(/[,;\n]+/).map((k) => k.trim()).filter(Boolean).slice(0, 10)

/** O que o feed mostra antes do "... mais" e a conferência da legenda, a cada mudança do texto. */
export function CaptionCheckPanel({ caption, keywords }: { caption: string; keywords: string }) {
  const body = useDebounced({ caption, keywords: splitKeywords(keywords) })
  const q = useQuery({
    queryKey: ['postagens-legenda-conferir', body],
    queryFn: () => api.post<CaptionCheck>('/postagens/legenda/conferir', body),
    enabled: !!body.caption.trim(),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
  if (!caption.trim()) return null
  const d = q.data
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase">O que o feed mostra</p>
      <div className="rounded-md border bg-muted/30 p-2 text-sm whitespace-pre-wrap">
        {d ? (
          <>
            {d.preview}
            {d.truncated && <span className="text-muted-foreground">... mais</span>}
          </>
        ) : (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {d && (
        <ul className="space-y-1">
          {d.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-sm">
              {ICON[c.status]}
              <span>
                <span className="font-medium">{c.label}:</span> {c.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const HOOK_CLS = { FORTE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300', OK: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', FRACO: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' }
const sec = (n: number) => `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, '0')}`

/**
 * Roteiro de Reels com a IA: 3 aberturas com nota (a melhor primeiro), as falas com o tempo de cada uma e o texto da
 * tela, e a legenda. Dá para editar e conferir de novo; "Usar" põe a legenda e o roteiro na postagem.
 */
export function ReelsDialog({ open, onClose, defaultTopic = '', hasAi, onUse }: { open: boolean; onClose: () => void; defaultTopic?: string; hasAi: boolean; onUse?: (caption: string) => void }) {
  const [topic, setTopic] = useState(defaultTopic)
  const [seconds, setSeconds] = useState(30)
  const [hooks, setHooks] = useState<string[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [caption, setCaption] = useState('')
  const [check, setCheck] = useState<ReelsCheck | null>(null)
  useEffect(() => {
    if (open && !hooks.length) setTopic((t) => t || defaultTopic)
  }, [open, defaultTopic, hooks.length])
  const gen = useMutation({
    mutationFn: () => api.post<ReelsCheck & { lines: Line[]; caption: string }>('/postagens/ia/reels', { topic, seconds }),
    onSuccess: (r) => {
      setHooks(r.hooks.map((h) => h.text))
      setLines(r.lines)
      setCaption(r.caption)
      setCheck(r)
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 10_000 }),
  })
  const recheck = useMutation({
    mutationFn: (b: { hooks: string[]; lines: Line[] }) => api.post<ReelsCheck>('/postagens/reels/conferir', { ...b, seconds }),
    onSuccess: (r) => setCheck(r),
    onError: (err) => toast.error(errorMessage(err)),
  })
  /** Põe a abertura escolhida como primeira fala e confere de novo. */
  const pickHook = (text: string) => {
    const next = [{ text, screen: lines[0]?.screen ?? '' }, ...lines.slice(1)]
    setLines(next)
    recheck.mutate({ hooks, lines: next })
  }
  const script = () => (check?.sheet.beats ?? []).map((b) => `${sec(b.start)} (${b.seconds.toLocaleString('pt-BR')}s) ${b.text}${b.screen ? `\n   Tela: ${b.screen}` : ''}`).join('\n')
  const reset = () => {
    setHooks([])
    setLines([])
    setCaption('')
    setCheck(null)
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Roteiro de Reels</DialogTitle>
          <DialogDescription>A IA escreve 3 aberturas e o roteiro. Cada abertura ganha uma nota (começa pelo assunto, é concreta, curta, mostra o que está em jogo), e cada fala, o tempo que leva para ser dita.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-60 flex-1 space-y-1.5">
            <Label htmlFor="rl-topic">Tema</Label>
            <Input id="rl-topic" maxLength={500} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ex.: sinais de que o filtro de ar da JCB 3C precisa de troca" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rl-s">Duração (s)</Label>
            <Input id="rl-s" type="number" min={7} max={90} className="w-24" value={seconds} onChange={(e) => setSeconds(Math.min(90, Math.max(7, Number(e.target.value) || 30)))} />
          </div>
          <Button onClick={() => gen.mutate()} disabled={gen.isPending || !hasAi || !topic.trim()}>
            {gen.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {hooks.length ? 'Escrever de novo' : 'Escrever roteiro'}
          </Button>
        </div>
        {!hasAi && <p className="text-xs text-muted-foreground">Cadastre a chave gratuita do Gemini em Configurações › E-mail marketing.</p>}
        {check && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Aberturas (melhor primeiro)</p>
              {check.hooks.map((h) => (
                <div key={h.text} className="flex flex-wrap items-start gap-2 rounded-md border p-2 text-sm">
                  <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium tabular-nums', HOOK_CLS[h.label])}>
                    {h.score.toLocaleString('pt-BR')} {h.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    {h.text}
                    <span className="block text-xs text-muted-foreground">{h.dealbreaker ?? `Ponto mais fraco: ${h.weakest.toLowerCase()}`}</span>
                  </span>
                  <Button size="sm" variant={lines[0]?.text === h.text ? 'secondary' : 'outline'} onClick={() => pickHook(h.text)} disabled={recheck.isPending || lines[0]?.text === h.text}>
                    {lines[0]?.text === h.text ? 'Em uso' : 'Usar esta'}
                  </Button>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Roteiro · {check.sheet.words} palavras · cerca de {check.sheet.total.toLocaleString('pt-BR')}s (meta {seconds}s)
                </p>
                <Button size="sm" variant="ghost" onClick={() => recheck.mutate({ hooks, lines })} disabled={recheck.isPending}>
                  {recheck.isPending && <Loader2Icon className="animate-spin" />} Conferir de novo
                </Button>
              </div>
              {lines.map((l, i) => {
                const b = check.sheet.beats[i]
                return (
                  <div key={i} className={cn('grid gap-2 rounded-md border p-2 sm:grid-cols-[5.5rem_1fr_12rem]', b?.long && 'border-amber-400')}>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {b ? `${sec(b.start)} · ${b.seconds.toLocaleString('pt-BR')}s` : '—'}
                      {b && <span className="block font-medium">{b.tag}</span>}
                    </span>
                    <Textarea rows={2} value={l.text} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={`Fala ${i + 1}`} />
                    <Input value={l.screen} maxLength={80} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, screen: e.target.value } : x)))} placeholder="Texto na tela" aria-label={`Texto na tela da fala ${i + 1}`} />
                  </div>
                )
              })}
              {check.sheet.notes.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {check.sheet.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
            {caption && (
              <div className="space-y-1.5">
                <Label htmlFor="rl-cap">Legenda sugerida</Label>
                <Textarea id="rl-cap" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {check && (
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard.writeText(script()).then(
                  () => toast.success('Roteiro copiado.'),
                  () => toast.error('Não foi possível copiar.'),
                )
              }
            >
              <CopyIcon /> Copiar roteiro
            </Button>
          )}
          {check && onUse && (
            <Button
              onClick={() => {
                onUse(caption)
                reset()
                onClose()
              }}
            >
              <CheckIcon /> Usar legenda na postagem
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
