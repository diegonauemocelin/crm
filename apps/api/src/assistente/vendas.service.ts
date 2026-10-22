/**
 * Vendas × perguntas. Um pedido do Mercado Livre fica ligado a uma pergunta quando o MESMO comprador perguntou antes
 * da compra (dentro da janela configurada) e comprou o anúncio em que perguntou ("mesmo_anuncio") ou um anúncio
 * indicado com link na resposta enviada ("anuncio_indicado"). Pedidos não pagos mostram quem desistiu no checkout.
 */
import { Injectable } from '@nestjs/common'
import { AssistService } from './assist.service'
import { AssistMlService } from './assist-ml.service'
import { ABANDON_HOURS, ORDER_STATUS_LABELS, OUTCOME_LABELS, outcomeOf, SOLD_STATUSES } from './constantes'

interface MlOrder {
  id: number | string
  status?: string
  date_created?: string
  date_closed?: string
  currency_id?: string
  buyer?: { id?: number | string; nickname?: string; first_name?: string; last_name?: string }
  order_items?: { item?: { id?: string; title?: string }; quantity?: number; unit_price?: number; currency_id?: string }[]
  payments?: { status?: string; date_created?: string; date_last_modified?: string }[]
}

const PAID_PAYMENT = ['approved', 'authorized', 'refunded', 'charged_back', 'in_mediation']
const money = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Pagamento que chegou a ser aprovado (separa "desistiu no checkout" de "cancelou depois de pagar"). */
function paymentInfo(order: MlOrder) {
  const pays = [...(order.payments ?? [])].sort((a, b) => String(a.date_last_modified ?? a.date_created ?? '').localeCompare(String(b.date_last_modified ?? b.date_created ?? '')))
  return { paid: pays.some((p) => PAID_PAYMENT.includes(p.status ?? '')) || SOLD_STATUSES.includes(order.status ?? ''), status: pays.length ? (pays[pays.length - 1]!.status ?? null) : null }
}

@Injectable()
export class AssistSalesService {
  running = false
  lastResult: { orders: number; linked: number; at: string } | null = null

  constructor(
    private readonly assist: AssistService,
    private readonly ml: AssistMlService,
  ) {}

  private get prisma() {
    return this.assist.prisma
  }

  /** IDs de anúncios citados nas respostas enviadas (links ou MLB no texto). */
  private async indicatedItemIds(tenantId: string, questionId: number) {
    const ids = new Set<string>()
    const texts = (await this.prisma.assistAttempt.findMany({ where: { questionId, sendStatus: 'enviada' }, select: { text: true } })).map((r) => r.text)
    for (const t of texts) {
      for (const m of t.matchAll(/\bMLB-?(\d{6,})/gi)) ids.add(`MLB${m[1]}`)
      for (const m of t.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
        const url = m[0].replace(/[.,;:!?]+$/, '')
        const row = await this.prisma.assistItem.findFirst({ where: { tenantId, OR: [{ permalink: url }, { permalink: url.split(/[?#]/)[0] }] }, select: { id: true } })
        if (row) ids.add(row.id)
      }
    }
    return ids
  }

  private async findQuestion(tenantId: string, buyerId: string, itemId: string, orderDate: Date, windowDays: number) {
    const candidates = await this.prisma.assistQuestion.findMany({
      where: { tenantId, customerId: buyerId, receivedAt: { lte: orderDate, gte: new Date(orderDate.getTime() - windowDays * 86_400_000) } },
      orderBy: { receivedAt: 'desc' },
      select: { id: true, mlItemId: true, receivedAt: true },
    })
    const same = candidates.find((q) => q.mlItemId === itemId)
    if (same) return { q: same, match: 'mesmo_anuncio' }
    for (const q of candidates) if ((await this.indicatedItemIds(tenantId, q.id)).has(itemId)) return { q, match: 'anuncio_indicado' }
    return null
  }

  private async outcomeEvent(tenantId: string, questionId: number, orderId: string, itemTitle: string, total: number, outcome: string) {
    const note = {
      comprou: `Pagamento confirmado: pedido ${orderId}, ${itemTitle} (${money(total)}).`,
      aguardando_pagamento: `Cliente foi ao checkout: pedido ${orderId} criado, aguardando pagamento, ${itemTitle} (${money(total)}).`,
      desistiu_checkout: `Cliente foi ao checkout e desistiu: o pagamento do pedido ${orderId} não foi concluído, ${itemTitle} (${money(total)}).`,
      cancelou_apos_pagar: `Pedido ${orderId} cancelado depois de pago, ${itemTitle} (${money(total)}).`,
    }[outcome]
    const type = { comprou: 'venda_vinculada', aguardando_pagamento: 'checkout_iniciado', desistiu_checkout: 'checkout_abandonado', cancelou_apos_pagar: 'venda_cancelada' }[outcome]!
    await this.assist.addEvent(tenantId, questionId, type, { note, data: { order_id: orderId, outcome } })
  }

  /** Liga (ou atualiza) os itens de um pedido; devolve quantos foram ligados agora. */
  async processOrder(tenantId: string, order: MlOrder, windowDays?: number) {
    const buyerId = order.buyer?.id ? String(order.buyer.id) : null
    if (!buyerId || !Array.isArray(order.order_items)) return 0
    // o nome real do cliente só vem nos pedidos
    const buyerName = [order.buyer?.first_name, order.buyer?.last_name].filter(Boolean).join(' ').trim().slice(0, 120)
    if (buyerName) await this.prisma.assistQuestion.updateMany({ where: { tenantId, customerId: buyerId, NOT: { customerName: buyerName } }, data: { customerName: buyerName } })
    if (order.buyer?.nickname) await this.prisma.assistQuestion.updateMany({ where: { tenantId, customerId: buyerId, customerNickname: null }, data: { customerNickname: order.buyer.nickname } })
    const days = windowDays ?? (await this.assist.integration(tenantId)).sales_window_days
    const orderDate = new Date(order.date_created ?? order.date_closed ?? Date.now())
    const pay = paymentInfo(order)
    let linked = 0
    for (const oi of order.order_items) {
      const itemId = oi?.item?.id
      if (!itemId) continue
      const qty = Number(oi.quantity) || 1
      const unit = Number(oi.unit_price) || 0
      const title = oi.item?.title ?? itemId
      const existing = await this.prisma.assistSale.findUnique({ where: { tenantId_mlOrderId_mlItemId: { tenantId, mlOrderId: String(order.id), mlItemId: itemId } } })
      if (existing) {
        const paidBefore = existing.paidBefore || pay.paid
        const before = outcomeOf(existing.orderStatus, existing.paidBefore, existing.orderDate)
        const after = outcomeOf(order.status, paidBefore, existing.orderDate)
        if (existing.orderStatus !== order.status || existing.paidBefore !== paidBefore || existing.paymentStatus !== pay.status) {
          await this.prisma.assistSale.update({ where: { id: existing.id }, data: { orderStatus: order.status ?? null, paidBefore, paymentStatus: pay.status, updatedAt: new Date() } })
        }
        if (before !== after) await this.outcomeEvent(tenantId, existing.questionId, String(order.id), title, Number(existing.total ?? 0), after)
        continue
      }
      const found = await this.findQuestion(tenantId, buyerId, itemId, orderDate, days)
      if (!found) continue
      const hours = (orderDate.getTime() - found.q.receivedAt.getTime()) / 3_600_000
      try {
        await this.prisma.assistSale.create({
          data: {
            tenantId,
            mlOrderId: String(order.id),
            mlItemId: itemId,
            itemTitle: oi.item?.title ?? null,
            questionId: found.q.id,
            buyerId,
            orderStatus: order.status ?? null,
            orderDate,
            quantity: qty,
            unitPrice: unit,
            total: qty * unit,
            currency: oi.currency_id ?? order.currency_id ?? 'BRL',
            matchType: found.match,
            hoursAfterQuestion: Math.round(hours * 10) / 10,
            paidBefore: pay.paid,
            paymentStatus: pay.status,
          },
        })
      } catch {
        continue // chegou ao mesmo tempo pelo webhook e pela busca
      }
      linked++
      await this.outcomeEvent(tenantId, found.q.id, String(order.id), `${qty}× ${title}${found.match === 'anuncio_indicado' ? ' (anúncio indicado na resposta)' : ''}`, qty * unit, outcomeOf(order.status, pay.paid, orderDate))
    }
    return linked
  }

  /** Pedidos que passaram de 48 h sem pagamento viram "desistiu no checkout" (registra na trajetória uma vez). */
  async markStaleCheckouts(tenantId: string) {
    const rows = await this.prisma.$queryRaw<{ id: number; questionId: number; mlOrderId: string; itemTitle: string | null; mlItemId: string; total: string | null }[]>`
      SELECT s.id, s."questionId", s."mlOrderId", s."itemTitle", s."mlItemId", s.total::text AS total FROM assist_sales s
       WHERE s."tenantId" = ${tenantId}::uuid AND s."orderStatus" IN ('payment_required','payment_in_process','confirmed')
         AND s."orderDate" < ${new Date(Date.now() - ABANDON_HOURS * 3_600_000)}
         AND NOT EXISTS (SELECT 1 FROM assist_events e WHERE e."questionId" = s."questionId" AND e.type = 'checkout_abandonado' AND e.data->>'order_id' = s."mlOrderId")`
    for (const s of rows) await this.outcomeEvent(tenantId, s.questionId, s.mlOrderId, s.itemTitle ?? s.mlItemId, Number(s.total ?? 0), 'desistiu_checkout')
    return rows.length
  }

  /** Busca os pedidos no Mercado Livre e liga às perguntas (desde a última busca, com 2 dias de margem; `days` força mais). */
  async sync(tenantId: string, days?: number) {
    const s = await this.assist.integration(tenantId)
    if (!s.sales_enabled || !(await this.ml.active(tenantId))) return { skipped: true }
    if (this.running) return { skipped: true, running: true }
    const first = await this.prisma.assistQuestion.findFirst({ where: { tenantId, customerId: { not: null } }, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } })
    if (!first) return { orders: 0, linked: 0 }
    const st = await this.assist.state(tenantId)
    const now = Date.now()
    let from = days ? now - days * 86_400_000 : st.lastOrdersSyncAt ? Date.parse(st.lastOrdersSyncAt) - 2 * 86_400_000 : now - 90 * 86_400_000
    from = Math.max(from, first.receivedAt.getTime())
    this.running = true
    try {
      const seller = await this.ml.sellerId(tenantId)
      const orders = (await this.ml.searchOrders(tenantId, seller!, new Date(from), new Date(now))) as unknown as MlOrder[]
      const buyers = new Set((await this.prisma.assistQuestion.findMany({ where: { tenantId, customerId: { not: null } }, distinct: ['customerId'], select: { customerId: true } })).map((r) => r.customerId!))
      let linked = 0
      for (const o of orders) if (buyers.has(String(o.buyer?.id))) linked += await this.processOrder(tenantId, o, s.sales_window_days)
      // pedidos ligados que ainda aguardavam pagamento: atualiza a situação
      const open = await this.prisma.assistSale.findMany({ where: { tenantId, NOT: { orderStatus: { in: ['paid', 'partially_refunded', 'cancelled', 'invalid'] } }, updatedAt: { lt: new Date(now - 3_600_000) } }, distinct: ['mlOrderId'], select: { mlOrderId: true }, take: 50 })
      for (const { mlOrderId } of open) {
        try {
          await this.processOrder(tenantId, (await this.ml.getOrder(tenantId, mlOrderId)) as unknown as MlOrder, s.sales_window_days)
          await this.prisma.assistSale.updateMany({ where: { tenantId, mlOrderId }, data: { updatedAt: new Date() } })
        } catch (e) {
          await this.assist.log(tenantId, 'warn', `Vendas: não foi possível atualizar o pedido ${mlOrderId}: ${(e as Error).message}`)
        }
      }
      await this.markStaleCheckouts(tenantId)
      await this.assist.patchState(tenantId, { lastOrdersSyncAt: new Date().toISOString(), ordersError: null })
      this.lastResult = { orders: orders.length, linked, at: new Date().toISOString() }
      if (linked) await this.assist.log(tenantId, 'info', `Vendas: ${linked} venda(s) ligada(s) a perguntas (${orders.length} pedido(s) analisados).`)
      return this.lastResult
    } catch (e) {
      const status = (e as { status?: number }).status
      const msg = status === 403 || status === 401 ? 'O aplicativo não tem permissão para ler as vendas. No Mercado Livre Developers, ative a permissão "Vendas" (pedidos) e reconecte a conta.' : `Falha ao buscar vendas: ${(e as Error).message}`
      await this.assist.patchState(tenantId, { ordersError: msg })
      await this.assist.log(tenantId, 'error', msg)
      throw new Error(msg)
    } finally {
      this.running = false
    }
  }

  /** Vendas ligadas a uma pergunta (tela de detalhe). */
  async forQuestion(tenantId: string, questionId: number) {
    const rows = await this.prisma.assistSale.findMany({ where: { tenantId, questionId }, orderBy: { orderDate: 'asc' } })
    const items = await this.prisma.assistItem.findMany({ where: { tenantId, id: { in: rows.map((r) => r.mlItemId) } }, select: { id: true, permalink: true } })
    const link = new Map(items.map((i) => [i.id, i.permalink]))
    return rows.map((s) => {
      const outcome = outcomeOf(s.orderStatus, s.paidBefore, s.orderDate)
      return { ...s, unitPrice: s.unitPrice === null ? null : Number(s.unitPrice), total: s.total === null ? null : Number(s.total), permalink: link.get(s.mlItemId) ?? null, sold: outcome === 'comprou', outcome, outcomeLabel: OUTCOME_LABELS[outcome], statusLabel: ORDER_STATUS_LABELS[s.orderStatus ?? ''] ?? s.orderStatus }
    })
  }
}
