import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { MarketplacesService } from '../marketplaces/marketplaces.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { EmailAiService } from '../email/ia.service'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import { pdfCards, periodLabel, reportSheets, toPdf, toXlsx } from './arquivos'
import { pdfImage } from './pdf-imagem'
import { FilesService } from '../files/files.service'
import { cleanFilters, DEFAULT_INTEGRATIONS, INTEGRATIONS_KEY, type IntegrationsConfig, type ReportSection } from './config'
import { aiPrompt, AI_SYSTEM, cleanAiText } from './ia'
import { MarketingService } from './marketing.service'
import { type Filters, todayLocal } from './metricas'
import {
  ALERT_TYPES,
  type AlertContext,
  type AlertRule,
  ALERTS_KEY,
  type AlertsState,
  cleanPlan,
  cleanRule,
  DEFAULT_ALERTS,
  daysInMonth,
  emptyPlan,
  evaluate,
  goalStatus,
  type MonthPlan,
  PLAN_KEY,
  type Plans,
  projection,
  scenarios,
} from './planejamento'
import { SYNC_KEY, type SyncStates } from './sync.service'

const HOUR = 3_600_000
const MAX_EVENTS = 100

/** Planejamento (orçamento e metas), alertas, resumo pela IA e arquivos (PDF/Excel) do Marketing Inteligente. */
@Injectable()
export class MarketingManagementService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketingManagementService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly ai: EmailAiService,
    private readonly mkt: MarketingService,
    private readonly files: FilesService,
    private readonly marketplaces: MarketplacesService,
  ) {}

  /** Logo da empresa (Configurações › Marca) preparado para o PDF; sem logo ou formato que não abre: null. */
  private async logo(fileId: string | null) {
    if (!fileId) return null
    try {
      const { asset, content } = await this.files.read(fileId)
      return pdfImage(content, asset.mime)
    } catch {
      return null
    }
  }

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), HOUR)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  // ---------- Planejamento ----------

  plans(tenantId: string) {
    return this.settings.get<Plans>(tenantId, PLAN_KEY, { months: {} })
  }

  /** Mês planejado x realizado: orçamento, gasto, projeção até o fim do mês, metas e cenários. */
  async planView(tenantId: string, month: string, now = Date.now()) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Mês inválido.')
    const plan = (await this.plans(tenantId)).months[month] ?? emptyPlan()
    const today = todayLocal(now)
    const first = `${month}-01`
    const total = daysInMonth(month)
    const last = `${month}-${String(total).padStart(2, '0')}`
    const future = first > today
    const to = last < today ? last : today
    const d = future ? null : await this.mkt.analyze(tenantId, { from: first, to, visao: 'dia', filters: {} }, now)
    const elapsed = d ? d.series.length : 0
    const byPlatform = Object.fromEntries((d?.byPlatform ?? []).map((p) => [p.key, p.mediaCost]))
    const daily = d ? d.series.map((s) => s.mediaCost) : []
    const proj = projection(daily, total)
    const platform = (key: 'google' | 'meta' | 'tiktok', budget: number | null) => {
      const spent = byPlatform[key] ?? 0
      const projected = elapsed ? Math.round((spent / elapsed) * total * 100) / 100 : null
      return { key, budget, spent, remaining: budget === null ? null : Math.round((budget - spent) * 100) / 100, consumedPct: budget ? Math.round((spent / budget) * 1000) / 10 : null, projected, overBudget: budget !== null && projected !== null && projected > budget * 1.05 }
    }
    const campaigns = (d?.byCampaign ?? [])
      .filter((c) => c.key !== '-' && (c.mediaCost > 0 || plan.budget.campaigns[c.key]))
      .map((c) => {
        const budget = plan.budget.campaigns[c.key] ?? null
        const projected = elapsed ? Math.round((c.mediaCost / elapsed) * total * 100) / 100 : null
        return { key: c.key, name: c.name, platform: c.platform, budget, spent: c.mediaCost, consumedPct: budget ? Math.round((c.mediaCost / budget) * 1000) / 10 : null, projected, leads: c.leads, sales: c.sales, revenue: c.revenue }
      })
    const totalBudget = plan.budget.total ?? ([plan.budget.google, plan.budget.meta, plan.budget.tiktok].some((x) => x !== null) ? (plan.budget.google ?? 0) + (plan.budget.meta ?? 0) + (plan.budget.tiktok ?? 0) : null)
    const n = d?.now
    return {
      month,
      days: { total, elapsed, future },
      plan,
      budget: {
        total: totalBudget,
        spent: proj.spent,
        remaining: totalBudget === null ? null : Math.round((totalBudget - proj.spent) * 100) / 100,
        consumedPct: totalBudget ? Math.round((proj.spent / totalBudget) * 1000) / 10 : null,
        projection: proj,
        overBudget: totalBudget !== null && proj.projected !== null && proj.projected > totalBudget * 1.05,
        platforms: [platform('google', plan.budget.google), platform('meta', plan.budget.meta), platform('tiktok', plan.budget.tiktok)],
        campaigns,
      },
      goals: n
        ? {
            leads: goalStatus(plan.goals.leads, n.leads, elapsed, total),
            sales: goalStatus(plan.goals.sales, n.sales, elapsed, total),
            revenue: goalStatus(plan.goals.revenue, n.revenue, elapsed, total),
            cpl: goalStatus(plan.goals.cpl, n.cpl, elapsed, total, true),
          }
        : null,
      realized: n ? { leads: n.leads, sales: n.sales, revenue: n.revenue, cpl: n.cpl, roas: n.roas, mediaCost: n.mediaCost } : null,
      scenarios: n ? scenarios(n) : [],
      premises: [
        'Projeção do gasto: o ritmo médio diário do mês continua igual até o último dia.',
        'Cenários: o lado otimista mantém o custo por lead atual; o conservador supõe retorno decrescente (cada real a mais rende menos).',
        'Conversão em venda e ticket médio ficam iguais aos do mês até agora. São estimativas, não promessas.',
      ],
    }
  }

  async savePlan(user: AuthUser, month: string, input: Partial<MonthPlan>, ctx: RequestCtx) {
    const next = cleanPlan(month, input, user.name)
    if ('error' in next) throw new BadRequestException(next.error)
    const all = await this.plans(user.tenantId)
    await this.settings.set(user.tenantId, PLAN_KEY, { months: { ...all.months, [month]: next } })
    await this.audit.byUser(user, ctx, 'marketing.plan_updated', 'settings', `${PLAN_KEY}.${month}`, { mes: month, orcamento: next.budget.total, metas: next.goals })
    return this.planView(user.tenantId, month)
  }

  // ---------- Alertas ----------

  alerts(tenantId: string) {
    return this.settings.get<AlertsState>(tenantId, ALERTS_KEY, DEFAULT_ALERTS)
  }

  async alertsView(tenantId: string) {
    const s = await this.alerts(tenantId)
    return { ...s, types: ALERT_TYPES }
  }

  async saveRule(user: AuthUser, id: string | null, input: Partial<AlertRule>, ctx: RequestCtx) {
    const s = await this.alerts(user.tenantId)
    const prev = id ? s.rules.find((r) => r.id === id) : null
    if (id && !prev) throw new NotFoundException('Alerta não encontrado.')
    if (!id && s.rules.length >= 50) throw new BadRequestException('No máximo 50 alertas.')
    const next = cleanRule(input, prev ?? null, id ?? randomUUID())
    if ('error' in next) throw new BadRequestException(next.error)
    await this.settings.set(user.tenantId, ALERTS_KEY, { ...s, rules: prev ? s.rules.map((r) => (r.id === next.id ? next : r)) : [...s.rules, next] })
    await this.audit.byUser(user, ctx, prev ? 'marketing.alert_updated' : 'marketing.alert_created', 'settings', next.id, { tipo: next.type, limite: next.threshold, dias: next.windowDays, destinatarios: next.emails.length, ativo: next.active })
    return next
  }

  async removeRule(user: AuthUser, id: string, ctx: RequestCtx) {
    const s = await this.alerts(user.tenantId)
    if (!s.rules.some((r) => r.id === id)) throw new NotFoundException('Alerta não encontrado.')
    await this.settings.set(user.tenantId, ALERTS_KEY, { ...s, rules: s.rules.filter((r) => r.id !== id) })
    await this.audit.byUser(user, ctx, 'marketing.alert_removed', 'settings', id, {})
    return { ok: true }
  }

  /** Monta o que os alertas avaliam para uma janela (dias) terminando hoje. */
  async alertContext(tenantId: string, windowDays: number, now = Date.now()): Promise<AlertContext> {
    const to = todayLocal(now)
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10)
    const month = to.slice(0, 7)
    const [d, plan, costSync, sync, integ] = await Promise.all([
      this.mkt.analyze(tenantId, { from, to, filters: {} }, now),
      this.planView(tenantId, month, now).catch(() => null),
      this.settings.get<{ syncedAt?: string }>(tenantId, 'google_ads_custos', {}),
      this.settings.get<SyncStates>(tenantId, SYNC_KEY, {}),
      this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS),
    ])
    const hours = (iso: string | null | undefined) => (iso ? (now - Date.parse(iso)) / HOUR : null)
    const c = { ...DEFAULT_INTEGRATIONS, ...integ }
    const names = { metaAds: 'Meta Ads', metaOrganic: 'Instagram/Facebook', tiktok: 'TikTok Ads', searchConsole: 'Search Console' } as const
    const google = d.quality.googleLeads
    return {
      now: d.now,
      before: d.before,
      campaigns: d.byCampaign,
      googleWithoutCampaign: { without: google - d.quality.googleWithCampaign, total: google },
      budget: plan?.budget.total ? { amount: plan.budget.total, spent: plan.budget.spent } : null,
      goals: plan?.goals
        ? [
            { label: 'Leads', status: plan.goals.leads },
            { label: 'Vendas', status: plan.goals.sales },
            { label: 'Faturamento', status: plan.goals.revenue },
          ]
        : [],
      staleness: [
        ...(costSync.syncedAt ? [{ name: 'Investimento do Google Ads', hours: hours(costSync.syncedAt), error: null }] : []),
        ...(Object.keys(names) as (keyof typeof names)[]).filter((k) => c[k].enabled).map((k) => ({ name: names[k], hours: hours(sync[k]?.lastOkAt), error: sync[k]?.lastError ?? null })),
      ],
    }
  }

  /** A cada hora: avalia os alertas ativos e avisa por e-mail (no máximo 1 vez por dia por alerta). */
  async tick(now = Date.now()) {
    if (this.busy) return
    this.busy = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: ALERTS_KEY }, select: { tenantId: true } })
      for (const { tenantId } of rows) await this.checkAlerts(tenantId, now)
    } catch (err) {
      this.logger.error(`Alertas do marketing: ${(err as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  async checkAlerts(tenantId: string, now = Date.now(), force = false) {
    const s = await this.alerts(tenantId)
    const due = s.rules.filter((r) => r.active && (force || !r.lastFiredAt || now - Date.parse(r.lastFiredAt) >= 20 * HOUR))
    if (!due.length) return []
    const contexts = new Map<number, AlertContext>()
    const fired: { rule: AlertRule; message: string; limitation: string | null }[] = []
    for (const rule of due) {
      if (!contexts.has(rule.windowDays)) contexts.set(rule.windowDays, await this.alertContext(tenantId, rule.windowDays, now))
      const r = evaluate(rule, contexts.get(rule.windowDays)!)
      if (r.fired) fired.push({ rule, message: r.message, limitation: r.limitation })
    }
    if (!fired.length) return []
    const branding = await this.settings.branding(tenantId)
    for (const f of fired) {
      const label = ALERT_TYPES.find((t) => t.key === f.rule.type)?.label ?? f.rule.type
      for (const to of f.rule.emails) {
        await this.mail
          .send(tenantId, {
            to,
            subject: `Alerta de marketing: ${label}`,
            text: `${f.message}${f.limitation ? `\n${f.limitation}` : ''}\n\nVer no sistema: ${env.appUrl}/marketing`,
            html: this.mail.simpleTemplate(branding, { title: `Alerta: ${label}`, greeting: 'Olá,', body: `${f.message}${f.limitation ? ` (${f.limitation})` : ''}`, buttonLabel: 'Abrir o Marketing Inteligente', buttonUrl: `${env.appUrl}/marketing`, footnote: `Período avaliado: últimos ${f.rule.windowDays} dia(s), comparado com o anterior.` }),
          })
          .catch((err: unknown) => this.logger.warn(`Alerta para ${to}: ${(err as Error).message}`))
      }
    }
    const at = new Date(now).toISOString()
    const cur = await this.alerts(tenantId)
    const ids = new Set(fired.map((f) => f.rule.id))
    await this.settings.set(tenantId, ALERTS_KEY, {
      rules: cur.rules.map((r) => (ids.has(r.id) ? { ...r, lastFiredAt: at } : r)),
      events: [...fired.map((f) => ({ at, ruleId: f.rule.id, type: f.rule.type, message: f.message, limitation: f.limitation })), ...cur.events].slice(0, MAX_EVENTS),
    })
    return fired.map((f) => f.message)
  }

  /** "Testar agora": avalia todos os alertas com os números de hoje, sem mandar e-mail. */
  async evaluateNow(tenantId: string, now = Date.now()) {
    const s = await this.alerts(tenantId)
    const contexts = new Map<number, AlertContext>()
    const out: { id: string; type: string; fired: boolean; message: string; limitation: string | null }[] = []
    for (const rule of s.rules) {
      if (!contexts.has(rule.windowDays)) contexts.set(rule.windowDays, await this.alertContext(tenantId, rule.windowDays, now))
      out.push({ id: rule.id, type: rule.type, ...evaluate(rule, contexts.get(rule.windowDays)!) })
    }
    return out
  }

  // ---------- IA ----------

  async aiSummary(tenantId: string, q: { from?: string; to?: string; filters?: Partial<Record<string, unknown>> | Filters }) {
    if (!(await this.ai.available(tenantId))) throw new BadRequestException('Para o resumo pela IA, cadastre a chave do Gemini em Configurações › E-mail marketing.')
    const d = await this.mkt.analyze(tenantId, { from: q.from, to: q.to, filters: q.filters ?? {} })
    const text = cleanAiText(await this.ai.complete(tenantId, AI_SYSTEM, aiPrompt(d), 1200))
    return { text, period: d.period, generatedAt: new Date().toISOString(), note: 'Texto gerado pela IA a partir dos números agregados do período. Confira os números nas telas antes de decidir.' }
  }

  // ---------- Arquivos ----------

  async file(tenantId: string, format: 'pdf' | 'xlsx', q: { from?: string; to?: string; filters?: Partial<Record<string, unknown>> | Filters; sections: ReportSection[]; title: string; withAi?: boolean }) {
    const d = await this.mkt.analyze(tenantId, { from: q.from, to: q.to, filters: cleanFilters(q.filters ?? {}) })
    const [email, health, branding, ai, store, ml] = await Promise.all([
      q.sections.includes('email') ? this.mkt.email(tenantId, { from: d.period.from, to: d.period.to }) : Promise.resolve(null),
      q.sections.includes('saude') ? this.mkt.health(tenantId) : Promise.resolve(null),
      this.settings.branding(tenantId),
      q.sections.includes('resumo_ia') && (await this.ai.available(tenantId))
        ? this.ai.complete(tenantId, AI_SYSTEM, aiPrompt(d), 1200).then(cleanAiText).catch(() => null)
        : Promise.resolve(null),
      q.sections.includes('loja') ? this.mkt.store(tenantId, { from: d.period.from, to: d.period.to }) : Promise.resolve(null),
      q.sections.includes('mercado_livre') ? this.marketplaces.mercadoLivre(tenantId, d.period.from, d.period.to).catch(() => null) : Promise.resolve(null),
    ])
    const sheets = reportSheets(d, q.sections, email, health, ai, store, ml)
    const period = periodLabel(d.period.from, d.period.to)
    const base = `${q.title} ${d.period.from}${d.period.from === d.period.to ? '' : `_${d.period.to}`}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase()
    const footer = `${branding.appName} · Fonte: Pré-Vendas do CRM e plataformas conectadas · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    if (format === 'xlsx') return { filename: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: Buffer.from(toXlsx(sheets, q.title)) }
    const subtitle = `${period} (comparado com ${periodLabel(d.period.prevFrom, d.period.prevTo)}) · atribuição ${d.rules.attribution.model === 'primeiro' ? 'primeiro toque' : 'último toque'}, janela de ${d.rules.attribution.windowDays} dias · investimento do Google Ads ${d.updatedAt.googleAdsCost ? `atualizado em ${new Date(d.updatedAt.googleAdsCost).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'ainda não recebido'}${d.crmOnlyFilters.length ? ' · com filtro só do CRM: custos fora das contas' : ''}`
    const pdf = toPdf({
      title: q.title,
      subtitle,
      sheets,
      footer,
      color: branding.brandColor || branding.primaryColor,
      brandName: branding.shortName || branding.appName,
      logo: await this.logo(branding.logoFileId),
      info: branding.companyInfo || undefined,
      cards: q.sections.includes('kpis') ? pdfCards(d) : undefined,
    })
    return { filename: `${base}.pdf`, contentType: 'application/pdf', content: Buffer.from(pdf) }
  }
}
