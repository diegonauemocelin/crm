import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClockIcon, ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, BellIcon, BellOffIcon, CheckIcon, EyeIcon, FileIcon, HandIcon, HeadsetIcon, InfoIcon, Loader2Icon, LockIcon, MapPinIcon, MegaphoneIcon, MessageCircleIcon, MessageSquarePlusIcon, MicIcon, PaperclipIcon, PhoneIcon, PhoneIncomingIcon, SearchIcon, SendIcon, SmartphoneIcon, StickyNoteIcon, Trash2Icon, UserIcon, VideoIcon, Volume2Icon, VolumeXIcon, ZapIcon } from 'lucide-react'
import { createContext, type FormEvent, type KeyboardEvent, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, maskPhone, useOptions } from '@/lib/atendimento'
import { useAuth } from '@/lib/auth'
import { setSoundOn, soundOn } from '@/lib/chat-alerts'
import { cn } from '@/lib/utils'

interface NumberRef {
  id: string
  name: string
  phone: string | null
  status: string
  /** Atendimento dividido entre os atendentes do número. */
  splitAttendance?: boolean
}
interface ConvItem {
  id: string
  /** Atendimento dividido: atendente da conversa (vazio = na fila). */
  assignedUserId?: string | null
  assignedUserName?: string | null
  sectorId?: string | null
  /** Nota interna nova, ainda não vista por quem atende. */
  noteUnread?: boolean
  /** Só no monitoramento: quem atende a conversa. */
  attendant?: string | null
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
  reminderAt?: string | null
}
interface ListData {
  /** Prazos das cores de atraso de resposta (minutos desde a última mensagem do cliente). */
  responseColors?: { yellowMinutes: number; redMinutes: number }
  /** Só no monitoramento: vendedores para o filtro. */
  sellers?: { id: string; name: string }[]
  total: number
  unreadConversations: number
  numbers: NumberRef[]
  items: ConvItem[]
}
interface Message {
  id: string
  fromMe: boolean
  type: 'texto' | 'imagem' | 'audio' | 'video' | 'documento' | 'figurinha' | 'localizacao' | 'contato' | 'chamada' | 'outro'
  text: string | null
  fileName: string | null
  mime: string | null
  /** Nota interna: só no CRM, o cliente não recebe. */
  internal?: boolean
  mediaStatus: 'PENDENTE' | 'OK' | 'GRANDE' | 'ERRO' | null
  hasFile: boolean
  sentAt: string
  sentByName?: string | null
  status?: string | null
}
interface Thread {
  conversation: { id: string; name: string | null; phone: string | null; jid: string; status: 'ABERTA' | 'ARQUIVADA'; assignedSellerId: string | null; assignedUserId?: string | null; assignedUserName?: string | null; sectorId?: string | null; category: ContactCategory }
  number: NumberRef | null
  attendance?: { split: boolean; sectors: { id: string; name: string }[]; attendants: { id: string; name: string }[] } | null
  lead: { id: string; name: string | null; email: string | null; phone: string | null } | null
  record: { id: string; kind: 'PRE_VENDAS' | 'POS_VENDAS'; leadAt: string; saleStatus: string; adsVia: string | null; adsCampaign: string | null; adsCampaignId: string | null; entryChannel: string | null } | null
  hasMore: boolean
  messages: Message[]
  monitor?: boolean
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
/** Cor do atraso de resposta: só quando a última mensagem é do cliente (verde, amarelo, vermelho). */
const WAIT_COLOR = {
  verde: { dot: 'bg-[#16a34a]', text: 'text-[#15803d] dark:text-[#4ade80]', label: 'dentro do prazo' },
  amarelo: { dot: 'bg-[#eab308]', text: 'text-[#a16207] dark:text-[#facc15]', label: 'atenção' },
  vermelho: { dot: 'bg-[#dc2626]', text: 'text-[#b91c1c] dark:text-[#f87171]', label: 'atrasada' },
} as const
function waitColor(c: { lastFromMe: boolean; lastMessageAt: string | null; status?: string }, r: ListData['responseColors']) {
  if (!r || c.lastFromMe || !c.lastMessageAt || c.status === 'ARQUIVADA') return null
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(c.lastMessageAt)) / 60_000))
  const k = min < r.yellowMinutes ? 'verde' : min < r.redMinutes ? 'amarelo' : 'vermelho'
  return { ...WAIT_COLOR[k], min }
}
const waitText = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} dia(s)`)

function when(iso: string | null) {
  if (!iso) return ''
  return dayKey(iso) === day.format(new Date()) ? time.format(new Date(iso)) : day.format(new Date(iso)).slice(0, 5)
}

/** Monitoramento (ler as conversas da equipe sem responder e sem marcar como lidas): a mídia usa a mesma regra. */
const MonitorContext = createContext(false)

export function ChatPage() {
  const { can } = useAuth()
  // Quem só tem "Monitorar conversas" entra direto no monitoramento.
  if (!can('chat') && can('monitoramento')) return <Chat onlyMonitor />
  return (
    <RequirePermission module="chat">
      <Chat />
    </RequirePermission>
  )
}

function Chat({ onlyMonitor = false }: { onlyMonitor?: boolean }) {
  const [params, setParams] = useSearchParams()
  const openId = params.get('conversa')
  const monitor = onlyMonitor || params.get('monitorar') === '1'
  const [sellerId, setSellerId] = useState<string | null>(null)
  const [awaiting, setAwaiting] = useState(false)
  const [queue, setQueue] = useState(false)
  const [numberId, setNumberId] = useState<string | null>(null)
  const [unread, setUnread] = useState(false)
  const [archived, setArchived] = useState(false)
  const [withReminder, setWithReminder] = useState(false)
  const [category, setCategory] = useState<ContactCategory | null>(null)
  const [starting, setStarting] = useState(false)
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const qs = new URLSearchParams({ ...(numberId ? { numero: numberId } : {}), ...(unread ? { naoLidas: 'true' } : {}), ...(archived ? { arquivadas: 'true' } : {}), ...(category ? { tipo: category } : {}), ...(withReminder && !monitor ? { lembretes: 'true' } : {}), ...(q ? { busca: q } : {}), ...(monitor ? { monitorar: 'true' } : {}), ...(monitor && sellerId ? { vendedor: sellerId } : {}), ...(monitor && awaiting ? { aguardando: 'true' } : {}), ...(queue ? { fila: 'true' } : {}) }).toString()
  const list = useQuery({ queryKey: ['chat-conversas', qs], queryFn: () => api.get<ListData>(`/chat/conversas?${qs}`), refetchInterval: 5000, placeholderData: keepPreviousData })
  const numbers = useMemo(() => new Map((list.data?.numbers ?? []).map((n) => [n.id, n])), [list.data?.numbers])
  const open = (id: string | null) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (id) n.set('conversa', id)
    else n.delete('conversa')
    return n
  })
  const setMonitor = (on: boolean) => setParams((p) => {
    const n = new URLSearchParams(p)
    n.delete('conversa')
    if (on) n.set('monitorar', '1')
    else n.delete('monitorar')
    return n
  })
  return (
    <div>
      <PageHeader
        title={monitor ? 'Monitorar conversas' : 'Chat WhatsApp'}
        description={monitor ? 'Conversas de todos os números e vendedores, só para leitura. Abrir aqui não marca como lida: o vendedor continua vendo as mensagens novas.' : 'Conversas dos números da empresa. Responda por aqui ou pelo celular: tudo fica no histórico do lead.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!onlyMonitor && can('monitoramento') && (
              <ToggleGroup type="single" variant="outline" size="sm" value={monitor ? 'equipe' : 'minhas'} onValueChange={(v) => v && setMonitor(v === 'equipe')} aria-label="Conversas">
                <ToggleGroupItem value="minhas" className="px-3">
                  Minhas conversas
                </ToggleGroupItem>
                <ToggleGroupItem value="equipe" className="px-3">
                  <EyeIcon /> Monitorar equipe
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            {!monitor && <AlertSettings />}
            {!monitor && can('chat', 'create') && (
              <Button onClick={() => setStarting(true)}>
                <MessageSquarePlusIcon /> Nova conversa
              </Button>
            )}
          </div>
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
                {monitor && (
                  <Select value={sellerId ?? ALL} onValueChange={(v) => setSellerId(v === ALL ? null : v)}>
                    <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Vendedor">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todos os vendedores</SelectItem>
                      {(list.data.sellers ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {monitor ? (
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title="A última mensagem é do contato">
                    <Switch checked={awaiting} onCheckedChange={setAwaiting} aria-label="Só aguardando resposta" /> Aguardando resposta
                  </label>
                ) : (
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch checked={withReminder} onCheckedChange={setWithReminder} aria-label="Só com lembrete" /> Lembretes
                  </label>
                )}
                {list.data.numbers.some((n) => n.splitAttendance) && (
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title="Clientes ainda sem atendente, nos números com atendimento dividido">
                    <Switch checked={queue} onCheckedChange={setQueue} aria-label="Só a fila" /> Fila
                  </label>
                )}
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
              {list.data.items.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa{archived ? ' arquivada' : ''}{q || unread || numberId || category || withReminder || sellerId || awaiting || queue ? ' com esses filtros' : archived ? '' : ' ainda'}.</li>}
              {list.data.items.map((c) => {
                const wc = c.category === 'CLIENTE' || !c.category ? waitColor(c, list.data.responseColors) : null
                return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    className={cn('flex w-full items-start gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/50', openId === c.id && 'bg-muted')}
                  >
                    <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserIcon className="size-4" />
                      {wc && <span className={cn('absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-background', wc.dot)} aria-label={`Sem resposta há ${waitText(wc.min)} (${wc.label})`} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn('truncate text-sm', c.unread > 0 && 'font-semibold')}>{c.name || formatPhone(c.phone) || 'Contato'}</span>
                        <span className={cn('shrink-0 text-xs tabular-nums', wc ? `font-medium ${wc.text}` : c.unread > 0 ? 'font-medium text-foreground' : 'text-muted-foreground')} title={wc ? `Cliente esperando resposta há ${waitText(wc.min)}` : undefined}>
                          {wc ? `há ${waitText(wc.min)}` : when(c.lastMessageAt)}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {c.lastFromMe && <CheckIcon className="mr-0.5 inline size-3" aria-label="Enviada pela empresa" />}
                          {c.lastPreview}
                        </span>
                        {c.reminderAt && (
                          <span className={cn('inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums', new Date(c.reminderAt) <= new Date() ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground')} title="Lembrete de retorno">
                            <AlarmClockIcon className="size-3" /> {when(c.reminderAt)}
                          </span>
                        )}
                        {c.noteUnread && !monitor && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" title="Nota interna nova da gestão">
                            <StickyNoteIcon className="size-3" /> Nota
                          </span>
                        )}
                        {c.unread > 0 && <Badge className="h-5 shrink-0 px-1.5 tabular-nums" aria-label={`${c.unread} não lidas`}>{c.unread}</Badge>}
                      </span>
                      {(list.data.numbers.length > 1 || (c.category && c.category !== 'CLIENTE') || monitor || numbers.get(c.numberId)?.splitAttendance) && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {[
                            numbers.get(c.numberId)?.splitAttendance && (!c.category || c.category === 'CLIENTE') ? (c.assignedUserName ? `com ${c.assignedUserName}` : 'Na fila') : null,
                            monitor && !numbers.get(c.numberId)?.splitAttendance ? c.attendant || 'sem vendedor' : null, list.data.numbers.length > 1 ? numbers.get(c.numberId)?.name : null, c.category && c.category !== 'CLIENTE' ? categoryLabel(c.category) : null].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
                )
              })}
            </ul>
          </div>
          <div className={cn('min-h-0', !openId && 'hidden md:block')}>
            {openId ? <ThreadView id={openId} onBack={() => open(null)} monitor={monitor} /> : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <MessageCircleIcon className="size-8" />
                Escolha uma conversa.
              </div>
            )}
          </div>
        </Card>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <InfoIcon className="size-3.5 shrink-0" /> As conversas dos números da empresa podem ser acompanhadas pela gestão comercial, conforme a política interna de uso do WhatsApp.
      </p>
    </div>
  )
}

export function ThreadView({ id, onBack, monitor = false }: { id: string; onBack?: () => void; monitor?: boolean }) {
  const { can } = useAuth()
  const mq = monitor ? 'monitorar=true' : ''
  const q = useQuery({ queryKey: ['chat-conversa', id, monitor], queryFn: () => api.get<Thread>(`/chat/conversas/${id}${mq ? `?${mq}` : ''}`), refetchInterval: 4000 })
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
      const r = await api.get<Thread>(`/chat/conversas/${id}?antes=${encodeURIComponent(messages[0].sentAt)}${mq ? `&${mq}` : ''}`)
      setOlder((o) => [...r.messages, ...o])
    } finally {
      setLoadingOlder(false)
    }
  }
  const title = d.conversation.name || formatPhone(d.conversation.phone) || 'Contato'
  return (
    <MonitorContext.Provider value={monitor}>
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
          {d.conversation.phone && (
            <Button asChild size="sm" variant="outline" title="Ligação pelo telefone (a ligação pelo WhatsApp é atendida no celular)">
              <a href={`tel:${d.conversation.phone}`}>
                <PhoneIcon /> Ligar
              </a>
            </Button>
          )}
          {can('monitoramento', 'create') && <NoteButton conversationId={d.conversation.id} monitor={monitor} />}
          {!monitor && d.attendance?.split && d.conversation.category === 'CLIENTE' && <AttendantPicker thread={d} />}
          {!monitor && <ReminderButton conversationId={d.conversation.id} />}
          {!monitor && <ConversationActions thread={d} />}
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
      {!monitor && <ReminderBar conversationId={d.conversation.id} />}
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
              {m.internal ? (
                <div className="mx-auto my-1 max-w-[90%] rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:max-w-[75%] dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                  <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold tracking-wide uppercase">
                    <LockIcon className="size-3" /> Nota interna · o cliente não vê
                  </p>
                  <p className="break-words whitespace-pre-wrap">{m.text}</p>
                  <p className="mt-0.5 text-right text-[11px] tabular-nums opacity-70">
                    {m.sentByName ? `${m.sentByName} · ` : ''}
                    {time.format(new Date(m.sentAt))}
                  </p>
                </div>
              ) : (
              <div className={cn('flex', m.fromMe ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] rounded-lg px-3 py-1.5 text-sm shadow-xs sm:max-w-[70%]', m.fromMe ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]' : 'bg-card')}>
                  <Bubble m={m} />
                  <p className={cn('mt-0.5 text-right text-[11px] tabular-nums', m.fromMe ? 'opacity-70' : 'text-muted-foreground')}>
                    {m.fromMe && (m.sentByName ? `${m.sentByName} · ` : 'pelo celular · ')}
                    {time.format(new Date(m.sentAt))}
                  </p>
                </div>
              </div>
              )}
            </div>
          )
        })}
        <div ref={end} />
      </div>
      {monitor ? (
        <p className="flex items-center gap-2 border-t bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
          <EyeIcon className="size-4 shrink-0" /> Monitoramento: só leitura. O vendedor e o cliente não são avisados, e a conversa continua como não lida para quem atende.
        </p>
      ) : (
        <Composer thread={d} />
      )}
    </div>
    </MonitorContext.Provider>
  )
}

/** Atendimento dividido: quem atende a conversa, assumir da fila e transferir para outro atendente ou setor. */
function AttendantPicker({ thread }: { thread: Thread }) {
  const qc = useQueryClient()
  const { me, can } = useAuth()
  const a = thread.attendance!
  const id = thread.conversation.id
  const mine = thread.conversation.assignedUserId === me?.id
  const free = !thread.conversation.assignedUserId
  const save = useMutation({
    mutationFn: (d: { userId?: string | null; sectorId?: string | null }) => api.post(`/chat/conversas/${id}/atendente`, d),
    onSuccess: (_r, d) => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      toast.success(d.userId === me?.id ? 'Conversa assumida: agora ela é sua.' : d.userId ? 'Conversa transferida.' : 'Conversa devolvida para a fila.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const canMove = can('chat', 'edit') || mine || free
  const value = thread.conversation.assignedUserId ? `u:${thread.conversation.assignedUserId}` : thread.conversation.sectorId ? `s:${thread.conversation.sectorId}` : 'fila'
  return (
    <>
      {free && can('chat', 'create') && (
        <Button size="sm" onClick={() => save.mutate({ userId: me?.id ?? null })} disabled={save.isPending}>
          <HandIcon /> Assumir
        </Button>
      )}
      {canMove ? (
        <Select
          value={value}
          onValueChange={(v) => save.mutate(v === 'fila' ? { userId: null, sectorId: null } : v.startsWith('s:') ? { userId: null, sectorId: v.slice(2) } : { userId: v.slice(2) })}
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Atendente da conversa">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fila">Na fila (todos)</SelectItem>
            {a.sectors.map((s) => (
              <SelectItem key={s.id} value={`s:${s.id}`}>
                Fila: {s.name}
              </SelectItem>
            ))}
            {a.attendants.map((u) => (
              <SelectItem key={u.id} value={`u:${u.id}`}>
                {u.id === me?.id ? `${u.name} (você)` : u.name}
              </SelectItem>
            ))}
            {thread.conversation.assignedUserId && !a.attendants.some((u) => u.id === thread.conversation.assignedUserId) && (
              <SelectItem value={`u:${thread.conversation.assignedUserId}`}>{thread.conversation.assignedUserName ?? 'Atendente'}</SelectItem>
            )}
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="outline">com {thread.conversation.assignedUserName ?? 'outro atendente'}</Badge>
      )}
    </>
  )
}

/** Nota interna: orientação da gestão na conversa (liberação de desconto, advertência). Fica só no CRM. */
function NoteButton({ conversationId, monitor }: { conversationId: string; monitor: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const save = useMutation({
    mutationFn: () => api.post(`/chat/conversas/${conversationId}/notas`, { text: text.trim() }),
    onSuccess: () => {
      setText('')
      setOpen(false)
      toast.success('Nota interna salva. O cliente não recebe; quem atende vê na conversa.')
      void qc.invalidateQueries({ queryKey: ['chat-conversa', conversationId] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" title="Nota interna: só aparece no CRM">
          <StickyNoteIcon /> Nota interna
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <LockIcon className="size-3.5" /> Nota interna
        </p>
        <p className="text-xs text-muted-foreground">Só aparece aqui no CRM, para quem atende{monitor ? ' (o vendedor é avisado na lista de conversas)' : ''}. O cliente nunca recebe.</p>
        <Textarea rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: desconto de 5% liberado para este pedido." aria-label="Texto da nota interna" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!text.trim() || save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar nota
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
  const voice = useVoiceRecorder(async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api.post(`/chat/conversas/${id}/audio`, fd)
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })
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
        {voice.recording ? (
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1.5 text-sm tabular-nums text-destructive" aria-live="polite">
              <span className="size-2 animate-pulse rounded-full bg-destructive" /> {voice.elapsed}
            </span>
            <Button type="button" size="icon" variant="ghost" onClick={voice.cancel} aria-label="Descartar áudio" title="Descartar">
              <Trash2Icon />
            </Button>
            <Button type="button" size="icon" onClick={voice.stop} aria-label="Enviar áudio" title="Enviar áudio">
              <SendIcon />
            </Button>
          </div>
        ) : !text.trim() && !file ? (
          <Button type="button" size="icon" onClick={() => void voice.start()} disabled={voice.sending} aria-label="Gravar áudio" title="Gravar mensagem de voz">
            {voice.sending ? <Loader2Icon className="animate-spin" /> : <MicIcon />}
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={send.isPending} aria-label="Enviar">
            {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          </Button>
        )}
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
  const monitor = useContext(MonitorContext)
  const src = `/api/chat/midias/${m.id}${monitor ? '?monitorar=true' : ''}`
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
  if (m.type === 'chamada') {
    const video = /vídeo/i.test(m.text ?? '')
    return (
      <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
        {video ? <VideoIcon className="size-4 shrink-0" /> : <PhoneIncomingIcon className="size-4 shrink-0" />}
        {m.text}
      </p>
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

/**
 * Gravação de voz no navegador (microfone só com permissão da pessoa). Chrome grava WebM, Firefox OGG e Safari MP4;
 * o servidor manda como mensagem de voz do WhatsApp. Até 5 minutos.
 */
function useVoiceRecorder(onDone: (file: File) => Promise<void>) {
  const [recording, setRecording] = useState(false)
  const [sending, setSending] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const discard = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const cleanup = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    rec.current?.stream.getTracks().forEach((tr) => tr.stop())
    rec.current = null
    setRecording(false)
  }
  useEffect(() => () => {
    discard.current = true
    if (rec.current?.state === 'recording') rec.current.stop()
    cleanup()
  }, [])
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return void toast.error('Este navegador não grava áudio.')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return void toast.error('Sem acesso ao microfone. Libere o microfone para este site no navegador.')
    }
    const type = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    chunks.current = []
    discard.current = false
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    r.onstop = () => {
      const mime = r.mimeType || type || 'audio/webm'
      const blob = new Blob(chunks.current, { type: mime })
      cleanup()
      if (discard.current || blob.size < 1000) return
      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'
      setSending(true)
      void onDone(new File([blob], `audio.${ext}`, { type: mime })).finally(() => setSending(false))
    }
    rec.current = r
    r.start(1000)
    setSeconds(0)
    setRecording(true)
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= 300) rec.current?.stop()
        return s + 1
      })
    }, 1000)
  }
  return {
    recording,
    sending,
    elapsed: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    start,
    stop: () => rec.current?.stop(),
    cancel: () => {
      discard.current = true
      rec.current?.stop()
    },
  }
}

/** Som dos avisos e notificação do navegador (preferências deste computador). */
function AlertSettings() {
  const [sound, setSound] = useState(soundOn())
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setSoundOn(!sound)
          setSound(!sound)
        }}
        title={sound ? 'Desligar o som dos avisos' : 'Ligar o som dos avisos'}
        aria-label={sound ? 'Desligar o som dos avisos' : 'Ligar o som dos avisos'}
      >
        {sound ? <Volume2Icon /> : <VolumeXIcon />} Som
      </Button>
      {perm === 'default' && (
        <Button size="sm" variant="outline" onClick={() => void Notification.requestPermission().then(setPerm)} title="Avisar mensagem nova mesmo com o CRM em outra aba">
          <BellIcon /> Ativar notificações
        </Button>
      )}
      {perm === 'denied' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Libere as notificações para este site nas configurações do navegador">
          <BellOffIcon className="size-3.5" /> Notificações bloqueadas no navegador
        </span>
      )}
    </>
  )
}

interface Reminder {
  id: string
  dueAt: string
  note: string | null
  userName: string
  mine: boolean
}

/** Horário pronto: em 1 hora, amanhã às 9h, em 3 dias às 9h. */
function preset(kind: '1h' | 'amanha' | '3d') {
  const d = new Date()
  if (kind === '1h') return new Date(d.getTime() + 3_600_000)
  d.setDate(d.getDate() + (kind === 'amanha' ? 1 : 3))
  d.setHours(9, 0, 0, 0)
  return d
}
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })

function ReminderButton({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [due, setDue] = useState(() => localInput(preset('amanha')))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api.post(`/chat/conversas/${conversationId}/lembretes`, { dueAt: new Date(due).toISOString(), note: note || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-lembretes', conversationId] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      void qc.invalidateQueries({ queryKey: ['chat-alertas'] })
      toast.success(`Lembrete para ${dateTime.format(new Date(due))}.`)
      setOpen(false)
      setNote('')
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} title="Lembrete de retorno">
        <AlarmClockIcon /> Lembrete
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                setError(null)
                save.mutate()
              }}
            >
              <DialogHeader>
                <DialogTitle>Lembrete de retorno</DialogTitle>
                <DialogDescription>No horário, o CRM avisa você (na tela, com som e notificação do navegador) com o atalho para esta conversa.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap gap-2">
                {([['1h', 'Em 1 hora'], ['amanha', 'Amanhã às 9h'], ['3d', 'Em 3 dias']] as const).map(([k, label]) => (
                  <Button key={k} type="button" size="sm" variant="outline" onClick={() => setDue(localInput(preset(k)))}>
                    {label}
                  </Button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rem-due">Data e hora</Label>
                <Input id="rem-due" type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rem-note">Observação (opcional)</Label>
                <Input id="rem-note" maxLength={500} placeholder="Ex.: confirmar se aprovou o orçamento" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  Criar lembrete
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/** Lembretes em aberto da conversa, com concluir. */
function ReminderBar({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['chat-lembretes', conversationId], queryFn: () => api.get<Reminder[]>(`/chat/conversas/${conversationId}/lembretes`) })
  const done = useMutation({
    mutationFn: (id: string) => api.post(`/chat/lembretes/${id}/concluir`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-lembretes', conversationId] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      void qc.invalidateQueries({ queryKey: ['chat-alertas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!q.data?.length) return null
  return (
    <ul className="space-y-1 border-b bg-amber-500/5 px-3 py-2">
      {q.data.map((r) => {
        const late = new Date(r.dueAt) <= new Date()
        return (
          <li key={r.id} className="flex items-center gap-2 text-xs">
            <AlarmClockIcon className={cn('size-3.5 shrink-0', late ? 'text-amber-600' : 'text-muted-foreground')} />
            <span className={cn('tabular-nums', late && 'font-medium text-amber-800 dark:text-amber-300')}>{dateTime.format(new Date(r.dueAt))}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {r.note ?? 'Retornar a conversa'}
              {!r.mine ? ` · de ${r.userName}` : ''}
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-2" disabled={done.isPending} onClick={() => done.mutate(r.id)}>
              <CheckIcon /> Concluir
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
