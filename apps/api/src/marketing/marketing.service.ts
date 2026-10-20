import { BadRequestException, Injectable } from '@nestjs/common'
import { regionOf } from '../atendimento/br'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { attributeSales, type Click, type Sale } from '../email/painel'
import { Prisma } from '../generated/prisma/client'
import { DEFAULT_GOOGLE_ADS, type GoogleAdsSettings } from '../googleads/googleads'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { ATTRIBUTION_MODELS, attribute, type AttributionModel, campaignKey, type Channel, CHANNEL_KEYS, CHANNELS, isChannel, type Touch, type TouchLike, WINDOWS } from './canais'
import { FORMULAS, rate, round2, variation } from './formulas'
import {
  attentionPoints,
  biggestDrop,
  breakdown,
  channelLabel,
  costFollowsFilters,
  costKey,
  type CostRow,
  type Ctx,
  type Dataset,
  dedupeOrders,
  DEFAULT_CONFIG,
  filterCosts,
  filterOrders,
  type Filters,
  filterRows,
  funnel,
  hasCrmOnlyFilter,
  type MarketingConfig,
  QUALIFIED_RULES,
  type QualifiedRule,
  type Row,
  type StoreOrder,
  summarize,
  summarizePeriod,
  timings,
  buildKpis,
} from './motor'
import { bucketOf, bucketOfDay, bucketsOf, dayInPeriod, inPeriod, makePeriod, parseGranularity, previousPeriod } from './periodo'

const CONFIG_KEY = 'marketing'
const DAY = 86_400_000
const toNum = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const toDate = (v: unknown) => (v ? new Date(v as string) : null)

export type Query = Record<string, string | undefined>

interface Names {
  sellers: Map<string, string>
  units: Map<string, string>
  lookups: Map<string, string>
  campaigns: Map<string, string>
}

/**
 * Marketing Inteligente. Só LÊ as tabelas do CRM (atendimentos, leads, pedidos, e-mails, rastreamento e custos do Google Ads):
 * nada do sistema atual é alterado. A única coisa gravada são as regras do próprio módulo (tenant_settings "marketing").
 */
@Injectable()
export class MarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Regras do módulo ----------

  async config(tenantId: string): Promise<MarketingConfig> {
    const c = await this.settings.get<MarketingConfig>(tenantId, CONFIG_KEY, DEFAULT_CONFIG)
    return {
      model: c.model in ATTRIBUTION_MODELS ? c.model : DEFAULT_CONFIG.model,
      windowDays: (WINDOWS as readonly number[]).includes(c.windowDays) ? c.windowDays : DEFAULT_CONFIG.windowDays,
      qualifiedRule: c.qualifiedRule in QUALIFIED_RULES ? c.qualifiedRule : DEFAULT_CONFIG.qualifiedRule,
    }
  }

  async configView(tenantId: string) {
    return {
      config: await this.config(tenantId),
      models: ATTRIBUTION_MODELS,
      windows: WINDOWS,
      qualifiedRules: QUALIFIED_RULES,
      formulas: FORMULAS,
    }
  }

  async saveConfig(user: AuthUser, input: { model: AttributionModel; windowDays: number; qualifiedRule: QualifiedRule }, ctx: RequestCtx) {
    if (!(input.model in ATTRIBUTION_MODELS)) throw new BadRequestException('Modelo de atribuição inválido.')
    if (!(WINDOWS as readonly number[]).includes(input.windowDays)) throw new BadRequestException('Janela de atribuição inválida.')
    if (!(input.qualifiedRule in QUALIFIED_RULES)) throw new BadRequestException('Regra de lead qualificado inválida.')
    const before = await this.config(user.tenantId)
    const next: MarketingConfig = { model: input.model, windowDays: input.windowDays, qualifiedRule: input.qualifiedRule }
    await this.settings.set(user.tenantId, CONFIG_KEY, next)
    await this.audit.byUser(user, ctx, 'marketing.regras_alteradas', 'settings', CONFIG_KEY, { antes: before, depois: next })
    return this.configView(user.tenantId)
  }

  // ---------- Leitura dos dados ----------

  private scopeOf(user: AuthUser): Scope {
    if (user.role.isSystem) return 'ALL'
    return user.permissions.mkt_paineis?.scope ?? 'ALL'
  }

  /** Mesmo recorte do Pré-Vendas: próprios (vendedor ligado ao usuário) ou da unidade. */
  private scopeSql(user: AuthUser) {
    const s = this.scopeOf(user)
    if (s === 'OWN') return Prisma.sql`AND r."sellerId" IN (SELECT id FROM sellers WHERE "userId" = ${user.id}::uuid)`
    if (s === 'UNIT') return user.unitId ? Prisma.sql`AND r."unitId" = ${user.unitId}::uuid` : Prisma.sql`AND false`
    return Prisma.empty
  }

  private async names(tenantId: string): Promise<Names> {
    const [sellers, units, lookups, ads] = await Promise.all([
      this.prisma.seller.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.unit.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.lookupItem.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.settings.get<GoogleAdsSettings>(tenantId, 'google_ads', DEFAULT_GOOGLE_ADS),
    ])
    return {
      sellers: new Map(sellers.map((x) => [x.id, x.name])),
      units: new Map(units.map((x) => [x.id, x.name])),
      lookups: new Map(lookups.map((x) => [x.id, x.name])),
      campaigns: new Map(Object.entries(ads.campaigns ?? {}).map(([id, name]) => [`google_ads|id:${id}`, name])),
    }
  }

  /** Toques (origem) de cada lead: visitas do site, conversões (formulário, WhatsApp, Lead Ads) e 1ª/última conversão. */
  private async touchesOf(leadIds: string[]) {
    const out = new Map<string, Touch[]>()
    if (!leadIds.length) return out
    const push = (leadId: string | null, t: unknown, at: Date | null) => {
      if (!leadId || !t || typeof t !== 'object') return
      const list = out.get(leadId)
      if (list) list.push({ t: t as TouchLike, at })
      else out.set(leadId, [{ t: t as TouchLike, at }])
    }
    const [visitors, captures, leads] = await Promise.all([
      this.prisma.siteVisitor.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true, firstTouch: true, firstSeenAt: true, lastTouch: true, lastSeenAt: true } }),
      this.prisma.captureSubmission.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true, touch: true, createdAt: true } }),
      this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, firstConversion: true, firstConversionAt: true, lastConversion: true, lastConversionAt: true } }),
    ])
    for (const v of visitors) {
      push(v.leadId, v.firstTouch, v.firstSeenAt)
      push(v.leadId, v.lastTouch, v.lastSeenAt)
    }
    for (const c of captures) push(c.leadId, c.touch, c.createdAt)
    for (const l of leads) {
      push(l.id, l.firstConversion, l.firstConversionAt)
      push(l.id, l.lastConversion, l.lastConversionAt)
    }
    return out
  }

  /**
   * Tudo o que o período (e o anterior equivalente) precisa, sem filtros: atendimentos com lead OU venda no intervalo,
   * pedidos pagos da loja e investimento por dia e campanha.
   */
  private async load(user: AuthUser, from: Date, to: Date, fromDay: string, toDay: string, cfg: MarketingConfig) {
    const T = user.tenantId
    const scopeAll = this.scopeOf(user) === 'ALL'
    const [records, orders, costs, synced] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT r.id, r."leadId", r.phone, r."leadAt", r."sellerId", r."unitId", r."originId", r."customerTypeId", r.state, r.country,
          r."brandIds", r."partTypeIds", r.forwarded, r."forwardedAt", r."returnStatus", r."returnedAt", r."saleStatus", r."saleValue",
          r."lostReasonId", r."firstActionAt", r."calledAt", r."importBatch", r."externalKey", r."adsVia", r."adsCampaignId", r."adsCampaign", r."adsTerm",
          l.stage AS "leadStage", s.at AS "saleAt",
          (r."leadId" IS NOT NULL AND (
            EXISTS (SELECT 1 FROM service_records p WHERE p."leadId" = r."leadId" AND p.id <> r.id AND p."deletedAt" IS NULL AND p."saleStatus" = 'SIM' AND p."leadAt" < r."leadAt")
            OR EXISTS (SELECT 1 FROM ecommerce_orders o WHERE o."leadId" = r."leadId" AND o."statusGroup" = 'pago' AND o."orderedAt" < r."leadAt" - interval '3 days')
          )) AS recurring
        FROM service_records r
        LEFT JOIN leads l ON l.id = r."leadId"
        LEFT JOIN LATERAL (
          SELECT max(h."createdAt") AS at FROM service_record_history h
          WHERE h."recordId" = r.id AND r."saleStatus" = 'SIM' AND h.changes -> 'saleStatus' ->> 'para' = 'SIM'
        ) s ON true
        WHERE r."tenantId" = ${T}::uuid AND r.kind = 'PRE_VENDAS' AND r."deletedAt" IS NULL ${this.scopeSql(user)}
          AND ((r."leadAt" >= ${from} AND r."leadAt" < ${to})
            OR (r."saleStatus" = 'SIM' AND coalesce(s.at, r."leadAt") >= ${from} AND coalesce(s.at, r."leadAt") < ${to}))`,
      // Pedidos da loja e investimento não têm vendedor nem unidade: só entram com acesso a todos os dados.
      scopeAll
        ? this.prisma.$queryRaw<{ id: string; leadId: string | null; at: Date; total: unknown; state: string | null; recurring: boolean }[]>`
          SELECT o.id, o."leadId", o."orderedAt" AS at, o.total, l.state,
            EXISTS (SELECT 1 FROM ecommerce_orders p WHERE p."leadId" = o."leadId" AND o."leadId" IS NOT NULL AND p.id <> o.id AND p."statusGroup" = 'pago' AND p."orderedAt" < o."orderedAt") AS recurring
          FROM ecommerce_orders o LEFT JOIN leads l ON l.id = o."leadId"
          WHERE o."tenantId" = ${T}::uuid AND o."statusGroup" = 'pago' AND o."orderedAt" >= ${from} AND o."orderedAt" < ${to}`
        : Promise.resolve([]),
      scopeAll
        ? this.prisma.$queryRaw<{ day: string; campaignId: string; name: string; cost: unknown; clicks: unknown; impressions: unknown; conversions: unknown }[]>`
          SELECT to_char(date, 'YYYY-MM-DD') AS day, "campaignId", "campaignName" AS name, cost, clicks, impressions, conversions
          FROM google_ads_campaign_days WHERE "tenantId" = ${T}::uuid AND date BETWEEN ${fromDay}::date AND ${toDay}::date`
        : Promise.resolve([]),
      this.settings.get<{ syncedAt?: string }>(T, 'google_ads_custos', {}),
    ])

    const leadIds = [...new Set([...records.map((r) => r.leadId as string | null), ...orders.map((o) => o.leadId)].filter((x): x is string => !!x))]
    const touches = await this.touchesOf(leadIds)

    const rows: Row[] = records.map((r) => {
      const leadAt = new Date(r.leadAt as string)
      const saleAt = toDate(r.saleAt)
      const imported = !!r.importBatch || !!r.externalKey
      const contacts = [toDate(r.firstActionAt), toDate(r.forwardedAt), toDate(r.calledAt)].filter((d): d is Date => !!d)
      const state = (r.country as string) !== 'BR' ? 'EX' : ((r.state as string | null) ?? null)
      return {
        id: r.id as string,
        contactKey: (r.leadId as string | null) ?? (r.phone as string | null) ?? `r:${r.id as string}`,
        leadId: (r.leadId as string | null) ?? null,
        leadAt,
        saleAt: r.saleStatus === 'SIM' ? (saleAt ?? leadAt) : null,
        saleAtEstimated: r.saleStatus === 'SIM' && !saleAt,
        sellerId: (r.sellerId as string | null) ?? null,
        unitId: (r.unitId as string | null) ?? null,
        originId: (r.originId as string | null) ?? null,
        customerTypeId: (r.customerTypeId as string | null) ?? null,
        state,
        region: state === 'EX' ? 'Exterior' : regionOf(state),
        brandIds: (r.brandIds as string[] | null) ?? [],
        partTypeIds: (r.partTypeIds as string[] | null) ?? [],
        forwarded: !!r.forwarded,
        returnStatus: (r.returnStatus as Row['returnStatus']) ?? null,
        returnedAt: toDate(r.returnedAt),
        saleStatus: r.saleStatus as Row['saleStatus'],
        saleValue: r.saleValue === null || r.saleValue === undefined ? null : Number(r.saleValue),
        lostReasonId: (r.lostReasonId as string | null) ?? null,
        firstContactAt: imported || !contacts.length ? null : new Date(Math.min(...contacts.map((d) => d.getTime()))),
        imported,
        leadStage: (r.leadStage as Row['leadStage']) ?? null,
        recurring: !!r.recurring,
        attribution: attribute(
          { adsVia: r.adsVia as string | null, adsCampaignId: r.adsCampaignId as string | null, adsCampaign: r.adsCampaign as string | null, adsTerm: r.adsTerm as string | null },
          touches.get((r.leadId as string) ?? '') ?? [],
          leadAt,
          cfg.model,
          cfg.windowDays,
        ),
      }
    })

    const storeOrders: StoreOrder[] = dedupeOrders(
      orders.map((o) => ({
        id: o.id,
        leadId: o.leadId,
        at: new Date(o.at),
        value: toNum(o.total),
        recurring: !!o.recurring,
        state: o.state,
        region: regionOf(o.state),
        attribution: attribute({ adsVia: null, adsCampaignId: null, adsCampaign: null, adsTerm: null }, touches.get(o.leadId ?? '') ?? [], new Date(o.at), cfg.model, cfg.windowDays),
      })),
      rows,
    )

    const costRows: CostRow[] = costs.map((c) => ({
      day: c.day,
      channel: 'google_ads',
      campaignId: c.campaignId,
      campaignName: c.name,
      cost: toNum(c.cost),
      impressions: toNum(c.impressions),
      clicks: toNum(c.clicks),
      conversions: toNum(c.conversions),
    }))
    // Mídia "conectada" = tem custo chegando (não depende do período).
    const costChannels = new Set<Channel>()
    if (scopeAll && (costRows.length || synced.syncedAt)) costChannels.add('google_ads')
    return { data: { rows, orders: storeOrders, costs: costRows } as Dataset, costChannels, costSyncedAt: synced.syncedAt ?? null, scopeAll }
  }

  /** Período, período anterior, filtros e os dados já filtrados. */
  private async prepare(user: AuthUser, q: Query) {
    const p = makePeriod(q.de, q.ate)
    const prev = previousPeriod(p)
    const g = parseGranularity(q.agrupar, p.days)
    const f = parseFilters(q)
    const cfg = await this.config(user.tenantId)
    const [{ data, costChannels, costSyncedAt, scopeAll }, names] = await Promise.all([this.load(user, prev.start, p.end, prev.from, p.to, cfg), this.names(user.tenantId)])
    for (const c of data.costs) if (!names.campaigns.has(costKey(c))) names.campaigns.set(costKey(c), c.campaignName)
    const filtered: Dataset = { rows: filterRows(data.rows, f), orders: filterOrders(data.orders, f), costs: filterCosts(data.costs, f) }
    const ctx: Ctx = { rule: cfg.qualifiedRule, costChannels }
    const notes = this.notes(f, cfg, scopeAll, costChannels)
    const meta = {
      period: { from: p.from, to: p.to, days: p.days },
      previousPeriod: { from: prev.from, to: prev.to },
      granularity: g,
      filters: f,
      attribution: { model: cfg.model, modelLabel: ATTRIBUTION_MODELS[cfg.model], windowDays: cfg.windowDays, qualifiedRule: QUALIFIED_RULES[cfg.qualifiedRule] },
      costFollowsFilters: costFollowsFilters(f),
      storeIncluded: scopeAll && !hasCrmOnlyFilter(f),
      scopeAll,
      updatedAt: { googleAdsCost: costSyncedAt, generatedAt: new Date().toISOString() },
      notes,
    }
    return { p, prev, g, f, cfg, all: data, data: filtered, ctx, names, meta, costSyncedAt }
  }

  private notes(f: Filters, cfg: MarketingConfig, scopeAll: boolean, costChannels: Set<Channel>) {
    const n: string[] = []
    if (!costChannels.size) n.push('Nenhuma mídia com investimento conectada: CPL, CAC e ROAS ficam indisponíveis.')
    else n.push('Investimento disponível só do Google Ads (script). Meta Ads e TikTok Ads entram na etapa de integrações.')
    if (!costFollowsFilters(f)) n.push('O investimento não acompanha filtros de marca, peça, estado, região, filial, vendedor, origem, tipo de cliente, situação ou cliente novo/recorrente (as plataformas não têm esses dados): CPL e ROAS consideram o investimento do canal/campanha inteiro.')
    if (hasCrmOnlyFilter(f)) n.push('Com filtros que só existem no atendimento, os pedidos da loja virtual ficam de fora.')
    if (!scopeAll) n.push('Seu perfil vê só parte dos atendimentos: investimento e pedidos da loja não aparecem.')
    n.push(`Atribuição: ${ATTRIBUTION_MODELS[cfg.model].toLowerCase()}, janela de ${cfg.windowDays} dias. Lead qualificado: ${QUALIFIED_RULES[cfg.qualifiedRule].toLowerCase()}.`)
    n.push('ROI indisponível: depende da margem de contribuição e dos custos fora de mídia (etapa de Planejamento e Orçamento).')
    return n
  }

  // ---------- Telas ----------

  async options(user: AuthUser) {
    const T = user.tenantId
    const [sellers, units, lookups] = await Promise.all([
      this.prisma.seller.findMany({ where: { tenantId: T }, select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.unit.findMany({ where: { tenantId: T }, select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.lookupItem.findMany({ where: { tenantId: T }, select: { id: true, name: true, type: true, active: true }, orderBy: { name: 'asc' } }),
    ])
    const of = (type: string) => lookups.filter((l) => l.type === type).map(({ id, name, active }) => ({ id, name, active }))
    return {
      channels: CHANNEL_KEYS.map((id) => ({ id, name: CHANNELS[id].label, paid: CHANNELS[id].paid })),
      sellers,
      units,
      brands: of('MARCA'),
      partTypes: of('TIPO_PECA'),
      origins: of('ORIGEM'),
      customerTypes: of('TIPO_CLIENTE'),
    }
  }

  private label(names: Names, dim: string, key: string) {
    if (key === '-' || key === 'none') return dim === 'campanha' ? 'Sem campanha identificada' : 'Não informado'
    if (key === '__loja') return 'Loja virtual (pedidos)'
    if (dim === 'canal') return channelLabel(key)
    if (dim === 'vendedor') return names.sellers.get(key) ?? 'Vendedor removido'
    if (dim === 'filial') return names.units.get(key) ?? 'Unidade removida'
    if (dim === 'marca' || dim === 'peca' || dim === 'origem' || dim === 'tipoCliente') return names.lookups.get(key) ?? 'Item removido'
    if (dim === 'uf') return key === 'EX' ? 'Exterior' : key
    return key
  }

  private campaignName(names: Names, key: string, rows: Row[]) {
    const known = names.campaigns.get(key)
    if (known) return known
    const r = rows.find((x) => campaignKey(x.attribution) === key)
    if (r?.attribution.campaign) return r.attribution.campaign
    const [, rest] = key.split('|')
    if (rest?.startsWith('id:')) return `campanha nº ${rest.slice(3)}`
    return rest === '-' ? 'Sem campanha identificada' : (rest?.slice(5) ?? key)
  }

  private dim(prep: Awaited<ReturnType<MarketingService['prepare']>>, dim: Dimension, limit = 50) {
    const { data, ctx, p, names } = prep
    const spec = DIMENSIONS[dim]
    const rows = breakdown(data, ctx, p, spec.row, spec.order, spec.cost, spec.costApplies ? (k) => spec.costApplies!(k, ctx.costChannels) : undefined)
    return rows.slice(0, limit).map((r) => ({
      ...r,
      label: dim === 'campanha' ? (r.key === '__loja' ? 'Loja virtual (sem campanha)' : this.campaignName(names, r.key, data.rows)) : this.label(names, dim, r.key),
      channel: dim === 'campanha' ? r.key.split('|')[0] : dim === 'canal' ? r.key : undefined,
    }))
  }

  async overview(user: AuthUser, q: Query) {
    const prep = await this.prepare(user, q)
    const { data, ctx, p, prev, g, meta } = prep
    const { kpis, buckets, now, before } = buildKpis(data, ctx, p, prev, g)
    const channels = this.dim(prep, 'canal')
    const campaigns = this.dim(prep, 'campanha', 500)
    const health = await this.health(user)
    const attention = attentionPoints(now, before, ctx, {
      campaignsWithoutLeads: campaigns.filter((c) => (c.cost ?? 0) >= 100 && c.leads === 0).map((c) => ({ name: c.label, cost: c.cost ?? 0 })),
      identifiedShare: health.quality.identifiedShare,
      costStaleHours: prep.costSyncedAt ? (Date.now() - Date.parse(prep.costSyncedAt)) / 3_600_000 : null,
    })
    return { ...meta, kpis: kpis.filter((k) => ['investimento', 'leads', 'vendas', 'faturamento', 'cpl', 'roas', 'conversao', 'semAtendimento'].includes(k.id)), buckets, channels, attention, health: { sources: health.sources } }
  }

  async executive(user: AuthUser, q: Query) {
    const prep = await this.prepare(user, q)
    const { data, ctx, p, prev, g, meta } = prep
    const { kpis, buckets, now } = buildKpis(data, ctx, p, prev, g)
    const reasons: Record<string, string> = {}
    if (!ctx.costChannels.size) for (const id of ['investimento', 'cpl', 'cplQualificado', 'cac', 'roas']) reasons[id] = 'Nenhuma mídia com investimento conectada.'
    reasons.roi = 'Depende da margem de contribuição e dos custos fora de mídia (etapa de Planejamento e Orçamento).'
    return {
      ...meta,
      kpis: kpis.map((k) => ({ ...k, formula: FORMULAS[k.id as keyof typeof FORMULAS] ?? null, reason: k.value === null ? (reasons[k.id] ?? 'Sem base para o cálculo no período.') : null })),
      buckets,
      totals: { crmSales: now.crmSales, crmRevenue: now.crmRevenue, storeOrders: now.storeOrders, storeRevenue: now.storeRevenue, estimatedSaleDates: now.estimatedSaleDates, newCustomers: now.newCustomers, platformConversions: now.platformConversions, impressions: now.impressions, clicks: now.clicks },
      investmentByPlatform: (['google_ads', 'meta_ads', 'tiktok_ads'] as Channel[]).map((c) => ({ channel: c, label: CHANNELS[c].label, connected: ctx.costChannels.has(c), cost: ctx.costChannels.has(c) ? (now.costByChannel[c] ?? 0) : null })),
      byChannel: this.dim(prep, 'canal'),
      byCampaign: this.dim(prep, 'campanha', 15),
      bySeller: this.dim(prep, 'vendedor', 30),
      byState: this.dim(prep, 'uf', 30),
      byRegion: this.dim(prep, 'regiao'),
      byUnit: this.dim(prep, 'filial'),
      byBrand: this.dim(prep, 'marca', 20),
      byPartType: this.dim(prep, 'peca', 20),
    }
  }

  async leads(user: AuthUser, q: Query) {
    const prep = await this.prepare(user, q)
    const { data, ctx, p, prev, g, meta, names } = prep
    const now = summarizePeriod(data, ctx, p)
    const before = summarizePeriod(data, ctx, prev)
    const buckets = bucketsOf(p, g)
    const series = buckets.map((b) => {
      const s = summarize(data, ctx, (at) => inPeriod(at, p) && bucketOf(at, g) === b, (at) => inPeriod(at, p) && bucketOf(at, g) === b, () => false)
      return { bucket: b, leads: s.leads, attended: s.attended, qualified: s.qualified, opportunities: s.opportunities, sales: s.crmSales }
    })
    const cohort = data.rows.filter((r) => inPeriod(r.leadAt, p))
    const bySellerTiming = [...groupBy(cohort, (r) => r.sellerId ?? '-')].map(([key, list]) => ({ key, label: this.label(names, 'vendedor', key), leads: list.length, ...timings(list, p) }))
    const unattended = cohort
      .filter((r) => r.saleStatus === 'NEGOCIACAO' && !r.firstContactAt && !r.forwarded && r.returnStatus !== 'SIM' && !r.imported)
      .sort((a, b) => b.leadAt.getTime() - a.leadAt.getTime())
      .slice(0, 50)
      .map((r) => ({ id: r.id, leadAt: r.leadAt, seller: r.sellerId ? this.label(names, 'vendedor', r.sellerId) : null, state: r.state, channel: channelLabel(r.attribution.channel), campaign: r.attribution.campaign }))
    const identified = new Set(cohort.filter((r) => r.attribution.channel !== 'nao_identificado').map((r) => r.contactKey)).size
    return {
      ...meta,
      summary: {
        leads: now.leads,
        previousLeads: before.leads,
        leadsVariation: variation(now.leads, before.leads),
        attended: now.attended,
        unattended: now.unattended,
        qualified: now.qualified,
        opportunities: now.opportunities,
        converted: now.convertedLeads,
        attendedRate: rate(now.attended, now.leads),
        qualifiedRate: rate(now.qualified, now.leads),
        opportunityRate: rate(now.opportunities, now.leads),
        conversionRate: rate(now.convertedLeads, now.leads),
        identifiedShare: rate(identified, now.leads),
      },
      timings: timings(data.rows, p),
      series,
      byChannel: this.dim(prep, 'canal'),
      bySeller: this.dim(prep, 'vendedor', 50),
      bySellerTiming: bySellerTiming.sort((a, b) => b.leads - a.leads),
      byState: this.dim(prep, 'uf', 30),
      byRegion: this.dim(prep, 'regiao'),
      byOrigin: this.dim(prep, 'origem', 30),
      byCustomerType: this.dim(prep, 'tipoCliente', 20),
      unattended,
    }
  }

  async funnel(user: AuthUser, q: Query) {
    const prep = await this.prepare(user, q)
    const { data, ctx, p, prev, meta, f, names } = prep
    const dim: Dimension = q.comparar && q.comparar in DIMENSIONS ? (q.comparar as Dimension) : 'canal'
    const mediaOnly = !!f.channel && ctx.costChannels.has(f.channel) && costFollowsFilters(f)
    const now = summarizePeriod(data, ctx, p)
    const stages = funnel(now, mediaOnly)
    const spec = DIMENSIONS[dim]
    const groups = new Map<string, Dataset>()
    const get = (k: string) => groups.get(k) ?? (groups.set(k, { rows: [], orders: [], costs: [] }), groups.get(k)!)
    for (const r of data.rows) {
      const k = spec.row(r)
      for (const key of Array.isArray(k) ? (k.length ? k : ['-']) : [k]) get(key).rows.push(r)
    }
    if (spec.cost) for (const c of data.costs) get(spec.cost(c)).costs.push(c)
    const compare = [...groups]
      .map(([key, g]) => {
        const s = summarizePeriod(g, ctx, p)
        const media = !!spec.cost && !!spec.costApplies?.(key, ctx.costChannels)
        return { key, label: dim === 'campanha' ? this.campaignName(names, key, data.rows) : this.label(names, dim, key), stages: funnel(s, media), timings: timings(g.rows, p) }
      })
      .filter((x) => x.stages.find((s) => s.id === 'leads')!.value > 0)
      .sort((a, b) => b.stages.find((s) => s.id === 'leads')!.value - a.stages.find((s) => s.id === 'leads')!.value)
      .slice(0, 30)
    return { ...meta, compareBy: dim, mediaStages: mediaOnly, stages, previousStages: funnel(summarizePeriod(data, ctx, prev), mediaOnly), biggestDrop: biggestDrop(stages), timings: timings(data.rows, p), compare }
  }

  async campaigns(user: AuthUser, q: Query) {
    const prep = await this.prepare(user, q)
    return { ...prep.meta, campaigns: this.dim(prep, 'campanha', 1000) }
  }

  async campaign(user: AuthUser, key: string, q: Query) {
    if (!/^[a-z_]+\|(id:[\w-]{1,40}|nome:.{1,160}|-)$/.test(key) || !isChannel(key.split('|')[0])) throw new BadRequestException('Campanha inválida.')
    const prep = await this.prepare(user, { ...q, campanha: key })
    const { data, ctx, p, prev, g, meta, names } = prep
    const { kpis, buckets, now } = buildKpis(data, ctx, p, prev, g)
    const daily = bucketsOf(p, g).map((b) => {
      const s = summarize(data, ctx, (at) => inPeriod(at, p) && bucketOf(at, g) === b, (at) => inPeriod(at, p) && bucketOf(at, g) === b, (day) => dayInPeriod(day, p) && bucketOfDay(day, g) === b)
      return { bucket: b, cost: ctx.costChannels.has(key.split('|')[0] as Channel) ? s.cost : null, clicks: s.clicks, impressions: s.impressions, leads: s.leads, sales: s.sales, revenue: s.revenue }
    })
    // Campanhas parecidas: do mesmo canal, no mesmo período, para comparar.
    const all = this.dim({ ...prep, data: { rows: filterRows(prep.all.rows, { ...prep.f, campaign: undefined }), orders: [], costs: filterCosts(prep.all.costs, { ...prep.f, campaign: undefined }) } }, 'campanha', 1000)
    const similar = all.filter((c) => c.channel === key.split('|')[0] && c.key !== key).slice(0, 8)
    const records = data.rows
      .filter((r) => inPeriod(r.leadAt, p) || (r.saleAt && inPeriod(r.saleAt, p)))
      .sort((a, b) => b.leadAt.getTime() - a.leadAt.getTime())
      .slice(0, 200)
      .map((r) => ({ id: r.id, leadAt: r.leadAt, saleAt: r.saleAt, saleAtEstimated: r.saleAtEstimated, status: r.saleStatus, value: r.saleValue, seller: r.sellerId ? this.label(names, 'vendedor', r.sellerId) : null, state: r.state, ad: r.attribution.ad, term: r.attribution.term, how: r.attribution.how }))
    return {
      ...meta,
      key,
      channel: key.split('|')[0],
      channelLabel: channelLabel(key.split('|')[0]!),
      name: this.campaignName(names, key, prep.all.rows),
      kpis,
      buckets,
      totals: { impressions: now.impressions, clicks: now.clicks, platformConversions: now.platformConversions, cost: ctx.costChannels.has(key.split('|')[0] as Channel) ? now.cost : null },
      daily,
      byState: this.dim(prep, 'uf', 27),
      byBrand: this.dim(prep, 'marca', 15),
      byPartType: this.dim(prep, 'peca', 15),
      bySeller: this.dim(prep, 'vendedor', 20),
      similar,
      records,
    }
  }

  async compare(user: AuthUser, keys: string[], q: Query) {
    const list = [...new Set(keys)].filter((k) => /^[a-z_]+\|/.test(k)).slice(0, 6)
    if (list.length < 2) throw new BadRequestException('Escolha de 2 a 6 campanhas para comparar.')
    const prep = await this.prepare(user, q)
    const { p, prev, g, ctx, names, meta } = prep
    const items = list.map((key) => {
      const f = { ...prep.f, campaign: key }
      const d: Dataset = { rows: filterRows(prep.all.rows, f), orders: filterOrders(prep.all.orders, f), costs: filterCosts(prep.all.costs, f) }
      const { kpis, buckets } = buildKpis(d, ctx, p, prev, g)
      return { key, name: this.campaignName(names, key, prep.all.rows), channel: key.split('|')[0], channelLabel: channelLabel(key.split('|')[0]!), kpis, buckets }
    })
    return { ...meta, items }
  }

  async email(user: AuthUser, q: Query) {
    const prep = await this.prepare(user, q)
    const { p, prev, meta, all } = prep
    const T = user.tenantId
    const funnelSql = (s: Date, e: Date) => this.prisma.$queryRaw<{ id: string; name: string; subject: string; kind: string; first: Date | null; sent: bigint; failed: bigint; opened: bigint; clicked: bigint; unsubscribed: bigint }[]>`
      SELECT c.id, c.name, c.subject, c.kind, min(er."sentAt") AS first,
        count(*) FILTER (WHERE er.status = 'ENVIADO') AS sent, count(*) FILTER (WHERE er.status = 'ERRO') AS failed,
        count(er."openedAt") FILTER (WHERE er.status = 'ENVIADO') AS opened, count(er."clickedAt") FILTER (WHERE er.status = 'ENVIADO') AS clicked,
        count(er."unsubscribedAt") FILTER (WHERE er.status = 'ENVIADO') AS unsubscribed
      FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId"
      WHERE c."tenantId" = ${T}::uuid AND ((er.status = 'ENVIADO' AND er."sentAt" >= ${s} AND er."sentAt" < ${e}) OR (er.status = 'ERRO' AND er."failedAt" >= ${s} AND er."failedAt" < ${e}))
      GROUP BY c.id, c.name, c.subject, c.kind ORDER BY first DESC NULLS LAST LIMIT 200`
    const [rows, prevRows, clicks] = await Promise.all([
      funnelSql(p.start, p.end),
      funnelSql(prev.start, prev.end),
      this.prisma.$queryRaw<{ leadId: string; campaignId: string; at: Date }[]>`
        SELECT er."leadId", ec."campaignId", ec."createdAt" AS at FROM email_clicks ec
        JOIN email_recipients er ON er.id = ec."recipientId" JOIN email_campaigns c ON c.id = ec."campaignId"
        WHERE c."tenantId" = ${T}::uuid AND ec."createdAt" >= ${new Date(prev.start.getTime() - prep.cfg.windowDays * DAY)} AND ec."createdAt" < ${p.end}`,
    ])
    // Vendas da pessoa que clicou num e-mail nos N dias antes (último clique), com as mesmas vendas do módulo (CRM + loja sem duplicar).
    const sales: Sale[] = [
      ...all.rows.filter((r) => r.saleStatus === 'SIM' && r.leadId).map((r) => ({ id: r.id, leadId: r.leadId!, at: r.saleAt ?? r.leadAt, value: r.saleValue ?? 0, source: 'atendimento' as const })),
      ...all.orders.filter((o) => o.leadId).map((o) => ({ id: o.id, leadId: o.leadId!, at: o.at, value: o.value, source: 'loja' as const })),
    ]
    const attributed = attributeSales(clicks.map((c): Click => ({ leadId: c.leadId, campaignId: c.campaignId, automationId: null, at: new Date(c.at) })), sales, prep.cfg.windowDays)
    const inP = attributed.filter((a) => inPeriod(a.at, p))
    const inPrev = attributed.filter((a) => inPeriod(a.at, prev))
    const total = (list: typeof rows) => list.reduce((acc, r) => ({ sent: acc.sent + Number(r.sent), failed: acc.failed + Number(r.failed), opened: acc.opened + Number(r.opened), clicked: acc.clicked + Number(r.clicked), unsubscribed: acc.unsubscribed + Number(r.unsubscribed) }), { sent: 0, failed: 0, opened: 0, clicked: 0, unsubscribed: 0 })
    const withRates = (t: ReturnType<typeof total>, s: typeof inP) => ({ ...t, delivered: t.sent, attempted: t.sent + t.failed, deliveryRate: rate(t.sent, t.sent + t.failed), openRate: rate(t.opened, t.sent), clickRate: rate(t.clicked, t.sent), unsubscribeRate: rate(t.unsubscribed, t.sent), sales: s.length, revenue: round2(s.reduce((a, x) => a + x.value, 0)) })
    return {
      ...meta,
      openNote: FORMULAS.aberturaEmail,
      totals: withRates(total(rows), inP),
      previous: withRates(total(prevRows), inPrev),
      campaigns: rows.map((r) => {
        const s = inP.filter((a) => a.campaignId === r.id)
        return { id: r.id, name: r.name, subject: r.subject, kind: r.kind === 'MODELO' ? 'automacao' : 'campanha', firstSent: r.first, ...withRates(total([r]), s) }
      }),
    }
  }

  /** Saúde das fontes de dados e qualidade da ligação marketing → CRM. */
  async health(user: AuthUser) {
    const T = user.tenantId
    const since = new Date(Date.now() - 30 * DAY)
    const [costs, ga4, meta, magazord, lastView, lastEmail, lastMeta, conv, quality, dupPhones] = await Promise.all([
      this.settings.get<{ syncedAt?: string }>(T, 'google_ads_custos', {}),
      this.settings.get<{ enabled?: boolean; propertyId?: string; privateKeyEnc?: string | null }>(T, 'ga4', {}),
      this.settings.get<{ enabled?: boolean; pageTokenEnc?: string | null }>(T, 'meta_lead_ads', {}),
      this.settings.get<{ lastOkAt?: string | null; lastError?: string | null; lastRunAt?: string | null }>(T, 'magazord_state', {}),
      this.prisma.$queryRaw<{ at: Date | null }[]>`SELECT max("occurredAt") AS at FROM site_pageviews WHERE "tenantId" = ${T}::uuid AND "occurredAt" >= ${since}`,
      this.prisma.$queryRaw<{ at: Date | null }[]>`SELECT max(er."sentAt") AS at FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId" WHERE c."tenantId" = ${T}::uuid`,
      this.prisma.$queryRaw<{ at: Date | null }[]>`SELECT max("createdAt") AS at FROM integration_receipts WHERE "tenantId" = ${T}::uuid AND provider = 'meta_lead_ads'`,
      this.prisma.$queryRaw<{ errors: bigint; last: Date | null }[]>`SELECT count(*) FILTER (WHERE status = 'ERRO') AS errors, max("sentAt") AS last FROM google_ads_conversions WHERE "tenantId" = ${T}::uuid AND "createdAt" >= ${since}`,
      this.prisma.$queryRaw<{ total: bigint; adsCampaign: bigint; adsOrigin: bigint; withTouch: bigint; sales: bigint; salesNoValue: bigint; salesNoHistory: bigint; noState: bigint }[]>`
        SELECT count(*) AS total,
          count(*) FILTER (WHERE r."adsVia" = 'ANUNCIO') AS "adsCampaign",
          count(*) FILTER (WHERE r."adsVia" = 'ORIGEM') AS "adsOrigin",
          count(*) FILTER (WHERE r."adsVia" IS NULL AND (l."firstConversion" IS NOT NULL OR l."lastConversion" IS NOT NULL)) AS "withTouch",
          count(*) FILTER (WHERE r."saleStatus" = 'SIM') AS sales,
          count(*) FILTER (WHERE r."saleStatus" = 'SIM' AND r."saleValue" IS NULL) AS "salesNoValue",
          count(*) FILTER (WHERE r."saleStatus" = 'SIM' AND NOT EXISTS (SELECT 1 FROM service_record_history h WHERE h."recordId" = r.id AND h.changes -> 'saleStatus' ->> 'para' = 'SIM')) AS "salesNoHistory",
          count(*) FILTER (WHERE r.state IS NULL AND r.country = 'BR') AS "noState"
        FROM service_records r LEFT JOIN leads l ON l.id = r."leadId"
        WHERE r."tenantId" = ${T}::uuid AND r.kind = 'PRE_VENDAS' AND r."deletedAt" IS NULL AND r."leadAt" >= ${since} ${this.scopeSql(user)}`,
      this.prisma.$queryRaw<{ groups: bigint }[]>`
        SELECT count(*) AS groups FROM (SELECT phone FROM leads WHERE "tenantId" = ${T}::uuid AND "deletedAt" IS NULL AND phone IS NOT NULL GROUP BY phone HAVING count(*) > 1) x`,
    ])
    const ago = (iso: string | Date | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : null)
    const status = (hours: number | null, limit: number) => (hours === null ? 'nunca' : hours <= limit ? 'ok' : 'atrasado')
    const pending = 'Integração prevista para a etapa final, em Configurações.'
    const sources = [
      { id: 'google_ads_custo', name: 'Google Ads: investimento e campanhas (script)', status: status(ago(costs.syncedAt), 48), lastSync: costs.syncedAt ?? null, detail: costs.syncedAt ? 'Custo, cliques, impressões e conversões por dia e campanha.' : 'O script do Google Ads ainda não enviou dados (Configurações → Google Ads).' },
      { id: 'google_ads_conversoes', name: 'Google Ads: retorno das vendas (conversões off-line)', status: conv[0]?.last ? (Number(conv[0].errors) ? 'atencao' : 'ok') : 'nunca', lastSync: conv[0]?.last ?? null, detail: Number(conv[0]?.errors ?? 0) ? `${Number(conv[0]!.errors)} envio(s) com erro nos últimos 30 dias.` : 'Envio dos resultados do CRM para o Google Ads.' },
      { id: 'meta_lead_ads', name: 'Meta Lead Ads (leads dos formulários)', status: meta.enabled ? (lastMeta[0]?.at ? 'ok' : 'sem_dados') : 'desligado', lastSync: lastMeta[0]?.at ?? null, detail: meta.enabled ? 'Leads chegam pelo webhook do Meta.' : 'Desligado em Configurações → Meta.' },
      { id: 'site', name: 'Rastreamento do site', status: status(ago(lastView[0]?.at ?? null), 24), lastSync: lastView[0]?.at ?? null, detail: 'Visitas, UTMs e cliques de anúncio das páginas com o script do CRM.' },
      { id: 'magazord', name: 'Loja virtual (Magazord)', status: magazord.lastError ? 'atencao' : status(ago(magazord.lastOkAt), 2), lastSync: magazord.lastOkAt ?? null, detail: magazord.lastError ? `Último erro: ${magazord.lastError}` : 'Pedidos, carrinhos e clientes.' },
      { id: 'email', name: 'E-mail marketing', status: lastEmail[0]?.at ? 'ok' : 'sem_dados', lastSync: lastEmail[0]?.at ?? null, detail: 'Envios, aberturas registradas, cliques e descadastros (ferramenta do próprio CRM).' },
      { id: 'ga4', name: 'Google Analytics 4', status: ga4.enabled && ga4.propertyId && ga4.privateKeyEnc ? 'ok' : 'desligado', lastSync: null, detail: ga4.enabled ? 'Consultado na hora, em Relatórios. Entra no módulo na etapa de integrações.' : 'Desligado em Configurações → GA4.' },
      { id: 'meta_ads', name: 'Meta Ads: investimento, alcance e criativos', status: 'pendente', lastSync: null, detail: pending },
      { id: 'tiktok_ads', name: 'TikTok Ads', status: 'pendente', lastSync: null, detail: pending },
      { id: 'search_console', name: 'Google Search Console (SEO)', status: 'pendente', lastSync: null, detail: pending },
      { id: 'instagram', name: 'Instagram (orgânico)', status: 'pendente', lastSync: null, detail: pending },
      { id: 'facebook', name: 'Facebook (orgânico)', status: 'pendente', lastSync: null, detail: pending },
      { id: 'tiktok', name: 'TikTok (orgânico)', status: 'pendente', lastSync: null, detail: pending },
    ]
    const qr = quality[0]
    const n = (v: bigint | undefined) => Number(v ?? 0)
    const total = n(qr?.total)
    return {
      sources,
      quality: {
        windowDays: 30,
        records: total,
        identifiedShare: rate(n(qr?.adsCampaign) + n(qr?.adsOrigin) + n(qr?.withTouch), total),
        adsCampaign: n(qr?.adsCampaign),
        adsOriginOnly: n(qr?.adsOrigin),
        withTouch: n(qr?.withTouch),
        sales: n(qr?.sales),
        salesNoValue: n(qr?.salesNoValue),
        salesEstimatedDate: n(qr?.salesNoHistory),
        noState: n(qr?.noState),
        duplicatePhoneGroups: n(dupPhones[0]?.groups),
      },
    }
  }
}

// ---------- Dimensões das quebras ----------

type Dimension = 'canal' | 'campanha' | 'vendedor' | 'uf' | 'regiao' | 'filial' | 'marca' | 'peca' | 'origem' | 'tipoCliente'

const DIMENSIONS: Record<Dimension, { row: (r: Row) => string | string[]; order: ((o: StoreOrder) => string) | null; cost: ((c: CostRow) => string) | null; costApplies?: (key: string, channels: Set<Channel>) => boolean }> = {
  canal: { row: (r) => r.attribution.channel, order: (o) => o.attribution.channel, cost: (c) => c.channel, costApplies: (k, ch) => ch.has(k as Channel) },
  campanha: { row: (r) => campaignKey(r.attribution), order: (o) => campaignKey(o.attribution), cost: (c) => costKey(c), costApplies: (k, ch) => ch.has(k.split('|')[0] as Channel) },
  vendedor: { row: (r) => r.sellerId ?? '-', order: null, cost: null },
  uf: { row: (r) => r.state ?? '-', order: (o) => o.state ?? '-', cost: null },
  regiao: { row: (r) => r.region ?? '-', order: (o) => o.region ?? '-', cost: null },
  filial: { row: (r) => r.unitId ?? '-', order: null, cost: null },
  marca: { row: (r) => r.brandIds, order: null, cost: null },
  peca: { row: (r) => r.partTypeIds, order: null, cost: null },
  origem: { row: (r) => r.originId ?? '-', order: null, cost: null },
  tipoCliente: { row: (r) => r.customerTypeId ?? '-', order: null, cost: null },
}

function groupBy<T>(list: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>()
  for (const x of list) {
    const k = key(x)
    const l = m.get(k)
    if (l) l.push(x)
    else m.set(k, [x])
  }
  return m
}

const ID = /^[0-9a-f-]{36}$/
const UF = /^([A-Z]{2}|EX)$/

/** Filtros da URL (parâmetros em português, os mesmos da tela). Valores fora do formato são ignorados. */
export function parseFilters(q: Query): Filters {
  const id = (v: string | undefined) => (v && ID.test(v) ? v : undefined)
  const f: Filters = {
    channel: isChannel(q.canal) ? q.canal : undefined,
    campaign: q.campanha && q.campanha.length <= 200 && /^[a-z_]+\|/.test(q.campanha) ? q.campanha : undefined,
    brand: id(q.marca),
    partType: id(q.peca),
    state: q.uf && UF.test(q.uf) ? q.uf : undefined,
    region: q.regiao && ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul', 'Exterior'].includes(q.regiao) ? q.regiao : undefined,
    unit: id(q.filial),
    seller: id(q.vendedor),
    origin: id(q.origem),
    customerType: id(q.tipoCliente),
    status: q.status === 'SIM' || q.status === 'NAO' || q.status === 'NEGOCIACAO' ? q.status : undefined,
    client: q.cliente === 'novo' || q.cliente === 'recorrente' ? q.cliente : undefined,
  }
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Filters
}
