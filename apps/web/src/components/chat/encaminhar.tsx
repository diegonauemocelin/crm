import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookUserIcon, ForwardIcon, Loader2Icon, MessageCircleIcon, SearchIcon, UsersIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useCloseGuard } from '@/components/confirm'
import { InlineError } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { formatPhone } from '@/lib/atendimento'
import { cn } from '@/lib/utils'

/** Encaminhar mensagem (texto, foto, vídeo, áudio, arquivo ou contato) para conversas ou contatos da agenda. */

interface Target {
  key: string
  label: string
  detail: string | null
  conversationId?: string
  phone?: string
}

interface ConvRow {
  id: string
  name: string | null
  phone: string | null
  category?: string
  lastPreview: string | null
}

const MAX = 10

export function ForwardDialog({ messageIds, sourceConversationId, preview, onClose, onSent }: { messageIds: string[]; sourceConversationId: string; preview: string; onClose: () => void; onSent?: () => void }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'conversas' | 'agenda'>('conversas')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Target[]>([])
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const convs = useQuery({
    queryKey: ['chat-encaminhar-conversas', q],
    queryFn: () => api.get<{ items: ConvRow[] }>(`/chat/conversas${q ? `?busca=${encodeURIComponent(q)}` : ''}`),
    enabled: tab === 'conversas',
    placeholderData: keepPreviousData,
  })
  const groups = useQuery({
    queryKey: ['chat-encaminhar-grupos', q],
    queryFn: () => api.get<{ items: ConvRow[] }>(`/chat/conversas?tipo=GRUPO${q ? `&busca=${encodeURIComponent(q)}` : ''}`),
    enabled: tab === 'conversas',
    placeholderData: keepPreviousData,
  })
  const agenda = useQuery({
    queryKey: ['chat-compartilhar', q],
    queryFn: () => api.get<{ key: string; name: string; phone: string; source: string }[]>(`/chat/contatos-para-compartilhar${q ? `?busca=${encodeURIComponent(q)}` : ''}`),
    enabled: tab === 'agenda',
    placeholderData: keepPreviousData,
  })
  const send = useMutation({
    mutationFn: () =>
      api.post<{ sent: number; messages: number; skipped: string[]; results: { label: string; ok: boolean; sent: number; error?: string }[] }>('/chat/mensagens/encaminhar', {
        messageIds,
        targets: picked.map((t) => ({ conversationId: t.conversationId, phone: t.phone, label: t.label })),
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      void qc.invalidateQueries({ queryKey: ['chat-conversa'] })
      const fails = r.results.filter((x) => !x.ok)
      const what = r.messages === 1 ? 'Mensagem encaminhada' : `${r.messages} mensagens encaminhadas`
      if (r.sent) toast.success(`${what} para ${r.sent} ${r.sent === 1 ? 'conversa' : 'conversas'}.`)
      if (r.skipped.length) toast.info(`${r.skipped.length} mensagem(ns) ficaram de fora (${[...new Set(r.skipped)].join('; ')}). Encaminhe essas pelo celular.`, { duration: 10_000 })
      for (const f of fails) toast.error(`Não foi para ${f.label}${f.sent ? ` (foram ${f.sent} antes do erro)` : ''}: ${f.error ?? 'erro'}`, { duration: 10_000 })
      if (!fails.length) {
        onSent?.()
        onClose()
      }
      else setPicked((p) => p.filter((t) => fails.some((f) => f.label === t.label)))
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const isPicked = (key: string) => picked.some((p) => p.key === key)
  const toggle = (t: Target) =>
    setPicked((p) => (p.some((x) => x.key === t.key) ? p.filter((x) => x.key !== t.key) : p.length >= MAX ? (toast.error(`No máximo ${MAX} destinos por vez.`), p) : [...p, t]))

  const convTargets: Target[] = [...(convs.data?.items ?? []), ...(groups.data?.items ?? [])]
    .filter((c) => c.id !== sourceConversationId)
    .map((c) => ({ key: `c-${c.id}`, label: c.name || formatPhone(c.phone) || 'Contato', detail: c.category === 'GRUPO' ? 'Grupo' : c.phone ? formatPhone(c.phone) : null, conversationId: c.id }))
  const agendaTargets: Target[] = (agenda.data ?? []).map((a) => ({ key: `p-${a.phone}`, label: a.name, detail: `${a.phone.startsWith('+55') ? formatPhone(a.phone) : a.phone} · ${a.source}`, phone: a.phone }))
  const list = tab === 'conversas' ? convTargets : agendaTargets
  const loading = tab === 'conversas' ? convs.isLoading : agenda.isLoading
  const failed = tab === 'conversas' ? (convs.error ?? groups.error) : agenda.error
  // Destinos já escolhidos: pergunta antes de fechar.
  const guard = useCloseGuard(picked.length > 0, onClose, 'o encaminhamento')

  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{messageIds.length > 1 ? `Encaminhar ${messageIds.length} mensagens` : 'Encaminhar mensagem'}</DialogTitle>
          <DialogDescription className="line-clamp-2">{preview}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Para onde">
          {(
            [
              ['conversas', 'Conversas', MessageCircleIcon],
              ['agenda', 'Agenda e contatos', BookUserIcon],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn('flex h-8 items-center justify-center gap-1.5 rounded-md text-sm', tab === k ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground')}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder={tab === 'conversas' ? 'Buscar conversa ou grupo' : 'Buscar na agenda, vendedores e leads'} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar destino" autoFocus />
        </div>
        <ul className="max-h-64 overflow-y-auto rounded-md border" aria-label="Destinos">
          {loading && <li className="p-3 text-sm text-muted-foreground">Carregando…</li>}
          {!loading && failed && (
            <li className="p-3">
              <InlineError error={failed} onRetry={() => void (tab === 'conversas' ? (convs.refetch(), groups.refetch()) : agenda.refetch())} />
            </li>
          )}
          {!loading && !failed && list.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">{tab === 'agenda' && !q ? 'Digite um nome para buscar na agenda, nos vendedores e nos leads.' : 'Nada encontrado.'}</li>
          )}
          {list.map((t) => (
            <li key={t.key}>
              <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted">
                <Checkbox checked={isPicked(t.key)} onCheckedChange={() => toggle(t)} aria-label={`Encaminhar para ${t.label}`} />
                {t.detail === 'Grupo' && <UsersIcon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.label}</span>
                  {t.detail && <span className="block truncate text-xs text-muted-foreground">{t.detail}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Escolhidos">
            {picked.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-1 rounded-full bg-[color:var(--brand)]/10 py-0.5 pr-1 pl-2.5 text-xs font-medium">
                {p.label}
                <button type="button" className="rounded-full p-0.5 hover:bg-background" onClick={() => toggle(p)} aria-label={`Remover ${p.label} dos destinos`}>
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Contato da agenda sem conversa: a conversa é aberta pelo mesmo número de WhatsApp desta mensagem.</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void guard()}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => send.mutate()} disabled={!picked.length || send.isPending}>
            {send.isPending ? <Loader2Icon className="animate-spin" /> : <ForwardIcon />} Encaminhar{picked.length ? ` (${picked.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
