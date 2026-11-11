import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { balances, dayOf, deliveryProblem, mergeLines, type Holder, holderKey, monthOf, monthRange, monthsBetween, parseHolder, reportOf } from './brindes'

const MODULE = 'brindes'
const n = (d: Prisma.Decimal | number) => Number(d)
const NONE = '00000000-0000-0000-0000-000000000000'

export interface GiftInput {
  name?: string
  stock?: number
  unitCost?: number
  active?: boolean
  hasQuota?: boolean
}

export interface DeliveryInput {
  /** Um brinde (forma antiga) ou vários em items. */
  giftId?: string
  items?: { giftId: string; quantity: number }[]
  /** "s:<vendedor>" ou "u:<filial>". */
  holderId: string
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

  /** Filiais (unidades) que a pessoa vê: todas, a dela ou nenhuma (perfil que só vê o próprio). */
  private unitWhere(user: AuthUser): Prisma.UnitWhereInput {
    const s = this.scopeOf(user)
    if (s === 'OWN') return { tenantId: user.tenantId, id: NONE }
    if (s === 'UNIT') return { tenantId: user.tenantId, id: user.unitId ?? NONE }
    return { tenantId: user.tenantId }
  }

  /** Retiradas visíveis: de vendedores ou de filiais dentro do acesso. */
  private deliveryWhere(user: AuthUser): Prisma.GiftDeliveryWhereInput {
    return { tenantId: user.tenantId, OR: [{ seller: this.sellerWhere(user) }, { unit: this.unitWhere(user) }] }
  }

  private async assertHolder(user: AuthUser, holderId: string) {
    const h = parseHolder(holderId)
    if (!h) throw new BadRequestException('Escolha o vendedor ou a filial.')
    const found =
      h.kind === 'seller'
        ? await this.prisma.seller.findFirst({ where: { ...this.sellerWhere(user), id: h.id }, select: { id: true, name: true } })
        : await this.prisma.unit.findFirst({ where: { ...this.unitWhere(user), id: h.id }, select: { id: true, name: true } })
    if (!found) throw new ForbiddenException(h.kind === 'seller' ? 'Vendedor fora do seu acesso.' : 'Filial fora do seu acesso.')
    return { ...h, name: found.name, where: holderWhere(h) }
  }

  // ---------- Cadastro ----------

  async gifts(user: AuthUser) {
    this.assertCan(user)
    const rows = await this.prisma.gift.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { _count: { select: { deliveries: true } } } })
    return rows.map((g) => ({ id: g.id, name: g.name, stock: g.stock, unitCost: n(g.unitCost), active: g.active, hasQuota: g.hasQuota, stockValue: Math.round(g.stock * n(g.unitCost) * 100) / 100, deliveries: g._count.deliveries }))
  }

  async saveGift(user: AuthUser, id: string | null, d: GiftInput, ctx: RequestCtx) {
    this.assertCan(user, id ? 'edit' : 'create')
    const name = d.name?.trim()
    if (!id && !name) throw new BadRequestException('Informe o nome do brinde.')
    if (d.stock !== undefined && (!Number.isInteger(d.stock) || d.stock < 0)) throw new BadRequestException('Estoque inválido.')
    if (d.unitCost !== undefined && !(d.unitCost >= 0)) throw new BadRequestException('Valor unitário inválido.')
    const dup = name ? await this.prisma.gift.findFirst({ where: { tenantId: user.tenantId, name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } }) : null
    if (dup) throw new BadRequestException('Já existe um brinde com esse nome.')
    const data = { ...(name ? { name: name.slice(0, 80) } : {}), ...(d.stock !== undefined ? { stock: d.stock } : {}), ...(d.unitCost !== undefined ? { unitCost: Math.round(d.unitCost * 100) / 100 } : {}), ...(d.active !== undefined ? { active: d.active } : {}), ...(d.hasQuota !== undefined ? { hasQuota: d.hasQuota } : {}) }
    let gift
    if (id) {
      const cur = await this.prisma.gift.findFirst({ where: { id, tenantId: user.tenantId } })
      if (!cur) throw new NotFoundException('Brinde não encontrado.')
      gift = await this.prisma.gift.update({ where: { id }, data })
      await this.audit.byUser(user, ctx, 'brinde.updated', 'gift', id, { de: { stock: cur.stock, unitCost: n(cur.unitCost), active: cur.active }, para: data })
    } else {
      gift = await this.prisma.gift.create({ data: { tenantId: user.tenantId, name: name!.slice(0, 80), stock: d.stock ?? 0, unitCost: Math.round((d.unitCost ?? 0) * 100) / 100, active: d.active ?? true, hasQuota: d.hasQuota ?? true } })
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
    const [sellers, units] = await Promise.all([
      this.prisma.seller.findMany({ where: { ...this.sellerWhere(user), active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.unit.findMany({ where: { ...this.unitWhere(user), active: true }, orderBy: [{ isHeadquarters: 'desc' }, { name: 'asc' }], select: { id: true, name: true } }),
    ])
    const sellerIds = sellers.map((s) => s.id)
    const unitIds = units.map((u) => u.id)
    const of = { OR: [{ sellerId: { in: sellerIds } }, { unitId: { in: unitIds } }] }
    const [gifts, quotas, used] = await Promise.all([
      this.prisma.gift.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, stock: true, unitCost: true, active: true, hasQuota: true } }),
      this.prisma.giftQuota.findMany({ where: { tenantId: user.tenantId, ...of }, select: { sellerId: true, unitId: true, giftId: true, monthly: true } }),
      this.prisma.giftDelivery.groupBy({ by: ['sellerId', 'unitId', 'giftId'], where: { tenantId: user.tenantId, ...of, date: { gte: start, lt: end } }, _sum: { quantity: true } }),
    ])
    const cost = new Map(gifts.map((g) => [g.id, n(g.unitCost)]))
    const holders = [...sellers.map((s) => ({ id: `s:${s.id}`, kind: 'seller' as const, name: s.name })), ...units.map((u) => ({ id: `u:${u.id}`, kind: 'unit' as const, name: u.name }))]
    return {
      month,
      gifts: gifts.map((g) => ({ id: g.id, name: g.name, stock: g.stock, unitCost: n(g.unitCost), active: g.active, hasQuota: g.hasQuota })),
      holders: holders.map((h) => {
        const items = balances(
          quotas.filter((q) => holderKey(q) === h.id),
          used.filter((u) => holderKey(u) === h.id).map((u) => ({ giftId: u.giftId, quantity: u._sum.quantity ?? 0 })),
        )
        return { ...h, items, value: Math.round(items.reduce((t, i) => t + i.used * (cost.get(i.giftId) ?? 0), 0) * 100) / 100 }
      }),
    }
  }

  async saveQuotas(user: AuthUser, list: { holderId: string; giftId: string; monthly: number }[], ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    if (this.scopeOf(user) === 'OWN') throw new ForbiddenException('Seu perfil não define cotas.')
    const checked: { where: ReturnType<typeof holderWhere>; giftId: string; monthly: number }[] = []
    for (const q of list) {
      if (!Number.isInteger(q.monthly) || q.monthly < 0 || q.monthly > 100_000) throw new BadRequestException('Cota inválida (número inteiro, 0 ou mais).')
      const h = await this.assertHolder(user, q.holderId)
      const gift = await this.prisma.gift.findFirst({ where: { id: q.giftId, tenantId: user.tenantId }, select: { id: true } })
      if (!gift) throw new BadRequestException('Brinde não encontrado.')
      checked.push({ where: h.where, giftId: q.giftId, monthly: q.monthly })
    }
    await this.prisma.$transaction(async (tx) => {
      for (const q of checked) {
        const cur = await tx.giftQuota.findFirst({ where: { ...q.where, giftId: q.giftId }, select: { id: true } })
        if (q.monthly === 0) {
          if (cur) await tx.giftQuota.delete({ where: { id: cur.id } })
        } else if (cur) await tx.giftQuota.update({ where: { id: cur.id }, data: { monthly: q.monthly } })
        else await tx.giftQuota.create({ data: { tenantId: user.tenantId, ...q.where, giftId: q.giftId, monthly: q.monthly } })
      }
    })
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

  async deliveries(user: AuthUser, monthIn?: string, holderIn?: string) {
    this.assertCan(user)
    const month = monthOf(monthIn)
    const { start, end } = monthRange(month)
    const h = parseHolder(holderIn)
    const rows = await this.prisma.giftDelivery.findMany({
      where: { ...this.deliveryWhere(user), date: { gte: start, lt: end }, ...(h ? holderWhere(h) : {}) },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
      include: { gift: { select: { name: true } }, seller: { select: { name: true } }, unit: { select: { name: true } } },
    })
    return {
      month,
      items: rows.map((r) => ({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        giftId: r.giftId,
        gift: r.gift.name,
        holderId: holderKey(r),
        holder: r.unit?.name ?? r.seller?.name ?? '—',
        holderKind: r.unitId ? 'unit' : 'seller',
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

  /**
   * Retirada de um ou vários brindes para o mesmo cliente, numa vez só: tudo ou nada (se um brinde não tiver saldo ou
   * estoque, nenhum é lançado). Cada brinde vira uma linha de retirada.
   */
  async deliver(user: AuthUser, d: DeliveryInput, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const holder = await this.assertHolder(user, d.holderId)
    const code = d.customerCode?.trim()
    if (!code) throw new BadRequestException('Informe o código do cliente.')
    const lines = mergeLines(d.items?.length ? d.items : d.giftId ? [{ giftId: d.giftId, quantity: d.quantity ?? 1 }] : [])
    if (!lines.length) throw new BadRequestException('Escolha ao menos um brinde.')
    const day = dayOf(d.date)
    const date = new Date(`${day}T00:00:00Z`)
    const { start, end } = monthRange(day.slice(0, 7))
    const who = holder.kind === 'unit' ? `A filial ${holder.name}` : holder.name
    const created = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = []
      // Trava os brindes (sempre na mesma ordem): duas retiradas ao mesmo tempo não passam do estoque nem da cota.
      for (const line of [...lines].sort((a, b) => a.giftId.localeCompare(b.giftId))) await tx.$queryRaw`SELECT id FROM gifts WHERE id = ${line.giftId}::uuid FOR UPDATE`
      for (const line of lines) {
        const gift = await tx.gift.findFirst({ where: { id: line.giftId, tenantId: user.tenantId } })
        if (!gift) throw new BadRequestException('Brinde não encontrado.')
        if (!gift.active) throw new BadRequestException(`${gift.name} está desativado.`)
        const [quota, used] = await Promise.all([
          tx.giftQuota.findFirst({ where: { ...holder.where, giftId: gift.id }, select: { monthly: true } }),
          tx.giftDelivery.aggregate({ where: { ...holder.where, giftId: gift.id, date: { gte: start, lt: end } }, _sum: { quantity: true } }),
        ])
        const problem = deliveryProblem({ quantity: line.quantity, stock: gift.stock, quota: quota?.monthly ?? null, used: used._sum.quantity ?? 0, giftName: gift.name, hasQuota: gift.hasQuota, who })
        if (problem) throw new BadRequestException(problem)
        await tx.gift.update({ where: { id: gift.id }, data: { stock: { decrement: line.quantity } } })
        const row = await tx.giftDelivery.create({
          data: {
            tenantId: user.tenantId,
            giftId: gift.id,
            ...holder.where,
            customerCode: code.slice(0, 40),
            customerName: d.customerName?.trim().slice(0, 160) || null,
            date,
            quantity: line.quantity,
            unitCost: gift.unitCost,
            notes: d.notes?.trim().slice(0, 500) || null,
            createdById: user.id,
            createdByName: user.name,
          },
        })
        ids.push(row.id)
      }
      return ids
    })
    await this.audit.byUser(user, ctx, 'brinde.retirada', 'gift_delivery', created[0], { holder: d.holderId, customerCode: code, itens: lines })
    return { id: created[0], ids: created }
  }

  /** Desfaz uma retirada lançada errada: o brinde volta ao estoque e ao saldo do mês. */
  async removeDelivery(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const r = await this.prisma.giftDelivery.findFirst({ where: { ...this.deliveryWhere(user), id } })
    if (!r) throw new NotFoundException('Retirada não encontrada.')
    await this.prisma.$transaction([this.prisma.giftDelivery.delete({ where: { id } }), this.prisma.gift.update({ where: { id: r.giftId }, data: { stock: { increment: r.quantity } } })])
    await this.audit.byUser(user, ctx, 'brinde.retirada_excluida', 'gift_delivery', id, { giftId: r.giftId, holder: holderKey(r), quantity: r.quantity, customerCode: r.customerCode })
    return { ok: true }
  }

  // ---------- Resumo (dashboard) ----------

  /** Brindes entregues de um mês a outro: total, por brinde, por vendedor/filial e por mês. */
  async report(user: AuthUser, fromIn?: string, toIn?: string) {
    this.assertCan(user)
    const to = monthOf(toIn)
    const months = monthsBetween(monthOf(fromIn ?? to), to)
    const start = monthRange(months[0]!).start
    const end = monthRange(months[months.length - 1]!).end
    const rows = await this.prisma.giftDelivery.findMany({
      where: { ...this.deliveryWhere(user), date: { gte: start, lt: end } },
      take: 50_000,
      select: { date: true, giftId: true, sellerId: true, unitId: true, customerCode: true, quantity: true, unitCost: true, gift: { select: { name: true } }, seller: { select: { name: true } }, unit: { select: { name: true } } },
    })
    const report = reportOf(
      rows.map((r) => ({
        month: r.date.toISOString().slice(0, 7),
        giftId: r.giftId,
        gift: r.gift.name,
        holder: holderKey(r),
        holderName: r.unit?.name ?? r.seller?.name ?? '—',
        holderKind: r.unitId ? ('unit' as const) : ('seller' as const),
        customerCode: r.customerCode,
        quantity: r.quantity,
        value: r.quantity * n(r.unitCost),
      })),
      months,
    )
    // Compras do período (custos e despesas): comparar o comprado com o distribuído.
    const buys = await this.prisma.giftPurchase.findMany({ where: { tenantId: user.tenantId, date: { gte: start, lt: end } }, select: { date: true, quantity: true, total: true } })
    const purchasedByMonth = new Map(months.map((m) => [m, { quantity: 0, value: 0 }]))
    let purchasedQty = 0
    let purchasedValue = 0
    for (const b of buys) {
      const m = purchasedByMonth.get(b.date.toISOString().slice(0, 7))
      purchasedQty += b.quantity
      purchasedValue += n(b.total)
      if (m) {
        m.quantity += b.quantity
        m.value += n(b.total)
      }
    }
    const round = (x: number) => Math.round(x * 100) / 100
    return {
      from: months[0],
      to: months[months.length - 1],
      ...report,
      byMonth: report.byMonth.map((x) => ({ ...x, purchasedQuantity: purchasedByMonth.get(x.month)?.quantity ?? 0, purchasedValue: round(purchasedByMonth.get(x.month)?.value ?? 0) })),
      purchased: { quantity: purchasedQty, value: round(purchasedValue) },
    }
  }

  // ---------- Compras (custos e despesas) ----------

  async purchases(user: AuthUser, fromIn?: string, toIn?: string) {
    this.assertCan(user)
    const to = monthOf(toIn)
    const months = monthsBetween(monthOf(fromIn ?? to), to)
    const start = monthRange(months[0]!).start
    const end = monthRange(months[months.length - 1]!).end
    const rows = await this.prisma.giftPurchase.findMany({ where: { tenantId: user.tenantId, date: { gte: start, lt: end } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 2000, include: { gift: { select: { name: true } } } })
    return rows.map((r) => ({ id: r.id, date: r.date.toISOString().slice(0, 10), giftId: r.giftId, gift: r.gift.name, document: r.document, supplier: r.supplier, quantity: r.quantity, unitCost: n(r.unitCost), total: n(r.total), addedToStock: r.addedToStock, notes: r.notes, createdByName: r.createdByName }))
  }

  async addPurchase(user: AuthUser, d: { giftId: string; date: string; document?: string | null; supplier?: string | null; quantity: number; unitCost?: number | null; total?: number | null; addToStock?: boolean; updateCost?: boolean; notes?: string | null }, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const gift = await this.prisma.gift.findFirst({ where: { id: d.giftId, tenantId: user.tenantId } })
    if (!gift) throw new BadRequestException('Brinde não encontrado.')
    if (!Number.isInteger(d.quantity) || d.quantity < 1) throw new BadRequestException('Informe a quantidade.')
    // Informe o valor unitário ou o total da compra; o outro é calculado.
    const total = d.total != null && d.total > 0 ? Math.round(d.total * 100) / 100 : d.unitCost != null && d.unitCost >= 0 ? Math.round(d.unitCost * d.quantity * 100) / 100 : null
    if (total === null) throw new BadRequestException('Informe o valor unitário ou o total da compra.')
    const unitCost = Math.round((total / d.quantity) * 100) / 100
    const addToStock = d.addToStock !== false
    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.giftPurchase.create({
        data: { tenantId: user.tenantId, giftId: gift.id, date: new Date(`${d.date}T00:00:00Z`), document: d.document?.trim().slice(0, 60) || null, supplier: d.supplier?.trim().slice(0, 120) || null, quantity: d.quantity, unitCost, total, addedToStock: addToStock, notes: d.notes?.trim().slice(0, 500) || null, createdById: user.id, createdByName: user.name.slice(0, 120) },
      })
      await tx.gift.update({ where: { id: gift.id }, data: { ...(addToStock ? { stock: { increment: d.quantity } } : {}), ...(d.updateCost !== false ? { unitCost } : {}) } })
      return p
    })
    await this.audit.byUser(user, ctx, 'brinde.compra', 'gift_purchase', created.id, { brinde: gift.name, documento: created.document, quantidade: d.quantity, total, estoque: addToStock })
    return { id: created.id }
  }

  async removePurchase(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const p = await this.prisma.giftPurchase.findFirst({ where: { id, tenantId: user.tenantId }, include: { gift: { select: { name: true, stock: true } } } })
    if (!p) throw new BadRequestException('Compra não encontrada.')
    if (p.addedToStock && p.gift.stock < p.quantity) throw new BadRequestException(`O estoque de ${p.gift.name} (${p.gift.stock}) é menor que a quantidade da compra (${p.quantity}): parte já foi distribuída.`)
    await this.prisma.$transaction([this.prisma.giftPurchase.delete({ where: { id } }), ...(p.addedToStock ? [this.prisma.gift.update({ where: { id: p.giftId }, data: { stock: { decrement: p.quantity } } })] : [])])
    await this.audit.byUser(user, ctx, 'brinde.compra_excluida', 'gift_purchase', id, { brinde: p.gift.name, documento: p.document, quantidade: p.quantity, total: n(p.total) })
    return { ok: true }
  }
}

function holderWhere(h: Holder): { sellerId: string } | { unitId: string } {
  return h.kind === 'unit' ? { unitId: h.id } : { sellerId: h.id }
}
