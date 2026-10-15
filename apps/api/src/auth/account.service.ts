import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { can, fullPermissions, MODULES } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { LayoutMode, ThemeMode } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { cleanSignature } from '../whatsapp/envio'
import { AuthService } from './auth.service'
import { hashPassword, passwordProblems, verifyPassword } from './password'
import { SecurityService } from './security.service'
import { cleanViews, readViews, type ViewScreen } from './visoes'

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
    const defaultScreens = branding.defaultScreens === 'NOVO' ? 'NOVO' : 'ATUAL'
    const screens = branding.allowLayoutChoice && (row.screens === 'NOVO' || row.screens === 'ATUAL') ? row.screens : defaultScreens
    return {
      id: row.id,
      name: row.name,
      chatSignature: row.chatSignature,
      email: row.email,
      avatarUrl: row.avatarFileId ? `/api/files/${row.avatarFileId}` : null,
      totpEnabled: row.totpEnabled,
      mustChangePassword: row.mustChangePassword,
      pending2faSetup: user.pending2faSetup,
      layout,
      screens,
      theme: row.theme,
      allowLayoutChoice: branding.allowLayoutChoice,
      lastLoginAt: row.lastLoginAt,
      role: user.role,
      seller,
      permissions: user.role.isSystem ? fullPermissions() : user.permissions,
      modules: MODULES,
    }
  }

  async updatePreferences(user: AuthUser, prefs: { layout?: LayoutMode; theme?: ThemeMode; screens?: 'ATUAL' | 'NOVO' }) {
    if (prefs.layout || prefs.screens) {
      const branding = await this.settings.branding(user.tenantId)
      if (!branding.allowLayoutChoice) throw new ForbiddenException('O administrador definiu um layout fixo para todos.')
    }
    await this.prisma.user.update({ where: { id: user.id }, data: prefs })
    return this.profile(user)
  }

  async updateProfile(user: AuthUser, name: string, ctx: RequestCtx, chatSignature?: string | null) {
    // undefined: tela antiga, mantém; null ou vazio: volta para o primeiro nome.
    const signature = chatSignature === undefined ? undefined : cleanSignature(chatSignature)
    await this.prisma.user.update({ where: { id: user.id }, data: { name: name.trim(), ...(signature !== undefined ? { chatSignature: signature } : {}) } })
    await this.audit.byUser(user, ctx, 'me.profile_updated', 'user', user.id, { name, ...(signature !== undefined ? { nomeNoWhatsapp: signature } : {}) })
    return this.profile(user)
  }

  /** Visões salvas de uma tela (só deste usuário). */
  async views(user: AuthUser, screen: ViewScreen) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { savedViews: true } })
    return readViews(row.savedViews, screen)
  }

  async saveViews(user: AuthUser, screen: ViewScreen, input: unknown) {
    const r = cleanViews(input)
    if ('error' in r) throw new BadRequestException(r.error)
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { savedViews: true } })
    const all = row.savedViews && typeof row.savedViews === 'object' && !Array.isArray(row.savedViews) ? (row.savedViews as Record<string, unknown>) : {}
    await this.prisma.user.update({ where: { id: user.id }, data: { savedViews: { ...all, [screen]: r.views } as object } })
    return r.views
  }

  async trail(user: AuthUser) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { trailDone: true } })
    return { done: row.trailDone }
  }

  /** Marca ou desmarca uma lição (ids curtos, definidos pela tela: ex. "chat.responder"). */
  async markLesson(user: AuthUser, lesson: string, done: boolean) {
    if (!/^[a-z0-9][a-z0-9_.-]{1,59}$/.test(lesson)) throw new BadRequestException('Lição inválida.')
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { trailDone: true } })
    const set = new Set(row.trailDone)
    if (done) set.add(lesson)
    else set.delete(lesson)
    const next = [...set].slice(0, 300)
    await this.prisma.user.update({ where: { id: user.id }, data: { trailDone: next } })
    return { done: next }
  }

  async teamTrail(user: AuthUser) {
    if (!can(user.permissions, user.role.isSystem, 'usuarios', 'view')) throw new ForbiddenException('Você não tem permissão para esta ação.')
    const rows = await this.prisma.user.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, trailDone: true, role: { select: { name: true } } } })
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.role.name, done: r.trailDone }))
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
