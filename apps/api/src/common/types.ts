import type { PermissionSet } from './permissions'

export interface AuthUser {
  id: string
  tenantId: string
  email: string
  name: string
  familyId: string
  pending2faSetup: boolean
  role: { id: string; name: string; isSystem: boolean; require2fa: boolean }
  permissions: PermissionSet
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser
  }
}
