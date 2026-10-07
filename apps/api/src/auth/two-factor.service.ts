import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt, sha256 } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { verifyPassword } from './password'
import { checkTotp, newTotpSecret, totpQrCode } from './totp'

// Sem caracteres ambíguos (0/o, 1/l/i) para facilitar a digitação.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function newRecoveryCodes(): string[] {
  return Array.from({ length: 8 }, () =>
    Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join(''),
  )
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async setup(user: AuthUser) {
    // Reabrir a tela (recarregar, voltar do app autenticador) mostra a MESMA chave ainda não confirmada.
    // Antes, cada abertura gerava uma chave nova e o QR já escaneado deixava de valer ("código inválido").
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpPendingSecretEnc: true } })
    let secret: string | null = null
    if (row.totpPendingSecretEnc) {
      try {
        secret = decrypt(row.totpPendingSecretEnc)
      } catch {
        secret = null
      }
    }
    if (!secret) {
      secret = newTotpSecret()
      await this.prisma.user.update({ where: { id: user.id }, data: { totpPendingSecretEnc: encrypt(secret) } })
    }
    const branding = await this.settings.branding(user.tenantId)
    const { uri, qrDataUrl } = await totpQrCode(secret, branding.appName, user.email)
    return { secret, uri, qrDataUrl }
  }

  async enable(user: AuthUser, code: string, ctx: RequestCtx) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    if (!row.totpPendingSecretEnc) throw new BadRequestException('Inicie a configuração do 2FA primeiro.')
    const secret = decrypt(row.totpPendingSecretEnc)
    const totp = await checkTotp(secret, code.trim(), null)
    if (totp === null) throw new BadRequestException('Código inválido. Confira o horário do celular e tente novamente.')

    const codes = newRecoveryCodes()
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId: user.id, codeHash: sha256(c) })) }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { totpSecretEnc: row.totpPendingSecretEnc, totpPendingSecretEnc: null, totpEnabled: true, totpLastStep: totp.step },
      }),
    ])
    await this.audit.byUser(user, ctx, 'auth.2fa_enabled', 'user', user.id)
    return { recoveryCodes: codes }
  }

  async disable(user: AuthUser, password: string, ctx: RequestCtx) {
    if (user.role.require2fa) throw new ForbiddenException('Seu perfil de acesso exige 2FA. Ele não pode ser desativado.')
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    if (!(await verifyPassword(row.passwordHash, password))) throw new BadRequestException('Senha incorreta.')
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { totpEnabled: false, totpSecretEnc: null, totpPendingSecretEnc: null, totpLastStep: null },
      }),
    ])
    await this.audit.byUser(user, ctx, 'auth.2fa_disabled', 'user', user.id)
  }

  /** Administrador zera o 2FA de outro usuário (ex.: perdeu o celular). No próximo login ele configura de novo. */
  async resetForUser(admin: AuthUser, userId: string, ctx: RequestCtx) {
    const target = await this.prisma.user.findFirst({ where: { id: userId, tenantId: admin.tenantId } })
    if (!target) throw new BadRequestException('Usuário não encontrado.')
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { totpEnabled: false, totpSecretEnc: null, totpPendingSecretEnc: null, totpLastStep: null },
      }),
    ])
    await this.audit.byUser(admin, ctx, 'user.2fa_reset', 'user', userId, { email: target.email })
  }
}
