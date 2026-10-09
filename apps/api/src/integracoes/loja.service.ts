import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { LeadsService } from '../leads/leads.service'
import { PrismaService } from '../prisma/prisma.service'
import { type CartItem, cartMessage } from './magazord'
import { MagazordService } from './magazord.service'

export type CartView = 'abandonados' | 'checkout' | 'recuperados' | 'todos'
export const CONTACT_STATUSES = ['PENDENTE', 'CONTATADO', 'RECUPERADO', 'PERDIDO'] as const
export type ContactStatus = (typeof CONTACT_STATUSES)[number]

export interface CartFilters {
  view: CartView
  search?: string
  contactStatus?: ContactStatus
  from?: string
  to?: string
}

/** Carrinhos e pedidos da loja virtual para a equipe agir (recuperar vendas, campanhas). */
@Injectable()
export class LojaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly magazord: MagazordService,
    private readonly audit: AuditService,
  ) {}

  /** Carrinhos e checkout têm permissão própria (antes seguiam a da base de leads). */
  private assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'carrinhos', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  private async where(user: AuthUser, f: CartFilters): Promise<Prisma.EcommerceCartWhereInput> {
    const s = await this.magazord.config(user.tenantId)
    const limit = new Date(Date.now() - s.abandonHours * 3_600_000)
    const and: Prisma.EcommerceCartWhereInput[] = [{ tenantId: user.tenantId, itemCount: { gt: 0 } }]
    // Escopo do perfil na base de leads vale também aqui (vendedor só vê carrinhos dos próprios leads).
    if (this.leads.scopeOf(user) !== 'ALL') and.push({ lead: this.leads.scope(user) })
    if (f.view === 'abandonados') and.push({ OR: [{ status: 2 }, { status: 1, lastActivityAt: { lt: limit } }] })
    if (f.view === 'checkout') and.push({ checkoutStarted: true, status: { not: 3 } })
    if (f.view === 'recuperados') and.push({ status: 3, contactStatus: 'RECUPERADO' })
    if (f.contactStatus) and.push({ contactStatus: f.contactStatus })
    if (f.from || f.to) {
      and.push({
        lastActivityAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00-03:00`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999-03:00`) } : {}) },
      })
    }
    const q = f.search?.trim()
    // Nome ou e-mail do cliente, ou o código exato de um produto do carrinho (atalho do Catálogo).
    if (q) and.push({ OR: [{ customerName: { contains: q, mode: 'insensitive' } }, { customerEmail: { contains: q, mode: 'insensitive' } }, { items: { array_contains: [{ code: q }] } }] })
    return { AND: and }
  }

  async list(user: AuthUser, f: CartFilters, page: number, pageSize: number) {
    this.assertCan(user, 'view')
    const where = await this.where(user, f)
    const s = await this.magazord.config(user.tenantId)
    const [total, rows, counts] = await Promise.all([
      this.prisma.ecommerceCart.count({ where }),
      this.prisma.ecommerceCart.findMany({ where, orderBy: { lastActivityAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      Promise.all((['abandonados', 'checkout', 'recuperados'] as const).map(async (v) => [v, await this.prisma.ecommerceCart.count({ where: await this.where(user, { view: v }) })] as const)),
    ])
    return {
      total,
      page,
      pageSize,
      counts: Object.fromEntries(counts),
      configured: !!s.enabled,
      items: rows.map((c) => this.view(c, s.cartMessage, s.coupon)),
    }
  }

  private view(c: Prisma.EcommerceCartGetPayload<object>, template: string, coupon: string) {
    const { tenantId: _t, value, items, ...rest } = c
    const list = (items as unknown as CartItem[]) ?? []
    return {
      ...rest,
      value: value === null ? null : Number(value),
      items: list,
      // Mensagem pronta para o WhatsApp, com nome, produtos, link do carrinho e cupom.
      message: cartMessage(template, { name: c.customerName, items: list, link: c.checkoutUrl, coupon: coupon || '' }),
    }
  }

  async updateContact(user: AuthUser, id: string, status: ContactStatus, note: string | null, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const cart = await this.prisma.ecommerceCart.findFirst({ where: { id, ...(await this.where(user, { view: 'todos' })) } })
    if (!cart) throw new NotFoundException('Carrinho não encontrado.')
    if (status !== cart.contactStatus && status !== 'PENDENTE' && !note?.trim() && status !== 'RECUPERADO') throw new BadRequestException('Escreva uma observação sobre o contato.')
    const updated = await this.prisma.ecommerceCart.update({
      where: { id },
      data: { contactStatus: status, contactNote: note?.trim() || cart.contactNote, contactedAt: status === 'PENDENTE' ? cart.contactedAt : (cart.contactedAt ?? new Date()), contactedBy: user.name },
    })
    if (cart.leadId && status === 'CONTATADO' && cart.contactStatus !== 'CONTATADO') {
      await this.prisma.leadEvent.create({
        data: { tenantId: user.tenantId, leadId: cart.leadId, type: 'contato_carrinho', title: `Contato para recuperar o carrinho${note?.trim() ? `: ${note.trim().slice(0, 200)}` : ''}`, userId: user.id, userName: user.name },
      })
    }
    await this.audit.byUser(user, ctx, 'ecommerce.cart_contact_updated', 'ecommerce_cart', id, { situacao: status })
    const s = await this.magazord.config(user.tenantId)
    return this.view(updated, s.cartMessage, s.coupon)
  }

  async exportRows(user: AuthUser, f: CartFilters) {
    this.assertCan(user, 'export')
    const where = await this.where(user, f)
    if ((await this.prisma.ecommerceCart.count({ where })) > 20_000) throw new BadRequestException('Muitos carrinhos para exportar de uma vez. Use os filtros.')
    return this.prisma.ecommerceCart.findMany({ where, orderBy: { lastActivityAt: 'desc' } })
  }

  /** Aba "Loja virtual" da ficha do lead. A permissão sobre o lead é checada por quem chama. */
  async forLead(leadId: string) {
    const [orders, carts] = await Promise.all([
      this.prisma.ecommerceOrder.findMany({ where: { leadId }, orderBy: { orderedAt: 'desc' }, take: 100 }),
      this.prisma.ecommerceCart.findMany({ where: { leadId, itemCount: { gt: 0 } }, orderBy: { lastActivityAt: 'desc' }, take: 30 }),
    ])
    const paid = orders.filter((o) => o.statusGroup === 'pago')
    return {
      orders: orders.map(({ tenantId: _t, ...o }) => ({ ...o, total: Number(o.total) })),
      carts: carts.map(({ tenantId: _t, ...c }) => ({ ...c, value: c.value === null ? null : Number(c.value) })),
      totalSpent: paid.reduce((s, o) => s + Number(o.total), 0),
      paidOrders: paid.length,
    }
  }
}
