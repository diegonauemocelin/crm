import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClockIcon, AlertCircleIcon, BanIcon, CircleCheckBigIcon, FileTextIcon, CheckCheckIcon, EllipsisVerticalIcon, PencilIcon, DownloadIcon, ForwardIcon, ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, BellIcon, BookUserIcon, BellOffIcon, CheckIcon, EyeIcon, FileIcon, HandIcon, HourglassIcon, InfoIcon, ListChecksIcon, ReplyIcon, SmilePlusIcon, SmileIcon, StickerIcon, Loader2Icon, LockIcon, MapPinIcon, MegaphoneIcon, MessageCircleIcon, MessageSquarePlusIcon, MicIcon, PaperclipIcon, PhoneOutgoingIcon, PhoneIcon, PhoneIncomingIcon, SearchIcon, SendIcon, SmartphoneIcon, StickyNoteIcon, Trash2Icon, UserIcon, UsersIcon, VideoIcon, Volume2Icon, VolumeXIcon, XIcon, ZapIcon } from 'lucide-react'
import { createContext, Fragment, type FormEvent, type KeyboardEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { type ChatService, LastSeller, quickPrefill, ServiceButtons, StageBadge, type StageInfo } from '@/components/chat/atendimento-chat'
import { ClientPanel } from '@/components/chat/painel-cliente'
import { ContactBubble, ShareContactButton } from '@/components/chat/compartilhar-contato'
import { ForwardDialog } from '@/components/chat/encaminhar'
import { ToCallPanel } from '@/components/chat/para-chamar'
import { type ChatLabel, LabelChip, LabelPicker, ManageRepliesDialog, useLabels } from '@/components/chat/organizar'
import { isDirty, useCloseGuard, useConfirm } from '@/components/confirm'
import { ErrorState, InlineError, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { EmojiGrid, EmojiStickerPanel } from '@/components/chat/emojis'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { formatPhone, maskPhone, useOptions } from '@/lib/atendimento'
import { dateShort, dateTime, time } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { setSoundOn, soundOn, useChatAlerts } from '@/lib/chat-alerts'
import { splitLinks, splitPhones } from '@/lib/links'
import { menuFor } from '@/lib/menu'
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
  /** O cliente só agradeceu ou se despediu (ou alguém marcou "Não precisa responder"): não conta como esperando. */
  noReplyNeeded?: boolean
  /** Última mensagem do cliente: o tempo de "aguardando retorno" conta daqui. */
  lastInboundAt?: string | null
  category?: ContactCategory | 'GRUPO'
  status?: string
  reminderAt?: string | null
  /** Etiquetas que este usuário vê (padrão da empresa e as pessoais dele). */
  labels?: ChatLabel[]
  /** Fase do atendimento mais recente do contato (pré ou pós-venda). */
  stage?: StageInfo | null
}
interface ListData {
  /** Prazos das cores de atraso de resposta (minutos desde a última mensagem do cliente). */
  responseColors?: { yellowMinutes: number; redMinutes: number }
  /** Só no monitoramento: vendedores para o filtro. */
  sellers?: { id: string; name: string }[]
  total: number
  unreadConversations: number
  /** Grupos com mensagem não lida (selo da aba Grupos). */
  unreadGroups?: number
  /** Conversas aguardando o vendedor retornar. */
  waitingSeller?: number
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
  mediaStatus: 'PENDENTE' | 'OK' | 'GRANDE' | 'ERRO' | 'APAGADA' | null
  hasFile: boolean
  sentAt: string
  sentByName?: string | null
  status?: string | null
  /** Resposta (citação): o trecho da mensagem respondida e se ela era da empresa. */
  quotedText?: string | null
  quotedFromMe?: boolean | null
  /** A mensagem respondida, quando está no CRM (clicar na citação vai até ela). */
  quotedId?: string | null
  /** Reações (emoji), uma por pessoa. */
  reactions?: { emoji: string; by: 'me' | 'them'; name: string | null }[]
  /** Corrigida depois do envio e apagada para todos (o texto deixa de aparecer). */
  editedAt?: string | null
  deleted?: boolean
  /** Enviada pela empresa e ainda no prazo do WhatsApp: corrigir (15 min) e apagar para todos (2 dias). */
  canEdit?: boolean
  canDelete?: boolean
  /** Áudio transcrito (Gemini), quando alguém já pediu. */
  transcript?: string | null
}
interface Thread {
  conversation: { id: string; name: string | null; phone: string | null; jid: string; status: 'ABERTA' | 'ARQUIVADA'; assignedSellerId: string | null; assignedUserId?: string | null; assignedUserName?: string | null; helpers?: { id: string; name: string }[]; sectorId?: string | null; category: ContactCategory | 'GRUPO'; labels?: ChatLabel[]; noReplyNeeded?: boolean; lastInboundAt?: string | null }
  /** Contato salvo na agenda do número (ou na geral). */
  agenda?: { name: string | null; category: string; general: boolean } | null
  number: NumberRef | null
  attendance?: { split: boolean; sectors: { id: string; name: string }[]; attendants: { id: string; name: string }[] } | null
  lead: { id: string; name: string | null; email: string | null; phone: string | null } | null
  /** Pré-venda e pós-venda mais recentes do contato e o último vendedor que atendeu. */
  service?: ChatService
  record: { id: string; kind: 'PRE_VENDAS' | 'POS_VENDAS'; leadAt: string; saleStatus: string; adsVia: string | null; adsCampaign: string | null; adsCampaignId: string | null; entryChannel: string | null } | null
  hasMore: boolean
  messages: Message[]
  /** Finalizar atendimento: mensagem de encerramento (null = desligada) e quando/quem finalizou. */
  closeText?: string | null
  closedAt?: string | null
  closedByName?: string | null
  monitor?: boolean
}

const ALL = '__all__'
export type ContactCategory = 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
export const CATEGORY_LABEL: Record<ContactCategory, string> = { CLIENTE: 'Cliente / lead', COLEGA: 'Colega de trabalho', FORNECEDOR: 'Fornecedor', OUTRO: 'Outro (não é venda)' }
/** Com a regra "A classificar", o contato novo fica assim até alguém marcar. */
const categoryLabel = (c: string | undefined) => (c === 'NOVO' ? 'A classificar' : c === 'GRUPO' ? 'Grupo' : (CATEGORY_LABEL[c as ContactCategory] ?? c ?? ''))
const dayKey = (iso: string) => dateShort(iso)

/** Iniciais e cor fixa por contato, como a foto vazia do WhatsApp. */
const AVATAR_COLORS = ['bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600', 'bg-indigo-600', 'bg-orange-600']
function Avatar({ name, group, className }: { name: string | null; group?: boolean; className?: string }) {
  const letters = (name ?? '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  const text = letters.length ? (letters[0]![0]! + (letters.length > 1 ? letters[letters.length - 1]![0]! : '')).toUpperCase() : ''
  const color = AVATAR_COLORS[[...(name ?? '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length]
  return (
    <span className={cn('relative flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white', text && !group ? color : 'bg-muted text-muted-foreground', className)} aria-hidden>
      {group ? <UsersIcon className="size-4" /> : text || <UserIcon className="size-4" />}
    </span>
  )
}

/** Etiqueta do dia no meio da conversa: Hoje, Ontem ou a data. */
function dayLabel(iso: string) {
  const k = dayKey(iso)
  if (k === dateShort(new Date())) return 'Hoje'
  if (k === dateShort(new Date(Date.now() - 86_400_000))) return 'Ontem'
  return k
}

/**
 * Altura do chat até o fim da tela (como o WhatsApp Web), seja qual for a altura do topo da página: os botões podem
 * quebrar em duas linhas em telas menores.
 */
function useFillHeight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setHeight(Math.max(448, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 16)))
    update()
    window.addEventListener('resize', update)
    const ro = new ResizeObserver(update)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => (window.removeEventListener('resize', update), ro.disconnect())
  })
  return [ref, height] as const
}

/** Hora se for hoje; senão, a data. */
/** Cor do atraso de resposta (verde, amarelo, vermelho): conta da última mensagem do cliente até o atendente marcar "Não precisa responder". */
const WAIT_COLOR = {
  verde: { dot: 'bg-[#16a34a]', text: 'text-[#15803d] dark:text-[#4ade80]', label: 'dentro do prazo' },
  amarelo: { dot: 'bg-[#eab308]', text: 'text-[#a16207] dark:text-[#facc15]', label: 'atenção' },
  vermelho: { dot: 'bg-[#dc2626]', text: 'text-[#b91c1c] dark:text-[#f87171]', label: 'atrasada' },
} as const
function waitColor(c: { noReplyNeeded?: boolean; lastInboundAt?: string | null; status?: string }, r: ListData['responseColors']) {
  if (!r || c.noReplyNeeded || !c.lastInboundAt || c.status === 'ARQUIVADA') return null
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(c.lastInboundAt)) / 60_000))
  const k = min < r.yellowMinutes ? 'verde' : min < r.redMinutes ? 'amarelo' : 'vermelho'
  return { ...WAIT_COLOR[k], min }
}
const waitText = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} dia(s)`)

/** Tracinhos do WhatsApp nas mensagens enviadas: enviada, entregue, lida (azul) ou com erro. */
function Receipt({ status }: { status?: string | null }) {
  if (status === 'LIDA') return <CheckCheckIcon className="ml-1 inline size-3.5 text-sky-600 dark:text-sky-400" aria-label="Lida" />
  if (status === 'ENTREGUE') return <CheckCheckIcon className="ml-1 inline size-3.5" aria-label="Entregue" />
  if (status === 'ERRO') return <AlertCircleIcon className="ml-1 inline size-3.5 text-destructive" aria-label="Não enviada" />
  if (status === 'ENVIADA') return <CheckIcon className="ml-1 inline size-3.5" aria-label="Enviada" />
  return null
}

/** Aba Grupos: os grupos de cada número juntos, na ordem dos números; dentro do número, o mais recente primeiro. */
function byNumber(items: ConvItem[], numbers: NumberRef[]) {
  const order = new Map(numbers.map((n, i) => [n.id, i]))
  return [...items].sort((a, b) => (order.get(a.numberId) ?? 99) - (order.get(b.numberId) ?? 99))
}

function when(iso: string | null) {
  if (!iso) return ''
  return dayKey(iso) === dateShort(new Date()) ? time(iso) : dateShort(iso).slice(0, 5)
}

/** Telas novas: painel do cliente, pré-venda rápida e "/" nas respostas; no layout Moderno, também as cores de espera. */
function useScreens() {
  const { me } = useAuth()
  const novo = me?.screens === 'NOVO'
  return { novo, colors: novo && me?.layout !== 'CLASSIC' }
}

/** Monitoramento (ler as conversas da equipe sem responder e sem marcar como lidas): a mídia usa a mesma regra. */
const MonitorContext = createContext(false)
/** Número de WhatsApp da conversa aberta: telefone clicado na mensagem abre a conversa por ele. */
const ThreadNumberContext = createContext<string | null>(null)

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
  const toCall = !monitor && params.get('aba') === 'chamar'
  // Grupos ficam numa aba própria: não entram em pré-venda, avisos nem cores de espera.
  const groups = params.get('aba') === 'grupos'
  // Pré-venda repassada ao vendedor e ainda sem retorno: aba própria, separada das conversas.
  const waitingSeller = !monitor && params.get('aba') === 'vendedor'
  const [sellerId, setSellerId] = useState<string | null>(null)
  const [awaiting, setAwaiting] = useState(false)
  const [queue, setQueue] = useState(false)
  const [numberId, setNumberId] = useState<string | null>(null)
  const [unread, setUnread] = useState(() => params.get('naoLidas') === '1')
  const [archived, setArchived] = useState(false)
  const [withReminder, setWithReminder] = useState(false)
  const [category, setCategory] = useState<ContactCategory | null>(null)
  const [labelId, setLabelId] = useState<string | null>(null)
  const labels = useLabels()
  // Monitorar: tudo (permissão) ou a equipe de quem é gestor (Configurações › Setores e equipes).
  const monitorAccess = useQuery({ queryKey: ['chat-monitoramento'], queryFn: () => api.get<{ scope: 'TODOS' | 'EQUIPE' | null }>('/chat/monitoramento'), staleTime: 5 * 60_000 })
  const canWatch = !!monitorAccess.data?.scope
  const [starting, setStarting] = useState(false)
  const { can } = useAuth()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { novo, colors } = useScreens()
  // Finalizar vários: escolher conversas na lista e encerrar todas de uma vez, sem a mensagem de encerramento.
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [finishing, setFinishing] = useState(false)
  const canPick = !monitor && !archived && can('chat', 'create')
  const picking = canPick && !!picked
  const [fill, fillHeight] = useFillHeight<HTMLDivElement>()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const qs = new URLSearchParams({ ...(numberId ? { numero: numberId } : {}), ...(unread ? { naoLidas: 'true' } : {}), ...(archived ? { arquivadas: 'true' } : {}), ...(groups ? { tipo: 'GRUPO' } : category ? { tipo: category } : {}), ...(waitingSeller ? { aguardandoVendedor: 'true' } : {}), ...(withReminder && !monitor ? { lembretes: 'true' } : {}), ...(q ? { busca: q } : {}), ...(monitor ? { monitorar: 'true' } : {}), ...(monitor && sellerId ? { vendedor: sellerId } : {}), ...(monitor && awaiting ? { aguardando: 'true' } : {}), ...(queue ? { fila: 'true' } : {}), ...(labelId ? { etiqueta: labelId } : {}) }).toString()
  const list = useQuery({ queryKey: ['chat-conversas', qs], queryFn: () => api.get<ListData>(`/chat/conversas?${qs}`), refetchInterval: 5000, placeholderData: keepPreviousData })
  const numbers = useMemo(() => new Map((list.data?.numbers ?? []).map((n) => [n.id, n])), [list.data?.numbers])
  const open = (id: string | null) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (id) n.set('conversa', id)
    else n.delete('conversa')
    return n
  })
  const setTab = (tab: 'conversas' | 'chamar' | 'grupos' | 'vendedor', conversa?: string) => setParams((p) => {
    const n = new URLSearchParams(p)
    n.delete('conversa')
    if (tab !== 'conversas') n.set('aba', tab)
    else n.delete('aba')
    if (conversa) n.set('conversa', conversa)
    return n
  })
  const setMonitor = (on: boolean) => setParams((p) => {
    const n = new URLSearchParams(p)
    n.delete('conversa')
    if (on) n.set('monitorar', '1')
    else n.delete('monitorar')
    return n
  })
  const togglePick = (id: string) =>
    setPicked((cur) => {
      const n = new Set(cur)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const finishPicked = async () => {
    if (!picked?.size) return
    const n = picked.size
    const ok = await confirm({
      title: `Finalizar ${n} ${n === 1 ? 'atendimento' : 'atendimentos'}?`,
      description: 'As conversas saem do atendente e da fila e vão para as arquivadas. Nenhuma mensagem é enviada aos contatos. Se o cliente chamar de novo, é um atendimento novo.',
      confirmLabel: `Finalizar ${n}`,
      destructive: false,
    })
    if (!ok) return
    setFinishing(true)
    try {
      const r = await api.post<{ done: number; failed: { id: string; error: string }[] }>('/chat/conversas/finalizar-varias', { ids: [...picked] })
      if (r.failed.length) toast.warning(`${r.done} finalizado(s). ${r.failed.length} não: ${r.failed[0]!.error}`)
      else toast.success(`${r.done} ${r.done === 1 ? 'atendimento finalizado' : 'atendimentos finalizados'}, sem mensagem de encerramento.`)
      if (openId && picked.has(openId)) open(null)
      setPicked(null)
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setFinishing(false)
    }
  }
  return (
    <div>
      <PageHeader
        title={monitor ? 'Monitorar conversas' : 'Chat WhatsApp'}
        description={monitor ? `${monitorAccess.data?.scope === 'EQUIPE' ? 'Conversas da sua equipe e dos setores que você gerencia' : 'Conversas de todos os números e vendedores'}, só para leitura. Abrir aqui não marca como lida: quem atende continua vendo as mensagens novas.` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!onlyMonitor && canWatch && (
              <ToggleGroup type="single" variant="outline" size="sm" value={monitor ? 'equipe' : 'minhas'} onValueChange={(v) => v && setMonitor(v === 'equipe')} aria-label="Conversas">
                <ToggleGroupItem value="minhas" className="px-3">
                  Minhas conversas
                </ToggleGroupItem>
                <ToggleGroupItem value="equipe" className="px-3">
                  <EyeIcon /> Monitorar equipe
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <ToggleGroup type="single" variant="outline" size="sm" value={toCall ? 'chamar' : groups ? 'grupos' : waitingSeller ? 'vendedor' : 'conversas'} onValueChange={(v) => v && setTab(v as 'conversas' | 'chamar' | 'grupos' | 'vendedor')} aria-label="Aba">
              <ToggleGroupItem value="conversas" className="px-3">
                Conversas
              </ToggleGroupItem>
              {!monitor && (
                <ToggleGroupItem value="vendedor" className="px-3" title="Pré-venda repassada ao vendedor, esperando ele retornar. Sai daqui quando o vendedor retorna ou a venda fecha.">
                  <HourglassIcon /> Aguardando vendedor
                  {!!list.data?.waitingSeller && !waitingSeller && <Badge variant="secondary" className="h-5 px-1.5 tabular-nums">{list.data.waitingSeller}</Badge>}
                </ToggleGroupItem>
              )}
              <ToggleGroupItem value="grupos" className="px-3" title="Grupos do WhatsApp: ficam separados e não entram no controle de pré-vendas">
                <UsersIcon /> Grupos
                {!!list.data?.unreadGroups && !groups && <Badge className="h-5 px-1.5 tabular-nums">{list.data.unreadGroups}</Badge>}
              </ToggleGroupItem>
              {!monitor && can('leads') && can('chat', 'create') && (
                <ToggleGroupItem value="chamar" className="px-3" title="Leads com telefone que preencheram formulário ou compraram e ainda não conversaram no WhatsApp">
                  <PhoneOutgoingIcon /> Leads para chamar
                </ToggleGroupItem>
              )}
            </ToggleGroup>
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
      {toCall && <ToCallPanel onStarted={(cid) => setTab('conversas', cid)} />}
      {!toCall && list.isLoading && <TableSkeleton rows={6} />}
      {!toCall && list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {!toCall && list.data && (
        <Card ref={fill} style={fillHeight ? { height: fillHeight } : undefined} className={cn('grid h-[calc(100dvh-13rem)] min-h-[28rem] grid-cols-1 gap-0 overflow-hidden p-0 md:grid-cols-[20rem_minmax(0,1fr)]', novo && openId && 'xl:grid-cols-[20rem_minmax(0,1fr)_19rem]')}>
          <div className={cn('flex min-h-0 flex-col border-r', openId && 'hidden md:flex')}>
            <div className="space-y-2 border-b p-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Nome, telefone ou mensagem" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar conversa" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={numberId ?? ALL} onValueChange={(v) => setNumberId(v === ALL ? null : v)}>
                  <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Número">
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
                {!groups && <Select value={category ?? ALL} onValueChange={(v) => setCategory(v === ALL ? null : (v as ContactCategory))}>
                  <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Filtrar por tipo de contato">
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
                </Select>}
                {(labels.data ?? []).length > 0 && (
                  <Select value={labelId ?? ALL} onValueChange={(v) => setLabelId(v === ALL ? null : v)}>
                    <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Filtrar por etiqueta">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todas as etiquetas</SelectItem>
                      {labels.data!.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {monitor && (
                  <Select value={sellerId ?? ALL} onValueChange={(v) => setSellerId(v === ALL ? null : v)}>
                    <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Vendedor">
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
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
                  <Switch checked={archived} onCheckedChange={(v) => (setArchived(v), setPicked(null))} aria-label="Ver arquivadas" /> Arquivadas
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={unread} onCheckedChange={setUnread} aria-label="Só não lidas" /> Não lidas
                  {list.data.unreadConversations > 0 && <Badge className="h-5 px-1.5 tabular-nums">{list.data.unreadConversations}</Badge>}
                </label>
                {canPick && !picked && list.data.items.length > 0 && (
                  <Button size="sm" variant="ghost" className="ml-auto h-6 px-1.5 text-xs" onClick={() => setPicked(new Set())} title="Escolher várias conversas para finalizar de uma vez, sem mensagem de encerramento">
                    <ListChecksIcon /> Selecionar
                  </Button>
                )}
              </div>
            </div>
            {picking && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-3 py-2 text-xs">
                <span className="font-medium">
                  {picked!.size} {picked!.size === 1 ? 'selecionada' : 'selecionadas'}
                </span>
                <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setPicked(picked!.size === list.data.items.length ? new Set() : new Set(list.data.items.map((c) => c.id)))}>
                  {picked!.size === list.data.items.length ? 'Limpar' : 'Todas da lista'}
                </button>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPicked(null)}>
                    Cancelar
                  </Button>
                  <Button size="sm" className="h-7 px-2 text-xs" disabled={!picked!.size || finishing} onClick={finishPicked}>
                    {finishing ? <Loader2Icon className="animate-spin" /> : <CircleCheckBigIcon />} Finalizar sem mensagem
                  </Button>
                </span>
              </div>
            )}
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.data.items.length === 0 && waitingSeller && !q && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa aguardando vendedor. Quando a pré-venda for marcada como repassada ao vendedor, a conversa vem para cá até ele retornar.</li>}
              {list.data.items.length === 0 && groups && !q && <li className="p-6 text-center text-sm text-muted-foreground">Nenhum grupo ainda. As mensagens dos grupos do WhatsApp aparecem aqui, separadas das conversas com clientes.</li>}
              {list.data.items.length === 0 && !(groups && !q) && !(waitingSeller && !q) && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa{archived ? ' arquivada' : ''}{q || unread || numberId || category || labelId || withReminder || sellerId || awaiting || queue ? ' com esses filtros' : archived ? '' : ' ainda'}.</li>}
              {(groups ? byNumber(list.data.items, list.data.numbers) : list.data.items).map((c, i, arr) => {
                const wc = c.category === 'CLIENTE' || !c.category ? waitColor(c, list.data.responseColors) : null
                // Aba Grupos: cada grupo aparece debaixo do número que o recebeu (o mesmo grupo em dois números são duas conversas).
                const numberHead = groups && (i === 0 || arr[i - 1]!.numberId !== c.numberId)
                return (
                <li key={c.id}>
                  {numberHead && (
                    <p className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                      <SmartphoneIcon className="size-3.5" /> {numbers.get(c.numberId)?.name ?? 'Número'}
                      {numbers.get(c.numberId)?.phone && <span className="font-normal">· {formatPhone(numbers.get(c.numberId)!.phone)}</span>}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => (picking ? togglePick(c.id) : open(c.id))}
                    aria-pressed={picking ? picked!.has(c.id) : undefined}
                    className={cn(
                      'flex w-full items-start gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/50',
                      openId === c.id && !picking && 'bg-[#f0f2f5] dark:bg-[#2a3942]',
                      picking && picked!.has(c.id) && 'bg-primary/5',
                      colors && openId !== c.id && wc?.label === 'atrasada' && 'bg-orange-50 dark:bg-orange-500/10',
                      colors && openId !== c.id && wc?.label === 'atenção' && 'bg-amber-50/70 dark:bg-amber-500/5',
                    )}
                  >
                    <span className="relative mt-0.5 shrink-0">
                      {picking ? (
                        <span className={cn('flex size-10 items-center justify-center rounded-full border-2', picked!.has(c.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')} aria-hidden>
                          <CheckIcon className={cn('size-5', !picked!.has(c.id) && 'invisible')} />
                        </span>
                      ) : (
                        <Avatar name={c.name} group={c.category === 'GRUPO'} />
                      )}
                      {wc && !picking && <span className={cn('absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-background', wc.dot)} aria-label={`Sem resposta há ${waitText(wc.min)} (${wc.label})`} />}
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
                          <span className={cn('inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums', new Date(c.reminderAt) <= new Date() ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground')} title="Lembrete de retorno">
                            <AlarmClockIcon className="size-3" /> {when(c.reminderAt)}
                          </span>
                        )}
                        {c.noteUnread && !monitor && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 text-xs font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" title="Nota interna nova da gestão">
                            <StickyNoteIcon className="size-3" /> Nota
                          </span>
                        )}
                        {c.unread > 0 && <Badge className={cn('h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 tabular-nums', 'bg-[#25d366] text-white')} aria-label={`${c.unread} não lidas`}>{c.unread}</Badge>}
                      </span>
                      {((c.labels ?? []).length > 0 || c.stage) && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {c.stage && (!c.category || c.category === 'CLIENTE') && <StageBadge stage={c.stage} />}
                          {c.labels!.map((l) => (
                            <LabelChip key={l.id} label={l} />
                          ))}
                        </span>
                      )}
                      {(list.data.numbers.length > 1 || (c.category && c.category !== 'CLIENTE') || monitor || numbers.get(c.numberId)?.splitAttendance) && (
                        <span className="block truncate text-xs text-muted-foreground">
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
          {novo && openId && (
            <div className="hidden min-h-0 xl:block">
              <ClientPanel id={openId} monitor={monitor} />
            </div>
          )}
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
  const { novo, colors } = useScreens()
  const options = useOptions()
  const alerts = useChatAlerts().data
  const [older, setOlder] = useState<Message[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  /** Encaminhar: as mensagens escolhidas (modo de seleção) e a janela de destinos. */
  const [selecting, setSelecting] = useState<string[] | null>(null)
  const [forwarding, setForwarding] = useState(false)
  /** Responder: a mensagem citada na próxima mensagem enviada. */
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  /** Arrastar e soltar arquivo do computador na conversa: o arquivo solto e o aviso enquanto arrasta. */
  const [dropped, setDropped] = useState<File[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const end = useRef<HTMLDivElement>(null)
  const lastId = q.data?.messages.at(-1)?.id
  useEffect(() => {
    setOlder([])
    setSelecting(null)
    setReplyTo(null)
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
  // Encaminhar: texto, localização, contato e arquivos que estão guardados no CRM.
  const canForward = (m: Message) => !monitor && can('chat', 'create') && !m.deleted && (['texto', 'localizacao', 'contato'].includes(m.type) ? !!m.text : ['imagem', 'video', 'audio', 'documento', 'figurinha'].includes(m.type) && m.hasFile)
  // Reagir e responder: qualquer mensagem da conversa, menos aviso de ligação.
  const canAct = (m: Message) => !monitor && can('chat', 'create') && m.type !== 'chamada' && !m.deleted
  const toggleSelect = (mid: string) => setSelecting((s) => (!s ? [mid] : s.includes(mid) ? s.filter((x) => x !== mid) : s.length >= 20 ? (toast.error('No máximo 20 mensagens por vez.'), s) : [...s, mid]))
  return (
    <MonitorContext.Provider value={monitor}>
    <ThreadNumberContext.Provider value={d.number?.id ?? null}>
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={(e) => {
        if (monitor || !can('chat', 'create') || !e.dataTransfer.types.includes('Files')) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && !monitor && e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={(e) => {
        dragDepth.current = 0
        setDragging(false)
        if (monitor || !can('chat', 'create') || !e.dataTransfer.files.length) return
        e.preventDefault()
        setDropped([...e.dataTransfer.files])
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#25d366] bg-white/85 text-center dark:bg-[#111b21]/85">
          <PaperclipIcon className="size-8 text-[#25d366]" />
          <p className="font-medium">Solte para anexar</p>
          <p className="text-xs text-muted-foreground">Foto, vídeo, PDF, planilha… até 64 MB. Você confere antes de enviar.</p>
        </div>
      )}
      <div className={cn('@container/head space-y-2 border-b bg-[#f0f2f5] px-3 py-2 dark:bg-[#202c33]')}>
        <div className="flex items-start gap-2">
          {onBack && (
            <Button size="icon" variant="ghost" className="size-8 shrink-0 md:hidden" onClick={onBack} aria-label="Voltar para a lista">
              <ArrowLeftIcon />
            </Button>
          )}
          <Avatar name={d.conversation.name ?? d.lead?.name ?? null} group={d.conversation.category === 'GRUPO'} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{title}</p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {d.conversation.phone && <span className="whitespace-nowrap">{formatPhone(d.conversation.phone)}</span>}
              {d.number && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <SmartphoneIcon className="size-3" /> {d.number.name}
                </span>
              )}
              <LastSeller service={d.service} />
              {d.record?.adsVia && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap text-sky-700 dark:text-sky-300">
                  <MegaphoneIcon className="size-3" /> Google Ads{d.record.adsCampaign ? ` · ${d.record.adsCampaign}` : d.record.adsCampaignId ? ` · campanha nº ${d.record.adsCampaignId}` : ''}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {d.conversation.category === 'CLIENTE' && <ServiceButtons service={d.service} contact={{ name: d.lead?.name ?? d.conversation.name, phone: d.conversation.phone, email: d.lead?.email }} prefill={novo ? () => quickPrefill({ name: d.lead?.name ?? d.conversation.name, phone: d.conversation.phone, email: d.lead?.email }, messages, options.data) : undefined} />}
          {!monitor && <LabelPicker conversationId={d.conversation.id} value={d.conversation.labels ?? []} />}
          {!monitor && <ReminderButton conversationId={d.conversation.id} />}
          {can('monitoramento', 'create') && <NoteButton conversationId={d.conversation.id} monitor={monitor} />}
          {d.conversation.phone && (
            <Button asChild size="sm" variant="outline" title="Ligar (pelo telefone; a ligação pelo WhatsApp é atendida no celular)" aria-label="Ligar">
              <a href={`tel:${d.conversation.phone}`}>
                <PhoneIcon /> <span className="hidden @4xl/head:inline">Ligar</span>
              </a>
            </Button>
          )}
          {d.lead && (
            <Button asChild size="sm" variant="outline" title="Abrir a ficha do lead" aria-label="Lead">
              <Link to={`/leads/${d.lead.id}`}>
                <UserIcon /> <span className="hidden @4xl/head:inline">Lead</span>
              </Link>
            </Button>
          )}
          <span className="hidden h-5 w-px bg-border @2xl/head:block" />
          {!monitor && d.attendance && <AttendantPicker thread={d} />}
          {!monitor && d.attendance && <HelpersPicker thread={d} />}
          {!monitor && d.conversation.category !== 'GRUPO' && d.conversation.phone && <SaveContactButton thread={d} />}
          {!monitor && can('chat', 'create') && d.conversation.category === 'CLIENTE' && d.conversation.status === 'ABERTA' && <FinishButton thread={d} />}
          {!monitor && <ConversationActions thread={d} />}
        </div>
      </div>
      {!monitor && <ReminderBar conversationId={d.conversation.id} />}
      <div className={cn('wa-wallpaper min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3 sm:px-[6%]')}>
        {(d.hasMore || older.length > 0) && (
          <div className="text-center">
            <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
              Mensagens anteriores
            </Button>
          </div>
        )}
        {messages.map((m, i) => {
          const showDay = i === 0 || dayKey(messages[i - 1]!.sentAt) !== dayKey(m.sentAt)
          // Primeiro balão de uma sequência do mesmo lado: ganha o "rabinho" e um respiro maior antes.
          const prev = messages[i - 1]
          const first = showDay || !prev || prev.fromMe !== m.fromMe || !!prev.internal
          return (
            <div key={m.id} id={`msg-${m.id}`} className={cn('scroll-mt-16', first && i > 0 && 'pt-2')}>
              {showDay && (
                <p className="mx-auto my-2 w-fit rounded-md bg-white px-3 py-1 text-xs font-medium text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:bg-[#182229] dark:text-[#8696a0]">{dayLabel(m.sentAt)}</p>
              )}
              {m.internal ? (
                <div className="mx-auto my-1 max-w-[90%] rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:max-w-[75%] dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                  <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold tracking-wide uppercase">
                    <LockIcon className="size-3" /> Nota interna · o cliente não vê
                  </p>
                  <p className="break-words whitespace-pre-wrap">{waFormat(m.text ?? '')}</p>
                  <p className="mt-0.5 text-right text-xs tabular-nums opacity-70">
                    {m.sentByName ? `${m.sentByName} · ` : ''}
                    {time(m.sentAt)}
                  </p>
                </div>
              ) : (
              <div
                className={cn('group/msg flex items-center gap-1', m.fromMe ? 'justify-end' : 'justify-start', selecting && canForward(m) && 'cursor-pointer rounded-md', selecting?.includes(m.id) && 'bg-[color:var(--brand)]/10')}
                onClick={selecting && canForward(m) ? () => toggleSelect(m.id) : undefined}
              >
                {selecting && canForward(m) && (
                  <input type="checkbox" className="mr-1 size-4 shrink-0 accent-[color:var(--brand)]" checked={selecting.includes(m.id)} onChange={() => toggleSelect(m.id)} onClick={(e) => e.stopPropagation()} aria-label="Selecionar mensagem para encaminhar" />
                )}
                {!selecting && m.fromMe && canAct(m) && <MessageActions m={m} canForward={canForward(m)} onReply={() => setReplyTo(m)} onForward={() => setSelecting([m.id])} />}
                <div
                  className={cn(
                    'relative max-w-[85%] rounded-lg px-2.5 py-1.5 text-[14.2px] leading-[19px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] sm:max-w-[65%]',
                    m.fromMe ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]' : 'bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]',
                    first && (m.fromMe ? 'wa-tail-out rounded-tr-none' : 'wa-tail-in rounded-tl-none'),
                  )}
                >
                  {d.conversation.category === 'GRUPO' && !m.fromMe && m.sentByName && <p className="mb-0.5 text-xs font-semibold text-[color:var(--brand)]">{m.sentByName}</p>}
                  {m.quotedText && <QuotedBlock text={m.quotedText} who={m.quotedFromMe === true ? 'Você' : m.quotedFromMe === false ? title : null} targetId={m.quotedId ?? null} />}
                  <Bubble m={m} />
                  {!m.fromMe && m.type === 'texto' && canAct(m) && <MenuButtons m={m} conversationId={d.conversation.id} category={d.conversation.category} />}
                  {!!m.reactions?.length && <Reactions list={m.reactions} />}
                  <p className={cn('mt-0.5 text-right text-xs tabular-nums', m.fromMe ? 'opacity-70' : 'text-muted-foreground')}>
                    {m.fromMe && (m.sentByName ? `${m.sentByName} · ` : 'pelo celular · ')}
                    {m.editedAt && !m.deleted && <span title={`Corrigida em ${dateTime(m.editedAt)}`}>Editada · </span>}
                    {time(m.sentAt)}
                    {m.fromMe && <Receipt status={m.status} />}
                  </p>
                </div>
                {!selecting && !m.fromMe && canAct(m) && <MessageActions m={m} canForward={canForward(m)} onReply={() => setReplyTo(m)} onForward={() => setSelecting([m.id])} />}
              </div>
              )}
            </div>
          )
        })}
        <div ref={end} />
      </div>
      {colors && !monitor && d.conversation.category === 'CLIENTE' && d.conversation.status !== 'ARQUIVADA' && !d.conversation.noReplyNeeded && <WaitingBar id={d.conversation.id} since={d.conversation.lastInboundAt ?? null} answered={!!messages.findLast((m) => !m.internal)?.fromMe} yellowMinutes={alerts?.waiting?.yellowMinutes} />}
      {monitor ? (
        <p className="flex items-center gap-2 border-t bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
          <EyeIcon className="size-4 shrink-0" /> Monitoramento: só leitura. O vendedor e o cliente não são avisados, e a conversa continua como não lida para quem atende.
        </p>
      ) : selecting ? (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-3 py-2" role="toolbar" aria-label="Encaminhar mensagens">
          <span className="mr-auto text-sm">
            <b>{selecting.length}</b> {selecting.length === 1 ? 'mensagem selecionada' : 'mensagens selecionadas'} · toque nas outras para juntar
          </span>
          <Button size="sm" variant="ghost" onClick={() => setSelecting(null)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => setForwarding(true)} disabled={!selecting.length}>
            <ForwardIcon /> Encaminhar
          </Button>
        </div>
      ) : (
        <Composer thread={d} replyTo={replyTo} onClearReply={() => setReplyTo(null)} dropped={dropped} onDroppedUsed={() => setDropped(null)} />
      )}
      {forwarding && selecting && (
        <ForwardDialog
          messageIds={selecting}
          sourceConversationId={d.conversation.id}
          preview={forwardPreview(messages.filter((x) => selecting.includes(x.id)))}
          onSent={() => setSelecting(null)}
          onClose={() => setForwarding(false)}
        />
      )}
    </div>
    </ThreadNumberContext.Provider>
    </MonitorContext.Provider>
  )
}

/**
 * Telas novas (Moderno): faixa laranja quando a última mensagem é do cliente e já passou do prazo amarelo.
 * "Não precisa responder" tira o aviso quando a conversa já terminou (ex.: áudio de despedida).
 */
function WaitingBar({ id, since, answered, yellowMinutes = 10 }: { id: string; since: string | null; answered: boolean; yellowMinutes?: number }) {
  const qc = useQueryClient()
  const dismiss = useMutation({
    mutationFn: () => api.post(`/chat/conversas/${id}/sem-resposta`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      void qc.invalidateQueries({ queryKey: ['chat-alertas'] })
      toast.success('Pronto: o tempo parou. Se o cliente escrever de novo, volta a contar.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!since) return null
  const min = Math.floor((Date.now() - Date.parse(since)) / 60_000)
  if (min < yellowMinutes || min > 7 * 1440) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300" role="status">
      <AlarmClockIcon className="size-3.5" /> {answered ? `Retorno prometido ao cliente: aguardando há ${waitText(min)}` : `Cliente esperando resposta há ${waitText(min)}`}
      <Button size="sm" variant="ghost" className="ml-auto h-7 text-orange-800 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-orange-500/20" disabled={dismiss.isPending} onClick={() => dismiss.mutate()} title={answered ? 'Já dei o retorno ao cliente: para de contar o tempo até ele escrever de novo' : 'Não há mais o que responder ao cliente: para de contar o tempo até ele escrever de novo'}>
        {dismiss.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {answered ? 'Já retornei' : 'Não precisa responder'}
      </Button>
    </div>
  )
}

/** Resumo do que vai ser encaminhado: o texto da mensagem, ou quantas são de cada tipo. */
function forwardPreview(list: Message[]) {
  const label = (m: Message) => ({ imagem: 'Foto', video: 'Vídeo', audio: 'Áudio', documento: m.fileName ?? 'Documento', figurinha: 'Figurinha', contato: 'Contato', localizacao: 'Localização' })[m.type as string] ?? 'Mensagem'
  if (list.length === 1) return `“${list[0]!.text || label(list[0]!)}”`
  const counts = new Map<string, number>()
  for (const m of list) {
    const k = m.type === 'texto' ? 'texto' : label(m).toLowerCase()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return `${list.length} mensagens, na ordem da conversa: ${[...counts.entries()].map(([k, n]) => `${n} ${k === 'texto' && n > 1 ? 'textos' : k}`).join(', ')}.`
}

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

/** Assinatura que o número coloca nas mensagens ("*Nome:*" na primeira linha): o servidor mantém ao corrigir. */
const SIGNATURE = /^\*[^*\n]{1,40}:\*\n/

/** Corrigir o texto de uma mensagem enviada (o WhatsApp mostra "Editada" para o cliente). */
function EditMessageDialog({ m, onClose }: { m: Message; onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState(() => (m.text ?? '').replace(SIGNATURE, ''))
  const [initial] = useState(text)
  const guard = useCloseGuard(isDirty(initial, text), onClose, 'a correção')
  const save = useMutation({
    mutationFn: () => api.patch(`/chat/mensagens/${m.id}`, { text: text.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa'] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      toast.success('Mensagem corrigida.')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corrigir mensagem</DialogTitle>
          <DialogDescription>O cliente vê a mensagem corrigida com a marca “Editada”. O WhatsApp só deixa corrigir até 15 minutos depois do envio.</DialogDescription>
        </DialogHeader>
        <Textarea rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Texto da mensagem" autoFocus />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void guard()}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !text.trim()}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Salvar correção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Ações ao lado da mensagem (aparecem ao passar o mouse; no celular ficam à vista, mais claras): responder, reagir, encaminhar, corrigir e apagar. */
function MessageActions({ m, canForward, onReply, onForward }: { m: Message; canForward: boolean; onReply: () => void; onForward: () => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [change, setChange] = useState<'editar' | null>(null)
  const [moreEmojis, setMoreEmojis] = useState(false)
  const confirm = useConfirm()
  const { can } = useAuth()
  const canSaveSticker = m.type === 'figurinha' && m.hasFile && !m.deleted && can('chat', 'create')
  const saveSticker = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/chat/mensagens/${m.id}/salvar-figurinha`),
    onSuccess: (r) => (toast.success(r.message), void qc.invalidateQueries({ queryKey: ['chat-figurinhas'] })),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const mine = m.reactions?.find((r) => r.by === 'me')?.emoji ?? ''
  const react = useMutation({
    mutationFn: (emoji: string) => api.post(`/chat/mensagens/${m.id}/reacao`, { emoji }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-conversa'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })
  // Apagar para todos: some do WhatsApp do cliente e no CRM fica "Mensagem apagada".
  const remove = useMutation({
    mutationFn: () => api.delete(`/chat/mensagens/${m.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa'] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      toast.success('Mensagem apagada para todos.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const askRemove = async () => {
    const ok = await confirm({
      title: 'Apagar a mensagem para todos?',
      description: (
        <>
          <span className="block">A mensagem some do WhatsApp do cliente e, aqui, fica “Mensagem apagada”. Não dá para desfazer. O WhatsApp só deixa apagar até 2 dias depois do envio.</span>
          {m.text && <span className="mt-2 line-clamp-4 block rounded-md border bg-muted/40 p-2 whitespace-pre-wrap text-foreground">{m.text}</span>}
        </>
      ),
      confirmLabel: 'Apagar para todos',
    })
    if (ok) remove.mutate()
  }
  const cls = 'size-7 shrink-0 opacity-50 group-hover/msg:opacity-100 focus-visible:opacity-100 md:opacity-0'
  return (
    <span className={cn('flex shrink-0 items-center', m.fromMe ? 'flex-row' : 'flex-row-reverse')}>
      {change === 'editar' && <EditMessageDialog m={m} onClose={() => setChange(null)} />}
      {(m.canEdit || m.canDelete || canSaveSticker) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className={cls} aria-label="Mais ações da mensagem">
              <EllipsisVerticalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={m.fromMe ? 'end' : 'start'}>
            {canSaveSticker && (
              <DropdownMenuItem disabled={saveSticker.isPending} onSelect={() => saveSticker.mutate()}>
                <StickerIcon /> Salvar figurinha
              </DropdownMenuItem>
            )}
            {m.canEdit && (
              <DropdownMenuItem onSelect={() => setChange('editar')}>
                <PencilIcon /> Corrigir mensagem
              </DropdownMenuItem>
            )}
            {m.canDelete && (
              <DropdownMenuItem variant="destructive" disabled={remove.isPending} onSelect={() => void askRemove()}>
                <Trash2Icon /> Apagar para todos
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canForward && (
        <Button type="button" size="icon" variant="ghost" className={cls} onClick={onForward} aria-label="Encaminhar mensagem">
          <ForwardIcon className="size-4" />
        </Button>
      )}
      <Popover open={open} onOpenChange={(v) => (setOpen(v), v || setMoreEmojis(false))}>
        <PopoverTrigger asChild>
          <Button type="button" size="icon" variant="ghost" className={cn(cls, open && 'opacity-100')} aria-label="Reagir à mensagem">
            <SmilePlusIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" className={cn('p-1.5', moreEmojis ? 'w-80' : 'flex w-auto gap-1')}>
          {moreEmojis ? (
            <EmojiGrid
              onPick={(e) => {
                setOpen(false)
                setMoreEmojis(false)
                react.mutate(mine === e ? '' : e)
              }}
            />
          ) : (
            <>
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={cn('rounded-full px-1.5 py-0.5 text-xl transition-transform hover:scale-125', mine === e && 'bg-[color:var(--brand)]/15')}
                  onClick={() => {
                    setOpen(false)
                    react.mutate(mine === e ? '' : e)
                  }}
                  aria-label={mine === e ? `Tirar a reação ${e}` : `Reagir com ${e}`}
                >
                  {e}
                </button>
              ))}
              <button type="button" className="rounded-full px-1.5 py-0.5 text-muted-foreground hover:bg-muted" onClick={() => setMoreEmojis(true)} aria-label="Mais emojis" title="Mais emojis">
                <SmilePlusIcon className="size-5" />
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>
      <Button type="button" size="icon" variant="ghost" className={cls} onClick={onReply} aria-label="Responder mensagem">
        <ReplyIcon className="size-4" />
      </Button>
    </span>
  )
}

/** Mensagem citada (resposta) no topo do balão. */
function QuotedBlock({ text, who, targetId = null }: { text: string; who: string | null; targetId?: string | null }) {
  const body = (
    <>
      <p className="flex items-center gap-1 font-semibold text-[color:var(--brand)]">
        <ReplyIcon className="size-3" /> {who ? `Em resposta a ${who === 'Você' ? 'você' : who}` : 'Resposta a uma mensagem'}
      </p>
      <p className="line-clamp-3 opacity-80">{waStyles(text)}</p>
    </>
  )
  const box = 'mb-1 block w-full rounded border-l-4 border-l-[color:var(--brand)] bg-black/5 px-2 py-1 text-left text-xs dark:bg-white/10'
  // Clicar vai até a mensagem respondida e pisca o balão; se ela é mais antiga que as carregadas, avisa.
  const go = (e: React.MouseEvent) => {
    e.stopPropagation()
    const el = targetId ? document.getElementById(`msg-${targetId}`) : null
    if (!el) {
      toast.info('A mensagem respondida é mais antiga: clique em "Mensagens anteriores", no alto da conversa, para carregar.')
      return
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.animate([{ backgroundColor: 'rgba(37, 211, 102, 0.28)' }, { backgroundColor: 'transparent' }], { duration: 1800, easing: 'ease-out' })
  }
  return targetId ? (
    <button type="button" className={cn(box, 'cursor-pointer hover:bg-black/10 dark:hover:bg-white/15')} onClick={go} title="Ir para a mensagem respondida">
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  )
}

/**
 * Menu de robô recebido ("1 Marketing / 2 Conversas..."): as opções viram botões. Clicar responde à mensagem do menu
 * com o nome da opção, que é o que o robô recebe quando a pessoa toca no botão no celular (responder só "1" ele recusa).
 */
function MenuButtons({ m, conversationId, category }: { m: Message; conversationId: string; category: string }) {
  const qc = useQueryClient()
  const options = useMemo(() => menuFor(m.text, category), [m.text, category])
  const send = useMutation({
    mutationFn: (label: string) => api.post(`/chat/conversas/${conversationId}/mensagens`, { text: label, quotedId: m.id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa', conversationId] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!options.length) return null
  return (
    <div className="mt-1.5 -mx-1 flex flex-col gap-1 border-t border-black/10 pt-1.5 dark:border-white/10">
      {options.map((o) => (
        <button
          key={o.n}
          type="button"
          disabled={send.isPending}
          onClick={(e) => {
            e.stopPropagation()
            send.mutate(o.label)
          }}
          className="rounded px-2 py-1 text-center text-sm font-medium text-[#027eb5] hover:bg-black/5 disabled:opacity-50 dark:text-[#53bdeb] dark:hover:bg-white/10"
          title={`Responder ao menu com "${o.label}"`}
        >
          {send.isPending && send.variables === o.label ? <Loader2Icon className="mr-1 inline size-3.5 animate-spin" /> : null}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Reações embaixo do balão, agrupadas por emoji, com quem reagiu no título. */
function Reactions({ list }: { list: { emoji: string; by: 'me' | 'them'; name: string | null }[] }) {
  const groups = new Map<string, string[]>()
  for (const r of list) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r.by === 'me' ? (r.name ? `${r.name} (empresa)` : 'Empresa') : r.name || 'Contato'])
  return (
    <div className="-mb-1 mt-0.5 flex flex-wrap gap-1">
      {[...groups.entries()].map(([emoji, who]) => (
        <span key={emoji} className="rounded-full border bg-background px-1.5 text-sm leading-6" title={who.join(', ')}>
          {emoji}
          {who.length > 1 && <span className="ml-0.5 text-xs text-muted-foreground tabular-nums">{who.length}</span>}
        </span>
      ))}
    </div>
  )
}


/**
 * Quem atende a conversa: assumir da fila (atendimento dividido) e transferir para outro atendente ou para a fila de
 * um setor. Só aparecem os atendentes do mesmo número de WhatsApp.
 */
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
      {free && a.split && thread.conversation.category === 'CLIENTE' && can('chat', 'create') && (
        <Button size="sm" onClick={() => save.mutate({ userId: me?.id ?? null })} disabled={save.isPending}>
          <HandIcon /> Assumir
        </Button>
      )}
      {canMove ? (
        <Select
          value={value}
          onValueChange={(v) => save.mutate(v === 'fila' ? { userId: null, sectorId: null } : v.startsWith('s:') ? { userId: null, sectorId: v.slice(2) } : { userId: v.slice(2) })}
        >
          <SelectTrigger size="sm" className="w-auto max-w-48" aria-label="Transferir a conversa" title="Transferir para outro atendente ou setor deste número">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fila">{a.split ? 'Na fila (todos)' : 'Sem atendente'}</SelectItem>
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

/**
 * Participantes: outros atendentes do mesmo número que também veem e respondem a conversa. O cliente continua
 * de quem atende; quem atende (ou quem pode editar o chat) escolhe.
 */
function HelpersPicker({ thread }: { thread: Thread }) {
  const qc = useQueryClient()
  const { me, can } = useAuth()
  const id = thread.conversation.id
  const current = thread.conversation.helpers ?? []
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const mine = thread.conversation.assignedUserId === me?.id
  const allowed = mine || !thread.conversation.assignedUserId || can('chat', 'edit')
  const options = (thread.attendance?.attendants ?? []).filter((a) => a.id !== thread.conversation.assignedUserId)
  const save = useMutation({
    mutationFn: (userIds: string[]) => api.post(`/chat/conversas/${id}/participantes`, { userIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      setOpen(false)
      toast.success('Participantes atualizados.')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!allowed && !current.length) return null
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setPicked(current.map((h) => h.id))
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" title={current.length ? `Participantes: ${current.map((h) => h.name).join(', ')}` : 'Adicionar outro atendente deste número na conversa'} aria-label="Participantes">
          <UsersIcon /> <span className="hidden @4xl/head:inline">{current.length ? `+${current.length}` : 'Participantes'}</span>
          {current.length > 0 && <span className="@4xl/head:hidden">+{current.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2">
        <p className="text-sm font-medium">Participantes da conversa</p>
        <p className="text-xs text-muted-foreground">Atendentes deste número que também veem e respondem. O cliente continua com {thread.conversation.assignedUserName ?? 'quem atende'}.</p>
        {options.length === 0 && <p className="text-sm text-muted-foreground">Não há outros atendentes neste número. Quem atende em outro número não entra nesta conversa.</p>}
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {options.map((a) => (
            <li key={a.id}>
              <label className={cn('flex items-center gap-2 rounded px-1.5 py-1 text-sm', allowed ? 'cursor-pointer hover:bg-muted' : 'opacity-70')}>
                <input
                  type="checkbox"
                  className="size-4 accent-[color:var(--brand)]"
                  checked={picked.includes(a.id)}
                  disabled={!allowed}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))}
                />
                {a.id === me?.id ? `${a.name} (você)` : a.name}
              </label>
            </li>
          ))}
        </ul>
        {allowed && (
          <Button size="sm" className="w-full" onClick={() => save.mutate(picked)} disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar participantes
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Salvar o número da conversa como contato na agenda do número (nome e tipo). Já na agenda: edita. */
function SaveContactButton({ thread }: { thread: Thread }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const id = thread.conversation.id
  const saved = thread.agenda
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<ContactCategory>('CLIENTE')
  const save = useMutation({
    mutationFn: () => api.post(`/chat/conversas/${id}/salvar-contato`, { name: name.trim(), category }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      setOpen(false)
      toast.success(`Contato salvo na agenda do número ${thread.number?.name ?? ''}.`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setName(saved?.name ?? thread.lead?.name ?? thread.conversation.name ?? '')
          setCategory(((saved?.category ?? thread.conversation.category) as ContactCategory) || 'CLIENTE')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" title={saved && !saved.general ? `Na agenda: ${saved.name ?? 'sem nome'}` : 'Salvar este número como contato na agenda'} aria-label={saved && !saved.general ? 'Editar contato da agenda' : 'Salvar contato'}>
          <BookUserIcon /> <span className="hidden @4xl/head:inline">{saved && !saved.general ? 'Na agenda' : 'Salvar contato'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="space-y-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (name.trim()) save.mutate()
          }}
        >
          <p className="text-sm font-medium">{saved && !saved.general ? 'Contato da agenda' : 'Salvar na agenda'}</p>
          <p className="text-xs text-muted-foreground">
            {formatPhone(thread.conversation.phone)} · agenda do número {thread.number?.name}. Telefone já salvo é atualizado, não duplica.
          </p>
          <div className="space-y-1">
            <Label htmlFor="sc-name" required>Nome</Label>
            <Input id="sc-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-cat">Tipo</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ContactCategory)} disabled={!can('chat', 'edit')}>
              <SelectTrigger id="sc-cat" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORY_LABEL) as ContactCategory[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!can('chat', 'edit') && <p className="text-xs text-muted-foreground">Mudar o tipo é com quem pode editar o chat.</p>}
          </div>
          <Button type="submit" size="sm" className="w-full" disabled={!name.trim() || save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />} Salvar
          </Button>
        </form>
      </PopoverContent>
    </Popover>
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
        <Button size="sm" variant="outline" title="Nota interna: só aparece no CRM" aria-label="Nota interna">
          <StickyNoteIcon /> <span className="hidden @4xl/head:inline">Nota interna</span>
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
/** Arquivos por envio no chat (cada um sai como uma mensagem). */
const MAX_FILES = 10

function Composer({ thread, replyTo, onClearReply, dropped, onDroppedUsed }: { thread: Thread; replyTo?: Message | null; onClearReply?: () => void; dropped?: File[] | null; onDroppedUsed?: () => void }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const file = files[0] ?? null
  const input = useRef<HTMLInputElement>(null)
  const id = thread.conversation.id
  // Prévia das fotos anexadas ou coladas (some ao trocar ou tirar o arquivo).
  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)), [files])
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews])
  /**
   * Arquivos escolhidos, colados (Ctrl+V) ou arrastados: entram como anexo (até MAX_FILES), com o texto digitado
   * virando a legenda do primeiro. Cada arquivo sai como uma mensagem, como no WhatsApp.
   */
  const attach = (list: File[] | null | undefined) => {
    if (!list?.length) return false
    const ok = list.filter((f) => f.size <= 64 * 1024 * 1024)
    if (ok.length < list.length) toast.error('Arquivo maior que 64 MB ficou de fora. Para arquivos maiores, envie um link (ex.: Google Drive).')
    // Imagem copiada da tela vem como "image.png": ganha um nome com a hora, para aparecer na conversa.
    const named = ok.map((f, i) =>
      f.type.startsWith('image/') && /^image\.\w+$/i.test(f.name) ? new File([f], `imagem-${new Date().toLocaleTimeString('pt-BR').replace(/:/g, '')}${i ? `-${i + 1}` : ''}.${f.type.split('/')[1] === 'jpeg' ? 'jpg' : f.type.split('/')[1]}`, { type: f.type }) : f,
    )
    setFiles((cur) => {
      const all = [...cur, ...named]
      if (all.length > MAX_FILES) toast.info(`Vão até ${MAX_FILES} arquivos por vez: os outros ficaram de fora.`)
      return all.slice(0, MAX_FILES)
    })
    setReplyFile(null)
    return true
  }
  // Arquivo solto em qualquer lugar da conversa (arrastado do computador): entra como anexo aqui.
  useEffect(() => {
    if (!dropped) return
    attach(dropped)
    onDroppedUsed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped])
  const voice = useVoiceRecorder(async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api.post(`/chat/conversas/${id}/audio`, fd)
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    } catch (err) {
      toast.error(`Áudio não enviado: ${errorMessage(err)}`, { duration: 10_000 })
    }
  })
  const replies = useQuery({ queryKey: ['chat-respostas', id], queryFn: () => api.get<{ id: string; title: string; preview: string; standard: boolean; fileName?: string | null }[]>(`/chat/respostas?conversa=${id}`), enabled: can('chat', 'create'), staleTime: 60_000 })
  const [managing, setManaging] = useState(false)
  /** Resposta rápida com arquivo escolhida: o arquivo já está no servidor; o texto da caixa vira a legenda. */
  const [replyFile, setReplyFile] = useState<{ id: string; fileName: string } | null>(null)
  const applyReply = (r: { id: string; preview: string; fileName?: string | null }, append = false) => {
    if (r.fileName) {
      setFiles([])
      setReplyFile({ id: r.id, fileName: r.fileName })
      setText(r.preview)
    } else setText((t) => (append && t ? `${t}\n${r.preview}` : r.preview))
    setPick(0)
  }
  const { novo } = useScreens()
  const [pick, setPick] = useState(0)
  const slash = novo && !file && !replyFile && text.startsWith('/') && !text.includes('\n') ? text.slice(1).trim().toLowerCase() : null
  const slashList = slash === null ? [] : (replies.data ?? []).filter((r) => !slash || r.title.toLowerCase().includes(slash) || r.preview.toLowerCase().includes(slash)).slice(0, 8)
  /** Um arquivo por vez, na ordem; a legenda vai no primeiro. Falhando no meio, os que não foram continuam anexados. */
  const sendFiles = async () => {
    for (let i = 0; i < files.length; i++) {
      const fd = new FormData()
      fd.append('file', files[i]!)
      if (i === 0 && text.trim()) fd.append('legenda', text.trim())
      try {
        await api.post(`/chat/conversas/${id}/arquivos`, fd)
      } catch (err) {
        if (i > 0) {
          setText('')
          setFiles(files.slice(i))
          void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
          throw new Error(`${i} de ${files.length} arquivos enviados. Os que faltam continuam anexados: ${errorMessage(err)}`)
        }
        throw err
      }
    }
  }
  const send = useMutation({
    mutationFn: () => {
      if (replyFile) return api.post(`/chat/conversas/${id}/respostas/${replyFile.id}/enviar`, { legenda: text.trim() || undefined })
      if (files.length) return sendFiles()
      return api.post(`/chat/conversas/${id}/mensagens`, { text, ...(replyTo ? { quotedId: replyTo.id } : {}) })
    },
    onSuccess: () => {
      setText('')
      setFiles([])
      setReplyFile(null)
      onClearReply?.()
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const box = useRef<HTMLTextAreaElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  /** Emoji entra onde está o cursor (ou no fim), e o cursor fica depois dele. */
  const insertEmoji = (emoji: string) => {
    const el = box.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    setText((t) => t.slice(0, start) + emoji + t.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }
  const sticker = useMutation({
    mutationFn: (stickerId: string) => api.post(`/chat/conversas/${id}/figurinhas/${stickerId}`),
    onSuccess: () => {
      setEmojiOpen(false)
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!can('chat', 'create')) return <p className="border-t px-3 py-2 text-xs text-muted-foreground">Seu perfil só permite ler as conversas.</p>
  if (thread.number?.status !== 'CONECTADO') {
    return <p className="border-t px-3 py-2 text-xs text-muted-foreground">O número {thread.number?.name} está desconectado: conecte de novo em Configurações → Números de WhatsApp para responder por aqui.</p>
  }
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (send.isPending || (!text.trim() && !file && !replyFile)) return
    send.mutate()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashList.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : slashList.length - 1)) % slashList.length)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault()
        applyReply(slashList[Math.min(pick, slashList.length - 1)]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setText('')
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <>
    <form
      onSubmit={submit}
      className={cn('relative space-y-2 border-t bg-[#f0f2f5] p-2 dark:bg-[#202c33]')}
    >
      {replyTo && (
        <div className="flex items-start gap-2 rounded-md border-l-4 border-l-[color:var(--brand)] bg-muted/60 px-2.5 py-1.5 text-xs">
          <ReplyIcon className="mt-0.5 size-3.5 shrink-0 text-[color:var(--brand)]" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Respondendo {replyTo.fromMe ? 'a você' : thread.conversation.category === 'GRUPO' && replyTo.sentByName ? `a ${replyTo.sentByName}` : 'ao cliente'}</span>
            <span className="line-clamp-2 text-muted-foreground">{replyTo.text || ({ imagem: 'Foto', video: 'Vídeo', audio: 'Áudio', documento: replyTo.fileName ?? 'Documento', figurinha: 'Figurinha' } as Record<string, string>)[replyTo.type] || 'Mensagem'}</span>
            {file && <span className="block text-amber-700 dark:text-amber-400">Com arquivo, a resposta vai sem a citação.</span>}
          </span>
          <button type="button" className="rounded p-0.5 hover:bg-background" onClick={onClearReply} aria-label="Cancelar resposta">
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      {slash !== null && (
        <div className="absolute bottom-full left-2 z-10 mb-1 w-[min(28rem,calc(100%-1rem))] rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg" role="listbox" aria-label="Respostas rápidas">
          <p className="px-2 py-1 text-xs text-muted-foreground">Respostas rápidas · digite para filtrar, ↑↓ escolhe, Enter usa</p>
          {slashList.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma resposta com esse nome.</p>}
          {slashList.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === Math.min(pick, slashList.length - 1)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyReply(r)}
              className={cn('flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm', i === Math.min(pick, slashList.length - 1) ? 'bg-accent' : 'hover:bg-muted')}
            >
              <span className="flex items-center gap-1 font-medium">
                {r.fileName && <PaperclipIcon className="size-3.5" aria-label="Com arquivo" />}
                {r.title}
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">{r.fileName ? `${r.fileName} · ` : ''}{r.preview}</span>
            </button>
          ))}
        </div>
      )}
      {replyFile && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs">
          <PaperclipIcon className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{replyFile.fileName}</span>
          <span className="text-muted-foreground">resposta rápida</span>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => (setReplyFile(null), setText(''))} aria-label="Remover a resposta rápida com arquivo">
            Remover
          </Button>
        </div>
      )}
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs">
          {previews[i] ? <img src={previews[i]!} alt="Prévia da imagem" className="size-12 rounded object-cover" /> : <PaperclipIcon className="size-3.5" />}
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="text-muted-foreground tabular-nums">{(f.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</span>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remover o anexo ${f.name}`}>
            Remover
          </Button>
        </div>
      ))}
      <div className="flex items-end gap-1.5">
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          accept="image/jpeg,image/png,image/webp,video/mp4,audio/ogg,audio/mpeg,audio/mp4,.m4a,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])]
            e.target.value = ''
            attach(list)
          }}
        />
        <Button type="button" size="icon" variant="ghost" onClick={() => input.current?.click()} aria-label="Anexar foto, vídeo, áudio ou documento">
          <PaperclipIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" aria-label="Respostas rápidas">
              <ZapIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>Respostas rápidas</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(replies.data ?? []).length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma ainda. Crie as suas em “Gerenciar respostas”.</p>}
            {replies.data?.map((r) => (
              <DropdownMenuItem key={r.id} onSelect={() => applyReply(r, true)} className="flex-col items-start gap-0.5">
                <span className="flex items-center gap-1 font-medium">
                  {r.fileName && <PaperclipIcon className="size-3.5" aria-label="Com arquivo" />}
                  {r.title}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{r.preview}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setManaging(true)}>Gerenciar respostas</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button type="button" size="icon" variant="ghost" aria-label="Emojis e figurinhas">
              <SmileIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-80 p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
            <EmojiStickerPanel onEmoji={insertEmoji} onSticker={(sid) => sticker.mutate(sid)} sending={sticker.isPending} />
          </PopoverContent>
        </Popover>
        <ShareContactButton conversationId={id} disabled={!!file} />
        <Textarea
          ref={box}
          value={text}
          onChange={(e) => (setText(e.target.value), setPick(0))}
          onKeyDown={onKey}
          onPaste={(e) => {
            // Imagem copiada (print, foto do site, do Explorer): vira anexo; texto colado segue normal.
            if (attach([...e.clipboardData.files])) e.preventDefault()
          }}
          rows={1}
          maxLength={file || replyFile ? 1000 : 4000}
          placeholder={file || replyFile ? 'Legenda (opcional) · Enter envia' : novo ? 'Escreva a mensagem (Enter envia, / abre as respostas rápidas)' : 'Escreva a mensagem (Enter envia, Shift+Enter pula linha)'}
          className={cn('max-h-40 min-h-9 flex-1 resize-none rounded-lg border-transparent bg-white shadow-none dark:bg-[#2a3942]')}
          aria-label="Mensagem"
        />
        {voice.recording ? (
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1.5 text-sm tabular-nums text-destructive" aria-live="polite">
              <span className="size-2 animate-pulse rounded-full bg-destructive" /> {voice.elapsed}
            </span>
            <Button type="button" size="icon" variant="ghost" onClick={voice.cancel} aria-label="Descartar áudio">
              <Trash2Icon />
            </Button>
            <Button type="button" size="icon" onClick={voice.stop} aria-label="Enviar áudio">
              <SendIcon />
            </Button>
          </div>
        ) : !text.trim() && !file ? (
          <Button type="button" size="icon" onClick={() => void voice.start()} disabled={voice.sending} aria-label="Gravar mensagem de voz">
            {voice.sending ? <Loader2Icon className="animate-spin" /> : <MicIcon />}
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={send.isPending} aria-label="Enviar mensagem">
            {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          </Button>
        )}
      </div>
    </form>
    {managing && <ManageRepliesDialog onClose={() => setManaging(false)} />}
    </>
  )
}

/**
 * Finalizar atendimento: manda (se quiser) a mensagem de encerramento, tira a conversa do atendente e da fila e
 * arquiva. Se o cliente chamar de novo, começa outro atendimento (fila ou robô).
 */
function FinishButton({ thread }: { thread: Thread }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [send, setSend] = useState(true)
  const id = thread.conversation.id
  const finish = useMutation({
    mutationFn: () => api.post(`/chat/conversas/${id}/finalizar`, { enviarMensagem: !!thread.closeText && send }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-conversa', id] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      toast.success('Atendimento finalizado. Se o cliente chamar de novo, começa um atendimento novo.')
      setOpen(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} title="Finalizar o atendimento desta conversa">
        <CircleCheckBigIcon /> <span className="hidden @4xl/head:inline">Finalizar</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar atendimento</DialogTitle>
            <DialogDescription>A conversa sai de quem atende e da fila e vai para as arquivadas. Se o cliente chamar de novo, começa um atendimento novo.</DialogDescription>
          </DialogHeader>
          {thread.closeText ? (
            <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <Switch checked={send} onCheckedChange={setSend} className="mt-0.5" aria-label="Enviar a mensagem de encerramento" />
              <span>
                Enviar a mensagem de encerramento
                <span className="mt-1 block text-xs whitespace-pre-wrap text-muted-foreground">“{thread.closeText}”</span>
              </span>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">A mensagem de encerramento está desligada (Configurações › Regras e horário).</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => finish.mutate()} disabled={finish.isPending}>
              {finish.isPending && <Loader2Icon className="animate-spin" />}
              Finalizar atendimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
      {thread.conversation.category !== 'GRUPO' && <CategoryPicker thread={thread} />}
      <Select value={thread.conversation.assignedSellerId ?? ALL} onValueChange={(v) => save.mutate({ assignedSellerId: v === ALL ? null : v })}>
        <SelectTrigger size="sm" className="w-auto max-w-48" aria-label="Responsável pela conversa">
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
      <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: archived ? 'ABERTA' : 'ARQUIVADA' })} title={archived ? 'Reabrir a conversa' : 'Arquivar a conversa'} aria-label={archived ? 'Reabrir' : 'Arquivar'}>
        {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />} <span className="hidden @4xl/head:inline">{archived ? 'Reabrir' : 'Arquivar'}</span>
      </Button>
    </>
  )
}

/** Começar conversa com um telefone (o lead, se existir, é ligado pela conversa). */
export function StartDialog({ onClose, onStarted, leadId, phone: initialPhone, external, numberId: initialNumber, name: initialName, sameNumber = false }: { onClose: () => void; onStarted: (id: string) => void; leadId?: string | null; phone?: string | null; external?: string | null; numberId?: string | null; name?: string | null; sameNumber?: boolean }) {
  // Do lead/atendimento (telefone já conhecido) com um número só conectado: abre direto, sem perguntar.
  const autoStart = !!initialPhone
  const numbers = useQuery({ queryKey: ['chat-numeros-envio'], queryFn: () => api.get<NumberRef[]>('/chat/numeros') })
  const connected = (numbers.data ?? []).filter((n) => n.status === 'CONECTADO')
  const [numberId, setNumberId] = useState<string | null>(null)
  const [phone, setPhone] = useState(initialPhone ? (initialPhone.startsWith('+55') ? formatPhone(initialPhone) : initialPhone) : '')
  const [error, setError] = useState<string | null>(null)
  const [initialTyped] = useState(phone)
  // Agenda: o número da agenda do contato vem escolhido (se estiver conectado).
  const chosen = numberId ?? (initialNumber && connected.some((n) => n.id === initialNumber) ? initialNumber : null) ?? connected[0]?.id ?? null
  // Busca pelo nome: na agenda do número escolhido (e na geral), nos vendedores e nos leads.
  const [query, setQuery] = useState('')
  const [pickedName, setPickedName] = useState<string | null>(initialName ?? null)
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])
  const found = useQuery({
    queryKey: ['chat-nova-conversa-busca', chosen, q],
    queryFn: () => api.get<{ key: string; name: string; phone: string; source: string }[]>(`/chat/contatos-para-compartilhar?busca=${encodeURIComponent(q)}${chosen ? `&numero=${chosen}` : ''}`),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  })
  const typing = (v: string) => {
    setPickedName(null)
    // Com letras é busca pelo nome; só números (e símbolos de telefone) é o WhatsApp digitado.
    if (/[a-zA-ZÀ-ÿ]/.test(v)) {
      setQuery(v)
      setPhone('')
    } else {
      setQuery('')
      setPhone(v.trim().startsWith('+') ? v : maskPhone(v))
    }
  }
  const pick = (o: { name: string; phone: string }) => {
    setPickedName(o.name)
    setQuery('')
    setPhone(o.phone.startsWith('+55') ? formatPhone(o.phone) : o.phone)
  }
  const start = useMutation({
    mutationFn: () => api.post<{ id: string }>('/chat/conversas', { numberId: chosen, phone: phone || undefined, leadId: leadId ?? undefined }),
    // Conversa nova: o servidor confere no WhatsApp se o telefone tem conta (leva alguns segundos).
    onMutate: () => toast.loading('Conferindo o número no WhatsApp…', { id: 'chat-start' }),
    onSettled: () => toast.dismiss('chat-start'),
    onSuccess: (r) => onStarted(r.id),
    onError: (err) => setError(errorMessage(err)),
  })
  // Nome ou telefone digitado: pergunta antes de fechar.
  const guard = useCloseGuard(!!query.trim() || isDirty(initialTyped, phone), onClose, 'o contato digitado')
  const tried = useRef(false)
  // Abre direto só com um número conectado e, vindo da agenda de um número, se for esse mesmo número.
  // Telefone clicado numa conversa (sameNumber): direto pelo número da conversa, se o usuário pode usá-lo.
  const direct = autoStart && (sameNumber && !!initialNumber && connected.some((n) => n.id === initialNumber) ? true : connected.length === 1 && (!initialNumber || connected[0]!.id === initialNumber))
  useEffect(() => {
    if (direct && !tried.current && chosen) {
      tried.current = true
      start.mutate()
    }
  }, [direct, chosen, start])
  if (direct && !error) return null
  return (
    <Dialog open onOpenChange={(o) => !o && void guard()}>
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
          ) : numbers.error ? (
            <InlineError error={numbers.error} onRetry={() => void numbers.refetch()} />
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
                <Label htmlFor="chat-start-phone" required>Nome ou WhatsApp do cliente</Label>
                <Input
                  id="chat-start-phone"
                  required={!query}
                  placeholder="Digite o nome (busca na agenda) ou (47) 99999-9999"
                  value={query || phone}
                  onChange={(e) => typing(e.target.value)}
                  autoFocus={!initialPhone}
                  autoComplete="off"
                />
                {pickedName && phone && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{pickedName}</span> · {phone}
                  </p>
                )}
                {query && (
                  <ul className="max-h-52 overflow-y-auto rounded-md border" aria-label="Contatos encontrados">
                    {q.length < 2 && <li className="p-2.5 text-sm text-muted-foreground">Digite pelo menos 2 letras.</li>}
                    {q.length >= 2 && found.isLoading && <li className="p-2.5 text-sm text-muted-foreground">Buscando…</li>}
                    {q.length >= 2 && found.data?.length === 0 && <li className="p-2.5 text-sm text-muted-foreground">Ninguém com esse nome na agenda deste número, nos vendedores ou nos leads. Digite o WhatsApp.</li>}
                    {found.data?.map((o) => (
                      <li key={o.key}>
                        <button type="button" onClick={() => pick(o)} className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{o.name}</span>
                            <span className="block text-xs text-muted-foreground">{o.phone.startsWith('+55') ? formatPhone(o.phone) : o.phone}</span>
                          </span>
                          <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">{o.source}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void guard()}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!chosen || start.isPending || (!phone && !leadId)}>
              Abrir conversa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) como elementos do React (nunca HTML vindo da mensagem). */
/** Texto da mensagem: links clicáveis (abrem em nova aba), a formatação do WhatsApp e telefones clicáveis no resto. */
function waFormat(text: string) {
  return splitLinks(text).map((part, i) =>
    part.href ? (
      <a key={`l${i}`} href={part.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100" title={`Abrir em nova aba: ${part.href}`}>
        {part.text}
      </a>
    ) : (
      <span key={`t${i}`}>{waStyles(part.text, phoneLinks)}</span>
    ),
  )
}

/**
 * Telefone escrito na mensagem ou no cartão de contato: clicar confere se tem WhatsApp e abre a conversa com ele pelo
 * mesmo número da conversa, sem precisar salvar o contato. No monitoramento (só leitura) é só o link de ligar.
 */
function PhoneLink({ phone, children, button = false }: { phone: string; children: ReactNode; button?: boolean }) {
  const monitor = useContext(MonitorContext)
  const numberId = useContext(ThreadNumberContext)
  const { can } = useAuth()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)
  const timer = useRef<number | null>(null)
  if (monitor || !can('chat', 'create')) {
    return button ? null : (
      <a href={`tel:${phone}`} className="underline underline-offset-2">
        {children}
      </a>
    )
  }
  // Não passa o clique para o balão (no modo de encaminhar, clicar no balão marca a mensagem).
  const start = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    if (timer.current) window.clearTimeout(timer.current)
    // Duplo/triplo clique é para selecionar e copiar o número; arrastar também. Só o clique simples abre a conversa.
    if ('detail' in e && e.detail > 1) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      if (!button && window.getSelection()?.toString()) return
      setStarting(true)
    }, button ? 0 : 250)
  }
  return (
    <>
      {button ? (
        <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={start} title={`Conversar no WhatsApp com ${formatPhone(phone)}`}>
          <MessageCircleIcon /> Conversar
        </Button>
      ) : (
        <span
          role="button"
          tabIndex={0}
          onClick={start}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), start(e))}
          className="cursor-pointer text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
          title="Conversar no WhatsApp com este número"
        >
          {children}
        </span>
      )}
      {starting && (
        // A janela é filha do balão no React: os cliques dentro dela não podem marcar a mensagem.
        <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <StartDialog
          phone={phone}
          numberId={numberId}
          sameNumber
          onClose={() => setStarting(false)}
          onStarted={(id) => {
            setStarting(false)
            navigate(`/chat?conversa=${id}`)
          }}
        />
        </span>
      )}
    </>
  )
}

/** Trecho de texto com os telefones clicáveis (dentro do negrito/itálico, se for o caso). */
function phoneLinks(text: string): ReactNode[] {
  return splitPhones(text).map((p, i) =>
    p.phone ? (
      <PhoneLink key={i} phone={p.phone}>
        {p.text}
      </PhoneLink>
    ) : (
      p.text
    ),
  )
}

/** *negrito*, _itálico_ e ~riscado~ do WhatsApp; leaf transforma cada pedaço de texto (ex.: telefones clicáveis). */
function waStyles(text: string, leaf: (t: string) => ReactNode[] = (t) => [t]) {
  const out: React.ReactElement[] = []
  const re = /([*_~])([^*_~\n]+?)\1/g
  let last = 0
  let k = 0
  const plain = (t: string) => out.push(<Fragment key={k++}>{leaf(t)}</Fragment>)
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) plain(text.slice(last, m.index))
    const inner = leaf(m[2]!)
    out.push(m[1] === '*' ? <strong key={k++}>{inner}</strong> : m[1] === '_' ? <em key={k++}>{inner}</em> : <s key={k++}>{inner}</s>)
    last = m.index + m[0].length
  }
  if (last < text.length) plain(text.slice(last))
  return out
}

/** Transcrição do áudio: o texto, se já existe; senão o botão "Transcrever" (Gemini, com a chave do e-mail marketing). */
function Transcript({ m }: { m: Message }) {
  const monitor = useContext(MonitorContext)
  const qc = useQueryClient()
  const [text, setText] = useState<string | null>(m.transcript ?? null)
  const run = useMutation({
    mutationFn: () => api.post<{ transcript: string }>(`/chat/mensagens/${m.id}/transcrever${monitor ? '?monitorar=true' : ''}`),
    onSuccess: (r) => {
      setText(r.transcript)
      void qc.invalidateQueries({ queryKey: ['chat-conversa'] })
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  })
  const shown = text ?? m.transcript
  if (shown) {
    return (
      <p className="max-w-80 border-l-2 border-current/30 pl-2 text-[13px] break-words whitespace-pre-wrap opacity-90">
        <span className="mb-0.5 block text-xs font-semibold tracking-wide uppercase">Transcrição</span>
        {shown}
      </p>
    )
  }
  return (
    <button type="button" onClick={() => run.mutate()} disabled={run.isPending} className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--brand)] hover:underline disabled:opacity-60">
      {run.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : <FileTextIcon className="size-3.5" />}
      {run.isPending ? 'Transcrevendo…' : 'Transcrever'}
    </button>
  )
}

/** Foto da conversa: abre grande por cima do chat (sem sair do CRM), com zoom e botão para baixar. */
function ImageViewer({ src, alt, sticker }: { src: string; alt: string; sticker?: boolean }) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(false)
  return (
    <>
      <button type="button" onClick={() => (setZoom(false), setOpen(true))} className="block cursor-zoom-in rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label="Ver a foto maior">
        <img src={src} alt={alt} className={cn('rounded', sticker ? 'size-32 object-contain' : 'max-h-72 w-auto')} loading="lazy" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[95vh] w-auto max-w-[95vw] flex-col gap-2 p-3 sm:max-w-[95vw]">
          <DialogHeader className="sr-only">
            <DialogTitle>Foto da conversa</DialogTitle>
            <DialogDescription>{alt}</DialogDescription>
          </DialogHeader>
          <div className={cn('min-h-0 flex-1 overflow-auto rounded bg-muted/40', zoom ? 'cursor-zoom-out' : 'cursor-zoom-in')} onClick={() => setZoom((z) => !z)}>
            <img src={src} alt={alt} className={cn('mx-auto', zoom ? 'max-w-none' : 'max-h-[80vh] max-w-full object-contain')} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{zoom ? 'Tamanho real: clique para ajustar à tela.' : 'Clique na foto para ver no tamanho real.'}</p>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={src} download>
                  <DownloadIcon /> Baixar
                </a>
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Bubble({ m }: { m: Message }) {
  const monitor = useContext(MonitorContext)
  if (m.deleted) {
    return (
      <p className="flex items-center gap-1.5 italic opacity-70">
        <BanIcon className="size-3.5" /> {m.fromMe ? 'Você apagou esta mensagem' : 'O contato apagou esta mensagem'}
      </p>
    )
  }
  const src = `/api/chat/midias/${m.id}${monitor ? '?monitorar=true' : ''}`
  const text = m.text && <p className="break-words whitespace-pre-wrap">{waFormat(m.text)}</p>
  const pending = m.mediaStatus === 'PENDENTE' && <p className="text-xs italic opacity-70">Baixando a mídia…</p>
  const missing = (m.mediaStatus === 'GRANDE' || m.mediaStatus === 'ERRO' || m.mediaStatus === 'APAGADA') && (
    <p className="text-xs italic opacity-70">{m.mediaStatus === 'GRANDE' ? 'Arquivo grande (mais de 64 MB): veja no celular.' : m.mediaStatus === 'APAGADA' ? 'Arquivo apagado pelo prazo de guarda (LGPD).' : 'Não foi possível baixar a mídia: veja no celular.'}</p>
  )
  if (m.type === 'imagem' || m.type === 'figurinha') {
    return (
      <div className="space-y-1">
        {m.hasFile ? (
          <ImageViewer src={src} alt={m.text ?? (m.type === 'figurinha' ? 'Figurinha' : 'Foto')} sticker={m.type === 'figurinha'} />
        ) : (
          pending || missing || <p className="text-xs italic opacity-70">Foto</p>
        )}
        {text}
      </div>
    )
  }
  if (m.type === 'audio') {
    return m.hasFile ? (
      <div className="space-y-1">
        <audio controls preload="none" src={src} className="max-w-full" />
        <Transcript m={m} />
      </div>
    ) : (
      pending || missing || <p className="text-xs italic">Áudio</p>
    )
  }
  if (m.type === 'video') return <div className="space-y-1">{m.hasFile ? <video controls preload="none" src={src} className="max-h-72 max-w-full rounded" /> : pending || missing}{text}</div>
  if (m.type === 'contato') return <ContactBubble text={m.text} chat={(phone) => <PhoneLink phone={phone} button>{phone}</PhoneLink>} />
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
        <SelectTrigger size="sm" className="w-auto max-w-48" aria-label="Tipo de contato">
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
                Marcar como {CATEGORY_LABEL[pending].toLowerCase()}
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
    } catch (err) {
      const name = (err as { name?: string })?.name
      return void toast.error(
        name === 'NotFoundError'
          ? 'Nenhum microfone encontrado neste computador. Ligue um microfone (ou fone com microfone) e tente de novo.'
          : name === 'NotReadableError'
            ? 'O microfone está sendo usado por outro programa (ex.: Teams, Meet, WhatsApp Desktop). Feche o outro programa e tente de novo.'
            : 'Sem acesso ao microfone. Clique no cadeado ao lado do endereço do site, permita o microfone e recarregue a página.',
        { duration: 10_000 },
      )
    }
    const type = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    chunks.current = []
    discard.current = false
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    r.onerror = () => {
      discard.current = true
      toast.error('A gravação parou com erro no navegador. Tente de novo; se repetir, confira o microfone escolhido nas configurações do navegador.')
      cleanup()
    }
    r.onstop = () => {
      const mime = r.mimeType || type || 'audio/webm'
      const blob = new Blob(chunks.current, { type: mime })
      cleanup()
      if (discard.current) return
      // Antes sumia sem aviso: gravação vazia (microfone mudo, microfone errado escolhido ou muito curta).
      if (blob.size < 1000) return void toast.error('O áudio ficou vazio: o microfone não captou som. Segure para gravar um pouco mais e confira se o microfone certo está escolhido no navegador.', { duration: 10_000 })
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

function ReminderButton({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [due, setDue] = useState(() => localInput(preset('amanha')))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Observação digitada e não salva: pergunta antes de fechar.
  const guard = useCloseGuard(!!note.trim(), () => setOpen(false), 'o lembrete')
  const save = useMutation({
    mutationFn: () => api.post(`/chat/conversas/${conversationId}/lembretes`, { dueAt: new Date(due).toISOString(), note: note || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat-lembretes', conversationId] })
      void qc.invalidateQueries({ queryKey: ['chat-conversas'] })
      void qc.invalidateQueries({ queryKey: ['chat-alertas'] })
      toast.success(`Lembrete para ${dateTime(due)}.`)
      setOpen(false)
      setNote('')
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} title="Lembrete de retorno" aria-label="Criar lembrete de retorno">
        <AlarmClockIcon /> <span className="hidden @4xl/head:inline">Lembrete</span>
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && void guard()}>
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
                <Label htmlFor="rem-due" required>Data e hora</Label>
                <Input id="rem-due" type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rem-note">Observação (opcional)</Label>
                <Input id="rem-note" autoFocus maxLength={500} placeholder="Ex.: confirmar se aprovou o orçamento" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => void guard()}>
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
  if (q.error && !q.data)
    return (
      <div className="border-b px-3 py-2">
        <InlineError error={q.error} onRetry={() => void q.refetch()} />
      </div>
    )
  if (!q.data?.length) return null
  return (
    <ul className="space-y-1 border-b bg-amber-500/5 px-3 py-2">
      {q.data.map((r) => {
        const late = new Date(r.dueAt) <= new Date()
        return (
          <li key={r.id} className="flex items-center gap-2 text-xs">
            <AlarmClockIcon className={cn('size-3.5 shrink-0', late ? 'text-amber-600' : 'text-muted-foreground')} />
            <span className={cn('tabular-nums', late && 'font-medium text-amber-800 dark:text-amber-300')}>{dateTime(r.dueAt)}</span>
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
