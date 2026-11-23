import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { PedidosService } from './pedidos.service'
import { parseSswTracking, SSW_TRACKING_URL, type TrackingResult, trackingLine } from './rastreio'
import { assertCan } from './acesso'

/** Pedidos que ainda podem mudar com o rastreamento (já saíram ou vão sair, e não foram entregues). */
const OPEN_STATUSES = ['APROVADO', 'AGUARDANDO_COLETA', 'DESPACHADO', 'EM_TRANSITO', 'COM_OCORRENCIA']
const TICK_MS = 30 * 60_000
/** Cada pedido é consultado de novo depois de 4 horas; só os dos últimos 60 dias. */
const RECHECK_MS = 4 * 3600_000
const MAX_AGE_DAYS = 60
const BATCH = 80
const PAUSE_MS = 1500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Rastreamento dos pedidos pela chave da NF-e (SSW: TW Transportes e outras transportadoras do sistema SSW). Na tela
 * do pedido, na hora; em segundo plano, a cada 30 minutos, os pedidos em aberto: guarda a última ocorrência e, quando
 * o rastreamento mostra a entrega, marca o pedido como entregue com a data da entrega.
 */
@Injectable()
export class RastreioService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RastreioService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipments: PedidosService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private async fetchSsw(key: string): Promise<TrackingResult> {
    const res = await fetch(SSW_TRACKING_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ chave_nfe: key }), signal: AbortSignal.timeout(15_000) })
    const body = await res.json().catch(() => null)
    if (!res.ok && !body) throw new Error(`O rastreamento respondeu HTTP ${res.status}.`)
    return parseSswTracking(body)
  }

  /** Guarda a consulta e, se entregou, muda o pedido para entregue (com o histórico). */
  private async apply(s: { id: string; status: string; deliveredAt: Date | null }, r: TrackingResult) {
    await this.prisma.freightShipment.update({ where: { id: s.id }, data: { trackingAt: new Date(), trackingLast: trackingLine(r) ?? (r.found ? null : r.message.slice(0, 200) || null), trackingCarrier: r.carrier } })
    if (!r.deliveredAt || !OPEN_STATUSES.includes(s.status)) return false
    const at = new Date(r.deliveredAt)
    await this.prisma.freightShipment.update({ where: { id: s.id }, data: { status: 'ENTREGUE', deliveredAt: at } })
    const who = r.events.find((e) => e.receiver)?.receiver
    await this.prisma.freightShipmentEvent.create({ data: { shipmentId: s.id, status: 'ENTREGUE', note: `Entrega confirmada pelo rastreamento da transportadora${r.carrier ? ` (${r.carrier})` : ''}${who ? `, recebido por ${who}` : ''}.`.slice(0, 500), userName: 'Rastreamento automático' } })
    return true
  }

  /** Rastreio de um pedido, na hora (tela do pedido). */
  async track(user: AuthUser, id: string) {
    assertCan(user, 'fretes_pedidos', 'view')
    const s = await this.shipments.find(user, id)
    if (!s.invoiceKey) return { available: false as const, message: 'Informe a chave da NF-e no pedido para rastrear.' }
    const r = await this.fetchSsw(s.invoiceKey).catch((e: unknown) => ({ found: false, message: `Rastreamento fora do ar: ${(e as Error).message}`.slice(0, 200), carrier: null, events: [], deliveredAt: null }) satisfies TrackingResult)
    const delivered = await this.apply(s, r).catch(() => false)
    return { available: true as const, ...r, markedDelivered: delivered }
  }

  private async tick() {
    if (this.busy) return
    this.busy = true
    try {
      const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000)
      const list = await this.prisma.freightShipment.findMany({
        where: { invoiceKey: { not: null }, status: { in: OPEN_STATUSES }, createdAt: { gte: since }, OR: [{ trackingAt: null }, { trackingAt: { lt: new Date(Date.now() - RECHECK_MS) } }] },
        orderBy: [{ trackingAt: { sort: 'asc', nulls: 'first' } }],
        take: BATCH,
        select: { id: true, status: true, deliveredAt: true, invoiceKey: true },
      })
      let delivered = 0
      for (const s of list) {
        try {
          if (await this.apply(s, await this.fetchSsw(s.invoiceKey!))) delivered++
        } catch (e) {
          this.logger.warn(`Rastreio do pedido ${s.id}: ${(e as Error).message}`)
        }
        await sleep(PAUSE_MS)
      }
      if (delivered) this.logger.log(`Rastreamento: ${delivered} pedido(s) marcados como entregues.`)
    } catch (e) {
      this.logger.warn(`Rastreamento: ${(e as Error).message}`)
    } finally {
      this.busy = false
    }
  }
}
