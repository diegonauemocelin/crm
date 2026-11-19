import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import { assertCan } from './acesso'
import { CteService } from './cte.service'
import { summarize } from './gerencial'
import { FretesRelatoriosService } from './relatorios.service'
import { cleanWeeklyFreight, DEFAULT_WEEKLY_FREIGHT, spNow, WEEKLY_FREIGHT_KEY, WEEKLY_FREIGHT_LOG_KEY, weeklyDue, weeklyFreightEmail, weeklyPeriod, type WeeklyFreightConfig } from './resumo-semanal'

const TICK_MS = 5 * 60_000

/**
 * Resumo semanal dos fretes por e-mail (Relatórios de frete › Resumo semanal): no dia e hora escolhidos, os CT-es dos 7
 * dias anteriores vão para os e-mails cadastrados (direção, financeiro, expedição). Uma vez por semana, pelo SMTP da empresa.
 */
@Injectable()
export class FretesResumoSemanalService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('FretesResumoSemanal')
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly reports: FretesRelatoriosService,
    private readonly ctes: CteService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async config(user: AuthUser) {
    assertCan(user, 'fretes_cte', 'view')
    const [cfg, log] = await Promise.all([this.load(user.tenantId), this.settings.get<{ date?: string; at?: string; error?: string }>(user.tenantId, WEEKLY_FREIGHT_LOG_KEY, {})])
    return { ...cfg, lastSent: log.at ?? null, lastError: log.error ?? null }
  }

  async save(user: AuthUser, raw: unknown, ctx: RequestCtx) {
    assertCan(user, 'fretes_cte', 'edit')
    const cfg = cleanWeeklyFreight(raw)
    if (cfg.active && !cfg.emails.length) throw new BadRequestException('Informe ao menos um e-mail para receber o resumo.')
    await this.settings.set(user.tenantId, WEEKLY_FREIGHT_KEY, cfg)
    await this.audit.byUser(user, ctx, 'frete.resumo_semanal.alterado', 'settings', WEEKLY_FREIGHT_KEY, { ativo: cfg.active, dia: cfg.weekday, hora: cfg.hour, emails: cfg.emails.length })
    return this.config(user)
  }

  /** Envia agora (para conferir): o resumo dos 7 dias anteriores a hoje, para os e-mails cadastrados. */
  async sendNow(user: AuthUser, ctx: RequestCtx) {
    assertCan(user, 'fretes_cte', 'edit')
    const cfg = await this.load(user.tenantId)
    if (!cfg.emails.length) throw new BadRequestException('Cadastre e salve ao menos um e-mail antes de enviar.')
    const r = await this.send(user.tenantId, cfg, spNow(new Date()).date)
    await this.audit.byUser(user, ctx, 'frete.resumo_semanal.enviado', 'settings', WEEKLY_FREIGHT_KEY, { emails: cfg.emails.length, manual: true })
    return r
  }

  private async load(tenantId: string): Promise<WeeklyFreightConfig> {
    return cleanWeeklyFreight(await this.settings.get(tenantId, WEEKLY_FREIGHT_KEY, DEFAULT_WEEKLY_FREIGHT))
  }

  private async send(tenantId: string, cfg: WeeklyFreightConfig, date: string) {
    const { from, to } = weeklyPeriod(date)
    const start = new Date(`${from}T00:00:00-03:00`)
    const end = new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86_400_000)
    const where = Prisma.sql`c."tenantId" = ${tenantId}::uuid AND c."fiscalStatus" <> 'CANCELADO' AND COALESCE(c."issuedAt", c."createdAt") >= ${start} AND COALESCE(c."issuedAt", c."createdAt") < ${end} ${cfg.unitId ? Prisma.sql`AND c."unitId" = ${cfg.unitId}::uuid` : Prisma.empty}`
    const [facts, rec, branding, unit] = await Promise.all([
      this.reports.facts(where),
      this.ctes.recSettings(tenantId),
      this.settings.branding(tenantId),
      cfg.unitId ? this.prisma.unit.findFirst({ where: { id: cfg.unitId, tenantId }, select: { name: true } }) : null,
    ])
    const brand = branding.brandColor || branding.primaryColor
    const m = weeklyFreightEmail(summarize(facts, rec.nfeValor), { from, to, appName: branding.appName, unitName: unit?.name ?? null, link: `${env.appUrl}/fretes/relatorios`, color: /^#[0-9a-f]{6}$/i.test(brand) ? brand : '#1d4ed8' })
    await this.mail.send(tenantId, { to: cfg.emails.join(', '), subject: m.subject, html: m.html, text: m.text })
    await this.settings.set(tenantId, WEEKLY_FREIGHT_LOG_KEY, { date, at: new Date().toISOString(), error: null })
    return { sent: cfg.emails.length, from, to, ctes: facts.length }
  }

  async tick() {
    if (this.running) return
    this.running = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: WEEKLY_FREIGHT_KEY }, select: { tenantId: true } })
      for (const { tenantId } of rows) {
        const cfg = await this.load(tenantId)
        const log = await this.settings.get<{ date?: string }>(tenantId, WEEKLY_FREIGHT_LOG_KEY, {})
        const today = spNow(new Date()).date
        if (!weeklyDue(cfg, new Date(), log.date)) continue
        await this.send(tenantId, cfg, today).catch(async (err: unknown) => {
          // Marca o dia para não repetir a cada volta; o erro aparece na tela.
          this.logger.warn(`Resumo semanal de fretes não enviado: ${(err as Error).message}`)
          await this.settings.set(tenantId, WEEKLY_FREIGHT_LOG_KEY, { date: today, at: null, error: (err as Error).message.slice(0, 300) })
        })
      }
    } catch (err) {
      this.logger.error(`Resumo semanal de fretes: ${(err as Error).message}`)
    } finally {
      this.running = false
    }
  }
}
