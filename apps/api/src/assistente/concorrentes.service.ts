import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import type { AuthUser } from '../common/types'
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

  /** Lê os anúncios ativos da loja (até 1.000, o limite da busca do Mercado Livre) e guarda preço e códigos. */
  async sync(id: string) {
    if (this.syncing.has(id)) return
    this.syncing.add(id)
    const c = await this.prisma.mlCompetitor.findUnique({ where: { id } })
    try {
      if (!c) return
      const ids = await this.ml.listStoreItemIds(c.tenantId, {
        seller_id: c.sellerId,
        site_id: 'MLB',
        official_store_id: c.officialStoreId,
      })
      const batches: string[][] = []
      for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20))
      const now = new Date()
      let read = 0
      let withCode = 0
      const seen = new Set<string>()
      await mapLimit(batches, 2, async (batch) => {
        const res = await this.ml.get<{ code: number; body?: MlItem }[]>(c.tenantId, '/items', {
          ids: batch.join(','),
          attributes: 'id,title,permalink,price,status,shipping,attributes',
        })
        for (const r of res ?? []) {
          if (r.code !== 200 || !r.body) continue
          const it = r.body
          const codes = competitorCodes(it.attributes, it.title)
          read++
          if (codes.length) withCode++
          seen.add(it.id)
          const old = await this.prisma.mlCompetitorItem.findUnique({
            where: {
              competitorId_itemId: { competitorId: c.id, itemId: it.id },
            },
            select: { price: true },
          })
          const price = it.price ?? null
          const changed = old?.price != null && price != null && Number(old.price) !== price
          const data = {
            title: it.title ?? null,
            permalink: it.permalink ?? null,
            price,
            status: it.status ?? null,
            freeShipping: !!it.shipping?.free_shipping,
            codes,
            syncedAt: now,
            ...(changed ? { previousPrice: old.price, priceChangedAt: now } : {}),
          }
          await this.prisma.mlCompetitorItem.upsert({
            where: {
              competitorId_itemId: { competitorId: c.id, itemId: it.id },
            },
            create: {
              tenantId: c.tenantId,
              competitorId: c.id,
              itemId: it.id,
              ...data,
            },
            update: data,
          })
        }
      })
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
          lastError: ids.length ? null : 'O Mercado Livre não listou anúncios ativos desta loja.',
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
