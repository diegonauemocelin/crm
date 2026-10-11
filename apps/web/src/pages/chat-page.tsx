import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, CheckIcon, FileIcon, HeadsetIcon, Loader2Icon, MapPinIcon, MegaphoneIcon, MessageCircleIcon, MessageSquarePlusIcon, PaperclipIcon, SearchIcon, SendIcon, SmartphoneIcon, UserIcon, ZapIcon } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, maskPhone, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

interface NumberRef {
  id: string
  name: string
  phone: string | null
  status: string
}
interface ConvItem {
  id: string
  numberId: string
  name: string | null
  phone: string | null
  leadId: string | null
  recordId: string | null
  unread: number
  lastMessageAt: string | null
  lastPreview: string | null
  lastFromMe: boolean
  category?: ContactCategory
  status?: string
}
interface ListData {
  total: number
  unreadConversations: number
  numbers: NumberRef[]
  items: ConvItem[]
}
interface Message {
  id: string
  fromMe: boolean
  type: 'texto' | 'imagem' | 'audio' | 'video' | 'documento' | 'figurinha' | 'localizacao' | 'contato' | 'outro'
  text: string | null
  fileName: string | null
  mime: string | null
  mediaStatus: 'PENDENTE' | 'OK' | 'GRANDE' | 'ERRO' | null
  hasFile: boolean
  sentAt: string
  sentByName?: string | null
  status?: string | null
}
interface Thread {
  conversation: { id: string; name: string | null; phone: string | null; jid: string; status: 'ABERTA' | 'ARQUIVADA'; assignedSellerId: string | null; category: ContactCategory }
  number: NumberRef | null
  lead: { id: string; name: string | null; email: string | null; phone: string | null } | null
  record: { id: string; kind: 'PRE_VENDAS' | 'POS_VENDAS'; leadAt: string; saleStatus: string; adsVia: string | null; adsCampaign: string | null; adsCampaignId: string | null; entryChannel: string | null } | null
  hasMore: boolean
  messages: Message[]
}

const ALL = '__all__'
export type ContactCategory = 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
export const CATEGORY_LABEL: Record<ContactCategory, string> = { CLIENTE: 'Cliente / lead', COLEGA: 'Colega de trabalho', FORNECEDOR: 'Fornecedor', OUTRO: 'Outro (não é venda)' }
/** Com a regra "A classificar", o contato novo fica assim até alguém marcar. */
const categoryLabel = (c: string | undefined) => (c === 'NOVO' ? 'A classificar' : (CATEGORY_LABEL[c as ContactCategory] ?? c ?? ''))
const time = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
const dayKey = (iso: string) => day.format(new Date(iso))

/** Hora se for hoje; senão, a data. */
function when(iso: string | null) {
  if (!iso) return ''
  return dayKey(iso) === day.format(new Date()) ? time.format(new Date(iso)) : day.format(new Date(iso)).slice(0, 5)
}

export function ChatPage() {
  return (
    <RequirePermission module="chat">
      <Chat />
    </RequirePermission>
  )
}

function Chat() {
  const [params, setParams] = useSearchParams()
  const openId = params.get('conversa')
  const [numberId, setNumberId] = useState<string | null>(null)
  const [unread, setUnread] = useState(false)
  const [archived, setArchived] = useState(false)
  const [category, setCategory] = useState<ContactCategory | null>(null)
  const [starting, setStarting] = useState(false)
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const qs = new URLSearchParams({ ...(numberId ? { numero: numberId } : {}), ...(unread ? { naoLidas: 'true' } : {}), ...(archived ? { arquivadas: 'true' } : {}), ...(category ? { tipo: category } : {}), ...(q ? { busca: q } : {}) }).toString()
  const list = useQuery({ queryKey: ['chat-conversas', qs], queryFn: () => api.get<ListData>(`/chat/conversas?${qs}`), refetchInterval: 5000, placeholderData: keepPreviousData })
  const numbers = useMemo(() => new Map((list.data?.numbers ?? []).map((n) => [n.id, n])), [list.data?.numbers])
  const open = (id: string | null) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (id) n.set('conversa', id)
    else n.delete('conversa')
    return n
  })
  return (
    <div>
      <PageHeader
        title="Chat WhatsApp"
        description="Conversas dos números da empresa. Responda por aqui ou pelo celular: tudo fica no histórico do lead."
        actions={
          can('chat', 'create') && (
            <Button onClick={() => setStarting(true)}>
              <MessageSquarePlusIcon /> Nova conversa
            </Button>
          )
        }
      />
      {starting && <StartDialog onClose={() => setStarting(false)} onStarted={(cid) => (setStarting(false), open(cid))} />}
      {list.isLoading && <TableSkeleton rows={6} />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data && (
        <Card className="grid h-[calc(100dvh-13rem)] min-h-[28rem] grid-cols-1 gap-0 overflow-hidden p-0 md:grid-cols-[20rem_minmax(0,1fr)]">
          <div className={cn('flex min-h-0 flex-col border-r', openId && 'hidden md:flex')}>
            <div className="space-y-2 border-b p-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Nome, telefone ou mensagem" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar conversa" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={numberId ?? ALL} onValueChange={(v) => setNumberId(v === ALL ? null : v)}>
                  <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Número">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos os números</SelectItem>
                    {list.data.numbers.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={category ?? ALL} onValueChange={(v) => setCategory(v === ALL ? null : (v as ContactCategory))}>
                  <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Filtrar por tipo de contato">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos os contatos</SelectItem>
                    {(Object.keys(CATEGORY_LABEL) as ContactCategory[]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={archived} onCheckedChange={setArchived} aria-label="Ver arquivadas" /> Arquivadas
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={unread} onCheckedChange={setUnread} aria-label="Só não lidas" /> Não lidas
                  {list.data.unreadConversations > 0 && <Badge className="h-5 px-1.5 tabular-nums">{list.data.unreadConversations}</Badge>}
                </label>
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.data.items.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa{archived ? ' arquivada' : ''}{q || unread || numberId || category ? ' com esses filtros' : archived ? '' : ' ainda'}.</li>}
              {list.data.items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    className={cn('flex w-full items-start gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/50', openId === c.id && 'bg-muted')}
                  >
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn('truncate text-sm', c.unread > 0 && 'font-semibold')}>{c.name || formatPhone(c.phone) || 'Contato'}</span>
                        <span className={cn('shrink-0 text-xs tabular-nums', c.unread > 0 ? 'font-medium text-foreground' : 'text-muted-foreground')}>{when(c.lastMessageAt)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {c.lastFromMe && <CheckIcon className="mr-0.5 inline size-3" aria-label="Enviada pela empresa" />}
                          {c.lastPreview}
                        </span>
                        {c.unread > 0 && <Badge className="h-5 shrink-0 px-1.5 tabular-nums" aria-label={`${c.unread} não lidas`}>{c.unread}</Badge>}
                      </span>
                      {(list.data.numbers.length > 1 || (c.category && c.category !== 'CLIENTE')) && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {[list.data.numbers.length > 1 ? numbers.get(c.numberId)?.name : null, c.category && c.category !== 'CLIENTE' ? categoryLabel(c.category) : null].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className={cn('min-h-0', !openId && 'hidden md:block')}>
            {openId ? <ThreadView id={openId} onBack={() => open(null)} /> : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <MessageCircleIcon className="size-8" />
                Escolha uma conversa.
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

export function ThreadView({ id, onBack }: { id: string; onBack?: () => void }) {
  const q = useQuery({ queryKey: ['chat-conversa', id], queryFn: () => api.get<Thread>(`/chat/conversas/${id}`), refetchInterval: 4000 })
  const [older, setOlder] = useState<Message[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const lastId = q.data?.messages.at(-1)?.id
  useEffect(() => {
    setOlder([])
  }, [id])
  // Desce para a última mensagem quando chega uma nova.
  // Bloco com chaves: em navegadores novos scrollIntoView devolve uma Promise, e o efeito não pode devolver nada.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [lastId])
  if (q.isLoading) return <div className="p-4"><TableSkeleton rows={5} /></div>
  if (q.error) return <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
  const d = q.data!
  const messages = [...older, ...d.messages]
  const loadOlder = async () => {
    if (!messages[0]) return
    setLoadingOlder(true)
    try {
      const r = await api.get<Thread>(`/chat/conversas/${id}?antes=${encodeURIComponent(messages[0].sentAt)}`)
      setOlder((o) => [...r.messages, ...o])
    } finally {
      setLoadingOlder(false)
    }
  }
  const title = d.conversation.name || formatPhone(d.conversation.phone) || 'Contato'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        {onBack && (
          <Button size="icon" variant="ghost" className="size-8 md:hidden" onClick={onBack} aria-label="Voltar para a lista">
            <ArrowLeftIcon />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {d.conversation.phone && <span>{formatPhone(d.conversation.phone)}</span>}
            {d.number && (
              <span className="inline-flex items-center gap-1">
                <SmartphoneIcon className="size-3" /> {d.number.name}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ConversationActions thread={d} />
          {d.lead && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/leads/${d.lead.id}`}>
                <UserIcon /> Lead
              </Link>
            </Button>
          )}
          {d.record && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/${d.record.kind === 'PRE_VENDAS' ? 'pre-vendas' : 'pos-vendas'}?abrir=${d.record.id}`}>
                <HeadsetIcon /> {d.record.kind === 'PRE_VENDAS' ? 'Pré-venda' : 'Pós-venda'}
              </Link>
            </Button>
          )}
        </div>
        {d.record?.adsVia && (
          <p className="flex w-full items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
            <MegaphoneIcon className="size-3.5" /> Google Ads{d.record.adsCampaign ? ` · ${d.record.adsCampaign}` : d.record.adsCampaignId ? ` · campanha nº ${d.record.adsCampaignId}` : ''}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-muted/30 px-3 py-3">
        {(d.hasMore || older.length > 0) && (
          <div className="text-center">
            <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
              Mensagens anteriores
            </Button>
          </div>
        )}
        {messages.map((m, i) => {
          const showDay = i === 0 || dayKey(messages[i - 1]!.sentAt) !== dayKey(m.sentAt)
          return (
            <div key={m.id}>
              {showDay && <p className="my-2 text-center text-xs text-muted-foreground">{dayKey(m.sentAt)}</p>}
              <div className={cn('flex', m.fromMe ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] rounded-lg px-3 py-1.5 text-sm shadow-xs sm:max-w-[70%]', m.fromMe ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]' : 'bg-card')}>
                  <Bubble m={m} />
                  <p className={cn('mt-0.5 text-right text-[11px] tabular-nums', m.fromMe ? 'opacity-70' : 'text-muted-foreground')}>
                    {m.fromMe && (m.sentByName ? `${m.sentByName} · ` : 'pelo celular · ')}
                    {time.format(new Date(m.sentAt))}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      <Composer thread={d} />
    </div>
  )
}

/** Caixa de envio: texto (Enter envia, Shift+Enter quebra linha), arquivo com legenda e respostas rápidas. */
function Composer({ thread }: { thread: Thread }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = thread.conversation.id
  const replies = useQuery({ queryKey: ['chat-respostas', id], queryFn: () => api.get<{ id: string; title: string; preview: string }[]>(`/chat/respostas?conversa=${id}`), enabled: can('chat', 'create'), staleTime: 60_000 })
  const send = useMutation({
    mutationFn: () => {
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        if (text.trim()) fd.append('legenda', text.trim())
        return api.post(`/chat/conversas/${id}/arquivos`, fd)
      }
      return api.post(`/chat/conversas/${id}/mensagens`, { text })
    },
    onSuccess: () => {
      setText('')
      setFile(null)
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!can('chat', 'create')) return <p className="border-t px-3 py-2 text-xs text-muted-foreground">Seu perfil só permite ler as conversas.</p>
  if (thread.number?.status !== 'CONECTADO') {
    return <p className="border-t px-3 py-2 text-xs text-muted-foreground">O número {thread.number?.name} está desconectado: conecte de novo em Números de WhatsApp para responder por aqui.</p>
  }
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (send.isPending || (!text.trim() && !file)) return
    send.mutate()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 border-t p-2">
      {file && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs">
          <PaperclipIcon className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="text-muted-foreground tabular-nums">{(file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</span>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => setFile(null)}>
            Tirar
          </Button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <input
          ref={input}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,video/mp4,audio/ogg,audio/mpeg,audio/mp4,.m4a,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            e.target.value = ''
            if (f && f.size > 16 * 1024 * 1024) return void toast.error('Arquivo maior que 16 MB.')
            setFile(f)
          }}
        />
        <Button type="button" size="icon" variant="ghost" onClick={() => input.current?.click()} aria-label="Anexar arquivo" title="Anexar foto, vídeo, áudio ou documento">
          <PaperclipIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" aria-label="Respostas rápidas" title="Respostas rápidas">
              <ZapIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>Respostas rápidas</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(replies.data ?? []).length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma cadastrada (Números de WhatsApp → Respostas rápidas).</p>}
            {replies.data?.map((r) => (
              <DropdownMenuItem key={r.id} onSelect={() => setText((t) => (t ? `${t}\n${r.preview}` : r.preview))} className="flex-col items-start gap-0.5">
                <span className="font-medium">{r.title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{r.preview}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          maxLength={file ? 1000 : 4000}
          placeholder={file ? 'Legenda (opcional)' : 'Escreva a mensagem (Enter envia, Shift+Enter pula linha)'}
          className="max-h-40 min-h-9 flex-1 resize-none"
          aria-label="Mensagem"
        />
        <Button type="submit" size="icon" disabled={send.isPending || (!text.trim() && !file)} aria-label="Enviar">
          {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        </Button>
      </div>
    </form>
  )
}

/** Passar a conversa para um vendedor e arquivar/reabrir. */
function ConversationActions({ thread }: { thread: Thread }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const options = useOptions()
  const id = thread.conversation.id
  const save = useMutation({
    mutationFn: (d: { assignedSellerId?: string | null; status?: 'ABERTA' | 'ARQUIVADA' }) => api.patch(`/chat/conversas/${id}`, d),
    onSuccess: (_r, d) => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      toast.success(d.status === 'ARQUIVADA' ? 'Conversa arquivada. Se o cliente escrever de novo, ela volta para a lista.' : d.status === 'ABERTA' ? 'Conversa reaberta.' : 'Conversa passada para o vendedor.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!can('chat', 'edit')) return null
  const archived = thread.conversation.status === 'ARQUIVADA'
  return (
    <>
      <CategoryPicker thread={thread} />
      <Select value={thread.conversation.assignedSellerId ?? ALL} onValueChange={(v) => save.mutate({ assignedSellerId: v === ALL ? null : v })}>
        <SelectTrigger size="sm" className="w-40" aria-label="Responsável pela conversa">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Sem responsável</SelectItem>
          {options.data?.sellers.filter((s) => s.active || s.id === thread.conversation.assignedSellerId).map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: archived ? 'ABERTA' : 'ARQUIVADA' })}>
        {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />} {archived ? 'Reabrir' : 'Arquivar'}
      </Button>
    </>
  )
}

/** Começar conversa com um telefone (o lead, se existir, é ligado pela conversa). */
export function StartDialog({ onClose, onStarted, leadId, phone: initialPhone, external }: { onClose: () => void; onStarted: (id: string) => void; leadId?: string | null; phone?: string | null; external?: string | null }) {
  // Do lead/atendimento (telefone já conhecido) com um número só conectado: abre direto, sem perguntar.
  const autoStart = !!initialPhone
  const numbers = useQuery({ queryKey: ['chat-numeros-envio'], queryFn: () => api.get<NumberRef[]>('/chat/numeros') })
  const connected = (numbers.data ?? []).filter((n) => n.status === 'CONECTADO')
  const [numberId, setNumberId] = useState<string | null>(null)
  const [phone, setPhone] = useState(initialPhone ? formatPhone(initialPhone) : '')
  const [error, setError] = useState<string | null>(null)
  const chosen = numberId ?? connected[0]?.id ?? null
  const start = useMutation({
    mutationFn: () => api.post<{ id: string }>('/chat/conversas', { numberId: chosen, phone: phone || undefined, leadId: leadId ?? undefined }),
    onSuccess: (r) => onStarted(r.id),
    onError: (err) => setError(errorMessage(err)),
  })
  const tried = useRef(false)
  useEffect(() => {
    if (autoStart && !tried.current && connected.length === 1 && chosen) {
      tried.current = true
      start.mutate()
    }
  }, [autoStart, connected.length, chosen, start])
  if (autoStart && connected.length === 1 && !error) return null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            start.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{autoStart ? 'Conversar no WhatsApp' : 'Nova conversa'}</DialogTitle>
            <DialogDescription>Abre a conversa no chat do CRM (se já existir, continua de onde parou). Use para clientes que pediram contato, nunca para envio em massa.</DialogDescription>
          </DialogHeader>
          {numbers.isLoading ? (
            <TableSkeleton rows={2} />
          ) : connected.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum número seu está conectado agora.
              {external && (
                <>
                  {' '}
                  <a href={external} target="_blank" rel="noreferrer noopener" className="font-medium text-foreground underline underline-offset-4">
                    Abrir no WhatsApp do computador
                  </a>
                </>
              )}
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="chat-start-number">Enviar pelo número</Label>
                <Select value={chosen ?? undefined} onValueChange={setNumberId}>
                  <SelectTrigger id="chat-start-number" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connected.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.name}
                        {n.phone ? ` · ${formatPhone(n.phone)}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chat-start-phone">WhatsApp do cliente</Label>
                <Input id="chat-start-phone" inputMode="tel" required placeholder="(47) 99999-9999" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} autoFocus={!initialPhone} />
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!chosen || start.isPending}>
              Abrir conversa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) como elementos do React (nunca HTML vindo da mensagem). */
function waFormat(text: string) {
  const out: (string | React.ReactElement)[] = []
  const re = /([*_~])([^*_~\n]+?)\1/g
  let last = 0
  let k = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const inner = m[2]!
    out.push(m[1] === '*' ? <strong key={k++}>{inner}</strong> : m[1] === '_' ? <em key={k++}>{inner}</em> : <s key={k++}>{inner}</s>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Bubble({ m }: { m: Message }) {
  const src = `/api/chat/midias/${m.id}`
  const text = m.text && <p className="break-words whitespace-pre-wrap">{waFormat(m.text)}</p>
  const pending = m.mediaStatus === 'PENDENTE' && <p className="text-xs italic opacity-70">Baixando a mídia…</p>
  const missing = (m.mediaStatus === 'GRANDE' || m.mediaStatus === 'ERRO') && (
    <p className="text-xs italic opacity-70">{m.mediaStatus === 'GRANDE' ? 'Arquivo grande (mais de 16 MB): veja no celular.' : 'Não foi possível baixar a mídia: veja no celular.'}</p>
  )
  if (m.type === 'imagem' || m.type === 'figurinha') {
    return (
      <div className="space-y-1">
        {m.hasFile ? (
          <a href={src} target="_blank" rel="noopener noreferrer">
            <img src={src} alt={m.text ?? (m.type === 'figurinha' ? 'Figurinha' : 'Foto')} className={cn('rounded', m.type === 'figurinha' ? 'size-32 object-contain' : 'max-h-72 w-auto')} loading="lazy" />
          </a>
        ) : (
          pending || missing || <p className="text-xs italic opacity-70">Foto</p>
        )}
        {text}
      </div>
    )
  }
  if (m.type === 'audio') return m.hasFile ? <audio controls preload="none" src={src} className="max-w-full" /> : pending || missing || <p className="text-xs italic">Áudio</p>
  if (m.type === 'video') return <div className="space-y-1">{m.hasFile ? <video controls preload="none" src={src} className="max-h-72 max-w-full rounded" /> : pending || missing}{text}</div>
  if (m.type === 'documento') {
    return (
      <div className="space-y-1">
        {m.hasFile ? (
          <a href={src} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded border bg-background/60 px-2 py-1.5 underline-offset-4 hover:underline">
            <FileIcon className="size-4 shrink-0" /> <span className="truncate">{m.fileName ?? 'Documento'}</span>
          </a>
        ) : (
          pending || missing || <p className="text-xs italic">{m.fileName ?? 'Documento'}</p>
        )}
        {text}
      </div>
    )
  }
  if (m.type === 'localizacao') {
    const coords = m.text?.match(/(-?\d+\.\d+), (-?\d+\.\d+)$/)
    return (
      <p className="flex items-start gap-1.5">
        <MapPinIcon className="mt-0.5 size-4 shrink-0" />
        {coords ? (
          <a href={`https://www.google.com/maps?q=${coords[1]},${coords[2]}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            {m.text}
          </a>
        ) : (
          m.text
        )}
      </p>
    )
  }
  return text ?? <p className="text-xs italic opacity-70">Mensagem</p>
}

/** Tipo do contato: quem não é cliente não vira lead nem pré-venda (em nenhum número). */
function CategoryPicker({ thread }: { thread: Thread }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [pending, setPending] = useState<ContactCategory | null>(null)
  const [removeAuto, setRemoveAuto] = useState(true)
  const id = thread.conversation.id
  const save = useMutation({
    mutationFn: (d: { category: ContactCategory; removeAuto?: boolean }) => api.put<{ removedRecord: boolean; removedLead: boolean }>(`/chat/conversas/${id}/tipo`, d),
    onSuccess: (r, d) => {
      setPending(null)
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      const extra = [r.removedLead && 'o lead', r.removedRecord && 'a pré-venda'].filter(Boolean).join(' e ')
      toast.success(`Contato marcado como ${CATEGORY_LABEL[d.category].toLowerCase()}.${extra ? ` Excluído(s): ${extra}.` : ''}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const canRemove = !!(thread.lead || thread.record) && (can('leads', 'delete') || can('pre_vendas', 'delete'))
  return (
    <>
      <Select
        value={thread.conversation.category === ('NOVO' as ContactCategory) ? undefined : thread.conversation.category}
        onValueChange={(v) => {
          const c = v as ContactCategory
          if (c !== 'CLIENTE' && canRemove) setPending(c)
          else save.mutate({ category: c })
        }}
      >
        <SelectTrigger size="sm" className="w-44" aria-label="Tipo de contato">
          <SelectValue placeholder="A classificar" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(CATEGORY_LABEL) as ContactCategory[]).map((c) => (
            <SelectItem key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && (
        <Dialog open onOpenChange={(o) => !o && setPending(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Marcar como {CATEGORY_LABEL[pending].toLowerCase()}?</DialogTitle>
              <DialogDescription>As próximas mensagens deste telefone não viram lead nem pré-venda, em nenhum número. A conversa continua no chat.</DialogDescription>
            </DialogHeader>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={removeAuto} onChange={(e) => setRemoveAuto(e.target.checked)} />
              <span>
                Excluir o lead e a pré-venda que esta conversa criou sozinha
                <span className="block text-xs text-muted-foreground">Só os criados automaticamente pelo WhatsApp, sem outros atendimentos. Leads já existentes não são apagados.</span>
              </span>
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPending(null)}>
                Cancelar
              </Button>
              <Button disabled={save.isPending} onClick={() => save.mutate({ category: pending, removeAuto })}>
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/** Aba da ficha do lead: todas as conversas de WhatsApp dele, com a conversa aberta ao lado. */
export function LeadConversations({ leadId }: { leadId: string }) {
  const list = useQuery({ queryKey: ['chat-conversas', 'lead', leadId], queryFn: () => api.get<ListData>(`/chat/conversas?lead=${leadId}`), refetchInterval: 10_000 })
  const [openId, setOpenId] = useState<string | null>(null)
  if (list.isLoading) return <TableSkeleton rows={4} />
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />
  const items = list.data?.items ?? []
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma conversa de WhatsApp com este lead ainda.</p>
  const current = openId ?? items[0]!.id
  const numbers = new Map((list.data?.numbers ?? []).map((n) => [n.id, n.name]))
  return (
    <div className="space-y-3">
      {items.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {items.map((c) => (
            <Button key={c.id} size="sm" variant={c.id === current ? 'default' : 'outline'} onClick={() => setOpenId(c.id)}>
              <SmartphoneIcon /> {numbers.get(c.numberId) ?? 'Número'} · {when(c.lastMessageAt)}
              {c.unread > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5">{c.unread}</Badge>}
            </Button>
          ))}
        </div>
      )}
      <Card className="h-[34rem] gap-0 overflow-hidden p-0">
        <ThreadView id={current} />
      </Card>
    </div>
  )
}
