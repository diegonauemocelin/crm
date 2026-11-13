import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { ownCodes } from '../../assistente/concorrentes'
import { AuditService } from '../../audit/audit.service'
import type { RequestCtx } from '../../common/decorators'
import type { AuthUser } from '../../common/types'
import { EmailAiService } from '../../email/ia.service'
import type { Prisma } from '../../generated/prisma/client'
import { readTable } from '../../leads/arquivo'
import { PrismaService } from '../../prisma/prisma.service'
import { SettingsService } from '../../settings/settings.service'
import { todayBr } from '../mercadolivre'
import { MercadoLivreService } from '../mercadolivre.service'
import { aiRetryDelay, isMlItemId, mlEditBlocked } from '../seo-ml'
import { cheapestRivals, itemLink, type RivalOffer } from './concorrentes-preco'
import { normSku, taxRateFor, type TaxRates } from './impostos'
import { erpTextReportRows, isErpTextReport } from './relatorio-erp'
import { MarketplaceTaxService } from './impostos.service'
import {
  applyPriceRule,
  cleanPrecosConfig,
  computeMargin,
  couponBody,
  type CouponInput,
  couponUnitPrice,
  DEFAULT_PRECOS_CONFIG,
  type FeeModel,
  feeFromRow,
  type ListingPriceRow,
  listingName,
  type MarginResult,
  mlMessagePt,
  pickListingPrice,
  PRECOS_CONFIG_KEY,
  type PrecosConfig,
  marginPctOf,
  priceForProfit,
  profitTargetOf,
  priceForMargin,
  pricingTips,
  promoDealPrice,
  refinePrice,
  round2,
  sendRetryDelay,
  type Tip,
  validateCoupon,
  validatePromo,
} from './margem'

const PAGE = 50
const MAX_BATCH = 200
const MAX_ITEMS = 5000
const FEE_TTL_MS = 6 * 3_600_000
const TICK_MS = 60_000
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref())
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const promoBy = (t: string | null) => (t ? t.toUpperCase() : null)

/** Desconto individual que o CRM pode encerrar (as ofertas "custom" também são individuais). */
const OWN_PROMO = new Set(['PRICE_DISCOUNT', 'CUSTOM'])
const FULL = 'fulfillment'

interface RefreshJob {
  total: number
  done: number
  errors: number
  phase: string
  startedAt: string
  by: string | null
  lastError: string | null
}

interface MlItem {
  id: string
  title?: string
  price?: number
  status?: string
  sub_status?: string[] | null
  seller_id?: number | string
  category_id?: string
  listing_type_id?: string
  condition?: string
  available_quantity?: number
  shipping?: { mode?: string; free_shipping?: boolean; logistic_type?: string; tags?: string[] } | null
  variations?: { id: number | string; price?: number }[] | null
}

export type PriceAction =
  | { tipo: 'preco'; modo: 'valor' | 'percentual' | 'margem' | 'sugerido'; valor?: number }
  | { tipo: 'promocao'; modo: 'preco' | 'percentual'; valor: number; inicio: string; fim: string }
  | { tipo: 'encerrar_promocao' }

export type Selection = { ids?: string[]; filtro?: ListQuery; todos?: boolean }

export interface ListQuery {
  search?: string
  status?: string
  full?: string
  noCost?: boolean
  lowMargin?: boolean
  order?: string
  page?: number
}

type Snapshot = Awaited<ReturnType<PrismaService['marketplacePriceItem']['findMany']>>[number]

/** Linha da tela: anúncio + custo + margem + dicas. */
export interface PriceRow {
  id: string
  title: string
  sku: string | null
  costKey: string
  permalink: string | null
  status: string | null
  listingTypeId: string | null
  listingType: string
  logisticType: string | null
  full: boolean
  freeShipping: boolean
  availableQuantity: number | null
  price: number | null
  salePrice: number | null
  promo: { type: string | null; price: number } | null
  cost: number | null
  costSource: string | null
  /** Lucro desejado do produto em R$ e de onde veio; null = margem alvo geral. */
  profitTarget: { value: number; source: 'produto' | 'produto_pct' | 'produto_venda' | 'erp'; pct?: number } | null
  erpPrice: number | null
  /** IPI (%) aprendido das notas, somado ao preço do ERP para chegar ao valor líquido. */
  ipiPct: number | null
  feeFixed: number | null
  extraPct: number
  fixedCost: number
  costPercent: number | null
  costUpdatedAt: Date | null
  feePct: number | null
  shippingNote: string | null
  taxPct: number | null
  taxSource: string | null
  taxLabel: string
  margin: MarginResult
  /** Preço de margem zero e preço para a margem alvo (estimados com a tarifa atual). */
  minPrice: number | null
  suggestedPrice: number | null
  competitorMin: number | null
  /** Os 2 concorrentes mais baratos (lojas cadastradas com o mesmo código; no detalhe, também o catálogo do ML). */
  competitors: RivalOffer[]
  tips: Tip[]
  hasVariations: boolean
  sales30: number | null
  sales60: number | null
  readError: string | null
  syncedAt: Date
}

/**
 * Marketplaces › Preços e promoções (Mercado Livre): margem por anúncio com a tarifa e o frete da API oficial, os
 * impostos das notas do Mercado Envios e o custo informado pela empresa; alteração de preço, desconto individual
 * (PRICE_DISCOUNT) e cupons do vendedor, sempre com revisão antes e envio em segundo plano (1 por segundo), histórico
 * e desfazer. Preço agendado é enviado por um job a cada minuto.
 */
@Injectable()
export class PrecosService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PrecosService.name)
  private readonly refreshing = new Map<string, RefreshJob>()
  private readonly workers = new Set<string>()
  private readonly feeCache = new Map<string, { at: number; rows: ListingPriceRow[] }>()
  private timer: NodeJS.Timeout | null = null
  /** Pausa entre os envios ao Mercado Livre (ritmo ~1 por segundo) e entre as leituras. */
  sendGapMs = 1000
  readGapMs = 150

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
    void this.recoverInterrupted()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  /** Envio que ficou no meio quando o sistema reiniciou: não dá para saber se o Mercado Livre gravou. */
  private async recoverInterrupted() {
    try {
      await this.prisma.marketplacePriceChange.updateMany({ where: { status: 'ENVIANDO' }, data: { status: 'ERRO', error: 'Envio interrompido (o sistema reiniciou). Confira o anúncio no Mercado Livre e envie de novo, se precisar.' } })
      const pending = await this.prisma.marketplacePriceChange.findMany({ where: { status: 'PENDENTE' }, distinct: ['tenantId'], select: { tenantId: true } })
      for (const p of pending) this.kick(p.tenantId)
    } catch (e) {
      this.logger.warn(`Preços: retomada dos envios: ${(e as Error).message}`)
    }
  }

  /** Agendadas que venceram viram pendentes e entram na fila. */
  async tick(now = new Date()) {
    try {
      const due = await this.prisma.marketplacePriceChange.findMany({ where: { status: 'AGENDADA', scheduledAt: { lte: now } }, select: { id: true, tenantId: true }, take: 2000 })
      if (!due.length) return
      await this.prisma.marketplacePriceChange.updateMany({ where: { id: { in: due.map((d) => d.id) }, status: 'AGENDADA' }, data: { status: 'PENDENTE' } })
      for (const t of new Set(due.map((d) => d.tenantId))) this.kick(t)
    } catch (e) {
      this.logger.warn(`Preços: agendados: ${(e as Error).message}`)
    }
  }

  // ---------- Base ----------

  private async seller(tenantId: string) {
    const c = await this.ml.config(tenantId)
    if (c.status === 'DESCONECTADO' || !c.refreshTokenEnc || !c.userId) throw new BadRequestException('Conecte o Mercado Livre em Configurações › Marketplaces › Conexões dos marketplaces.')
    return c.userId
  }

  async config(tenantId: string): Promise<PrecosConfig> {
    return cleanPrecosConfig(await this.settings.get<Partial<PrecosConfig>>(tenantId, PRECOS_CONFIG_KEY, {}), DEFAULT_PRECOS_CONFIG)
  }

  async saveConfig(user: AuthUser, raw: Partial<Record<keyof PrecosConfig, unknown>>, ctx: RequestCtx) {
    const next = cleanPrecosConfig(raw, await this.config(user.tenantId))
    await this.settings.set(user.tenantId, PRECOS_CONFIG_KEY, next)
    await this.audit.byUser(user, ctx, 'marketplace_precos.configuracao', 'setting', undefined, next as unknown as Record<string, unknown>)
    return next
  }

  private site(itemId: string) {
    return itemId.slice(0, 3)
  }

  /** Tarifas de venda (todos os tipos de anúncio) num preço, pela API oficial de custos por vender. Em cache por 6 h. */
  private async listingPrices(tenantId: string, it: { itemId: string; categoryId: string | null; logisticType: string | null; shippingMode: string | null }, price: number): Promise<ListingPriceRow[] | null> {
    if (!it.categoryId || !(price > 0)) return null
    const key = `${tenantId}|${it.categoryId}|${it.logisticType ?? ''}|${it.shippingMode ?? ''}|${price.toFixed(2)}`
    const hit = this.feeCache.get(key)
    if (hit && Date.now() - hit.at < FEE_TTL_MS) return hit.rows
    const params: Record<string, string | number> = { price: price.toFixed(2), category_id: it.categoryId, currency_id: 'BRL' }
    // logistic_type e shipping_mode deixam a parte fixa igual à cobrada (documentação "Custos por vender").
    if (it.logisticType) params.logistic_type = it.logisticType
    if (it.shippingMode) params.shipping_mode = it.shippingMode
    const raw = await this.ml.apiGet<unknown>(tenantId, `/sites/${this.site(it.itemId)}/listing_prices`, params)
    const rows = (Array.isArray(raw) ? raw.flat(2) : [raw]) as ListingPriceRow[]
    if (this.feeCache.size > 20_000) this.feeCache.clear()
    this.feeCache.set(key, { at: Date.now(), rows })
    return rows
  }

  private async feeAt(tenantId: string, s: Pick<Snapshot, 'itemId' | 'categoryId' | 'logisticType' | 'shippingMode' | 'listingTypeId'>, price: number) {
    if (!s.listingTypeId) return null
    const rows = await this.listingPrices(tenantId, s, price).catch(() => null)
    return rows ? feeFromRow(pickListingPrice(rows, s.listingTypeId)) : null
  }

  /** Custo do frete grátis para a loja (estimativa do Mercado Livre para o anúncio, documentação "Custos de envio"). */
  private async shippingCost(tenantId: string, seller: string, it: MlItem, price: number): Promise<{ cost: number | null; note: string }> {
    const sh = it.shipping ?? {}
    if (!sh.free_shipping) return { cost: 0, note: 'Frete pago pelo comprador.' }
    if (sh.mode !== 'me2') return { cost: null, note: 'Frete grátis fora do Mercado Envios: custo não calculado.' }
    try {
      const r = await this.ml.apiGet<{ coverage?: { all_country?: { list_cost?: number } } }>(tenantId, `/users/${seller}/shipping_options/free`, {
        item_id: it.id,
        item_price: price.toFixed(2),
        ...(it.listing_type_id ? { listing_type_id: it.listing_type_id } : {}),
        mode: 'me2',
        ...(it.condition ? { condition: it.condition } : {}),
        ...(sh.logistic_type ? { logistic_type: sh.logistic_type } : {}),
        free_shipping: 'true',
        verbose: 'true',
      })
      const cost = r.coverage?.all_country?.list_cost
      if (typeof cost === 'number' && Number.isFinite(cost)) return { cost: round2(cost), note: 'Custo do frete grátis informado pelo Mercado Livre (estimativa para o país).' }
      return { cost: null, note: 'O Mercado Livre não informou o custo do frete grátis.' }
    } catch (e) {
      return { cost: null, note: `Frete não calculado: ${(e as Error).message}`.slice(0, 300) }
    }
  }

  /**
   * Vendas dos últimos 60 dias por anúncio (busca de pedidos da conta). null quando a conta tem pedidos demais para ler
   * tudo (aí as dicas de "sem venda" não aparecem, para não errar).
   */
  private async salesByItem(tenantId: string, seller: string) {
    const from = new Date(Date.now() - 60 * 86_400_000)
    const d30 = Date.now() - 30 * 86_400_000
    const out = new Map<string, { s30: number; s60: number; last: Date }>()
    for (let offset = 0; offset < 5000; offset += 50) {
      const r = await this.ml.apiGet<{ results?: { status?: string; date_created?: string; order_items?: { item?: { id?: string }; quantity?: number }[] }[]; paging?: { total?: number } }>(tenantId, '/orders/search', {
        seller,
        'order.date_created.from': from.toISOString(),
        sort: 'date_desc',
        offset,
        limit: 50,
      })
      for (const o of r.results ?? []) {
        if (o.status === 'cancelled' || !o.date_created) continue
        const at = new Date(o.date_created)
        for (const oi of o.order_items ?? []) {
          const id = oi.item?.id
          if (!id) continue
          const q = Math.max(1, Number(oi.quantity) || 1)
          const a = out.get(id) ?? { s30: 0, s60: 0, last: at }
          a.s60 += q
          if (at.getTime() >= d30) a.s30 += q
          if (at > a.last) a.last = at
          out.set(id, a)
        }
      }
      const total = r.paging?.total ?? 0
      if (offset + 50 >= total) return out
      await sleep(this.readGapMs)
    }
    return null
  }

  // ---------- Leitura do Mercado Livre ----------

  refreshJob(tenantId: string) {
    return this.refreshing.get(tenantId) ?? null
  }

  /** Lê preço, promoção, tarifa, frete e vendas de todos os anúncios ativos e pausados da conta (em segundo plano). */
  async refresh(user: AuthUser, ids?: string[]) {
    const T = user.tenantId
    const seller = await this.seller(T)
    if (this.refreshing.get(T)) throw new BadRequestException('Já há uma leitura do Mercado Livre em andamento. Aguarde terminar.')
    const where: Prisma.AssistItemWhereInput = ids?.length ? { tenantId: T, sellerId: seller, id: { in: ids.filter(isMlItemId) } } : { tenantId: T, sellerId: seller, status: { in: ['active', 'paused'] } }
    const items = await this.prisma.assistItem.findMany({ where, select: { id: true, sellerSku: true }, take: MAX_ITEMS })
    if (!items.length) throw new BadRequestException('Nenhum anúncio sincronizado. Sincronize os anúncios no Assistente ML (Configurações › Marketplaces › Assistente ML › Integração).')
    const job: RefreshJob = { total: items.length, done: 0, errors: 0, phase: 'vendas', startedAt: new Date().toISOString(), by: user.name, lastError: null }
    this.refreshing.set(T, job)
    void (async () => {
      try {
        let sales: Map<string, { s30: number; s60: number; last: Date }> | null = null
        if (!ids?.length) {
          try {
            sales = await this.salesByItem(T, seller)
          } catch (e) {
            job.lastError = `vendas: ${(e as Error).message}`.slice(0, 300)
          }
        }
        job.phase = 'anuncios'
        const skuOf = new Map(items.map((i) => [i.id, i.sellerSku]))
        for (let i = 0; i < items.length; i += 20) {
          const chunk = items.slice(i, i + 20).map((x) => x.id)
          let got: { code?: number; body?: MlItem }[] = []
          try {
            got = await this.ml.apiGet<{ code?: number; body?: MlItem }[]>(T, '/items', { ids: chunk.join(','), attributes: 'id,title,price,status,sub_status,seller_id,category_id,listing_type_id,condition,available_quantity,shipping,variations' })
          } catch (e) {
            // O ML às vezes recusa a leitura em lote (403 "Resource deprecated" em alguns anúncios): lê um por um.
            job.lastError = `lote recusado, lendo um por um: ${(e as Error).message}`.slice(0, 300)
            got = []
            for (const id of chunk) {
              try {
                const body = await this.ml.apiGet<MlItem>(T, `/items/${id}`)
                got.push({ code: 200, body })
              } catch (err) {
                got.push({ code: 0, body: { id } as MlItem })
                job.lastError = `${id}: ${(err as Error).message}`.slice(0, 300)
              }
              await sleep(this.readGapMs)
            }
          }
          for (const g of got) {
            const it = g.body
            if (!it?.id || g.code !== 200) {
              job.errors++
              job.done++
              continue
            }
            try {
              await this.readOne(T, seller, it, skuOf.get(it.id) ?? null, sales)
            } catch (e) {
              job.errors++
              job.lastError = `${it.id}: ${(e as Error).message}`.slice(0, 300)
            }
            job.done++
            await sleep(this.readGapMs)
          }
        }
      } finally {
        this.refreshing.delete(T)
      }
    })()
    return { job, message: `Lendo ${items.length} anúncio(s) no Mercado Livre (preço, promoção, tarifa, frete e vendas).` }
  }

  /** Lê um anúncio (já com os dados do multiget) e grava o retrato de preço. */
  private async readOne(T: string, seller: string, it: MlItem, sku: string | null, sales: Map<string, { s30: number; s60: number; last: Date }> | null) {
    const price = typeof it.price === 'number' ? it.price : null
    let salePrice = price
    let promoType: string | null = null
    let promoId: string | null = null
    let readError: string | null = null
    try {
      // Preço de venda atual (a documentação "Preços de produtos" indica /sale_price no lugar de price/original_price).
      const sp = await this.ml.apiGet<{ amount?: number; regular_amount?: number | null; metadata?: { promotion_id?: string; promotion_type?: string } }>(T, `/items/${it.id}/sale_price`, { context: 'channel_marketplace' })
      if (typeof sp.amount === 'number') salePrice = sp.amount
      if (sp.regular_amount && typeof sp.amount === 'number' && sp.amount < sp.regular_amount) {
        promoType = promoBy(sp.metadata?.promotion_type ?? null)
        promoId = sp.metadata?.promotion_id ?? null
      }
    } catch (e) {
      readError = `preço de venda: ${(e as Error).message}`.slice(0, 300)
    }
    const snap = { itemId: it.id, categoryId: it.category_id ?? null, logisticType: it.shipping?.logistic_type ?? null, shippingMode: it.shipping?.mode ?? null }
    let fee: ReturnType<typeof feeFromRow> = null
    let other: ReturnType<typeof feeFromRow> = null
    let otherType: string | null = null
    if (salePrice && it.listing_type_id) {
      try {
        const rows = await this.listingPrices(T, snap, salePrice)
        fee = rows ? feeFromRow(pickListingPrice(rows, it.listing_type_id)) : null
        otherType = it.listing_type_id === 'gold_special' ? 'gold_pro' : it.listing_type_id === 'gold_pro' ? 'gold_special' : null
        other = rows && otherType ? feeFromRow(pickListingPrice(rows, otherType)) : null
      } catch (e) {
        readError = [readError, `tarifa: ${(e as Error).message}`].filter(Boolean).join(' · ').slice(0, 300)
      }
    }
    const ship = salePrice ? await this.shippingCost(T, seller, it, salePrice) : { cost: null, note: 'Sem preço.' }
    const s = sales ? sales.get(it.id) : undefined
    const data = {
      title: it.title ?? null,
      sellerSku: sku,
      status: it.status ?? null,
      categoryId: snap.categoryId,
      listingTypeId: it.listing_type_id ?? null,
      condition: it.condition ?? null,
      shippingMode: snap.shippingMode,
      logisticType: snap.logisticType,
      freeShipping: !!it.shipping?.free_shipping,
      mandatoryFreeShipping: !!it.shipping?.tags?.includes('mandatory_free_shipping'),
      availableQuantity: it.available_quantity ?? null,
      price,
      salePrice,
      promoType,
      promoId,
      saleFee: fee?.amount ?? null,
      saleFeePct: fee?.model.pct ?? null,
      saleFeeFixed: fee?.model.fixed ?? null,
      otherListingTypeId: other ? otherType : null,
      otherFee: other?.amount ?? null,
      otherFeePct: other?.model.pct ?? null,
      shippingCost: ship.cost,
      shippingNote: ship.note,
      hasVariations: (it.variations?.length ?? 0) > 0,
      ...(sales ? { sales30: s?.s30 ?? 0, sales60: s?.s60 ?? 0, lastSaleAt: s?.last ?? null } : {}),
      readError,
      syncedAt: new Date(),
    }
    await this.prisma.marketplacePriceItem.upsert({ where: { tenantId_itemId: { tenantId: T, itemId: it.id } }, create: { tenantId: T, itemId: it.id, ...data }, update: data })
  }

  /** Relê um anúncio (depois de um envio, para a tela mostrar o que ficou no Mercado Livre). */
  private async rereadOne(T: string, itemId: string) {
    const seller = await this.seller(T)
    const it = await this.ml.apiGet<MlItem>(T, `/items/${itemId}`)
    const a = await this.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId: T, id: itemId } }, select: { sellerSku: true } })
    await this.readOne(T, seller, it, a?.sellerSku ?? null, null)
  }

  // ---------- Lista ----------

  private async context(tenantId: string) {
    const [config, rates, costs, rivals, erp] = await Promise.all([
      this.config(tenantId),
      this.taxes.rates(tenantId),
      this.prisma.marketplaceCost.findMany({ where: { tenantId } }),
      this.prisma.mlCompetitorItem.findMany({ where: { tenantId, status: 'active', price: { not: null } }, select: { itemId: true, title: true, permalink: true, price: true, freeShipping: true, codes: true, competitor: { select: { nickname: true } } } }),
      // Preço de venda do ERP (Tcar) por código: base do lucro do produto quando não há lucro informado.
      this.prisma.tcarProduct.findMany({ where: { tenantId, price: { not: null } }, select: { code: true, price: true } }).catch(() => [] as { code: string; price: unknown }[]),
    ])
    const costBy = new Map(costs.map((c) => [c.sku, c]))
    const erpPriceBy = new Map(erp.map((e) => [normSku(e.code), Number(e.price)]))
    const rivalBy = new Map<string, RivalOffer[]>()
    for (const r of rivals) {
      const offer: RivalOffer = { itemId: r.itemId, title: r.title, price: Number(r.price), permalink: r.permalink ?? itemLink(r.itemId), seller: r.competitor?.nickname ?? null, freeShipping: r.freeShipping, source: 'CODIGO' }
      for (const code of r.codes) {
        const a = rivalBy.get(code)
        if (a) a.push(offer)
        else rivalBy.set(code, [offer])
      }
    }
    return { config, rates, costBy, rivalBy, erpPriceBy }
  }

  private buildRow(s: Snapshot, a: { title: string | null; permalink: string | null; partNumber: string | null; attributes: unknown } | undefined, ctx: Awaited<ReturnType<PrecosService['context']>>): PriceRow {
    const { config, rates, costBy, rivalBy, erpPriceBy } = ctx
    const sku = s.sellerSku?.trim() || null
    const costKey = sku ? normSku(sku) : s.itemId
    const c = costBy.get(costKey)
    const attrs = Array.isArray(a?.attributes) ? (a!.attributes as { id?: string | null; value?: string | null }[]) : []
    const ncm = (attrs.find((x) => x?.id === 'NCM')?.value ?? '').replace(/\D/g, '') || null
    const tax = taxRateFor(sku, ncm && ncm.length === 8 ? ncm : null, rates as TaxRates, config.taxPct, config.useNfeTaxes)
    const price = num(s.price)
    const sale = num(s.salePrice) ?? price
    const cost = c ? Number(c.cost) : null
    const shipping = num(s.shippingCost)
    const fee = num(s.saleFee)
    const base = { shipping, taxPct: tax.pct, cost, fixedCost: config.fixedCostPerSale, extraPct: config.extraFeePct, marginMode: config.marginMode }
    const margin = computeMargin({ price: sale ?? 0, fee, ...base })
    const promo = price !== null && sale !== null && sale < price ? { type: s.promoType, price: sale } : null
    let regularMarginPct: number | null = null
    const model: FeeModel | null = s.saleFeePct === null ? null : { pct: Number(s.saleFeePct), fixed: Number(s.saleFeeFixed ?? 0) }
    if (promo && model && price !== null) regularMarginPct = computeMargin({ price, fee: round2((price * model.pct) / 100 + model.fixed), ...base }).marginPct
    const pm = model && cost !== null && tax.pct !== null ? { fee: model, shipping: shipping ?? 0, taxPct: tax.pct, extraPct: config.extraFeePct, cost, fixedCost: config.fixedCostPerSale, marginMode: config.marginMode } : null
    const minPrice = pm ? priceForMargin(0, pm) : null
    const goal = config.targetMarginPct ?? (config.minMarginPct > 0 ? config.minMarginPct : null)
    // Lucro do produto (R$ ou % do custo informado, ou preço do ERP − custo): o preço sugerido deixa esse lucro em R$.
    const erpPrice = sku ? (erpPriceBy.get(normSku(sku)) ?? null) : null
    const profitTarget = profitTargetOf(c ? { profitValue: c.profitValue === null ? null : Number(c.profitValue), profitPct: c.profitPct === null ? null : Number(c.profitPct) } : null, cost, erpPrice, tax.pct, tax.ipiPct ?? 0)
    const salePct = c?.profitSalePct != null ? Number(c.profitSalePct) : null
    const suggestedPrice = pm
      ? salePct !== null
        ? priceForMargin(salePct, { ...pm, marginMode: 'PRECO' })
        : profitTarget
          ? priceForProfit(profitTarget.value, pm)
          : goal !== null
            ? priceForMargin(goal, pm)
            : null
      : null
    const codes = ownCodes({ title: s.title ?? a?.title ?? null, sellerSku: sku, partNumber: a?.partNumber ?? null, attributes: a?.attributes })
    const offers = codes.flatMap((code) => rivalBy.get(code) ?? [])
    const all = cheapestRivals(offers, s.itemId, Number.MAX_SAFE_INTEGER)
    const competitorMin = all[0]?.price ?? null
    const competitorCount = all.length
    const competitors = all.slice(0, 2)
    const tips = pricingTips({
      status: s.status,
      availableQuantity: s.availableQuantity,
      margin,
      minMarginPct: config.minMarginPct,
      targetMarginPct: config.targetMarginPct,
      suggestedPrice,
      minPrice,
      regularPrice: price ?? 0,
      promoPrice: promo?.price ?? null,
      regularMarginPct,
      competitorMin,
      competitorCount,
      listingTypeId: s.listingTypeId,
      otherFee: s.otherListingTypeId && s.otherFee !== null ? { listingTypeId: s.otherListingTypeId, amount: Number(s.otherFee), pct: Number(s.otherFeePct ?? 0) } : null,
      freeShipping: s.freeShipping,
      mandatoryFreeShipping: s.mandatoryFreeShipping,
      sales30: s.sales30,
      sales60: s.sales60,
      taxSource: tax.source,
    })
    return {
      id: s.itemId,
      title: s.title ?? a?.title ?? s.itemId,
      sku,
      costKey,
      permalink: a?.permalink ?? null,
      status: s.status,
      listingTypeId: s.listingTypeId,
      listingType: listingName(s.listingTypeId),
      logisticType: s.logisticType,
      full: s.logisticType === FULL,
      freeShipping: s.freeShipping,
      availableQuantity: s.availableQuantity,
      price,
      salePrice: sale,
      promo,
      cost,
      costSource: c?.source ?? null,
      profitTarget: salePct !== null ? { value: suggestedPrice === null ? 0 : round2((suggestedPrice * salePct) / 100), source: 'produto_venda' as const, pct: salePct } : profitTarget,
      erpPrice,
      ipiPct: tax.ipiPct ?? null,
      feeFixed: model?.fixed ?? null,
      extraPct: config.extraFeePct,
      fixedCost: config.fixedCostPerSale,
      costPercent: c?.percent === null || c?.percent === undefined ? null : Number(c.percent),
      costUpdatedAt: c?.updatedAt ?? null,
      feePct: model?.pct ?? null,
      shippingNote: s.shippingNote,
      taxPct: tax.pct,
      taxSource: tax.source,
      taxLabel: tax.label,
      margin,
      minPrice,
      suggestedPrice,
      competitorMin,
      competitors,
      tips,
      hasVariations: s.hasVariations,
      sales30: s.sales30,
      sales60: s.sales60,
      readError: s.readError,
      syncedAt: s.syncedAt,
    }
  }

  /** Todas as linhas (sem paginar), já filtradas e ordenadas. */
  private async rows(tenantId: string, q: ListQuery, onlyIds?: string[]) {
    const seller = await this.seller(tenantId)
    const [snaps, assist, ctx] = await Promise.all([
      this.prisma.marketplacePriceItem.findMany({ where: { tenantId, ...(onlyIds ? { itemId: { in: onlyIds } } : {}) } }),
      this.prisma.assistItem.findMany({ where: { tenantId, sellerId: seller, ...(onlyIds ? { id: { in: onlyIds } } : {}) }, select: { id: true, title: true, permalink: true, partNumber: true, attributes: true, brand: true } }),
      this.context(tenantId),
    ])
    const aBy = new Map(assist.map((a) => [a.id, a]))
    // Só anúncios da conta conectada.
    let list = snaps.filter((s) => aBy.has(s.itemId)).map((s) => this.buildRow(s, aBy.get(s.itemId), ctx))
    const st = q.status ?? 'ativos'
    if (st === 'ativos') list = list.filter((r) => r.status === 'active' || r.status === 'paused')
    else if (st !== 'todos') list = list.filter((r) => r.status === st)
    if (q.full === 'sim') list = list.filter((r) => r.full)
    if (q.full === 'nao') list = list.filter((r) => !r.full)
    if (q.noCost) list = list.filter((r) => r.cost === null)
    if (q.lowMargin) list = list.filter((r) => r.margin.marginPct !== null && r.margin.marginPct < ctx.config.minMarginPct)
    const s = q.search?.trim().toLowerCase()
    if (s) list = list.filter((r) => [r.id, r.title, r.sku, aBy.get(r.id)?.partNumber, aBy.get(r.id)?.brand].some((v) => (v ?? '').toLowerCase().includes(s)))
    const m = (r: PriceRow) => r.margin.marginPct ?? Number.POSITIVE_INFINITY
    list.sort((a, b) =>
      q.order === 'margem_desc'
        ? (b.margin.marginPct ?? -Infinity) - (a.margin.marginPct ?? -Infinity)
        : q.order === 'titulo'
          ? a.title.localeCompare(b.title, 'pt-BR')
          : q.order === 'preco'
            ? (b.salePrice ?? 0) - (a.salePrice ?? 0)
            : m(a) - m(b) || a.title.localeCompare(b.title, 'pt-BR'),
    )
    return { list, ctx, all: snaps.length }
  }

  async list(user: AuthUser, q: ListQuery) {
    const T = user.tenantId
    const { list, ctx, all } = await this.rows(T, q)
    const page = Math.max(1, q.page ?? 1)
    const queue = await this.prisma.marketplacePriceChange.groupBy({ by: ['status'], where: { tenantId: T, status: { in: ['PENDENTE', 'ENVIANDO', 'AGENDADA'] } }, _count: { _all: true } })
    const withMargin = list.filter((r) => r.margin.marginPct !== null)
    return {
      total: list.length,
      page,
      synced: all,
      config: ctx.config,
      taxes: { notes: ctx.rates.notes, overall: ctx.rates.overall, updatedAt: ctx.rates.updatedAt || null },
      stats: {
        noCost: list.filter((r) => r.cost === null).length,
        belowMin: list.filter((r) => r.margin.marginPct !== null && r.margin.marginPct < ctx.config.minMarginPct).length,
        loss: list.filter((r) => r.margin.margin !== null && r.margin.margin < 0).length,
        avgMarginPct: withMargin.length ? round2(withMargin.reduce((s, r) => s + r.margin.marginPct!, 0) / withMargin.length) : null,
      },
      refresh: this.refreshJob(T),
      queue: Object.fromEntries(queue.map((g) => [g.status, g._count._all])),
      items: list.slice((page - 1) * PAGE, page * PAGE),
    }
  }

  async get(user: AuthUser, itemId: string) {
    if (!isMlItemId(itemId)) throw new BadRequestException('Anúncio inválido.')
    const { list } = await this.rows(user.tenantId, { status: 'todos' }, [itemId])
    const row = list[0]
    if (!row) throw new NotFoundException('Anúncio não encontrado (leia os anúncios do Mercado Livre nesta tela primeiro).')
    const [changes, catalog] = await Promise.all([
      this.prisma.marketplacePriceChange.findMany({ where: { tenantId: user.tenantId, itemId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.catalogRivals(user.tenantId, itemId),
    ])
    const competitors = cheapestRivals([...row.competitors, ...catalog.offers], itemId)
    return { ...row, competitors, catalogProductId: catalog.productId, changes, aiAvailable: await this.ai.available(user.tenantId) }
  }

  /**
   * Outros vendedores do mesmo produto do catálogo do Mercado Livre (é o mesmo produto, vendido no ML), pelos
   * endpoints públicos /items/{id} (catalog_product_id) e /products/{id}/items. Sem catálogo ou se o ML recusar: vazio.
   */
  private async catalogRivals(T: string, itemId: string): Promise<{ productId: string | null; offers: RivalOffer[] }> {
    try {
      const it = await this.ml.apiGet<{ catalog_product_id?: string | null; seller_id?: number }>(T, `/items/${itemId}`, { attributes: 'id,catalog_product_id,seller_id' })
      const pid = it?.catalog_product_id
      if (!pid) return { productId: null, offers: [] }
      const [page, product] = await Promise.all([
        this.ml.apiGet<{ results?: { item_id?: string; seller_id?: number; price?: number; shipping?: { free_shipping?: boolean } }[] }>(T, `/products/${pid}/items`, { limit: 20 }),
        this.ml.apiGet<{ name?: string }>(T, `/products/${pid}`).catch(() => null),
      ])
      const others = (page?.results ?? [])
        .filter((r) => r.item_id && r.item_id !== itemId && typeof r.price === 'number' && String(r.seller_id ?? '') !== String(it.seller_id ?? ''))
        .sort((a, b) => a.price! - b.price!)
        .slice(0, 2)
      const offers = await Promise.all(
        others.map(async (r): Promise<RivalOffer> => {
          const u = r.seller_id ? await this.ml.apiGet<{ nickname?: string }>(T, `/users/${r.seller_id}`).catch(() => null) : null
          return { itemId: r.item_id!, title: product?.name ?? null, price: r.price!, permalink: itemLink(r.item_id!), seller: u?.nickname ?? null, freeShipping: !!r.shipping?.free_shipping, source: 'CATALOGO' }
        }),
      )
      return { productId: pid, offers }
    } catch (e) {
      this.logger.warn(`Concorrentes do catálogo de ${itemId}: ${(e as Error).message}`)
      return { productId: null, offers: [] }
    }
  }

  /** Dica da IA gratuita (Gemini já configurado) com os números do anúncio. Só sugere: nada muda no Mercado Livre. */
  async aiTip(user: AuthUser, itemId: string) {
    const r = await this.get(user, itemId)
    if (!r.aiAvailable) throw new BadRequestException('Para usar a IA, cadastre a chave do Gemini em Configurações › E-mail marketing (é gratuita no Google AI Studio).')
    const cfg = await this.config(user.tenantId)
    const f = (n: number | null) => (n === null ? 'sem dado' : `R$ ${n.toFixed(2)}`)
    const facts = [
      `Anúncio: ${r.title} (${r.listingType}${r.full ? ', Full' : ''}${r.freeShipping ? ', frete grátis' : ''})`,
      `Situação: ${r.status ?? 'desconhecida'}; estoque: ${r.availableQuantity ?? 'sem dado'}`,
      `Preço cheio: ${f(r.price)}; preço de venda: ${f(r.salePrice)}${r.promo ? ' (em promoção)' : ''}`,
      `Custo: ${f(r.cost)}; tarifa: ${f(r.margin.fee)}; frete: ${f(r.margin.shipping)}; imposto: ${f(r.margin.tax)} (${r.taxLabel}); outras taxas: ${f(r.margin.extra)}; custo fixo: ${f(r.margin.fixedCost)}`,
      `Margem: ${f(r.margin.margin)} (${r.margin.marginPct ?? 'sem dado'}%); mínima: ${cfg.minMarginPct}%; alvo: ${cfg.targetMarginPct ?? 'não configurada'}%`,
      `Preço mínimo (margem zero): ${f(r.minPrice)}; preço sugerido: ${f(r.suggestedPrice)}`,
      `Concorrente mais barato com o mesmo código: ${f(r.competitorMin)}`,
      `Concorrentes mais baratos (mesmo código ou mesmo produto do catálogo): ${r.competitors.map((c) => `${f(c.price)}${c.seller ? ` (${c.seller})` : ''}`).join('; ') || 'nenhum encontrado'}`,
      `Vendas em 30 dias: ${r.sales30 ?? 'sem dado'}; em 60 dias: ${r.sales60 ?? 'sem dado'}`,
      `Dicas automáticas: ${r.tips.map((t) => t.text).join(' | ') || 'nenhuma'}`,
    ].join('\n')
    const system = 'Você é consultor de preços de uma loja no Mercado Livre. Responda em português do Brasil, em até 5 frases curtas e práticas. Use só os números informados; nunca invente preço, tarifa, prazo, estoque ou dado de concorrente. Se faltar dado, diga qual.'
    try {
      const text = await this.ai.complete(user.tenantId, system, `${facts}\n\nComo melhorar o preço e as vendas deste anúncio?`, 600)
      return { text: text.trim() }
    } catch (e) {
      const msg = (e as Error).message
      const wait = aiRetryDelay(msg, 0)
      throw new BadRequestException(wait === null ? `A IA não respondeu: ${msg}` : `A IA está ocupada agora. Tente de novo em ${Math.round(wait / 1000)} segundos.`)
    }
  }

  // ---------- Custos ----------

  private async idsOf(user: AuthUser, sel: Selection) {
    if (sel.ids?.length) return [...new Set(sel.ids)].filter(isMlItemId)
    const { list } = await this.rows(user.tenantId, sel.todos ? { status: 'todos' } : (sel.filtro ?? {}))
    return list.map((r) => r.id)
  }

  async setCost(user: AuthUser, sku: string, cost: number | null, ctx: RequestCtx) {
    const key = normSku(sku)
    if (!key || key.length > 60) throw new BadRequestException('SKU inválido.')
    if (cost === null) {
      await this.prisma.marketplaceCost.deleteMany({ where: { tenantId: user.tenantId, sku: key } })
    } else {
      if (!(cost >= 0) || cost > 10_000_000) throw new BadRequestException('Custo inválido.')
      const data = { cost: round2(cost), source: 'manual', percent: null, updatedById: user.id, updatedByName: user.name.slice(0, 120) }
      await this.prisma.marketplaceCost.upsert({ where: { tenantId_sku: { tenantId: user.tenantId, sku: key } }, create: { tenantId: user.tenantId, sku: key, ...data }, update: data })
    }
    await this.audit.byUser(user, ctx, 'marketplace_precos.custo', 'marketplace_cost', undefined, { sku: key, custo: cost })
    return { ok: true }
  }

  /** Lucro desejado do produto: em R$ ou em % do custo (o outro fica vazio); os dois vazios = margem geral. */
  async setProfit(user: AuthUser, sku: string, d: { profitValue: number | null; profitPct: number | null; profitSalePct?: number | null }, ctx: RequestCtx) {
    const key = normSku(sku)
    if (!key || key.length > 60) throw new BadRequestException('SKU inválido.')
    const cur = await this.prisma.marketplaceCost.findUnique({ where: { tenantId_sku: { tenantId: user.tenantId, sku: key } } })
    if (!cur) throw new BadRequestException('Informe o custo do produto antes do lucro.')
    const value = d.profitValue != null && d.profitValue >= 0 ? round2(d.profitValue) : null
    const pct = value === null && d.profitPct != null && d.profitPct >= 0 ? round2(Math.min(1000, d.profitPct)) : null
    const salePct = value === null && pct === null && d.profitSalePct != null && d.profitSalePct >= 0 ? round2(Math.min(90, d.profitSalePct)) : null
    await this.prisma.marketplaceCost.update({ where: { id: cur.id }, data: { profitValue: value, profitPct: pct, profitSalePct: salePct, updatedById: user.id, updatedByName: user.name.slice(0, 120) } })
    await this.audit.byUser(user, ctx, 'marketplace_precos.lucro', 'marketplace_cost', cur.id, { sku: key, lucro: value, lucroPct: pct, lucroVendaPct: salePct })
    return { ok: true }
  }

  /** Custo em massa: um valor ou um % sobre o preço cheio de venda, para os selecionados, um filtro ou todos. */
  async bulkCost(user: AuthUser, sel: Selection, mode: 'valor' | 'percentual', value: number, ctx: RequestCtx) {
    if (!(value >= 0) || (mode === 'percentual' && value > 100) || value > 10_000_000) throw new BadRequestException('Valor inválido.')
    const ids = await this.idsOf(user, sel)
    if (!ids.length) throw new BadRequestException('Nenhum anúncio na seleção.')
    const { list } = await this.rows(user.tenantId, { status: 'todos' }, ids)
    const by = { updatedById: user.id, updatedByName: user.name.slice(0, 120) }
    let done = 0
    let skipped = 0
    const seen = new Set<string>()
    for (const r of list) {
      if (seen.has(r.costKey)) continue
      seen.add(r.costKey)
      const cost = mode === 'valor' ? value : r.price === null ? null : round2((r.price * value) / 100)
      if (cost === null) {
        skipped++
        continue
      }
      const data = { cost, source: mode === 'valor' ? 'manual' : 'percentual', percent: mode === 'percentual' ? value : null, ...by }
      await this.prisma.marketplaceCost.upsert({ where: { tenantId_sku: { tenantId: user.tenantId, sku: r.costKey } }, create: { tenantId: user.tenantId, sku: r.costKey, ...data }, update: data })
      done++
    }
    await this.audit.byUser(user, ctx, 'marketplace_precos.custo_massa', 'marketplace_cost', undefined, { modo: mode, valor: value, skus: done })
    return { ok: true, message: `Custo gravado para ${done} SKU(s)${skipped ? `; ${skipped} sem preço ficaram de fora` : ''}.` }
  }

  /** Planilha CSV ou Excel com SKU e custo (cabeçalho opcional: "sku;custo"). */
  async importCosts(user: AuthUser, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    if (!file?.buffer?.length) throw new BadRequestException('Envie a planilha (.xlsx ou .csv) com as colunas SKU e custo, ou o relatório de preço e margem do ERP (.txt).')
    let rows: string[][]
    try {
      // Relatório em texto do ERP (Análise de preço e margem do Tcar): SKU, custo médio e lucro líquido.
      const text = file.buffer.subarray(0, 4).toString('hex') === '504b0304' ? '' : file.buffer.toString('latin1')
      rows = text && isErpTextReport(text) ? erpTextReportRows(text) : await readTable(file.buffer)
    } catch (e) {
      throw new BadRequestException(`Não foi possível ler a planilha: ${(e as Error).message}`)
    }
    let skuCol = 0
    let costCol = 1
    // Terceira coluna (opcional): lucro desejado em R$ ("lucro", ex.: o Lucro Líquido do produto no ERP).
    let profitCol = -1
    const head = (rows[0] ?? []).map((c) => c.trim().toLowerCase())
    if (head.some((h) => /sku|c[oó]digo/.test(h))) {
      skuCol = Math.max(0, head.findIndex((h) => /sku|c[oó]digo/.test(h)))
      const ci = head.findIndex((h) => /custo|cost/.test(h))
      costCol = ci >= 0 ? ci : skuCol === 0 ? 1 : 0
      profitCol = head.findIndex((h) => /lucro|profit/.test(h))
      rows = rows.slice(1)
    }
    const parse = (s: string) => {
      const t = s.replace(/[R$\s]/g, '')
      const v = /,\d{1,4}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, ''))
      return Number.isFinite(v) && v >= 0 && v <= 10_000_000 ? round2(v) : null
    }
    const invalid: { line: number; reason: string }[] = []
    const ok = new Map<string, number>()
    const profits = new Map<string, number>()
    rows.slice(0, 50_000).forEach((r, i) => {
      const sku = normSku(r[skuCol])
      const cost = parse(r[costCol] ?? '')
      if (!sku || sku.length > 60) invalid.push({ line: i + 2, reason: 'SKU vazio ou longo demais' })
      else if (cost === null) invalid.push({ line: i + 2, reason: `custo inválido (${(r[costCol] ?? '').slice(0, 20)})` })
      else {
        ok.set(sku, cost)
        const p = profitCol >= 0 && (r[profitCol] ?? '').trim() ? parse(r[profitCol] ?? '') : null
        if (p !== null) profits.set(sku, p)
      }
    })
    const by = { updatedById: user.id, updatedByName: user.name.slice(0, 120) }
    for (const [sku, cost] of ok) {
      const profit = profits.get(sku)
      const data = { cost, source: 'planilha', percent: null, ...(profit !== undefined ? { profitValue: profit, profitPct: null, profitSalePct: null } : {}), ...by }
      await this.prisma.marketplaceCost.upsert({ where: { tenantId_sku: { tenantId: user.tenantId, sku } }, create: { tenantId: user.tenantId, sku, ...data }, update: data })
    }
    await this.audit.byUser(user, ctx, 'marketplace_precos.custo_planilha', 'marketplace_cost', undefined, { arquivo: file.originalname.slice(0, 200), skus: ok.size, invalidas: invalid.length })
    return { imported: ok.size, invalid: invalid.slice(0, 100), invalidCount: invalid.length }
  }

  // ---------- Impostos ----------

  async taxesView(user: AuthUser) {
    const r = await this.taxes.rates(user.tenantId)
    const stored = await this.prisma.marketplaceNfeTax.count({ where: { tenantId: user.tenantId, cancelled: false } })
    return { stored, notes: r.notes, overall: r.overall, skus: Object.keys(r.bySku).length, ncms: Object.keys(r.byNcm).length, updatedAt: r.updatedAt || null }
  }

  async recomputeTaxes(user: AuthUser, ctx: RequestCtx) {
    const r = await this.taxes.recompute(user.tenantId)
    await this.audit.byUser(user, ctx, 'marketplace_precos.impostos_recalculados', 'setting', undefined, { notas: r.notes })
    return { ok: true, message: r.notes ? `Impostos recalculados com ${r.notes} nota(s) do Mercado Envios.` : 'Nenhuma nota do Mercado Envios importada ainda (Fretes › Pedidos › Importar XML).' }
  }

  // ---------- Prévia e envio ----------

  /** Antes → depois de cada anúncio, com a margem resultante (tarifa lida no preço novo). */
  async preview(user: AuthUser, ids: string[], action: PriceAction) {
    const T = user.tenantId
    const list = [...new Set(ids)].filter(isMlItemId)
    if (!list.length) throw new BadRequestException('Escolha ao menos um anúncio.')
    if (list.length > MAX_BATCH) throw new BadRequestException(`No máximo ${MAX_BATCH} anúncios por vez.`)
    const { list: rows, ctx } = await this.rows(T, { status: 'todos' }, list)
    const snaps = new Map((await this.prisma.marketplacePriceItem.findMany({ where: { tenantId: T, itemId: { in: list } } })).map((s) => [s.itemId, s]))
    const today = todayBr()
    const cfg = ctx.config
    const out = []
    for (const r of rows) {
      const s = snaps.get(r.id)!
      const warnings: string[] = []
      let error: string | null = null
      let after: { price: number; start?: string; finish?: string } | null = null
      const regular = r.price
      if (regular === null) error = 'Anúncio sem preço lido. Clique em Ler do Mercado Livre.'
      else if (action.tipo === 'preco') {
        let p: number | null = null
        if (action.modo === 'valor' || action.modo === 'percentual') p = applyPriceRule(regular, { mode: action.modo, value: Number(action.valor) })
        else {
          // Preço sugerido com lucro do produto (R$ da planilha/ERP ou % do preço de venda): o mesmo cálculo da lista.
          const own = action.modo === 'sugerido' ? r.profitTarget : null
          const target = action.modo === 'margem' ? Number(action.valor) : own?.source === 'produto_venda' ? (own.pct ?? null) : cfg.targetMarginPct
          if (own && own.source !== 'produto_venda') {
            if (r.cost === null) error = 'Sem custo: informe o custo do SKU.'
            else if (r.taxPct === null) error = 'Sem imposto: importe as notas do Mercado Envios ou informe a alíquota manual.'
            else if (s.saleFeePct === null) error = 'Tarifa do Mercado Livre não lida. Clique em Ler do Mercado Livre.'
            else {
              const pm = { fee: { pct: Number(s.saleFeePct), fixed: Number(s.saleFeeFixed ?? 0) }, shipping: r.margin.shipping ?? 0, taxPct: r.taxPct, extraPct: cfg.extraFeePct, cost: r.cost, fixedCost: cfg.fixedCostPerSale, marginMode: cfg.marginMode }
              // A tarifa muda com o preço (faixas e custo fixo): recalcula com a tarifa do preço achado.
              let model = pm
              p = priceForProfit(own.value, model)
              for (let i = 0; i < 4 && p !== null; i++) {
                const fee = (await this.feeAt(T, s, p))?.model
                if (!fee) break
                model = { ...model, fee }
                const next = priceForProfit(own.value, model)
                if (next === null || Math.abs(next - p) < 0.01) { p = next; break }
                p = next
              }
              if (p === null) error = 'Não dá para chegar a esse lucro (tarifa, imposto e taxas somam demais).'
            }
          } else if (target === null || !Number.isFinite(target)) error = 'Informe o lucro do produto (planilha de custos) ou configure a margem alvo (botão Configurações) para usar o preço sugerido.'
          else if (r.cost === null) error = 'Sem custo: informe o custo do SKU.'
          else if (r.taxPct === null) error = 'Sem imposto: importe as notas do Mercado Envios ou informe a alíquota manual.'
          else if (s.saleFeePct === null) error = 'Tarifa do Mercado Livre não lida. Clique em Ler do Mercado Livre.'
          else {
            const pm = { fee: { pct: Number(s.saleFeePct), fixed: Number(s.saleFeeFixed ?? 0) }, shipping: r.margin.shipping ?? 0, taxPct: r.taxPct, extraPct: cfg.extraFeePct, cost: r.cost, fixedCost: cfg.fixedCostPerSale, marginMode: own?.source === 'produto_venda' ? ('PRECO' as const) : cfg.marginMode }
            p = await refinePrice(target, pm, async (price) => (await this.feeAt(T, s, price))?.model ?? null)
            if (p === null) error = 'Não dá para chegar a essa margem (tarifa, imposto e taxas somam demais) ou a tarifa não pôde ser lida.'
          }
        }
        if (!error && p === null) error = 'Preço novo inválido.'
        if (!error && p !== null) {
          after = { price: p }
          if (r.hasVariations) warnings.push('Anúncio com variações: todas ficam com o mesmo preço.')
          if (r.promo) warnings.push(p > regular ? 'Preço maior: o Mercado Livre tira o desconto individual ativo.' : 'Com promoção ativa: se o preço novo ficar abaixo do promocional, o Mercado Livre encerra a promoção.')
        }
      } else if (action.tipo === 'promocao') {
        const deal = promoDealPrice(regular, { mode: action.modo, value: Number(action.valor) })
        error = deal === null ? 'Preço promocional inválido.' : validatePromo({ price: regular, dealPrice: deal, start: action.inicio, finish: action.fim, today })
        if (!error) after = { price: deal!, start: action.inicio, finish: action.fim }
        if (r.promo) warnings.push('O anúncio já tem promoção ativa; o Mercado Livre pode recusar ou aplicar só depois que ela acabar.')
        if (r.status !== 'active') warnings.push('O Mercado Livre só aceita desconto em anúncio ativo.')
      } else {
        if (!r.promo) error = 'O anúncio não tem promoção ativa.'
        else if (!OWN_PROMO.has(r.promo.type ?? '')) error = `Promoção de campanha (${r.promo.type ?? 'sem tipo'}): encerre no Mercado Livre.`
        else after = { price: regular }
      }
      let marginAfter: MarginResult | null = null
      if (after) {
        const fee = await this.feeAt(T, s, after.price)
        marginAfter = computeMargin({ price: after.price, fee: fee?.amount ?? null, shipping: r.margin.shipping, taxPct: r.taxPct, cost: r.cost, fixedCost: cfg.fixedCostPerSale, extraPct: cfg.extraFeePct, marginMode: cfg.marginMode })
        if (!fee) warnings.push('Tarifa no preço novo não lida: margem sem a tarifa.')
        if (r.freeShipping) warnings.push('Frete considerado: o custo atual (pode mudar com o preço).')
      }
      out.push({
        itemId: r.id,
        title: r.title,
        sku: r.sku,
        before: { price: regular, salePrice: r.salePrice, margin: r.margin.margin, marginPct: r.margin.marginPct },
        after: after ? { ...after, margin: marginAfter?.margin ?? null, marginPct: marginAfter?.marginPct ?? null, fee: marginAfter?.fee ?? null, missing: marginAfter?.missing ?? [] } : null,
        belowMin: !!marginAfter && marginAfter.marginPct !== null && marginAfter.marginPct < cfg.minMarginPct,
        unknownMargin: !!after && (marginAfter?.marginPct ?? null) === null,
        error,
        warnings,
      })
    }
    return { rows: out, minMarginPct: cfg.minMarginPct, belowMin: out.filter((r) => r.belowMin).length, errors: out.filter((r) => r.error).length }
  }

  /** Grava as alterações (fila ou agendadas) depois da revisão. Margem abaixo do mínimo exige "estou ciente". */
  async send(user: AuthUser, ids: string[], action: PriceAction, opts: { ack: boolean; scheduledAt?: string | null }, ctx: RequestCtx) {
    const T = user.tenantId
    await this.seller(T)
    const when = opts.scheduledAt ? new Date(opts.scheduledAt) : null
    if (when && (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000)) throw new BadRequestException('Data do agendamento inválida ou no passado.')
    if (when && when.getTime() > Date.now() + 90 * 86_400_000) throw new BadRequestException('Agende para no máximo 90 dias.')
    const pv = await this.preview(user, ids, action)
    const ok = pv.rows.filter((r) => !r.error && r.after)
    if (!ok.length) throw new BadRequestException(pv.rows[0]?.error ?? 'Nada para enviar.')
    if (ok.some((r) => r.belowMin) && !opts.ack) throw new BadRequestException(`Há anúncio(s) com margem abaixo do mínimo de ${pv.minMarginPct}%. Marque "estou ciente" para seguir.`)
    const batchId = randomUUID()
    const kind = action.tipo
    const status = when && when.getTime() > Date.now() ? 'AGENDADA' : 'PENDENTE'
    await this.prisma.marketplacePriceChange.createMany({
      data: ok.map((r) => ({
        tenantId: T,
        batchId,
        itemId: r.itemId,
        itemTitle: r.title.slice(0, 200),
        kind,
        before: r.before as unknown as Prisma.InputJsonValue,
        after: r.after as unknown as Prisma.InputJsonValue,
        marginBefore: r.before.margin,
        marginAfter: r.after!.margin,
        marginPctAfter: r.after!.marginPct,
        lowMarginAck: r.belowMin && opts.ack,
        status,
        scheduledAt: status === 'AGENDADA' ? when : null,
        createdById: user.id,
        createdByName: user.name.slice(0, 120),
      })),
    })
    await this.audit.byUser(user, ctx, 'marketplace_precos.enviado', 'marketplace_price_batch', batchId, { tipo: kind, anuncios: ok.length, agendado: status === 'AGENDADA' ? when!.toISOString() : null, cienteMargemBaixa: ok.some((r) => r.belowMin) })
    if (status === 'PENDENTE') this.kick(T)
    const skipped = pv.rows.length - ok.length
    return {
      ok: true,
      batchId,
      message: `${status === 'AGENDADA' ? `Agendado para ${when!.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'Enviando para o Mercado Livre, um por segundo'}: ${ok.length} anúncio(s).${skipped ? ` ${skipped} ficaram de fora por erro na prévia.` : ''}`,
    }
  }

  /** Fila por empresa: um envio por vez, ~1 por segundo. */
  private kick(tenantId: string) {
    if (this.workers.has(tenantId)) return
    this.workers.add(tenantId)
    void (async () => {
      try {
        for (;;) {
          const c = await this.prisma.marketplacePriceChange.findFirst({ where: { tenantId, status: 'PENDENTE' }, orderBy: { createdAt: 'asc' } })
          if (!c) break
          await this.processOne(c)
          await sleep(this.sendGapMs)
        }
      } catch (e) {
        this.logger.warn(`Preços: fila de envio: ${(e as Error).message}`)
      } finally {
        this.workers.delete(tenantId)
      }
    })()
  }

  private async processOne(c: Awaited<ReturnType<PrismaService['marketplacePriceChange']['findFirst']>> & object) {
    const T = c.tenantId
    const claimed = await this.prisma.marketplacePriceChange.updateMany({ where: { id: c.id, status: 'PENDENTE' }, data: { status: 'ENVIANDO' } })
    if (!claimed.count) return
    const after = c.after as Record<string, unknown>
    const fail = (msg: string) => this.prisma.marketplacePriceChange.update({ where: { id: c.id }, data: { status: 'ERRO', error: mlMessagePt(msg).slice(0, 500) } })
    try {
      const seller = await this.seller(T)
      const itemId = c.itemId!
      let before = c.before as Record<string, unknown> | null
      if (c.kind === 'preco') {
        const it = await this.ml.apiGet<MlItem>(T, `/items/${itemId}`, { attributes: 'id,price,status,sub_status,seller_id,variations' })
        if (String(it.seller_id) !== seller) throw new Error('o anúncio não é da conta conectada do Mercado Livre')
        const blocked = mlEditBlocked(it.status ?? null, it.sub_status ?? [])
        if (blocked) throw new Error(blocked)
        const price = Number(after.price)
        before = { ...(before ?? {}), price: it.price ?? (before?.price as number | undefined) ?? null }
        // Anúncio com variações: o preço vai em cada variação (todas iguais).
        const body = it.variations?.length ? { variations: it.variations.map((v) => ({ id: v.id, price })) } : { price }
        await this.ml.apiSend(T, 'PUT', `/items/${itemId}`, body, {}, sendRetryDelay)
      } else if (c.kind === 'promocao') {
        await this.ml.apiSend(T, 'POST', `/seller-promotions/items/${itemId}`, { deal_price: Number(after.price), start_date: `${String(after.start)}T00:00:00`, finish_date: `${String(after.finish)}T00:00:00`, promotion_type: 'PRICE_DISCOUNT' }, { app_version: 'v2' }, sendRetryDelay)
      } else if (c.kind === 'encerrar_promocao') {
        await this.ml.apiSend(T, 'DELETE', `/seller-promotions/items/${itemId}`, undefined, { promotion_type: 'PRICE_DISCOUNT', app_version: 'v2' }, sendRetryDelay)
      } else if (c.kind === 'cupom_item') {
        await this.ml.apiSend(T, 'POST', `/seller-promotions/items/${itemId}`, { promotion_id: c.mlRef, promotion_type: 'SELLER_COUPON_CAMPAIGN' }, { app_version: 'v2' }, sendRetryDelay)
      } else throw new Error(`tipo ${c.kind} não é enviado pela fila`)
      await this.prisma.marketplacePriceChange.update({ where: { id: c.id }, data: { status: 'ENVIADA', sentAt: new Date(), error: null, ...(before ? { before: before as unknown as Prisma.InputJsonValue } : {}) } })
      if (c.undoOfId) await this.prisma.marketplacePriceChange.updateMany({ where: { id: c.undoOfId, tenantId: T }, data: { status: 'DESFEITA', undoneAt: new Date() } })
      if (c.kind !== 'cupom_item') await this.rereadOne(T, itemId).catch(() => undefined)
    } catch (e) {
      await fail((e as Error).message)
    }
  }

  // ---------- Histórico, desfazer e cancelar ----------

  async history(user: AuthUser, q: { kind?: string; status?: string; itemId?: string; page?: number }) {
    const where: Prisma.MarketplacePriceChangeWhereInput = { tenantId: user.tenantId, ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}), ...(q.itemId ? { itemId: q.itemId } : {}) }
    const page = Math.max(1, q.page ?? 1)
    const [total, rows] = await Promise.all([this.prisma.marketplacePriceChange.count({ where }), this.prisma.marketplacePriceChange.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 100, take: 100 })])
    return { total, page, rows }
  }

  async cancel(user: AuthUser, id: string, ctx: RequestCtx) {
    const r = await this.prisma.marketplacePriceChange.updateMany({ where: { id, tenantId: user.tenantId, status: { in: ['AGENDADA', 'PENDENTE'] } }, data: { status: 'CANCELADA' } })
    if (!r.count) throw new NotFoundException('Alteração não encontrada ou já enviada.')
    await this.audit.byUser(user, ctx, 'marketplace_precos.cancelado', 'marketplace_price_change', id)
    return { ok: true }
  }

  /** Desfazer: volta o preço anterior, encerra a promoção criada ou exclui o cupom criado. */
  async undo(user: AuthUser, id: string, ctx: RequestCtx) {
    const T = user.tenantId
    const c = await this.prisma.marketplacePriceChange.findFirst({ where: { id, tenantId: T, status: 'ENVIADA' } })
    if (!c) throw new NotFoundException('Envio não encontrado (ou já desfeito).')
    const before = (c.before ?? {}) as Record<string, unknown>
    if (c.kind === 'cupom') {
      try {
        await this.ml.apiSend(T, 'DELETE', `/seller-promotions/promotions/${c.mlRef}`, undefined, { promotion_type: 'SELLER_COUPON_CAMPAIGN', app_version: 'v2' }, sendRetryDelay)
      } catch (e) {
        throw new BadRequestException(`O Mercado Livre não aceitou: ${mlMessagePt((e as Error).message)}`)
      }
      await this.prisma.marketplacePriceChange.update({ where: { id }, data: { status: 'DESFEITA', undoneAt: new Date() } })
      await this.audit.byUser(user, ctx, 'marketplace_precos.desfeito', 'marketplace_price_change', id, { tipo: c.kind, cupom: c.mlRef })
      return { ok: true, message: 'Cupom excluído no Mercado Livre.' }
    }
    let kind: string
    let after: Record<string, unknown>
    if (c.kind === 'preco') {
      const p = Number(before.price)
      if (!(p > 0)) throw new BadRequestException('Preço anterior não registrado.')
      kind = 'preco'
      after = { price: p }
    } else if (c.kind === 'promocao') {
      kind = 'encerrar_promocao'
      after = { price: before.price ?? null }
    } else throw new BadRequestException('Este tipo de alteração não tem desfazer automático.')
    await this.prisma.marketplacePriceChange.create({
      data: { tenantId: T, itemId: c.itemId, itemTitle: c.itemTitle, kind, before: c.after as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue, status: 'PENDENTE', undoOfId: c.id, createdById: user.id, createdByName: user.name.slice(0, 120) },
    })
    await this.audit.byUser(user, ctx, 'marketplace_precos.desfazer', 'marketplace_price_change', id, { tipo: c.kind, anuncio: c.itemId })
    this.kick(T)
    return { ok: true, message: kind === 'preco' ? 'Voltando o preço anterior no Mercado Livre.' : 'Encerrando a promoção no Mercado Livre.' }
  }

  // ---------- Cupons do vendedor ----------

  async coupons(user: AuthUser) {
    const T = user.tenantId
    const seller = await this.seller(T)
    // A lista de promoções da conta traz todos os tipos; ficam só as campanhas de cupom (SELLER_COUPON_CAMPAIGN).
    const list: { id: string; type?: string; status?: string; name?: string; start_date?: string; finish_date?: string }[] = []
    for (let offset = 0; offset < 200; offset += 50) {
      const r = await this.ml.apiGet<{ results?: typeof list; paging?: { total?: number } }>(T, `/seller-promotions/users/${seller}`, { app_version: 'v2', offset, limit: 50 })
      list.push(...(r.results ?? []))
      if (offset + 50 >= (r.paging?.total ?? 0)) break
    }
    const coupons = list.filter((p) => p.type === 'SELLER_COUPON_CAMPAIGN').slice(0, 40)
    const local = await this.prisma.marketplacePriceChange.findMany({ where: { tenantId: T, kind: 'cupom', mlRef: { in: coupons.map((c) => c.id) } }, select: { mlRef: true, createdByName: true, createdAt: true, id: true, status: true } })
    const byRef = new Map(local.map((l) => [l.mlRef, l]))
    const out = []
    for (const c of coupons) {
      const d = await this.ml.apiGet<Record<string, unknown>>(T, `/seller-promotions/promotions/${c.id}`, { promotion_type: 'SELLER_COUPON_CAMPAIGN', app_version: 'v2' }).catch(() => ({}) as Record<string, unknown>)
      out.push({ ...c, ...d, id: c.id, createdBy: byRef.get(c.id)?.createdByName ?? null, changeId: byRef.get(c.id)?.id ?? null })
    }
    return { coupons: out }
  }

  async couponItems(user: AuthUser, id: string) {
    const r = await this.ml.apiGet<{ results?: { id: string; status?: string }[] }>(user.tenantId, `/seller-promotions/promotions/${id}/items`, { promotion_type: 'SELLER_COUPON_CAMPAIGN', app_version: 'v2', limit: 50 })
    return { items: r.results ?? [] }
  }

  private couponCheck(c: CouponInput) {
    const err = validateCoupon(c, todayBr())
    if (err) throw new BadRequestException(err)
  }

  /** Margem por unidade com o cupom (pior caso: uma unidade que já atinge a compra mínima). */
  async couponPreview(user: AuthUser, c: CouponInput, ids: string[]) {
    this.couponCheck(c)
    const list = [...new Set(ids)].filter(isMlItemId).slice(0, MAX_BATCH)
    if (list.some((i) => !i.startsWith('MLB'))) throw new BadRequestException('Cupom do vendedor só existe no Mercado Livre Brasil (MLB).')
    const { list: rows, ctx } = await this.rows(user.tenantId, { status: 'todos' }, list)
    const out = []
    for (const r of rows) {
      const unit = r.salePrice === null ? null : couponUnitPrice(r.salePrice, c)
      let m: MarginResult | null = null
      if (unit !== null) {
        // A tarifa do Mercado Livre é sobre o preço do anúncio; o cupom sai do bolso da loja.
        m = computeMargin({ price: r.salePrice!, fee: r.margin.fee, shipping: r.margin.shipping, taxPct: r.taxPct, cost: r.cost, fixedCost: ctx.config.fixedCostPerSale, extraPct: ctx.config.extraFeePct, marginMode: ctx.config.marginMode })
        if (m.margin !== null) m = { ...m, margin: round2(m.margin - (r.salePrice! - unit)), marginPct: marginPctOf(round2(m.margin - (r.salePrice! - unit)), unit, r.cost, m.tax, ctx.config.marginMode) }
      }
      out.push({
        itemId: r.id,
        title: r.title,
        sku: r.sku,
        before: { price: r.salePrice, margin: r.margin.margin, marginPct: r.margin.marginPct },
        after: unit === null ? null : { price: unit, margin: m?.margin ?? null, marginPct: m?.marginPct ?? null },
        belowMin: !!m && m.marginPct !== null && m.marginPct < ctx.config.minMarginPct,
        unknownMargin: unit !== null && (m?.marginPct ?? null) === null,
        error: unit === null ? 'Uma unidade não atinge a compra mínima: o cupom só vale com mais itens no carrinho.' : null,
        warnings: [] as string[],
      })
    }
    return { rows: out, minMarginPct: ctx.config.minMarginPct, belowMin: out.filter((r) => r.belowMin).length, errors: out.filter((r) => r.error).length }
  }

  /** Cria a campanha de cupom no Mercado Livre e coloca os anúncios escolhidos nela (em segundo plano). */
  async createCoupon(user: AuthUser, c: CouponInput, ids: string[], ack: boolean, ctx: RequestCtx) {
    const T = user.tenantId
    await this.seller(T)
    const pv = await this.couponPreview(user, c, ids)
    if (pv.rows.some((r) => r.belowMin) && !ack) throw new BadRequestException(`Há anúncio(s) com margem abaixo do mínimo de ${pv.minMarginPct}% com o cupom. Marque "estou ciente" para seguir.`)
    let created: { id?: string; coupon_code?: string; status?: string }
    try {
      // Sem repetir em erro do servidor: a campanha pode ter sido criada (429 não cria nada).
      created = await this.ml.apiSend(T, 'POST', '/seller-promotions/promotions', couponBody(c), { app_version: 'v2' }, (status, attempt) => (status === 429 ? sendRetryDelay(status, attempt) : null))
    } catch (e) {
      throw new BadRequestException(`O Mercado Livre não aceitou o cupom: ${mlMessagePt((e as Error).message)}`)
    }
    if (!created.id) throw new BadRequestException('O Mercado Livre não devolveu o id da campanha. Confira em Central de promoções.')
    const batchId = randomUUID()
    await this.prisma.marketplacePriceChange.create({
      data: { tenantId: T, batchId, kind: 'cupom', itemTitle: c.name.slice(0, 200), after: { ...couponBody(c), id: created.id, coupon_code: created.coupon_code ?? null } as Prisma.InputJsonValue, mlRef: created.id, status: 'ENVIADA', sentAt: new Date(), lowMarginAck: ack && pv.rows.some((r) => r.belowMin), createdById: user.id, createdByName: user.name.slice(0, 120) },
    })
    const ok = pv.rows.filter((r) => !r.error)
    if (ok.length)
      await this.prisma.marketplacePriceChange.createMany({
        data: ok.map((r) => ({ tenantId: T, batchId, itemId: r.itemId, itemTitle: r.title.slice(0, 200), kind: 'cupom_item', mlRef: created.id!, before: r.before as unknown as Prisma.InputJsonValue, after: (r.after ?? {}) as unknown as Prisma.InputJsonValue, marginAfter: r.after?.margin ?? null, marginPctAfter: r.after?.marginPct ?? null, lowMarginAck: r.belowMin && ack, status: 'PENDENTE', createdById: user.id, createdByName: user.name.slice(0, 120) })),
      })
    await this.audit.byUser(user, ctx, 'marketplace_precos.cupom_criado', 'marketplace_price_batch', batchId, { cupom: created.id, codigo: created.coupon_code ?? null, anuncios: ok.length })
    this.kick(T)
    return { ok: true, id: created.id, code: created.coupon_code ?? null, message: `Cupom criado no Mercado Livre${created.coupon_code ? ` (código ${created.coupon_code})` : ''}. Incluindo ${ok.length} anúncio(s), um por segundo.` }
  }

  async endCoupon(user: AuthUser, id: string, ctx: RequestCtx) {
    const T = user.tenantId
    await this.seller(T)
    try {
      await this.ml.apiSend(T, 'DELETE', `/seller-promotions/promotions/${id}`, undefined, { promotion_type: 'SELLER_COUPON_CAMPAIGN', app_version: 'v2' }, sendRetryDelay)
    } catch (e) {
      throw new BadRequestException(`O Mercado Livre não aceitou: ${mlMessagePt((e as Error).message)}`)
    }
    await this.prisma.marketplacePriceChange.create({ data: { tenantId: T, kind: 'encerrar_cupom', mlRef: id, after: { id } as Prisma.InputJsonValue, status: 'ENVIADA', sentAt: new Date(), createdById: user.id, createdByName: user.name.slice(0, 120) } })
    await this.prisma.marketplacePriceChange.updateMany({ where: { tenantId: T, kind: 'cupom', mlRef: id, status: 'ENVIADA' }, data: { status: 'DESFEITA', undoneAt: new Date() } })
    await this.audit.byUser(user, ctx, 'marketplace_precos.cupom_encerrado', 'ml_coupon', id, { cupom: id })
    return { ok: true, message: 'Cupom excluído no Mercado Livre.' }
  }
}
