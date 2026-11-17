import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BellIcon, BellOffIcon, CheckCheckIcon, ExternalLinkIcon, LogOutIcon, MessageCircleIcon, MessageSquarePlusIcon, MoonIcon, MoreVerticalIcon, PanelRightOpenIcon, SearchIcon, SunIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { LabelChip } from '@/components/chat/organizar'
import { ClientPanel } from '@/components/chat/painel-cliente'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { formatPhone } from '@/lib/atendimento'
import { disablePush, enablePush, type PushState, pushState } from '@/lib/app-movel'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Avatar, type ListData, StartDialog, ThreadView } from '@/pages/chat-page'

/** Manifesto do app de Chat (ícone próprio no Chrome/Edge, abre em /chat-app). */
export const CHAT_APP_MANIFEST = '/api/app/manifest-chat.webmanifest'
/** Janela aberta como app de Chat: não vai para o app do celular nem mostra o menu do CRM. */
export const CHAT_APP_FLAG = 'crm-chat-app'

type Filter = 'tudo' | 'naoLidas' | 'grupos' | 'fila'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'tudo', label: 'Tudo' },
  { key: 'naoLidas', label: 'Não lidas' },
  { key: 'grupos', label: 'Grupos' },
  { key: 'fila', label: 'Fila' },
]
const NUMBER_KEY = 'chat-app-numero'
const PANEL_KEY = 'chat-app-painel'
const ALL = '__todos'

function store(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch {
    /* sem armazenamento: vale só nesta abertura */
  }
  return null
}

function when(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * App de Chat do computador (instalado pelo Chrome/Edge, janela própria): só as conversas, com a cara do WhatsApp Web.
 * Lista à esquerda (grupos junto com as conversas), conversa no meio e, à direita, o painel do pré e do pós-venda do
 * contato. Funciona em paralelo ao CRM, com as mesmas permissões.
 */
export function ChatAppPage() {
  const { me, logout, can } = useAuth()
  const b = useBranding()
  const [params, setParams] = useSearchParams()
  const openId = params.get('conversa')
  const [filter, setFilter] = useState<Filter>('tudo')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [starting, setStarting] = useState<false | { phone?: string; name?: string }>(false)
  const [numberId, setNumberId] = useState<string>(() => store(NUMBER_KEY) ?? ALL)
  const [panel, setPanel] = useState(() => store(PANEL_KEY) !== '0')

  // Ícone próprio na barra de tarefas e título da janela.
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_APP_FLAG, '1')
    } catch {
      /* sem armazenamento */
    }
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const before = link?.href
    if (link) link.href = CHAT_APP_MANIFEST
    return () => {
      if (link && before) link.href = before
    }
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const qs = new URLSearchParams({
    juntos: 'true',
    ...(filter === 'naoLidas' ? { naoLidas: 'true' } : {}),
    ...(filter === 'fila' ? { fila: 'true' } : {}),
    ...(filter === 'grupos' ? { tipo: 'GRUPO' } : {}),
    ...(q ? { busca: q } : {}),
    ...(numberId !== ALL ? { numero: numberId } : {}),
  }).toString()
  const list = useQuery({ queryKey: ['chat-app', qs], queryFn: () => api.get<ListData>(`/chat/conversas?${qs}`), refetchInterval: 5000, placeholderData: keepPreviousData })
  const numbers = list.data?.numbers ?? []
  // Pesquisa: também os contatos da agenda, vendedores e leads, para começar uma conversa nova (como no WhatsApp).
  const contacts = useQuery({
    queryKey: ['chat-app-contatos', q, numberId],
    queryFn: () => api.get<{ key: string; name: string; phone: string; source: string }[]>(`/chat/contatos-para-compartilhar?busca=${encodeURIComponent(q)}${numberId !== ALL ? `&numero=${numberId}` : ''}`),
    enabled: q.length >= 2 && can('chat', 'create'),
    staleTime: 30_000,
  })
  // Número salvo que não aparece mais para a pessoa: volta para Todos.
  useEffect(() => {
    if (numberId !== ALL && list.data && !list.isPlaceholderData && !list.data.numbers.some((n) => n.id === numberId)) setNumberId(ALL)
  }, [numberId, list.data, list.isPlaceholderData])
  const pickNumber = (id: string) => {
    setNumberId(id)
    store(NUMBER_KEY, id)
  }
  const unread = list.data?.unreadConversations
  useEffect(() => {
    document.title = unread ? `(${unread}) Chat · ${b.shortName || b.appName}` : `Chat · ${b.shortName || b.appName}`
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    void (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => undefined)
  }, [unread, b.shortName, b.appName])
  // Notificação clicada com o app aberto: abre a conversa aqui.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null
      const id = data?.type === 'abrir' && data.url ? new URL(data.url, location.origin).pathname.match(/conversa\/([0-9a-f-]{36})/)?.[1] : null
      if (id) open(id)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  })

  const open = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (id) n.set('conversa', id)
      else n.delete('conversa')
      return n
    })
  const togglePanel = () => {
    setPanel(!panel)
    store(PANEL_KEY, panel ? '0' : '1')
  }
  const hasQueue = numbers.some((n) => n.splitAttendance)
  const items = list.data?.items ?? []

  return (
    <div className="flex h-dvh overflow-hidden bg-[#eae6df] text-foreground dark:bg-[#0c1317]">
      {/* Lista de conversas */}
      <aside className={cn('flex h-full w-full min-w-0 shrink-0 flex-col border-r bg-background md:w-[30%] md:max-w-[28rem] md:min-w-[20rem]', openId && 'hidden md:flex')}>
        <header className="flex h-14 shrink-0 items-center gap-2 bg-[#f0f2f5] px-3 dark:bg-[#202c33]">
          <Avatar name={me?.name ?? null} className="size-9" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{me?.name}</span>
          {can('chat', 'create') && (
            <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setStarting({})} aria-label="Nova conversa" title="Nova conversa">
              <MessageSquarePlusIcon />
            </Button>
          )}
          <AppMenu onLogout={() => void logout()} />
        </header>
        <div className="space-y-2 border-b px-3 py-2">
          <label className="relative block">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar ou começar uma nova conversa" className="h-9 rounded-lg border-0 bg-[#f0f2f5] pl-9 dark:bg-[#202c33]" aria-label="Pesquisar conversas" />
          </label>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {FILTERS.filter((f) => f.key !== 'fila' || hasQueue).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn('shrink-0 rounded-full px-3 py-1 text-sm', filter === f.key ? 'bg-[#d9fdd3] font-medium text-[#008069] dark:bg-[#0a332c] dark:text-[#25d366]' : 'bg-[#f0f2f5] text-muted-foreground hover:bg-muted dark:bg-[#202c33]')}
              >
                {f.label}
                {f.key === 'naoLidas' && !!unread && ` ${unread}`}
              </button>
            ))}
          </div>
          {numbers.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Número de WhatsApp">
              {[{ id: ALL, name: 'Todos os números', status: 'CONECTADO', unread: 0 }, ...numbers].map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="tab"
                  aria-selected={n.id === numberId}
                  onClick={() => pickNumber(n.id)}
                  className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs', n.id === numberId ? 'border-[#008069] bg-[#008069] text-white' : 'text-muted-foreground hover:bg-muted')}
                >
                  {n.id !== ALL && <span className={cn('size-1.5 rounded-full', n.status === 'CONECTADO' ? 'bg-[#25d366]' : 'bg-muted-foreground/50', n.id === numberId && 'bg-white')} />}
                  {n.name}
                  {!!n.unread && n.id !== numberId && <span className="rounded-full bg-[#25d366] px-1.5 text-[10px] font-semibold text-white">{n.unread}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading && <li className="p-6 text-center text-sm text-muted-foreground">Carregando conversas…</li>}
          {list.error && <li className="p-6 text-center text-sm text-destructive">{errorMessage(list.error)}</li>}
          {list.data && items.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{q ? 'Nenhuma conversa encontrada.' : filter === 'naoLidas' ? 'Nenhuma conversa não lida.' : 'Nenhuma conversa por aqui.'}</li>}
          {items.map((c) => {
            const group = c.category === 'GRUPO'
            const name = c.name || (c.phone ? `+${c.phone.replace(/\D/g, '')}` : group ? 'Grupo' : 'Contato')
            const isUnread = c.unread > 0
            const sub = [c.assignedUserName ? `com ${c.assignedUserName}` : null, c.stage && !group ? (c.stage.kind === 'PRE_VENDAS' ? 'Pré-venda' : 'Pós-venda') : null, numbers.length > 1 ? numbers.find((n) => n.id === c.numberId)?.name : null].filter(Boolean).join(' · ')
            return (
              <li key={c.id}>
                <button type="button" onClick={() => open(c.id)} className={cn('flex w-full items-center gap-3 px-3 text-left hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]', c.id === openId && 'bg-[#f0f2f5] dark:bg-[#2a3942]')}>
                  <Avatar name={c.name} group={group} photoId={c.photoId} className="size-12 text-base" />
                  <span className="min-w-0 flex-1 border-b py-3">
                    <span className="flex items-baseline gap-2">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="min-w-0 truncate text-[15px]">{name}</span>
                        {(c.labels ?? []).slice(0, 2).map((l) => (
                          <LabelChip key={l.id} label={l} className="max-w-[7rem] shrink-0" />
                        ))}
                        {(c.labels ?? []).length > 2 && <span className="shrink-0 rounded bg-muted px-1 text-xs text-muted-foreground">+{c.labels!.length - 2}</span>}
                      </span>
                      <span className={cn('shrink-0 text-xs tabular-nums', isUnread ? 'font-medium text-[#25d366]' : 'text-muted-foreground')}>{when(c.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-muted-foreground">
                        {c.lastFromMe && <CheckCheckIcon className="size-4 shrink-0" />}
                        <span className="truncate">{c.lastPreview ?? ''}</span>
                      </span>
                      {isUnread && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25d366] px-1.5 text-xs font-semibold text-white">{c.unread > 99 ? '99+' : c.unread}</span>}
                    </span>
                    {sub && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sub}</span>}
                  </span>
                </button>
              </li>
            )
          })}
          {q.length >= 2 && !!contacts.data?.length && (
            <>
              <li className="px-4 pt-4 pb-2 text-sm font-medium text-[#008069] dark:text-[#25d366]">Contatos</li>
              {contacts.data.map((ct) => (
                <li key={ct.key}>
                  <button type="button" onClick={() => setStarting({ phone: ct.phone, name: ct.name })} className="flex w-full items-center gap-3 px-3 text-left hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]" title="Começar conversa">
                    <Avatar name={ct.name} className="size-12 text-base" />
                    <span className="min-w-0 flex-1 border-b py-3">
                      <span className="block truncate text-[15px]">{ct.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">{formatPhone(ct.phone) || ct.phone} · {ct.source}</span>
                    </span>
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      </aside>

      {/* Conversa aberta */}
      <main className={cn('relative min-w-0 flex-1', !openId && 'hidden md:block')}>
        {openId ? (
          <>
            <ThreadView key={openId} id={openId} onBack={() => open(null)} />
            {!panel && (
              <Button variant="secondary" size="icon" className="absolute top-2.5 right-3 z-10 hidden rounded-full shadow-sm lg:inline-flex" onClick={togglePanel} aria-label="Mostrar pré e pós-venda" title="Pré e pós-venda do contato">
                <PanelRightOpenIcon />
              </Button>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 border-b-[6px] border-[#25d366] bg-[#f0f2f5] p-6 text-center dark:bg-[#222e35]">
            <MessageCircleIcon className="size-16 text-muted-foreground/60" />
            <p className="text-2xl font-light">{b.shortName || b.appName} Chat</p>
            <p className="max-w-sm text-sm text-muted-foreground">Escolha uma conversa à esquerda. O pré e o pós-venda do contato abrem ao lado da conversa.</p>
          </div>
        )}
      </main>

      {/* Pré e pós-venda do contato */}
      {openId && panel && (
        <aside className="hidden h-full w-[22rem] shrink-0 flex-col border-l bg-background lg:flex">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-[#f0f2f5] px-4 dark:bg-[#202c33]">
            <span className="min-w-0 flex-1 truncate font-medium">Pré e pós-venda</span>
            <Button variant="ghost" size="icon" className="rounded-full" onClick={togglePanel} aria-label="Fechar pré e pós-venda">
              <XIcon />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ClientPanel id={openId} monitor={false} />
          </div>
        </aside>
      )}

      {starting && <StartDialog phone={starting.phone} name={starting.name} numberId={numberId !== ALL ? numberId : null} onClose={() => setStarting(false)} onStarted={(id) => (setStarting(false), setSearch(''), open(id))} />}
    </div>
  )
}

function AppMenu({ onLogout }: { onLogout: () => void }) {
  const { resolved, setTheme } = useTheme()
  const [push, setPush] = useState<PushState | null>(null)
  useEffect(() => {
    void pushState().then(setPush)
  }, [])
  const togglePush = async () => {
    try {
      if (push === 'ligado') await disablePush()
      else await enablePush()
      setPush(await pushState())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu">
          <MoreVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {push && push !== 'indisponivel' && (
          <DropdownMenuItem disabled={push === 'bloqueado'} onSelect={() => void togglePush()}>
            {push === 'ligado' ? <BellOffIcon /> : <BellIcon />}
            {push === 'ligado' ? 'Desligar notificações' : push === 'bloqueado' ? 'Notificações bloqueadas no navegador' : 'Ligar notificações'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setTheme(resolved === 'dark' ? 'LIGHT' : 'DARK')}>
          {resolved === 'dark' ? <SunIcon /> : <MoonIcon />} {resolved === 'dark' ? 'Tema claro' : 'Tema escuro'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.open('/?completo=1', '_blank')}>
          <ExternalLinkIcon /> Abrir o CRM completo
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOutIcon /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
