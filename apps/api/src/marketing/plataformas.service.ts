import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { DEFAULT_ALERT_WORDS, DIMENSION_LABEL, DETAIL_DIMENSIONS, type DetailDimension, negativeSuggestions, valueLabel } from '../googleads/detalhes'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { CONFIG_KEY, DEFAULT_CONFIG, DEFAULT_INTEGRATIONS, INTEGRATIONS_KEY, type IntegrationsConfig, type MarketingConfig } from './config'
import { MarketingService } from './marketing.service'
import { div, pct, periods } from './metricas'
import { cleanIgAccounts, IG_ACCOUNTS_KEY, postTimes } from './instagram'
import { aggregateMedia, aggregateSeo, byFormat, fatigue, groupByNames, type MediaDay, pagePath, rankPosts, seoOpportunities, themesOf } from './plataformas'
import { SYNC_KEY, type SyncStates } from './sync.service'

export const TERMS_KEY = 'mkt_termos'
export type TermDecision = 'negativar' | 'manter'
export interface TermReviews {
  items: Record<string, { status: TermDecision; by: string; at: string }>
}
const day = (d: Date) => d.toISOString().slice(0, 10)
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)

export const EDITORIAL_STATUS = ['ideia', 'producao', 'aprovacao', 'agendado', 'publicado', 'cancelado'] as const
export const EDITORIAL_NETWORKS = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'outro'] as const

/** Telas das plataformas: Google Ads em detalhe, Meta/TikTok, SEO e redes sociais (só leitura do que foi sincronizado). */
@Injectable()
export class MarketingPlatformsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly mkt: MarketingService,
  ) {}

  private cfg(tenantId: string) {
    return this.settings.get<MarketingConfig>(tenantId, CONFIG_KEY, DEFAULT_CONFIG)
  }

  // ---------- Google Ads em detalhe ----------

  async google(tenantId: string, q: { from?: string; to?: string; campaignId?: string }) {
    const p = periods(q.from, q.to)
    const range = { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) }
    const camp = q.campaignId && /^\d{1,20}$/.test(q.campaignId) ? q.campaignId : undefined
    const [detail, terms, reviews, synced, cfg, names, records] = await Promise.all([
      this.prisma.googleAdsDetailDay.groupBy({
        by: ['dimension', 'key'],
        where: { tenantId, date: range, ...(camp ? { campaignId: camp } : {}) },
        _sum: { cost: true, clicks: true, impressions: true, conversions: true, conversionValue: true },
        _max: { label: true },
        _avg: { impressionShare: true },
      }),
      this.prisma.googleAdsSearchTermDay.groupBy({
        by: ['term'],
        where: { tenantId, date: range, ...(camp ? { campaignId: camp } : {}) },
        _sum: { cost: true, clicks: true, impressions: true, conversions: true },
        orderBy: { _sum: { cost: 'desc' } },
        take: 2000,
      }),
      this.settings.get<TermReviews>(tenantId, TERMS_KEY, { items: {} }),
      this.settings.get<{ syncedAt?: string }>(tenantId, 'google_ads_detalhes', {}),
      this.cfg(tenantId),
      this.mkt.names(tenantId),
      this.prisma.serviceRecord.findMany({
        where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, adsVia: { in: ['ANUNCIO', 'ORIGEM'] }, leadAt: { gte: p.start, lt: p.end }, ...(camp ? { adsCampaignId: camp } : {}) },
        select: { entryPage: true, saleStatus: true, saleValue: true },
      }),
    ])
    const termCampaigns = await this.prisma.googleAdsSearchTermDay.groupBy({ by: ['term', 'campaignId'], where: { tenantId, date: range, term: { in: terms.map((t) => t.term) } } })
    const campaignsOf = new Map<string, string[]>()
    for (const t of termCampaigns) campaignsOf.set(t.term, [...(campaignsOf.get(t.term) ?? []), t.campaignId])
    // Páginas de destino: cruza com a página de entrada dos atendimentos de anúncio (leads e vendas por página).
    const byPage = new Map<string, { leads: number; sales: number; revenue: number }>()
    for (const r of records) {
      const k = pagePath(r.entryPage)
      if (!k) continue
      const m = byPage.get(k) ?? { leads: 0, sales: 0, revenue: 0 }
      m.leads++
      if (r.saleStatus === 'SIM') {
        m.sales++
        m.revenue += Number(r.saleValue ?? 0)
      }
      byPage.set(k, m)
    }
    const dims = Object.fromEntries(
      DETAIL_DIMENSIONS.map((d) => [
        d,
        detail
          .filter((x) => x.dimension === d)
          .map((x) => {
            const cost = Number(x._sum.cost ?? 0)
            const clicks = Number(x._sum.clicks ?? 0)
            const impressions = Number(x._sum.impressions ?? 0)
            const conversions = Number(x._sum.conversions ?? 0)
            const crm = d === 'landing' ? byPage.get(pagePath(x.key) ?? '') : undefined
            return {
              key: x.key,
              name: d === 'type' || d === 'device' || d === 'network' ? valueLabel(x.key) : x._max.label || x.key,
              cost: Math.round(cost * 100) / 100,
              clicks,
              impressions,
              conversions: Math.round(conversions * 100) / 100,
              conversionValue: Math.round(Number(x._sum.conversionValue ?? 0) * 100) / 100,
              impressionShare: x._avg.impressionShare === null ? null : Math.round(Number(x._avg.impressionShare) * 1000) / 10,
              ctr: r2(pct(clicks, impressions)),
              cpc: r2(div(cost, clicks)),
              costPerConversion: r2(div(cost, conversions)),
              conversionRate: r2(pct(conversions, clicks)),
              ...(d === 'landing' ? { leads: crm?.leads ?? 0, sales: crm?.sales ?? 0, revenue: Math.round((crm?.revenue ?? 0) * 100) / 100 } : {}),
            }
          })
          .sort((a, b) => b.cost - a.cost),
      ]),
    ) as Record<DetailDimension, { key: string; name: string; cost: number; clicks: number; impressions: number; conversions: number; conversionValue: number; impressionShare: number | null; ctr: number | null; cpc: number | null; costPerConversion: number | null; conversionRate: number | null; leads?: number; sales?: number; revenue?: number }[]>
    const summary = terms.map((t) => ({
      term: t.term,
      campaignIds: campaignsOf.get(t.term) ?? [],
      cost: Math.round(Number(t._sum.cost ?? 0) * 100) / 100,
      clicks: Number(t._sum.clicks ?? 0),
      impressions: Number(t._sum.impressions ?? 0),
      conversions: Math.round(Number(t._sum.conversions ?? 0) * 100) / 100,
    }))
    const words = cfg.negativeWords ?? DEFAULT_ALERT_WORDS
    const totalCost = summary.reduce((s, t) => s + t.cost, 0)
    const suggestions = negativeSuggestions(summary, words, { minCost: Math.max(20, totalCost * 0.01), minClicks: 5 }).slice(0, 200)
    const decided = reviews.items
    const campaignName = (id: string) => names.campaigns[id] ?? id
    return {
      period: { from: p.from, to: p.to },
      syncedAt: synced.syncedAt ?? null,
      hasDetail: detail.length > 0,
      dimensions: dims,
      dimensionLabels: DIMENSION_LABEL,
      terms: summary.slice(0, 300).map((t) => ({ ...t, ctr: r2(pct(t.clicks, t.impressions)), cpc: r2(div(t.cost, t.clicks)), campaigns: t.campaignIds.map(campaignName), review: decided[t.term] ?? null })),
      suggestions: suggestions.map((s) => ({ ...s, campaigns: s.campaignIds.map(campaignName), review: decided[s.term] ?? null })),
      negatives: Object.entries(decided)
        .filter(([, v]) => v.status === 'negativar')
        .map(([term, v]) => ({ term, ...v })),
      alertWords: words,
    }
  }

  async reviewTerm(user: AuthUser, term: string, status: TermDecision | null, ctx: RequestCtx) {
    const t = term.trim().toLowerCase().slice(0, 300)
    if (!t) throw new BadRequestException('Termo vazio.')
    const s = await this.settings.get<TermReviews>(user.tenantId, TERMS_KEY, { items: {} })
    const items = { ...s.items }
    if (status) items[t] = { status, by: user.name, at: new Date().toISOString() }
    else delete items[t]
    if (Object.keys(items).length > 5000) throw new BadRequestException('Limite de 5.000 termos revisados.')
    await this.settings.set(user.tenantId, TERMS_KEY, { items })
    await this.audit.byUser(user, ctx, 'marketing.search_term_reviewed', 'settings', TERMS_KEY, { termo: t, decisao: status ?? 'desfeita' })
    return { term: t, review: items[t] ?? null }
  }

  // ---------- Meta Ads e TikTok Ads ----------

  async ads(tenantId: string, platform: 'meta' | 'tiktok', q: { from?: string; to?: string; campaignId?: string }) {
    const p = periods(q.from, q.to)
    const range = { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) }
    const camp = q.campaignId && /^\d{1,30}$/.test(q.campaignId) ? q.campaignId : undefined
    const fatigueFrom = new Date(Date.parse(`${p.to}T00:00:00Z`) - 14 * 86_400_000)
    const [rows, recentAds, breakdowns, integ, states, analysis] = await Promise.all([
      this.prisma.mktAdDay.findMany({ where: { tenantId, platform, date: range, ...(camp ? { campaignId: camp } : {}) } }),
      this.prisma.mktAdDay.findMany({ where: { tenantId, platform, level: 'ad', date: { gte: fatigueFrom, lte: range.lte }, ...(camp ? { campaignId: camp } : {}) } }),
      this.prisma.mktAdBreakdownDay.groupBy({ by: ['dimension', 'key'], where: { tenantId, platform, date: range, ...(camp ? { campaignId: camp } : {}) }, _sum: { spend: true, impressions: true, clicks: true, leads: true } }),
      this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS),
      this.settings.get<SyncStates>(tenantId, SYNC_KEY, {}),
      this.mkt.analyze(tenantId, { from: p.from, to: p.to, filters: { platform, ...(camp ? { campaignId: camp } : {}) } }),
    ])
    const toDay = (r: (typeof rows)[number]): MediaDay => ({
      entityId: r.entityId, name: r.name, campaignId: r.campaignId, campaignName: r.campaignName, parentId: r.parentId, objective: r.objective, date: day(r.date),
      spend: Number(r.spend), impressions: r.impressions, reach: r.reach, clicks: r.clicks, leads: r.leads, conversations: r.conversations, conversions: Number(r.conversions), videoViews: r.videoViews, creative: r.creative,
    })
    const of = (level: string) => rows.filter((r) => r.level === level).map(toDay)
    const campaigns = aggregateMedia(of('campaign'))
    // Resultado do CRM por campanha (pelo utm_campaign do link): leads, vendas e faturamento confirmados.
    const crm = new Map(analysis.byCampaign.map((c) => [c.key, c]))
    const key = platform === 'meta' ? 'metaAds' : 'tiktok'
    const conf = { ...DEFAULT_INTEGRATIONS, ...integ }[key]
    const sum = (k: 'spend' | 'impressions' | 'clicks' | 'leads' | 'conversations' | 'conversions') => campaigns.reduce((s, c) => s + c[k], 0)
    return {
      period: { from: p.from, to: p.to },
      connected: conf.enabled,
      sync: states[key] ?? null,
      totals: {
        spend: Math.round(sum('spend') * 100) / 100,
        impressions: sum('impressions'),
        clicks: sum('clicks'),
        leads: sum('leads'),
        conversations: sum('conversations'),
        conversions: Math.round(sum('conversions') * 100) / 100,
        ctr: r2(pct(sum('clicks'), sum('impressions'))),
        cpc: r2(div(sum('spend'), sum('clicks'))),
        cpm: sum('impressions') ? r2((sum('spend') / sum('impressions')) * 1000) : null,
        crmLeads: analysis.now.leads,
        crmSales: analysis.now.sales,
        crmRevenue: analysis.now.revenue,
        roas: analysis.now.roas,
        cpl: analysis.now.cpl,
      },
      series: analysis.series,
      campaigns: campaigns.map((c) => {
        const k = crm.get(c.entityId)
        return { ...c, crmLeads: k?.leads ?? 0, crmSales: k?.sales ?? 0, crmRevenue: k?.revenue ?? 0, crmCpl: r2(div(c.spend, k?.leads ?? 0)), roas: r2(div(k?.revenue ?? 0, c.spend)) }
      }),
      adsets: aggregateMedia(of('adset')),
      ads: aggregateMedia(of('ad')),
      fatigue: fatigue(recentAds.map(toDay), p.to),
      breakdowns: ['placement', 'device', 'region', 'age_gender'].map((d) => ({
        dimension: d,
        rows: breakdowns
          .filter((b) => b.dimension === d)
          .map((b) => {
            const spend = Number(b._sum.spend ?? 0)
            const clicks = Number(b._sum.clicks ?? 0)
            const impressions = Number(b._sum.impressions ?? 0)
            const leads = Number(b._sum.leads ?? 0)
            return { key: b.key, spend: Math.round(spend * 100) / 100, impressions, clicks, leads, ctr: r2(pct(clicks, impressions)), cpc: r2(div(spend, clicks)), cpl: r2(div(spend, leads)) }
          })
          .sort((a, b) => b.spend - a.spend),
      })),
      crmUnattributed: analysis.byCampaign.find((c) => c.key === '-')?.leads ?? 0,
    }
  }

  // ---------- SEO e site ----------

  async seo(tenantId: string, q: { from?: string; to?: string }) {
    const p = periods(q.from, q.to)
    const range = { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) }
    const prevRange = { gte: new Date(`${p.prevFrom}T00:00:00Z`), lte: new Date(`${p.prevTo}T00:00:00Z`) }
    const [rows, prevTotals, names, states, integ, records, orders] = await Promise.all([
      this.prisma.mktSeoDay.findMany({ where: { tenantId, date: range }, select: { date: true, kind: true, key: true, clicks: true, impressions: true, position: true } }),
      this.prisma.mktSeoDay.findMany({ where: { tenantId, date: prevRange, kind: 'total' }, select: { clicks: true, impressions: true, position: true, key: true } }),
      this.mkt.names(tenantId),
      this.settings.get<SyncStates>(tenantId, SYNC_KEY, {}),
      this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS),
      this.prisma.serviceRecord.findMany({ where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, leadAt: { gte: p.start, lt: p.end }, entryPage: { not: null } }, select: { entryPage: true, saleStatus: true, saleValue: true, adsVia: true } }),
      this.prisma.ecommerceOrder.aggregate({ where: { tenantId, orderedAt: { gte: p.start, lt: p.end } }, _sum: { total: true }, _count: true }),
    ])
    const plain = rows.map((r) => ({ ...r, position: Number(r.position) }))
    const total = aggregateSeo(plain.filter((r) => r.kind === 'total'))[0] ?? null
    const before = aggregateSeo(prevTotals.map((r) => ({ ...r, position: Number(r.position) })))[0] ?? null
    const queries = aggregateSeo(plain.filter((r) => r.kind === 'query'))
    const pages = aggregateSeo(plain.filter((r) => r.kind === 'page'))
    const series = [...new Set(plain.filter((r) => r.kind === 'total').map((r) => day(r.date)))].sort().map((d) => {
      const x = plain.find((r) => r.kind === 'total' && day(r.date) === d)!
      return { day: d, label: `${d.slice(8, 10)}/${d.slice(5, 7)}`, clicks: x.clicks, impressions: x.impressions, position: x.position }
    })
    // Páginas de entrada dos leads (todas as origens; orgânico = sem anúncio), para cruzar com o Search Console.
    const entry = new Map<string, { leads: number; organic: number; sales: number; revenue: number }>()
    for (const r of records) {
      const k = pagePath(r.entryPage)
      if (!k) continue
      const m = entry.get(k) ?? { leads: 0, organic: 0, sales: 0, revenue: 0 }
      m.leads++
      if (!r.adsVia) m.organic++
      if (r.saleStatus === 'SIM') {
        m.sales++
        m.revenue += Number(r.saleValue ?? 0)
      }
      entry.set(k, m)
    }
    const brands = names.items.filter((i) => i.type === 'MARCA' && i.active).map((i) => i.name)
    const parts = names.items.filter((i) => i.type === 'TIPO_PECA' && i.active).map((i) => i.name)
    const sc = { ...DEFAULT_INTEGRATIONS, ...integ }.searchConsole
    return {
      period: { from: p.from, to: p.to, prevFrom: p.prevFrom, prevTo: p.prevTo },
      connected: sc.enabled,
      sync: states.searchConsole ?? null,
      totals: total,
      before,
      series,
      queries: queries.slice(0, 200),
      pages: pages.slice(0, 200).map((pg) => ({ ...pg, crm: entry.get(pagePath(pg.key) ?? '') ?? null })),
      opportunities: seoOpportunities(queries).slice(0, 50),
      byBrand: { queries: groupByNames(queries, brands), pages: groupByNames(pages, brands) },
      byPartType: { queries: groupByNames(queries, parts), pages: groupByNames(pages, parts) },
      entryPages: [...entry.entries()].map(([path, m]) => ({ path, ...m, revenue: Math.round(m.revenue * 100) / 100 })).sort((a, b) => b.leads - a.leads).slice(0, 100),
      ecommerce: { orders: orders._count, revenue: Math.round(Number(orders._sum.total ?? 0) * 100) / 100 },
    }
  }

  // ---------- Redes sociais ----------

  async social(tenantId: string, q: { from?: string; to?: string }) {
    const p = periods(q.from, q.to)
    const range = { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) }
    const [profileDays, posts, names, states, integ, paid] = await Promise.all([
      this.prisma.mktSocialProfileDay.findMany({ where: { tenantId, date: { gte: new Date(Date.parse(`${p.from}T00:00:00Z`) - 7 * 86_400_000), lte: range.lte } }, orderBy: { date: 'asc' } }),
      // Stories têm métricas próprias (tela Instagram): fora do ranking de publicações.
      this.prisma.mktSocialPost.findMany({ where: { tenantId, publishedAt: { gte: p.start, lt: p.end }, format: { not: 'Story' } }, orderBy: { publishedAt: 'desc' }, take: 500 }),
      this.mkt.names(tenantId),
      this.settings.get<SyncStates>(tenantId, SYNC_KEY, {}),
      this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS),
      this.prisma.mktAdDay.aggregate({ where: { tenantId, platform: 'meta', level: 'campaign', date: range }, _sum: { spend: true, impressions: true, clicks: true, leads: true } }),
    ])
    // Melhores horários: últimos 90 dias (mais publicações dão uma leitura mais firme do que só o período).
    const [timed, igAccounts] = await Promise.all([
      this.prisma.mktSocialPost.findMany({ where: { tenantId, publishedAt: { gte: new Date(Date.now() - 90 * 86_400_000) }, format: { not: 'Story' } }, select: { network: true, publishedAt: true, format: true, reach: true, likes: true, comments: true, shares: true, saves: true }, take: 3000 }),
      this.settings.get<{ list?: unknown }>(tenantId, IG_ACCOUNTS_KEY, {}),
    ])
    const igLabels = new Map(cleanIgAccounts(igAccounts.list).map((a) => [a.id, a.label]))
    const networks = [...new Set(profileDays.map((d) => `${d.network}|${d.profileId}`))].map((k) => {
      const [network, profileId] = k.split('|') as [string, string]
      const list = profileDays.filter((d) => d.network === network && d.profileId === profileId)
      const inPeriod = list.filter((d) => day(d.date) >= p.from)
      const withFollowers = list.filter((d) => d.followers !== null)
      const first = withFollowers.find((d) => day(d.date) >= p.from) ?? withFollowers[0]
      const last = withFollowers[withFollowers.length - 1]
      const sumOf = (k2: 'reach' | 'impressions' | 'profileViews' | 'websiteClicks') => (inPeriod.some((d) => d[k2] !== null) ? inPeriod.reduce((s, d) => s + (d[k2] ?? 0), 0) : null)
      return {
        network,
        profileId,
        label: network === 'facebook' ? 'Facebook' : (igLabels.get(profileId) ?? 'Instagram (oficial)'),
        followers: last?.followers ?? null,
        followersGrowth: first && last && first !== last ? (last.followers ?? 0) - (first.followers ?? 0) : null,
        reach: sumOf('reach'),
        impressions: sumOf('impressions'),
        profileViews: sumOf('profileViews'),
        websiteClicks: sumOf('websiteClicks'),
        series: inPeriod.map((d) => ({ day: day(d.date), label: `${day(d.date).slice(8, 10)}/${day(d.date).slice(5, 7)}`, followers: d.followers, reach: d.reach })),
      }
    })
    const ranked = rankPosts(posts)
    const themeNames = names.items.filter((i) => (i.type === 'MARCA' || i.type === 'TIPO_PECA') && i.active).map((i) => i.name)
    const themes = new Map<string, { posts: number; engagement: number; reach: number }>()
    for (const post of ranked) {
      for (const t of themesOf(post.caption, themeNames)) {
        const m = themes.get(t) ?? { posts: 0, engagement: 0, reach: 0 }
        m.posts++
        m.engagement += post.engagement
        m.reach += post.reach ?? 0
        themes.set(t, m)
      }
    }
    const conf = { ...DEFAULT_INTEGRATIONS, ...integ }.metaOrganic
    const organicReach = networks.reduce((s, n) => s + (n.reach ?? 0), 0)
    return {
      period: { from: p.from, to: p.to },
      connected: conf.enabled,
      sync: states.metaOrganic ?? null,
      networks,
      posts: ranked.slice(0, 100),
      worst: [...ranked].filter((x) => x.engagementRate !== null).reverse().slice(0, 10),
      byFormat: byFormat(ranked),
      byTheme: [...themes.entries()].map(([theme, m]) => ({ theme, ...m, avgEngagement: Math.round(m.engagement / m.posts) })).sort((a, b) => b.avgEngagement - a.avgEngagement),
      postsPerWeek: r2((posts.length / Math.max(1, p.days)) * 7),
      times: (['instagram', 'facebook'] as const).map((network) => ({ network, ...postTimes(timed.filter((x) => x.network === network)) })),
      organicVsPaid: { organicReach: networks.length ? organicReach : null, paidImpressions: Number(paid._sum.impressions ?? 0), paidSpend: Math.round(Number(paid._sum.spend ?? 0) * 100) / 100, paidClicks: Number(paid._sum.clicks ?? 0), paidLeads: Number(paid._sum.leads ?? 0) },
    }
  }

  // ---------- Calendário editorial ----------

  async editorial(tenantId: string, q: { from?: string; to?: string }) {
    const p = periods(q.from, q.to)
    const items = await this.prisma.mktEditorialItem.findMany({ where: { tenantId, deletedAt: null, plannedAt: { gte: p.start, lt: p.end } }, orderBy: { plannedAt: 'asc' }, take: 500 })
    const users = await this.prisma.user.findMany({ where: { tenantId, id: { in: [...new Set(items.map((i) => i.ownerId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })
    const owners = await this.prisma.user.findMany({ where: { tenantId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 })
    const nameOf = new Map(users.map((u) => [u.id, u.name]))
    return { items: items.map((i) => ({ ...i, ownerName: i.ownerId ? (nameOf.get(i.ownerId) ?? null) : null })), owners, statuses: EDITORIAL_STATUS, networks: EDITORIAL_NETWORKS }
  }

  async saveEditorial(user: AuthUser, id: string | null, input: Record<string, unknown>, ctx: RequestCtx) {
    const title = String(input.title ?? '').trim().slice(0, 200)
    if (!title) throw new BadRequestException('Dê um título à publicação.')
    const plannedAt = new Date(String(input.plannedAt ?? ''))
    if (Number.isNaN(plannedAt.getTime())) throw new BadRequestException('Informe a data planejada.')
    const network = (EDITORIAL_NETWORKS as readonly string[]).includes(String(input.network)) ? String(input.network) : 'instagram'
    const status = (EDITORIAL_STATUS as readonly string[]).includes(String(input.status)) ? String(input.status) : 'ideia'
    const ownerId = typeof input.ownerId === 'string' && /^[0-9a-f-]{36}$/.test(input.ownerId) ? input.ownerId : null
    if (ownerId && !(await this.prisma.user.findFirst({ where: { id: ownerId, tenantId: user.tenantId }, select: { id: true } }))) throw new BadRequestException('Responsável não encontrado.')
    const postUrl = String(input.postUrl ?? '').trim()
    if (postUrl && !/^https:\/\/\S{4,500}$/.test(postUrl)) throw new BadRequestException('Link da publicação inválido (use https://...).')
    const data = {
      title,
      network,
      format: String(input.format ?? 'Imagem').trim().slice(0, 40) || 'Imagem',
      theme: String(input.theme ?? '').trim().slice(0, 80) || null,
      ownerId,
      plannedAt,
      status,
      postUrl: postUrl || null,
      notes: String(input.notes ?? '').trim().slice(0, 2000) || null,
    }
    const saved = id
      ? await this.prisma.mktEditorialItem.update({ where: { id: (await this.ownEditorial(user, id)).id }, data })
      : await this.prisma.mktEditorialItem.create({ data: { ...data, tenantId: user.tenantId, createdById: user.id } })
    await this.audit.byUser(user, ctx, id ? 'marketing.editorial_updated' : 'marketing.editorial_created', 'mkt_editorial_item', saved.id, { titulo: title, situacao: status, rede: network })
    return saved
  }

  async removeEditorial(user: AuthUser, id: string, ctx: RequestCtx) {
    const item = await this.ownEditorial(user, id)
    await this.prisma.mktEditorialItem.update({ where: { id: item.id }, data: { deletedAt: new Date() } })
    await this.audit.byUser(user, ctx, 'marketing.editorial_removed', 'mkt_editorial_item', id, { titulo: item.title })
    return { ok: true }
  }

  private async ownEditorial(user: AuthUser, id: string) {
    const item = await this.prisma.mktEditorialItem.findFirst({ where: { id, tenantId: user.tenantId, deletedAt: null } })
    if (!item) throw new NotFoundException('Publicação não encontrada.')
    return item
  }
}
