export type LayoutMode = 'MODERN' | 'CLASSIC'
export type ThemeMode = 'LIGHT' | 'DARK' | 'SYSTEM'
export type Action = 'view' | 'create' | 'edit' | 'delete' | 'export'

export interface ModuleDef {
  key: string
  label: string
  group: string
  /** O que cada ação libera neste módulo. */
  help?: string
}

export interface PermissionEntry {
  view: boolean
  create: boolean
  edit: boolean
  delete: boolean
  export: boolean
  scope: 'OWN' | 'UNIT' | 'ALL'
}

export interface Me {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  totpEnabled: boolean
  mustChangePassword: boolean
  pending2faSetup: boolean
  layout: LayoutMode
  theme: ThemeMode
  allowLayoutChoice: boolean
  lastLoginAt: string | null
  role: { id: string; name: string; isSystem: boolean; require2fa: boolean }
  /** Vendedor ligado a este login (define a base do perfil "somente os próprios"). */
  seller: { id: string; name: string } | null
  permissions: Record<string, PermissionEntry>
  modules: ModuleDef[]
}

export interface Branding {
  appName: string
  shortName: string
  primaryColor: string
  sidebarColor: string
  loginTitle: string
  loginSubtitle: string
  defaultLayout: LayoutMode
  allowLayoutChoice: boolean
  supportEmail: string
  logoUrl: string | null
  logoDarkUrl: string | null
  faviconUrl: string | null
}

export interface VersionInfo {
  version: string
  releasedAt: string | null
  commit: string
  buildDate: string
  latestAvailable: string | null
  latestUrl: string | null
  updateCheckEnabled: boolean
  updateAvailable: boolean
  upToDate: boolean
}

export type ChangeType = 'novo' | 'melhoria' | 'correcao' | 'seguranca' | 'infra'

export interface Release {
  version: string
  releasedAt: string
  installedAt: string
  title: string
  current: boolean
  changes: { type: ChangeType; area?: string; text: string }[]
}

export interface UserRow {
  id: string
  name: string
  email: string
  active: boolean
  totpEnabled: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  locked: boolean
  avatarUrl: string | null
  role: { id: string; name: string; isSystem: boolean }
  unit: { id: string; name: string } | null
}

export interface RoleRow {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  require2fa: boolean
  active: boolean
  userCount: number
  permissions: (PermissionEntry & { module: string })[]
}

export interface AuditRow {
  id: string
  userEmail: string | null
  action: string
  entity: string | null
  entityId: string | null
  ip: string | null
  userAgent: string | null
  data: Record<string, unknown> | null
  createdAt: string
}
