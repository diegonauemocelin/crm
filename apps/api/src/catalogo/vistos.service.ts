import { Injectable } from '@nestjs/common'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { panelPeriod } from '../googleads/painel'
import { LeadsService } from '../leads/leads.service'
import { PrismaService } from '../prisma/prisma.service'
import { CatalogoService } from './catalogo.service'
import { groupByPage, itemMatches, type LeadCart, type LeadPurchase, type ProductPage, productStatus, rankOpportunities } from './vistos'

const DAY = 86_400_000
type Agg = { path: string; views: bigint; visitors: bigint; leads: bigint; last: Date }

/** Produtos vistos na loja virtual: mais vistos, vistos sem compra (oportunidades) e os vistos por cada lead. */
@Injectable()
export class ProdutosVistosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogoService,
    private readonly leads: LeadsService,
  ) {}

  private async pages(tenantId: string, paths: string[]) {
    if (!paths.length) return new Map<string, ProductPage>()
    const rows = await this.prisma.storeProduct.findMany({
      where: { tenantId, path: { in: paths } },
      select: { id: true, code: true, externalId: true, name: true, brand: true, price: true, stock: true, image: true, url: true, path: true, active: true },
    })
    return groupByPage(rows.map((r) => ({ ...r, path: r.path!, price: r.price === null ? null : Number(r.price) })))
  }

  private carts(tenantId: string, where: { leadIds?: string[]; since?: Date }) {
    return this.prisma.ecommerceCart.findMany({
      where: { tenantId, ...(where.leadIds ? { leadId: { in: where.leadIds } } : {}), ...(where.since ? { OR: [{ lastActivityAt: { gte: where.since } }, { createdAt: { gte: where.since } }] } : {}) },
      select: { leadId: true, status: true, items: true, lastActivityAt: true, createdAt: true },
    })
  }

  private async purchases(leadIds: string[], since: Date): Promise<LeadPurchase[]> {
    if (!leadIds.length) return []
    const rows = await this.prisma.siteEvent.findMany({
      where: { name: 'purchase', occurredAt: { gte: since }, visitor: { leadId: { in: leadIds } } },
      select: { occurredAt: true, items: true, visitor: { select: { leadId: true } } },
    })
    return rows.map((r) => ({ leadId: r.visitor.leadId!, at: r.occurredAt, items: (Array.isArray(r.items) ? r.items : []) as { id?: string }[] }))
  }

  async dashboard(user: AuthUser, q: { from?: string; to?: string; min?: number }) {
    this.catalog.assertCan(user, 'view')
    const { from, to } = panelPeriod(q.from, q.to)
    const start = new Date(`${from}T00:00:00-03:00`)
    const end = new Date(Date.parse(`${to}T00:00:00-03:00`) + DAY)
    const min = Math.max(1, Math.min(10, q.min ?? 2))
    const T = user.tenantId
    const seeLeads = can(user.permissions, user.role.isSystem, 'leads', 'view')
    const catalogPaths = `SELECT path FROM store_products WHERE "tenantId" = $1::uuid AND path IS NOT NULL`

    const [top, totals, byLead, mapped] = await Promise.all([
      this.prisma.$queryRawUnsafe<Agg[]>(
        `SELECT pv.path, count(*) AS views, count(DISTINCT pv."visitorId") AS visitors, count(DISTINCT v."leadId") AS leads, max(pv."occurredAt") AS last
         FROM site_pageviews pv JOIN site_visitors v ON v.id = pv."visitorId"
         WHERE pv."tenantId" = $1::uuid AND pv."occurredAt" >= $2 AND pv."occurredAt" < $3 AND pv.path IN (${catalogPaths})
         GROUP BY pv.path ORDER BY views DESC, last DESC LIMIT 100`,
        T, start, end,
      ),
      this.prisma.$queryRawUnsafe<{ views: bigint; visitors: bigint; leads: bigint; products: bigint }[]>(
        `SELECT count(*) AS views, count(DISTINCT pv."visitorId") AS visitors, count(DISTINCT v."leadId") AS leads, count(DISTINCT pv.path) AS products
         FROM site_pageviews pv JOIN site_visitors v ON v.id = pv."visitorId"
         WHERE pv."tenantId" = $1::uuid AND pv."occurredAt" >= $2 AND pv."occurredAt" < $3 AND pv.path IN (${catalogPaths})`,
        T, start, end,
      ),
      seeLeads
        ? this.prisma.$queryRawUnsafe<{ leadId: string; path: string; views: bigint; first: Date; last: Date }[]>(
            `SELECT v."leadId", pv.path, count(*) AS views, min(pv."occurredAt") AS first, max(pv."occurredAt") AS last
             FROM site_pageviews pv JOIN site_visitors v ON v.id = pv."visitorId"
             WHERE pv."tenantId" = $1::uuid AND pv."occurredAt" >= $2 AND pv."occurredAt" < $3 AND v."leadId" IS NOT NULL AND pv.path IN (${catalogPaths})
             GROUP BY v."leadId", pv.path HAVING count(*) >= $4 ORDER BY last DESC LIMIT 3000`,
            T, start, end, min,
          )
        : Promise.resolve([]),
      this.prisma.storeProduct.count({ where: { tenantId: T, path: { not: null } } }),
    ])

    const pages = await this.pages(T, [...new Set([...top.map((t) => t.path), ...byLead.map((b) => b.path)])])
    const carts = await this.carts(T, { since: new Date(start.getTime() - DAY) })
    const items = (c: { items: unknown }) => (Array.isArray(c.items) ? c.items : []) as { code?: string; url?: string | null }[]
    const products = top
      .filter((t) => pages.has(t.path))
      .map((t) => {
        const page = pages.get(t.path)!
        const withIt = carts.filter((c) => items(c).some((i) => itemMatches(i.code, page.codes)))
        const visitors = Number(t.visitors)
        const bought = withIt.filter((c) => c.status === 3).length
        return { ...page, views: Number(t.views), visitors, leads: Number(t.leads), lastAt: t.last, carts: withIt.length, bought, cartRate: visitors ? Math.min(1, withIt.length / visitors) : null }
      })

    // Oportunidades: leads (que o usuário pode ver) que viram o produto e não compraram.
    let opportunities: { leadId: string; name: string | null; phone: string | null; email: string | null; path: string; product: string; image: string | null; url: string | null; price: number | null; stock: number | null; views: number; lastAt: Date; status: 'viu' | 'carrinho' }[] = []
    if (byLead.length) {
      const ids = [...new Set(byLead.map((b) => b.leadId))]
      const allowed = new Map(
        (await this.prisma.lead.findMany({ where: { AND: [{ id: { in: ids }, deletedAt: null, anonymizedAt: null }, this.leads.where(user, {})] }, select: { id: true, name: true, phone: true, email: true } })).map((l) => [l.id, l]),
      )
      const okIds = [...allowed.keys()]
      const leadCarts: LeadCart[] = (await this.carts(T, { leadIds: okIds, since: new Date(start.getTime() - DAY) })).map((c) => ({ leadId: c.leadId!, status: c.status, at: c.lastActivityAt ?? c.createdAt, items: items(c) }))
      const bought = await this.purchases(okIds, new Date(start.getTime() - DAY))
      const list = byLead.flatMap((b) => {
        const lead = allowed.get(b.leadId)
        const page = pages.get(b.path)
        if (!lead || !page) return []
        const status = productStatus({ leadId: b.leadId, path: b.path, views: Number(b.views), firstAt: b.first, lastAt: b.last }, page, leadCarts, bought)
        if (status === 'comprou') return []
        return [{ leadId: lead.id, name: lead.name, phone: lead.phone, email: lead.email, path: b.path, product: page.name, image: page.image, url: page.url, price: page.price, stock: page.stock, views: Number(b.views), lastAt: b.last, status }]
      })
      opportunities = rankOpportunities(list).slice(0, 300)
    }

    const tt = totals[0]
    return {
      from,
      to,
      min,
      catalogPages: mapped,
      totals: { views: Number(tt?.views ?? 0), visitors: Number(tt?.visitors ?? 0), leads: Number(tt?.leads ?? 0), products: Number(tt?.products ?? 0) },
      products,
      outOfStock: products.filter((p) => p.active && p.stock !== null && p.stock <= 0).slice(0, 20),
      opportunities,
      canSeeLeads: seeLeads,
    }
  }

  /** Produtos que um lead viu no site (aba "Site" da ficha), com a situação: comprou, no carrinho ou só viu. */
  async forLead(user: AuthUser, leadId: string) {
    this.leads.assertCan(user, 'view')
    await this.leads.load(user, leadId)
    const T = user.tenantId
    const views = await this.prisma.$queryRaw<{ path: string; views: bigint; first: Date; last: Date }[]>`
      SELECT pv.path, count(*) AS views, min(pv."occurredAt") AS first, max(pv."occurredAt") AS last
      FROM site_pageviews pv JOIN site_visitors v ON v.id = pv."visitorId"
      WHERE v."leadId" = ${leadId}::uuid AND pv."tenantId" = ${T}::uuid
        AND pv.path IN (SELECT path FROM store_products WHERE "tenantId" = ${T}::uuid AND path IS NOT NULL)
      GROUP BY pv.path ORDER BY last DESC LIMIT 50`
    if (!views.length) return { items: [] }
    const pages = await this.pages(T, views.map((v) => v.path))
    const carts: LeadCart[] = (await this.carts(T, { leadIds: [leadId] })).map((c) => ({ leadId, status: c.status, at: c.lastActivityAt ?? c.createdAt, items: (Array.isArray(c.items) ? c.items : []) as { code?: string }[] }))
    const bought = await this.purchases([leadId], new Date(0))
    return {
      items: views.flatMap((v) => {
        const page = pages.get(v.path)
        if (!page) return []
        const status = productStatus({ leadId, path: v.path, views: Number(v.views), firstAt: v.first, lastAt: v.last }, page, carts, bought)
        return [{ path: v.path, name: page.name, image: page.image, url: page.url, price: page.price, stock: page.stock, active: page.active, views: Number(v.views), firstAt: v.first, lastAt: v.last, status }]
      }),
    }
  }
}
