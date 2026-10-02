/** Módulos do sistema que podem ser liberados por perfil de acesso. Novos módulos entram aqui. */
export const MODULES = [
  { key: 'dashboard', label: 'Início', group: 'Geral' },
  { key: 'leads', label: 'Base de leads', group: 'CRM' },
  { key: 'pre_vendas', label: 'Pré-Vendas', group: 'Atendimento' },
  { key: 'pos_vendas', label: 'Pós-Vendas', group: 'Atendimento' },
  { key: 'chat', label: 'Chat WhatsApp', group: 'Atendimento' },
  { key: 'captura', label: 'Formulários, LPs e pop-ups', group: 'Marketing' },
  { key: 'email_marketing', label: 'Email marketing', group: 'Marketing' },
  { key: 'automacoes', label: 'Automações', group: 'Marketing' },
  { key: 'catalogo', label: 'Catálogo de produtos', group: 'Marketing' },
  { key: 'relatorios', label: 'Dashboards e relatórios', group: 'Análise' },
  { key: 'usuarios', label: 'Usuários', group: 'Administração' },
  { key: 'perfis', label: 'Perfis de acesso', group: 'Administração' },
  { key: 'configuracoes', label: 'Configurações', group: 'Administração' },
  { key: 'auditoria', label: 'Auditoria', group: 'Administração' },
] as const

export type ModuleKey = (typeof MODULES)[number]['key']
export const MODULE_KEYS = MODULES.map((m) => m.key) as readonly ModuleKey[]

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export'] as const
export type Action = (typeof ACTIONS)[number]

export type PermissionSet = Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean; scope: 'OWN' | 'ALL' }>

export function emptyPermission() {
  return { view: false, create: false, edit: false, delete: false, export: false, scope: 'ALL' as const }
}

export function fullPermissions(): PermissionSet {
  return Object.fromEntries(
    MODULE_KEYS.map((k) => [k, { view: true, create: true, edit: true, delete: true, export: true, scope: 'ALL' as const }]),
  )
}

export function can(perms: PermissionSet, isSystemRole: boolean, module: string, action: Action): boolean {
  if (isSystemRole) return true
  return perms[module]?.[action] === true
}
