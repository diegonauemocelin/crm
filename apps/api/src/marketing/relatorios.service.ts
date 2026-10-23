import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import { ChatService } from '../whatsapp/chat.service'
import { cleanSchedule, DEFAULT_REPORTS, whatsappGap, describeFrequency, isDue, MAX_SCHEDULES, nextRun, REPORT_PERIODS, REPORT_SECTIONS, type ReportSchedule, type ReportsState, REPORTS_KEY, reportPeriod } from './config'
import { reportHtml, reportText, reportWhatsapp } from './relatorio-email'
import { MarketingManagementService } from './gestao.service'
import { MarketingService } from './marketing.service'
import { MarketplacesService } from '../marketplaces/marketplaces.service'

const TICK_MS = 5 * 60_000
const MAX_RUNS = 50
const WA_LABEL = 'Relatório automático'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref())

/** Relatórios do Marketing Inteligente por e-mail e WhatsApp: quem recebe, quando e o que vai em cada um. */
@Injectable()
export class MarketingReportsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketingReportsService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false
  /** Relatórios com envio pelo WhatsApp em andamento (um celular de cada vez, com pausa). */
  private readonly waJobs = new Set<string>()
  /** Pausa entre os celulares e espera quando o número está no limite de envio; trocadas nos testes. */
  gap = () => whatsappGap()
  retryMs = 60_000

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly marketing: MarketingService,
    private readonly management: MarketingManagementService,
    private readonly chat: ChatService,
    private readonly marketplaces: MarketplacesService,
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
      whatsappNumbers: await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, status: true } }),
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
      whatsapp: next.whatsapp.length,
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
    if (sch.emails.length && !(await this.smtpReady(user.tenantId))) throw new BadRequestException('Configure o servidor de e-mail (Configurações › Servidor de e-mail) antes de enviar relatórios.')
    if (this.waJobs.has(sch.id)) throw new BadRequestException('Este relatório ainda está sendo enviado pelo WhatsApp (um celular de cada vez). Aguarde terminar.')
    const run = await this.send(user.tenantId, sch, Date.now(), true)
    await this.audit.byUser(user, ctx, 'marketing.report_sent', 'settings', id, { nome: sch.name, ok: run.ok, destinatarios: run.to })
    if (!run.ok) throw new BadRequestException(run.message)
    return run
  }

  /** Prévia do e-mail na tela (mesmo HTML que vai no envio). */
  async preview(user: AuthUser, input: Partial<ReportSchedule>) {
    const sch = cleanSchedule({ ...input, emails: input.emails?.length ? input.emails : ['previa@exemplo.com.br'], whatsapp: [], name: input.name || 'Prévia' }, null, 'previa', user.id)
    if ('error' in sch) throw new BadRequestException(sch.error)
    return { html: await this.build(user.tenantId, sch, Date.now()).then((b) => b.html) }
  }

  private async build(tenantId: string, sch: ReportSchedule, now: number) {
    const period = reportPeriod(sch.period, now)
    const [data, email, health, branding, ai, store, ml] = await Promise.all([
      this.marketing.analyze(tenantId, { ...period, filters: sch.filters }, now),
      sch.sections.includes('email') ? this.marketing.email(tenantId, period) : Promise.resolve(null),
      sch.sections.includes('saude') ? this.marketing.health(tenantId) : Promise.resolve(null),
      this.settings.branding(tenantId),
      sch.sections.includes('resumo_ia') ? this.management.aiSummary(tenantId, { ...period, filters: sch.filters }).then((r) => r.text).catch(() => null) : Promise.resolve(null),
      sch.sections.includes('loja') ? this.marketing.store(tenantId, period) : Promise.resolve(null),
      sch.sections.includes('mercado_livre') ? this.marketplaces.mercadoLivre(tenantId, period.from, period.to).catch(() => null) : Promise.resolve(null),
    ])
    const periodLabel = REPORT_PERIODS.find((p) => p.key === sch.period)?.label ?? ''
    const link = `${env.appUrl}/marketing/executivo?de=${period.from}&ate=${period.to}`
    // Logo pelo endereço público do CRM (o e-mail não carrega imagem anexada em todos os programas).
    const logoUrl = branding.logoFileId ? `${env.appUrl}/api/files/public/${branding.logoFileId}` : null
    const input = { schedule: sch, periodLabel, data, email, health, branding: { ...branding, primaryColor: branding.brandColor || branding.primaryColor, logoUrl }, link, ai, store, ml }
    const file = (format: 'pdf' | 'xlsx') => this.management.file(tenantId, format, { ...period, filters: sch.filters, sections: sch.sections.filter((x) => x !== 'resumo_ia'), title: sch.name })
    const attachments = sch.emails.length && (sch.attach === 'pdf' || sch.attach === 'xlsx') ? [await file(sch.attach)] : []
    // WhatsApp: sempre com o PDF (o resumo vai na legenda).
    const pdf = sch.whatsapp.length ? (attachments.find((a) => a.contentType === 'application/pdf') ?? (await file('pdf'))) : null
    return { html: reportHtml(input), text: reportText(input), whatsapp: reportWhatsapp(input), pdf, subject: `${sch.name}: ${fmt(period.from)}${period.from === period.to ? '' : ` a ${fmt(period.to)}`}`, attachments }
  }

  private async send(tenantId: string, sch: ReportSchedule, now: number, manual: boolean) {
    let ok = true
    let message = ''
    let sentTo = 0
    try {
      const b = await this.build(tenantId, sch, now)
      const emailReady = sch.emails.length ? await this.smtpReady(tenantId) : false
      if (sch.emails.length && !emailReady) {
        ok = false
        message = 'E-mail não enviado: configure o servidor de e-mail (Configurações › Servidor de e-mail).'
      }
      for (const to of emailReady ? sch.emails : []) {
        try {
          await this.mail.send(tenantId, { to, subject: b.subject, html: b.html, text: b.text, attachments: b.attachments })
          sentTo++
        } catch (err) {
          ok = false
          message = `Falha ao enviar para ${to}: ${(err as Error).message}`.slice(0, 300)
        }
      }
      if (ok && sch.emails.length) message = `Enviado para ${sentTo} destinatário(s).`
      if (sch.whatsapp.length && b.pdf) {
        const started = this.startWhatsapp(tenantId, sch, b.whatsapp, b.pdf, manual)
        message = [message, started ? `WhatsApp: enviando para ${sch.whatsapp.length} celular(es), um de cada vez (o resultado aparece no histórico).` : 'WhatsApp: o envio anterior ainda não terminou.'].filter(Boolean).join(' ')
        if (started && !sch.emails.length) ok = true
      }
    } catch (err) {
      ok = false
      message = `Não foi possível montar o relatório: ${(err as Error).message}`.slice(0, 300)
    }
    const run = { at: new Date(now).toISOString(), scheduleId: sch.id, name: sch.name, ok: ok && (sentTo > 0 || (!sch.emails.length && sch.whatsapp.length > 0)), to: sentTo, message, manual }
    // Relê antes de gravar: alguém pode ter mudado o agendamento enquanto o e-mail era montado.
    await this.saveRun(tenantId, sch.id, run, !manual)
    return run
  }

  private async saveRun(tenantId: string, scheduleId: string, run: ReportsState['runs'][number], sent: boolean) {
    const s = await this.state(tenantId)
    await this.settings.set(tenantId, REPORTS_KEY, {
      schedules: s.schedules.map((x) => (x.id === scheduleId ? { ...x, ...(sent ? { lastSentAt: run.at } : {}), lastError: run.ok ? null : run.message } : x)),
      runs: [run, ...s.runs].slice(0, MAX_RUNS),
    })
  }

  /** Começa o envio pelo WhatsApp em segundo plano. false = este relatório já está sendo enviado. */
  private startWhatsapp(tenantId: string, sch: ReportSchedule, text: string, pdf: { filename: string; contentType: string; content: Buffer }, manual: boolean) {
    if (this.waJobs.has(sch.id)) return false
    this.waJobs.add(sch.id)
    void this.deliverWhatsapp(tenantId, sch, text, pdf, manual)
      .catch((err: unknown) => this.logger.warn(`Relatório "${sch.name}" no WhatsApp: ${(err as Error).message}`))
      .finally(() => this.waJobs.delete(sch.id))
    return true
  }

  /**
   * Um celular de cada vez, com pausa sorteada entre eles. Número no limite de envio: espera e tenta de novo.
   * No fim, grava no histórico para quem foi e quem falhou.
   */
  async deliverWhatsapp(tenantId: string, sch: ReportSchedule, text: string, pdf: { filename: string; contentType: string; content: Buffer }, manual: boolean) {
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { tenantId, deletedAt: null, status: 'CONECTADO' }, orderBy: { createdAt: 'asc' } })
    const number = sch.whatsappNumberId ? numbers.find((n) => n.id === sch.whatsappNumberId) : numbers[0]
    const failed: string[] = []
    let sent = 0
    if (!number) failed.push(sch.whatsappNumberId ? 'o número escolhido para enviar está desconectado' : 'nenhum número de WhatsApp conectado')
    else {
      for (const [i, phone] of sch.whatsapp.entries()) {
        if (i > 0) await sleep(this.gap())
        try {
          let r = await this.chat.sendAutomatic(number, phone, text, WA_LABEL, { leadId: null, recordId: null, name: null, colleague: true }, { content: pdf.content, fileName: pdf.filename, mime: pdf.contentType })
          for (let tries = 0; !r && tries < 10; tries++) {
            await sleep(this.retryMs)
            r = await this.chat.sendAutomatic(number, phone, text, WA_LABEL, { leadId: null, recordId: null, name: null, colleague: true }, { content: pdf.content, fileName: pdf.filename, mime: pdf.contentType })
          }
          if (r) sent++
          else failed.push(`${phone} (limite de envio do número)`)
        } catch (err) {
          const msg = (err as Error).message || 'erro'
          failed.push(`${phone} (${/exists|não tem whatsapp|not.*whatsapp/i.test(msg) ? 'sem WhatsApp' : msg.slice(0, 80)})`)
        }
      }
    }
    const message = `WhatsApp${number ? ` (${number.name})` : ''}: enviado para ${sent} de ${sch.whatsapp.length} celular(es).${failed.length ? ` Não foi: ${failed.join('; ')}.` : ''}`.slice(0, 300)
    await this.saveRun(tenantId, sch.id, { at: new Date().toISOString(), scheduleId: sch.id, name: `${sch.name} (WhatsApp)`, ok: sent > 0 && !failed.length, to: sent, message, manual }, false)
    return { sent, failed }
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
