import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ActivityIcon, BarChart3Icon, BellIcon, BellOffIcon, CheckCheckIcon, ChevronRightIcon, DownloadIcon, LayoutGridIcon, Loader2Icon, LogOutIcon, MailIcon, MessageCircleIcon, MessageSquarePlusIcon, PresentationIcon, SearchIcon, ShareIcon, SquarePlusIcon, UserIcon, XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { BrandMark } from '@/components/layout/brand-logo'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from '@/lib/api'
import { disablePush, enablePush, isAndroid, isInstalledApp, isIOS, type PushState, pushState, refreshPushOwner } from '@/lib/app-movel'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { dateShort, time } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar, type ListData, type NumberRef, StartDialog, ThreadView } from '@/pages/chat-page'

/**
 * App no celular: só o que a pessoa usa no dia a dia, com cara de WhatsApp. Conversas (lista e conversa em tela
 * cheia), os painéis que o perfil libera e a conta (notificações, tema e sair). As permissões são as mesmas do
 * computador: o app só mostra menos coisa.
 */

/** Painéis gerenciais que podem aparecer no app (cada um com a permissão que já vale no computador). */
export const APP_PANELS = [
  { key: 'vendas', title: 'Vendas em tempo real', description: 'O que entrou hoje, comparado com ontem', icon: ActivityIcon, module: 'relatorios' },
  { key: 'atendimento', title: 'Atendimento WhatsApp', description: 'Conversas, tempo de resposta e vendedores', icon: MessageCircleIcon, module: 'chat' },
  { key: 'executivo', title: 'Dashboard executivo', description: 'Faturamento, marketing e mapa de vendas', icon: PresentationIcon, module: 'mi_executivo' },
  { key: 'email', title: 'Resultados do e-mail', description: 'Aberturas, cliques e vendas dos e-mails', icon: MailIcon, module: 'email_marketing' },
] as const

function usePanels() {
  const { can } = useAuth()
  return APP_PANELS.filter((p) => can(p.module))
}

/** Moldura do app: conteúdo e a barra de baixo (some dentro de uma conversa, como no WhatsApp). */
export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const panels = usePanels()
  const inThread = location.pathname.startsWith('/app/conversa/')
  // Tocar na notificação com o app aberto: vai para a conversa.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null
      if (data?.type === 'abrir' && data.url) navigate(new URL(data.url).pathname)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])
  useEffect(() => {
    void refreshPushOwner()
  }, [])
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
      {!inThread && (
        <nav className="flex shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]" aria-label="Menu do app">
          <Tab to="/app" end icon={MessageCircleIcon} label="Conversas" />
          {panels.length > 0 && <Tab to="/app/paineis" icon={LayoutGridIcon} label="Painéis" />}
          <Tab to="/app/conta" icon={UserIcon} label="Conta" />
        </nav>
      )}
    </div>
  )
}

function Tab({ to, icon: Icon, label, end }: { to: string; icon: typeof UserIcon; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium', isActive ? 'text-[#008069] dark:text-[#25d366]' : 'text-muted-foreground')}>
      {({ isActive }) => (
        <>
          <span className={cn('flex h-7 w-14 items-center justify-center rounded-full', isActive && 'bg-[#d8fdd2] dark:bg-[#103529]')}>
            <Icon className="size-5" />
          </span>
          {label}
        </>
      )}
    </NavLink>
  )
}

function TopBar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 bg-background px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{title}</h1>
      </div>
      {children}
    </header>
  )
}

const FILTERS = [
  { key: 'todas', label: 'Tudo' },
  { key: 'naoLidas', label: 'Não lidas' },
  { key: 'fila', label: 'Fila' },
  { key: 'grupos', label: 'Grupos' },
] as const
type Filter = (typeof FILTERS)[number]['key']
/** Número de WhatsApp escolhido na lista de conversas do app (salvo no aparelho). */
const NUMBER_KEY = 'app-numero'

function when(iso: string | null) {
  if (!iso) return ''
  const d = dateShort(iso)
  if (d === dateShort(new Date())) return time(iso)
  if (d === dateShort(new Date(Date.now() - 86_400_000))) return 'Ontem'
  return d.slice(0, 5)
}

/** Lista de conversas, como a do WhatsApp: foto, nome, última mensagem, hora e o número de não lidas. */
export function AppConversas() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const b = useBranding()
  const [filter, setFilter] = useState<Filter>('todas')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [starting, setStarting] = useState(false)
  // Número escolhido (como abrir um WhatsApp só): fica salvo no aparelho. Sem escolha, o primeiro da lista.
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(NUMBER_KEY)
    } catch {
      return null
    }
  })
  const [numbers, setNumbers] = useState<NumberRef[] | null>(null)
  const numberId = numbers?.length ? (numbers.find((n) => n.id === picked) ?? numbers[0]!).id : null
  const pick = (id: string) => {
    setPicked(id)
    try {
      localStorage.setItem(NUMBER_KEY, id)
    } catch {
      /* sem armazenamento: vale só nesta abertura */
    }
  }
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const qs = new URLSearchParams({ ...(filter === 'naoLidas' ? { naoLidas: 'true' } : {}), ...(filter === 'fila' ? { fila: 'true' } : {}), ...(filter === 'grupos' ? { tipo: 'GRUPO' } : {}), ...(q ? { busca: q } : {}), ...(numberId ? { numero: numberId } : {}) }).toString()
  const list = useQuery({ queryKey: ['app-conversas', qs], queryFn: () => api.get<ListData>(`/chat/conversas?${qs}`), refetchInterval: 5000, placeholderData: keepPreviousData })
  // A lista de números vem junto com as conversas; até saber se há mais de um, não mostra conversas de todos misturadas.
  useEffect(() => {
    // Só os números em que a pessoa atende; quem não atende em nenhum (ex.: só acompanha) escolhe entre todos.
    if (list.data?.numbers && !numbers) setNumbers(list.data.numbers.some((n) => n.attends) ? list.data.numbers.filter((n) => n.attends) : list.data.numbers)
  }, [list.data?.numbers, numbers])
  const waitingNumber = !numbers || (!!numbers.length && !qs.includes('numero='))
  const items = waitingNumber ? [] : (list.data?.items ?? [])
  const hasQueue = !!list.data?.numbers.some((n) => n.splitAttendance)
  return (
    <div className="relative min-h-full">
      <TopBar
        title={
          <span className="flex items-center gap-2">
            <BrandMark className="size-7" /> {b.shortName || b.appName}
          </span>
        }
      >
        {numbers && numbers.length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Número de WhatsApp">
            {numbers.map((n) => (
              <button
                key={n.id}
                type="button"
                role="tab"
                aria-selected={n.id === numberId}
                onClick={() => pick(n.id)}
                className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm', n.id === numberId ? 'border-[#25d366] bg-[#25d366] font-medium text-white' : 'bg-background text-muted-foreground')}
              >
                <span className={cn('size-2 rounded-full', n.status === 'CONECTADO' ? 'bg-[#25d366]' : 'bg-muted-foreground/50', n.id === numberId && 'bg-white')} />
                {n.name}
              </button>
            ))}
          </div>
        )}
        <label className="relative mt-2 block">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar" className="h-10 rounded-full border-0 bg-muted pl-9" aria-label="Pesquisar conversas" />
        </label>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.filter((f) => f.key !== 'fila' || hasQueue).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn('shrink-0 rounded-full px-3 py-1 text-sm', filter === f.key ? 'bg-[#d8fdd2] font-medium text-[#0a3d2e] dark:bg-[#103529] dark:text-[#d8fdd2]' : 'bg-muted text-muted-foreground')}
            >
              {f.label}
              {f.key === 'naoLidas' && !!list.data?.unreadConversations && ` ${list.data.unreadConversations}`}
            </button>
          ))}
        </div>
      </TopBar>
      <InstallBanner />
      {(list.isLoading || (waitingNumber && !list.error)) && (
        <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Carregando conversas…
        </p>
      )}
      {list.error && <p className="p-6 text-center text-sm text-destructive">{errorMessage(list.error)}</p>}
      {!waitingNumber && list.data?.items.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{q ? 'Nenhuma conversa encontrada.' : filter === 'naoLidas' ? 'Nenhuma conversa não lida.' : 'Nenhuma conversa por aqui.'}</p>}
      <ul>
        {items.map((c) => {
          const name = c.name || (c.phone ? `+${c.phone.replace(/\D/g, '')}` : 'Contato')
          const unread = c.unread > 0
          return (
            <li key={c.id}>
              <Link to={`/app/conversa/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 active:bg-muted">
                <Avatar name={c.name} group={c.category === 'GRUPO'} className="size-12 text-base" />
                <span className="min-w-0 flex-1 border-b py-1.5">
                  <span className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-[16px]', unread && 'font-semibold')}>{name}</span>
                    <span className={cn('shrink-0 text-xs tabular-nums', unread ? 'font-medium text-[#25d366]' : 'text-muted-foreground')}>{when(c.lastMessageAt)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-muted-foreground">
                      {c.lastFromMe && <CheckCheckIcon className="size-4 shrink-0" />}
                      <span className="truncate">{c.lastPreview ?? ''}</span>
                    </span>
                    {unread && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25d366] px-1.5 text-xs font-semibold text-white">{c.unread > 99 ? '99+' : c.unread}</span>}
                  </span>
                  {(c.assignedUserName || c.stage) && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[c.assignedUserName ? `com ${c.assignedUserName}` : null, c.stage ? (c.stage.kind === 'PRE_VENDAS' ? 'Pré-venda' : 'Pós-venda') : null].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {can('chat', 'create') && (
        <button
          type="button"
          onClick={() => setStarting(true)}
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex size-14 items-center justify-center rounded-2xl bg-[#25d366] text-[#0a3d2e] shadow-lg active:scale-95"
          aria-label="Nova conversa"
        >
          <MessageSquarePlusIcon className="size-6" />
        </button>
      )}
      {starting && <StartDialog onClose={() => setStarting(false)} onStarted={(id) => (setStarting(false), navigate(`/app/conversa/${id}`))} />}
    </div>
  )
}

/** Conversa em tela cheia (voltar leva para a lista). */
export function AppConversa() {
  const { id } = useParams()
  const navigate = useNavigate()
  if (!id) return null
  return (
    <div className="h-dvh">
      <ThreadView id={id} compact onBack={() => navigate('/app')} />
    </div>
  )
}

/** Lista dos painéis que o perfil da pessoa libera. */
export function AppPaineis() {
  const panels = usePanels()
  return (
    <div>
      <TopBar title="Painéis" />
      {panels.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Nenhum painel liberado para o seu perfil.</p>}
      <ul className="space-y-2 px-4 pb-6">
        {panels.map((p) => (
          <li key={p.key}>
            <Link to={`/app/paineis/${p.key}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 active:bg-muted">
              <span className="flex size-10 items-center justify-center rounded-full bg-[#d8fdd2] text-[#0a3d2e] dark:bg-[#103529] dark:text-[#d8fdd2]">
                <p.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.title}</span>
                <span className="block text-sm text-muted-foreground">{p.description}</span>
              </span>
              <ChevronRightIcon className="size-5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Painel aberto: a mesma tela do computador, com voltar. */
export function AppPainelFrame() {
  const navigate = useNavigate()
  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background px-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5">
        <Button size="icon" variant="ghost" className="size-10" onClick={() => navigate('/app/paineis')} aria-label="Voltar para os painéis">
          <ChevronRightIcon className="size-5 rotate-180" />
        </Button>
        <span className="font-medium">Painéis</span>
      </div>
      <div className="p-3">
        <Outlet />
      </div>
    </div>
  )
}

/** Conta: quem está usando, notificações, tema e sair. */
export function AppConta() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  const [push, setPush] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void pushState().then(setPush)
  }, [])
  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      if (on) {
        await enablePush()
        await api.post('/app/push/teste')
        toast.success('Notificações ligadas. Mandamos uma de teste.')
      } else {
        await disablePush()
        toast.success('Notificações desligadas neste celular.')
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setPush(await pushState())
      setBusy(false)
    }
  }
  return (
    <div>
      <TopBar title="Conta" />
      <div className="space-y-4 px-4 pb-8">
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
          <Avatar name={me?.name ?? null} className="size-12 text-base" />
          <div className="min-w-0">
            <p className="truncate font-medium">{me?.name}</p>
            <p className="truncate text-sm text-muted-foreground">{me?.email}</p>
            <p className="text-xs text-muted-foreground">{me?.role.name}</p>
          </div>
        </div>

        <section className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-medium">
              {push === 'ligado' ? <BellIcon className="size-4" /> : <BellOffIcon className="size-4" />} Notificações
            </span>
            <Switch checked={push === 'ligado'} disabled={busy || push === 'indisponivel' || push === null} onCheckedChange={(v) => void toggle(v)} aria-label="Notificações de mensagem nova" />
          </div>
          <p className="text-sm text-muted-foreground">
            {push === 'ligado'
              ? 'Mensagem nova aparece no celular, mesmo com o app fechado.'
              : push === 'bloqueado'
                ? 'Bloqueadas no celular. Libere em Ajustes › Notificações e ligue aqui de novo.'
                : push === 'indisponivel'
                  ? isIOS()
                    ? 'No iPhone, as notificações funcionam com o app instalado na tela inicial (iOS 16.4 ou mais novo).'
                    : 'Este navegador não recebe notificações.'
                  : 'Ligue para receber as mensagens novas no celular.'}
          </p>
        </section>

        {!isInstalledApp() && <InstallHelp />}

        <section className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <span className="font-medium">Tema</span>
          <ThemeToggle />
        </section>

        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            void logout().then(() => navigate('/login', { replace: true }))
          }
        >
          <LogOutIcon /> Sair
        </Button>
      </div>
    </div>
  )
}

/** Aviso no topo da lista enquanto o app não está instalado (some ao fechar). */
function InstallBanner() {
  const [hidden, setHidden] = useState(() => {
    try {
      return isInstalledApp() || localStorage.getItem('app-instalar-fechado') === '1'
    } catch {
      return isInstalledApp()
    }
  })
  if (hidden) return null
  return (
    <div className="mx-4 mb-2 flex items-start gap-3 rounded-xl border bg-card p-3 text-sm">
      <DownloadIcon className="mt-0.5 size-4 shrink-0 text-[#008069]" />
      <p className="min-w-0 flex-1">
        Instale o app na tela inicial para abrir direto nas conversas e receber as notificações.{' '}
        <Link to="/app/conta" className="font-medium underline">
          Como instalar
        </Link>
      </p>
      <button
        type="button"
        aria-label="Fechar aviso"
        onClick={() => {
          try {
            localStorage.setItem('app-instalar-fechado', '1')
          } catch {
            /* sem armazenamento: só esconde agora */
          }
          setHidden(true)
        }}
      >
        <XIcon className="size-4 text-muted-foreground" />
      </button>
    </div>
  )
}

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferredPrompt: InstallPrompt | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e as InstallPrompt
})

function InstallHelp() {
  const [canPrompt, setCanPrompt] = useState(!!deferredPrompt)
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <BarChart3Icon className="size-4" /> Instalar na tela inicial
      </p>
      {canPrompt ? (
        <Button
          className="w-full"
          onClick={async () => {
            await deferredPrompt?.prompt()
            deferredPrompt = null
            setCanPrompt(false)
          }}
        >
          <DownloadIcon /> Instalar o app
        </Button>
      ) : isIOS() ? (
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Abra este endereço no <b>Safari</b>.</li>
          <li>
            Toque em <ShareIcon className="inline size-4" /> <b>Compartilhar</b>.
          </li>
          <li>
            Toque em <SquarePlusIcon className="inline size-4" /> <b>Adicionar à Tela de Início</b> e depois em <b>Adicionar</b>.
          </li>
          <li>Abra pelo ícone e ligue as notificações aqui na Conta.</li>
        </ol>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Abra este endereço no <b>Chrome</b>{isAndroid() ? '' : ' do celular'}.</li>
          <li>
            Toque no menu <b>⋮</b> e em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).
          </li>
          <li>Abra pelo ícone e ligue as notificações aqui na Conta.</li>
        </ol>
      )}
    </section>
  )
}
