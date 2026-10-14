import {
  BarChart3Icon,
  BotIcon,
  ClipboardListIcon,
  EyeIcon,
  FileClockIcon,
  HeadsetIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MailIcon,
  MegaphoneIcon,
  SmartphoneIcon,
  TargetIcon,
  MessageCircleIcon,
  PackageIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import type { Action } from './types'

export interface NavItem {
  title: string
  to: string
  icon: LucideIcon
  module?: string
  action?: Action
  /** Fase do roadmap em que o módulo chega. Itens futuros aparecem com selo "Em breve". */
  phase?: number
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

/** Menu único, usado pelos dois layouts (Moderno e Clássico). Cada item respeita a permissão do perfil. */
export const NAVIGATION: NavGroup[] = [
  {
    title: 'Dashboards',
    items: [
      { title: 'Início', to: '/', icon: LayoutDashboardIcon },
      { title: 'Atendimento WhatsApp', to: '/whatsapp/dashboard', icon: MessageCircleIcon, module: 'chat' },
      { title: 'Resultados do e-mail', to: '/email-marketing/dashboard', icon: MailIcon, module: 'email_marketing' },
      { title: 'Google Ads', to: '/google-ads', icon: TargetIcon, module: 'google_ads' },
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
      { title: 'Monitorar conversas', to: '/chat?monitorar=1', icon: EyeIcon, module: 'monitoramento' },
      { title: 'Cadastros', to: '/cadastros-atendimento', icon: ListChecksIcon, module: 'cadastros' },
    ],
  },
  {
    title: 'CRM',
    items: [
      { title: 'Base de leads', to: '/leads', icon: UsersRoundIcon, module: 'leads' },
      { title: 'Carrinhos e checkout', to: '/carrinhos', icon: ShoppingCartIcon, module: 'carrinhos' },
      { title: 'Catálogo', to: '/catalogo', icon: PackageIcon, module: 'catalogo' },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { title: 'Captura', to: '/captura', icon: MegaphoneIcon, module: 'captura' },
      { title: 'Email marketing', to: '/email-marketing', icon: MailIcon, module: 'email_marketing' },
      { title: 'Automações', to: '/automacoes', icon: BotIcon, module: 'automacoes' },
    ],
  },
  {
    title: 'Administração',
    items: [
      { title: 'Usuários', to: '/usuarios', icon: UsersIcon, module: 'usuarios' },
      { title: 'Perfis de acesso', to: '/perfis', icon: ShieldCheckIcon, module: 'perfis' },
      { title: 'Números de WhatsApp', to: '/whatsapp/numeros', icon: SmartphoneIcon, module: 'whatsapp' },
      { title: 'Configurações', to: '/configuracoes', icon: SettingsIcon, module: 'configuracoes' },
      { title: 'Auditoria', to: '/auditoria', icon: FileClockIcon, module: 'auditoria' },
    ],
  },
  {
    title: 'Sistema',
    items: [{ title: 'Atualizações', to: '/atualizacoes', icon: HistoryIcon }],
  },
]

export function visibleNavigation(can: (module: string, action?: Action) => boolean): NavGroup[] {
  return NAVIGATION.map((g) => ({ ...g, items: g.items.filter((i) => !i.module || can(i.module, i.action ?? 'view')) })).filter(
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
