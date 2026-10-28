import { randomUUID } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { Prisma, type ServiceKind } from '../generated/prisma/client'
import { LeadSyncService } from '../leads/lead-sync.service'
import { adsName, OrigemAdsService } from '../leads/origem-ads.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { normalizePhone, REGIONS, regionOf, UF_LIST, UFS } from './br'
import { type BusinessHours, cleanRules, subBusinessMs, type WaRules } from '../whatsapp/envio'
import { buildDashboard, type DashRow } from './dashboard'
import { applyAutomaticFields, cleanDigest, deadline, DEFAULT_CONTACT_CHECK, DEFAULT_FORWARD_MESSAGE, DEFAULT_REACTIVATION, type Reactivation, type ForwardMessage, skipsPostSale, digestFor, DEFAULT_DIGEST, DEFAULT_NEXT_DAY, digestMessages, saleSituation, type SellerDigest, todayWindow, diffRecord, FIELD_LABELS, type FollowStatus, inNegotiation, isCallOverdue, isFollowOverdue, isOverdue, nextCallDue, type NextDayMessage, type RecordState, shouldCreatePostSale, validateFollow, validateRecord } from './regras'

export const MODULE_BY_KIND: Record<ServiceKind, 'pre_vendas' | 'pos_vendas'> = { PRE_VENDAS: 'pre_vendas', POS_VENDAS: 'pos_vendas' }

export interface AtendimentoSettings {
  alertHours: number
  /** Pré-venda nova sem ninguém mexer: depois destes minutos fica "aguardando atendimento" (destaque e sino). */
  newRecordMinutes?: number
  /** Prazo para o pós-venda fazer o primeiro contato. */
  postSaleHours: number
  /** Quem recebe o pós-venda gerado da pré-venda: por unidade e, sem unidade configurada, o padrão. */
  postSaleOwnerId: string | null
  postSaleOwnerByUnit: Record<string, string>
  /** Pré-venda em negociação: prazo (horas) para chamar o cliente, renovado a cada "Chamei o cliente". */
  callHours?: number
  /** Mensagem de WhatsApp enviada sozinha no dia seguinte para quem abriu pré-venda. */
  nextDayMessage?: NextDayMessage
  /** Resumo do dia para cada vendedor: os clientes repassados a ele, pelo WhatsApp. */
  sellerDigest?: SellerDigest
  /** Mensagem de WhatsApp para o cliente quando o Pré-Vendas repassa ao vendedor (na hora ou depois de um tempo). */
  forwardMessage?: ForwardMessage
  /** Pergunta ao cliente se o vendedor já entrou em contato (ex.: 30 minutos depois do repasse). */
  contactCheck?: ForwardMessage
  reactivation?: Reactivation
  /**
   * Motivos de perda que não geram pós-venda (ex.: "Não temos o produto"): a pré-venda fecha e o atendimento no chat
   * é finalizado. Sem configuração: os motivos que falam de produto em falta.
   */
  noPostSaleReasonIds?: string[]
}
export const DEFAULT_ATENDIMENTO: AtendimentoSettings = { alertHours: 24, newRecordMinutes: 10, postSaleHours: 24, postSaleOwnerId: null, postSaleOwnerByUnit: {}, callHours: 24, nextDayMessage: DEFAULT_NEXT_DAY, sellerDigest: DEFAULT_DIGEST, forwardMessage: DEFAULT_FORWARD_MESSAGE, contactCheck: DEFAULT_CONTACT_CHECK, reactivation: DEFAULT_REACTIVATION }
export const callHoursOf = (s: AtendimentoSettings) => s.callHours ?? 24
/** Pré-venda nova só conta como "aguardando" nos últimos dias (o histórico antigo não vira aviso). */
const WAITING_WINDOW_MS = 7 * 86_400_000

export interface RecordFilters {
  kind: ServiceKind
  search?: string
  sellerId?: string
  unitId?: string
  originId?: string
  customerTypeId?: string
  state?: string
  region?: string
  brandId?: string
  partTypeId?: string
  lostReasonId?: string
  forwarded?: 'true' | 'false'
  returnStatus?: 'SIM' | 'NAO' | 'PENDENTE'
  saleStatus?: 'SIM' | 'NAO' | 'NEGOCIACAO'
  from?: string
  to?: string
  overdue?: 'true'
  followStatus?: FollowStatus
  followOverdue?: 'true'
  /** Pré-vendas cujo pós-venda devolveu o caso ao vendedor. */
  postSaleReturned?: 'true'
  /** Pré-vendas novas que ninguém atendeu ainda. */
  waiting?: 'true'
  /** Em negociação e já passou do prazo para chamar o cliente. */
  callDue?: 'true'
  /** Veio do Google Ads (campanha ou origem "Google") ou não. */
  adsVia?: 'ads' | 'nao'
}

export interface RecordInput {
  kind?: ServiceKind
  leadAt?: string
  name?: string
  customerCode?: string | null
  phone?: string | null
  email?: string | null
  sellerId?: string | null
  unitId?: string | null
  originId?: string | null
  customerTypeId?: string | null
  country?: string
  state?: string | null
  city?: string | null
  brandIds?: string[]
  partTypeIds?: string[]
  forwarded?: boolean
  returnStatus?: 'SIM' | 'NAO' | 'PENDENTE' | null
  saleStatus?: 'SIM' | 'NAO' | 'NEGOCIACAO'
  lostReasonId?: string | null
  invoiceNumber?: string | null
  saleValue?: number | null
  notes?: string | null
  followStatus?: FollowStatus | null
  followNote?: string | null
  callDueAt?: string | null
}

const SORTABLE = new Set(['leadAt', 'name', 'saleValue', 'createdAt', 'updatedAt'])

/** Início/fim do dia em São Paulo (UTC-3, sem horário de verão desde 2019). */
export function dayStart(date: string) {
  return new Date(`${date}T00:00:00-03:00`)
}
export function dayEnd(date: string) {
  return new Date(`${date}T23:59:59.999-03:00`)
}

@Injectable()
export class ServiceRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly leadSync: LeadSyncService,
    private readonly origemAds: OrigemAdsService,
  ) {}

  assertCan(user: AuthUser, kind: ServiceKind, action: Action) {
    if (!can(user.permissions, user.role.isSystem, MODULE_BY_KIND[kind], action)) {
      throw new ForbiddenException('Você não tem permissão para esta ação.')
    }
  }

  scopeOf(user: AuthUser, kind: ServiceKind): Scope {
    if (user.role.isSystem) return 'ALL'
    return user.permissions[MODULE_BY_KIND[kind]]?.scope ?? 'ALL'
  }

  /**
   * "Somente os próprios": atendimentos do vendedor vinculado ao usuário.
   * "Somente da unidade": atendimentos da unidade do usuário (usuário sem unidade não vê nenhum).
   */
  scope(user: AuthUser, kind: ServiceKind): Prisma.ServiceRecordWhereInput {
    const s = this.scopeOf(user, kind)
    if (s === 'OWN') return { seller: { userId: user.id } }
    if (s === 'UNIT') return user.unitId ? { unitId: user.unitId } : { id: { in: [] } }
    return {}
  }

  /** Unidade do vendedor, usada para preencher a unidade do atendimento. */
  private async sellerUnit(tenantId: string, sellerId: string | null | undefined) {
    if (!sellerId) return null
    return (await this.prisma.seller.findFirst({ where: { id: sellerId, tenantId }, select: { unitId: true } }))?.unitId ?? null
  }

  alertSettings(tenantId: string) {
    return this.settings.get(tenantId, 'atendimento', DEFAULT_ATENDIMENTO)
  }

  /** Horário comercial (WhatsApp › Regras): os prazos da pré e da pós-venda só contam dentro dele. Desligado: null. */
  async hours(tenantId: string): Promise<BusinessHours | null> {
    const h = cleanRules(await this.settings.get<Partial<WaRules>>(tenantId, 'whatsapp_regras', {})).businessHours
    return h.enabled ? h : null
  }

  countLostReasons(tenantId: string, ids: string[]) {
    return this.prisma.lookupItem.count({ where: { tenantId, type: 'MOTIVO_PERDA', id: { in: [...new Set(ids)] } } })
  }

  /** Motivos de perda que encerram sem pós-venda: os escolhidos ou, sem escolha, os de produto em falta. */
  async noPostSaleReasons(tenantId: string, s?: AtendimentoSettings): Promise<string[]> {
    const settings = s ?? (await this.alertSettings(tenantId))
    if (Array.isArray(settings.noPostSaleReasonIds)) return settings.noPostSaleReasonIds
    const reasons = await this.prisma.lookupItem.findMany({ where: { tenantId, type: 'MOTIVO_PERDA' }, select: { id: true, name: true } })
    return reasons.filter((r) => skipsPostSale(r.name)).map((r) => r.id)
  }

  /** Pré-venda nova que ninguém atendeu: criada sozinha (formulário, WhatsApp, chat) e sem nenhuma alteração de uma pessoa. */
  private waitingWhere(now: number): Prisma.ServiceRecordWhereInput {
    return { kind: 'PRE_VENDAS', firstActionAt: null, forwarded: false, saleStatus: 'NEGOCIACAO', createdAt: { gte: new Date(now - WAITING_WINDOW_MS) } }
  }

  /** Em negociação (repassada, sem resultado) com o prazo para chamar o cliente vencido. */
  private callDueWhere(now: Date): Prisma.ServiceRecordWhereInput {
    return { kind: 'PRE_VENDAS', forwarded: true, saleStatus: 'NEGOCIACAO', callDueAt: { lt: now } }
  }

  async where(user: AuthUser, f: RecordFilters): Promise<Prisma.ServiceRecordWhereInput> {
    const and: Prisma.ServiceRecordWhereInput[] = [{ tenantId: user.tenantId, kind: f.kind, deletedAt: null }, this.scope(user, f.kind)]
    const search = f.search?.trim()
    if (search) {
      const digits = search.replace(/\D/g, '')
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { customerCode: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
        ],
      })
    }
    if (f.sellerId) and.push({ sellerId: f.sellerId === 'none' ? null : f.sellerId })
    if (f.unitId) and.push({ unitId: f.unitId === 'none' ? null : f.unitId })
    if (f.originId) and.push({ originId: f.originId === 'none' ? null : f.originId })
    if (f.customerTypeId) and.push({ customerTypeId: f.customerTypeId === 'none' ? null : f.customerTypeId })
    if (f.lostReasonId) and.push({ lostReasonId: f.lostReasonId })
    if (f.state) and.push(f.state === 'EX' ? { country: { not: 'BR' } } : { state: f.state })
    if (f.region) and.push({ state: { in: UF_LIST.filter((uf) => UFS[uf].region === f.region) } })
    if (f.brandId) and.push({ brandIds: { has: f.brandId } })
    if (f.partTypeId) and.push({ partTypeIds: { has: f.partTypeId } })
    if (f.forwarded) and.push({ forwarded: f.forwarded === 'true' })
    if (f.returnStatus) and.push({ returnStatus: f.returnStatus })
    if (f.saleStatus) and.push({ saleStatus: f.saleStatus })
    if (f.from || f.to) and.push({ leadAt: { ...(f.from ? { gte: dayStart(f.from) } : {}), ...(f.to ? { lte: dayEnd(f.to) } : {}) } })
    if (f.followStatus) and.push({ followStatus: f.followStatus })
    if (f.postSaleReturned === 'true') and.push({ children: { some: { followStatus: 'VOLTOU_AO_VENDEDOR', deletedAt: null } } })
    if (f.followOverdue === 'true') and.push({ followStatus: 'PENDENTE', dueAt: { lt: new Date() } })
    if (f.waiting === 'true') and.push(this.waitingWhere(Date.now()))
    if (f.callDue === 'true') and.push(this.callDueWhere(new Date()))
    if (f.adsVia === 'ads') and.push({ adsVia: { in: ['ANUNCIO', 'ORIGEM'] } })
    if (f.adsVia === 'nao') and.push({ OR: [{ adsVia: null }, { adsVia: { notIn: ['ANUNCIO', 'ORIGEM'] } }] })
    if (f.overdue === 'true') {
      const [{ alertHours }, hours] = await Promise.all([this.alertSettings(user.tenantId), this.hours(user.tenantId)])
      and.push({ forwarded: true, returnStatus: 'PENDENTE', forwardedAt: { lt: this.overdueLimit(alertHours, hours) } })
    }
    return { AND: and }
  }

  async list(user: AuthUser, f: RecordFilters, page: number, pageSize: number, sort = 'leadAt', dir: 'asc' | 'desc' = 'desc') {
    this.assertCan(user, f.kind, 'view')
    const where = await this.where(user, f)
    const orderBy = SORTABLE.has(sort) ? [{ [sort]: dir }, { createdAt: 'desc' as const }] : [{ leadAt: 'desc' as const }]
    const [total, rows, { alertHours }, names, hours] = await Promise.all([
      this.prisma.serviceRecord.count({ where }),
      this.prisma.serviceRecord.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.alertSettings(user.tenantId),
      this.origemAds.names(user.tenantId),
      this.hours(user.tenantId),
    ])
    return { total, page, pageSize, alertHours, items: rows.map((r) => ({ ...this.view(r, alertHours, hours), adsLabel: recordAdsLabel(names, r) })) }
  }

  /** Repassado antes disto e ainda sem retorno: passou do prazo (contado no horário comercial). */
  private overdueLimit(alertHours: number, hours: BusinessHours | null, now = new Date()) {
    return hours ? subBusinessMs(hours, now, alertHours * 3_600_000) : new Date(now.getTime() - alertHours * 3_600_000)
  }

  private view(r: Prisma.ServiceRecordGetPayload<object>, alertHours: number, hours: BusinessHours | null = null) {
    const { tenantId: _t, externalKey: _e, deletedAt: _d, ...rest } = r
    return { ...rest, saleValue: r.saleValue === null ? null : Number(r.saleValue), region: regionOf(r.state), overdue: isOverdue(r, alertHours, undefined, hours), followOverdue: isFollowOverdue(r), callOverdue: isCallOverdue(r) }
  }

  private async load(user: AuthUser, id: string) {
    const record = await this.prisma.serviceRecord.findFirst({ where: { id, tenantId: user.tenantId, deletedAt: null } })
    if (!record) throw new NotFoundException('Atendimento não encontrado.')
    // Escopo "somente os próprios": registro de outro vendedor aparece como inexistente (sem revelar que existe).
    const scoped = await this.prisma.serviceRecord.count({ where: { id, ...this.scope(user, record.kind) } })
    if (!scoped) throw new NotFoundException('Atendimento não encontrado.')
    return record
  }

  async get(user: AuthUser, id: string) {
    const r = await this.load(user, id)
    this.assertCan(user, r.kind, 'view')
    const [{ alertHours }, hours] = await Promise.all([this.alertSettings(user.tenantId), this.hours(user.tenantId)])
    // Ligação pré-venda <-> pós-venda, para a ficha mostrar o outro lado.
    const [parent, children] = await Promise.all([
      r.parentId ? this.prisma.serviceRecord.findFirst({ where: { id: r.parentId, deletedAt: null }, select: { id: true, sellerId: true, leadAt: true, saleStatus: true } }) : null,
      this.prisma.serviceRecord.findMany({ where: { parentId: r.id, deletedAt: null }, select: { id: true, sellerId: true, followStatus: true, followNote: true, dueAt: true, firstActionAt: true } }),
    ])
    return { ...this.view(r, alertHours, hours), parent, children, googleAds: await this.googleAdsOf(r) }
  }

  /**
   * O atendimento veio de anúncio do Google? Pelo anúncio mais recente até o contato (campanha) ou pela origem com "Google"
   * no nome. Traz também a primeira campanha do lead (de onde ele veio originalmente), para os atendimentos seguintes.
   */
  private async googleAdsOf(r: { id: string; tenantId: string; leadId: string | null; updatedAt: Date; adsCheckedAt: Date | null }) {
    const own = await this.origemAds.freshRecord(r.tenantId, r)
    const [names, lead] = await Promise.all([
      this.origemAds.names(r.tenantId),
      r.leadId ? this.prisma.lead.findUnique({ where: { id: r.leadId }, select: { adsFirstCampaignId: true, adsFirstCampaign: true, adsFirstAt: true } }) : null,
    ])
    const first = lead && (lead.adsFirstAt || lead.adsFirstCampaignId || lead.adsFirstCampaign)
      ? { campaignId: lead.adsFirstCampaignId, label: adsName(names, lead.adsFirstCampaignId, lead.adsFirstCampaign) ?? 'campanha não identificada', at: lead.adsFirstAt }
      : null
    if (own?.adsVia === 'ANUNCIO') {
      return { campaignId: own.adsCampaignId, campaign: (own.adsCampaignId && names[own.adsCampaignId]) || own.adsCampaign, label: adsName(names, own.adsCampaignId, own.adsCampaign) ?? 'campanha não identificada', at: own.adsTouchAt, page: own.entryPage, channel: own.entryChannel, byOrigin: false, first }
    }
    if (own?.adsVia === 'ORIGEM') return { campaignId: null, campaign: null, label: first ? `origem do atendimento (o lead veio antes pela campanha ${first.label})` : 'campanha não identificada (pela origem do atendimento)', at: null, page: own.entryPage, channel: own.entryChannel, byOrigin: true, first }
    return own?.entryPage || own?.entryChannel ? { campaignId: null, campaign: null, label: '', at: null, page: own.entryPage, channel: own.entryChannel, byOrigin: false, first, notAds: true } : null
  }

  async history(user: AuthUser, id: string) {
    const r = await this.load(user, id)
    this.assertCan(user, r.kind, 'view')
    const rows = await this.prisma.serviceRecordHistory.findMany({ where: { recordId: id }, orderBy: { createdAt: 'desc' }, take: 200 })
    return rows.map((h) => ({ ...h, labels: FIELD_LABELS }))
  }

  /** Confere se os ids de listas e vendedor pertencem ao tenant (evita IDOR por id de outra empresa). */
  private async assertRefs(tenantId: string, d: RecordInput) {
    const lookupIds = [d.originId, d.customerTypeId, d.lostReasonId, ...(d.brandIds ?? []), ...(d.partTypeIds ?? [])].filter((x): x is string => !!x)
    if (lookupIds.length) {
      const found = await this.prisma.lookupItem.count({ where: { tenantId, id: { in: [...new Set(lookupIds)] } } })
      if (found !== new Set(lookupIds).size) throw new BadRequestException('Item de lista inválido.')
    }
    if (d.sellerId && !(await this.prisma.seller.count({ where: { tenantId, id: d.sellerId } }))) throw new BadRequestException('Vendedor inválido.')
    if (d.unitId && !(await this.prisma.unit.count({ where: { tenantId, id: d.unitId } }))) throw new BadRequestException('Unidade inválida.')
  }

  /**
   * Regras de escopo na gravação:
   * - "próprios": o vendedor é sempre o do próprio usuário;
   * - "unidade": a unidade é sempre a do usuário, e só vendedores dessa unidade podem receber o atendimento;
   * - sem unidade informada, o atendimento herda a unidade do vendedor.
   */
  private async applyScopeOnWrite(user: AuthUser, kind: ServiceKind, d: RecordInput, current: { sellerId: string | null; unitId: string | null } | null) {
    const scope = this.scopeOf(user, kind)
    if (scope === 'OWN') {
      if (current) {
        if (d.sellerId !== undefined && d.sellerId !== current.sellerId) throw new ForbiddenException('Seu perfil não permite transferir o atendimento para outro vendedor.')
        if (d.unitId !== undefined && d.unitId !== current.unitId) throw new ForbiddenException('Seu perfil não permite trocar a unidade do atendimento.')
        return
      }
      const own = await this.prisma.seller.findUnique({ where: { userId: user.id } })
      if (!own) throw new ForbiddenException('Seu usuário não está vinculado a um vendedor. Peça ao administrador.')
      d.sellerId = own.id
      d.unitId = own.unitId
      return
    }

    const sellerChanged = d.sellerId !== undefined && d.sellerId !== (current?.sellerId ?? null)
    if (d.unitId === undefined && sellerChanged) {
      const unit = await this.sellerUnit(user.tenantId, d.sellerId)
      if (unit || !current) d.unitId = unit
    }

    if (scope === 'UNIT') {
      if (!user.unitId) throw new ForbiddenException('Seu usuário não está vinculado a uma unidade. Peça ao administrador.')
      if (d.unitId !== undefined && d.unitId !== user.unitId) throw new ForbiddenException('Seu perfil só permite atendimentos da sua unidade.')
      if (!current) d.unitId = user.unitId
      if (sellerChanged && d.sellerId) {
        const unit = await this.sellerUnit(user.tenantId, d.sellerId)
        if (unit !== user.unitId) throw new ForbiddenException('Escolha um vendedor da sua unidade.')
      }
    }
  }

  private normalize(d: RecordInput) {
    // O DTO validado traz todos os campos declarados, inclusive os não enviados (como undefined).
    // Só os enviados podem entrar: senão uma edição parcial "apagaria" NF, valor e demais campos.
    const out: Record<string, unknown> = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined))
    if (d.leadAt !== undefined) {
      const date = new Date(d.leadAt)
      if (Number.isNaN(date.getTime())) throw new BadRequestException('Data do lead inválida.')
      out.leadAt = date
    }
    if (d.name !== undefined) out.name = d.name.trim()
    if (d.phone !== undefined) {
      const phone = d.phone ? normalizePhone(d.phone) : null
      if (d.phone && !phone) throw new BadRequestException('Telefone inválido. Use DDD + número, ex.: (47) 99647-0159.')
      out.phone = phone
    }
    if (d.email !== undefined) out.email = d.email?.trim().toLowerCase() || null
    if (d.callDueAt !== undefined) {
      const date = d.callDueAt ? new Date(d.callDueAt) : null
      if (date && Number.isNaN(date.getTime())) throw new BadRequestException('Data para chamar o cliente inválida.')
      out.callDueAt = date
    }
    if (d.state !== undefined) out.state = d.state ? d.state.toUpperCase() : null
    for (const k of ['customerCode', 'city', 'invoiceNumber', 'notes', 'followNote'] as const) if (d[k] !== undefined) out[k] = d[k]?.trim() || null
    return out
  }

  async create(user: AuthUser, d: RecordInput & { kind: ServiceKind; name: string }, ctx: RequestCtx) {
    this.assertCan(user, d.kind, 'create')
    await this.assertRefs(user.tenantId, d)
    await this.applyScopeOnWrite(user, d.kind, d, null)
    const base = this.normalize(d)
    const state = applyAutomaticFields(
      {
        ...(base as object),
        forwarded: d.forwarded ?? false,
        returnStatus: d.returnStatus ?? null,
        saleStatus: d.saleStatus ?? 'NEGOCIACAO',
        lostReasonId: d.lostReasonId ?? null,
        invoiceNumber: (base.invoiceNumber as string | null) ?? null,
        saleValue: d.saleValue ?? null,
      } as RecordState & Record<string, unknown>,
      null,
    )
    const problem = validateRecord(state)
    if (problem) throw new BadRequestException(problem)
    const hours = await this.hours(user.tenantId)
    const callDueAt = nextCallDue({ ...state, kind: d.kind }, null, callHoursOf(await this.alertSettings(user.tenantId)), base.callDueAt as Date | null | undefined, undefined, hours)

    const record = await this.prisma.serviceRecord.create({
      data: {
        ...(state as unknown as Prisma.ServiceRecordUncheckedCreateInput),
        callDueAt,
        ...(state.saleStatus !== 'NEGOCIACAO' ? { resultAt: new Date() } : {}),
        tenantId: user.tenantId,
        kind: d.kind,
        leadAt: (base.leadAt as Date | undefined) ?? new Date(),
        name: d.name.trim(),
        brandIds: d.brandIds ?? [],
        partTypeIds: d.partTypeIds ?? [],
        createdById: user.id,
        updatedById: user.id,
        ...(d.kind === 'PRE_VENDAS' ? { firstActionAt: new Date() } : {}),
        ...(d.kind === 'POS_VENDAS' ? await this.followStart(user.tenantId) : {}),
        history: { create: { userId: user.id, userName: user.name, action: 'criado', changes: {} } },
      },
    })
    await this.audit.byUser(user, ctx, 'atendimento.created', 'service_record', record.id, { kind: d.kind })
    await this.leadSync.syncRecord(record)
    const postSale = await this.afterResult(user, record, null, ctx)
    const { alertHours } = await this.alertSettings(user.tenantId)
    return { ...this.view(record, alertHours, hours), postSale }
  }

  async update(user: AuthUser, id: string, d: RecordInput, ctx: RequestCtx) {
    const current = await this.load(user, id)
    this.assertCan(user, current.kind, 'edit')
    if (d.kind && d.kind !== current.kind) this.assertCan(user, d.kind, 'edit')
    await this.assertRefs(user.tenantId, d)
    await this.applyScopeOnWrite(user, current.kind, d, current)

    const base = this.normalize(d)
    const prev = { ...current, saleValue: current.saleValue === null ? null : Number(current.saleValue) }
    const next = applyAutomaticFields({ ...prev, ...base } as typeof prev, prev)
    const problem = validateRecord(next) ?? (current.kind === 'POS_VENDAS' ? validateFollow(current.followStatus, next.followStatus, base.followNote as string | undefined) : null)
    if (problem) throw new BadRequestException(problem)
    if (current.kind !== 'POS_VENDAS') {
      next.followStatus = current.followStatus
      next.followNote = current.followNote
    }
    const hours = await this.hours(user.tenantId)
    next.callDueAt = nextCallDue(next, current, callHoursOf(await this.alertSettings(user.tenantId)), base.callDueAt as Date | null | undefined, undefined, hours)

    const changes = diffRecord(prev, next)
    if (Object.keys(changes).length === 0) {
      const { alertHours } = await this.alertSettings(user.tenantId)
      return this.view(current, alertHours, hours)
    }
    const data: Record<string, unknown> = {}
    for (const k of Object.keys(changes)) data[k] = (next as Record<string, unknown>)[k]
    for (const k of ['forwardedAt', 'returnedAt'] as const) data[k] = next[k]
    // Resultado novo (ou de volta para negociação): a sequência de "chamar de novo" recomeça a contar dele.
    if (changes.saleStatus) Object.assign(data, { resultAt: next.saleStatus === 'NEGOCIACAO' ? null : new Date(), reactivationStep: 0, reactivationAt: null, reactivationStatus: null })
    // Primeiro contato do pós-venda: é o que conta para o prazo.
    if (changes.followStatus && next.followStatus !== 'PENDENTE' && !current.firstActionAt) data.firstActionAt = new Date()
    // Pré-venda: a primeira alteração de uma pessoa tira o "aguardando atendimento".
    if (current.kind === 'PRE_VENDAS' && !current.firstActionAt) data.firstActionAt = new Date()

    const record = await this.prisma.serviceRecord.update({
      where: { id },
      data: {
        ...(data as Prisma.ServiceRecordUncheckedUpdateInput),
        updatedById: user.id,
        history: { create: { userId: user.id, userName: user.name, action: 'alterado', changes: changes as Prisma.InputJsonValue } },
      },
    })
    await this.audit.byUser(user, ctx, 'atendimento.updated', 'service_record', id, { campos: Object.keys(changes) })
    await this.leadSync.syncRecord(record, { saleStatus: current.saleStatus })
    const postSale = await this.afterResult(user, record, current.saleStatus, ctx)
    const { alertHours } = await this.alertSettings(user.tenantId)
    return { ...this.view(record, alertHours, hours), postSale }
  }

  /**
   * Pré-venda que passou a ter resultado. O pós-venda não é mais gerado sozinho (decisão de 28/10/2026): só vai para o
   * pós-venda quem for enviado pela lista. Venda perdida por um motivo que não gera pós-venda (ex.: não temos o
   * produto): o atendimento no chat é finalizado (sem mensagem para o cliente).
   * Devolve o que aconteceu: ENCERRADO (chat finalizado pelo motivo) ou null (nada).
   */
  private async afterResult(user: AuthUser, record: Prisma.ServiceRecordGetPayload<object>, prevSale: Prisma.ServiceRecordGetPayload<object>['saleStatus'] | null, ctx: RequestCtx) {
    if (!shouldCreatePostSale(record.kind, prevSale, record.saleStatus)) return null
    const skip = record.saleStatus === 'NAO' && !!record.lostReasonId && (await this.noPostSaleReasons(user.tenantId)).includes(record.lostReasonId)
    if (!skip) return null
    const reason = await this.prisma.lookupItem.findUnique({ where: { id: record.lostReasonId! }, select: { name: true } })
    const why = reason?.name ?? 'motivo da perda'
    await this.prisma.serviceRecordHistory.create({ data: { recordId: record.id, userId: user.id, userName: user.name, action: `encerrado sem pós-venda (${why})`, changes: {} } })
    const conversas = await this.closeChats(user, [record.id], `pré-venda sem venda (${why}), sem pós-venda`)
    await this.audit.byUser(user, ctx, 'atendimento.closed_without_post_sale', 'service_record', record.id, { motivo: reason?.name ?? null, conversas })
    return 'ENCERRADO' as const
  }

  /** Finaliza as conversas abertas dos atendimentos (vão para as finalizadas; nada é enviado ao cliente). */
  private async closeChats(user: AuthUser, recordIds: string[], why: string) {
    if (!recordIds.length) return 0
    const convs = await this.prisma.whatsappConversation.findMany({ where: { tenantId: user.tenantId, recordId: { in: recordIds }, status: 'ABERTA' }, select: { id: true } })
    const now = new Date()
    for (const c of convs) {
      await this.prisma.whatsappConversation.update({
        where: { id: c.id },
        data: { status: 'ARQUIVADA', assignedUserId: null, sectorId: null, helperUserIds: [], botFlowId: null, botState: Prisma.DbNull, unread: 0, noReplyNeeded: true, closedAt: now, closedByName: user.name.slice(0, 120) },
      })
      await this.prisma.whatsappMessage.create({
        data: { tenantId: user.tenantId, conversationId: c.id, waId: `nota:${randomUUID()}`, fromMe: true, type: 'nota', text: `Atendimento finalizado por ${user.name}: ${why}.`, internal: true, sentById: user.id, sentByName: user.name.slice(0, 120), status: 'NOTA', sentAt: now },
      })
    }
    return convs.length
  }

  /**
   * Fecha atendimentos em massa. Pré-venda: fica fechada (sem prazo para chamar o cliente, sem gerar pós-venda).
   * Pós-venda: fica Resolvido. Nos dois, as conversas abertas do cliente são finalizadas.
   */
  async close(user: AuthUser, ids: string[], ctx: RequestCtx) {
    const records = await this.prisma.serviceRecord.findMany({ where: { id: { in: ids }, tenantId: user.tenantId, deletedAt: null, closedAt: null } })
    for (const r of records) {
      this.assertCan(user, r.kind, 'edit')
      if (!(await this.prisma.serviceRecord.count({ where: { id: r.id, ...this.scope(user, r.kind) } }))) throw new ForbiddenException('Seu perfil não permite fechar atendimentos de outros vendedores.')
    }
    const now = new Date()
    const note = `Fechado em massa por ${user.name}.`
    await this.prisma.$transaction(
      records.map((r) => {
        const post = r.kind === 'POS_VENDAS'
        const changes: Record<string, { de: unknown; para: unknown }> = { closedAt: { de: null, para: now } }
        if (post && r.followStatus !== 'RESOLVIDO') changes.followStatus = { de: r.followStatus, para: 'RESOLVIDO' }
        return this.prisma.serviceRecord.update({
          where: { id: r.id },
          data: {
            closedAt: now,
            callDueAt: null,
            updatedById: user.id,
            ...(post ? { followStatus: 'RESOLVIDO' as const, followNote: r.followNote?.trim() ? r.followNote : note } : {}),
            ...(r.firstActionAt ? {} : { firstActionAt: now }),
            history: { create: { userId: user.id, userName: user.name, action: post ? 'pós-venda fechado' : 'pré-venda fechada', changes: changes as Prisma.InputJsonValue } },
          },
        })
      }),
    )
    // A conversa pode estar ligada ao pós-venda ou à pré-venda que o originou.
    const chatIds = [...new Set(records.flatMap((r) => (r.kind === 'POS_VENDAS' && r.parentId ? [r.id, r.parentId] : [r.id])))]
    const conversas = await this.closeChats(user, chatIds, 'atendimento fechado')
    await this.audit.byUser(user, ctx, 'atendimento.closed', 'service_record', undefined, { quantidade: records.length, conversas })
    return { closed: records.length, chats: conversas }
  }

  /** Situação inicial e prazo de um pós-venda novo. */
  private async followStart(tenantId: string) {
    const [{ postSaleHours }, hours] = await Promise.all([this.alertSettings(tenantId), this.hours(tenantId)])
    return { followStatus: 'PENDENTE' as const, dueAt: deadline(new Date(), postSaleHours, hours) }
  }

  /**
   * Pós-venda de uma pré-venda enviada pela lista, para outra pessoa acompanhar, com os dados do cliente e o resultado
   * copiados e prazo para o primeiro contato. Já tendo pós-venda, não gera outro (devolve false).
   */
  private async createPostSale(user: AuthUser, pre: Prisma.ServiceRecordGetPayload<object>, ctx: RequestCtx) {
    if (await this.prisma.serviceRecord.count({ where: { parentId: pre.id, deletedAt: null } })) return false
    const s = await this.alertSettings(user.tenantId)
    const ownerId = (pre.unitId ? s.postSaleOwnerByUnit[pre.unitId] : undefined) ?? s.postSaleOwnerId ?? null
    const owner = ownerId ? await this.prisma.seller.findFirst({ where: { id: ownerId, tenantId: user.tenantId, active: true }, select: { id: true } }) : null
    const preSeller = pre.sellerId ? await this.prisma.seller.findUnique({ where: { id: pre.sellerId }, select: { name: true } }) : null
    const post = await this.prisma.serviceRecord.create({
      data: {
        tenantId: user.tenantId,
        kind: 'POS_VENDAS',
        parentId: pre.id,
        leadAt: new Date(),
        name: pre.name,
        customerCode: pre.customerCode,
        phone: pre.phone,
        email: pre.email,
        sellerId: owner?.id ?? null,
        unitId: pre.unitId,
        leadId: pre.leadId,
        originId: pre.originId,
        customerTypeId: pre.customerTypeId,
        country: pre.country,
        state: pre.state,
        city: pre.city,
        brandIds: pre.brandIds,
        partTypeIds: pre.partTypeIds,
        saleStatus: pre.saleStatus,
        lostReasonId: pre.lostReasonId,
        invoiceNumber: pre.invoiceNumber,
        saleValue: pre.saleValue,
        notes: `Enviado da pré-venda${preSeller ? ` de ${preSeller.name}` : ''} (${pre.saleStatus === 'SIM' ? 'venda realizada' : pre.saleStatus === 'NAO' ? 'venda não realizada' : 'em negociação'}).`,
        followStatus: 'PENDENTE',
        dueAt: deadline(new Date(), s.postSaleHours, await this.hours(user.tenantId)),
        createdById: user.id,
        updatedById: user.id,
        history: { create: { userId: user.id, userName: user.name, action: 'criado automaticamente', changes: { parentId: { de: null, para: pre.id } } } },
      },
    })
    await this.audit.byUser(user, ctx, 'atendimento.post_sale_created', 'service_record', post.id, { preVenda: pre.id, responsavel: owner?.id ?? null })
    return true
  }

  /**
   * Resumo de um dia por vendedor: pré-vendas repassadas a ele naquele dia (data do repasse), com nome e telefone,
   * as mensagens prontas para colar no WhatsApp dele e se o envio automático já saiu.
   */
  async sellerDigest(user: AuthUser, day: string) {
    this.assertCan(user, 'PRE_VENDAS', 'view')
    const from = dayStart(day)
    const rows = await this.prisma.serviceRecord.findMany({
      where: { tenantId: user.tenantId, kind: 'PRE_VENDAS', deletedAt: null, forwarded: true, sellerId: { not: null }, forwardedAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) }, ...this.scope(user, 'PRE_VENDAS') },
      orderBy: { forwardedAt: 'asc' },
      select: { id: true, name: true, phone: true, forwardedAt: true, saleStatus: true, lostReason: { select: { name: true } }, seller: { select: { id: true, name: true, phone: true } } },
    })
    const [config, log] = await Promise.all([
      this.alertSettings(user.tenantId).then((s) => cleanDigest(s.sellerDigest)),
      this.settings.get<{ day?: string; sellers?: Record<string, string> }>(user.tenantId, 'seller_digest_log', {}),
    ])
    const bySeller = new Map<string, { seller: { id: string; name: string; phone: string | null }; items: typeof rows }>()
    for (const r of rows) {
      const g = bySeller.get(r.seller!.id) ?? { seller: r.seller!, items: [] }
      g.items.push(r)
      bySeller.set(r.seller!.id, g)
    }
    const sellers = [...bySeller.values()]
      .sort((a, b) => a.seller.name.localeCompare(b.seller.name, 'pt-BR'))
      .map((g) => ({
        sellerId: g.seller.id,
        seller: g.seller.name,
        sellerPhone: g.seller.phone ? (normalizePhone(g.seller.phone) ?? g.seller.phone) : null,
        items: g.items.map((r) => ({ id: r.id, name: r.name, phone: r.phone, forwardedAt: r.forwardedAt, saleStatus: r.saleStatus, situation: saleSituation(r.saleStatus, r.lostReason?.name) })),
        messages: digestMessages(config.text, g.seller.name, day, g.items.map((r) => ({ ...r, situation: saleSituation(r.saleStatus, r.lostReason?.name) })), config.split),
        status: log.day === day ? (log.sellers?.[g.seller.id] ?? null) : null,
        automatic: digestFor(config, g.seller.id),
      }))
    return { day, today: todayWindow(config.time).day, config: { enabled: config.enabled, time: config.time, split: config.split, allSellers: config.allSellers }, total: rows.length, sellers }
  }

  /** "Chamei o cliente": registra o contato e o prazo recomeça (agora + prazo configurado). */
  async markCalled(user: AuthUser, id: string, ctx: RequestCtx) {
    const current = await this.load(user, id)
    this.assertCan(user, current.kind, 'edit')
    if (!inNegotiation(current)) throw new BadRequestException('Só pré-vendas repassadas ao vendedor e ainda em negociação têm prazo para chamar o cliente.')
    const settings = await this.alertSettings(user.tenantId)
    const now = new Date()
    const hours = await this.hours(user.tenantId)
    const callDueAt = deadline(now, callHoursOf(settings), hours)
    const record = await this.prisma.serviceRecord.update({
      where: { id },
      data: {
        calledAt: now,
        callDueAt,
        updatedById: user.id,
        ...(current.firstActionAt ? {} : { firstActionAt: now }),
        history: { create: { userId: user.id, userName: user.name, action: 'chamou o cliente sobre', changes: { callDueAt: { de: current.callDueAt, para: callDueAt } } } },
      },
    })
    await this.audit.byUser(user, ctx, 'atendimento.client_called', 'service_record', id, {})
    return this.view(record, settings.alertHours, hours)
  }

  /** Exclusão lógica: some das telas e relatórios, mas continua no banco e na auditoria. */
  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    const current = await this.load(user, id)
    this.assertCan(user, current.kind, 'delete')
    await this.prisma.serviceRecord.update({
      where: { id },
      data: { deletedAt: new Date(), history: { create: { userId: user.id, userName: user.name, action: 'excluído', changes: {} } } },
    })
    await this.audit.byUser(user, ctx, 'atendimento.deleted', 'service_record', id, { nome: current.name })
  }

  /**
   * Pré-Vendas → Pós-Vendas: gera o pós-venda de cada pré-venda (responsável e prazo do primeiro contato, como era o
   * automático); a pré-venda fica onde está, com o resultado. Pós → Pré: muda o registro de lugar (ex.: histórico
   * importado sem separação).
   */
  async move(user: AuthUser, ids: string[], kind: ServiceKind, ctx: RequestCtx) {
    const records = await this.prisma.serviceRecord.findMany({ where: { id: { in: ids }, tenantId: user.tenantId, deletedAt: null } })
    for (const r of records) {
      this.assertCan(user, r.kind, 'edit')
      if (this.scopeOf(user, r.kind) === 'OWN') throw new ForbiddenException('Seu perfil não permite mover atendimentos.')
    }
    this.assertCan(user, kind, 'edit')
    if (kind === 'POS_VENDAS') {
      let created = 0
      for (const r of records.filter((x) => x.kind === 'PRE_VENDAS')) if (await this.createPostSale(user, r, ctx)) created++
      return { moved: created }
    }
    const toMove = records.filter((r) => r.kind !== kind)
    await this.prisma.$transaction(
      toMove.map((r) =>
        this.prisma.serviceRecord.update({
          where: { id: r.id },
          data: { kind, updatedById: user.id, history: { create: { userId: user.id, userName: user.name, action: 'alterado', changes: { kind: { de: r.kind, para: kind } } } } },
        }),
      ),
    )
    await this.audit.byUser(user, ctx, 'atendimento.moved', 'service_record', undefined, { para: kind, quantidade: toMove.length })
    return { moved: toMove.length }
  }

  async alerts(user: AuthUser) {
    const [{ alertHours, newRecordMinutes = 10 }, hours] = await Promise.all([this.alertSettings(user.tenantId), this.hours(user.tenantId)])
    const limit = this.overdueLimit(alertHours, hours)
    // Pré-vendas novas (para o aviso na tela) e as que passaram do prazo sem ninguém atender.
    let fresh: { id: string; name: string; leadAt: Date; createdAt: Date; origin: string | null; channel: string | null }[] = []
    let waiting = 0
    const overdueList: { id: string; name: string; forwardedAt: Date | null; seller: string | null; sellerPhone: string | null }[] = []
    let callDue = 0
    let callList: { id: string; name: string; phone: string | null; callDueAt: Date | null; seller: string | null }[] = []
    if (can(user.permissions, user.role.isSystem, 'pre_vendas', 'view')) {
      const scope = this.scope(user, 'PRE_VENDAS')
      const base = { tenantId: user.tenantId, deletedAt: null, ...this.waitingWhere(Date.now()), ...scope }
      const callWhere = { tenantId: user.tenantId, deletedAt: null, ...this.callDueWhere(new Date()), ...scope }
      const [calls, callCount] = await Promise.all([
        this.prisma.serviceRecord.findMany({ where: callWhere, orderBy: { callDueAt: 'asc' }, take: 5, select: { id: true, name: true, phone: true, callDueAt: true, seller: { select: { name: true } } } }),
        this.prisma.serviceRecord.count({ where: callWhere }),
      ])
      callDue = callCount
      callList = calls.map((c) => ({ id: c.id, name: c.name, phone: c.phone, callDueAt: c.callDueAt, seller: c.seller?.name ?? null }))
      const [rows, late, over] = await Promise.all([
        this.prisma.serviceRecord.findMany({ where: base, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, name: true, leadAt: true, createdAt: true, entryChannel: true, origin: { select: { name: true } } } }),
        this.prisma.serviceRecord.count({ where: { ...base, createdAt: { gte: new Date(Date.now() - WAITING_WINDOW_MS), lt: new Date(Date.now() - newRecordMinutes * 60_000) } } }),
        this.prisma.serviceRecord.findMany({
          where: { tenantId: user.tenantId, kind: 'PRE_VENDAS', deletedAt: null, forwarded: true, returnStatus: 'PENDENTE', forwardedAt: { lt: limit }, ...scope },
          orderBy: { forwardedAt: 'asc' },
          take: 5,
          select: { id: true, name: true, forwardedAt: true, seller: { select: { name: true, phone: true } } },
        }),
      ])
      fresh = rows.map((r) => ({ id: r.id, name: r.name, leadAt: r.leadAt, createdAt: r.createdAt, origin: r.origin?.name ?? null, channel: r.entryChannel }))
      waiting = late
      for (const o of over) overdueList.push({ id: o.id, name: o.name, forwardedAt: o.forwardedAt, seller: o.seller?.name ?? null, sellerPhone: o.seller?.phone ?? null })
    }
    const result: { kind: ServiceKind; overdue: number }[] = []
    for (const kind of ['PRE_VENDAS', 'POS_VENDAS'] as ServiceKind[]) {
      if (!can(user.permissions, user.role.isSystem, MODULE_BY_KIND[kind], 'view')) continue
      const overdue = await this.prisma.serviceRecord.count({
        where: { tenantId: user.tenantId, kind, deletedAt: null, forwarded: true, returnStatus: 'PENDENTE', forwardedAt: { lt: limit }, ...this.scope(user, kind) },
      })
      result.push({ kind, overdue })
    }
    // Pós-venda: sem contato dentro do prazo; e casos devolvidos ao vendedor da pré-venda (aparecem para ele).
    let followOverdue = 0
    let returnedToMe = 0
    if (can(user.permissions, user.role.isSystem, 'pos_vendas', 'view')) {
      followOverdue = await this.prisma.serviceRecord.count({
        where: { tenantId: user.tenantId, kind: 'POS_VENDAS', deletedAt: null, followStatus: 'PENDENTE', dueAt: { lt: new Date() }, ...this.scope(user, 'POS_VENDAS') },
      })
    }
    if (can(user.permissions, user.role.isSystem, 'pre_vendas', 'view')) {
      returnedToMe = await this.prisma.serviceRecord.count({
        where: { tenantId: user.tenantId, kind: 'POS_VENDAS', deletedAt: null, followStatus: 'VOLTOU_AO_VENDEDOR', parent: { seller: { userId: user.id } } },
      })
    }
    const settings = await this.alertSettings(user.tenantId)
    return {
      alertHours,
      callHours: callHoursOf(settings),
      callDue,
      callList,
      newRecordMinutes,
      postSaleHours: settings.postSaleHours,
      items: result,
      followOverdue,
      returnedToMe,
      waiting,
      fresh,
      overdueList,
      total: result.reduce((s, r) => s + r.overdue, 0) + followOverdue + returnedToMe + waiting + callDue,
    }
  }

  private async rows(where: Prisma.ServiceRecordWhereInput): Promise<DashRow[]> {
    const rows = await this.prisma.serviceRecord.findMany({
      where,
      select: {
        leadAt: true,
        sellerId: true,
        unitId: true,
        originId: true,
        customerTypeId: true,
        state: true,
        country: true,
        brandIds: true,
        partTypeIds: true,
        forwarded: true,
        forwardedAt: true,
        returnStatus: true,
        returnedAt: true,
        saleStatus: true,
        lostReasonId: true,
        saleValue: true,
        adsVia: true,
        leadId: true,
        phone: true,
      },
    })
    return rows.map((r) => ({ ...r, saleValue: r.saleValue === null ? null : Number(r.saleValue) }))
  }

  async dashboard(user: AuthUser, f: RecordFilters) {
    this.assertCan(user, f.kind, 'view')
    if (!f.from || !f.to) throw new BadRequestException('Informe o período (de/até).')
    const days = Math.round((dayStart(f.to).getTime() - dayStart(f.from).getTime()) / 86_400_000) + 1
    if (days < 1 || days > 1100) throw new BadRequestException('Período inválido (máximo de 3 anos).')
    const prevTo = new Date(dayStart(f.from).getTime() - 86_400_000).toISOString().slice(0, 10)
    const prevFrom = new Date(dayStart(f.from).getTime() - days * 86_400_000).toISOString().slice(0, 10)
    const [current, previous, { alertHours }, hours] = await Promise.all([
      this.rows(await this.where(user, f)),
      this.rows(await this.where(user, { ...f, from: prevFrom, to: prevTo })),
      this.alertSettings(user.tenantId),
      this.hours(user.tenantId),
    ])
    return {
      period: { from: f.from, to: f.to, days },
      previousPeriod: { from: prevFrom, to: prevTo },
      ...buildDashboard(current, previous, { from: f.from, to: f.to, alertHours, hours }),
      regions: REGIONS,
    }
  }

  async exportRows(user: AuthUser, f: RecordFilters) {
    this.assertCan(user, f.kind, 'export')
    const where = await this.where(user, f)
    const total = await this.prisma.serviceRecord.count({ where })
    if (total > 50_000) throw new BadRequestException('Muitos registros para exportar de uma vez (máximo 50.000). Use os filtros.')
    const [rows, lookups, sellers] = await Promise.all([
      this.prisma.serviceRecord.findMany({ where, orderBy: { leadAt: 'desc' } }),
      this.prisma.lookupItem.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
      this.prisma.seller.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
    ])
    const [units, adsNames] = await Promise.all([this.prisma.unit.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }), this.origemAds.names(user.tenantId)])
    return { rows: rows.map((r) => ({ ...r, adsLabel: recordAdsLabel(adsNames, r) })), names: new Map([...lookups, ...sellers, ...units].map((x) => [x.id, x.name])) }
  }
}

/** Texto curto da campanha do Google Ads do atendimento, para listas e exportação. */
export function recordAdsLabel(names: Record<string, string>, r: { adsVia: string | null; adsCampaignId: string | null; adsCampaign: string | null }) {
  if (r.adsVia === 'ANUNCIO') return adsName(names, r.adsCampaignId, r.adsCampaign) ?? 'campanha não identificada'
  if (r.adsVia === 'ORIGEM') return 'campanha não identificada (pela origem do atendimento)'
  return null
}
