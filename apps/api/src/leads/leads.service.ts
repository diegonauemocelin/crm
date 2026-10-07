import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { createHmac } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { normalizePhone, ufFromPhone } from '../atendimento/br'
import { env } from '../config/env'
import { safeEqual } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { type Action, can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { type LeadStage, Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LeadConfigService } from './lead-config.service'
import { convertCustom, normalizeEmail, normalizeTags } from './mapeamento'

export const STAGE_LABEL: Record<LeadStage, string> = { LEAD: 'Lead', QUALIFICADO: 'Lead qualificado', OPORTUNIDADE: 'Oportunidade', CLIENTE: 'Cliente' }

export interface LeadFilters {
  search?: string
  stage?: LeadStage
  grade?: string
  tag?: string
  state?: string
  ownerId?: string
  unitId?: string
  originId?: string
  emailOptIn?: 'true' | 'false'
  hasPhone?: 'true' | 'false'
  from?: string
  to?: string
}

export interface LeadInput {
  name?: string | null
  email?: string | null
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
  country?: string
  state?: string | null
  city?: string | null
  stage?: LeadStage
  ownerId?: string | null
  unitId?: string | null
  originId?: string | null
  tags?: string[]
  customFields?: Record<string, unknown>
}

const EDITABLE = ['name', 'email', 'phone', 'company', 'jobTitle', 'country', 'state', 'city', 'stage', 'ownerId', 'unitId', 'originId', 'tags', 'customFields'] as const
const SORTS: Record<string, Prisma.LeadOrderByWithRelationInput[]> = {
  recent: [{ createdAt: 'desc' }],
  name: [{ name: 'asc' }],
  score: [{ scoreGrade: { sort: 'asc', nulls: 'last' } }, { scoreInterest: 'desc' }, { scoreProfile: 'desc' }],
  activity: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }],
}

/** Máximo de leads por ação em massa. */
const BULK_LIMIT = 50_000

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: LeadConfigService,
  ) {}

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'leads', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  scopeOf(user: AuthUser): Scope {
    return user.role.isSystem ? 'ALL' : (user.permissions.leads?.scope ?? 'ALL')
  }

  /** "Próprios": leads cujo responsável é o vendedor do usuário. "Unidade": leads da unidade do usuário. */
  scope(user: AuthUser): Prisma.LeadWhereInput {
    const s = this.scopeOf(user)
    if (s === 'OWN') return { owner: { userId: user.id } }
    if (s === 'UNIT') return user.unitId ? { unitId: user.unitId } : { id: { in: [] } }
    return {}
  }

  where(user: AuthUser, f: LeadFilters): Prisma.LeadWhereInput {
    const and: Prisma.LeadWhereInput[] = [{ tenantId: user.tenantId, deletedAt: null }, this.scope(user)]
    const search = f.search?.trim()
    if (search) {
      const digits = search.replace(/\D/g, '')
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search.toLowerCase() } },
          { company: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
        ],
      })
    }
    if (f.stage) and.push({ stage: f.stage })
    if (f.grade) and.push(f.grade === 'none' ? { scoreGrade: null } : { scoreGrade: f.grade })
    if (f.tag) and.push({ tags: { has: f.tag.toLowerCase() } })
    if (f.state) and.push({ state: f.state })
    if (f.ownerId) and.push({ ownerId: f.ownerId === 'none' ? null : f.ownerId })
    if (f.unitId) and.push({ unitId: f.unitId === 'none' ? null : f.unitId })
    if (f.originId) and.push({ originId: f.originId === 'none' ? null : f.originId })
    if (f.emailOptIn) and.push({ emailOptIn: f.emailOptIn === 'true' })
    if (f.hasPhone) and.push(f.hasPhone === 'true' ? { phone: { not: null } } : { phone: null })
    if (f.from || f.to) {
      and.push({
        createdAt: {
          ...(f.from ? { gte: new Date(`${f.from}T00:00:00-03:00`) } : {}),
          ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999-03:00`) } : {}),
        },
      })
    }
    return { AND: and }
  }

  async list(user: AuthUser, f: LeadFilters, page: number, pageSize: number, sort: string) {
    this.assertCan(user, 'view')
    const where = this.where(user, f)
    const [total, items, stages] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({ where, orderBy: SORTS[sort] ?? SORTS.recent, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.lead.groupBy({ by: ['stage'], where, _count: { _all: true } }),
    ])
    return {
      total,
      page,
      pageSize,
      byStage: Object.fromEntries(stages.map((s) => [s.stage, s._count._all])),
      items: items.map((l) => this.view(l)),
    }
  }

  async exportRows(user: AuthUser, f: LeadFilters) {
    this.assertCan(user, 'export')
    const where = this.where(user, f)
    if ((await this.prisma.lead.count({ where })) > 100_000) throw new BadRequestException('Muitos leads para exportar de uma vez (máximo 100.000). Use os filtros.')
    return this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { name: true } }, unit: { select: { name: true } }, origin: { select: { name: true } } },
    })
  }

  view(l: Prisma.LeadGetPayload<object>) {
    const { tenantId: _t, deletedAt: _d, ...rest } = l
    return { ...rest, lastSaleValue: l.lastSaleValue === null ? null : Number(l.lastSaleValue), scoreTotal: l.scoreProfile + l.scoreInterest }
  }

  async load(user: AuthUser, id: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, deletedAt: null, ...this.where(user, {}) } })
    if (!lead) throw new NotFoundException('Lead não encontrado.')
    return lead
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    return this.view(await this.load(user, id))
  }

  /** Linha do tempo: eventos do lead + atendimentos de Pré/Pós-Vendas vinculados + consentimentos. */
  async timeline(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    await this.load(user, id)
    const [events, records, consents] = await Promise.all([
      this.prisma.leadEvent.findMany({ where: { leadId: id }, orderBy: { occurredAt: 'desc' }, take: 300 }),
      this.prisma.serviceRecord.findMany({
        where: { leadId: id, deletedAt: null },
        orderBy: { leadAt: 'desc' },
        select: { id: true, kind: true, leadAt: true, saleStatus: true, saleValue: true, sellerId: true, notes: true, forwarded: true, returnStatus: true },
      }),
      this.prisma.leadConsent.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' } }),
    ])
    return {
      events,
      records: records.map((r) => ({ ...r, saleValue: r.saleValue === null ? null : Number(r.saleValue) })),
      consents,
    }
  }

  // ---------- Gravação ----------

  private async assertRefs(tenantId: string, d: LeadInput) {
    if (d.ownerId && !(await this.prisma.seller.count({ where: { id: d.ownerId, tenantId } }))) throw new BadRequestException('Responsável inválido.')
    if (d.unitId && !(await this.prisma.unit.count({ where: { id: d.unitId, tenantId } }))) throw new BadRequestException('Unidade inválida.')
    if (d.originId && !(await this.prisma.lookupItem.count({ where: { id: d.originId, tenantId, type: 'ORIGEM' } }))) throw new BadRequestException('Origem inválida.')
  }

  /** Valida os campos personalizados contra as definições (tipo e opções). */
  private async cleanCustom(tenantId: string, values: Record<string, unknown> | undefined) {
    if (!values) return undefined
    const defs = await this.config.listFields(tenantId)
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(values)) {
      const def = defs.find((d) => d.key === key)
      if (!def) throw new BadRequestException(`Campo personalizado desconhecido: ${key}`)
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
      const converted = convertCustom(def, Array.isArray(v) ? v.join(',') : String(v))
      if ('error' in converted) throw new BadRequestException(`${def.label}: ${converted.error}`)
      out[key] = converted.value
    }
    return out
  }

  private normalize(d: LeadInput) {
    const out: Record<string, unknown> = Object.fromEntries(Object.entries(d).filter(([k, v]) => v !== undefined && (EDITABLE as readonly string[]).includes(k)))
    if (d.email !== undefined) {
      out.email = d.email ? normalizeEmail(d.email) : null
      if (d.email && !out.email) throw new BadRequestException('E-mail inválido.')
    }
    if (d.phone !== undefined) {
      out.phone = d.phone ? normalizePhone(d.phone) : null
      if (d.phone && !out.phone) throw new BadRequestException('Telefone inválido. Use DDD + número.')
    }
    if (d.tags !== undefined) out.tags = normalizeTags(d.tags)
    for (const k of ['name', 'company', 'jobTitle', 'city'] as const) if (d[k] !== undefined) out[k] = d[k]?.trim() || null
    if (d.state !== undefined) out.state = d.state ? d.state.toUpperCase() : null
    return out
  }

  /** Impede duplicar: o mesmo e-mail ou telefone já é de outro lead. */
  private async assertUnique(tenantId: string, email: unknown, phone: unknown, exceptId?: string) {
    const or: Prisma.LeadWhereInput[] = []
    if (email) or.push({ email: email as string })
    if (phone) or.push({ phone: phone as string })
    if (!or.length) return
    const dup = await this.prisma.lead.findFirst({ where: { tenantId, deletedAt: null, OR: or, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true, name: true, email: true } })
    if (dup) throw new ConflictException({ message: `Já existe um lead com este ${dup.email === email ? 'e-mail' : 'telefone'} (${dup.name ?? dup.email ?? 'sem nome'}).`, leadId: dup.id })
  }

  async create(user: AuthUser, d: LeadInput, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    await this.assertRefs(user.tenantId, d)
    const data = this.normalize(d)
    if (!data.email && !data.phone) throw new BadRequestException('Informe ao menos o e-mail ou o telefone.')
    await this.assertUnique(user.tenantId, data.email, data.phone)
    data.customFields = (await this.cleanCustom(user.tenantId, d.customFields)) ?? {}
    // Escopos restritos: o lead nasce no próprio responsável/unidade.
    const scope = this.scopeOf(user)
    if (scope === 'OWN') {
      const own = await this.prisma.seller.findUnique({ where: { userId: user.id } })
      if (!own) throw new ForbiddenException('Seu usuário não está vinculado a um vendedor.')
      data.ownerId = own.id
      data.unitId = own.unitId
    }
    if (scope === 'UNIT') data.unitId = user.unitId
    if (!data.state && data.phone) data.state = ufFromPhone(data.phone as string)

    const lead = await this.prisma.lead.create({
      data: {
        ...(data as Prisma.LeadUncheckedCreateInput),
        tenantId: user.tenantId,
        createdById: user.id,
        lastActivityAt: new Date(),
        events: { create: { tenantId: user.tenantId, type: 'criado', title: 'Lead cadastrado manualmente', userId: user.id, userName: user.name } },
      },
    })
    await this.audit.byUser(user, ctx, 'lead.created', 'lead', lead.id)
    await this.config.rescore(user.tenantId, [lead.id])
    return this.get(user, lead.id)
  }

  async update(user: AuthUser, id: string, d: LeadInput, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const current = await this.load(user, id)
    if (current.anonymizedAt) throw new BadRequestException('Os dados deste lead foram apagados a pedido do titular (LGPD).')
    if (this.scopeOf(user) === 'OWN' && d.ownerId !== undefined && d.ownerId !== current.ownerId) throw new ForbiddenException('Seu perfil não permite transferir o lead.')
    if (this.scopeOf(user) === 'UNIT' && d.unitId !== undefined && d.unitId !== current.unitId) throw new ForbiddenException('Seu perfil só permite leads da sua unidade.')
    await this.assertRefs(user.tenantId, d)
    const data = this.normalize(d)
    if (d.customFields !== undefined) data.customFields = { ...(current.customFields as object), ...(await this.cleanCustom(user.tenantId, d.customFields)) }
    if (data.email !== undefined || data.phone !== undefined) {
      await this.assertUnique(user.tenantId, data.email ?? null, data.phone ?? null, id)
    }

    const changed: Record<string, { de: unknown; para: unknown }> = {}
    for (const [k, v] of Object.entries(data)) {
      const before = (current as Record<string, unknown>)[k]
      if (JSON.stringify(before ?? null) !== JSON.stringify(v ?? null)) changed[k] = { de: before ?? null, para: v ?? null }
    }
    if (!Object.keys(changed).length) return this.get(user, id)

    const events: Prisma.LeadEventCreateManyLeadInput[] = []
    if (changed.stage) {
      events.push({ tenantId: user.tenantId, type: 'estagio', title: `Estágio: ${STAGE_LABEL[current.stage]} → ${STAGE_LABEL[data.stage as LeadStage]}`, userId: user.id, userName: user.name })
    }
    const others = Object.keys(changed).filter((k) => k !== 'stage')
    if (others.length) events.push({ tenantId: user.tenantId, type: 'alteracao', title: 'Dados alterados', data: changed as Prisma.InputJsonValue, userId: user.id, userName: user.name })

    await this.prisma.lead.update({
      where: { id },
      data: { ...(Object.fromEntries(Object.keys(changed).map((k) => [k, data[k]])) as Prisma.LeadUncheckedUpdateInput), events: { createMany: { data: events } } },
    })
    await this.audit.byUser(user, ctx, 'lead.updated', 'lead', id, { campos: Object.keys(changed) })
    await this.config.rescore(user.tenantId, [id])
    return this.get(user, id)
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    await this.load(user, id)
    await this.prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.prisma.serviceRecord.updateMany({ where: { leadId: id }, data: { leadId: null } })
    await this.audit.byUser(user, ctx, 'lead.deleted', 'lead', id)
  }

  /**
   * Ações em massa: tags, estágio e responsável. Vale para os leads selecionados (ids) ou para todos os
   * leads de um filtro (ex.: origem Ecommerce -> responsável "Ecommerce"), sempre dentro do escopo do perfil.
   * Grava em blocos com comandos únicos por bloco (não guarda planos de consulta enormes em memória).
   */
  async bulk(
    user: AuthUser,
    target: { ids?: string[]; filters?: LeadFilters },
    action: { addTags?: string[]; removeTags?: string[]; stage?: LeadStage; ownerId?: string | null },
    ctx: RequestCtx,
  ) {
    this.assertCan(user, 'edit')
    if (action.ownerId !== undefined && this.scopeOf(user) === 'OWN') throw new ForbiddenException('Seu perfil não permite transferir leads.')
    if (action.ownerId) await this.assertRefs(user.tenantId, { ownerId: action.ownerId })
    if (!target.ids?.length && !target.filters) throw new BadRequestException('Selecione os leads.')
    const where: Prisma.LeadWhereInput = target.ids?.length
      ? { id: { in: target.ids }, anonymizedAt: null, ...this.where(user, {}) }
      : { AND: [this.where(user, target.filters ?? {}), { anonymizedAt: null }] }
    const total = await this.prisma.lead.count({ where })
    if (total > BULK_LIMIT) throw new BadRequestException(`São ${total.toLocaleString('pt-BR')} leads: o máximo por ação é ${BULK_LIMIT.toLocaleString('pt-BR')}. Use mais filtros.`)
    const leads = await this.prisma.lead.findMany({ where, select: { id: true, stage: true } })
    const add = normalizeTags(action.addTags ?? [])
    const remove = normalizeTags(action.removeTags ?? [])

    for (let i = 0; i < leads.length; i += 1000) {
      const chunk = leads.slice(i, i + 1000)
      const ids = chunk.map((l) => l.id)
      if (action.ownerId !== undefined) await this.prisma.lead.updateMany({ where: { id: { in: ids } }, data: { ownerId: action.ownerId } })
      if (add.length || remove.length) {
        await this.prisma.$executeRaw`
          UPDATE leads SET tags = ARRAY(SELECT DISTINCT t FROM unnest(tags || ${add}::text[]) AS t WHERE t <> ALL(${remove}::text[])), "updatedAt" = now()
          WHERE id = ANY(${ids}::uuid[])`
      }
      if (action.stage) {
        const changing = chunk.filter((l) => l.stage !== action.stage)
        if (changing.length) {
          await this.prisma.lead.updateMany({ where: { id: { in: changing.map((l) => l.id) } }, data: { stage: action.stage } })
          await this.prisma.leadEvent.createMany({
            data: changing.map((l) => ({ tenantId: user.tenantId, leadId: l.id, type: 'estagio', title: `Estágio: ${STAGE_LABEL[l.stage]} → ${STAGE_LABEL[action.stage!]}`, userId: user.id, userName: user.name })),
          })
        }
      }
    }
    await this.audit.byUser(user, ctx, 'lead.bulk_updated', 'lead', undefined, { quantidade: leads.length, porFiltro: !target.ids?.length, filtros: target.filters ?? null, ...action })
    // Responsável não entra na nota; tags e estágio entram.
    if (add.length || remove.length || action.stage) await this.config.rescore(user.tenantId, leads.map((l) => l.id))
    return { updated: leads.length }
  }

  // ---------- Consentimento e LGPD ----------

  async setEmailConsent(tenantId: string, leadId: string, granted: boolean, source: string, meta: { text?: string; ip?: string | null; userId?: string; userName?: string }) {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        emailOptIn: granted,
        emailOptOutAt: granted ? null : new Date(),
        consents: { create: { purpose: 'email_marketing', granted, source, text: meta.text, ip: meta.ip ?? undefined } },
        events: {
          create: {
            tenantId,
            type: 'consentimento',
            title: granted ? `Aceitou receber e-mails (${source})` : `Descadastrou-se dos e-mails (${source})`,
            userId: meta.userId,
            userName: meta.userName,
          },
        },
      },
    })
  }

  async consent(user: AuthUser, id: string, granted: boolean, text: string | undefined, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    await this.load(user, id)
    await this.setEmailConsent(user.tenantId, id, granted, `registrado por ${user.name}`, { text, ip: ctx.ip, userId: user.id, userName: user.name })
    await this.audit.byUser(user, ctx, granted ? 'lead.consent_granted' : 'lead.consent_revoked', 'lead', id)
    return this.get(user, id)
  }

  /** Portabilidade (LGPD art. 18): todos os dados pessoais do titular em um arquivo. */
  async exportPersonal(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'export')
    const lead = await this.load(user, id)
    const tl = await this.timeline(user, id)
    const visitas = await this.prisma.siteVisitor.findMany({
      where: { leadId: id },
      select: { firstSeenAt: true, lastSeenAt: true, firstTouch: true, lastTouch: true, views: { select: { url: true, title: true, occurredAt: true }, orderBy: { occurredAt: 'desc' } } },
    })
    const loja = {
      pedidos: await this.prisma.ecommerceOrder.findMany({ where: { leadId: id }, select: { code: true, orderedAt: true, total: true, statusName: true, payment: true } }),
      carrinhos: await this.prisma.ecommerceCart.findMany({ where: { leadId: id }, select: { items: true, lastActivityAt: true, checkoutStarted: true, status: true } }),
    }
    await this.audit.byUser(user, ctx, 'lead.personal_data_exported', 'lead', id)
    const { tenantId: _t, ...data } = lead
    return { geradoEm: new Date().toISOString(), titular: data, linhaDoTempo: tl.events, atendimentos: tl.records, consentimentos: tl.consents, navegacaoNoSite: visitas, lojaVirtual: loja }
  }

  /**
   * Eliminação (LGPD art. 18): apaga os dados pessoais do lead e dos atendimentos vinculados.
   * Fica um registro anônimo, sem nome/e-mail/telefone, só para não distorcer as estatísticas.
   */
  async anonymize(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    await this.load(user, id)
    await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id },
        data: {
          name: null,
          email: null,
          phone: null,
          company: null,
          jobTitle: null,
          city: null,
          customFields: {},
          tags: [],
          firstConversion: Prisma.DbNull,
          lastConversion: Prisma.DbNull,
          emailOptIn: false,
          ecommerceId: null,
          anonymizedAt: new Date(),
        },
      }),
      this.prisma.leadEvent.deleteMany({ where: { leadId: id } }),
      // Navegação no site ligada à pessoa (as páginas vistas vão junto, em cascata).
      this.prisma.siteVisitor.deleteMany({ where: { leadId: id } }),
      // Carrinhos guardam nome, e-mail e telefone; pedidos ficam (registro fiscal da loja), sem o vínculo com a pessoa.
      this.prisma.ecommerceCart.deleteMany({ where: { leadId: id } }),
      this.prisma.ecommerceOrder.updateMany({ where: { leadId: id }, data: { leadId: null, customerId: null } }),
      this.prisma.leadConsent.updateMany({ where: { leadId: id }, data: { ip: null, text: null } }),
      this.prisma.serviceRecord.updateMany({ where: { leadId: id }, data: { name: 'Dados removidos (LGPD)', phone: null, email: null, customerCode: null, notes: null } }),
    ])
    await this.audit.byUser(user, ctx, 'lead.anonymized', 'lead', id)
  }

  // ---------- Descadastro em 1 clique ----------

  private unsubscribeKey() {
    return createHmac('sha256', env.jwtAccessSecret).update('descadastro-v1').digest()
  }

  /** Token sem expiração para o link de descadastro dos e-mails (não dá acesso a nada além disso). */
  unsubscribeToken(leadId: string) {
    const sig = createHmac('sha256', this.unsubscribeKey()).update(leadId).digest('base64url').slice(0, 32)
    return `${Buffer.from(leadId).toString('base64url')}.${sig}`
  }

  private leadFromToken(token: string) {
    const [encoded, sig] = token.split('.')
    if (!encoded || !sig) return null
    let leadId: string
    try {
      leadId = Buffer.from(encoded, 'base64url').toString('utf8')
    } catch {
      return null
    }
    const expected = createHmac('sha256', this.unsubscribeKey()).update(leadId).digest('base64url').slice(0, 32)
    return safeEqual(sig, expected) ? leadId : null
  }

  async unsubscribeInfo(token: string) {
    const id = this.leadFromToken(token)
    const lead = id ? await this.prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { email: true, emailOptIn: true } }) : null
    if (!lead) throw new NotFoundException('Link de descadastro inválido.')
    // Mostra o e-mail parcialmente, para a pessoa reconhecer sem expor o endereço completo.
    const masked = lead.email ? lead.email.replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2') : null
    return { email: masked, subscribed: lead.emailOptIn }
  }

  async unsubscribe(token: string, ip: string | null) {
    const id = this.leadFromToken(token)
    const lead = id ? await this.prisma.lead.findFirst({ where: { id, deletedAt: null } }) : null
    if (!lead) throw new NotFoundException('Link de descadastro inválido.')
    if (lead.emailOptIn) await this.setEmailConsent(lead.tenantId, lead.id, false, 'link de descadastro', { ip })
    await this.audit.log({ tenantId: lead.tenantId, action: 'lead.unsubscribed', entity: 'lead', entityId: lead.id, ip })
    return { ok: true }
  }
}
