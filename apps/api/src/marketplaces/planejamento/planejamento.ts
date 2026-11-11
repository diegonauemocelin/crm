/**
 * Marketplaces › Planejamento: curva ABC, alertas do catálogo, metas, sugestão de envio ao Full, sazonalidade, DRE e
 * auditoria da conta. Funções puras (sem banco e sem rede), testadas em test/marketplace-planejamento.spec.ts.
 * Os números vêm dos pedidos do Mercado Livre guardados pelo CRM; o que é estimado (frete, imposto e custo) sai marcado.
 */
import { round2 } from '../precos/margem'

export const PLAN_CONFIG_KEY = 'marketplace_planejamento_config'

export interface PlanConfig {
  /** Dias de estoque que o envio ao Full deve cobrir. */
  coverageDays: number
  /** Janela do giro para o Full (dias). */
  fullWindowDays: 30 | 60
  /** Margem mínima (%) para sugerir o Full. null = usa a margem mínima de Preços e promoções. */
  fullMinMarginPct: number | null
  /** Custo de armazenagem por unidade por mês (R$), informado à mão (a API não dá). null = não considera. */
  storageCostPerUnitMonth: number | null
  /** Dias sem venda para o alerta "parado". */
  stalledDays: number
}

export const DEFAULT_PLAN_CONFIG: PlanConfig = { coverageDays: 30, fullWindowDays: 30, fullMinMarginPct: null, storageCostPerUnitMonth: null, stalledDays: 60 }

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null)

export function cleanPlanConfig(raw: Partial<Record<keyof PlanConfig, unknown>>, base: PlanConfig = DEFAULT_PLAN_CONFIG): PlanConfig {
  const int = (v: unknown, min: number, max: number, d: number) => (n(v) === null ? d : Math.round(Math.min(max, Math.max(min, n(v)!))))
  return {
    coverageDays: 'coverageDays' in raw ? int(raw.coverageDays, 7, 180, base.coverageDays) : base.coverageDays,
    fullWindowDays: 'fullWindowDays' in raw ? (Number(raw.fullWindowDays) === 60 ? 60 : 30) : base.fullWindowDays,
    fullMinMarginPct: 'fullMinMarginPct' in raw ? (raw.fullMinMarginPct === null || raw.fullMinMarginPct === '' ? null : n(raw.fullMinMarginPct) === null ? base.fullMinMarginPct : round2(Math.min(95, Math.max(-50, n(raw.fullMinMarginPct)!)))) : base.fullMinMarginPct,
    storageCostPerUnitMonth:
      'storageCostPerUnitMonth' in raw ? (raw.storageCostPerUnitMonth === null || raw.storageCostPerUnitMonth === '' ? null : n(raw.storageCostPerUnitMonth) === null ? base.storageCostPerUnitMonth : round2(Math.max(0, n(raw.storageCostPerUnitMonth)!))) : base.storageCostPerUnitMonth,
    stalledDays: 'stalledDays' in raw ? int(raw.stalledDays, 15, 365, base.stalledDays) : base.stalledDays,
  }
}

// ---------- Pedidos do Mercado Livre ----------

export interface MlOrder {
  id?: number | string
  status?: string
  date_created?: string
  date_closed?: string | null
  shipping?: { id?: number | string | null } | null
  order_items?: {
    item?: { id?: string; title?: string; seller_sku?: string | null; variation_id?: number | string | null }
    quantity?: number
    unit_price?: number
    sale_fee?: number | null
    listing_type_id?: string
  }[]
}

export interface OrderLine {
  orderId: string
  itemId: string
  variationId: string
  title: string | null
  sellerSku: string | null
  quantity: number
  unitPrice: number
  total: number
  /** Tarifa de venda da linha (sale_fee × quantidade). null quando o pedido não trouxe. */
  saleFee: number | null
  listingTypeId: string | null
  status: string | null
  dateCreated: Date
  dateClosed: Date | null
  shippingId: string | null
}

/**
 * Linhas de um pedido (/orders/search). sale_fee vem por unidade em cada order_item (no exemplo da documentação
 * "Orders" a quantidade é 1; nas respostas da API o valor é unitário): a linha guarda sale_fee × quantidade.
 */
export function orderLines(o: MlOrder): OrderLine[] {
  if (o.id === undefined || o.id === null || !o.date_created || Number.isNaN(Date.parse(o.date_created))) return []
  const out: OrderLine[] = []
  for (const oi of o.order_items ?? []) {
    const itemId = oi.item?.id
    if (!itemId) continue
    const quantity = Math.max(1, Math.round(Number(oi.quantity) || 1))
    const unitPrice = Number(oi.unit_price) || 0
    out.push({
      orderId: String(o.id),
      itemId,
      variationId: oi.item?.variation_id == null ? '' : String(oi.item.variation_id),
      title: oi.item?.title?.slice(0, 200) ?? null,
      sellerSku: oi.item?.seller_sku?.slice(0, 60) ?? null,
      quantity,
      unitPrice: round2(unitPrice),
      total: round2(unitPrice * quantity),
      saleFee: typeof oi.sale_fee === 'number' && Number.isFinite(oi.sale_fee) ? round2(oi.sale_fee * quantity) : null,
      listingTypeId: oi.listing_type_id ?? null,
      status: o.status ?? null,
      dateCreated: new Date(o.date_created),
      dateClosed: o.date_closed && !Number.isNaN(Date.parse(o.date_closed)) ? new Date(o.date_closed) : null,
      shippingId: o.shipping?.id == null ? null : String(o.shipping.id),
    })
  }
  return out
}

/** Janelas mensais (do mais antigo para o mais novo) para ler os pedidos sem passar do limite de paginação. */
export function monthWindows(from: Date, to: Date): { from: Date; to: Date }[] {
  const out: { from: Date; to: Date }[] = []
  let a = new Date(from)
  while (a < to) {
    const b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1))
    out.push({ from: a, to: b < to ? b : to })
    a = b
  }
  return out
}

/** Pedido que conta como venda (cancelado e inválido não contam). */
export const isSale = (status: string | null) => status !== 'cancelled' && status !== 'invalid'

// ---------- Contribuição por linha ----------

export interface LineCosts {
  /** Custo do frete por unidade para a loja (estimativa do anúncio); null = não calculado. */
  shippingPerUnit: number | null
  /** Carga de imposto (%); null = sem dado. */
  taxPct: number | null
  /** Custo por unidade; null = não informado. */
  unitCost: number | null
  extraPct: number
  fixedCostPerSale: number
  /** Tarifa (%) do anúncio para estimar quando o pedido não trouxe sale_fee. */
  feePct: number | null
}

export interface LineResult {
  revenue: number
  fee: number
  feeEstimated: boolean
  shipping: number
  tax: number
  extra: number
  cost: number
  fixed: number
  contribution: number
  /** Faltou custo, imposto ou tarifa: contribuição incompleta. */
  missingCost: boolean
  missingTax: boolean
  missingFee: boolean
  shippingEstimated: boolean
}

/** Margem de contribuição de uma linha de pedido: receita − tarifa − frete − imposto − outras taxas − custo − custo fixo. */
export function lineContribution(l: Pick<OrderLine, 'total' | 'quantity' | 'saleFee'>, c: LineCosts): LineResult {
  const feeEstimated = l.saleFee === null
  const fee = l.saleFee ?? (c.feePct === null ? 0 : round2((l.total * c.feePct) / 100))
  const shipping = round2((c.shippingPerUnit ?? 0) * l.quantity)
  const tax = c.taxPct === null ? 0 : round2((l.total * c.taxPct) / 100)
  const extra = round2((l.total * c.extraPct) / 100)
  const cost = c.unitCost === null ? 0 : round2(c.unitCost * l.quantity)
  const fixed = c.fixedCostPerSale
  return {
    revenue: l.total,
    fee,
    feeEstimated,
    shipping,
    tax,
    extra,
    cost,
    fixed,
    contribution: round2(l.total - fee - shipping - tax - extra - cost - fixed),
    missingCost: c.unitCost === null,
    missingTax: c.taxPct === null,
    missingFee: feeEstimated && c.feePct === null,
    shippingEstimated: c.shippingPerUnit !== null && c.shippingPerUnit > 0,
  }
}

// ---------- Curva ABC ----------

export type AbcClass = 'A' | 'B' | 'C'

/** A = até 80% do total acumulado, B = até 95%, C = o resto (e quem tem valor zero ou negativo). */
export function abcClasses(items: { id: string; value: number }[], cutA = 0.8, cutB = 0.95): Map<string, AbcClass> {
  const out = new Map<string, AbcClass>()
  const pos = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  const total = pos.reduce((s, i) => s + i.value, 0)
  let acc = 0
  for (const i of pos) {
    // A classe é decidida pelo acumulado ANTES do item: o item que cruza os 80% ainda é A.
    out.set(i.id, acc / total < cutA ? 'A' : acc / total < cutB ? 'B' : 'C')
    acc += i.value
  }
  for (const i of items) if (!out.has(i.id)) out.set(i.id, 'C')
  return out
}

export interface CatalogAlert {
  code: 'sem_estoque' | 'pausado_com_estoque' | 'parado' | 'sem_venda' | 'margem_baixa' | 'prejuizo'
  text: string
}

/** Alertas do anúncio com o que o CRM tem (situação, estoque, vendas da janela e margem). */
export function catalogAlerts(a: { status: string | null; availableQuantity: number | null; unitsInWindow: number; windowDays: number; daysSinceLastSale: number | null; stalledDays: number; marginPct: number | null; minMarginPct: number }): CatalogAlert[] {
  const out: CatalogAlert[] = []
  const stock = a.availableQuantity ?? null
  if (a.status === 'active' && stock === 0) out.push({ code: 'sem_estoque', text: 'Ativo sem estoque.' })
  if (a.status === 'paused' && (stock ?? 0) > 0) out.push({ code: 'pausado_com_estoque', text: `Pausado com ${stock} em estoque.` })
  if (a.status === 'active' && a.daysSinceLastSale !== null && a.daysSinceLastSale >= a.stalledDays) out.push({ code: 'parado', text: `Parado: ${a.daysSinceLastSale} dias sem venda.` })
  else if (a.status === 'active' && a.unitsInWindow === 0 && a.daysSinceLastSale === null) out.push({ code: 'sem_venda', text: `Sem venda nos últimos ${a.windowDays} dias.` })
  if (a.marginPct !== null && a.marginPct < 0) out.push({ code: 'prejuizo', text: `Margem negativa (${a.marginPct.toLocaleString('pt-BR')}%).` })
  else if (a.marginPct !== null && a.marginPct < a.minMarginPct) out.push({ code: 'margem_baixa', text: `Margem de ${a.marginPct.toLocaleString('pt-BR')}%, abaixo do mínimo de ${a.minMarginPct.toLocaleString('pt-BR')}%.` })
  return out
}

// ---------- Qualidade e experiência de compra ----------

interface PerfRule {
  status?: string
  mode?: string
  wordings?: { title?: string }
}
interface PerfVariable {
  status?: string
  title?: string
  rules?: PerfRule[]
}
interface PerfBucket {
  status?: string
  title?: string
  variables?: PerfVariable[]
}

/** Nota de qualidade (GET /item/{id}/performance) e os pontos pendentes (regras com status PENDING). */
export function parsePerformance(raw: unknown): { score: number | null; level: string | null; levelWording: string | null; pending: { area: string; text: string; warning: boolean }[] } {
  const r = (raw ?? {}) as { score?: number; level?: string; level_wording?: string; buckets?: PerfBucket[] }
  const pending: { area: string; text: string; warning: boolean }[] = []
  for (const b of r.buckets ?? [])
    for (const v of b.variables ?? [])
      for (const rule of v.rules ?? [])
        if (rule.status === 'PENDING') pending.push({ area: b.title ?? '', text: rule.wordings?.title ?? v.title ?? '', warning: rule.mode === 'WARNING' })
  return { score: typeof r.score === 'number' ? Math.round(r.score) : null, level: r.level ?? null, levelWording: r.level_wording ?? null, pending: pending.filter((p) => p.text).slice(0, 20) }
}

/** Experiência de compra (GET /reputation/items/{id}/purchase_experience/integrators). */
export function parsePurchaseExperience(raw: unknown): { value: number | null; color: string | null; text: string | null; problems: string[] } {
  const r = (raw ?? {}) as { reputation?: { value?: number; color?: string; text?: string }; metrics_details?: { problems?: { level_two?: { title?: { text?: string } }; quantity?: string }[] } }
  const problems = (r.metrics_details?.problems ?? []).map((p) => [p.level_two?.title?.text, p.quantity].filter(Boolean).join(' · ')).filter(Boolean)
  return { value: typeof r.reputation?.value === 'number' ? r.reputation.value : null, color: r.reputation?.color ?? null, text: r.reputation?.text ?? null, problems: problems.slice(0, 10) }
}

// ---------- Reputação e auditoria ----------

export interface Reputation {
  levelId: string | null
  powerSellerStatus: string | null
  claimsRate: number | null
  cancellationsRate: number | null
  delayedRate: number | null
  salesCompleted: number | null
  period: string | null
}

/** seller_reputation de GET /users/{id} (documentação "Reputação de vendedores"). */
export function parseReputation(raw: unknown): Reputation | null {
  const r = (raw as { seller_reputation?: Record<string, unknown> } | null)?.seller_reputation as
    | { level_id?: string | null; power_seller_status?: string | null; metrics?: { claims?: { rate?: number }; cancellations?: { rate?: number }; delayed_handling_time?: { rate?: number }; sales?: { completed?: number; period?: string } } }
    | undefined
  if (!r) return null
  const m = r.metrics ?? {}
  return {
    levelId: r.level_id ?? null,
    powerSellerStatus: r.power_seller_status ?? null,
    claimsRate: typeof m.claims?.rate === 'number' ? m.claims.rate : null,
    cancellationsRate: typeof m.cancellations?.rate === 'number' ? m.cancellations.rate : null,
    delayedRate: typeof m.delayed_handling_time?.rate === 'number' ? m.delayed_handling_time.rate : null,
    salesCompleted: typeof m.sales?.completed === 'number' ? m.sales.completed : null,
    period: m.sales?.period ?? null,
  }
}

export interface AuditSummary {
  reputation: Reputation | null
  items: { total: number; active: number; paused: number; noStock: number; pausedWithStock: number; stalled: number; lowMargin: number; loss: number; noCost: number }
  quality: { read: number; avgScore: number | null; withPending: number; badExperience: number }
  attributes: { measured: number; missingBrand: number; missingPartNumber: number }
  questions: { unanswered: number; oldestHours: number | null }
  ads: { cost: number; revenue: number; acos: number | null; days: number }
  sales: { revenue: number; orders: number; units: number; contributionPct: number | null; days: number }
}

export interface Finding {
  level: 'alerta' | 'atencao' | 'ok'
  area: string
  text: string
}

const pctTxt = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/** Diagnóstico automático da conta, só com os números do resumo. */
export function auditFindings(s: AuditSummary, minMarginPct: number): Finding[] {
  const f: Finding[] = []
  const r = s.reputation
  if (r) {
    if (r.levelId && !/green/.test(r.levelId)) f.push({ level: 'alerta', area: 'Reputação', text: `Reputação ${r.levelId}: promoções e cupons exigem reputação verde.` })
    else if (r.levelId) f.push({ level: 'ok', area: 'Reputação', text: `Reputação ${r.levelId}${r.powerSellerStatus ? ` (MercadoLíder ${r.powerSellerStatus})` : ''}.` })
    if (r.claimsRate !== null && r.claimsRate > 0.02) f.push({ level: 'atencao', area: 'Reputação', text: `Reclamações em ${pctTxt(r.claimsRate * 100)} das vendas do período.` })
    if (r.delayedRate !== null && r.delayedRate > 0.1) f.push({ level: 'atencao', area: 'Reputação', text: `Despachos com atraso em ${pctTxt(r.delayedRate * 100)} das vendas.` })
    if (r.cancellationsRate !== null && r.cancellationsRate > 0.02) f.push({ level: 'atencao', area: 'Reputação', text: `Cancelamentos em ${pctTxt(r.cancellationsRate * 100)} das vendas.` })
  } else f.push({ level: 'atencao', area: 'Reputação', text: 'Reputação não lida (conecte o Mercado Livre).' })
  const i = s.items
  if (i.noStock) f.push({ level: 'alerta', area: 'Catálogo', text: `${i.noStock} anúncio(s) ativo(s) sem estoque.` })
  if (i.pausedWithStock) f.push({ level: 'atencao', area: 'Catálogo', text: `${i.pausedWithStock} anúncio(s) pausado(s) com estoque.` })
  if (i.stalled) f.push({ level: 'atencao', area: 'Catálogo', text: `${i.stalled} anúncio(s) ativo(s) parado(s), sem venda.` })
  if (i.loss) f.push({ level: 'alerta', area: 'Margem', text: `${i.loss} anúncio(s) com margem negativa.` })
  if (i.lowMargin) f.push({ level: 'atencao', area: 'Margem', text: `${i.lowMargin} anúncio(s) abaixo da margem mínima de ${pctTxt(minMarginPct)}.` })
  if (i.noCost) f.push({ level: 'atencao', area: 'Margem', text: `${i.noCost} anúncio(s) sem custo informado: a margem deles não é calculada.` })
  if (s.quality.read) {
    if (s.quality.avgScore !== null) f.push({ level: s.quality.avgScore < 70 ? 'atencao' : 'ok', area: 'Qualidade', text: `Nota média de qualidade ${s.quality.avgScore} em ${s.quality.read} anúncio(s) lido(s); ${s.quality.withPending} com pontos a melhorar.` })
    if (s.quality.badExperience) f.push({ level: 'alerta', area: 'Qualidade', text: `${s.quality.badExperience} anúncio(s) com experiência de compra ruim (risco de perder exposição).` })
  }
  if (s.attributes.measured) {
    const miss = s.attributes.missingBrand + s.attributes.missingPartNumber
    if (miss) f.push({ level: 'atencao', area: 'Ficha técnica', text: `Atributos vazios: ${s.attributes.missingBrand} sem marca e ${s.attributes.missingPartNumber} sem número de peça (de ${s.attributes.measured}).` })
  }
  if (s.questions.unanswered) f.push({ level: s.questions.oldestHours !== null && s.questions.oldestHours > 24 ? 'alerta' : 'atencao', area: 'Perguntas', text: `${s.questions.unanswered} pergunta(s) sem resposta${s.questions.oldestHours !== null ? `; a mais antiga há ${Math.round(s.questions.oldestHours)} h` : ''}.` })
  if (s.ads.acos !== null) f.push({ level: 'ok', area: 'Publicidade', text: `ACOS de ${pctTxt(s.ads.acos)} nos últimos ${s.ads.days} dias (investimento R$ ${s.ads.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).` })
  if (s.sales.contributionPct !== null) f.push({ level: s.sales.contributionPct < minMarginPct ? 'atencao' : 'ok', area: 'Resultado', text: `Margem de contribuição estimada de ${pctTxt(s.sales.contributionPct)} nas vendas dos últimos ${s.sales.days} dias.` })
  const order = { alerta: 0, atencao: 1, ok: 2 }
  return f.sort((a, b) => order[a.level] - order[b.level])
}

/** Pedido à IA gratuita: só números agregados da conta, nunca dados de clientes. */
export function swotPrompt(s: AuditSummary, findings: Finding[]) {
  return `Resumo da conta da loja no Mercado Livre (números agregados):\n${JSON.stringify(s)}\n\nDiagnóstico automático:\n${findings.map((f) => `- [${f.area}] ${f.text}`).join('\n')}\n\nMonte uma análise SWOT (Forças, Fraquezas, Oportunidades, Ameaças) com 3 a 5 itens curtos em cada, e no fim 3 ações prioritárias para o próximo mês. Use só esses números; se faltar dado, diga qual.`
}

// ---------- Metas ----------

export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()

/** Real × meta e a projeção do mês pelo ritmo atual (só para o que soma: faturamento). */
export function goalProgress(target: number | null, actual: number, day: number, totalDays: number, additive = true) {
  const projection = additive && day > 0 ? round2((actual / day) * totalDays) : actual
  return {
    target,
    actual: round2(actual),
    pct: target ? round2((actual / target) * 100) : null,
    projection,
    projectionPct: target ? round2((projection / target) * 100) : null,
  }
}

// ---------- Full ----------

export interface FullInput {
  units30: number
  units60: number
  stock: number | null
  isFull: boolean
  marginPct: number | null
  minMarginPct: number
  coverageDays: number
  windowDays: 30 | 60
  storageCostPerUnitMonth: number | null
}

/**
 * Sugestão de envio ao Full pelo giro: vendas/dia × dias de cobertura. Para quem já está no Full, só a reposição
 * (o que falta para a cobertura). Fora do Full, limitado ao estoque disponível. Sem venda ou margem baixa, não sugere.
 */
export function fullSuggestion(f: FullInput): { dailyRate: number; qty: number; reason: string; storageCost: number | null } | null {
  const units = f.windowDays === 60 ? f.units60 : f.units30
  const dailyRate = units / f.windowDays
  if (dailyRate <= 0) return null
  if (f.marginPct !== null && f.marginPct < f.minMarginPct) return null
  const need = Math.ceil(dailyRate * f.coverageDays)
  let qty = f.isFull ? need - (f.stock ?? 0) : need
  if (!f.isFull && f.stock !== null) qty = Math.min(qty, f.stock)
  if (qty <= 0) return null
  // Armazenagem pelo custo informado à mão, como se todas as unidades ficassem o período inteiro (teto).
  const reason = f.isFull ? `Reposição: ${dailyRate.toFixed(2)} venda(s)/dia, cobertura de ${f.coverageDays} dias, ${f.stock ?? 0} no Full.` : `${dailyRate.toFixed(2)} venda(s)/dia nos últimos ${f.windowDays} dias, para ${f.coverageDays} dias de cobertura.`
  const storageCost = f.storageCostPerUnitMonth === null ? null : round2(((qty * f.storageCostPerUnitMonth) / 30) * f.coverageDays)
  return { dailyRate: Math.round(dailyRate * 1000) / 1000, qty, reason, storageCost }
}

// ---------- Sazonalidade ----------

export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/**
 * Vendas por mês do ano: média de cada mês do calendário nos anos com dado e o índice contra a média dos meses
 * (100 = mês normal). Mês forte = índice de 120 ou mais.
 */
export function seasonality(rows: { month: string; revenue: number; units: number }[]) {
  const by = Array.from({ length: 12 }, () => ({ revenue: 0, units: 0, years: 0 }))
  for (const r of rows) {
    const m = Number(r.month.slice(5, 7)) - 1
    if (m < 0 || m > 11) continue
    by[m]!.revenue += r.revenue
    by[m]!.units += r.units
    by[m]!.years++
  }
  const avgs = by.map((b) => (b.years ? b.revenue / b.years : null))
  const known = avgs.filter((v): v is number => v !== null)
  const mean = known.length ? known.reduce((s, v) => s + v, 0) / known.length : 0
  return by.map((b, i) => {
    const avg = avgs[i] ?? null
    const index = avg === null || !mean ? null : Math.round((avg / mean) * 100)
    return { month: i + 1, label: MONTHS[i]!, revenue: round2(b.revenue), units: b.units, years: b.years, avgRevenue: avg === null ? null : round2(avg), index, strong: index !== null && index >= 120, weak: index !== null && index <= 80 }
  })
}

// ---------- DRE ----------

export interface DreRow {
  key: string
  label: string
  gross: number
  fees: number
  shipping: number
  ads: number
  taxes: number
  extra: number
  cogs: number
  fixed: number
  contribution: number
  contributionPct: number | null
  orders: number
  units: number
  /** Receita das linhas sem custo informado (o custo delas entra como zero). */
  revenueNoCost: number
  noCostPct: number | null
  feesEstimated: number
  estimated: boolean
}

export function emptyDre(key: string, label: string): DreRow {
  return { key, label, gross: 0, fees: 0, shipping: 0, ads: 0, taxes: 0, extra: 0, cogs: 0, fixed: 0, contribution: 0, contributionPct: null, orders: 0, units: 0, revenueNoCost: 0, noCostPct: null, feesEstimated: 0, estimated: false }
}

export function addLine(d: DreRow, l: LineResult, units: number) {
  d.gross += l.revenue
  d.fees += l.fee
  d.shipping += l.shipping
  d.taxes += l.tax
  d.extra += l.extra
  d.cogs += l.cost
  d.fixed += l.fixed
  d.units += units
  if (l.missingCost) d.revenueNoCost += l.revenue
  if (l.feeEstimated) d.feesEstimated += l.fee
  if (l.missingCost || l.feeEstimated || l.shippingEstimated || l.tax > 0) d.estimated = true
}

/** Fecha a linha: arredonda, calcula a contribuição (já com Ads) e os percentuais. */
export function closeDre(d: DreRow): DreRow {
  const r = (v: number) => round2(v)
  const out = { ...d, gross: r(d.gross), fees: r(d.fees), shipping: r(d.shipping), ads: r(d.ads), taxes: r(d.taxes), extra: r(d.extra), cogs: r(d.cogs), fixed: r(d.fixed), revenueNoCost: r(d.revenueNoCost), feesEstimated: r(d.feesEstimated) }
  out.contribution = r(out.gross - out.fees - out.shipping - out.ads - out.taxes - out.extra - out.cogs - out.fixed)
  out.contributionPct = out.gross > 0 ? r((out.contribution / out.gross) * 100) : null
  out.noCostPct = out.gross > 0 ? r((out.revenueNoCost / out.gross) * 100) : null
  return out
}

const csvCell = (v: unknown) => {
  const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? '')
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV para o Excel (separador ";" e vírgula decimal), com BOM para abrir com acento. */
export function dreCsv(rows: DreRow[], first: string) {
  const head = [first, 'Venda bruta', 'Tarifas ML', 'Frete (estimado)', 'Ads', 'Impostos (estimado)', 'Outras taxas', 'Custo das peças', 'Custo fixo', 'Margem de contribuição', 'Margem %', 'Pedidos', 'Unidades', '% vendas sem custo', 'Estimado']
  const lines = rows.map((d) => [d.label, d.gross, d.fees, d.shipping, d.ads, d.taxes, d.extra, d.cogs, d.fixed, d.contribution, d.contributionPct ?? '', d.orders, d.units, d.noCostPct ?? '', d.estimated ? 'sim' : 'não'].map((v, i) => (i >= 11 && i <= 12 ? String(v) : csvCell(v))).join(';'))
  return `﻿${[head.join(';'), ...lines].join('\r\n')}\r\n`
}
