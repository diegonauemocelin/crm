import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { env } from '../config/env'
import { decrypt, randomToken, sha256 } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { PrismaService } from '../prisma/prisma.service'
import { TenantService } from '../prisma/prisma.module'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import { dummyVerify, hashPassword, needsRehash, passwordProblems, verifyPassword } from './password'
import { checkTotp } from './totp'

export const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = [15, 60, 240]
const GENERIC_LOGIN_ERROR = 'E-mail ou senha inválidos.'

export interface AccessPayload {
  sub: string
  tid: string
  fam: string
  p2fa: boolean
}

interface MfaPayload {
  sub: string
  purpose: 'mfa'
}

export type LoginResult =
  | { status: 'ok' | 'mfa_setup_required'; accessToken: string; refreshToken: string }
  | { status: 'mfa_required'; mfaToken: string }

/** Tempo de bloqueio cresce a cada nova rodada de 5 tentativas erradas. */
export function lockDurationMinutes(failedLogins: number): number | null {
  if (failedLogins < MAX_FAILED_LOGINS) return null
  const round = Math.floor(failedLogins / MAX_FAILED_LOGINS) - 1
  return LOCK_MINUTES[Math.min(round, LOCK_MINUTES.length - 1)]!
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly tenants: TenantService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  async login(emailRaw: string, password: string, ctx: RequestCtx): Promise<LoginResult> {
    const email = emailRaw.trim().toLowerCase()
    const tenantId = await this.tenants.defaultId()
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      include: { role: true },
    })

    if (!user) {
      await dummyVerify(password)
      await this.audit.log({ tenantId, userEmail: email, action: 'auth.login_failed', ...ctx, data: { reason: 'usuario_inexistente' } })
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR)
    }

    this.assertNotLocked(user.lockedUntil)

    const valid = await verifyPassword(user.passwordHash, password)
    if (!valid) {
      await this.registerFailure(user.id, user.tenantId, user.email, user.failedLogins, ctx, 'senha_incorreta')
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR)
    }

    if (!user.active || !user.role.active) {
      await this.audit.log({ tenantId, userId: user.id, userEmail: email, action: 'auth.login_failed', ...ctx, data: { reason: 'usuario_inativo' } })
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR)
    }

    if (needsRehash(user.passwordHash)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
    }

    if (user.totpEnabled) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } })
      const mfaToken = await this.jwt.signAsync({ sub: user.id, purpose: 'mfa' } satisfies MfaPayload, { expiresIn: 300 })
      return { status: 'mfa_required', mfaToken }
    }

    const session = await this.startSession(user.id, user.tenantId, user.email, ctx, 'auth.login')
    const pending = user.role.require2fa
    return { status: pending ? 'mfa_setup_required' : 'ok', ...session }
  }

  async verifyMfa(mfaToken: string | undefined, code: string, ctx: RequestCtx) {
    if (!mfaToken) throw new UnauthorizedException('Sessão de verificação expirada. Faça login novamente.')
    let payload: MfaPayload
    try {
      payload = await this.jwt.verifyAsync<MfaPayload>(mfaToken, { algorithms: ['HS256'] })
    } catch {
      throw new UnauthorizedException('Sessão de verificação expirada. Faça login novamente.')
    }
    if (payload.purpose !== 'mfa') throw new UnauthorizedException()

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } })
    if (!user || !user.active || !user.totpEnabled || !user.totpSecretEnc) throw new UnauthorizedException()
    this.assertNotLocked(user.lockedUntil)

    const normalized = code.replace(/\s|-/g, '')
    const step = await checkTotp(decrypt(user.totpSecretEnc), normalized, user.totpLastStep)
    let usedRecovery = false
    if (step === null) {
      usedRecovery = await this.consumeRecoveryCode(user.id, normalized)
      if (!usedRecovery) {
        await this.registerFailure(user.id, user.tenantId, user.email, user.failedLogins, ctx, 'codigo_2fa_incorreto')
        throw new UnauthorizedException('Código inválido.')
      }
    }

    if (step !== null) await this.prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } })
    const session = await this.startSession(user.id, user.tenantId, user.email, ctx, usedRecovery ? 'auth.login_recovery_code' : 'auth.login')
    return { status: 'ok' as const, ...session }
  }

  async refresh(refreshToken: string | undefined, ctx: RequestCtx) {
    if (!refreshToken) throw new UnauthorizedException()
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { include: { role: true } } },
    })
    if (!stored) throw new UnauthorizedException()

    // Token já trocado ou revogado sendo reapresentado: indício de roubo. Derruba a sessão inteira.
    if (stored.revokedAt || stored.replacedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } })
      await this.audit.log({
        tenantId: stored.user.tenantId,
        userId: stored.userId,
        userEmail: stored.user.email,
        action: 'auth.refresh_reuse_detected',
        ...ctx,
      })
      throw new UnauthorizedException()
    }
    if (stored.expiresAt < new Date() || !stored.user.active || !stored.user.role.active) throw new UnauthorizedException()

    const newToken = randomToken()
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({ where: { id: stored.id }, data: { replacedAt: new Date() } }),
      this.prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          familyId: stored.familyId,
          tokenHash: sha256(newToken),
          expiresAt: new Date(Date.now() + env.refreshTokenTtlSec * 1000),
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
      }),
    ])
    const pending = stored.user.role.require2fa && !stored.user.totpEnabled
    const accessToken = await this.signAccess({ sub: stored.userId, tid: stored.user.tenantId, fam: stored.familyId, p2fa: pending })
    return { accessToken, refreshToken: newToken }
  }

  async logout(refreshToken: string | undefined, familyId: string | undefined, ctx: RequestCtx) {
    let family = familyId
    if (!family && refreshToken) {
      family = (await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } }))?.familyId
    }
    if (!family) return
    const token = await this.prisma.refreshToken.findFirst({ where: { familyId: family }, include: { user: true } })
    await this.prisma.refreshToken.updateMany({ where: { familyId: family, revokedAt: null }, data: { revokedAt: new Date() } })
    if (token) {
      await this.audit.log({ tenantId: token.user.tenantId, userId: token.userId, userEmail: token.user.email, action: 'auth.logout', ...ctx })
    }
  }

  async revokeAllSessions(userId: string, exceptFamilyId?: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, ...(exceptFamilyId ? { NOT: { familyId: exceptFamilyId } } : {}) },
      data: { revokedAt: new Date() },
    })
  }

  /** Sempre responde igual, exista ou não o e-mail, para não permitir descobrir contas. */
  async requestPasswordReset(emailRaw: string, ctx: RequestCtx) {
    const email = emailRaw.trim().toLowerCase()
    const tenantId = await this.tenants.defaultId()
    const user = await this.prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } })
    await this.audit.log({ tenantId, userId: user?.id, userEmail: email, action: 'auth.password_reset_requested', ...ctx })
    if (!user || !user.active) return
    await this.sendPasswordLink(user.id, user.tenantId, user.email, user.name, 'reset')
  }

  /** Envia link de definição de senha (convite de novo usuário ou recuperação). */
  async sendPasswordLink(userId: string, tenantId: string, email: string, name: string, kind: 'reset' | 'invite') {
    const token = randomToken()
    const ttlHours = kind === 'invite' ? 72 : 1
    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlHours * 3600_000) },
    })
    const branding = await this.settings.branding(tenantId)
    const link = `${env.appUrl}/redefinir-senha?token=${encodeURIComponent(token)}`
    const title = kind === 'invite' ? `Seu acesso ao ${branding.appName}` : `Redefinição de senha - ${branding.appName}`
    const intro =
      kind === 'invite'
        ? `Você recebeu acesso ao ${branding.appName}. Clique no botão abaixo para criar sua senha.`
        : 'Recebemos um pedido para redefinir sua senha. Se não foi você, ignore este e-mail.'
    try {
      await this.mail.send(tenantId, {
        to: email,
        subject: title,
        text: `Olá, ${name}.\n\n${intro}\n\n${link}\n\nO link expira em ${ttlHours} hora(s).`,
        html: this.mail.simpleTemplate(branding, {
          title,
          greeting: `Olá, ${name}.`,
          body: intro,
          buttonLabel: kind === 'invite' ? 'Criar minha senha' : 'Redefinir senha',
          buttonUrl: link,
          footnote: `O link expira em ${ttlHours} hora(s).`,
        }),
      })
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail de senha para ${email}: ${(err as Error).message}`)
      if (kind === 'invite') throw err
    }
  }

  async resetPassword(token: string, password: string, ctx: RequestCtx) {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    })
    if (!stored || stored.usedAt || stored.expiresAt < new Date() || !stored.user.active) {
      throw new HttpException('Link inválido ou expirado. Solicite um novo.', HttpStatus.BAD_REQUEST)
    }
    const problem = passwordProblems(password, stored.user.email)
    if (problem) throw new HttpException(problem, HttpStatus.BAD_REQUEST)

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: stored.userId },
        data: {
          passwordHash: await hashPassword(password),
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLogins: 0,
          lockedUntil: null,
        },
      }),
    ])
    await this.revokeAllSessions(stored.userId)
    await this.audit.log({
      tenantId: stored.user.tenantId,
      userId: stored.userId,
      userEmail: stored.user.email,
      action: 'auth.password_reset',
      ...ctx,
    })
  }

  signAccess(payload: AccessPayload) {
    return this.jwt.signAsync(payload, { expiresIn: env.accessTokenTtlSec })
  }

  private async startSession(userId: string, tenantId: string, email: string, ctx: RequestCtx, action: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ctx.ip },
      include: { role: true },
    })
    const familyId = randomUUID()
    const refreshToken = randomToken()
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + env.refreshTokenTtlSec * 1000),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    })
    const pending = user.role.require2fa && !user.totpEnabled
    const accessToken = await this.signAccess({ sub: userId, tid: tenantId, fam: familyId, p2fa: pending })
    await this.audit.log({ tenantId, userId, userEmail: email, action, ...ctx })
    return { accessToken, refreshToken }
  }

  private assertNotLocked(lockedUntil: Date | null) {
    if (lockedUntil && lockedUntil > new Date()) {
      const minutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000)
      throw new HttpException(
        `Acesso temporariamente bloqueado por excesso de tentativas. Tente novamente em ${minutes} minuto(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  private async registerFailure(userId: string, tenantId: string, email: string, previous: number, ctx: RequestCtx, reason: string) {
    const failedLogins = previous + 1
    const lockMinutes = failedLogins % MAX_FAILED_LOGINS === 0 ? lockDurationMinutes(failedLogins) : null
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLogins, ...(lockMinutes ? { lockedUntil: new Date(Date.now() + lockMinutes * 60_000) } : {}) },
    })
    await this.audit.log({
      tenantId,
      userId,
      userEmail: email,
      action: lockMinutes ? 'auth.account_locked' : 'auth.login_failed',
      ...ctx,
      data: { reason, failedLogins, ...(lockMinutes ? { lockMinutes } : {}) },
    })
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    if (!/^[a-z0-9]{10}$/i.test(code)) return false
    const codes = await this.prisma.recoveryCode.findMany({ where: { userId, usedAt: null } })
    const hash = sha256(code.toLowerCase())
    const match = codes.find((c) => c.codeHash === hash)
    if (!match) return false
    await this.prisma.recoveryCode.update({ where: { id: match.id }, data: { usedAt: new Date() } })
    return true
  }
}
