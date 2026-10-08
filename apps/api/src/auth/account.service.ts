import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { fullPermissions, MODULES } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { LayoutMode, ThemeMode } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { AuthService } from './auth.service'
import { hashPassword, passwordProblems, verifyPassword } from './password'
import { SecurityService } from './security.service'

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly auth: AuthService,
    private readonly security: SecurityService,
  ) {}

  async profile(user: AuthUser) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    const branding = await this.settings.branding(user.tenantId)
    // Vendedor ligado ao login: define a base de quem tem perfil "somente os próprios".
    const seller = await this.prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true, name: true } })
    const layout = branding.allowLayoutChoice ? (row.layout ?? branding.defaultLayout) : branding.defaultLayout
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      avatarUrl: row.avatarFileId ? `/api/files/${row.avatarFileId}` : null,
      totpEnabled: row.totpEnabled,
      mustChangePassword: row.mustChangePassword,
      pending2faSetup: user.pending2faSetup,
      layout,
      theme: row.theme,
      allowLayoutChoice: branding.allowLayoutChoice,
      lastLoginAt: row.lastLoginAt,
      role: user.role,
      seller,
      permissions: user.role.isSystem ? fullPermissions() : user.permissions,
      modules: MODULES,
    }
  }

  async updatePreferences(user: AuthUser, prefs: { layout?: LayoutMode; theme?: ThemeMode }) {
    if (prefs.layout) {
      const branding = await this.settings.branding(user.tenantId)
      if (!branding.allowLayoutChoice) throw new ForbiddenException('O administrador definiu um layout fixo para todos.')
    }
    await this.prisma.user.update({ where: { id: user.id }, data: prefs })
    return this.profile(user)
  }

  async updateProfile(user: AuthUser, name: string, ctx: RequestCtx) {
    await this.prisma.user.update({ where: { id: user.id }, data: { name: name.trim() } })
    await this.audit.byUser(user, ctx, 'me.profile_updated', 'user', user.id, { name })
    return this.profile(user)
  }

  async setAvatar(user: AuthUser, fileId: string) {
    await this.prisma.user.update({ where: { id: user.id }, data: { avatarFileId: fileId } })
    return this.profile(user)
  }

  /** Troca de senha encerra as demais sessões do usuário, mantendo a atual. */
  async changePassword(user: AuthUser, current: string, next: string, ctx: RequestCtx) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    if (!(await verifyPassword(row.passwordHash, current))) throw new BadRequestException('Senha atual incorreta.')
    if (current === next) throw new BadRequestException('A nova senha precisa ser diferente da atual.')
    const problem = passwordProblems(next, row.email)
    if (problem) throw new BadRequestException(problem)

    const changedAt = new Date()
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(next), passwordChangedAt: changedAt, mustChangePassword: false },
    })
    await this.auth.revokeAllSessions(user.id, user.familyId)
    await this.audit.byUser(user, ctx, 'me.password_changed', 'user', user.id)
    this.security.alert(user.id, 'senha_alterada', ctx)
    // Token novo para a sessão atual, já que o anterior foi emitido antes da troca.
    return this.auth.signAccess({ sub: user.id, tid: user.tenantId, fam: user.familyId, p2fa: user.pending2faSetup })
  }
}
