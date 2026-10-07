import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { LookupType } from '../generated/prisma/client'
import { linkSellersByEmail } from '../common/seller-link'
import { PrismaService } from '../prisma/prisma.service'
import { PART_TYPES } from './planilha'

export const LOOKUP_TYPES: LookupType[] = ['ORIGEM', 'TIPO_CLIENTE', 'MARCA', 'TIPO_PECA', 'MOTIVO_PERDA']

/** Listas iniciais (as mesmas usadas hoje na planilha da empresa). Só são criadas se o tenant ainda não tiver nenhuma. */
const DEFAULTS: Record<LookupType, string[]> = {
  ORIGEM: ['Site - LP', 'WhatsApp', 'RD Station', 'Ligação', 'Facebook / Instagram', 'E-mail', 'Indicação'],
  TIPO_CLIENTE: ['Consumidor Final', 'Revenda', 'Mecânico / Oficina'],
  MARCA: ['JCB', 'Caterpillar', 'Hyundai', 'Case', 'Perkins', 'Komatsu', 'XCMG', 'Volvo', 'New Holland', 'John Deere', 'Sany', 'LiuGong', 'SDLG', 'Doosan', 'SEM', 'Randon'],
  TIPO_PECA: PART_TYPES,
  MOTIVO_PERDA: ['Sem produto disponível', 'Não respondeu', 'Urgência', 'Preço', 'Frete', 'Indeciso', 'Outro'],
}

@Injectable()
export class CadastrosService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    for (const t of await this.prisma.tenant.findMany({ select: { id: true } })) {
      await this.ensureDefaults(t.id)
      // Vendedores e usuários com o mesmo e-mail já cadastrados antes do vínculo automático.
      const linked = await linkSellersByEmail(this.prisma, t.id)
      if (linked.length) await this.audit.log({ tenantId: t.id, action: 'vendedor.auto_linked', entity: 'seller', data: { vinculos: linked } })
    }
  }

  /** Vincula pelo e-mail depois de salvar vendedor ou usuário, e registra na auditoria. */
  async autoLink(actor: AuthUser, ctx: RequestCtx) {
    const linked = await linkSellersByEmail(this.prisma, actor.tenantId)
    if (linked.length) await this.audit.byUser(actor, ctx, 'vendedor.auto_linked', 'seller', undefined, { vinculos: linked })
    return linked
  }

  async ensureDefaults(tenantId: string) {
    if ((await this.prisma.lookupItem.count({ where: { tenantId } })) > 0) return
    await this.prisma.lookupItem.createMany({
      data: LOOKUP_TYPES.flatMap((type) => DEFAULTS[type].map((name) => ({ tenantId, type, name }))),
      skipDuplicates: true,
    })
  }

  /** Itens ativos de todas as listas, para os formulários e filtros. */
  async options(tenantId: string) {
    const [lookups, sellers, units] = await Promise.all([
      this.prisma.lookupItem.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { id: true, type: true, name: true, active: true } }),
      this.prisma.seller.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, unitId: true, active: true, userId: true } }),
      this.prisma.unit.findMany({
        where: { tenantId },
        orderBy: [{ isHeadquarters: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, city: true, state: true, isHeadquarters: true, active: true },
      }),
    ])
    const byType = (t: LookupType) => lookups.filter((l) => l.type === t)
    return {
      units,
      sellers,
      origins: byType('ORIGEM'),
      customerTypes: byType('TIPO_CLIENTE'),
      brands: byType('MARCA'),
      partTypes: byType('TIPO_PECA'),
      lostReasons: byType('MOTIVO_PERDA'),
    }
  }

  async listLookups(tenantId: string, type: LookupType) {
    const items = await this.prisma.lookupItem.findMany({ where: { tenantId, type }, orderBy: { name: 'asc' } })
    const usage = await this.usage(tenantId, type, items.map((i) => i.id))
    return items.map((i) => ({ ...i, usage: usage.get(i.id) ?? 0 }))
  }

  private async usage(tenantId: string, type: LookupType, ids: string[]) {
    const map = new Map<string, number>()
    if (ids.length === 0) return map
    if (type === 'MARCA' || type === 'TIPO_PECA') {
      const column = type === 'MARCA' ? 'brandIds' : 'partTypeIds'
      const rows = await this.prisma.$queryRawUnsafe<{ id: string; total: bigint }[]>(
        `SELECT unnest("${column}")::text AS id, count(*) AS total FROM service_records WHERE "tenantId" = $1::uuid AND "deletedAt" IS NULL GROUP BY 1`,
        tenantId,
      )
      for (const r of rows) map.set(r.id, Number(r.total))
      return map
    }
    const field = type === 'ORIGEM' ? 'originId' : type === 'TIPO_CLIENTE' ? 'customerTypeId' : 'lostReasonId'
    const grouped = await this.prisma.serviceRecord.groupBy({ by: [field], where: { tenantId, deletedAt: null }, _count: { _all: true } })
    for (const g of grouped as unknown as Record<string, unknown>[]) {
      const id = g[field] as string | null
      if (id) map.set(id, (g._count as { _all: number })._all)
    }
    return map
  }

  async createLookup(actor: AuthUser, type: LookupType, name: string, ctx: RequestCtx) {
    const clean = name.trim()
    await this.assertUniqueLookup(actor.tenantId, type, clean)
    const item = await this.prisma.lookupItem.create({ data: { tenantId: actor.tenantId, type, name: clean } })
    await this.audit.byUser(actor, ctx, 'cadastro.created', 'lookup', item.id, { type, name: clean })
    return item
  }

  async updateLookup(actor: AuthUser, id: string, data: { name?: string; active?: boolean }, ctx: RequestCtx) {
    const item = await this.prisma.lookupItem.findFirst({ where: { id, tenantId: actor.tenantId } })
    if (!item) throw new NotFoundException('Item não encontrado.')
    const name = data.name?.trim()
    if (name && name.toLowerCase() !== item.name.toLowerCase()) await this.assertUniqueLookup(actor.tenantId, item.type, name)
    const updated = await this.prisma.lookupItem.update({ where: { id }, data: { name, active: data.active } })
    await this.audit.byUser(actor, ctx, 'cadastro.updated', 'lookup', id, { type: item.type, de: item.name, ...data })
    return updated
  }

  private async assertUniqueLookup(tenantId: string, type: LookupType, name: string) {
    if (!name) throw new BadRequestException('Informe o nome.')
    const exists = await this.prisma.lookupItem.findFirst({ where: { tenantId, type, name: { equals: name, mode: 'insensitive' } } })
    if (exists) throw new ConflictException(`"${name}" já existe nesta lista${exists.active ? '' : ' (está desativado)'}.`)
  }

  async listUnits(tenantId: string) {
    const [units, sellers, users, records] = await Promise.all([
      this.prisma.unit.findMany({ where: { tenantId }, orderBy: [{ isHeadquarters: 'desc' }, { name: 'asc' }] }),
      this.prisma.seller.groupBy({ by: ['unitId'], where: { tenantId, active: true }, _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ['unitId'], where: { tenantId, active: true }, _count: { _all: true } }),
      this.prisma.serviceRecord.groupBy({ by: ['unitId'], where: { tenantId, deletedAt: null }, _count: { _all: true } }),
    ])
    const count = (rows: { unitId: string | null; _count: { _all: number } }[], id: string) => rows.find((r) => r.unitId === id)?._count._all ?? 0
    return units.map((u) => ({ ...u, sellers: count(sellers, u.id), users: count(users, u.id), records: count(records, u.id) }))
  }

  async saveUnit(
    actor: AuthUser,
    id: string | null,
    data: { name: string; city?: string | null; state?: string | null; isHeadquarters?: boolean; active?: boolean },
    ctx: RequestCtx,
  ) {
    const name = data.name.trim()
    const dup = await this.prisma.unit.findFirst({
      where: { tenantId: actor.tenantId, name: { equals: name, mode: 'insensitive' }, ...(id ? { NOT: { id } } : {}) },
    })
    if (dup) throw new ConflictException('Já existe uma unidade com este nome.')
    const payload = {
      name,
      city: data.city?.trim() || null,
      state: data.state?.toUpperCase() || null,
      isHeadquarters: data.isHeadquarters ?? false,
      ...(data.active !== undefined ? { active: data.active } : {}),
    }
    const unit = await this.prisma.$transaction(async (tx) => {
      // Só existe uma matriz.
      if (payload.isHeadquarters) await tx.unit.updateMany({ where: { tenantId: actor.tenantId, ...(id ? { NOT: { id } } : {}) }, data: { isHeadquarters: false } })
      if (id) {
        const current = await tx.unit.findFirst({ where: { id, tenantId: actor.tenantId } })
        if (!current) throw new NotFoundException('Unidade não encontrada.')
        return tx.unit.update({ where: { id }, data: payload })
      }
      return tx.unit.create({ data: { tenantId: actor.tenantId, ...payload } })
    })
    await this.audit.byUser(actor, ctx, id ? 'unidade.updated' : 'unidade.created', 'unit', unit.id, payload)
    return unit
  }

  async assertUnit(tenantId: string, unitId: string | null | undefined) {
    if (unitId && !(await this.prisma.unit.count({ where: { id: unitId, tenantId } }))) throw new BadRequestException('Unidade inválida.')
  }

  countSellers(tenantId: string, ids: string[]) {
    return this.prisma.seller.count({ where: { tenantId, id: { in: [...new Set(ids)] } } })
  }

  async listSellers(tenantId: string) {
    const [sellers, counts] = await Promise.all([
      this.prisma.seller.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
        include: { user: { select: { id: true, name: true, email: true } }, unit: { select: { id: true, name: true } } },
      }),
      this.prisma.serviceRecord.groupBy({ by: ['sellerId'], where: { tenantId, deletedAt: null }, _count: { _all: true } }),
    ])
    const usage = new Map(counts.map((c) => [c.sellerId, c._count._all]))
    return sellers.map((s) => ({ ...s, usage: usage.get(s.id) ?? 0 }))
  }

  async saveSeller(
    actor: AuthUser,
    id: string | null,
    data: { name: string; unitId?: string | null; email?: string | null; phone?: string | null; userId?: string | null; active?: boolean },
    ctx: RequestCtx,
  ) {
    const name = data.name.trim()
    await this.assertUnit(actor.tenantId, data.unitId)
    const dup = await this.prisma.seller.findFirst({
      where: { tenantId: actor.tenantId, name: { equals: name, mode: 'insensitive' }, ...(id ? { NOT: { id } } : {}) },
    })
    if (dup) throw new ConflictException('Já existe um vendedor com este nome.')
    if (data.userId) {
      const user = await this.prisma.user.findFirst({ where: { id: data.userId, tenantId: actor.tenantId } })
      if (!user) throw new BadRequestException('Usuário inválido.')
      const linked = await this.prisma.seller.findFirst({ where: { userId: data.userId, ...(id ? { NOT: { id } } : {}) } })
      if (linked) throw new ConflictException(`Este usuário já está vinculado ao vendedor ${linked.name}.`)
    }
    const payload = {
      name,
      unitId: data.unitId || null,
      email: data.email?.trim().toLowerCase() || null,
      phone: data.phone?.trim() || null,
      userId: data.userId || null,
      ...(data.active !== undefined ? { active: data.active } : {}),
    }
    if (id) {
      const current = await this.prisma.seller.findFirst({ where: { id, tenantId: actor.tenantId } })
      if (!current) throw new NotFoundException('Vendedor não encontrado.')
      const seller = await this.prisma.seller.update({ where: { id }, data: payload })
      // Atendimentos do vendedor ainda sem unidade (ex.: importados da planilha) passam a usar a unidade dele.
      let backfilled = 0
      if (payload.unitId && payload.unitId !== current.unitId) {
        backfilled = (
          await this.prisma.serviceRecord.updateMany({ where: { tenantId: actor.tenantId, sellerId: id, unitId: null }, data: { unitId: payload.unitId } })
        ).count
      }
      await this.audit.byUser(actor, ctx, 'vendedor.updated', 'seller', id, { ...payload, atendimentosAtribuidosAUnidade: backfilled })
      const linked = await this.autoLink(actor, ctx)
      return { ...(linked.length ? await this.prisma.seller.findUniqueOrThrow({ where: { id } }) : seller), backfilled }
    }
    const seller = await this.prisma.seller.create({ data: { tenantId: actor.tenantId, ...payload } })
    await this.audit.byUser(actor, ctx, 'vendedor.created', 'seller', seller.id, payload)
    const linked = await this.autoLink(actor, ctx)
    return linked.length ? await this.prisma.seller.findUniqueOrThrow({ where: { id: seller.id } }) : seller
  }

  /** Junta dois cadastros da mesma pessoa: os atendimentos passam para o destino e a origem é desativada. */
  async mergeSellers(actor: AuthUser, sourceId: string, targetId: string, ctx: RequestCtx) {
    if (sourceId === targetId) throw new BadRequestException('Escolha dois vendedores diferentes.')
    const [source, target] = await Promise.all([
      this.prisma.seller.findFirst({ where: { id: sourceId, tenantId: actor.tenantId } }),
      this.prisma.seller.findFirst({ where: { id: targetId, tenantId: actor.tenantId } }),
    ])
    if (!source || !target) throw new NotFoundException('Vendedor não encontrado.')
    const moved = await this.prisma.$transaction(async (tx) => {
      const r = await tx.serviceRecord.updateMany({ where: { sellerId: sourceId, tenantId: actor.tenantId }, data: { sellerId: targetId } })
      await tx.seller.update({ where: { id: sourceId }, data: { active: false, userId: null } })
      return r.count
    })
    await this.audit.byUser(actor, ctx, 'vendedor.merged', 'seller', targetId, { de: source.name, para: target.name, atendimentos: moved })
    return { moved }
  }

  /** Usado pela importação: devolve o id do item, criando-o se ainda não existir. */
  async resolveLookup(tenantId: string, type: LookupType, name: string, cache: Map<string, string>): Promise<string> {
    const key = `${type}:${name.trim().toLowerCase()}`
    const hit = cache.get(key)
    if (hit) return hit
    const existing = await this.prisma.lookupItem.findFirst({ where: { tenantId, type, name: { equals: name.trim(), mode: 'insensitive' } } })
    const id = existing?.id ?? (await this.prisma.lookupItem.create({ data: { tenantId, type, name: name.trim() } })).id
    cache.set(key, id)
    return id
  }

  async resolveSeller(tenantId: string, name: string, cache: Map<string, string>): Promise<string> {
    const key = `SELLER:${name.trim().toLowerCase()}`
    const hit = cache.get(key)
    if (hit) return hit
    const existing = await this.prisma.seller.findFirst({ where: { tenantId, name: { equals: name.trim(), mode: 'insensitive' } } })
    const id = existing?.id ?? (await this.prisma.seller.create({ data: { tenantId, name: name.trim() } })).id
    cache.set(key, id)
    return id
  }
}
