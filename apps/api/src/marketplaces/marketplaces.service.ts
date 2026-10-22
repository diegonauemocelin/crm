import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { type AdTotals, delta, derive, MARKETPLACE, mlView, previousPeriod } from './mercadolivre'
import { MercadoLivreService } from './mercadolivre.service'

const SUM = { impressions: true, clicks: true, cost: true, revenue: true, directRevenue: true, indirectRevenue: true, units: true, items: true, pageViews: true, addToCart: true, checkouts: true } as const

type Sums = Partial<Record<keyof typeof SUM, unknown>> | null | undefined
const n = (v: unknown) => Number(v ?? 0) || 0
const totals = (s: Sums): AdTotals & { pageViews: number; addToCart: number; checkouts: number } => ({
  impressions: n(s?.impressions),
  clicks: n(s?.clicks),
  cost: Math.round(n(s?.cost) * 100) / 100,
  revenue: Math.round(n(s?.revenue) * 100) / 100,
  directRevenue: Math.round(n(s?.directRevenue) * 100) / 100,
  indirectRevenue: Math.round(n(s?.indirectRevenue) * 100) / 100,
  units: n(s?.units),
  items: n(s?.items),
  pageViews: n(s?.pageViews),
  addToCart: n(s?.addToCart),
  checkouts: n(s?.checkouts),
})
const add = (a: ReturnType<typeof totals>, b: ReturnType<typeof totals>) => totals(Object.fromEntries(Object.keys(SUM).map((k) => [k, n(a[k as keyof typeof a]) + n(b[k as keyof typeof b])])))
const day = (d: Date) => d.toISOString().slice(0, 10)
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Canal de venda da Magazord que é marketplace (o resto é site, PDV, manual). */
export const isMarketplaceChannel = (name: string | null) => !!name && /mercado|shopee|amazon|magalu|magazine|americanas|via\b|casas bahia|carrefour|olist|netshoes|shein|tiktok|aliexpress|marketplace/i.test(name)

/** Painéis de Marketplaces (Mercado Livre agora; Shopee depois), a partir do que foi sincronizado ou trazido do BI. */
@Injectable()
export class MarketplacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: MercadoLivreService,
  ) {}

  private range(from: string, to: string) {
    return { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }
  }

  private async byProduct(tenantId: string, from: string, to: string, campaignId?: string) {
    const g = await this.prisma.marketplaceAdDay.groupBy({
      by: ['product'],
      where: { tenantId, marketplace: MARKETPLACE, level: 'campaign', date: this.range(from, to), ...(campaignId ? { campaignId } : {}) },
      _sum: SUM,
    })
    const pads = totals(g.find((x) => x.product === 'product_ads')?._sum)
    const display = totals(g.find((x) => x.product === 'display')?._sum)
    return { pads, display, all: add(pads, display) }
  }

  async mercadoLivre(tenantId: string, from: string, to: string, campaignId?: string) {
    const prev = previousPeriod(from, to)
    const [config, sync, now, before, seriesRaw, campaignRows, adRows, coverage] = await Promise.all([
      this.ml.config(tenantId),
      this.ml.syncState(tenantId),
      this.byProduct(tenantId, from, to, campaignId),
      this.byProduct(tenantId, prev.from, prev.to, campaignId),
      this.prisma.marketplaceAdDay.groupBy({ by: ['date', 'product'], where: { tenantId, marketplace: MARKETPLACE, level: 'campaign', date: this.range(from, to), ...(campaignId ? { campaignId } : {}) }, _sum: { cost: true, revenue: true, clicks: true } }),
      this.prisma.marketplaceAdDay.groupBy({ by: ['product', 'entityId'], where: { tenantId, marketplace: MARKETPLACE, level: 'campaign', date: this.range(from, to) }, _sum: SUM }),
      this.prisma.marketplaceAdDay.groupBy({ by: ['entityId'], where: { tenantId, marketplace: MARKETPLACE, level: 'ad', date: this.range(from, to), ...(campaignId ? { campaignId } : {}) }, _sum: SUM, orderBy: { _sum: { cost: 'desc' } }, take: 200 }),
      this.prisma.marketplaceAdDay.aggregate({ where: { tenantId, marketplace: MARKETPLACE }, _min: { date: true }, _max: { date: true }, _count: { _all: true } }),
    ])
    const [campaigns, ads] = await Promise.all([
      this.prisma.marketplaceCampaign.findMany({ where: { tenantId, marketplace: MARKETPLACE } }),
      this.prisma.marketplaceAd.findMany({ where: { tenantId, marketplace: MARKETPLACE, adId: { in: adRows.map((a) => a.entityId) } } }),
    ])
    const campaignName = new Map(campaigns.map((c) => [`${c.product}|${c.campaignId}`, c]))
    const nameOf = (id: string | null) => (id ? (campaignName.get(`product_ads|${id}`)?.name ?? null) : null)

    // Série diária (mensal acima de 62 dias), separando Product Ads e Display.
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
    const monthly = days > 62
    const buckets = new Map<string, { bucket: string; label: string; padsCost: number; displayCost: number; revenue: number; clicks: number }>()
    for (const r of seriesRaw) {
      const k = monthly ? day(r.date).slice(0, 7) : day(r.date)
      const label = monthly ? `${MONTHS[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}` : `${k.slice(8, 10)}/${k.slice(5, 7)}`
      const b = buckets.get(k) ?? { bucket: k, label, padsCost: 0, displayCost: 0, revenue: 0, clicks: 0 }
      if (r.product === 'display') b.displayCost += n(r._sum.cost)
      else b.padsCost += n(r._sum.cost)
      b.revenue += n(r._sum.revenue)
      b.clicks += n(r._sum.clicks)
      buckets.set(k, b)
    }
    const series = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).map((b) => ({ ...b, padsCost: Math.round(b.padsCost * 100) / 100, displayCost: Math.round(b.displayCost * 100) / 100, revenue: Math.round(b.revenue * 100) / 100 }))

    const sums = new Map(campaignRows.map((r) => [`${r.product}|${r.entityId}`, r._sum]))
    const campaignList = (product: 'product_ads' | 'display') =>
      campaigns
        .filter((c) => c.product === product)
        .map((c) => ({
          id: c.campaignId,
          name: c.name,
          status: c.status,
          strategy: c.strategy,
          budget: c.budget === null ? null : Number(c.budget),
          roasTarget: c.roasTarget === null ? null : Number(c.roasTarget),
          acosTarget: c.acosTarget === null ? null : Number(c.acosTarget),
          startDate: c.startDate ? day(c.startDate) : null,
          endDate: c.endDate ? day(c.endDate) : null,
          ...derive(totals(sums.get(`${product}|${c.campaignId}`))),
        }))
        .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name))

    const adInfo = new Map(ads.map((a) => [a.adId, a]))
    const adList = adRows.map((r) => {
      const a = adInfo.get(r.entityId)
      return { id: r.entityId, title: a?.title ?? `Anúncio ${r.entityId}`, thumbnail: a?.thumbnail ?? null, externalId: a?.externalId ?? null, type: a?.type ?? null, status: a?.status ?? null, campaign: nameOf(a?.campaignId ?? null), ...derive(totals(r._sum)) }
    })

    const kpis = (k: 'pads' | 'display' | 'all') => {
      const a = derive(now[k])
      const b = derive(before[k])
      return {
        ...a,
        before: b,
        delta: { cost: delta(a.cost, b.cost), revenue: delta(a.revenue, b.revenue), clicks: delta(a.clicks, b.clicks), impressions: delta(a.impressions, b.impressions), roas: delta(a.roas, b.roas), acos: delta(a.acos, b.acos), items: delta(a.items, b.items), cpc: delta(a.cpc, b.cpc) },
      }
    }

    return {
      period: { from, to, prevFrom: prev.from, prevTo: prev.to },
      config: { ...mlView(config), redirectUri: this.ml.redirectUri() },
      sync,
      coverage: { from: coverage._min.date ? day(coverage._min.date) : null, to: coverage._max.date ? day(coverage._max.date) : null, rows: coverage._count._all },
      totals: { all: kpis('all'), pads: kpis('pads'), display: kpis('display') },
      granularity: monthly ? 'mes' : 'dia',
      series,
      campaigns: campaignList('product_ads'),
      display: campaignList('display'),
      ads: adList,
    }
  }

  /** Visão geral: publicidade de cada marketplace e as vendas por canal que a Magazord informa. */
  async overview(tenantId: string, from: string, to: string) {
    const prev = previousPeriod(from, to)
    const start = new Date(`${from}T03:00:00Z`)
    const end = new Date(Date.parse(`${to}T03:00:00Z`) + 86_400_000)
    const pStart = new Date(`${prev.from}T03:00:00Z`)
    const pEnd = new Date(Date.parse(`${prev.to}T03:00:00Z`) + 86_400_000)
    const [config, sync, now, before, channels, channelsBefore] = await Promise.all([
      this.ml.config(tenantId),
      this.ml.syncState(tenantId),
      this.byProduct(tenantId, from, to),
      this.byProduct(tenantId, prev.from, prev.to),
      this.prisma.ecommerceOrder.groupBy({ by: ['channel'], where: { tenantId, statusGroup: 'pago', orderedAt: { gte: start, lt: end } }, _count: { _all: true }, _sum: { total: true } }),
      this.prisma.ecommerceOrder.groupBy({ by: ['channel'], where: { tenantId, statusGroup: 'pago', orderedAt: { gte: pStart, lt: pEnd } }, _count: { _all: true }, _sum: { total: true } }),
    ])
    const prevBy = new Map(channelsBefore.map((c) => [c.channel ?? '', n(c._sum.total)]))
    const allRevenue = channels.reduce((s, c) => s + n(c._sum.total), 0)
    const a = derive(now.all)
    const b = derive(before.all)
    return {
      period: { from, to, prevFrom: prev.from, prevTo: prev.to },
      mercadoLivre: {
        connected: mlView(config).connected,
        status: config.status,
        nickname: config.nickname,
        sync,
        ...a,
        before: b,
        delta: { cost: delta(a.cost, b.cost), revenue: delta(a.revenue, b.revenue), roas: delta(a.roas, b.roas), acos: delta(a.acos, b.acos) },
      },
      channels: channels
        .map((c) => {
          const revenue = Math.round(n(c._sum.total) * 100) / 100
          return { name: c.channel ?? 'Sem canal informado', marketplace: isMarketplaceChannel(c.channel), orders: c._count._all, revenue, ticket: c._count._all ? Math.round((revenue / c._count._all) * 100) / 100 : null, share: allRevenue ? Math.round((revenue / allRevenue) * 1000) / 10 : null, delta: delta(revenue, prevBy.get(c.channel ?? '') ?? null) }
        })
        .sort((x, y) => y.revenue - x.revenue),
    }
  }
}
