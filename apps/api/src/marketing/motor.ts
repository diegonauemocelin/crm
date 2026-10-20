/**
 * Marketing Inteligente: o motor de cálculo. Funções puras sobre as linhas já lidas do CRM (testadas em test/marketing.spec.ts).
 *
 * Regras de contagem (também na tela e no documento docs/PLANO_MARKETING_INTELIGENTE.md):
 * - Lead = pessoa diferente (lead da base, ou telefone, ou o próprio atendimento) com pré-venda no período, pela data do lead.
 * - Venda = atendimento com "Venda: Sim", pela data da venda (histórico); sem histórico, a data do lead ("data estimada").
 * - Pedido pago da loja virtual conta como venda só quando não é a mesma compra de uma venda do CRM
 *   (mesmo lead e até 3 dias de diferença). O CRM é a fonte de verdade: nesse caso fica a venda do CRM.
 * - Conversão da plataforma de anúncio nunca vira venda: fica em coluna própria.
 */
import { type AttributionModel, type Attribution, type Channel, campaignKey, CHANNELS } from './canais'
import { cac, costPerQualified, cpc, cpl, ctr, div, mean, median, rate, roas, roi, round2, ticket, trend, variation } from './formulas'
import { bucketOf, bucketOfDay, bucketsOf, dayInPeriod, type Granularity, inPeriod, type Period } from './periodo'

const DAY = 86_400_000
export const SAME_PURCHASE_DAYS = 3

export type QualifiedRule = 'estagio_ou_repasse' | 'estagio' | 'repasse'
export const QUALIFIED_RULES: Record<QualifiedRule, string> = {
  estagio_ou_repasse: 'Estágio do lead Qualificado ou acima, ou pré-venda repassada ao vendedor',
  estagio: 'Só o estágio do lead (Qualificado, Oportunidade ou Cliente)',
  repasse: 'Só a pré-venda repassada ao vendedor',
}

export interface MarketingConfig {
  model: AttributionModel
  windowDays: number
  qualifiedRule: QualifiedRule
}
export const DEFAULT_CONFIG: MarketingConfig = { model: 'ultimo', windowDays: 30, qualifiedRule: 'estagio_ou_repasse' }

type SaleStatus = 'SIM' | 'NAO' | 'NEGOCIACAO'

export interface Row {
  id: string
  /** Quem é a pessoa: lead da base, ou telefone, ou o próprio atendimento. */
  contactKey: string
  leadId: string | null
  leadAt: Date
  saleAt: Date | null
  saleAtEstimated: boolean
  sellerId: string | null
  unitId: string | null
  originId: string | null
  customerTypeId: string | null
  state: string | null
  region: string | null
  brandIds: string[]
  partTypeIds: string[]
  forwarded: boolean
  returnStatus: 'SIM' | 'NAO' | 'PENDENTE' | null
  returnedAt: Date | null
  saleStatus: SaleStatus
  saleValue: number | null
  lostReasonId: string | null
  /** Primeiro atendimento de uma pessoa (ação, repasse ou "chamei o cliente"). Nulo nos importados de planilha. */
  firstContactAt: Date | null
  imported: boolean
  leadStage: 'LEAD' | 'QUALIFICADO' | 'OPORTUNIDADE' | 'CLIENTE' | null
  /** A pessoa já tinha comprado antes (cliente recorrente). */
  recurring: boolean
  attribution: Attribution
}

export interface StoreOrder {
  id: string
  leadId: string | null
  at: Date
  value: number
  recurring: boolean
  state: string | null
  region: string | null
  attribution: Attribution
}

export interface CostRow {
  day: string
  channel: Channel
  campaignId: string
  campaignName: string
  cost: number
  impressions: number
  clicks: number
  conversions: number
}

export interface Filters {
  channel?: Channel
  campaign?: string
  brand?: string
  partType?: string
  state?: string
  region?: string
  unit?: string
  seller?: string
  origin?: string
  customerType?: string
  status?: SaleStatus
  client?: 'novo' | 'recorrente'
}

/** Filtros que só existem no atendimento do CRM: com eles, os pedidos da loja ficam de fora. */
const CRM_ONLY: (keyof Filters)[] = ['brand', 'partType', 'unit', 'seller', 'origin', 'customerType', 'status']
/** Filtros que o investimento em mídia acompanha (as plataformas não sabem vendedor, marca, estado...). */
const COST_FILTERS: (keyof Filters)[] = ['channel', 'campaign']

export const hasCrmOnlyFilter = (f: Filters) => CRM_ONLY.some((k) => !!f[k])
export const costFollowsFilters = (f: Filters) => !(Object.keys(f) as (keyof Filters)[]).some((k) => !!f[k] && !COST_FILTERS.includes(k))

export function filterRows(rows: Row[], f: Filters): Row[] {
  return rows.filter(
    (r) =>
      (!f.channel || r.attribution.channel === f.channel) &&
      (!f.campaign || campaignKey(r.attribution) === f.campaign) &&
      (!f.brand || r.brandIds.includes(f.brand)) &&
      (!f.partType || r.partTypeIds.includes(f.partType)) &&
      (!f.state || r.state === f.state) &&
      (!f.region || r.region === f.region) &&
      (!f.unit || r.unitId === f.unit) &&
      (!f.seller || r.sellerId === f.seller) &&
      (!f.origin || r.originId === f.origin) &&
      (!f.customerType || r.customerTypeId === f.customerType) &&
      (!f.status || r.saleStatus === f.status) &&
      (!f.client || (f.client === 'recorrente') === r.recurring),
  )
}

export function filterOrders(orders: StoreOrder[], f: Filters): StoreOrder[] {
  if (hasCrmOnlyFilter(f)) return []
  return orders.filter(
    (o) =>
      (!f.channel || o.attribution.channel === f.channel) &&
      (!f.campaign || campaignKey(o.attribution) === f.campaign) &&
      (!f.state || o.state === f.state) &&
      (!f.region || o.region === f.region) &&
      (!f.client || (f.client === 'recorrente') === o.recurring),
  )
}

export function filterCosts(costs: CostRow[], f: Filters): CostRow[] {
  return costs.filter((c) => (!f.channel || c.channel === f.channel) && (!f.campaign || costKey(c) === f.campaign))
}

export const costKey = (c: Pick<CostRow, 'channel' | 'campaignId'>) => `${c.channel}|id:${c.campaignId}`

/** Pedidos pagos que não são a mesma compra de uma venda do CRM (mesmo lead, até 3 dias). */
export function dedupeOrders(orders: StoreOrder[], rows: Row[]): StoreOrder[] {
  const salesByLead = new Map<string, number[]>()
  for (const r of rows) {
    if (r.saleStatus !== 'SIM' || !r.leadId) continue
    const at = (r.saleAt ?? r.leadAt).getTime()
    salesByLead.set(r.leadId, [...(salesByLead.get(r.leadId) ?? []), at])
  }
  return orders.filter((o) => !o.leadId || !(salesByLead.get(o.leadId) ?? []).some((at) => Math.abs(at - o.at.getTime()) <= SAME_PURCHASE_DAYS * DAY))
}

/** Etapas alcançadas por um atendimento. Venda implica oportunidade; oportunidade implica atendimento. */
export function stagesOf(r: Row, rule: QualifiedRule) {
  const sale = r.saleStatus === 'SIM'
  const opportunity = sale || r.returnStatus === 'SIM'
  const attended = opportunity || !!r.firstContactAt || r.forwarded || r.returnStatus === 'NAO' || r.saleStatus === 'NAO'
  const byStage = r.leadStage === 'QUALIFICADO' || r.leadStage === 'OPORTUNIDADE' || r.leadStage === 'CLIENTE'
  const base = rule === 'estagio' ? byStage : rule === 'repasse' ? r.forwarded : byStage || r.forwarded
  const qualified = base || opportunity
  return { attended, qualified, opportunity, sale, lostOpportunity: r.returnStatus === 'SIM' && r.saleStatus === 'NAO' }
}

export interface Summary {
  leads: number
  attended: number
  unattended: number
  qualified: number
  /** Atendidos e qualificados (etapa do funil, que é encaixada: cada etapa está dentro da anterior). */
  qualifiedAttended: number
  opportunities: number
  lostOpportunities: number
  /** Leads do período que compraram (em qualquer data). */
  convertedLeads: number
  /** Leads atribuídos a mídias com custo conhecido (base do CPL). */
  leadsPaid: number
  qualifiedPaid: number
  crmSales: number
  crmRevenue: number
  storeOrders: number
  storeRevenue: number
  sales: number
  revenue: number
  newCustomers: number
  newCustomersPaid: number
  paidSales: number
  paidRevenue: number
  estimatedSaleDates: number
  cost: number
  impressions: number
  clicks: number
  platformConversions: number
  costByChannel: Partial<Record<Channel, number>>
}

export interface Dataset {
  rows: Row[]
  orders: StoreOrder[]
  costs: CostRow[]
}

export interface Ctx {
  rule: QualifiedRule
  /** Mídias com custo conectado (hoje, só o Google Ads). Base do CPL, ROAS e CAC. */
  costChannels: Set<Channel>
}

/** Resumo de um recorte de tempo: leads pela data do lead, vendas pela data da venda, custo pelo dia. */
export function summarize(d: Dataset, ctx: Ctx, leadIn: (at: Date) => boolean, saleIn: (at: Date) => boolean, costIn: (day: string) => boolean): Summary {
  const contacts = new Map<string, { first: Row; attended: boolean; qualified: boolean; opportunity: boolean; sale: boolean; lost: boolean }>()
  for (const r of d.rows) {
    if (!leadIn(r.leadAt)) continue
    const { lostOpportunity, ...s } = stagesOf(r, ctx.rule)
    const c = contacts.get(r.contactKey)
    if (!c) contacts.set(r.contactKey, { first: r, ...s, lost: lostOpportunity })
    else {
      if (r.leadAt < c.first.leadAt) c.first = r
      c.attended ||= s.attended
      c.qualified ||= s.qualified
      c.opportunity ||= s.opportunity
      c.sale ||= s.sale
      c.lost ||= lostOpportunity
    }
  }
  const all = [...contacts.values()]
  const paid = (a: Attribution) => ctx.costChannels.has(a.channel)

  const crm = d.rows.filter((r) => r.saleStatus === 'SIM' && saleIn(r.saleAt ?? r.leadAt))
  const store = d.orders.filter((o) => saleIn(o.at))
  const value = (r: Row) => r.saleValue ?? 0
  const crmRevenue = round2(crm.reduce((s, r) => s + value(r), 0))
  const storeRevenue = round2(store.reduce((s, o) => s + o.value, 0))
  const newKeys = new Set([...crm.filter((r) => !r.recurring).map((r) => r.contactKey), ...store.filter((o) => !o.recurring).map((o) => o.leadId ?? `pedido:${o.id}`)])
  const newPaidKeys = new Set([
    ...crm.filter((r) => !r.recurring && paid(r.attribution)).map((r) => r.contactKey),
    ...store.filter((o) => !o.recurring && paid(o.attribution)).map((o) => o.leadId ?? `pedido:${o.id}`),
  ])
  const paidCrm = crm.filter((r) => paid(r.attribution))
  const paidStore = store.filter((o) => paid(o.attribution))

  const costs = d.costs.filter((c) => costIn(c.day))
  const costByChannel: Partial<Record<Channel, number>> = {}
  for (const c of costs) costByChannel[c.channel] = round2((costByChannel[c.channel] ?? 0) + c.cost)

  const attended = all.filter((c) => c.attended).length
  return {
    leads: all.length,
    attended,
    unattended: all.length - attended,
    qualified: all.filter((c) => c.qualified).length,
    qualifiedAttended: all.filter((c) => c.qualified && c.attended).length,
    opportunities: all.filter((c) => c.opportunity).length,
    // Oportunidade perdida: a pessoa teve oportunidade, perdeu ("Venda: Não") e não comprou em outro atendimento do período.
    lostOpportunities: all.filter((c) => c.opportunity && c.lost && !c.sale).length,
    convertedLeads: all.filter((c) => c.sale).length,
    leadsPaid: all.filter((c) => paid(c.first.attribution)).length,
    qualifiedPaid: all.filter((c) => c.qualified && paid(c.first.attribution)).length,
    crmSales: crm.length,
    crmRevenue,
    storeOrders: store.length,
    storeRevenue,
    sales: crm.length + store.length,
    revenue: round2(crmRevenue + storeRevenue),
    newCustomers: newKeys.size,
    newCustomersPaid: newPaidKeys.size,
    paidSales: paidCrm.length + paidStore.length,
    paidRevenue: round2(paidCrm.reduce((s, r) => s + value(r), 0) + paidStore.reduce((s, o) => s + o.value, 0)),
    estimatedSaleDates: crm.filter((r) => r.saleAtEstimated).length,
    cost: round2(costs.reduce((s, c) => s + c.cost, 0)),
    impressions: costs.reduce((s, c) => s + c.impressions, 0),
    clicks: costs.reduce((s, c) => s + c.clicks, 0),
    platformConversions: round2(costs.reduce((s, c) => s + c.conversions, 0)),
    costByChannel,
  }
}

export const summarizePeriod = (d: Dataset, ctx: Ctx, p: Period) =>
  summarize(d, ctx, (at) => inPeriod(at, p), (at) => inPeriod(at, p), (day) => dayInPeriod(day, p))

// ---------- Indicadores ----------

export type Unit = 'brl' | 'int' | 'pct' | 'x'
export const KPIS = [
  { id: 'investimento', label: 'Investimento em mídia', unit: 'brl', better: 'neutro' },
  { id: 'leads', label: 'Leads gerados', unit: 'int', better: 'up' },
  { id: 'qualificados', label: 'Leads qualificados', unit: 'int', better: 'up' },
  { id: 'oportunidades', label: 'Oportunidades', unit: 'int', better: 'up' },
  { id: 'vendas', label: 'Vendas', unit: 'int', better: 'up' },
  { id: 'faturamento', label: 'Faturamento', unit: 'brl', better: 'up' },
  { id: 'cpl', label: 'Custo por lead (CPL)', unit: 'brl', better: 'down' },
  { id: 'cplQualificado', label: 'Custo por lead qualificado', unit: 'brl', better: 'down' },
  { id: 'cac', label: 'CAC de mídia', unit: 'brl', better: 'down' },
  { id: 'conversao', label: 'Conversão de lead em venda', unit: 'pct', better: 'up' },
  { id: 'roas', label: 'ROAS de mídia', unit: 'x', better: 'up' },
  { id: 'roi', label: 'ROI de marketing', unit: 'pct', better: 'up' },
  { id: 'ticket', label: 'Ticket médio', unit: 'brl', better: 'up' },
  { id: 'atendidos', label: 'Leads atendidos', unit: 'pct', better: 'up' },
  { id: 'semAtendimento', label: 'Leads sem atendimento', unit: 'pct', better: 'down' },
  { id: 'perdidas', label: 'Oportunidades perdidas', unit: 'pct', better: 'down' },
] as const satisfies readonly { id: string; label: string; unit: Unit; better: 'up' | 'down' | 'neutro' }[]
export type KpiId = (typeof KPIS)[number]['id']

export function kpiValues(s: Summary, ctx: Ctx): Record<KpiId, number | null> {
  const hasCost = ctx.costChannels.size > 0
  return {
    investimento: hasCost ? s.cost : null,
    leads: s.leads,
    qualificados: s.qualified,
    oportunidades: s.opportunities,
    vendas: s.sales,
    faturamento: s.revenue,
    cpl: cpl(s.cost, s.leadsPaid),
    cplQualificado: costPerQualified(s.cost, s.qualifiedPaid),
    cac: cac(s.cost, s.newCustomersPaid),
    conversao: rate(s.convertedLeads, s.leads),
    roas: hasCost ? roas(s.paidRevenue, s.cost) : null,
    // Sem margem de contribuição e custos fora de mídia cadastrados, não há ROI (ver formulas.roi).
    roi: roi(null, s.cost),
    ticket: ticket(s.revenue, s.sales),
    atendidos: rate(s.attended, s.leads),
    semAtendimento: rate(s.unattended, s.leads),
    perdidas: rate(s.lostOpportunities, s.opportunities),
  }
}

export interface Kpi {
  id: KpiId
  label: string
  unit: Unit
  better: 'up' | 'down' | 'neutro'
  value: number | null
  previous: number | null
  variation: number | null
  trend: 'alta' | 'queda' | 'estavel' | null
  series: (number | null)[]
}

/** Indicadores com o período anterior, a variação, o histórico por grupo (dia, semana...) e a tendência. */
export function buildKpis(d: Dataset, ctx: Ctx, p: Period, prev: Period, g: Granularity): { kpis: Kpi[]; buckets: string[]; now: Summary; before: Summary } {
  const now = summarizePeriod(d, ctx, p)
  const before = summarizePeriod(d, ctx, prev)
  const buckets = bucketsOf(p, g)
  const perBucket = buckets.map((b) =>
    kpiValues(
      summarize(d, ctx, (at) => inPeriod(at, p) && bucketOf(at, g) === b, (at) => inPeriod(at, p) && bucketOf(at, g) === b, (day) => dayInPeriod(day, p) && bucketOfDay(day, g) === b),
      ctx,
    ),
  )
  const vNow = kpiValues(now, ctx)
  const vBefore = kpiValues(before, ctx)
  const kpis = KPIS.map((k) => {
    const series = perBucket.map((v) => v[k.id])
    return { ...k, value: vNow[k.id], previous: vBefore[k.id], variation: variation(vNow[k.id], vBefore[k.id]), trend: trend(series), series }
  })
  return { kpis, buckets, now, before }
}

// ---------- Quebras (por canal, campanha, vendedor, estado...) ----------

export interface BreakdownRow {
  key: string
  leads: number
  qualified: number
  attended: number
  opportunities: number
  sales: number
  revenue: number
  cost: number | null
  impressions: number | null
  clicks: number | null
  platformConversions: number | null
  cpl: number | null
  roas: number | null
  conversion: number | null
  ticket: number | null
  ctr: number | null
  cpc: number | null
}

/**
 * Quebra por uma dimensão. Um atendimento com várias marcas conta em cada marca (a soma das linhas passa do total).
 * `orderKey` nulo: pedidos da loja ficam numa linha própria ("__loja"). `costKeyOf` nulo: a dimensão não tem custo.
 */
export function breakdown(
  d: Dataset,
  ctx: Ctx,
  p: Period,
  rowKey: (r: Row) => string | string[],
  orderKey: ((o: StoreOrder) => string) | null,
  costKeyOf: ((c: CostRow) => string) | null,
  /** A linha tem custo conhecido? (ex.: o canal E-mail não tem; mostra "não disponível", não R$ 0). */
  costApplies: (key: string) => boolean = () => true,
): BreakdownRow[] {
  const groups = new Map<string, Dataset>()
  const get = (k: string) => {
    let g = groups.get(k)
    if (!g) groups.set(k, (g = { rows: [], orders: [], costs: [] }))
    return g
  }
  for (const r of d.rows) {
    const k = rowKey(r)
    for (const key of Array.isArray(k) ? (k.length ? k : ['-']) : [k]) get(key).rows.push(r)
  }
  for (const o of d.orders) get(orderKey ? orderKey(o) : '__loja').orders.push(o)
  if (costKeyOf) for (const c of d.costs) get(costKeyOf(c)).costs.push(c)
  const out: BreakdownRow[] = []
  for (const [key, g] of groups) {
    const s = summarizePeriod(g, ctx, p)
    if (!s.leads && !s.sales && !s.cost && !s.clicks) continue
    const withCost = !!costKeyOf && ctx.costChannels.size > 0 && costApplies(key)
    out.push({
      key,
      leads: s.leads,
      qualified: s.qualified,
      attended: s.attended,
      opportunities: s.opportunities,
      sales: s.sales,
      revenue: s.revenue,
      cost: withCost ? s.cost : null,
      impressions: withCost ? s.impressions : null,
      clicks: withCost ? s.clicks : null,
      platformConversions: withCost ? s.platformConversions : null,
      // Na linha da própria dimensão, o custo é dela e os leads são dela: aqui o CPL usa todos os leads da linha.
      cpl: withCost ? cpl(s.cost, s.leads) : null,
      roas: withCost && s.cost > 0 ? roas(s.revenue, s.cost) : null,
      conversion: rate(s.convertedLeads, s.leads),
      ticket: ticket(s.revenue, s.sales),
      ctr: withCost ? ctr(s.clicks, s.impressions) : null,
      cpc: withCost ? cpc(s.cost, s.clicks) : null,
    })
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.leads - a.leads || (b.cost ?? 0) - (a.cost ?? 0))
}

// ---------- Funil ----------

export interface FunnelStage {
  id: 'impressoes' | 'cliques' | 'leads' | 'atendidos' | 'qualificados' | 'oportunidades' | 'vendas' | 'faturamento'
  label: string
  value: number
  /** Passagem da etapa anterior para esta. */
  passRate: number | null
  /** Custo de mídia por unidade da etapa (custo acumulado até aqui). */
  costPer: number | null
}

/**
 * Funil encaixado: cada etapa está dentro da anterior. Impressões e cliques só aparecem quando o recorte é só de mídia
 * com custo (senão os leads de outros canais inflariam a passagem de clique para lead).
 * O faturamento não tem taxa de passagem (é valor, não quantidade).
 */
export function funnel(s: Summary, showMedia: boolean): FunnelStage[] {
  const steps: Omit<FunnelStage, 'passRate' | 'costPer'>[] = [
    ...(showMedia
      ? [
          { id: 'impressoes' as const, label: 'Impressões', value: s.impressions },
          { id: 'cliques' as const, label: 'Cliques', value: s.clicks },
        ]
      : []),
    { id: 'leads', label: 'Leads gerados', value: s.leads },
    { id: 'atendidos', label: 'Leads atendidos', value: s.attended },
    { id: 'qualificados', label: 'Atendidos e qualificados', value: s.qualifiedAttended },
    { id: 'oportunidades', label: 'Oportunidades', value: s.opportunities },
    { id: 'vendas', label: 'Leads que compraram', value: s.convertedLeads },
  ]
  const out: FunnelStage[] = steps.map((st, i) => ({
    ...st,
    passRate: i > 0 ? rate(st.value, steps[i - 1]!.value) : null,
    costPer: showMedia && s.cost > 0 ? div(s.cost, st.value) : null,
  }))
  out.push({ id: 'faturamento', label: 'Faturamento', value: s.revenue, passRate: null, costPer: null })
  return out
}

/** Etapa com a maior perda (menor passagem), entre as que têm pelo menos 10 na etapa anterior. */
export function biggestDrop(stages: FunnelStage[]): FunnelStage | null {
  let worst: FunnelStage | null = null
  stages.forEach((st, i) => {
    if (st.passRate === null || st.id === 'faturamento' || (stages[i - 1]?.value ?? 0) < 10) return
    if (!worst || st.passRate < worst.passRate!) worst = st
  })
  return worst
}

// ---------- Tempos ----------

export interface Timing {
  avgHours: number | null
  medianHours: number | null
  n: number
  /** Atendimentos sem esse dado (ex.: importados de planilha). */
  missing: number
}

function timing(values: (number | null)[]): Timing {
  const ok = values.filter((v): v is number => v !== null && v >= 0)
  const h = ok.map((v) => v / 3_600_000)
  const avg = mean(h)
  const med = median(h)
  return { avgHours: avg === null ? null : round2(avg), medianHours: med === null ? null : round2(med), n: ok.length, missing: values.length - ok.length }
}

/** Tempo do lead até o primeiro atendimento, até a oportunidade (retorno do vendedor) e até a venda (só com data real). */
export function timings(rows: Row[], p: Period) {
  const cohort = rows.filter((r) => inPeriod(r.leadAt, p))
  const since = (at: Date | null, r: Row) => (at ? at.getTime() - r.leadAt.getTime() : null)
  return {
    firstContact: timing(cohort.map((r) => (r.imported ? null : since(r.firstContactAt, r)))),
    opportunity: timing(cohort.filter((r) => r.returnStatus === 'SIM').map((r) => since(r.returnedAt, r))),
    sale: timing(cohort.filter((r) => r.saleStatus === 'SIM').map((r) => (r.saleAtEstimated ? null : since(r.saleAt, r)))),
  }
}

// ---------- Pontos de atenção (com amostra mínima e as evidências) ----------

export interface Attention {
  level: 'alta' | 'media' | 'info'
  title: string
  evidence: string
  action: string
}

const MIN_LEADS = 20
const pctText = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const brlText = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Pontos de atenção do período. Nenhum é emitido abaixo da amostra mínima; quando falta amostra, isso é dito.
 * São sinais para investigar, não prova de causa.
 */
export function attentionPoints(now: Summary, before: Summary, ctx: Ctx, extra: { campaignsWithoutLeads: { name: string; cost: number }[]; identifiedShare: number | null; costStaleHours: number | null }): Attention[] {
  const out: Attention[] = []
  if (now.leads < MIN_LEADS) {
    out.push({ level: 'info', title: 'Amostra pequena', evidence: `${now.leads} lead(s) no período (mínimo de ${MIN_LEADS} para comparar taxas).`, action: 'Amplie o período para tirar conclusões.' })
  } else {
    const un = rate(now.unattended, now.leads)
    if (un !== null && un > 0.15) {
      out.push({ level: un > 0.3 ? 'alta' : 'media', title: 'Leads sem atendimento', evidence: `${now.unattended} de ${now.leads} leads (${pctText(un)}) sem nenhum atendimento registrado.`, action: 'Conferir a fila do Pré-Vendas e o tempo de primeiro contato por vendedor.' })
    }
    const cNow = cpl(now.cost, now.leadsPaid)
    const cBefore = cpl(before.cost, before.leadsPaid)
    const v = variation(cNow, cBefore)
    if (cNow !== null && cBefore !== null && v !== null && v > 0.25 && now.leadsPaid >= MIN_LEADS && before.leadsPaid >= MIN_LEADS) {
      out.push({ level: 'media', title: 'CPL subiu', evidence: `CPL de ${brlText(cNow)} contra ${brlText(cBefore)} no período anterior (+${pctText(v)}), com ${now.leadsPaid} e ${before.leadsPaid} leads de mídia.`, action: 'Ver na Análise de Campanhas quais campanhas puxaram a alta.' })
    }
    const conv = rate(now.convertedLeads, now.leads)
    const convBefore = rate(before.convertedLeads, before.leads)
    if (conv !== null && convBefore !== null && before.leads >= MIN_LEADS && convBefore > 0 && conv < convBefore * 0.7) {
      out.push({ level: 'media', title: 'Conversão em venda caiu', evidence: `${pctText(conv)} contra ${pctText(convBefore)} no período anterior. Leads recentes ainda podem fechar: compare com cuidado.`, action: 'Comparar o funil por vendedor e por canal.' })
    }
  }
  for (const c of extra.campaignsWithoutLeads.slice(0, 3)) {
    out.push({ level: 'media', title: 'Campanha com investimento e sem leads', evidence: `${c.name}: ${brlText(c.cost)} investidos no período e nenhum lead identificado no CRM.`, action: 'Conferir a página de destino, o rastreamento (UTM/gclid) e a segmentação.' })
  }
  if (extra.identifiedShare !== null && now.leads >= MIN_LEADS && extra.identifiedShare < 0.6) {
    out.push({ level: 'media', title: 'Muitos leads sem origem identificada', evidence: `Só ${pctText(extra.identifiedShare)} dos leads têm o canal identificado.`, action: 'Usar UTMs em todos os links e o script de rastreamento nas páginas de entrada.' })
  }
  if (now.crmSales >= 5 && rate(now.estimatedSaleDates, now.crmSales)! > 0.3) {
    out.push({ level: 'info', title: 'Datas de venda estimadas', evidence: `${now.estimatedSaleDates} de ${now.crmSales} vendas sem data no histórico (importadas de planilha): contam na data do lead.`, action: 'Nada a fazer no CRM; só ler o faturamento por período com essa ressalva.' })
  }
  if (ctx.costChannels.size > 0 && extra.costStaleHours !== null && extra.costStaleHours > 48) {
    out.push({ level: 'alta', title: 'Investimento desatualizado', evidence: `O script do Google Ads não envia dados há ${Math.floor(extra.costStaleHours / 24)} dia(s).`, action: 'Conferir o script em Google Ads → Ferramentas → Scripts.' })
  }
  return out
}

export const channelLabel = (c: string) => (c in CHANNELS ? CHANNELS[c as Channel].label : c)
