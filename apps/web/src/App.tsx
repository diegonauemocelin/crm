import { Loader2Icon } from 'lucide-react'
import { type ComponentType, lazy, type ReactNode, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ClassicLayout } from '@/components/layout/classic-layout'
import { ModernLayout } from '@/components/layout/modern-layout'
import { useAuth } from '@/lib/auth'
import { NAVIGATION } from '@/lib/navigation'
import { LoginPage } from '@/pages/auth/login-page'

/** Cada tela vira um arquivo JS separado, baixado só quando aberta. */
function page<T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) {
  const Component = lazy(async () => ({ default: (await loader())[name] as ComponentType }))
  return <Component />
}

const pages = {
  home: () => page(() => import('@/pages/home-page'), 'HomePage'),
  users: () => page(() => import('@/pages/users-page'), 'UsersPage'),
  roles: () => page(() => import('@/pages/roles-page'), 'RolesPage'),
  settings: () => page(() => import('@/pages/settings-page'), 'SettingsPage'),
  audit: () => page(() => import('@/pages/audit-page'), 'AuditPage'),
  updates: () => page(() => import('@/pages/updates-page'), 'UpdatesPage'),
  profile: () => page(() => import('@/pages/profile-page'), 'ProfilePage'),
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
  {
    element: <Protected />,
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
