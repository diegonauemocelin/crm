import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from './auth.service'
import { deviceNameOf, PASSKEY_MAX } from './passkey'

/** Desafio de cada pedido (vale 5 minutos e só uma vez). */
interface Pending {
  challenge: string
  userId: string | null
  expiresAt: number
}
const TTL_MS = 5 * 60_000

/**
 * Entrar com Face ID, Touch ID ou a digital (chave de acesso / passkey, padrão WebAuthn): a pessoa ativa no aparelho
 * já logada (com senha) e, depois, entra só com a biometria. A chave privada fica no aparelho; o servidor guarda a
 * pública e confere cada entrada (desafio de uso único, origem do CRM e verificação do usuário obrigatória).
 */
@Injectable()
export class PasskeyService {
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  private get rpID() {
    return new URL(env.appUrl).hostname
  }

  private remember(p: Omit<Pending, 'expiresAt'>) {
    const now = Date.now()
    for (const [k, v] of this.pending) if (v.expiresAt < now) this.pending.delete(k)
    const handle = randomBytes(24).toString('base64url')
    this.pending.set(handle, { ...p, expiresAt: now + TTL_MS })
    return handle
  }

  private take(handle: string | undefined) {
    const p = handle ? this.pending.get(handle) : undefined
    if (handle) this.pending.delete(handle)
    if (!p || p.expiresAt < Date.now()) throw new BadRequestException('O pedido venceu. Tente de novo.')
    return p
  }

  async list(user: AuthUser) {
    const rows = await this.prisma.passkey.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true } })
    return rows
  }

  /** Passo 1 do cadastro: opções para o aparelho criar a chave (já logado). */
  async registerOptions(user: AuthUser) {
    const existing = await this.prisma.passkey.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } })
    if (existing.length >= PASSKEY_MAX) throw new BadRequestException(`No máximo ${PASSKEY_MAX} aparelhos. Remova um antes.`)
    const options = await generateRegistrationOptions({
      rpName: 'CRM',
      rpID: this.rpID,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
    })
    return { options, handle: this.remember({ challenge: options.challenge, userId: user.id }) }
  }

  /** Passo 2 do cadastro: confere a resposta do aparelho e guarda a chave pública. */
  async registerVerify(user: AuthUser, handle: string, response: RegistrationResponseJSON, ctx: RequestCtx) {
    const p = this.take(handle)
    if (p.userId !== user.id) throw new BadRequestException('O pedido não é seu. Tente de novo.')
    let info
    try {
      const r = await verifyRegistrationResponse({ response, expectedChallenge: p.challenge, expectedOrigin: env.appUrl, expectedRPID: this.rpID, requireUserVerification: true })
      if (!r.verified || !r.registrationInfo) throw new Error('não confirmada')
      info = r.registrationInfo
    } catch (e) {
      throw new BadRequestException(`O aparelho não confirmou a chave (${(e as Error).message}). Tente de novo.`)
    }
    const c = info.credential
    await this.prisma.passkey.create({
      data: { tenantId: user.tenantId, userId: user.id, credentialId: c.id, publicKey: Buffer.from(c.publicKey), counter: BigInt(c.counter), transports: c.transports ?? [], deviceName: deviceNameOf(ctx.userAgent) },
    })
    await this.audit.byUser(user, ctx, 'auth.passkey_criada', 'user', user.id, { aparelho: deviceNameOf(ctx.userAgent) })
    return { ok: true }
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    const p = await this.prisma.passkey.findFirst({ where: { id, userId: user.id } })
    if (!p) throw new NotFoundException('Aparelho não encontrado.')
    await this.prisma.passkey.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'auth.passkey_removida', 'user', user.id, { aparelho: p.deviceName })
    return { ok: true }
  }

  /** Entrar, passo 1: desafio para o aparelho (a chave é escolhida pelo próprio aparelho, sem digitar o e-mail). */
  async loginOptions() {
    const options = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: 'required' })
    return { options, handle: this.remember({ challenge: options.challenge, userId: null }) }
  }

  /** Entrar, passo 2: confere a assinatura do aparelho e abre a sessão (as mesmas regras do login com senha). */
  async loginVerify(handle: string, response: AuthenticationResponseJSON, ctx: RequestCtx, app: boolean) {
    const p = this.take(handle)
    const key = await this.prisma.passkey.findUnique({ where: { credentialId: response.id } })
    if (!key) throw new UnauthorizedException('Este aparelho não está mais ativado. Entre com a senha e ative de novo.')
    let newCounter: number
    try {
      const r = await verifyAuthenticationResponse({
        response,
        expectedChallenge: p.challenge,
        expectedOrigin: env.appUrl,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: { id: key.credentialId, publicKey: new Uint8Array(key.publicKey), counter: Number(key.counter), transports: key.transports as AuthenticatorTransportFuture[] },
      })
      if (!r.verified) throw new Error('não confirmada')
      newCounter = r.authenticationInfo.newCounter
    } catch {
      throw new UnauthorizedException('Não foi possível confirmar pelo Face ID. Entre com a senha.')
    }
    await this.prisma.passkey.update({ where: { id: key.id }, data: { counter: BigInt(newCounter), lastUsedAt: new Date() } })
    return this.auth.passkeySession(key.userId, ctx, app)
  }
}
