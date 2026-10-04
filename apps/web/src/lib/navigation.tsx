import {
  BarChart3Icon,
  BotIcon,
  ClipboardListIcon,
  FileClockIcon,
  HeadsetIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MailIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  PackageIcon,
  SettingsIcon,
  ShieldCheckIcon,
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
    title: 'Geral',
    items: [{ title: 'Início', to: '/', icon: LayoutDashboardIcon }],
  },
  {
    title: 'Atendimento',
    items: [
      { title: 'Pré-Vendas', to: '/pre-vendas', icon: HeadsetIcon, module: 'pre_vendas' },
      { title: 'Pós-Vendas', to: '/pos-vendas', icon: ClipboardListIcon, module: 'pos_vendas' },
      { title: 'Cadastros', to: '/cadastros-atendimento', icon: ListChecksIcon, module: 'cadastros' },
      { title: 'Chat WhatsApp', to: '/chat', icon: MessageCircleIcon, module: 'chat', phase: 9 },
    ],
  },
  {
    title: 'CRM',
    items: [{ title: 'Base de leads', to: '/leads', icon: UsersRoundIcon, module: 'leads' }],
  },
  {
    title: 'Marketing',
    items: [
      { title: 'Captura', to: '/captura', icon: MegaphoneIcon, module: 'captura', phase: 4 },
      { title: 'Email marketing', to: '/email-marketing', icon: MailIcon, module: 'email_marketing', phase: 5 },
      { title: 'Catálogo', to: '/catalogo', icon: PackageIcon, module: 'catalogo', phase: 5 },
      { title: 'Automações', to: '/automacoes', icon: BotIcon, module: 'automacoes', phase: 6 },
    ],
  },
  {
    title: 'Análise',
    items: [{ title: 'Dashboards e relatórios', to: '/relatorios', icon: BarChart3Icon, module: 'relatorios', phase: 7 }],
  },
  {
    title: 'Administração',
    items: [
      { title: 'Usuários', to: '/usuarios', icon: UsersIcon, module: 'usuarios' },
      { title: 'Perfis de acesso', to: '/perfis', icon: ShieldCheckIcon, module: 'perfis' },
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

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      if (item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)) return { group, item }
    }
  }
  return null
}
