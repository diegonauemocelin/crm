import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { ownCodes } from '../../assistente/concorrentes'
import { AuditService } from '../../audit/audit.service'
import type { RequestCtx } from '../../common/decorators'
import type { AuthUser } from '../../common/types'
import { EmailAiService } from '../../email/ia.service'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { SettingsService } from '../../settings/settings.service'
import { MARKETPLACE, ML_CONFIG_KEY, type MlConfig } from '../mercadolivre'
import { MercadoLivreService } from '../mercadolivre.service'
import { aiRetryDelay, isMlItemId } from '../seo-ml'
import { normSku, taxRateFor } from '../precos/impostos'
import { MarketplaceTaxService } from '../precos/impostos.service'
import { cleanPrecosConfig, DEFAULT_PRECOS_CONFIG, PRECOS_CONFIG_KEY, type PrecosConfig, round2 } from '../precos/margem'
import {
  abcClasses,
  addLine,
  type AuditSummary,
  auditFindings,
  catalogAlerts,
  cleanPlanConfig,
  closeDre,
  daysInMonth,
  DEFAULT_PLAN_CONFIG,
  dreCsv,
  type DreRow,
  emptyDre,
  fullSuggestion,
  goalProgress,
  isSale,
  type LineCosts,
  lineContribution,
  type MlOrder,
  monthWindows,
  orderLines,
  parsePerformance,
  parsePurchaseExperience,
  parseReputation,
  PLAN_CONFIG_KEY,
  roasOf,
  type PlanConfig,
  seasonality,
  swotPrompt,
} from './planejamento'

const SYNC_KEY = 'marketplace_planejamento_sync'
const TICK_MS = 30 * 60_000
const SYNC_EVERY_MS = 6 * 3_600_000
const DAY_MS = 86_400_000
const FULL = 'fulfillment'
/** A busca de pedidos do Mercado Livre pagina até aqui; cada janela mensal fica bem abaixo disso. */
const MAX_OFFSET = 9_950
export const CHANNELS = ['mercadolivre'] as const
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref())
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const monthOf = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 7)
const monthStart = (m: string) => new Date(`${m}-01T03:00:00Z`)
const nextMonth = (m: string) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1))
  return d.toISOString().slice(0, 7)
}

interface SyncState {
  lastRunAt?: string
  lastOkAt?: string
  lastError?: string | null
  lines?: number
  running?: boolean
}

interface ItemCtx {
  itemId: string
  title: string | null
  sku: string | null
  brand: string | null
  status: string | null
  availableQuantity: number | null
  logisticType: string | null
  listingType: string | null
  price: number | null
  costs: LineCosts
}

/**
 * Marketplaces › Planejamento (Mercado Livre): guarda os pedidos da conta (sincronização a cada 6 horas), e com eles
 * monta a curva ABC, os alertas do catálogo, as metas, a sugestão de Full, a sazonalidade e o DRE. Custos, impostos e
 * a configuração de margem são os de Preços e promoções. Nada é alterado no Mercado Livre por esta tela.
 */
@Injectable()
export class PlanejamentoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlanejamentoService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private readonly syncing = new Set<string>()
  private readonly qualityJobs = new Map<string, { total: number; done: number; errors: number; lastError: string | null }>()
  gapMs = 150

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly ml: MercadoLivreService,
    private readonly taxes: MarketplaceTaxService,
    private readonly ai: EmailAiService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async tick(now = Date.now()) {
    if (this.busy) return
    this.busy = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: ML_CONFIG_KEY }, select: { tenantId: true, value: true } })
      for (const row of rows) {
        const c = row.value as Partial<MlConfig> | null
        if (c?.status !== 'CONECTADO' || !c.userId) continue
        const st = await this.syncState(row.tenantId)
        if (now - (st.lastRunAt ? Date.parse(st.lastRunAt) : 0) < SYNC_EVERY_MS) continue
        await this.syncOrders(row.tenantId).catch((e: unknown) => this.logger.warn(`Pedidos do Mercado Livre: ${(e as Error).message}`))
      }
    } finally {
      this.busy = false
    }
  }

  private async seller(tenantId: string) {
    const c = await this.ml.config(tenantId)
    if (c.status === 'DESCONECTADO' || !c.refreshTokenEnc || !c.userId) throw new BadRequestException('Conecte o Mercado Livre em Configurações › Marketplaces › Conexões dos marketplaces.')
    return c.userId
  }

  async syncState(tenantId: string) {
    return this.settings.get<SyncState>(tenantId, SYNC_KEY, {})
  }

  async planConfig(tenantId: string): Promise<PlanConfig> {
    return cleanPlanConfig(await this.settings.get<Partial<PlanConfig>>(tenantId, PLAN_CONFIG_KEY, {}), DEFAULT_PLAN_CONFIG)
  }

  async savePlanConfig(user: AuthUser, raw: Partial<Record<keyof PlanConfig, unknown>>, ctx: RequestCtx) {
    const next = cleanPlanConfig(raw, await this.planConfig(user.tenantId))
    await this.settings.set(user.tenantId, PLAN_CONFIG_KEY, next)
    await this.audit.byUser(user, ctx, 'marketplace_planejamento.configuracao', 'setting', undefined, next as unknown as Record<string, unknown>)
    return next
  }

  private async precosConfig(tenantId: string): Promise<PrecosConfig> {
    return cleanPrecosConfig(await this.settings.get<Partial<PrecosConfig>>(tenantId, PRECOS_CONFIG_KEY, {}), DEFAULT_PRECOS_CONFIG)
  }

  // ---------- Pedidos ----------

  /** Pedido do usuário: sincroniza agora, em segundo plano. */
  async syncNow(user: AuthUser) {
    await this.seller(user.tenantId)
    if (this.syncing.has(user.tenantId)) throw new BadRequestException('A leitura dos pedidos já está em andamento.')
    void this.syncOrders(user.tenantId).catch((e: unknown) => this.logger.warn(`Pedidos do Mercado Livre: ${(e as Error).message}`))
    return { ok: true, message: 'Lendo os pedidos do Mercado Livre (na primeira vez, os últimos 12 meses). Leva alguns minutos.' }
  }

  /**
   * Lê os pedidos (/orders/search) mês a mês. Na primeira vez, os 12 meses que o Mercado Livre guarda; depois, os
   * últimos 20 dias de novo (pedidos que mudaram) e os cancelados da mesma janela (a busca do vendedor esconde os
   * cancelados, então eles são pedidos à parte para marcar a linha).
   */
  async syncOrders(tenantId: string) {
    if (this.syncing.has(tenantId)) return
    this.syncing.add(tenantId)
    const st = await this.syncState(tenantId)
    await this.settings.set(tenantId, SYNC_KEY, { ...st, running: true, lastRunAt: new Date().toISOString() })
    let lines = 0
    try {
      const seller = await this.seller(tenantId)
      const to = new Date()
      const from = st.lastOkAt ? new Date(Date.parse(st.lastOkAt) - 20 * DAY_MS) : new Date(to.getTime() - 365 * DAY_MS)
      for (const w of monthWindows(from, to)) {
        for (const status of [null, 'cancelled'] as const) {
          for (let offset = 0; offset <= MAX_OFFSET; offset += 50) {
            const r = await this.ml.apiGet<{ results?: MlOrder[]; paging?: { total?: number } }>(tenantId, '/orders/search', {
              seller,
              'order.date_created.from': w.from.toISOString(),
              'order.date_created.to': w.to.toISOString(),
              ...(status ? { 'order.status': status } : {}),
              sort: 'date_asc',
              offset,
              limit: 50,
            })
            for (const o of r.results ?? []) {
              for (const l of orderLines(o)) {
                const data = { title: l.title, sellerSku: l.sellerSku, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total, saleFee: l.saleFee, listingTypeId: l.listingTypeId, status: l.status, dateCreated: l.dateCreated, dateClosed: l.dateClosed, shippingId: l.shippingId }
                await this.prisma.marketplaceOrderLine.upsert({
                  where: { tenantId_orderId_itemId_variationId: { tenantId, orderId: l.orderId, itemId: l.itemId, variationId: l.variationId } },
                  create: { tenantId, marketplace: MARKETPLACE, orderId: l.orderId, itemId: l.itemId, variationId: l.variationId, ...data },
                  update: data,
                })
                lines++
              }
            }
            if (offset + 50 >= (r.paging?.total ?? 0)) break
            await sleep(this.gapMs)
          }
        }
      }
      await this.settings.set(tenantId, SYNC_KEY, { lastRunAt: new Date().toISOString(), lastOkAt: to.toISOString(), lastError: null, lines, running: false })
    } catch (e) {
      await this.settings.set(tenantId, SYNC_KEY, { ...(await this.syncState(tenantId)), running: false, lastError: (e as Error).message.slice(0, 300), lines })
      throw e
    } finally {
      this.syncing.delete(tenantId)
    }
  }

  // ---------- Base de custos ----------

  /** Por anúncio: custo, imposto, frete e tarifa (os mesmos de Preços e promoções). */
  private async itemContext(tenantId: string) {
    const [cfg, rates, costs, snaps, assist] = await Promise.all([
      this.precosConfig(tenantId),
      this.taxes.rates(tenantId),
      this.prisma.marketplaceCost.findMany({ where: { tenantId }, select: { sku: true, cost: true } }),
      this.prisma.marketplacePriceItem.findMany({ where: { tenantId } }),
      this.prisma.assistItem.findMany({ where: { tenantId }, select: { id: true, title: true, brand: true, sellerSku: true, status: true, availableQuantity: true, attributes: true, partNumber: true, price: true } }),
    ])
    const costBy = new Map(costs.map((c) => [c.sku, Number(c.cost)]))
    const aBy = new Map(assist.map((a) => [a.id, a]))
    const sBy = new Map(snaps.map((s) => [s.itemId, s]))
    const costsFor = (itemId: string, skuRaw: string | null): LineCosts => {
      const s = sBy.get(itemId)
      const sku = (skuRaw ?? s?.sellerSku ?? aBy.get(itemId)?.sellerSku ?? '').trim() || null
      const tax = taxRateFor(sku, null, rates, cfg.taxPct, cfg.useNfeTaxes)
      const unitCost = costBy.get(sku ? normSku(sku) : itemId) ?? null
      const shippingPerUnit = !s ? null : !s.freeShipping ? 0 : num(s.shippingCost)
      return { shippingPerUnit, taxPct: tax.pct, unitCost, extraPct: cfg.extraFeePct, fixedCostPerSale: cfg.fixedCostPerSale, feePct: num(s?.saleFeePct) }
    }
    const ids = new Set([...sBy.keys(), ...aBy.keys()])
    const items = new Map<string, ItemCtx>()
    for (const id of ids) {
      const s = sBy.get(id)
      const a = aBy.get(id)
      items.set(id, {
        itemId: id,
        title: s?.title ?? a?.title ?? null,
        sku: s?.sellerSku ?? a?.sellerSku ?? null,
        brand: a?.brand ?? null,
        status: s?.status ?? a?.status ?? null,
        availableQuantity: s?.availableQuantity ?? a?.availableQuantity ?? null,
        logisticType: s?.logisticType ?? null,
        listingType: s?.listingTypeId ?? null,
        price: num(s?.price) ?? num(a?.price),
        costs: costsFor(id, null),
      })
    }
    return { cfg, items, costsFor, assist }
  }

  private async lines(tenantId: string, from: Date, to?: Date) {
    return this.prisma.marketplaceOrderLine.findMany({
      where: { tenantId, dateCreated: { gte: from, ...(to ? { lt: to } : {}) } },
      select: { orderId: true, itemId: true, sellerSku: true, title: true, quantity: true, total: true, saleFee: true, status: true, dateCreated: true },
    })
  }

  // ---------- Curva ABC e saúde do catálogo ----------

  async abc(user: AuthUser, days: number) {
    const T = user.tenantId
    const win = [60, 90, 180].includes(days) ? days : 90
    const since = new Date(Date.now() - win * DAY_MS)
    const [ctx, plan, lines, lastSales, quality, sync] = await Promise.all([
      this.itemContext(T),
      this.planConfig(T),
      this.lines(T, since),
      this.prisma.marketplaceOrderLine.groupBy({ by: ['itemId'], where: { tenantId: T, status: { notIn: ['cancelled', 'invalid'] } }, _max: { dateCreated: true } }),
      this.prisma.marketplaceItemQuality.findMany({ where: { tenantId: T } }),
      this.syncState(T),
    ])
    const agg = new Map<string, { units: number; revenue: number; contribution: number; orders: Set<string>; missingCost: boolean }>()
    for (const l of lines) {
      if (!isSale(l.status)) continue
      const c = ctx.items.get(l.itemId)?.costs ?? ctx.costsFor(l.itemId, l.sellerSku)
      const r = lineContribution({ total: Number(l.total), quantity: l.quantity, saleFee: num(l.saleFee) }, c)
      const a = agg.get(l.itemId) ?? { units: 0, revenue: 0, contribution: 0, orders: new Set<string>(), missingCost: false }
      a.units += l.quantity
      a.revenue += r.revenue
      a.contribution += r.contribution
      a.orders.add(l.orderId)
      if (r.missingCost || r.missingTax) a.missingCost = true
      agg.set(l.itemId, a)
    }
    const lastBy = new Map(lastSales.map((s) => [s.itemId, s._max.dateCreated]))
    const titleBy = new Map(lines.map((l) => [l.itemId, l.title]))
    const qBy = new Map(quality.map((q) => [q.itemId, q]))
    const ids = new Set([...[...ctx.items.values()].filter((i) => i.status === 'active' || i.status === 'paused').map((i) => i.itemId), ...agg.keys()])
    const byRevenue = abcClasses([...ids].map((id) => ({ id, value: agg.get(id)?.revenue ?? 0 })))
    const byMargin = abcClasses([...ids].map((id) => ({ id, value: agg.get(id)?.missingCost ? 0 : (agg.get(id)?.contribution ?? 0) })))
    const now = Date.now()
    const rows = [...ids].map((id) => {
      const i = ctx.items.get(id)
      const a = agg.get(id)
      const last = lastBy.get(id) ?? null
      const marginPct = a && a.revenue > 0 && !a.missingCost ? round2((a.contribution / a.revenue) * 100) : null
      const q = qBy.get(id)
      return {
        id,
        title: i?.title ?? titleBy.get(id) ?? id,
        sku: i?.sku ?? null,
        brand: i?.brand ?? null,
        status: i?.status ?? null,
        stock: i?.availableQuantity ?? null,
        full: i?.logisticType === FULL,
        units: a?.units ?? 0,
        orders: a?.orders.size ?? 0,
        revenue: round2(a?.revenue ?? 0),
        contribution: a ? round2(a.contribution) : null,
        marginPct,
        marginIncomplete: !!a?.missingCost,
        lastSaleAt: last,
        classRevenue: byRevenue.get(id)!,
        classMargin: byMargin.get(id)!,
        quality: q ? { score: q.score, level: q.levelWording ?? q.level, pending: (q.pending as { area: string; text: string; warning: boolean }[] | null) ?? [], experience: q.experienceText, experienceColor: q.experienceColor, problems: q.problems, syncedAt: q.syncedAt, error: q.error } : null,
        alerts: catalogAlerts({
          status: i?.status ?? null,
          availableQuantity: i?.availableQuantity ?? null,
          unitsInWindow: a?.units ?? 0,
          windowDays: win,
          daysSinceLastSale: last ? Math.floor((now - last.getTime()) / DAY_MS) : null,
          stalledDays: plan.stalledDays,
          marginPct,
          minMarginPct: ctx.cfg.minMarginPct,
        }),
      }
    })
    rows.sort((a, b) => b.revenue - a.revenue || a.title.localeCompare(b.title, 'pt-BR'))
    const sum = (cls: string, k: 'classRevenue' | 'classMargin') => {
      const r = rows.filter((x) => x[k] === cls)
      return { items: r.length, revenue: round2(r.reduce((s, x) => s + x.revenue, 0)), contribution: round2(r.reduce((s, x) => s + (x.contribution ?? 0), 0)) }
    }
    return {
      days: win,
      sync,
      syncing: this.syncing.has(T),
      quality: this.qualityJobs.get(T) ?? null,
      minMarginPct: ctx.cfg.minMarginPct,
      classes: { revenue: { A: sum('A', 'classRevenue'), B: sum('B', 'classRevenue'), C: sum('C', 'classRevenue') }, margin: { A: sum('A', 'classMargin'), B: sum('B', 'classMargin'), C: sum('C', 'classMargin') } },
      alerts: Object.fromEntries(['sem_estoque', 'pausado_com_estoque', 'parado', 'sem_venda', 'margem_baixa', 'prejuizo'].map((k) => [k, rows.filter((r) => r.alerts.some((a) => a.code === k)).length])),
      rows: rows.slice(0, 5000),
    }
  }

  /** Lê nota de qualidade e experiência de compra (anúncios escolhidos ou os 200 que mais faturam). */
  async readQuality(user: AuthUser, ids?: string[]) {
    const T = user.tenantId
    await this.seller(T)
    if (this.qualityJobs.get(T)) throw new BadRequestException('A leitura da qualidade já está em andamento.')
    let list = (ids ?? []).filter(isMlItemId).slice(0, 200)
    if (!list.length) {
      const top = await this.prisma.marketplaceOrderLine.groupBy({ by: ['itemId'], where: { tenantId: T, dateCreated: { gte: new Date(Date.now() - 90 * DAY_MS) }, status: { notIn: ['cancelled', 'invalid'] } }, _sum: { total: true }, orderBy: { _sum: { total: 'desc' } }, take: 200 })
      list = top.map((t) => t.itemId)
    }
    if (!list.length) throw new BadRequestException('Nenhum anúncio com venda nos últimos 90 dias. Sincronize os pedidos ou escolha os anúncios.')
    const job = { total: list.length, done: 0, errors: 0, lastError: null as string | null }
    this.qualityJobs.set(T, job)
    void (async () => {
      try {
        for (const id of list) {
          let error: string | null = null
          const perf = await this.ml.apiGet<unknown>(T, `/item/${id}/performance`).catch((e: unknown) => ((error = (e as Error).message), null))
          const exp = await this.ml.apiGet<unknown>(T, `/reputation/items/${id}/purchase_experience/integrators`, { locale: 'pt_BR' }).catch(() => null)
          const p = parsePerformance(perf)
          const x = parsePurchaseExperience(exp)
          const data = { score: p.score, level: p.level, levelWording: p.levelWording, pending: p.pending as unknown as Prisma.InputJsonValue, experienceValue: x.value, experienceColor: x.color, experienceText: x.text, problems: x.problems, error: error ? String(error).slice(0, 300) : null, syncedAt: new Date() }
          await this.prisma.marketplaceItemQuality.upsert({ where: { tenantId_itemId: { tenantId: T, itemId: id } }, create: { tenantId: T, itemId: id, ...data }, update: data })
          if (error) {
            job.errors++
            job.lastError = `${id}: ${String(error)}`.slice(0, 300)
          }
          job.done++
          await sleep(this.gapMs * 2)
        }
      } catch (e) {
        job.lastError = (e as Error).message
      } finally {
        this.qualityJobs.delete(T)
      }
    })()
    return { ok: true, message: `Lendo a qualidade de ${list.length} anúncio(s) no Mercado Livre.` }
  }

  // ---------- Auditoria e SWOT ----------

  private async summary(tenantId: string): Promise<{ summary: AuditSummary; minMarginPct: number }> {
    const seller = await this.seller(tenantId)
    const now = Date.now()
    const user = await this.ml.apiGet<unknown>(tenantId, `/users/${seller}`).catch(() => null)
    const abc = await this.abc({ tenantId } as AuthUser, 60)
    const ctx = await this.itemContext(tenantId)
    const listed = [...ctx.items.values()].filter((i) => i.status === 'active' || i.status === 'paused')
    const quality = await this.prisma.marketplaceItemQuality.findMany({ where: { tenantId, score: { not: null } }, select: { score: true, pending: true, experienceColor: true } })
    const assistActive = ctx.assist.filter((a) => a.status === 'active')
    const [unanswered, oldest, ads, lines] = await Promise.all([
      this.prisma.assistQuestion.count({ where: { tenantId, mlStatus: 'UNANSWERED', answeredAt: null, externalAnsweredAt: null } }),
      this.prisma.assistQuestion.findFirst({ where: { tenantId, mlStatus: 'UNANSWERED', answeredAt: null, externalAnsweredAt: null }, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
      this.prisma.marketplaceAdDay.aggregate({ where: { tenantId, marketplace: MARKETPLACE, level: 'campaign', date: { gte: new Date(now - 30 * DAY_MS) } }, _sum: { cost: true, revenue: true } }),
      this.lines(tenantId, new Date(now - 30 * DAY_MS)),
    ])
    const sales = emptyDre('30d', 'Últimos 30 dias')
    const orders = new Set<string>()
    for (const l of lines) {
      if (!isSale(l.status)) continue
      orders.add(l.orderId)
      addLine(sales, lineContribution({ total: Number(l.total), quantity: l.quantity, saleFee: num(l.saleFee) }, ctx.items.get(l.itemId)?.costs ?? ctx.costsFor(l.itemId, l.sellerSku)), l.quantity)
    }
    const adCost = Number(ads._sum.cost ?? 0)
    const adRevenue = Number(ads._sum.revenue ?? 0)
    sales.ads = adCost
    const d = closeDre(sales)
    const count = (code: string) => abc.rows.filter((r) => r.alerts.some((a) => a.code === code)).length
    const scores = quality.map((q) => q.score!).filter((s) => typeof s === 'number')
    return {
      minMarginPct: ctx.cfg.minMarginPct,
      summary: {
        reputation: parseReputation(user),
        items: {
          total: listed.length,
          active: listed.filter((i) => i.status === 'active').length,
          paused: listed.filter((i) => i.status === 'paused').length,
          noStock: count('sem_estoque'),
          pausedWithStock: count('pausado_com_estoque'),
          stalled: count('parado') + count('sem_venda'),
          lowMargin: count('margem_baixa'),
          loss: count('prejuizo'),
          noCost: listed.filter((i) => i.costs.unitCost === null).length,
        },
        quality: { read: quality.length, avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null, withPending: quality.filter((q) => Array.isArray(q.pending) && (q.pending as unknown[]).length > 0).length, badExperience: quality.filter((q) => q.experienceColor === 'red' || q.experienceColor === 'orange').length },
        attributes: { measured: assistActive.length, missingBrand: assistActive.filter((a) => !a.brand?.trim()).length, missingPartNumber: assistActive.filter((a) => !a.partNumber?.trim()).length },
        questions: { unanswered, oldestHours: oldest ? round2((now - oldest.receivedAt.getTime()) / 3_600_000) : null },
        ads: { cost: round2(adCost), revenue: round2(adRevenue), acos: adRevenue > 0 ? round2((adCost / adRevenue) * 100) : null, days: 30 },
        sales: { revenue: d.gross, orders: orders.size, units: d.units, contributionPct: d.revenueNoCost > 0 ? null : d.contributionPct, days: 30 },
      },
    }
  }

  async auditView(user: AuthUser) {
    const { summary, minMarginPct } = await this.summary(user.tenantId)
    const swots = await this.prisma.marketplaceSwot.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 12 })
    return { summary, findings: auditFindings(summary, minMarginPct), swots, aiAvailable: await this.ai.available(user.tenantId) }
  }

  async generateSwot(user: AuthUser, ctx: RequestCtx) {
    if (!(await this.ai.available(user.tenantId))) throw new BadRequestException('Para usar a IA, cadastre a chave do Gemini em Configurações › E-mail marketing (é gratuita no Google AI Studio).')
    const { summary, minMarginPct } = await this.summary(user.tenantId)
    const findings = auditFindings(summary, minMarginPct)
    const b = await this.settings.branding(user.tenantId)
    const system = `Você é consultor de marketplaces da ${b.shortName || b.appName}, loja no Mercado Livre. Responda em português do Brasil, em texto simples (sem markdown pesado), direto. Use só os números informados; nunca invente vendas, preços, concorrentes ou prazos.`
    let text: string
    try {
      text = (await this.ai.complete(user.tenantId, system, swotPrompt(summary, findings), 2000)).trim()
    } catch (e) {
      const msg = (e as Error).message
      const wait = aiRetryDelay(msg, 0)
      throw new BadRequestException(wait === null ? `A IA não respondeu: ${msg}` : `A IA está ocupada agora. Tente de novo em ${Math.round(wait / 1000)} segundos.`)
    }
    if (!text) throw new BadRequestException('A IA não respondeu. Tente de novo.')
    const row = await this.prisma.marketplaceSwot.create({ data: { tenantId: user.tenantId, summary: summary as unknown as Prisma.InputJsonValue, findings: findings as unknown as Prisma.InputJsonValue, text: text.slice(0, 20_000), createdById: user.id, createdByName: user.name.slice(0, 120) } })
    await this.audit.byUser(user, ctx, 'marketplace_planejamento.swot', 'marketplace_swot', row.id)
    return row
  }

  // ---------- Metas ----------

  private async monthResult(tenantId: string, month: string) {
    const from = monthStart(month)
    const to = monthStart(nextMonth(month))
    const [ctx, lines, ads] = await Promise.all([
      this.itemContext(tenantId),
      this.lines(tenantId, from, to),
      this.prisma.marketplaceAdDay.aggregate({ where: { tenantId, marketplace: MARKETPLACE, level: 'campaign', date: { gte: new Date(`${month}-01T00:00:00Z`), lt: new Date(`${nextMonth(month)}-01T00:00:00Z`) } }, _sum: { cost: true, revenue: true } }),
    ])
    const d = emptyDre(month, month)
    const orders = new Set<string>()
    for (const l of lines) {
      if (!isSale(l.status)) continue
      orders.add(l.orderId)
      addLine(d, lineContribution({ total: Number(l.total), quantity: l.quantity, saleFee: num(l.saleFee) }, ctx.items.get(l.itemId)?.costs ?? ctx.costsFor(l.itemId, l.sellerSku)), l.quantity)
    }
    d.orders = orders.size
    d.ads = Number(ads._sum.cost ?? 0)
    const adRevenue = Number(ads._sum.revenue ?? 0)
    return { dre: closeDre(d), acos: adRevenue > 0 ? round2((d.ads / adRevenue) * 100) : null, adRevenue: round2(adRevenue) }
  }

  async goals(user: AuthUser, month: string, channel: string) {
    const T = user.tenantId
    const goal = await this.prisma.marketplaceGoal.findUnique({ where: { tenantId_channel_month: { tenantId: T, channel, month } }, include: { tasks: { orderBy: [{ done: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }] } } })
    const { dre, acos, adRevenue } = await this.monthResult(T, month)
    const nowMonth = monthOf(new Date())
    const total = daysInMonth(month)
    const day = month < nowMonth ? total : month > nowMonth ? 0 : Number(new Date(Date.now() - 3 * 3_600_000).toISOString().slice(8, 10))
    const users = await this.prisma.user.findMany({ where: { tenantId: T, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    return {
      month,
      channel,
      day,
      days: total,
      goal,
      revenue: goalProgress(num(goal?.revenueTarget), dre.gross, day, total),
      marginPct: { target: num(goal?.marginPctTarget), actual: dre.revenueNoCost > 0 ? null : dre.contributionPct, estimated: true, noCostPct: dre.noCostPct },
      acos: { target: num(goal?.acosTarget), actual: acos },
      // ROAS = receita dos anúncios ÷ investimento; a meta é a mesma do ACOS vista ao contrário (ACOS 15% = ROAS 6,67).
      roas: { target: roasOf(num(goal?.acosTarget)), actual: dre.ads > 0 ? round2(adRevenue / dre.ads) : null, revenue: adRevenue, cost: round2(dre.ads) },
      dre,
      users,
    }
  }

  async saveGoal(user: AuthUser, d: { month: string; channel: string; revenueTarget?: number | null; marginPctTarget?: number | null; acosTarget?: number | null; notes?: string | null }, ctx: RequestCtx) {
    const data = { revenueTarget: d.revenueTarget ?? null, marginPctTarget: d.marginPctTarget ?? null, acosTarget: d.acosTarget ?? null, notes: d.notes?.slice(0, 1000) ?? null, updatedByName: user.name.slice(0, 120) }
    const g = await this.prisma.marketplaceGoal.upsert({ where: { tenantId_channel_month: { tenantId: user.tenantId, channel: d.channel, month: d.month } }, create: { tenantId: user.tenantId, channel: d.channel, month: d.month, ...data }, update: data })
    await this.audit.byUser(user, ctx, 'marketplace_planejamento.meta', 'marketplace_goal', g.id, { mes: d.month, canal: d.channel, ...data })
    return g
  }

  private async assignee(tenantId: string, id: string | null | undefined) {
    if (!id) return { assigneeId: null, assigneeName: null }
    const u = await this.prisma.user.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true, name: true } })
    if (!u) throw new BadRequestException('Responsável não encontrado.')
    return { assigneeId: u.id, assigneeName: u.name }
  }

  async addTask(user: AuthUser, goalId: string, d: { title: string; assigneeId?: string | null; dueDate?: string | null }) {
    const g = await this.prisma.marketplaceGoal.findFirst({ where: { id: goalId, tenantId: user.tenantId } })
    if (!g) throw new NotFoundException('Meta não encontrada. Salve a meta do mês antes.')
    return this.prisma.marketplaceGoalTask.create({ data: { tenantId: user.tenantId, goalId, title: d.title.trim().slice(0, 200), ...(await this.assignee(user.tenantId, d.assigneeId)), dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00Z`) : null, createdByName: user.name.slice(0, 120) } })
  }

  async updateTask(user: AuthUser, id: string, d: { title?: string; assigneeId?: string | null; dueDate?: string | null; done?: boolean }) {
    const t = await this.prisma.marketplaceGoalTask.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!t) throw new NotFoundException('Tarefa não encontrada.')
    return this.prisma.marketplaceGoalTask.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title.trim().slice(0, 200) } : {}),
        ...(d.assigneeId !== undefined ? await this.assignee(user.tenantId, d.assigneeId) : {}),
        ...(d.dueDate !== undefined ? { dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00Z`) : null } : {}),
        ...(d.done !== undefined ? { done: d.done, doneAt: d.done ? new Date() : null } : {}),
      },
    })
  }

  async deleteTask(user: AuthUser, id: string) {
    const r = await this.prisma.marketplaceGoalTask.deleteMany({ where: { id, tenantId: user.tenantId } })
    if (!r.count) throw new NotFoundException('Tarefa não encontrada.')
    return { ok: true }
  }

  // ---------- Full ----------

  async full(user: AuthUser) {
    const T = user.tenantId
    const [ctx, plan, lines] = await Promise.all([this.itemContext(T), this.planConfig(T), this.lines(T, new Date(Date.now() - 60 * DAY_MS))])
    const d30 = Date.now() - 30 * DAY_MS
    const agg = new Map<string, { u30: number; u60: number; revenue: number; contribution: number; incomplete: boolean }>()
    for (const l of lines) {
      if (!isSale(l.status)) continue
      const r = lineContribution({ total: Number(l.total), quantity: l.quantity, saleFee: num(l.saleFee) }, ctx.items.get(l.itemId)?.costs ?? ctx.costsFor(l.itemId, l.sellerSku))
      const a = agg.get(l.itemId) ?? { u30: 0, u60: 0, revenue: 0, contribution: 0, incomplete: false }
      a.u60 += l.quantity
      if (l.dateCreated.getTime() >= d30) a.u30 += l.quantity
      a.revenue += r.revenue
      a.contribution += r.contribution
      if (r.missingCost || r.missingTax) a.incomplete = true
      agg.set(l.itemId, a)
    }
    const minMargin = plan.fullMinMarginPct ?? ctx.cfg.minMarginPct
    const rows = []
    for (const [id, a] of agg) {
      const i = ctx.items.get(id)
      if (!i || i.status !== 'active') continue
      const marginPct = a.revenue > 0 && !a.incomplete ? round2((a.contribution / a.revenue) * 100) : null
      const isFull = i.logisticType === FULL
      const s = fullSuggestion({ units30: a.u30, units60: a.u60, stock: i.availableQuantity, isFull, marginPct, minMarginPct: minMargin, coverageDays: plan.coverageDays, windowDays: plan.fullWindowDays, storageCostPerUnitMonth: plan.storageCostPerUnitMonth })
      if (!s) continue
      rows.push({ id, title: i.title ?? id, sku: i.sku, isFull, stock: i.availableQuantity, units30: a.u30, units60: a.u60, marginPct, marginIncomplete: a.incomplete, ...s })
    }
    rows.sort((a, b) => b.dailyRate - a.dailyRate)
    return { config: plan, minMarginPct: minMargin, rows }
  }

  // ---------- Sazonalidade e concorrência ----------

  async seasonalityView(user: AuthUser) {
    const T = user.tenantId
    const rows = await this.prisma.$queryRaw<{ month: string; itemId: string; revenue: number; units: number }[]>`
      SELECT to_char(("dateCreated" - interval '3 hours'), 'YYYY-MM') AS month, "itemId", SUM(total)::float8 AS revenue, SUM(quantity)::int AS units
      FROM marketplace_order_lines
      WHERE "tenantId" = ${T}::uuid AND COALESCE(status, '') NOT IN ('cancelled', 'invalid')
      GROUP BY 1, 2`
    const ctx = await this.itemContext(T)
    const group = (keyOf: (r: (typeof rows)[number]) => string | null) => {
      const m = new Map<string, Map<string, { revenue: number; units: number }>>()
      for (const r of rows) {
        const k = keyOf(r)
        if (!k) continue
        const g = m.get(k) ?? new Map()
        const x = g.get(r.month) ?? { revenue: 0, units: 0 }
        x.revenue += r.revenue
        x.units += r.units
        g.set(r.month, x)
        m.set(k, g)
      }
      return [...m].map(([key, g]) => {
        const months = [...g].map(([month, v]) => ({ month, ...v }))
        return { key, revenue: round2(months.reduce((s, x) => s + x.revenue, 0)), months: seasonality(months) }
      })
    }
    const months = [...new Set(rows.map((r) => r.month))].sort()
    const all = group(() => 'geral')[0] ?? null
    const brands = group((r) => ctx.items.get(r.itemId)?.brand?.trim() || null)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 30)
    const items = group((r) => r.itemId)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50)
      .map((x) => ({ ...x, title: ctx.items.get(x.key)?.title ?? x.key }))
    return { from: months[0] ?? null, to: months.at(-1) ?? null, monthsWithData: months.length, geral: all, brands, items }
  }

  /** Histórico de preço dos concorrentes com o mesmo código do anúncio (o que a leitura diária de Concorrentes grava). */
  async competitorHistory(user: AuthUser, itemId: string, days = 180) {
    const T = user.tenantId
    const a = await this.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId: T, id: itemId } }, select: { title: true, sellerSku: true, partNumber: true, attributes: true, price: true } })
    if (!a) throw new NotFoundException('Anúncio não encontrado.')
    const codes = ownCodes(a)
    if (!codes.length) return { itemId, title: a.title, price: num(a.price), codes, series: [] }
    const rivals = await this.prisma.mlCompetitorItem.findMany({ where: { tenantId: T, codes: { hasSome: codes } }, select: { competitorId: true, itemId: true, title: true, price: true, permalink: true, competitor: { select: { nickname: true } } }, take: 30 })
    const points = await this.prisma.mlCompetitorPriceDay.findMany({ where: { tenantId: T, itemId: { in: rivals.map((r) => r.itemId) }, date: { gte: new Date(Date.now() - days * DAY_MS) } }, orderBy: { date: 'asc' }, select: { competitorId: true, itemId: true, date: true, price: true } })
    return {
      itemId,
      title: a.title,
      price: num(a.price),
      codes,
      series: rivals.map((r) => ({
        store: r.competitor.nickname ?? r.competitorId,
        itemId: r.itemId,
        title: r.title,
        permalink: r.permalink,
        price: num(r.price),
        points: points.filter((p) => p.itemId === r.itemId && p.competitorId === r.competitorId).map((p) => ({ date: p.date.toISOString().slice(0, 10), price: Number(p.price) })),
      })),
    }
  }

  /** Concorrentes que mais mudaram de preço nos últimos 30 dias (pelo histórico diário). */
  async competitorMoves(user: AuthUser) {
    const rows = await this.prisma.$queryRaw<{ itemId: string; competitorId: string; first: number; last: number; days: number }[]>`
      SELECT "itemId", "competitorId",
        (ARRAY_AGG(price ORDER BY date ASC))[1]::float8 AS first,
        (ARRAY_AGG(price ORDER BY date DESC))[1]::float8 AS last,
        COUNT(*)::int AS days
      FROM ml_competitor_price_days
      WHERE "tenantId" = ${user.tenantId}::uuid AND date >= (CURRENT_DATE - 30)
      GROUP BY 1, 2`
    const moved = rows.filter((r) => r.first > 0 && r.first !== r.last).map((r) => ({ ...r, changePct: round2(((r.last - r.first) / r.first) * 100) }))
    moved.sort((a, b) => a.changePct - b.changePct)
    const items = await this.prisma.mlCompetitorItem.findMany({ where: { tenantId: user.tenantId, itemId: { in: moved.slice(0, 100).map((m) => m.itemId) } }, select: { itemId: true, title: true, permalink: true, competitor: { select: { nickname: true } } } })
    const by = new Map(items.map((i) => [i.itemId, i]))
    const since = await this.prisma.mlCompetitorPriceDay.aggregate({ where: { tenantId: user.tenantId }, _min: { date: true } })
    return { since: since._min.date, rows: moved.slice(0, 100).map((m) => ({ ...m, title: by.get(m.itemId)?.title ?? m.itemId, permalink: by.get(m.itemId)?.permalink ?? null, store: by.get(m.itemId)?.competitor.nickname ?? null })) }
  }

  // ---------- DRE ----------

  async dre(user: AuthUser, from: string, to: string, by: 'mes' | 'produto') {
    const T = user.tenantId
    if (to < from) throw new BadRequestException('O mês final é antes do inicial.')
    const end = nextMonth(to)
    const [ctx, lines, ads] = await Promise.all([
      this.itemContext(T),
      this.lines(T, monthStart(from), monthStart(end)),
      this.prisma.marketplaceAdDay.findMany({ where: { tenantId: T, marketplace: MARKETPLACE, level: 'campaign', date: { gte: new Date(`${from}-01T00:00:00Z`), lt: new Date(`${end}-01T00:00:00Z`) } }, select: { date: true, cost: true } }),
    ])
    const rows = new Map<string, DreRow>()
    const orders = new Map<string, Set<string>>()
    const total = emptyDre('total', 'Total')
    const allOrders = new Set<string>()
    for (const l of lines) {
      if (!isSale(l.status)) continue
      const key = by === 'mes' ? monthOf(l.dateCreated) : l.itemId
      const label = by === 'mes' ? key : `${ctx.items.get(l.itemId)?.title ?? l.title ?? l.itemId} (${l.itemId})`
      const d = rows.get(key) ?? emptyDre(key, label)
      const r = lineContribution({ total: Number(l.total), quantity: l.quantity, saleFee: num(l.saleFee) }, ctx.items.get(l.itemId)?.costs ?? ctx.costsFor(l.itemId, l.sellerSku))
      addLine(d, r, l.quantity)
      addLine(total, r, l.quantity)
      rows.set(key, d)
      const o = orders.get(key) ?? new Set<string>()
      o.add(l.orderId)
      orders.set(key, o)
      allOrders.add(l.orderId)
    }
    // Ads: por mês (a publicidade não é rateada por produto; no DRE por produto ela entra só no total).
    let adsTotal = 0
    for (const a of ads) {
      const m = a.date.toISOString().slice(0, 7)
      adsTotal += Number(a.cost)
      if (by === 'mes') {
        const d = rows.get(m) ?? emptyDre(m, m)
        d.ads += Number(a.cost)
        rows.set(m, d)
      }
    }
    total.ads = adsTotal
    total.orders = allOrders.size
    for (const [k, d] of rows) d.orders = orders.get(k)?.size ?? 0
    const list = [...rows.values()].map(closeDre)
    list.sort((a, b) => (by === 'mes' ? a.key.localeCompare(b.key) : b.gross - a.gross))
    return { from, to, by, rows: list, total: closeDre(total) }
  }

  async dreCsv(user: AuthUser, from: string, to: string, by: 'mes' | 'produto') {
    const r = await this.dre(user, from, to, by)
    return { filename: `dre-mercado-livre-${from}-a-${to}-${by}.csv`, content: Buffer.from(dreCsv([...r.rows, r.total], by === 'mes' ? 'Mês' : 'Produto'), 'utf8') }
  }
}
