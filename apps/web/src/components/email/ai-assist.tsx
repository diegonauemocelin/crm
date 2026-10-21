import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckIcon, Loader2Icon, SparklesIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, errorMessage } from '@/lib/api'

type Action = 'escrever' | 'melhorar' | 'encurtar' | 'persuasivo' | 'corrigir'
const ACTIONS: [Action, string][] = [
  ['melhorar', 'Melhorar'],
  ['encurtar', 'Mais curto'],
  ['persuasivo', 'Mais persuasivo'],
  ['corrigir', 'Corrigir português'],
]

export function useAiConfig() {
  return useQuery({ queryKey: ['email-ia'], queryFn: () => api.get<{ configured: boolean; model: string }>('/email/ia'), staleTime: 60_000 })
}

/**
 * Assistente de texto (Gemini) para um bloco: escrever a partir de um tema ou reescrever o texto do bloco.
 * O resultado aparece para aprovação; nada muda no e-mail sem clicar em "Usar este texto".
 */
export function AiAssist({ html, onApply, disabled }: { html: string; onApply: (html: string) => void; disabled?: boolean }) {
  const cfg = useAiConfig()
  const [topic, setTopic] = useState('')
  const [result, setResult] = useState<{ html: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: (action: Action) => api.post<{ html: string; text: string }>('/email/ia/gerar', { action, html, topic: topic || undefined }),
    onMutate: () => {
      setError(null)
      setResult(null)
    },
    onSuccess: setResult,
    onError: (err) => setError(errorMessage(err)),
  })
  if (cfg.data && !cfg.data.configured) {
    return (
      <div className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
        <SparklesIcon className="mr-1 inline size-3.5" /> Assistente de texto com IA: cadastre a chave gratuita do Gemini em Configurações → E-mail marketing.
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <SparklesIcon className="size-4 text-violet-600" /> Assistente de texto (IA)
      </p>
      <div className="flex gap-1.5">
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1000} placeholder="Tema ou orientação (ex.: promoção de filtros JCB)" className="h-8 text-sm" disabled={disabled} aria-label="Tema para a IA" />
        <Button type="button" size="sm" onClick={() => run.mutate('escrever')} disabled={disabled || run.isPending || !topic.trim()}>
          Escrever
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {ACTIONS.map(([a, label]) => (
          <Button key={a} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => run.mutate(a)} disabled={disabled || run.isPending}>
            {label}
          </Button>
        ))}
      </div>
      {run.isPending && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" /> Escrevendo…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && (
        <div className="space-y-2">
          <div className="max-h-48 overflow-y-auto rounded border bg-muted/40 p-2 text-sm whitespace-pre-line">{result.text}</div>
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onApply(result.html)
                setResult(null)
              }}
            >
              <CheckIcon /> Usar este texto
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setResult(null)}>
              <XIcon /> Descartar
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Confira sempre: a IA pode errar. Não escreva dados de clientes aqui.</p>
    </div>
  )
}

/** Sugestões de assunto ou de pré-cabeçalho a partir do conteúdo do e-mail. */
export function AiSuggest({ action, content, onPick, disabled }: { action: 'assunto' | 'preheader'; content: string; onPick: (v: string) => void; disabled?: boolean }) {
  const cfg = useAiConfig()
  const [open, setOpen] = useState(false)
  const run = useMutation({ mutationFn: () => api.post<{ options: string[] }>('/email/ia/gerar', { action, html: content }) })
  if (!cfg.data?.configured) return null
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) run.mutate()
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={disabled || !content.trim()} title={!content.trim() ? 'Escreva o e-mail antes' : undefined}>
          <SparklesIcon className="size-3.5 text-violet-600" /> Sugerir com IA
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-1.5">
        <p className="text-xs font-medium">{action === 'assunto' ? 'Sugestões de assunto' : 'Sugestões de pré-cabeçalho'}</p>
        {run.isPending && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" /> Pensando…
          </p>
        )}
        {run.error && <p className="text-xs text-destructive">{errorMessage(run.error)}</p>}
        {run.data?.options.map((o) => (
          <button
            key={o}
            type="button"
            className="block w-full rounded-md border px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              onPick(o)
              setOpen(false)
            }}
          >
            {o}
          </button>
        ))}
        {run.data && (
          <Button type="button" size="sm" variant="ghost" className="h-7 w-full text-xs" onClick={() => run.mutate()} disabled={run.isPending}>
            Outras sugestões
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
