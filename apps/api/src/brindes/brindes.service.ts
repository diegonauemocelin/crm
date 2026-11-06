import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { balances, dayOf, deliveryProblem, monthOf, monthRange } from './brindes'

const MODULE = 'brindes'
const n = (d: Prisma.Decimal | number) => Number(d)

export interface GiftInput {
  name?: string
  stock?: number
  unitCost?: number
  active?: boolean
}

export interface DeliveryInput {
  giftId: string
  sellerId: string
  customerCode: string
  customerName?: string | null
  date?: string | null
  quantity?: number
  notes?: string | null
}

@Injectable()
export class BrindesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  assertCan(user: AuthUser, action: Action = 'view') {
    if (!can(user.permissions, user.role.isSystem, MODULE, action)) throw new ForbiddenException('Seu perfil não tem acesso a esta ação do controle de brindes.')
  }

  private scopeOf(user: AuthUser): Scope {
    return user.role.isSystem ? 'ALL' : (user.permissions[MODULE]?.scope ?? 'ALL')
  }

  /** Vendedores que a pessoa vê: os próprios (vendedor ligado ao usuário), os da unidade ou todos. */
  private sellerWhere(user: AuthUser): Prisma.SellerWhereInput {
    const s = this.scopeOf(user)
    if (s === 'OWN') return { tenantId: user.tenantId, userId: user.id }
    if (s === 'UNIT') return { tenantId: user.tenantId, unitId: user.unitId ?? '00000000-0000-0000-0000-000000000000' }
    return { tenantId: user.tenantId }
  }

  private async assertSeller(user: AuthUser, sellerId: string) {
    const seller = await this.prisma.seller.findFirst({ where: { ...this.sellerWhere(user), id: sellerId }, select: { id: true, name: true } })
    if (!seller) throw new ForbiddenException('Vendedor fora do seu acesso.')
    return seller
  }

  // ---------- Cadastro ----------

  async gifts(user: AuthUser) {
    this.assertCan(user)
    const rows = await this.prisma.gift.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { _count: { select: { deliveries: true } } } })
    return rows.map((g) => ({ id: g.id, name: g.name, stock: g.stock, unitCost: n(g.unitCost), active: g.active, stockValue: Math.round(g.stock * n(g.unitCost) * 100) / 100, deliveries: g._count.deliveries }))
  }

  async saveGift(user: AuthUser, id: string | null, d: GiftInput, ctx: RequestCtx) {
    this.assertCan(user, id ? 'edit' : 'create')
    const name = d.name?.trim()
    if (!id && !name) throw new BadRequestException('Informe o nome do brinde.')
    if (d.stock !== undefined && (!Number.isInteger(d.stock) || d.stock < 0)) throw new BadRequestException('Estoque inválido.')
    if (d.unitCost !== undefined && !(d.unitCost >= 0)) throw new BadRequestException('Valor unitário inválido.')
    const dup = name ? await this.prisma.gift.findFirst({ where: { tenantId: user.tenantId, name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } }) : null
    if (dup) throw new BadRequestException('Já existe um brinde com esse nome.')
    const data = { ...(name ? { name: name.slice(0, 80) } : {}), ...(d.stock !== undefined ? { stock: d.stock } : {}), ...(d.unitCost !== undefined ? { unitCost: Math.round(d.unitCost * 100) / 100 } : {}), ...(d.active !== undefined ? { active: d.active } : {}) }
    let gift
    if (id) {
      const cur = await this.prisma.gift.findFirst({ where: { id, tenantId: user.tenantId } })
      if (!cur) throw new NotFoundException('Brinde não encontrado.')
      gift = await this.prisma.gift.update({ where: { id }, data })
      await this.audit.byUser(user, ctx, 'brinde.updated', 'gift', id, { de: { stock: cur.stock, unitCost: n(cur.unitCost), active: cur.active }, para: data })
    } else {
      gift = await this.prisma.gift.create({ data: { tenantId: user.tenantId, name: name!.slice(0, 80), stock: d.stock ?? 0, unitCost: Math.round((d.unitCost ?? 0) * 100) / 100, active: d.active ?? true } })
      await this.audit.byUser(user, ctx, 'brinde.created', 'gift', gift.id, { name: gift.name })
    }
    return { id: gift.id }
  }

  async removeGift(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const g = await this.prisma.gift.findFirst({ where: { id, tenantId: user.tenantId }, include: { _count: { select: { deliveries: true } } } })
    if (!g) throw new NotFoundException('Brinde não encontrado.')
    if (g._count.deliveries) throw new BadRequestException('Este brinde já tem retiradas. Desative em vez de excluir (o histórico fica).')
    await this.prisma.gift.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'brinde.deleted', 'gift', id, { name: g.name })
    return { ok: true }
  }

  // ---------- Cotas e saldo do mês ----------

  async month(user: AuthUser, monthIn?: string) {
    this.assertCan(user)
    const month = monthOf(monthIn)
    const { start, end } = monthRange(month)
    const sellers = await this.prisma.seller.findMany({ where: { ...this.sellerWhere(user), active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
    const ids = sellers.map((s) => s.id)
    const [gifts, quotas, used] = await Promise.all([
      this.prisma.gift.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, stock: true, unitCost: true, active: true } }),
      this.prisma.giftQuota.findMany({ where: { tenantId: user.tenantId, sellerId: { in: ids } }, select: { sellerId: true, giftId: true, monthly: true } }),
      this.prisma.giftDelivery.groupBy({ by: ['sellerId', 'giftId'], where: { tenantId: user.tenantId, sellerId: { in: ids }, date: { gte: start, lt: end } }, _sum: { quantity: true } }),
    ])
    const cost = new Map(gifts.map((g) => [g.id, n(g.unitCost)]))
    return {
      month,
      gifts: gifts.map((g) => ({ id: g.id, name: g.name, stock: g.stock, unitCost: n(g.unitCost), active: g.active })),
      sellers: sellers.map((s) => {
        const items = balances(
          quotas.filter((q) => q.sellerId === s.id),
          used.filter((u) => u.sellerId === s.id).map((u) => ({ giftId: u.giftId, quantity: u._sum.quantity ?? 0 })),
        )
        return { id: s.id, name: s.name, items, value: Math.round(items.reduce((t, i) => t + i.used * (cost.get(i.giftId) ?? 0), 0) * 100) / 100 }
      }),
    }
  }

  async saveQuotas(user: AuthUser, list: { sellerId: string; giftId: string; monthly: number }[], ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    if (this.scopeOf(user) === 'OWN') throw new ForbiddenException('Seu perfil não define cotas.')
    for (const q of list) {
      if (!Number.isInteger(q.monthly) || q.monthly < 0 || q.monthly > 100_000) throw new BadRequestException('Cota inválida (número inteiro, 0 ou mais).')
      await this.assertSeller(user, q.sellerId)
      const gift = await this.prisma.gift.findFirst({ where: { id: q.giftId, tenantId: user.tenantId }, select: { id: true } })
      if (!gift) throw new BadRequestException('Brinde não encontrado.')
    }
    await this.prisma.$transaction(
      list.map((q) =>
        q.monthly === 0
          ? this.prisma.giftQuota.deleteMany({ where: { sellerId: q.sellerId, giftId: q.giftId } })
          : this.prisma.giftQuota.upsert({ where: { sellerId_giftId: { sellerId: q.sellerId, giftId: q.giftId } }, create: { tenantId: user.tenantId, ...q }, update: { monthly: q.monthly } }),
      ),
    )
    await this.audit.byUser(user, ctx, 'brinde.cotas', 'gift_quota', undefined, { alteradas: list.length })
    return { ok: true }
  }

  /**
   * Meus brindes (Atendimento Comercial): o vendedor ligado ao usuário consulta o saldo do mês, o que usou e para
   * quem. Só leitura e só dele: não depende da permissão do Controle de brindes.
   */
  async mine(user: AuthUser, monthIn?: string) {
    const month = monthOf(monthIn)
    const seller = await this.prisma.seller.findFirst({ where: { tenantId: user.tenantId, userId: user.id }, select: { id: true, name: true } })
    if (!seller) return { month, seller: null, items: [], deliveries: [] }
    const { start, end } = monthRange(month)
    const [quotas, rows] = await Promise.all([
      this.prisma.giftQuota.findMany({ where: { sellerId: seller.id }, select: { giftId: true, monthly: true } }),
      this.prisma.giftDelivery.findMany({ where: { sellerId: seller.id, date: { gte: start, lt: end } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: { gift: { select: { name: true } } } }),
    ])
    const items = balances(quotas, rows.map((r) => ({ giftId: r.giftId, quantity: r.quantity })))
    const gifts = await this.prisma.gift.findMany({ where: { id: { in: items.map((i) => i.giftId) } }, select: { id: true, name: true, active: true } })
    const name = new Map(gifts.map((g) => [g.id, g]))
    return {
      month,
      seller: seller.name,
      items: items.filter((i) => i.quota > 0 || i.used > 0).map((i) => ({ ...i, name: name.get(i.giftId)?.name ?? 'Brinde', active: name.get(i.giftId)?.active ?? false })).sort((a, b) => a.name.localeCompare(b.name)),
      deliveries: rows.map((r) => ({ id: r.id, date: r.date.toISOString().slice(0, 10), gift: r.gift.name, customerCode: r.customerCode, customerName: r.customerName, quantity: r.quantity, notes: r.notes })),
    }
  }

  // ---------- Retiradas ----------

  async deliveries(user: AuthUser, monthIn?: string, sellerId?: string) {
    this.assertCan(user)
    const month = monthOf(monthIn)
    const { start, end } = monthRange(month)
    const rows = await this.prisma.giftDelivery.findMany({
      where: { tenantId: user.tenantId, date: { gte: start, lt: end }, seller: this.sellerWhere(user), ...(sellerId ? { sellerId } : {}) },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
      include: { gift: { select: { name: true } }, seller: { select: { name: true } } },
    })
    return {
      month,
      items: rows.map((r) => ({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        giftId: r.giftId,
        gift: r.gift.name,
        sellerId: r.sellerId,
        seller: r.seller.name,
        customerCode: r.customerCode,
        customerName: r.customerName,
        quantity: r.quantity,
        unitCost: n(r.unitCost),
        total: Math.round(r.quantity * n(r.unitCost) * 100) / 100,
        notes: r.notes,
        createdByName: r.createdByName,
        createdAt: r.createdAt,
      })),
    }
  }

  async deliver(user: AuthUser, d: DeliveryInput, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const seller = await this.assertSeller(user, d.sellerId)
    const code = d.customerCode?.trim()
    if (!code) throw new BadRequestException('Informe o código do cliente.')
    const quantity = d.quantity ?? 1
    const day = dayOf(d.date)
    const date = new Date(`${day}T00:00:00Z`)
    const { start, end } = monthRange(day.slice(0, 7))
    const created = await this.prisma.$transaction(async (tx) => {
      // Trava o brinde: duas retiradas ao mesmo tempo não passam do estoque nem da cota.
      await tx.$queryRaw`SELECT id FROM gifts WHERE id = ${d.giftId}::uuid FOR UPDATE`
      const gift = await tx.gift.findFirst({ where: { id: d.giftId, tenantId: user.tenantId } })
      if (!gift) throw new BadRequestException('Brinde não encontrado.')
      if (!gift.active) throw new BadRequestException(`${gift.name} está desativado.`)
      const [quota, used] = await Promise.all([
        tx.giftQuota.findUnique({ where: { sellerId_giftId: { sellerId: seller.id, giftId: gift.id } }, select: { monthly: true } }),
        tx.giftDelivery.aggregate({ where: { sellerId: seller.id, giftId: gift.id, date: { gte: start, lt: end } }, _sum: { quantity: true } }),
      ])
      const problem = deliveryProblem({ quantity, stock: gift.stock, quota: quota?.monthly ?? null, used: used._sum.quantity ?? 0, giftName: gift.name })
      if (problem) throw new BadRequestException(problem)
      await tx.gift.update({ where: { id: gift.id }, data: { stock: { decrement: quantity } } })
      return tx.giftDelivery.create({
        data: {
          tenantId: user.tenantId,
          giftId: gift.id,
          sellerId: seller.id,
          customerCode: code.slice(0, 40),
          customerName: d.customerName?.trim().slice(0, 160) || null,
          date,
          quantity,
          unitCost: gift.unitCost,
          notes: d.notes?.trim().slice(0, 500) || null,
          createdById: user.id,
          createdByName: user.name,
        },
      })
    })
    await this.audit.byUser(user, ctx, 'brinde.retirada', 'gift_delivery', created.id, { giftId: d.giftId, sellerId: seller.id, quantity, customerCode: code })
    return { id: created.id }
  }

  /** Desfaz uma retirada lançada errada: o brinde volta ao estoque e ao saldo do mês. */
  async removeDelivery(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const r = await this.prisma.giftDelivery.findFirst({ where: { id, tenantId: user.tenantId, seller: this.sellerWhere(user) } })
    if (!r) throw new NotFoundException('Retirada não encontrada.')
    await this.prisma.$transaction([this.prisma.giftDelivery.delete({ where: { id } }), this.prisma.gift.update({ where: { id: r.giftId }, data: { stock: { increment: r.quantity } } })])
    await this.audit.byUser(user, ctx, 'brinde.retirada_excluida', 'gift_delivery', id, { giftId: r.giftId, sellerId: r.sellerId, quantity: r.quantity, customerCode: r.customerCode })
    return { ok: true }
  }
}
