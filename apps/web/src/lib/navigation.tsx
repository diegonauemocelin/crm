import {
  BarChart3Icon,
  BotIcon,
  ClipboardListIcon,
  EyeIcon,
  FileClockIcon,
  GraduationCapIcon,
  HeadsetIcon,
  HistoryIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LayoutTemplateIcon,
  CalendarClockIcon,
  SearchCheckIcon,
  LightbulbIcon,
  MailIcon,
  MegaphoneIcon,
  TargetIcon,
  MessageCircleIcon,
  PackageIcon,
  PackageSearchIcon,
  SettingsIcon,
  ShoppingCartIcon,
  UsersRoundIcon,
  type LucideIcon,
  BookUserIcon,
  BrainCircuitIcon,
  CalendarRangeIcon,
  FilterIcon,
  GaugeIcon,
  GlobeIcon,
  MailOpenIcon,
  MusicIcon,
  PlugIcon,
  PresentationIcon,
  ScanSearchIcon,
  Share2Icon,
  CameraIcon,
  UsersIcon,
  FileBarChartIcon,
  ShoppingBagIcon,
  StoreIcon,
  MessageCircleQuestionIcon,
  MessagesSquareIcon,
  SendIcon,
  BookOpenIcon,
} from 'lucide-react'
import type { Action } from './types'

export interface NavItem {
  title: string
  to: string
  icon: LucideIcon
  module?: string
  action?: Action
  /** Aparece se a pessoa pode ver qualquer um destes módulos (ex.: Configurações, com seções de vários módulos). */
  anyOf?: string[]
  /** Fase do roadmap em que o módulo chega. Itens futuros aparecem com selo "Em breve". */
  phase?: number
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

/** Módulos com seções em Configurações (a tela mostra só as seções de cada um). */
export const SETTINGS_MODULES = ['configuracoes', 'cadastros', 'usuarios', 'perfis', 'whatsapp', 'email_marketing', 'captura', 'mi_config']

/** Menu único, usado pelos dois layouts (Moderno e Clássico). Cada item respeita a permissão do perfil. */
export const NAVIGATION: NavGroup[] = [
  {
    title: 'Dashboards',
    items: [
      { title: 'Início', to: '/', icon: LayoutDashboardIcon },
      { title: 'Atendimento WhatsApp', to: '/whatsapp/dashboard', icon: MessageCircleIcon, module: 'chat' },
      { title: 'Resultados do e-mail', to: '/email-marketing/dashboard', icon: MailIcon, module: 'email_marketing' },
      { title: 'Google Ads', to: '/google-ads', icon: TargetIcon, module: 'google_ads' },
      { title: 'Mercado Livre Ads', to: '/marketplaces/mercado-livre', icon: ShoppingBagIcon, module: 'marketplaces' },
    ],
  },
  {
    title: 'Análise',
    items: [
      { title: 'Relatórios', to: '/relatorios', icon: BarChart3Icon, module: 'relatorios' },
      { title: 'Produtos vistos', to: '/catalogo/vistos', icon: EyeIcon, module: 'catalogo' },
    ],
  },
  {
    title: 'Atendimento Comercial',
    items: [
      { title: 'Pré-Vendas', to: '/pre-vendas', icon: HeadsetIcon, module: 'pre_vendas' },
      { title: 'Pós-Vendas', to: '/pos-vendas', icon: ClipboardListIcon, module: 'pos_vendas' },
      { title: 'Chat WhatsApp', to: '/chat', icon: MessageCircleIcon, module: 'chat' },
      { title: 'Agenda de contatos', to: '/agenda', icon: BookUserIcon, module: 'whatsapp' },
      { title: 'Monitorar conversas', to: '/chat?monitorar=1', icon: EyeIcon, module: 'monitoramento' },
      { title: 'Consulta de produtos', to: '/consulta-produtos', icon: PackageSearchIcon, module: 'consulta_produtos' },
    ],
  },
  {
    title: 'CRM',
    items: [
      { title: 'Base de leads', to: '/leads', icon: UsersRoundIcon, module: 'leads' },
    ],
  },
  {
    title: 'E-commerce',
    items: [
      { title: 'Catálogo', to: '/catalogo', icon: PackageIcon, module: 'catalogo' },
      { title: 'Carrinhos abandonados', to: '/carrinhos', icon: ShoppingCartIcon, module: 'carrinhos' },
      { title: 'SEO dos produtos', to: '/seo-ecommerce', icon: SearchCheckIcon, module: 'seo_ecommerce' },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { title: 'Captura', to: '/captura', icon: MegaphoneIcon, module: 'captura' },
      { title: 'Email marketing', to: '/email-marketing', icon: MailIcon, module: 'email_marketing' },
      { title: 'Landing pages', to: '/landing-pages', icon: LayoutTemplateIcon, module: 'email_marketing' },
      { title: 'Postagens', to: '/postagens', icon: CalendarClockIcon, module: 'postagens' },
      { title: 'Automações', to: '/automacoes', icon: BotIcon, module: 'automacoes' },
    ],
  },
  {
    title: 'Marketing Inteligente',
    items: [
      { title: 'Visão geral', to: '/marketing', icon: GaugeIcon, module: 'mi_executivo' },
      { title: 'Dashboard executivo', to: '/marketing/executivo', icon: PresentationIcon, module: 'mi_executivo' },
      { title: 'Google Ads', to: '/marketing/google-ads', icon: TargetIcon, module: 'mi_midia' },
      { title: 'Meta Ads', to: '/marketing/meta-ads', icon: MegaphoneIcon, module: 'mi_midia' },
      { title: 'TikTok Ads', to: '/marketing/tiktok-ads', icon: MusicIcon, module: 'mi_midia' },
      { title: 'Redes sociais', to: '/marketing/redes-sociais', icon: Share2Icon, module: 'mi_social' },
      { title: 'Instagram', to: '/marketing/instagram', icon: CameraIcon, module: 'mi_social' },
      { title: 'SEO e site', to: '/marketing/seo', icon: GlobeIcon, module: 'mi_seo' },
      { title: 'CRM e leads', to: '/marketing/leads', icon: UsersIcon, module: 'mi_comercial' },
      { title: 'E-mail marketing', to: '/marketing/email', icon: MailOpenIcon, module: 'mi_comercial' },
      { title: 'Funil e atribuição', to: '/marketing/funil', icon: FilterIcon, module: 'mi_executivo' },
      { title: 'Análise de campanhas', to: '/marketing/campanhas', icon: ScanSearchIcon, module: 'mi_executivo' },
      { title: 'Recomendações', to: '/marketing/recomendacoes', icon: BrainCircuitIcon, module: 'mi_ia' },
      { title: 'Planejamento', to: '/marketing/planejamento', icon: CalendarRangeIcon, module: 'mi_orcamento' },
      { title: 'Relatórios e alertas', to: '/marketing/relatorios', icon: FileBarChartIcon, module: 'mi_relatorios' },
      { title: 'Integrações', to: '/marketing/integracoes', icon: PlugIcon, module: 'mi_config' },
    ],
  },
  {
    // Mercado Livre agora; a Shopee entra aqui depois.
    title: 'Marketplaces',
    items: [
      { title: 'Visão geral', to: '/marketplaces', icon: StoreIcon, module: 'marketplaces' },
      { title: 'Mercado Livre Ads', to: '/marketplaces/mercado-livre', icon: ShoppingBagIcon, module: 'marketplaces' },
      { title: 'Assistente ML', to: '/marketplaces/assistente', icon: BotIcon, module: 'assist_atendimento' },
      { title: 'Perguntas pendentes', to: '/marketplaces/assistente/pendentes', icon: MessageCircleQuestionIcon, module: 'assist_atendimento' },
      { title: 'Perguntas e respostas', to: '/marketplaces/assistente/perguntas', icon: MessagesSquareIcon, module: 'assist_atendimento' },
      { title: 'Respostas enviadas', to: '/marketplaces/assistente/respostas', icon: SendIcon, module: 'assist_atendimento' },
      { title: 'Base de conhecimento', to: '/marketplaces/assistente/conhecimento', icon: BookOpenIcon, module: 'assist_conhecimento' },
      { title: 'Produtos e aplicações', to: '/marketplaces/assistente/aplicacoes', icon: PackageSearchIcon, module: 'assist_aplicacoes' },
    ],
  },
  {
    title: 'Sugestões',
    items: [
      { title: 'Minhas sugestões', to: '/sugestoes', icon: LightbulbIcon },
      { title: 'Analisar sugestões', to: '/sugestoes/analisar', icon: InboxIcon, module: 'sugestoes' },
    ],
  },
  {
    title: 'Administração',
    items: [
      // Um lugar só para todos os ajustes: empresa, equipe e acesso, atendimento, WhatsApp, marketing e integrações.
      { title: 'Configurações', to: '/configuracoes', icon: SettingsIcon, anyOf: SETTINGS_MODULES },
      { title: 'Auditoria', to: '/auditoria', icon: FileClockIcon, module: 'auditoria' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { title: 'Trilha de conhecimento', to: '/trilha', icon: GraduationCapIcon },
      { title: 'Atualizações', to: '/atualizacoes', icon: HistoryIcon },
    ],
  },
]

/** Telas "Em breve" só aparecem para o administrador do sistema: para os outros, seriam um clique sem resultado. */
export function visibleNavigation(can: (module: string, action?: Action) => boolean, isAdmin = false): NavGroup[] {
  const allowed = (i: NavItem) => (!i.phase || isAdmin) && (i.anyOf ? i.anyOf.some((m) => can(m, 'view')) : !i.module || can(i.module, i.action ?? 'view'))
  return NAVIGATION.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter(
    (g) => g.items.length > 0,
  )
}

/**
 * Item do menu da tela atual: o de endereço mais específico (/email-marketing/dashboard ganha de /email-marketing).
 * Item com parâmetros (/chat?monitorar=1) só vale quando o endereço tem os mesmos parâmetros (search).
 */
export function findNavItem(pathname: string, search = ''): { group: NavGroup; item: NavItem } | null {
  const current = new URLSearchParams(search)
  let best: { group: NavGroup; item: NavItem } | null = null
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      const [path = '', query] = item.to.split('?')
      const params = [...new URLSearchParams(query ?? '').entries()]
      const pathHit = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)
      const hit = pathHit && params.every(([k, v]) => current.get(k) === v)
      if (hit && (!best || item.to.length > best.item.to.length)) best = { group, item }
    }
  }
  return best
}
