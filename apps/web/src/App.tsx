import { Loader2Icon } from 'lucide-react'
import { type ComponentType, lazy, type ReactNode, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ClassicLayout } from '@/components/layout/classic-layout'
import { ModernLayout } from '@/components/layout/modern-layout'
import { useAuth } from '@/lib/auth'
import { NAVIGATION } from '@/lib/navigation'
import { LoginPage } from '@/pages/auth/login-page'

const RELOAD_FLAG = 'crm-reloaded-after-update'

/**
 * Depois de uma atualização, uma aba que ficou aberta ainda aponta para os arquivos da versão anterior,
 * que deixam de existir no servidor. Nesse caso recarrega a página uma vez para pegar a versão nova.
 */
async function loadWithReload<T>(loader: () => Promise<T>): Promise<T> {
  try {
    const mod = await loader()
    sessionStorageSafe('remove')
    return mod
  } catch (err) {
    if (sessionStorageSafe('get') !== '1') {
      sessionStorageSafe('set')
      window.location.reload()
      return new Promise<T>(() => {})
    }
    throw err
  }
}

function sessionStorageSafe(op: 'get' | 'set' | 'remove'): string | null {
  try {
    if (op === 'get') return sessionStorage.getItem(RELOAD_FLAG)
    if (op === 'set') sessionStorage.setItem(RELOAD_FLAG, '1')
    else sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    /* armazenamento indisponível: segue sem a proteção contra recarga em laço */
  }
  return null
}

/** Cada tela vira um arquivo JS separado, baixado só quando aberta. */
function page<T>(loader: () => Promise<T>, name: keyof T) {
  const Component = lazy(async () => ({ default: (await loadWithReload(loader))[name] as unknown as ComponentType }))
  return <Component />
}

/** Tela de erro amigável no lugar da mensagem técnica do roteador. */
function RouteError() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">Não foi possível abrir esta tela</p>
      <p className="max-w-md text-sm text-muted-foreground">O sistema pode ter sido atualizado enquanto esta aba estava aberta. Recarregue a página para continuar.</p>
      <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => window.location.reload()}>
        Recarregar
      </button>
    </div>
  )
}

const pages = {
  home: () => page(() => import('@/pages/home-page'), 'HomePage'),
  users: () => page(() => import('@/pages/users-page'), 'UsersPage'),
  roles: () => page(() => import('@/pages/roles-page'), 'RolesPage'),
  settings: () => page(() => import('@/pages/settings-page'), 'SettingsPage'),
  audit: () => page(() => import('@/pages/audit-page'), 'AuditPage'),
  updates: () => page(() => import('@/pages/updates-page'), 'UpdatesPage'),
  profile: () => page(() => import('@/pages/profile-page'), 'ProfilePage'),
  preVendas: () => page(() => import('@/pages/atendimento-page'), 'PreVendasPage'),
  posVendas: () => page(() => import('@/pages/atendimento-page'), 'PosVendasPage'),
  cadastros: () => page(() => import('@/pages/cadastros-page'), 'CadastrosPage'),
  leads: () => page(() => import('@/pages/leads-page'), 'LeadsPage'),
  leadDetail: () => page(() => import('@/pages/lead-detail-page'), 'LeadDetailPage'),
  leadImport: () => page(() => import('@/pages/lead-import-page'), 'LeadImportPage'),
  carts: () => page(() => import('@/pages/carts-page'), 'CartsPage'),
  captura: () => page(() => import('@/pages/captura-page'), 'CapturaPage'),
  leadsConfig: () => page(() => import('@/pages/leads-config-page'), 'LeadsConfigPage'),
  unsubscribe: () => page(() => import('@/pages/unsubscribe-page'), 'UnsubscribePage'),
  comingSoon: () => page(() => import('@/pages/misc-pages'), 'ComingSoonPage'),
  notFound: () => page(() => import('@/pages/misc-pages'), 'NotFoundPage'),
  forgot: () => page(() => import('@/pages/auth/password-pages'), 'ForgotPasswordPage'),
  reset: () => page(() => import('@/pages/auth/password-pages'), 'ResetPasswordPage'),
  setup: () => page(() => import('@/pages/auth/account-setup-page'), 'AccountSetupPage'),
}

function Loader({ fullscreen = false }: { fullscreen?: boolean }) {
  return (
    <div className={fullscreen ? 'flex min-h-svh items-center justify-center' : 'flex justify-center py-16'} aria-busy="true">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-label="Carregando" />
    </div>
  )
}

function Lazy({ children, fullscreen }: { children: ReactNode; fullscreen?: boolean }) {
  return <Suspense fallback={<Loader fullscreen={fullscreen} />}>{children}</Suspense>
}

/** Exige sessão; conta com senha provisória ou 2FA pendente vai para o assistente de primeiro acesso. */
function Protected() {
  const { me, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loader fullscreen />
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (me.mustChangePassword || me.pending2faSetup) return <Navigate to="/configurar-conta" replace />
  return <Outlet />
}

/** Layout escolhido pelo usuário (ou o padrão definido pelo administrador). */
function AppShell() {
  const { me } = useAuth()
  return me?.layout === 'CLASSIC' ? <ClassicLayout /> : <ModernLayout />
}

const comingSoon = NAVIGATION.flatMap((g) => g.items)
  .filter((i) => i.phase)
  .map((i) => ({ path: `${i.to.slice(1)}/*`, element: <Lazy>{pages.comingSoon()}</Lazy> }))

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/esqueci-senha', element: <Lazy fullscreen>{pages.forgot()}</Lazy> },
  { path: '/redefinir-senha', element: <Lazy fullscreen>{pages.reset()}</Lazy> },
  { path: '/configurar-conta', element: <Lazy fullscreen>{pages.setup()}</Lazy> },
  { path: '/descadastro/:token', element: <Lazy fullscreen>{pages.unsubscribe()}</Lazy> },
  {
    element: <Protected />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Lazy>{pages.home()}</Lazy> },
          { path: 'usuarios', element: <Lazy>{pages.users()}</Lazy> },
          { path: 'perfis', element: <Lazy>{pages.roles()}</Lazy> },
          { path: 'configuracoes', element: <Lazy>{pages.settings()}</Lazy> },
          { path: 'auditoria', element: <Lazy>{pages.audit()}</Lazy> },
          { path: 'atualizacoes', element: <Lazy>{pages.updates()}</Lazy> },
          { path: 'meu-perfil', element: <Lazy>{pages.profile()}</Lazy> },
          { path: 'pre-vendas', element: <Lazy>{pages.preVendas()}</Lazy> },
          { path: 'pos-vendas', element: <Lazy>{pages.posVendas()}</Lazy> },
          { path: 'cadastros-atendimento', element: <Lazy>{pages.cadastros()}</Lazy> },
          { path: 'leads', element: <Lazy>{pages.leads()}</Lazy> },
          { path: 'leads/importar', element: <Lazy>{pages.leadImport()}</Lazy> },
          { path: 'carrinhos', element: <Lazy>{pages.carts()}</Lazy> },
          { path: 'captura', element: <Lazy>{pages.captura()}</Lazy> },
          { path: 'leads/configuracoes', element: <Lazy>{pages.leadsConfig()}</Lazy> },
          { path: 'leads/:id', element: <Lazy>{pages.leadDetail()}</Lazy> },
          ...comingSoon,
          { path: '*', element: <Lazy>{pages.notFound()}</Lazy> },
        ],
      },
    ],
  },
])

export default function App() {
  const { loading } = useAuth()
  if (loading) return <Loader fullscreen />
  return <RouterProvider router={router} />
}
