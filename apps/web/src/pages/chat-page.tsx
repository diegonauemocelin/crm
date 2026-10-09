import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, CheckIcon, FileIcon, HeadsetIcon, MapPinIcon, MegaphoneIcon, MessageCircleIcon, SearchIcon, SmartphoneIcon, UserIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { formatPhone } from '@/lib/atendimento'
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
}
interface Thread {
  conversation: { id: string; name: string | null; phone: string | null; jid: string }
  number: NumberRef | null
  lead: { id: string; name: string | null; email: string | null; phone: string | null } | null
  record: { id: string; kind: 'PRE_VENDAS' | 'POS_VENDAS'; leadAt: string; saleStatus: string; adsVia: string | null; adsCampaign: string | null; adsCampaignId: string | null; entryChannel: string | null } | null
  hasMore: boolean
  messages: Message[]
}

const ALL = '__all__'
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
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const qs = new URLSearchParams({ ...(numberId ? { numero: numberId } : {}), ...(unread ? { naoLidas: 'true' } : {}), ...(q ? { busca: q } : {}) }).toString()
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
      <PageHeader title="Chat WhatsApp" description="Conversas dos números da empresa. Por enquanto só leitura: responda pelo celular (o envio pelo CRM vem na próxima etapa)." />
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
              <div className="flex items-center gap-2">
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
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={unread} onCheckedChange={setUnread} aria-label="Só não lidas" /> Não lidas
                  {list.data.unreadConversations > 0 && <Badge className="h-5 px-1.5 tabular-nums">{list.data.unreadConversations}</Badge>}
                </label>
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.data.items.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa{q || unread || numberId ? ' com esses filtros' : ' ainda'}.</li>}
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
                      {list.data.numbers.length > 1 && <span className="block truncate text-[11px] text-muted-foreground">{numbers.get(c.numberId)?.name}</span>}
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

function ThreadView({ id, onBack }: { id: string; onBack: () => void }) {
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
        <Button size="icon" variant="ghost" className="size-8 md:hidden" onClick={onBack} aria-label="Voltar para a lista">
          <ArrowLeftIcon />
        </Button>
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
                  <p className={cn('mt-0.5 text-right text-[11px] tabular-nums', m.fromMe ? 'opacity-70' : 'text-muted-foreground')}>{time.format(new Date(m.sentAt))}</p>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">Para responder, use o WhatsApp do celular deste número. As respostas aparecem aqui.</p>
    </div>
  )
}

function Bubble({ m }: { m: Message }) {
  const src = `/api/chat/midias/${m.id}`
  const text = m.text && <p className="break-words whitespace-pre-wrap">{m.text}</p>
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
