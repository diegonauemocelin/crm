import { Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import { deviceOf, maskIp } from './dispositivo'

const DAY = 86_400_000
/** Aparelho já usado nos últimos N dias não gera aviso de "acesso novo". */
const KNOWN_DEVICE_DAYS = 180

export type SecurityAlert = 'novo_dispositivo' | 'conta_bloqueada' | 'senha_alterada' | 'senha_redefinida' | '2fa_desativado' | '2fa_reconfigurado' | '2fa_zerado' | 'codigo_recuperacao'

const ALERT_TEXT: Record<SecurityAlert, { subject: string; body: string }> = {
  novo_dispositivo: { subject: 'Novo acesso à sua conta', body: 'Sua conta foi acessada por um aparelho ou navegador que não usava antes.' },
  conta_bloqueada: { subject: 'Sua conta foi bloqueada temporariamente', body: 'Houve várias tentativas erradas de entrar na sua conta, e ela foi bloqueada por alguns minutos.' },
  senha_alterada: { subject: 'Sua senha foi alterada', body: 'A senha da sua conta foi trocada, e os outros aparelhos foram desconectados.' },
  senha_redefinida: { subject: 'Sua senha foi redefinida', body: 'A senha da sua conta foi redefinida pelo link de recuperação, e todos os aparelhos foram desconectados.' },
  '2fa_desativado': { subject: 'Verificação em duas etapas desativada', body: 'A verificação em duas etapas (2FA) da sua conta foi desativada.' },
  '2fa_reconfigurado': { subject: 'Verificação em duas etapas reconfigurada', body: 'A verificação em duas etapas (2FA) da sua conta foi ligada a um novo aplicativo autenticador, e os códigos de recuperação antigos deixaram de valer.' },
  '2fa_zerado': { subject: 'Verificação em duas etapas zerada por um administrador', body: 'Um administrador zerou a verificação em duas etapas da sua conta. No próximo acesso você vai configurá-la de novo.' },
  codigo_recuperacao: { subject: 'Código de recuperação usado', body: 'Um dos seus códigos de recuperação do 2FA foi usado para entrar na sua conta.' },
}

/**
 * Segurança da conta: sessões por aparelho, avisos por e-mail e limpeza das sessões vencidas.
 * Os avisos nunca impedem a ação (falha no e-mail só vai para o log).
 */
@Injectable()
export class SecurityService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SecurityService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.cleanup(), DAY)
    this.timer.unref()
    setTimeout(() => void this.cleanup(), 120_000).unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  /** Apaga sessões vencidas há mais de 1 dia. As ainda válidas ficam (inclusive as trocadas, que detectam roubo de token). */
  async cleanup() {
    try {
      const r = await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - DAY) } } })
      if (r.count) this.logger.log(`${r.count} registro(s) de sessão vencida apagado(s).`)
    } catch (err) {
      this.logger.error(`Falha na limpeza de sessões: ${(err as Error).message}`)
    }
  }

  // ---------- Sessões por aparelho ----------

  /** Sessões abertas do usuário (uma por login), da mais recente para a mais antiga. */
  async sessions(userId: string, currentFamilyId?: string) {
    const now = new Date()
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, createdAt: true, replacedAt: true, ip: true, userAgent: true },
    })
    const starts = await this.prisma.refreshToken.groupBy({
      by: ['familyId'],
      where: { userId, familyId: { in: [...new Set(tokens.map((t) => t.familyId))] } },
      _min: { createdAt: true },
    })
    const startOf = new Map(starts.map((s) => [s.familyId, s._min.createdAt]))
    const seen = new Set<string>()
    const out = []
    for (const t of tokens) {
      // O token mais novo de cada sessão é o que vale; sessão só com tokens trocados já foi renovada em outro.
      if (seen.has(t.familyId) || t.replacedAt) continue
      seen.add(t.familyId)
      const d = deviceOf(t.userAgent)
      out.push({ id: t.familyId, device: d.label, browser: d.browser, system: d.system, ip: t.ip, startedAt: startOf.get(t.familyId) ?? t.createdAt, lastSeenAt: t.createdAt, current: t.familyId === currentFamilyId })
    }
    return out
  }

  async revokeSession(user: AuthUser, familyId: string, ctx: RequestCtx) {
    const r = await this.prisma.refreshToken.updateMany({ where: { userId: user.id, familyId, revokedAt: null }, data: { revokedAt: new Date() } })
    if (!r.count) throw new NotFoundException('Sessão não encontrada ou já encerrada.')
    await this.audit.byUser(user, ctx, 'me.session_revoked', 'session', familyId, { atual: familyId === user.familyId })
    return { ok: true }
  }

  async revokeOthers(user: AuthUser, ctx: RequestCtx) {
    const r = await this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null, NOT: { familyId: user.familyId } }, data: { revokedAt: new Date() } })
    await this.audit.byUser(user, ctx, 'me.sessions_revoked_others', 'user', user.id, { sessoes: r.count })
    return { ok: true }
  }

  // ---------- Avisos por e-mail ----------

  /** Antes de abrir a sessão: o aparelho já foi usado? (primeiro acesso da conta não conta como "novo"). */
  async isNewDevice(userId: string, userAgent: string | null | undefined) {
    const key = deviceOf(userAgent).key
    const previous = await this.prisma.refreshToken.findMany({
      where: { userId, createdAt: { gt: new Date(Date.now() - KNOWN_DEVICE_DAYS * DAY) } },
      distinct: ['userAgent'],
      select: { userAgent: true },
      take: 200,
    })
    if (previous.length === 0) return (await this.prisma.refreshToken.count({ where: { userId } })) > 0
    return !previous.some((p) => deviceOf(p.userAgent).key === key)
  }

  /** Envia o aviso em segundo plano. */
  alert(userId: string, kind: SecurityAlert, ctx: Partial<RequestCtx>) {
    void this.send(userId, kind, ctx).catch((err: unknown) => this.logger.warn(`Aviso de segurança (${kind}) não enviado: ${(err as Error).message}`))
  }

  private async send(userId: string, kind: SecurityAlert, ctx: Partial<RequestCtx>) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true, email: true, name: true, active: true } })
    if (!user?.active) return
    const branding = await this.settings.branding(user.tenantId)
    const text = ALERT_TEXT[kind]
    const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date())
    const details = `${when} · ${deviceOf(ctx.userAgent).label} · IP ${maskIp(ctx.ip)}`
    const advice = 'Se foi você, não precisa fazer nada. Se não foi, troque a senha agora e, em Meu perfil → Aparelhos conectados, desconecte os aparelhos que não reconhece.'
    const link = `${env.appUrl}/meu-perfil`
    await this.mail.send(user.tenantId, {
      to: user.email,
      subject: `${text.subject} - ${branding.appName}`,
      text: `Olá, ${user.name}.\n\n${text.body}\n\n${details}\n\n${advice}\n\n${link}`,
      html: this.mail.simpleTemplate(branding, {
        title: text.subject,
        greeting: `Olá, ${user.name}.`,
        body: `${text.body} (${details}). ${advice}`,
        buttonLabel: 'Ver minha conta',
        buttonUrl: link,
        footnote: 'Este é um aviso automático de segurança. Nunca pedimos sua senha ou código por e-mail ou WhatsApp.',
      }),
    })
  }
}
