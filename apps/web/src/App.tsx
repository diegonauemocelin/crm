import { Loader2Icon } from 'lucide-react'
import { type ComponentType, lazy, type ReactNode, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ClassicLayout } from '@/components/layout/classic-layout'
import { ModernLayout } from '@/components/layout/modern-layout'
import { useAuth } from '@/lib/auth'
import { ReauthDialog } from '@/components/reauth-dialog'
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
  settings: () => page(() => import('@/pages/configuracoes-page'), 'ConfiguracoesPage'),
  audit: () => page(() => import('@/pages/audit-page'), 'AuditPage'),
  updates: () => page(() => import('@/pages/updates-page'), 'UpdatesPage'),
  profile: () => page(() => import('@/pages/profile-page'), 'ProfilePage'),
  preVendas: () => page(() => import('@/pages/atendimento-page'), 'PreVendasPage'),
  posVendas: () => page(() => import('@/pages/atendimento-page'), 'PosVendasPage'),
  leads: () => page(() => import('@/pages/leads-page'), 'LeadsPage'),
  leadDetail: () => page(() => import('@/pages/lead-detail-page'), 'LeadDetailPage'),
  leadImport: () => page(() => import('@/pages/lead-import-page'), 'LeadImportPage'),
  carts: () => page(() => import('@/pages/carts-page'), 'CartsPage'),
  captura: () => page(() => import('@/pages/captura-page'), 'CapturaPage'),
  email: () => page(() => import('@/pages/email-page'), 'EmailPage'),
  emailCampaign: () => page(() => import('@/pages/email-campaign-page'), 'EmailCampaignPage'),
  automacoes: () => page(() => import('@/pages/automacoes-page'), 'AutomacoesPage'),
  automacao: () => page(() => import('@/pages/automacao-page'), 'AutomacaoPage'),
  relatorios: () => page(() => import('@/pages/relatorios-page'), 'RelatoriosPage'),
  chat: () => page(() => import('@/pages/chat-page'), 'ChatPage'),
  whatsappDashboard: () => page(() => import('@/pages/whatsapp-dashboard-page'), 'WhatsappDashboardPage'),
  agenda: () => page(() => import('@/pages/agenda-page'), 'AgendaPage'),
  emailDashboard: () => page(() => import('@/pages/email-dashboard-page'), 'EmailDashboardPage'),
  landingPages: () => page(() => import('@/pages/landing-pages-page'), 'LandingPagesPage'),
  seoEcommerce: () => page(() => import('@/pages/seo-ecommerce-page'), 'SeoEcommercePage'),
  postagens: () => page(() => import('@/pages/postagens-page'), 'PostagensPage'),
  landingEditor: () => page(() => import('@/pages/landing-editor-page'), 'LandingEditorPage'),
  sugestoes: () => page(() => import('@/pages/sugestoes-page'), 'SugestoesPage'),
  sugestoesAnalisar: () => page(() => import('@/pages/sugestoes-page'), 'SugestoesAnalisarPage'),
  consultaProdutos: () => page(() => import('@/pages/consulta-produtos-page'), 'ConsultaProdutosPage'),
  trilha: () => page(() => import('@/pages/trilha-page'), 'TrilhaPage'),
  googleAdsPainel: () => page(() => import('@/pages/google-ads-painel-page'), 'GoogleAdsPainelPage'),
  relatorio: () => page(() => import('@/pages/relatorio-page'), 'RelatorioPage'),
  capturaEditor: () => page(() => import('@/pages/captura-editor-page'), 'CapturaEditorPage'),
  produtosVistos: () => page(() => import('@/pages/produtos-vistos-page'), 'ProdutosVistosPage'),
  catalogo: () => page(() => import('@/pages/catalogo-page'), 'CatalogoPage'),
  unsubscribe: () => page(() => import('@/pages/unsubscribe-page'), 'UnsubscribePage'),
  mktVisao: () => page(() => import('@/pages/marketing/paineis'), 'VisaoGeralPage'),
  mktExecutivo: () => page(() => import('@/pages/marketing/paineis'), 'ExecutivoPage'),
  mktGoogle: () => page(() => import('@/pages/marketing/plataformas'), 'GoogleAdsMktPage'),
  mktMeta: () => page(() => import('@/pages/marketing/plataformas'), 'MetaAdsPage'),
  mktTiktok: () => page(() => import('@/pages/marketing/plataformas'), 'TikTokAdsPage'),
  mktSocial: () => page(() => import('@/pages/marketing/plataformas'), 'SocialPage'),
  mktInstagram: () => page(() => import('@/pages/marketing/instagram'), 'InstagramPage'),
  mktSeo: () => page(() => import('@/pages/marketing/plataformas'), 'SeoPage'),
  mktLeads: () => page(() => import('@/pages/marketing/paineis'), 'LeadsMktPage'),
  mktEmail: () => page(() => import('@/pages/marketing/paineis'), 'EmailMktPage'),
  mktFunil: () => page(() => import('@/pages/marketing/paineis'), 'FunilPage'),
  mktCampanhas: () => page(() => import('@/pages/marketing/paineis'), 'CampanhasPage'),
  mktRecs: () => page(() => import('@/pages/marketing/paineis'), 'RecomendacoesPage'),
  mktPlano: () => page(() => import('@/pages/marketing/planejamento'), 'PlanejamentoPage'),
  mktRelatorios: () => page(() => import('@/pages/marketing/relatorios'), 'RelatoriosMktPage'),
  mktIntegracoes: () => page(() => import('@/pages/marketing/paineis'), 'IntegracoesMktPage'),
  mktpVisao: () => page(() => import('@/pages/marketplaces'), 'MarketplacesVisaoPage'),
  mktpMl: () => page(() => import('@/pages/marketplaces'), 'MercadoLivreAdsPage'),
  mktpMlRetorno: () => page(() => import('@/pages/marketplaces'), 'MlRetornoPage'),
  mktpIntegracoes: () => page(() => import('@/pages/marketplaces'), 'MarketplacesIntegracoesPage'),
  assistPainel: () => page(() => import('@/pages/assistente/painel'), 'AssistentePainelPage'),
  assistPerguntas: () => page(() => import('@/pages/assistente/perguntas'), 'AssistentePerguntasPage'),
  assistPendentes: () => page(() => import('@/pages/assistente/perguntas'), 'AssistentePendentesPage'),
  assistPergunta: () => page(() => import('@/pages/assistente/perguntas'), 'AssistentePerguntaPage'),
  assistRespostas: () => page(() => import('@/pages/assistente/respostas'), 'AssistenteRespostasPage'),
  assistConhecimento: () => page(() => import('@/pages/assistente/conhecimento'), 'AssistenteConhecimentoPage'),
  assistImportar: () => page(() => import('@/pages/assistente/conhecimento'), 'AssistenteImportarPage'),
  assistAplicacoes: () => page(() => import('@/pages/assistente/aplicacoes'), 'AssistenteAplicacoesPage'),
  assistConfig: () => page(() => import('@/pages/assistente/configuracoes'), 'AssistenteConfigPage'),
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

/**
 * Servidor fora do ar (atualização em andamento): a sessão continua valendo, então não manda para o login.
 * Consulta o servidor a cada 5 s e recarrega a página quando ele volta (já com a versão nova, depois de um deploy).
 */
function Unavailable() {
  useEffect(() => {
    const check = () =>
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => r.ok && window.location.reload())
        .catch(() => undefined)
    const t = setInterval(check, 5_000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden />
      <p className="font-medium">O sistema está sendo atualizado</p>
      <p className="max-w-sm text-sm text-muted-foreground">Volta sozinho em alguns segundos. Você continua conectado: não precisa entrar de novo.</p>
      <button type="button" className="text-sm underline" onClick={() => window.location.reload()}>
        Tentar agora
      </button>
    </div>
  )
}

/** Exige sessão; conta com senha provisória ou 2FA pendente vai para o assistente de primeiro acesso. */
function Protected() {
  const { me, loading, unavailable } = useAuth()
  const location = useLocation()
  if (unavailable) return <Unavailable />
  if (loading) return <Loader fullscreen />
  if (!me) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  if (me.mustChangePassword || me.pending2faSetup) return <Navigate to="/configurar-conta" replace />
  return (
    <>
      <Outlet />
      <ReauthDialog />
    </>
  )
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
          // Telas de ajuste antigas: agora são seções de Configurações.
          { path: 'usuarios', element: <Navigate to="/configuracoes?secao=usuarios" replace /> },
          { path: 'perfis', element: <Navigate to="/configuracoes?secao=perfis" replace /> },
          { path: 'configuracoes', element: <Lazy>{pages.settings()}</Lazy> },
          { path: 'auditoria', element: <Lazy>{pages.audit()}</Lazy> },
          { path: 'atualizacoes', element: <Lazy>{pages.updates()}</Lazy> },
          { path: 'meu-perfil', element: <Lazy>{pages.profile()}</Lazy> },
          { path: 'pre-vendas', element: <Lazy>{pages.preVendas()}</Lazy> },
          { path: 'pos-vendas', element: <Lazy>{pages.posVendas()}</Lazy> },
          { path: 'cadastros-atendimento', element: <Navigate to="/configuracoes?secao=listas" replace /> },
          { path: 'leads', element: <Lazy>{pages.leads()}</Lazy> },
          { path: 'leads/importar', element: <Lazy>{pages.leadImport()}</Lazy> },
          { path: 'carrinhos', element: <Lazy>{pages.carts()}</Lazy> },
          { path: 'captura', element: <Lazy>{pages.captura()}</Lazy> },
          { path: 'catalogo/vistos', element: <Lazy>{pages.produtosVistos()}</Lazy> },
          { path: 'catalogo', element: <Lazy>{pages.catalogo()}</Lazy> },
          { path: 'captura/editor/:tipo/:id', element: <Lazy>{pages.capturaEditor()}</Lazy> },
          { path: 'email-marketing', element: <Lazy>{pages.email()}</Lazy> },
          { path: 'email-marketing/dashboard', element: <Lazy>{pages.emailDashboard()}</Lazy> },
          { path: 'email-marketing/:id', element: <Lazy>{pages.emailCampaign()}</Lazy> },
          { path: 'landing-pages', element: <Lazy>{pages.landingPages()}</Lazy> },
          { path: 'landing-pages/:id', element: <Lazy>{pages.landingEditor()}</Lazy> },
          { path: 'seo-ecommerce', element: <Lazy>{pages.seoEcommerce()}</Lazy> },
          { path: 'postagens', element: <Lazy>{pages.postagens()}</Lazy> },
          { path: 'automacoes', element: <Lazy>{pages.automacoes()}</Lazy> },
          { path: 'automacoes/:id', element: <Lazy>{pages.automacao()}</Lazy> },
          { path: 'relatorios', element: <Lazy>{pages.relatorios()}</Lazy> },
          { path: 'google-ads', element: <Lazy>{pages.googleAdsPainel()}</Lazy> },
          { path: 'marketing', element: <Lazy>{pages.mktVisao()}</Lazy> },
          { path: 'marketing/executivo', element: <Lazy>{pages.mktExecutivo()}</Lazy> },
          { path: 'marketing/google-ads', element: <Lazy>{pages.mktGoogle()}</Lazy> },
          { path: 'marketing/meta-ads', element: <Lazy>{pages.mktMeta()}</Lazy> },
          { path: 'marketing/tiktok-ads', element: <Lazy>{pages.mktTiktok()}</Lazy> },
          { path: 'marketing/redes-sociais', element: <Lazy>{pages.mktSocial()}</Lazy> },
          { path: 'marketing/instagram', element: <Lazy>{pages.mktInstagram()}</Lazy> },
          { path: 'marketing/seo', element: <Lazy>{pages.mktSeo()}</Lazy> },
          { path: 'marketing/leads', element: <Lazy>{pages.mktLeads()}</Lazy> },
          { path: 'marketing/email', element: <Lazy>{pages.mktEmail()}</Lazy> },
          { path: 'marketing/funil', element: <Lazy>{pages.mktFunil()}</Lazy> },
          { path: 'marketing/campanhas', element: <Lazy>{pages.mktCampanhas()}</Lazy> },
          { path: 'marketing/recomendacoes', element: <Lazy>{pages.mktRecs()}</Lazy> },
          { path: 'marketing/planejamento', element: <Lazy>{pages.mktPlano()}</Lazy> },
          { path: 'marketing/relatorios', element: <Lazy>{pages.mktRelatorios()}</Lazy> },
          { path: 'marketing/integracoes', element: <Lazy>{pages.mktIntegracoes()}</Lazy> },
          { path: 'marketplaces', element: <Lazy>{pages.mktpVisao()}</Lazy> },
          { path: 'marketplaces/mercado-livre', element: <Lazy>{pages.mktpMl()}</Lazy> },
          { path: 'marketplaces/mercado-livre/retorno', element: <Lazy>{pages.mktpMlRetorno()}</Lazy> },
          { path: 'marketplaces/integracoes', element: <Lazy>{pages.mktpIntegracoes()}</Lazy> },
          { path: 'marketplaces/assistente', element: <Lazy>{pages.assistPainel()}</Lazy> },
          { path: 'marketplaces/assistente/perguntas', element: <Lazy>{pages.assistPerguntas()}</Lazy> },
          { path: 'marketplaces/assistente/perguntas/:id', element: <Lazy>{pages.assistPergunta()}</Lazy> },
          { path: 'marketplaces/assistente/pendentes', element: <Lazy>{pages.assistPendentes()}</Lazy> },
          { path: 'marketplaces/assistente/respostas', element: <Lazy>{pages.assistRespostas()}</Lazy> },
          { path: 'marketplaces/assistente/conhecimento', element: <Lazy>{pages.assistConhecimento()}</Lazy> },
          { path: 'marketplaces/assistente/conhecimento/importar', element: <Lazy>{pages.assistImportar()}</Lazy> },
          { path: 'marketplaces/assistente/aplicacoes', element: <Lazy>{pages.assistAplicacoes()}</Lazy> },
          { path: 'marketplaces/assistente/configuracoes', element: <Lazy>{pages.assistConfig()}</Lazy> },
          { path: 'whatsapp/numeros', element: <Navigate to="/configuracoes?secao=whatsapp-numeros" replace /> },
          { path: 'agenda', element: <Lazy>{pages.agenda()}</Lazy> },
          { path: 'chat', element: <Lazy>{pages.chat()}</Lazy> },
          { path: 'trilha', element: <Lazy>{pages.trilha()}</Lazy> },
          { path: 'consulta-produtos', element: <Lazy>{pages.consultaProdutos()}</Lazy> },
          { path: 'sugestoes', element: <Lazy>{pages.sugestoes()}</Lazy> },
          { path: 'sugestoes/analisar', element: <Lazy>{pages.sugestoesAnalisar()}</Lazy> },
          { path: 'whatsapp/dashboard', element: <Lazy>{pages.whatsappDashboard()}</Lazy> },
          { path: 'relatorios/:id', element: <Lazy>{pages.relatorio()}</Lazy> },
          { path: 'leads/configuracoes', element: <Navigate to="/configuracoes?secao=leads-campos" replace /> },
          { path: 'leads/:id', element: <Lazy>{pages.leadDetail()}</Lazy> },
          ...comingSoon,
          { path: '*', element: <Lazy>{pages.notFound()}</Lazy> },
        ],
      },
    ],
  },
])

export default function App() {
  const { loading, unavailable } = useAuth()
  if (unavailable) return <Unavailable />
  if (loading) return <Loader fullscreen />
  return <RouterProvider router={router} />
}
