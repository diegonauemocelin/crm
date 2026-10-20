import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import { cleanSchedule, DEFAULT_REPORTS, describeFrequency, isDue, MAX_SCHEDULES, nextRun, REPORT_PERIODS, REPORT_SECTIONS, type ReportSchedule, type ReportsState, REPORTS_KEY, reportPeriod } from './config'
import { reportHtml, reportText } from './relatorio-email'
import { MarketingService } from './marketing.service'

const TICK_MS = 5 * 60_000
const MAX_RUNS = 50

/** Relatórios do Marketing Inteligente por e-mail: quem recebe, quando e o que vai em cada um. */
@Injectable()
export class MarketingReportsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketingReportsService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly marketing: MarketingService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  state(tenantId: string) {
    return this.settings.get<ReportsState>(tenantId, REPORTS_KEY, DEFAULT_REPORTS)
  }

  async view(user: AuthUser) {
    const s = await this.state(user.tenantId)
    const now = Date.now()
    return {
      schedules: s.schedules.map((x) => ({ ...x, when: describeFrequency(x), nextAt: x.active ? new Date(nextRun(x, Math.max(now, x.lastSentAt ? Date.parse(x.lastSentAt) : 0)) ?? 0).toISOString() : null })),
      runs: s.runs,
      sections: REPORT_SECTIONS,
      periods: REPORT_PERIODS,
      smtpReady: await this.smtpReady(user.tenantId),
    }
  }

  private async smtpReady(tenantId: string) {
    const smtp = await this.settings.get<{ host?: string; fromEmail?: string }>(tenantId, 'smtp', {})
    return !!(smtp.host && smtp.fromEmail)
  }

  async save(user: AuthUser, id: string | null, input: Partial<ReportSchedule>, ctx: RequestCtx) {
    const s = await this.state(user.tenantId)
    const prev = id ? s.schedules.find((x) => x.id === id) : null
    if (id && !prev) throw new NotFoundException('Relatório não encontrado.')
    if (!id && s.schedules.length >= MAX_SCHEDULES) throw new BadRequestException(`No máximo ${MAX_SCHEDULES} relatórios agendados.`)
    const next = cleanSchedule(input, prev ?? null, id ?? randomUUID(), user.id)
    if ('error' in next) throw new BadRequestException(next.error)
    const schedules = prev ? s.schedules.map((x) => (x.id === next.id ? next : x)) : [...s.schedules, next]
    await this.settings.set(user.tenantId, REPORTS_KEY, { ...s, schedules })
    await this.audit.byUser(user, ctx, prev ? 'marketing.report_updated' : 'marketing.report_created', 'settings', next.id, {
      nome: next.name,
      ativo: next.active,
      destinatarios: next.emails.length,
      frequencia: describeFrequency(next),
      conteudo: next.sections,
    })
    return next
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    const s = await this.state(user.tenantId)
    const prev = s.schedules.find((x) => x.id === id)
    if (!prev) throw new NotFoundException('Relatório não encontrado.')
    await this.settings.set(user.tenantId, REPORTS_KEY, { ...s, schedules: s.schedules.filter((x) => x.id !== id) })
    await this.audit.byUser(user, ctx, 'marketing.report_removed', 'settings', id, { nome: prev.name })
    return { ok: true }
  }

  /** Envia agora (botão "Enviar agora"): mesmo conteúdo do agendado, para os mesmos destinatários. */
  async sendNow(user: AuthUser, id: string, ctx: RequestCtx) {
    const s = await this.state(user.tenantId)
    const sch = s.schedules.find((x) => x.id === id)
    if (!sch) throw new NotFoundException('Relatório não encontrado.')
    if (!(await this.smtpReady(user.tenantId))) throw new BadRequestException('Configure o servidor de e-mail (Configurações › Servidor de e-mail) antes de enviar relatórios.')
    const run = await this.send(user.tenantId, sch, Date.now(), true)
    await this.audit.byUser(user, ctx, 'marketing.report_sent', 'settings', id, { nome: sch.name, ok: run.ok, destinatarios: run.to })
    if (!run.ok) throw new BadRequestException(run.message)
    return run
  }

  /** Prévia do e-mail na tela (mesmo HTML que vai no envio). */
  async preview(user: AuthUser, input: Partial<ReportSchedule>) {
    const sch = cleanSchedule({ ...input, emails: input.emails?.length ? input.emails : ['previa@exemplo.com.br'], name: input.name || 'Prévia' }, null, 'previa', user.id)
    if ('error' in sch) throw new BadRequestException(sch.error)
    return { html: await this.build(user.tenantId, sch, Date.now()).then((b) => b.html) }
  }

  private async build(tenantId: string, sch: ReportSchedule, now: number) {
    const period = reportPeriod(sch.period, now)
    const [data, email, health, branding] = await Promise.all([
      this.marketing.analyze(tenantId, { ...period, filters: sch.filters }, now),
      sch.sections.includes('email') ? this.marketing.email(tenantId, period) : Promise.resolve(null),
      sch.sections.includes('saude') ? this.marketing.health(tenantId) : Promise.resolve(null),
      this.settings.branding(tenantId),
    ])
    const periodLabel = REPORT_PERIODS.find((p) => p.key === sch.period)?.label ?? ''
    const link = `${env.appUrl}/marketing/executivo?de=${period.from}&ate=${period.to}`
    const input = { schedule: sch, periodLabel, data, email, health, branding, link }
    return { html: reportHtml(input), text: reportText(input), subject: `${sch.name}: ${fmt(period.from)}${period.from === period.to ? '' : ` a ${fmt(period.to)}`}` }
  }

  private async send(tenantId: string, sch: ReportSchedule, now: number, manual: boolean) {
    let ok = true
    let message = ''
    let sentTo = 0
    try {
      const b = await this.build(tenantId, sch, now)
      for (const to of sch.emails) {
        try {
          await this.mail.send(tenantId, { to, subject: b.subject, html: b.html, text: b.text })
          sentTo++
        } catch (err) {
          ok = false
          message = `Falha ao enviar para ${to}: ${(err as Error).message}`.slice(0, 300)
        }
      }
      if (ok) message = `Enviado para ${sentTo} destinatário(s).`
    } catch (err) {
      ok = false
      message = `Não foi possível montar o relatório: ${(err as Error).message}`.slice(0, 300)
    }
    const run = { at: new Date(now).toISOString(), scheduleId: sch.id, name: sch.name, ok: ok && sentTo > 0, to: sentTo, message, manual }
    // Relê antes de gravar: alguém pode ter mudado o agendamento enquanto o e-mail era montado.
    const s = await this.state(tenantId)
    await this.settings.set(tenantId, REPORTS_KEY, {
      schedules: s.schedules.map((x) => (x.id === sch.id ? { ...x, ...(manual ? {} : { lastSentAt: run.at }), lastError: run.ok ? null : message } : x)),
      runs: [run, ...s.runs].slice(0, MAX_RUNS),
    })
    return run
  }

  /** A cada 5 minutos: manda os relatórios cuja hora chegou (um de cada vez, para não pesar no servidor). */
  async tick(now = Date.now()) {
    if (this.running) return
    this.running = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: REPORTS_KEY }, select: { tenantId: true, value: true } })
      for (const row of rows) {
        const s = { ...DEFAULT_REPORTS, ...((row.value as Partial<ReportsState> | null) ?? {}) }
        const due = s.schedules.filter((x) => isDue(x, now))
        if (!due.length) continue
        if (!(await this.smtpReady(row.tenantId))) continue
        for (const sch of due) {
          const run = await this.send(row.tenantId, sch, now, false)
          if (!run.ok) this.logger.warn(`Relatório "${sch.name}": ${run.message}`)
        }
      }
    } catch (err) {
      this.logger.error(`Relatórios do marketing: ${(err as Error).message}`)
    } finally {
      this.running = false
    }
  }
}

const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
