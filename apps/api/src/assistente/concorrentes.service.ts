import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import type { AuthUser } from '../common/types'
import { MlError } from '../marketplaces/mercadolivre'
import { MercadoLivreService } from '../marketplaces/mercadolivre.service'
import { PrismaService } from '../prisma/prisma.service'
import { AssistMlService, mapLimit } from './assist-ml.service'
import { compareByCode, competitorCodes, ownCodes } from './concorrentes'

/** Uma loja por vez; cada loja é relida uma vez por dia (o Mercado Livre limita as chamadas). */
const TICK_MS = 30 * 60_000
const DAY_MS = 86_400_000
const MAX_COMPETITORS = 20

interface MlItem {
  id: string
  title?: string
  permalink?: string
  price?: number
  status?: string
  shipping?: { free_shipping?: boolean }
  attributes?: { id?: string; name?: string; value_name?: string | null }[]
}

/**
 * Concorrentes do Mercado Livre: lojas informadas pelo link, com os anúncios relidos todo dia pela conexão oficial do
 * Mercado Livre, e a comparação de preço com os anúncios da Usaparts pelo código de referência.
 */
@Injectable()
export class ConcorrentesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConcorrentesService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly syncing = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: AssistMlService,
    private readonly mlConn: MercadoLivreService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  /** Lojas, a comparação (só os produtos com o mesmo código) e os números do topo. */
  async view(tenantId: string) {
    const competitors = await this.prisma.mlCompetitor.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    })
    const own = await this.prisma.assistItem.findMany({
      where: { tenantId, status: 'active' },
      select: {
        id: true,
        title: true,
        price: true,
        permalink: true,
        sellerSku: true,
        partNumber: true,
        attributes: true,
      },
    })
    const rivals = await this.prisma.mlCompetitorItem.findMany({
      where: { tenantId, status: 'active' },
      select: {
        competitorId: true,
        itemId: true,
        title: true,
        price: true,
        previousPrice: true,
        priceChangedAt: true,
        permalink: true,
        freeShipping: true,
        codes: true,
      },
    })
    const num = (v: unknown) => (v == null ? null : Number(v))
    const rows = compareByCode(
      own
        .map((i) => ({
          id: i.id,
          title: i.title,
          price: num(i.price),
          permalink: i.permalink,
          codes: ownCodes(i),
        }))
        .filter((i) => i.codes.length),
      rivals.map((r) => ({
        ...r,
        price: num(r.price),
        previousPrice: num(r.previousPrice),
      })),
    )
    return {
      competitors: competitors.map((c) => ({
        ...c,
        syncing: this.syncing.has(c.id),
      })),
      ownItems: own.length,
      rows: rows.slice(0, 1000),
      totals: {
        matched: rows.length,
        cheaper: rows.filter((r) => r.cheaper).length,
        dropped: rows.filter((r) => r.offers.some((o) => o.dropped)).length,
      },
    }
  }

  /** Nova loja pelo link (página da loja, perfil ou um anúncio dela). Lê os anúncios em segundo plano. */
  async add(user: AuthUser, input: string) {
    if (!(await this.mlConn.config(user.tenantId)).refreshTokenEnc) throw new BadRequestException('Conecte o Mercado Livre em Configurações › Marketplaces antes de comparar com concorrentes.')
    if (
      (await this.prisma.mlCompetitor.count({
        where: { tenantId: user.tenantId },
      })) >= MAX_COMPETITORS
    )
      throw new BadRequestException(`Limite de ${MAX_COMPETITORS} lojas: tire uma da lista antes de incluir outra.`)
    let store
    try {
      store = await this.ml.resolveStore(user.tenantId, input)
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
    if (store.is_connected_account) throw new BadRequestException('Este link é da própria loja da empresa.')
    const data = {
      input: store.input ?? input,
      nickname: store.nickname ?? null,
      officialStoreId: store.official_store_id ?? null,
      permalink: store.permalink ?? null,
      activeItems: store.active_items ?? null,
    }
    const c = await this.prisma.mlCompetitor.upsert({
      where: {
        tenantId_sellerId: {
          tenantId: user.tenantId,
          sellerId: store.seller_id!,
        },
      },
      create: {
        tenantId: user.tenantId,
        sellerId: store.seller_id!,
        createdByName: user.name,
        ...data,
      },
      update: data,
    })
    void this.sync(c.id)
    return { competitor: c }
  }

  async remove(tenantId: string, id: string) {
    const r = await this.prisma.mlCompetitor.deleteMany({
      where: { id, tenantId },
    })
    if (!r.count) throw new NotFoundException()
    return { ok: true }
  }

  async refresh(tenantId: string, id: string) {
    const c = await this.prisma.mlCompetitor.findFirst({
      where: { id, tenantId },
    })
    if (!c) throw new NotFoundException()
    void this.sync(c.id)
    return { started: true }
  }

  /** A cada 30 minutos: relê a loja mais antiga que passou de um dia sem leitura (uma por vez). */
  async tick() {
    if (this.running) return
    this.running = true
    try {
      const due = await this.prisma.mlCompetitor.findMany({
        where: {
          OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(Date.now() - DAY_MS) } }],
        },
        orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } },
        take: 3,
        select: { id: true },
      })
      for (const d of due) await this.sync(d.id)
    } catch (err) {
      this.logger.warn(`Concorrentes: ${(err as Error).message}`)
    } finally {
      this.running = false
    }
  }

  /**
   * Anúncios da loja concorrente pelos produtos do catálogo do Mercado Livre que a nossa loja também vende: para cada
   * produto, os anúncios dele (de todos os vendedores), ficando os da loja concorrente. Preço vem da própria lista do
   * produto, e os códigos são os do nosso anúncio do mesmo produto (é o mesmo produto do catálogo).
   */
  private async itemsByCatalog(tenantId: string, sellerId: string): Promise<{ id: string; title: string | null; permalink: string | null; price: number | null; freeShipping: boolean; codes: string[] }[]> {
    const own = await this.prisma.assistItem.findMany({ where: { tenantId, status: 'active' }, select: { id: true, title: true, sellerSku: true, partNumber: true, attributes: true } })
    const ownById = new Map(own.map((o) => [o.id, o]))
    const batches: string[][] = []
    for (let i = 0; i < own.length; i += 20) batches.push(own.slice(i, i + 20).map((o) => o.id))
    const products = new Map<string, string>()
    await mapLimit(batches, 3, async (batch) => {
      const res = await this.ml.get<{ code: number; body?: { id?: string; catalog_product_id?: string | null } }[]>(tenantId, '/items', { ids: batch.join(','), attributes: 'id,catalog_product_id' }).catch(() => [])
      for (const r of res ?? []) if (r.code === 200 && r.body?.catalog_product_id && r.body.id) products.set(r.body.catalog_product_id, r.body.id)
    })
    const found = new Map<string, { id: string; title: string | null; permalink: string | null; price: number | null; freeShipping: boolean; codes: string[] }>()
    let failed = 0
    await mapLimit([...products], 3, async ([pid, ownId]) => {
      const page = await this.ml.get<{ results?: { item_id?: string; seller_id?: number; price?: number; shipping?: { free_shipping?: boolean } }[] }>(tenantId, `/products/${pid}/items`, { limit: 100 }).catch(() => {
        failed++
        return null
      })
      const mine = ownById.get(ownId)
      for (const r of page?.results ?? []) {
        if (!r.item_id || String(r.seller_id ?? '') !== sellerId) continue
        found.set(r.item_id, {
          id: r.item_id,
          title: mine?.title ?? null,
          permalink: `https://produto.mercadolivre.com.br/${r.item_id.replace(/^([A-Z]{3})(\d+)$/, '$1-$2')}`,
          price: typeof r.price === 'number' ? r.price : null,
          freeShipping: !!r.shipping?.free_shipping,
          codes: mine ? ownCodes(mine) : [],
        })
      }
    })
    this.logger.log(`Concorrente ${sellerId}: ${found.size} anúncio(s) em ${products.size} produto(s) do catálogo da sua loja (${failed} consulta(s) recusada(s)).`)
    this.catalogStats = { products: products.size, failed }
    return [...found.values()]
  }

  private catalogStats = { products: 0, failed: 0 }

  /** Lê os anúncios ativos da loja (até 1.000, o limite da busca do Mercado Livre) e guarda preço e códigos. */
  async sync(id: string) {
    if (this.syncing.has(id)) return
    this.syncing.add(id)
    const c = await this.prisma.mlCompetitor.findUnique({ where: { id } })
    try {
      if (!c) return
      const now = new Date()
      let read = 0
      let withCode = 0
      const seen = new Set<string>()
      const store = async (it: { id: string; title: string | null; permalink: string | null; price: number | null; status: string | null; freeShipping: boolean; codes: string[] }) => {
        read++
        if (it.codes.length) withCode++
        seen.add(it.id)
        const old = await this.prisma.mlCompetitorItem.findUnique({ where: { competitorId_itemId: { competitorId: c.id, itemId: it.id } }, select: { price: true } })
        const changed = old?.price != null && it.price != null && Number(old.price) !== it.price
        const data = { title: it.title, permalink: it.permalink, price: it.price, status: it.status, freeShipping: it.freeShipping, codes: it.codes, syncedAt: now, ...(changed ? { previousPrice: old.price, priceChangedAt: now } : {}) }
        await this.prisma.mlCompetitorItem.upsert({ where: { competitorId_itemId: { competitorId: c.id, itemId: it.id } }, create: { tenantId: c.tenantId, competitorId: c.id, itemId: it.id, ...data }, update: data })
      }
      // 1) Busca dos anúncios do vendedor e leitura de cada um. O Mercado Livre pode fechar a busca (403) ou a leitura
      //    de anúncios de outras lojas: aí vale o caminho 2.
      let refused: string | null = null
      const ids = await this.ml
        .listStoreItemIds(c.tenantId, { seller_id: c.sellerId, site_id: 'MLB', official_store_id: c.officialStoreId })
        .catch((err: unknown) => {
          if (!(err instanceof MlError) || err.status !== 403) throw err
          refused = 'busca'
          return [] as string[]
        })
      const batches: string[][] = []
      for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20))
      const codesSeen = new Set<number>()
      await mapLimit(batches, 2, async (batch) => {
        const res = await this.ml.get<{ code: number; body?: MlItem }[]>(c.tenantId, '/items', { ids: batch.join(','), attributes: 'id,title,permalink,price,status,shipping,attributes' })
        for (const r of res ?? []) {
          if (r.code !== 200 || !r.body) {
            codesSeen.add(r.code)
            continue
          }
          const it = r.body
          await store({ id: it.id, title: it.title ?? null, permalink: it.permalink ?? null, price: it.price ?? null, status: it.status ?? null, freeShipping: !!it.shipping?.free_shipping, codes: competitorCodes(it.attributes, it.title) })
        }
      })
      if (ids.length && !read) refused = `leitura (código ${[...codesSeen].join(', ') || '?'})`
      // 2) Produtos do catálogo que a nossa loja também vende.
      let viaCatalog = false
      if (!read) {
        viaCatalog = true
        for (const it of await this.itemsByCatalog(c.tenantId, c.sellerId)) await store({ ...it, status: 'active' })
      }
      // Anúncio que saiu da busca (pausado ou encerrado): deixa de entrar na comparação.
      await this.prisma.mlCompetitorItem.updateMany({
        where: { competitorId: c.id, itemId: { notIn: [...seen] } },
        data: { status: 'inactive' },
      })
      await this.prisma.mlCompetitor.update({
        where: { id: c.id },
        data: {
          itemsRead: read,
          itemsWithCode: withCode,
          lastSyncAt: now,
          lastError: read
            ? null
            : viaCatalog
              ? `O Mercado Livre não libera ${refused ? `a ${refused}` : 'a lista'} de anúncios de outras lojas. Pelos produtos do catálogo que a sua loja vende (${this.catalogStats.products}${this.catalogStats.failed ? `, ${this.catalogStats.failed} consulta(s) recusada(s)` : ''}), nenhum anúncio desta loja foi encontrado.`
              : 'O Mercado Livre não listou anúncios ativos desta loja.',
        },
      })
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300)
      this.logger.warn(`Concorrente ${c?.nickname ?? id}: ${msg}`)
      if (c)
        await this.prisma.mlCompetitor
          .update({
            where: { id: c.id },
            data: { lastError: msg, lastSyncAt: new Date() },
          })
          .catch(() => undefined)
    } finally {
      this.syncing.delete(id)
    }
  }
}
