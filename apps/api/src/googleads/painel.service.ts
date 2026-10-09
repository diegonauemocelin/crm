import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { randomToken } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { MailService } from '../settings/mail.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { campaignLabel, DEFAULT_GOOGLE_ADS, type GoogleAdsSettings, normalizeEmail } from './googleads'
import { type BalanceState, type CampaignDayRow, DEFAULT_BALANCE, estimateBalance, keywordKey, type KeywordDayRow, panelPeriod, ratios } from './painel'

const toNum = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const BALANCE_KEY = 'google_ads_saldo'
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const todaySP = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Painel do Google Ads: investimento (script do Google Ads) x contatos e vendas do Pré-Vendas. */
@Injectable()
export class GoogleAdsPanelService {
  private readonly logger = new Logger('GoogleAdsSaldo')

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ---------- Saldo pré-pago (estimado) ----------

  private state(tenantId: string) {
    return this.settings.get<BalanceState>(tenantId, BALANCE_KEY, DEFAULT_BALANCE)
  }

  private async costFrom(tenantId: string, date: string) {
    const r = await this.prisma.$queryRaw<{ cost: unknown }[]>`SELECT coalesce(sum(cost), 0) AS cost FROM google_ads_campaign_days WHERE "tenantId" = ${tenantId}::uuid AND date >= ${date}::date`
    return toNum(r[0]?.cost)
  }

  /** Saldo estimado agora, a média de gasto dos últimos 7 dias completos e para quantos dias dá. */
  async balance(tenantId: string) {
    const s = await this.state(tenantId)
    const today = todaySP()
    const [fromAnchor, last7] = await Promise.all([
      s.anchor ? this.costFrom(tenantId, s.anchor.date) : Promise.resolve(0),
      this.prisma.$queryRaw<{ cost: unknown }[]>`SELECT coalesce(sum(cost), 0) AS cost FROM google_ads_campaign_days WHERE "tenantId" = ${tenantId}::uuid AND date >= ${addDays(today, -7)}::date AND date < ${today}::date GROUP BY date`,
    ])
    const est = estimateBalance(s, fromAnchor, last7.map((r) => toNum(r.cost)))
    return { estimate: est, alertDays: s.alertDays, alertEmails: s.alertEmails, deposits: [...s.deposits].reverse().slice(0, 30) }
  }

  /** Saldo como aparece no Google Ads agora: vira o novo ponto de partida (as recargas anteriores já estão nele). */
  async setBalance(user: AuthUser, amount: number, ctx: RequestCtx) {
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e8) throw new BadRequestException('Valor inválido.')
    const s = await this.state(user.tenantId)
    const date = todaySP()
    const anchor = { amount: Math.round(amount * 100) / 100, at: new Date().toISOString(), date, knownCost: await this.costFrom(user.tenantId, date), by: user.name }
    await this.settings.set(user.tenantId, BALANCE_KEY, { ...s, anchor, lastAlertAt: null })
    await this.audit.byUser(user, ctx, 'google_ads.saldo_informado', 'settings', BALANCE_KEY, { valor: anchor.amount })
    return this.balance(user.tenantId)
  }

  async addDeposit(user: AuthUser, amount: number, note: string | undefined, ctx: RequestCtx) {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e8) throw new BadRequestException('Valor inválido.')
    const s = await this.state(user.tenantId)
    if (!s.anchor) throw new BadRequestException('Informe primeiro o saldo atual do Google Ads; depois registre as recargas.')
    const dep = { id: randomToken(8), amount: Math.round(amount * 100) / 100, at: new Date().toISOString(), note: note?.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || undefined, by: user.name }
    await this.settings.set(user.tenantId, BALANCE_KEY, { ...s, deposits: [...s.deposits, dep].slice(-100), lastAlertAt: null })
    await this.audit.byUser(user, ctx, 'google_ads.recarga_registrada', 'settings', BALANCE_KEY, { valor: dep.amount })
    return this.balance(user.tenantId)
  }

  async removeDeposit(user: AuthUser, id: string, ctx: RequestCtx) {
    const s = await this.state(user.tenantId)
    const dep = s.deposits.find((d) => d.id === id)
    if (!dep) throw new NotFoundException('Recarga não encontrada.')
    await this.settings.set(user.tenantId, BALANCE_KEY, { ...s, deposits: s.deposits.filter((d) => d.id !== id) })
    await this.audit.byUser(user, ctx, 'google_ads.recarga_removida', 'settings', BALANCE_KEY, { valor: dep.amount })
    return this.balance(user.tenantId)
  }

  async setAlert(user: AuthUser, days: number, emails: string[], ctx: RequestCtx) {
    if (!Number.isInteger(days) || days < 1 || days > 60) throw new BadRequestException('Informe de 1 a 60 dias.')
    const clean = [...new Set(emails.map((e) => normalizeEmail(e)).filter((e): e is string => !!e))].slice(0, 10)
    if (clean.length !== emails.filter((e) => e.trim()).length) throw new BadRequestException('Há e-mail inválido na lista.')
    const s = await this.state(user.tenantId)
    await this.settings.set(user.tenantId, BALANCE_KEY, { ...s, alertDays: days, alertEmails: clean, lastAlertAt: null })
    await this.audit.byUser(user, ctx, 'google_ads.aviso_saldo', 'settings', BALANCE_KEY, { dias: days, emails: clean.length })
    return this.balance(user.tenantId)
  }

  /** Depois de cada envio do script: avisa por e-mail quando o saldo está acabando (no máximo 1 vez por dia). */
  async checkAlert(tenantId: string) {
    const s = await this.state(tenantId)
    if (!s.anchor || !s.alertEmails.length) return
    if (s.lastAlertAt && Date.now() - Date.parse(s.lastAlertAt) < 20 * 3_600_000) return
    const { estimate: e } = await this.balance(tenantId)
    if (!e?.low) return
    await this.settings.set(tenantId, BALANCE_KEY, { ...s, lastAlertAt: new Date().toISOString() })
    const branding = await this.settings.branding(tenantId)
    const dias = e.daysLeft === null ? '' : e.daysLeft < 1 ? ' (acaba hoje)' : ` (cerca de ${Math.floor(e.daysLeft)} dia(s), no ritmo de ${brl.format(e.avgDaily ?? 0)} por dia)`
    const body = e.balance <= 0 ? `O saldo estimado do Google Ads acabou (${brl.format(e.balance)}). Os anúncios podem parar.` : `O saldo estimado do Google Ads é ${brl.format(e.balance)}${dias}.`
    const link = `${env.appUrl}/google-ads`
    for (const to of s.alertEmails) {
      await this.mail
        .send(tenantId, {
          to,
          subject: `Saldo do Google Ads acabando - ${branding.appName}`,
          text: `${body}\n\nSe já fez a recarga, registre no CRM para o aviso parar.\n\n${link}`,
          html: this.mail.simpleTemplate(branding, {
            title: 'Saldo do Google Ads acabando',
            greeting: 'Olá.',
            body: `${body} Se já fez a recarga, registre no CRM para o aviso parar. O valor é uma estimativa: confira em Google Ads → Faturamento.`,
            buttonLabel: 'Ver o painel',
            buttonUrl: link,
            footnote: 'Aviso automático do CRM.',
          }),
        })
        .catch((err: unknown) => this.logger.warn(`Aviso de saldo não enviado: ${(err as Error).message}`))
    }
  }

  /** Grava (ou atualiza) os dias de campanha e de palavra-chave enviados pelo script. */
  async store(tenantId: string, s: { campaigns: CampaignDayRow[]; keywords: KeywordDayRow[] }) {
    const c = s.campaigns
    if (c.length) {
      await this.prisma.$executeRaw`
        INSERT INTO google_ads_campaign_days (id, "tenantId", date, "campaignId", "campaignName", cost, clicks, impressions, conversions, "updatedAt")
        SELECT gen_random_uuid(), ${tenantId}::uuid, x.d::date, x.c, x.n, x.cost::numeric, x.cl::int, x.im::int, x.cv::numeric, now()
        FROM unnest(${c.map((r) => r.date)}::text[], ${c.map((r) => r.campaignId)}::text[], ${c.map((r) => r.campaignName)}::text[],
          ${c.map((r) => String(r.cost))}::text[], ${c.map((r) => String(r.clicks))}::text[], ${c.map((r) => String(r.impressions))}::text[], ${c.map((r) => String(r.conversions))}::text[])
          AS x(d, c, n, cost, cl, im, cv)
        ON CONFLICT ("tenantId", date, "campaignId") DO UPDATE SET "campaignName" = EXCLUDED."campaignName", cost = EXCLUDED.cost, clicks = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions, conversions = EXCLUDED.conversions, "updatedAt" = now()`
    }
    const k = s.keywords
    if (k.length) {
      await this.prisma.$executeRaw`
        INSERT INTO google_ads_keyword_days (id, "tenantId", date, "campaignId", "adGroupId", "criterionId", keyword, "matchType", cost, clicks, impressions, conversions, "updatedAt")
        SELECT gen_random_uuid(), ${tenantId}::uuid, x.d::date, x.c, x.g, x.k, x.t, x.m, x.cost::numeric, x.cl::int, x.im::int, x.cv::numeric, now()
        FROM unnest(${k.map((r) => r.date)}::text[], ${k.map((r) => r.campaignId)}::text[], ${k.map((r) => r.adGroupId)}::text[], ${k.map((r) => r.criterionId)}::text[],
          ${k.map((r) => r.keyword)}::text[], ${k.map((r) => r.matchType)}::text[], ${k.map((r) => String(r.cost))}::text[], ${k.map((r) => String(r.clicks))}::text[],
          ${k.map((r) => String(r.impressions))}::text[], ${k.map((r) => String(r.conversions))}::text[])
          AS x(d, c, g, k, t, m, cost, cl, im, cv)
        ON CONFLICT ("tenantId", date, "adGroupId", "criterionId") DO UPDATE SET "campaignId" = EXCLUDED."campaignId", keyword = EXCLUDED.keyword, "matchType" = EXCLUDED."matchType",
          cost = EXCLUDED.cost, clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, conversions = EXCLUDED.conversions, "updatedAt" = now()`
    }
    await this.settings.set(tenantId, 'google_ads_custos', { syncedAt: new Date().toISOString() })
    void this.checkAlert(tenantId).catch((err: unknown) => this.logger.warn(`Aviso de saldo: ${(err as Error).message}`))
    return { dias: c.length, palavras: k.length }
  }

  async panel(user: AuthUser, q: { from?: string; to?: string }) {
    const tenantId = user.tenantId
    const { from, to } = panelPeriod(q.from, q.to)
    // Contatos do período: atendimentos do Pré-Vendas marcados como Google Ads (anúncio detectado ou origem dos anúncios).
    const start = new Date(`${from}T00:00:00-03:00`)
    const end = new Date(Date.parse(`${to}T00:00:00-03:00`) + 86_400_000)
    const [s, synced, costCamp, costDay, costKw, recCamp, recKw, recOrigin, recDay] = await Promise.all([
      this.settings.get<GoogleAdsSettings>(tenantId, 'google_ads', DEFAULT_GOOGLE_ADS),
      this.settings.get<{ syncedAt?: string }>(tenantId, 'google_ads_custos', {}),
      this.prisma.$queryRaw<{ id: string; name: string; cost: unknown; clicks: unknown; impressions: unknown; conversions: unknown }[]>`
        SELECT "campaignId" AS id, max("campaignName") AS name, sum(cost) AS cost, sum(clicks) AS clicks, sum(impressions) AS impressions, sum(conversions) AS conversions
        FROM google_ads_campaign_days WHERE "tenantId" = ${tenantId}::uuid AND date BETWEEN ${from}::date AND ${to}::date GROUP BY 1`,
      this.prisma.$queryRaw<{ day: string; cost: unknown; clicks: unknown }[]>`
        SELECT to_char(date, 'YYYY-MM-DD') AS day, sum(cost) AS cost, sum(clicks) AS clicks
        FROM google_ads_campaign_days WHERE "tenantId" = ${tenantId}::uuid AND date BETWEEN ${from}::date AND ${to}::date GROUP BY 1`,
      this.prisma.$queryRaw<{ keyword: string; matchTypes: string[]; campaignIds: string[]; cost: unknown; clicks: unknown; impressions: unknown; conversions: unknown }[]>`
        SELECT lower(keyword) AS keyword, array_agg(DISTINCT "matchType") AS "matchTypes", array_agg(DISTINCT "campaignId") AS "campaignIds",
          sum(cost) AS cost, sum(clicks) AS clicks, sum(impressions) AS impressions, sum(conversions) AS conversions
        FROM google_ads_keyword_days WHERE "tenantId" = ${tenantId}::uuid AND date BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1 ORDER BY sum(cost) DESC LIMIT 300`,
      this.prisma.$queryRaw<{ id: string | null; name: string | null; leads: unknown; sales: unknown; revenue: unknown }[]>`
        SELECT CASE WHEN "adsVia" = 'ANUNCIO' THEN "adsCampaignId" END AS id, max("adsCampaign") AS name, count(*) AS leads,
          count(*) FILTER (WHERE "saleStatus" = 'SIM') AS sales, coalesce(sum("saleValue") FILTER (WHERE "saleStatus" = 'SIM'), 0) AS revenue
        FROM service_records WHERE "tenantId" = ${tenantId}::uuid AND kind = 'PRE_VENDAS' AND "deletedAt" IS NULL AND "adsVia" IS NOT NULL
          AND "leadAt" >= ${start} AND "leadAt" < ${end} GROUP BY 1`,
      this.prisma.$queryRaw<{ term: string; leads: unknown; sales: unknown; revenue: unknown }[]>`
        SELECT "adsTerm" AS term, count(*) AS leads, count(*) FILTER (WHERE "saleStatus" = 'SIM') AS sales,
          coalesce(sum("saleValue") FILTER (WHERE "saleStatus" = 'SIM'), 0) AS revenue
        FROM service_records WHERE "tenantId" = ${tenantId}::uuid AND kind = 'PRE_VENDAS' AND "deletedAt" IS NULL AND "adsVia" = 'ANUNCIO' AND "adsTerm" IS NOT NULL
          AND "leadAt" >= ${start} AND "leadAt" < ${end} GROUP BY 1`,
      this.prisma.$queryRaw<{ name: string | null; leads: unknown; sales: unknown; revenue: unknown; withCampaign: unknown }[]>`
        SELECT o.name, count(*) AS leads, count(*) FILTER (WHERE r."saleStatus" = 'SIM') AS sales,
          coalesce(sum(r."saleValue") FILTER (WHERE r."saleStatus" = 'SIM'), 0) AS revenue, count(*) FILTER (WHERE r."adsVia" = 'ANUNCIO') AS "withCampaign"
        FROM service_records r LEFT JOIN lookup_items o ON o.id = r."originId"
        WHERE r."tenantId" = ${tenantId}::uuid AND r.kind = 'PRE_VENDAS' AND r."deletedAt" IS NULL AND r."adsVia" IS NOT NULL
          AND r."leadAt" >= ${start} AND r."leadAt" < ${end} GROUP BY 1 ORDER BY 2 DESC`,
      this.prisma.$queryRaw<{ day: string; leads: unknown; sales: unknown }[]>`
        SELECT to_char("leadAt" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day, count(*) AS leads, count(*) FILTER (WHERE "saleStatus" = 'SIM') AS sales
        FROM service_records WHERE "tenantId" = ${tenantId}::uuid AND kind = 'PRE_VENDAS' AND "deletedAt" IS NULL AND "adsVia" IS NOT NULL
          AND "leadAt" >= ${start} AND "leadAt" < ${end} GROUP BY 1`,
    ])
    const names = s.campaigns ?? {}

    // Por campanha: investimento do Google + contatos e vendas do CRM, pelo número da campanha.
    const byId = new Map<string, { id: string | null; name: string; cost: number; clicks: number; impressions: number; googleConversions: number; leads: number; sales: number; revenue: number }>()
    for (const c of costCamp) byId.set(c.id, { id: c.id, name: names[c.id] || c.name, cost: toNum(c.cost), clicks: toNum(c.clicks), impressions: toNum(c.impressions), googleConversions: toNum(c.conversions), leads: 0, sales: 0, revenue: 0 })
    for (const r of recCamp) {
      const key = r.id ?? '-'
      const row = byId.get(key) ?? { id: r.id, name: r.id ? campaignLabel({ campaignId: r.id, campaign: names[r.id] || r.name }) : 'Campanha não identificada', cost: 0, clicks: 0, impressions: 0, googleConversions: 0, leads: 0, sales: 0, revenue: 0 }
      row.leads += toNum(r.leads)
      row.sales += toNum(r.sales)
      row.revenue += toNum(r.revenue)
      byId.set(key, row)
    }
    const campaigns = [...byId.values()].map((r) => ({ ...r, ...ratios(r) })).sort((a, b) => b.cost - a.cost || b.leads - a.leads)

    // Por palavra-chave: cruza a palavra do link (utm_term) com a do Google, sem diferença de maiúsculas e símbolos.
    const kwMap = new Map<string, { keyword: string; matchTypes: string[]; campaigns: string[]; cost: number; clicks: number; impressions: number; googleConversions: number; leads: number; sales: number; revenue: number }>()
    for (const k of costKw) {
      const key = keywordKey(k.keyword)
      const prev = kwMap.get(key)
      const add = { cost: toNum(k.cost), clicks: toNum(k.clicks), impressions: toNum(k.impressions), googleConversions: toNum(k.conversions) }
      if (prev) Object.assign(prev, { cost: prev.cost + add.cost, clicks: prev.clicks + add.clicks, impressions: prev.impressions + add.impressions, googleConversions: prev.googleConversions + add.googleConversions })
      else kwMap.set(key, { keyword: k.keyword, matchTypes: k.matchTypes, campaigns: k.campaignIds.map((id) => names[id] || costCamp.find((c) => c.id === id)?.name || `campanha nº ${id}`), ...add, leads: 0, sales: 0, revenue: 0 })
    }
    for (const r of recKw) {
      const key = keywordKey(r.term)
      if (!key) continue
      const row = kwMap.get(key) ?? { keyword: r.term, matchTypes: [], campaigns: [], cost: 0, clicks: 0, impressions: 0, googleConversions: 0, leads: 0, sales: 0, revenue: 0 }
      row.leads += toNum(r.leads)
      row.sales += toNum(r.sales)
      row.revenue += toNum(r.revenue)
      kwMap.set(key, row)
    }
    const keywords = [...kwMap.values()].map((r) => ({ ...r, ...ratios(r) })).sort((a, b) => b.cost - a.cost || b.leads - a.leads).slice(0, 300)

    const origins = recOrigin.map((o) => {
      const r = { cost: 0, clicks: 0, leads: toNum(o.leads), sales: toNum(o.sales), revenue: toNum(o.revenue) }
      return { name: o.name ?? 'Sem origem', leads: r.leads, sales: r.sales, revenue: r.revenue, withCampaign: toNum(o.withCampaign), conversionRate: ratios(r).conversionRate }
    })

    // Por dia, com os dias sem nada (o gráfico não pula dias).
    const days: { day: string; cost: number; clicks: number; leads: number; sales: number }[] = []
    const cd = new Map(costDay.map((d) => [d.day, d]))
    const rd = new Map(recDay.map((d) => [d.day, d]))
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10)
      days.push({ day, cost: toNum(cd.get(day)?.cost), clicks: toNum(cd.get(day)?.clicks), leads: toNum(rd.get(day)?.leads), sales: toNum(rd.get(day)?.sales) })
    }

    const sum = (k: 'cost' | 'clicks' | 'impressions' | 'googleConversions' | 'leads' | 'sales' | 'revenue') => campaigns.reduce((a, r) => a + r[k], 0)
    const totals = { cost: sum('cost'), clicks: sum('clicks'), impressions: sum('impressions'), googleConversions: sum('googleConversions'), leads: sum('leads'), sales: sum('sales'), revenue: sum('revenue') }
    const unidentified = campaigns.find((c) => c.id === null)?.leads ?? 0
    return {
      from,
      to,
      costSyncedAt: synced.syncedAt ?? null,
      hasCost: costCamp.length > 0,
      hasKeywordCost: costKw.length > 0,
      balance: await this.balance(tenantId),
      totals: { ...totals, ...ratios(totals), unidentifiedLeads: unidentified },
      campaigns,
      keywords,
      origins,
      days,
    }
  }
}
