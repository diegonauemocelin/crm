import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { Prisma } from '../generated/prisma/client'
import { MagazordService } from '../integracoes/magazord.service'
import { PrismaService } from '../prisma/prisma.service'

/** Interesse dos clientes: carrinhos dos últimos N dias que tiveram o produto. */
export const INTEREST_DAYS = 90

export const SORTS = ['nome', 'preco_menor', 'preco_maior', 'estoque', 'interesse', 'abandonados', 'desconto'] as const
export type Sort = (typeof SORTS)[number]

export interface CatalogFilters {
  search?: string
  brand?: string
  stock?: 'com' | 'sem'
  status?: 'ativos' | 'inativos' | 'todos'
  promo?: 'true'
  sort?: Sort
}

interface Row {
  id: string
  code: string
  externalId: string
  name: string
  brand: string | null
  price: string | null
  priceFrom: string | null
  stock: number | null
  image: string | null
  url: string | null
  active: boolean
  syncedAt: Date
  carts: number
  abandoned: number
  bought: number
}

const ORDER: Record<Sort, string> = {
  nome: 'p.name ASC',
  preco_menor: 'p.price ASC NULLS LAST, p.name ASC',
  preco_maior: 'p.price DESC NULLS LAST, p.name ASC',
  estoque: 'p.stock DESC NULLS LAST, p.name ASC',
  interesse: 'carts DESC, abandoned DESC, p.name ASC',
  abandonados: 'abandoned DESC, carts DESC, p.name ASC',
  desconto: '(1 - p.price / NULLIF(p."priceFrom", 0)) DESC NULLS LAST, p.name ASC',
}

/** Catálogo de produtos da loja (cópia da Magazord), com o interesse dos clientes vindo dos carrinhos. */
@Injectable()
export class CatalogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly magazord: MagazordService,
    private readonly audit: AuditService,
  ) {}

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'catalogo', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  private where(tenantId: string, f: CatalogFilters) {
    const parts: Prisma.Sql[] = [Prisma.sql`p."tenantId" = ${tenantId}::uuid`]
    const status = f.status ?? 'ativos'
    if (status !== 'todos') parts.push(Prisma.sql`p.active = ${status === 'ativos'}`)
    const term = f.search?.trim()
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      parts.push(Prisma.sql`(p.name ILIKE ${like} OR p.code ILIKE ${like} OR p.brand ILIKE ${like})`)
    }
    if (f.brand) parts.push(f.brand === 'none' ? Prisma.sql`p.brand IS NULL` : Prisma.sql`p.brand = ${f.brand}`)
    if (f.stock === 'com') parts.push(Prisma.sql`p.stock > 0`)
    if (f.stock === 'sem') parts.push(Prisma.sql`(p.stock IS NOT NULL AND p.stock <= 0)`)
    if (f.promo === 'true') parts.push(Prisma.sql`p."priceFrom" > p.price`)
    return Prisma.join(parts, ' AND ')
  }

  /** Produtos com o interesse dos clientes (carrinhos com o produto, abandonados e comprados). */
  private rows(tenantId: string, f: CatalogFilters, limit: number, offset: number) {
    const since = new Date(Date.now() - INTEREST_DAYS * 86_400_000)
    return this.prisma.$queryRaw<Row[]>`
      WITH interest AS (
        SELECT it->>'code' AS code,
          count(DISTINCT c.id)::int AS carts,
          (count(DISTINCT c.id) FILTER (WHERE c.status = 2))::int AS abandoned,
          (count(DISTINCT c.id) FILTER (WHERE c.status = 3))::int AS bought
        FROM ecommerce_carts c
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.items) = 'array' THEN c.items ELSE '[]'::jsonb END) it
        WHERE c."tenantId" = ${tenantId}::uuid AND coalesce(c."startedAt", c."createdAt") >= ${since}
        GROUP BY 1
      )
      SELECT p.id, p.code, p."externalId", p.name, p.brand, p.price::text AS price, p."priceFrom"::text AS "priceFrom", p.stock, p.image, p.url, p.active, p."syncedAt",
        coalesce(i.carts, 0) AS carts, coalesce(i.abandoned, 0) AS abandoned, coalesce(i.bought, 0) AS bought
      FROM store_products p LEFT JOIN interest i ON i.code = p.code
      WHERE ${this.where(tenantId, f)}
      ORDER BY ${Prisma.raw(ORDER[f.sort ?? 'nome'])}
      LIMIT ${limit} OFFSET ${offset}`
  }

  private view(r: Row) {
    const price = r.price === null ? null : Number(r.price)
    const priceFrom = r.priceFrom === null ? null : Number(r.priceFrom)
    return {
      ...r,
      price,
      priceFrom,
      discount: price !== null && priceFrom && priceFrom > price ? Math.round((1 - price / priceFrom) * 100) : null,
    }
  }

  async list(user: AuthUser, f: CatalogFilters, page: number, pageSize: number) {
    this.assertCan(user, 'view')
    const [rows, total] = await Promise.all([
      this.rows(user.tenantId, f, pageSize, (page - 1) * pageSize),
      this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM store_products p WHERE ${this.where(user.tenantId, f)}`,
    ])
    return { items: rows.map((r) => this.view(r)), total: total[0]?.n ?? 0, page, pageSize, interestDays: INTEREST_DAYS }
  }

  /** Resumo do catálogo e situação da sincronização com a loja. */
  async summary(user: AuthUser) {
    this.assertCan(user, 'view')
    const [counts, brands, cfg, state] = await Promise.all([
      this.prisma.$queryRaw<{ active: number; inactive: number; noStock: number; promo: number }[]>`
        SELECT (count(*) FILTER (WHERE active))::int AS active, (count(*) FILTER (WHERE NOT active))::int AS inactive,
          (count(*) FILTER (WHERE active AND stock IS NOT NULL AND stock <= 0))::int AS "noStock",
          (count(*) FILTER (WHERE active AND "priceFrom" > price))::int AS promo
        FROM store_products WHERE "tenantId" = ${user.tenantId}::uuid`,
      this.prisma.storeProduct.groupBy({ by: ['brand'], where: { tenantId: user.tenantId, active: true }, _count: { _all: true }, orderBy: { brand: 'asc' } }),
      this.magazord.config(user.tenantId),
      this.magazord.state(user.tenantId),
    ])
    return {
      ...(counts[0] ?? { active: 0, inactive: 0, noStock: 0, promo: 0 }),
      brands: brands.map((b) => ({ brand: b.brand, count: b._count._all })),
      sync: {
        enabled: cfg.enabled && !!cfg.importProducts,
        updating: this.magazord.productsUpdating(user.tenantId),
        syncedAt: state.productsSyncedAt ?? null,
        error: state.productsError ?? null,
      },
      interestDays: INTEREST_DAYS,
    }
  }

  async refresh(user: AuthUser, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const r = await this.magazord.refreshProducts(user.tenantId)
    if (!r.started) throw new BadRequestException(r.reason)
    await this.audit.byUser(user, ctx, 'catalogo.refresh', 'settings', 'magazord')
    return { ok: true }
  }

  async exportRows(user: AuthUser, f: CatalogFilters, ctx: RequestCtx) {
    this.assertCan(user, 'export')
    const rows = (await this.rows(user.tenantId, f, 20_000, 0)).map((r) => this.view(r))
    await this.audit.byUser(user, ctx, 'catalogo.exported', 'store_product', undefined, { quantidade: rows.length })
    return rows
  }
}
