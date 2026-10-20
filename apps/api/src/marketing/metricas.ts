/**
 * Marketing Inteligente: as contas do módulo num lugar só (funções puras, testadas em test/marketing.spec.ts).
 * Lê os atendimentos do Pré-Vendas (fonte da verdade comercial) e o investimento das plataformas; nada é gravado.
 *
 * Definições (configuráveis em Configurações › Marketing Inteligente):
 * - Lead: atendimento do Pré-Vendas no período, um por lead (o mesmo lead em dois atendimentos conta uma vez).
 * - Atendido: teve primeira ação, foi repassado ao vendedor ou já tem a venda decidida (Sim/Não).
 * - Oportunidade: repassado ao vendedor.
 * - Qualificado: repassado ao vendedor e com retorno do vendedor (padrão) ou só repassado.
 * - Venda: "Venda realizada = Sim"; faturamento = valor da venda digitado no Pré-Vendas.
 */

export const DAY_MS = 86_400_000
const DATE = /^\d{4}-\d{2}-\d{2}$/

export type Platform = 'google' | 'meta' | 'tiktok' | 'outros'
export const PLATFORMS: { key: Platform; label: string; paid: boolean }[] = [
  { key: 'google', label: 'Google Ads', paid: true },
  { key: 'meta', label: 'Meta Ads (Facebook e Instagram)', paid: true },
  { key: 'tiktok', label: 'TikTok Ads', paid: true },
  { key: 'outros', label: 'Outros canais', paid: false },
]

export type QualifiedRule = 'repassado_retorno' | 'repassado'
export type AttributionModel = 'ultimo' | 'primeiro'
export type Granularity = 'dia' | 'semana' | 'mes' | 'trimestre' | 'ano'
export const GRANULARITIES: Granularity[] = ['dia', 'semana', 'mes', 'trimestre', 'ano']

export const REGIONS: Record<string, string> = {
  AC: 'Norte', AP: 'Norte', AM: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
}
export const regionOf = (state: string | null | undefined, country?: string | null) => {
  if (country && !/^(br|brasil|brazil)$/i.test(country.trim())) return 'Exterior'
  return (state && REGIONS[state.trim().toUpperCase()]) || 'Sem estado'
}

/** Atendimento do Pré-Vendas como a análise precisa (já sem dado pessoal além do id do lead). */
export interface RecordRow {
  id: string
  leadId: string | null
  /** Chave de deduplicação quando não há lead (telefone ou o próprio atendimento). */
  dedupeKey: string
  leadAt: Date
  forwarded: boolean
  forwardedAt: Date | null
  returnStatus: string | null
  returnedAt: Date | null
  saleStatus: string
  saleValue: number
  firstActionAt: Date | null
  state: string | null
  country: string | null
  unitId: string | null
  sellerId: string | null
  originId: string | null
  customerTypeId: string | null
  brandIds: string[]
  partTypeIds: string[]
  platform: Platform
  /** Campanha pelo modelo de atribuição escolhido (null = sem campanha identificada ou fora da janela). */
  campaignId: string | null
  campaignName: string | null
  /** Lead já tinha comprado antes do período. */
  recurring: boolean
}

export interface CostRow {
  date: string
  platform: Platform
  campaignId: string
  campaignName: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
}

export interface Filters {
  platform?: Platform
  campaignId?: string
  brandId?: string
  partTypeId?: string
  state?: string
  region?: string
  unitId?: string
  sellerId?: string
  originId?: string
  customerTypeId?: string
  saleStatus?: 'SIM' | 'NAO' | 'NEGOCIACAO'
  cliente?: 'novo' | 'recorrente'
}

/** Filtros que o investimento das plataformas não tem (só existem no CRM). */
export const CRM_ONLY_FILTERS: (keyof Filters)[] = ['brandId', 'partTypeId', 'state', 'region', 'unitId', 'sellerId', 'originId', 'customerTypeId', 'saleStatus', 'cliente']

export interface Rules {
  qualified: QualifiedRule
  /** Margem de contribuição média (%), para o ROI estimado. */
  marginPct: number
  /** Custos fixos de marketing por mês (agência, ferramentas, equipe), rateados pelos dias do período. */
  fixedMonthly: number
  /** Origens do Pré-Vendas contadas como marketing além da mídia paga (ex.: Site, Formulário, E-mail). */
  marketingOriginIds: string[]
}

// ---------- Regras de cada etapa ----------

export const isAttended = (r: Pick<RecordRow, 'firstActionAt' | 'forwarded' | 'saleStatus'>) => !!r.firstActionAt || r.forwarded || r.saleStatus !== 'NEGOCIACAO'
export const isOpportunity = (r: Pick<RecordRow, 'forwarded'>) => r.forwarded
export const isQualified = (r: Pick<RecordRow, 'forwarded' | 'returnStatus'>, rule: QualifiedRule) => r.forwarded && (rule === 'repassado' || r.returnStatus === 'SIM')
export const isSale = (r: Pick<RecordRow, 'saleStatus'>) => r.saleStatus === 'SIM'
export const isLost = (r: Pick<RecordRow, 'saleStatus'>) => r.saleStatus === 'NAO'
export const isMarketing = (r: Pick<RecordRow, 'platform' | 'originId'>, rules: Pick<Rules, 'marketingOriginIds'>) =>
  r.platform !== 'outros' || (!!r.originId && rules.marketingOriginIds.includes(r.originId))

// ---------- Fórmulas (seção 16 do projeto) ----------

/** Divisão que nunca quebra: denominador zero (ou sem dado) vira null, que a tela mostra como "—". */
export const div = (a: number, b: number) => (b > 0 && Number.isFinite(a) ? a / b : null)
export const pct = (a: number, b: number) => {
  const d = div(a, b)
  return d === null ? null : d * 100
}

export function formulas(x: {
  mediaCost: number
  totalCost: number
  clicks: number
  impressions: number
  leads: number
  qualified: number
  attended: number
  sales: number
  revenue: number
  mktRevenue: number
  newCustomers: number
  marginPct: number
}) {
  return {
    ctr: pct(x.clicks, x.impressions),
    cpc: div(x.mediaCost, x.clicks),
    cpm: x.impressions > 0 ? (x.mediaCost / x.impressions) * 1000 : null,
    cpl: x.mediaCost > 0 ? div(x.mediaCost, x.leads) : null,
    cpql: x.mediaCost > 0 ? div(x.mediaCost, x.qualified) : null,
    cac: x.totalCost > 0 ? div(x.totalCost, x.newCustomers) : null,
    conversionRate: pct(x.sales, x.leads),
    qualificationRate: pct(x.qualified, x.leads),
    attendedRate: pct(x.attended, x.leads),
    notAttendedRate: x.leads > 0 ? 100 - (pct(x.attended, x.leads) ?? 0) : null,
    roas: x.mediaCost > 0 ? div(x.mktRevenue, x.mediaCost) : null,
    /** ROI estimado: (faturamento atribuído × margem − custos de marketing) ÷ custos × 100. */
    roi: x.totalCost > 0 ? (((x.mktRevenue * x.marginPct) / 100 - x.totalCost) / x.totalCost) * 100 : null,
    ticket: div(x.revenue, x.sales),
  }
}

// ---------- Período ----------

/** Dia no horário de Brasília (o Brasil não tem horário de verão desde 2019). */
export const localDay = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
export const todayLocal = (now = Date.now()) => localDay(new Date(now))

/** Período pedido (padrão: últimos 30 dias até hoje) e o período anterior do mesmo tamanho, para comparar. */
export function periods(from?: string, to?: string, now = Date.now()) {
  const today = todayLocal(now)
  let t = to && DATE.test(to) ? to : today
  let f = from && DATE.test(from) ? from : new Date(Date.parse(`${t}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10)
  if (f > t) [f, t] = [t, f]
  const min = new Date(Date.parse(`${t}T00:00:00Z`) - 730 * DAY_MS).toISOString().slice(0, 10)
  if (f < min) f = min
  const days = Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / DAY_MS) + 1
  const prevTo = new Date(Date.parse(`${f}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
  const prevFrom = new Date(Date.parse(`${prevTo}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10)
  return { from: f, to: t, days, prevFrom, prevTo, start: dayStart(f), end: dayStart(t, 1), prevStart: dayStart(prevFrom), prevEnd: dayStart(prevTo, 1) }
}
export const dayStart = (day: string, plus = 0) => new Date(Date.parse(`${day}T00:00:00-03:00`) + plus * DAY_MS)

/** Agrupa um dia (aaaa-mm-dd) no balde da visão: dia, semana (começa na segunda), mês, trimestre ou ano. */
export function bucketOf(day: string, g: Granularity) {
  if (g === 'dia') return day
  if (g === 'mes') return day.slice(0, 7)
  if (g === 'ano') return day.slice(0, 4)
  if (g === 'trimestre') return `${day.slice(0, 4)}-T${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`
  const d = new Date(`${day}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10)
}
export function buckets(from: string, to: string, g: Granularity) {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    const b = bucketOf(new Date(t).toISOString().slice(0, 10), g)
    if (out[out.length - 1] !== b) out.push(b)
  }
  return out
}
export const bucketLabel = (b: string, g: Granularity) => {
  if (g === 'dia' || g === 'semana') return `${b.slice(8, 10)}/${b.slice(5, 7)}`
  if (g === 'mes') return `${b.slice(5, 7)}/${b.slice(0, 4)}`
  if (g === 'trimestre') return `${b.slice(6)}/${b.slice(0, 4)}`
  return b
}

// ---------- Plataforma e campanha ----------

/** Plataforma do atendimento: Google pelo anúncio detectado; Meta e TikTok pela origem ou pela fonte (utm_source). */
export function platformOf(r: { adsVia: string | null; originName: string | null; source?: string | null }): Platform {
  if (r.adsVia === 'ANUNCIO' || r.adsVia === 'ORIGEM') return 'google'
  const text = `${r.originName ?? ''} ${r.source ?? ''}`.toLowerCase()
  if (/tik ?tok/.test(text)) return 'tiktok'
  if (/facebook|instagram|\bmeta\b|\bfb\b|\big\b/.test(text)) return 'meta'
  return 'outros'
}

/**
 * Campanha do atendimento pelo modelo de atribuição: último toque (a do próprio atendimento) ou primeiro toque
 * (a primeira do lead). Fora da janela (dias entre o toque no anúncio e o contato), fica sem campanha.
 */
export function attributedCampaign(
  r: { leadAt: Date; recordCampaignId: string | null; recordCampaign: string | null; recordTouchAt: Date | null; firstCampaignId: string | null; firstCampaign: string | null; firstTouchAt: Date | null },
  model: AttributionModel,
  windowDays: number,
) {
  const pick = model === 'primeiro' && r.firstCampaignId ? { id: r.firstCampaignId, name: r.firstCampaign, at: r.firstTouchAt } : { id: r.recordCampaignId, name: r.recordCampaign, at: r.recordTouchAt }
  if (!pick.id) return { id: null, name: null }
  if (pick.at && r.leadAt.getTime() - pick.at.getTime() > windowDays * DAY_MS) return { id: null, name: null, outOfWindow: true }
  return { id: pick.id, name: pick.name }
}

// ---------- Filtros ----------

export function applyFilters(rows: RecordRow[], f: Filters) {
  return rows.filter(
    (r) =>
      (!f.platform || r.platform === f.platform) &&
      (!f.campaignId || (f.campaignId === '-' ? !r.campaignId : r.campaignId === f.campaignId)) &&
      (!f.brandId || r.brandIds.includes(f.brandId)) &&
      (!f.partTypeId || r.partTypeIds.includes(f.partTypeId)) &&
      (!f.state || r.state === f.state) &&
      (!f.region || regionOf(r.state, r.country) === f.region) &&
      (!f.unitId || r.unitId === f.unitId) &&
      (!f.sellerId || r.sellerId === f.sellerId) &&
      (!f.originId || r.originId === f.originId) &&
      (!f.customerTypeId || r.customerTypeId === f.customerTypeId) &&
      (!f.saleStatus || r.saleStatus === f.saleStatus) &&
      (!f.cliente || (f.cliente === 'recorrente') === r.recurring),
  )
}
export const applyCostFilters = (rows: CostRow[], f: Filters) =>
  rows.filter((c) => (!f.platform || c.platform === f.platform) && (!f.campaignId || c.campaignId === f.campaignId))

// ---------- Somas ----------

export interface Totals {
  leads: number
  attended: number
  opportunities: number
  qualified: number
  sales: number
  lost: number
  revenue: number
  mktLeads: number
  mktSales: number
  mktRevenue: number
  newCustomers: number
  mediaCost: number
  clicks: number
  impressions: number
  platformConversions: number
}

const emptyTotals = (): Totals => ({ leads: 0, attended: 0, opportunities: 0, qualified: 0, sales: 0, lost: 0, revenue: 0, mktLeads: 0, mktSales: 0, mktRevenue: 0, newCustomers: 0, mediaCost: 0, clicks: 0, impressions: 0, platformConversions: 0 })

/**
 * Soma sem duplicar: um lead conta uma vez nas etapas (se tiver dois atendimentos, vale o mais avançado);
 * vendas e faturamento somam cada atendimento com venda (são pedidos diferentes).
 */
export function sumRecords(rows: RecordRow[], rules: Pick<Rules, 'qualified' | 'marketingOriginIds'>, t = emptyTotals()) {
  const leads = new Map<string, { attended: boolean; opp: boolean; qual: boolean; mkt: boolean }>()
  const buyers = new Set<string>()
  for (const r of rows) {
    const k = r.dedupeKey
    const prev = leads.get(k) ?? { attended: false, opp: false, qual: false, mkt: false }
    const mkt = isMarketing(r, rules)
    leads.set(k, { attended: prev.attended || isAttended(r), opp: prev.opp || isOpportunity(r), qual: prev.qual || isQualified(r, rules.qualified), mkt: prev.mkt || mkt })
    if (isSale(r)) {
      t.sales++
      t.revenue += r.saleValue
      if (mkt) {
        t.mktSales++
        t.mktRevenue += r.saleValue
        if (!r.recurring) buyers.add(k)
      }
    }
    if (isLost(r)) t.lost++
  }
  for (const l of leads.values()) {
    t.leads++
    if (l.attended) t.attended++
    if (l.opp) t.opportunities++
    if (l.qual) t.qualified++
    if (l.mkt) t.mktLeads++
  }
  t.newCustomers += buyers.size
  return t
}

export function sumCosts(rows: CostRow[], t = emptyTotals()) {
  for (const c of rows) {
    t.mediaCost += c.cost
    t.clicks += c.clicks
    t.impressions += c.impressions
    t.platformConversions += c.conversions
  }
  return t
}

const round = (n: number | null, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d)

/** Indicadores de um conjunto (atendimentos + investimento), com as fórmulas centralizadas. */
export function indicators(rows: RecordRow[], costs: CostRow[], rules: Rules, days: number) {
  const t = sumCosts(costs, sumRecords(rows, rules))
  const fixedCost = Math.round(((rules.fixedMonthly * days) / 30) * 100) / 100
  const totalCost = t.mediaCost + fixedCost
  const f = formulas({ ...t, totalCost, marginPct: rules.marginPct })
  return {
    ...t,
    mediaCost: Math.round(t.mediaCost * 100) / 100,
    revenue: Math.round(t.revenue * 100) / 100,
    mktRevenue: Math.round(t.mktRevenue * 100) / 100,
    fixedCost,
    totalCost: Math.round(totalCost * 100) / 100,
    lostRate: round(pct(t.lost, t.sales + t.lost)),
    ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, round(v)])),
  } as Totals & { fixedCost: number; totalCost: number; lostRate: number | null } & { [K in keyof ReturnType<typeof formulas>]: number | null }
}
export type Indicators = ReturnType<typeof indicators>

/** Variação percentual entre o período atual e o anterior (null quando o anterior é zero ou sem dado). */
export const delta = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10)

// ---------- Recortes ----------

export type Dimension = 'platform' | 'campaign' | 'seller' | 'state' | 'region' | 'unit' | 'origin' | 'brand' | 'partType' | 'customerType' | 'cliente'
export const DIMENSIONS: Dimension[] = ['platform', 'campaign', 'seller', 'state', 'region', 'unit', 'origin', 'brand', 'partType', 'customerType', 'cliente']

function keysOf(r: RecordRow, d: Dimension): (string | null)[] {
  switch (d) {
    case 'platform': return [r.platform]
    case 'campaign': return [r.campaignId]
    case 'seller': return [r.sellerId]
    case 'state': return [r.state]
    case 'region': return [regionOf(r.state, r.country)]
    case 'unit': return [r.unitId]
    case 'origin': return [r.originId]
    case 'brand': return r.brandIds.length ? r.brandIds : [null]
    case 'partType': return r.partTypeIds.length ? r.partTypeIds : [null]
    case 'customerType': return [r.customerTypeId]
    case 'cliente': return [r.recurring ? 'recorrente' : 'novo']
  }
}

/**
 * Funil por recorte (vendedor, estado, campanha...). Atendimento com duas marcas entra nas duas (a soma das linhas
 * pode passar do total: a tela avisa). Investimento só existe por plataforma e campanha.
 */
export function breakdown(rows: RecordRow[], costs: CostRow[], d: Dimension, rules: Rules, days: number, names: (key: string) => string) {
  const groups = new Map<string, RecordRow[]>()
  for (const r of rows) for (const k of keysOf(r, d)) groups.set(k ?? '-', [...(groups.get(k ?? '-') ?? []), r])
  const costGroups = new Map<string, CostRow[]>()
  if (d === 'platform' || d === 'campaign') {
    for (const c of costs) {
      const k = d === 'platform' ? c.platform : c.campaignId
      costGroups.set(k, [...(costGroups.get(k) ?? []), c])
      if (!groups.has(k)) groups.set(k, [])
    }
  }
  const campaignNames = new Map<string, string>()
  if (d === 'campaign') {
    for (const c of costs) campaignNames.set(c.campaignId, c.campaignName)
    for (const r of rows) if (r.campaignId && r.campaignName && !campaignNames.has(r.campaignId)) campaignNames.set(r.campaignId, r.campaignName)
  }
  const platformOfCampaign = new Map<string, Platform>()
  for (const c of costs) platformOfCampaign.set(c.campaignId, c.platform)
  for (const r of rows) if (r.campaignId && !platformOfCampaign.has(r.campaignId)) platformOfCampaign.set(r.campaignId, r.platform)
  return [...groups.entries()]
    .map(([key, list]) => {
      const name =
        key === '-'
          ? d === 'campaign' ? 'Campanha não identificada' : 'Não informado'
          : d === 'campaign' ? campaignNames.get(key) || `Campanha nº ${key}` : names(key)
      // Custos fixos só entram no total geral (não se dividem por recorte).
      return { key, name, platform: d === 'campaign' && key !== '-' ? platformOfCampaign.get(key) ?? null : null, ...indicators(list, costGroups.get(key) ?? [], { ...rules, fixedMonthly: 0 }, days) }
    })
    .sort((a, b) => b.mediaCost - a.mediaCost || b.revenue - a.revenue || b.leads - a.leads)
}

// ---------- Série temporal ----------

export function series(rows: RecordRow[], costs: CostRow[], from: string, to: string, g: Granularity, rules: Rules) {
  const byBucket = new Map<string, { rows: RecordRow[]; costs: CostRow[]; days: Set<string> }>()
  const list = buckets(from, to, g)
  for (const b of list) byBucket.set(b, { rows: [], costs: [], days: new Set() })
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10)
    byBucket.get(bucketOf(day, g))?.days.add(day)
  }
  for (const r of rows) byBucket.get(bucketOf(localDay(r.leadAt), g))?.rows.push(r)
  for (const c of costs) byBucket.get(bucketOf(c.date, g))?.costs.push(c)
  return list.map((b) => {
    const x = byBucket.get(b)!
    const i = indicators(x.rows, x.costs, rules, x.days.size)
    return { bucket: b, label: bucketLabel(b, g), leads: i.leads, qualified: i.qualified, attended: i.attended, sales: i.sales, revenue: i.revenue, mktRevenue: i.mktRevenue, mediaCost: i.mediaCost, totalCost: i.totalCost, cpl: i.cpl, roas: i.roas, conversionRate: i.conversionRate }
  })
}

// ---------- Funil ----------

const hoursBetween = (a: Date | null, b: Date | null) => (a && b && b >= a ? (b.getTime() - a.getTime()) / 3_600_000 : null)
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null
}
const median = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return Math.round((v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2) * 10) / 10
}

/** Etapas do funil com volume, passagem de uma etapa para a outra e tempo até repasse e retorno. */
export function funnel(i: Indicators, rows: RecordRow[]) {
  const steps = [
    { key: 'impressions', label: 'Impressões', value: i.impressions, media: true },
    { key: 'clicks', label: 'Cliques', value: i.clicks, media: true },
    { key: 'leads', label: 'Leads gerados', value: i.leads },
    { key: 'attended', label: 'Leads atendidos', value: i.attended },
    { key: 'opportunities', label: 'Oportunidades (repassados ao vendedor)', value: i.opportunities },
    { key: 'qualified', label: 'Leads qualificados', value: i.qualified },
    { key: 'sales', label: 'Vendas', value: i.sales },
  ]
  const out = steps.map((s, k) => ({ ...s, rate: k === 0 ? null : round(pct(s.value, steps[k - 1]!.value), 1) }))
  return {
    steps: out,
    revenue: i.revenue,
    times: {
      toForwardHours: avg(rows.map((r) => hoursBetween(r.leadAt, r.forwardedAt))),
      toForwardMedianHours: median(rows.map((r) => hoursBetween(r.leadAt, r.forwardedAt))),
      toReturnHours: avg(rows.map((r) => hoursBetween(r.forwardedAt ?? r.leadAt, r.returnedAt))),
      toReturnMedianHours: median(rows.map((r) => hoursBetween(r.forwardedAt ?? r.leadAt, r.returnedAt))),
    },
  }
}
