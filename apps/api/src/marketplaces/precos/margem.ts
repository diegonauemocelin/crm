/**
 * Preços e promoções do Mercado Livre: margem, preço para uma margem alvo, regras de alteração, validações das
 * promoções e dos cupons (regras da documentação oficial do Mercado Livre) e as dicas por anúncio. Funções puras, sem
 * banco e sem rede (test/marketplace-precos.spec.ts).
 *
 * Nada aqui inventa número: tarifa, frete e imposto vêm da API do Mercado Livre e das notas fiscais; o custo é o que a
 * empresa informa. Quando falta um dado, a margem diz o que falta em vez de supor.
 */

export const PRECOS_CONFIG_KEY = 'marketplace_precos_config'
export const PRECOS_TAX_KEY = 'marketplace_precos_impostos'

/**
 * Como a margem é calculada (escolha da empresa):
 * - CUSTO: margem sobre o custo do produto (markup): preço = custo + margem + imposto % + tarifa % + frete...
 * - CUSTO_IMPOSTO: margem sobre o custo do produto mais o imposto da venda.
 * - PRECO: margem ao final de todos os custos (sobre o preço de venda).
 */
export type MarginMode = 'CUSTO' | 'CUSTO_IMPOSTO' | 'PRECO'
export const MARGIN_MODES: MarginMode[] = ['CUSTO', 'CUSTO_IMPOSTO', 'PRECO']

export interface PrecosConfig {
  /** Base da margem (CUSTO, CUSTO_IMPOSTO ou PRECO). */
  marginMode: MarginMode
  /** Alíquota manual sobre a venda (%): último recurso quando não há notas do Mercado Envios. null = não informada. */
  taxPct: number | null
  /** Margem mínima (%): abaixo dela a tela alerta e o envio pede "estou ciente". */
  minMarginPct: number
  /** Margem alvo (%) do preço sugerido. null = não configurada. */
  targetMarginPct: number | null
  /** Custo fixo por venda (R$), ex.: embalagem e etiqueta. */
  fixedCostPerSale: number
  /** Outras taxas (%) sobre a venda, ex.: devolução e antecipação. */
  extraFeePct: number
  /** Usa os impostos aprendidos das NF-e do Mercado Envios antes da alíquota manual. */
  useNfeTaxes: boolean
}

export const DEFAULT_PRECOS_CONFIG: PrecosConfig = { marginMode: 'CUSTO', taxPct: null, minMarginPct: 0, targetMarginPct: null, fixedCostPerSale: 0, extraFeePct: 0, useNfeTaxes: true }

const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null)
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
export const round2 = (n: number) => Math.round(n * 100) / 100

/** Limpa as configurações vindas da tela (percentuais de 0 a 100, valores não negativos). */
export function cleanPrecosConfig(raw: Partial<Record<keyof PrecosConfig, unknown>>, base: PrecosConfig = DEFAULT_PRECOS_CONFIG): PrecosConfig {
  const pct = (v: unknown, fallback: number | null, min = 0) => (v === null || v === '' ? null : finite(v) === null ? fallback : round2(clamp(finite(v)!, min, 95)))
  return {
    marginMode: 'marginMode' in raw && MARGIN_MODES.includes(raw.marginMode as MarginMode) ? (raw.marginMode as MarginMode) : (base.marginMode ?? 'CUSTO'),
    taxPct: 'taxPct' in raw ? pct(raw.taxPct, base.taxPct) : base.taxPct,
    minMarginPct: 'minMarginPct' in raw ? (pct(raw.minMarginPct, base.minMarginPct, -50) ?? 0) : base.minMarginPct,
    targetMarginPct: 'targetMarginPct' in raw ? pct(raw.targetMarginPct, base.targetMarginPct, -50) : base.targetMarginPct,
    fixedCostPerSale: 'fixedCostPerSale' in raw ? round2(Math.max(0, finite(raw.fixedCostPerSale) ?? 0)) : base.fixedCostPerSale,
    extraFeePct: 'extraFeePct' in raw ? (pct(raw.extraFeePct, base.extraFeePct) ?? 0) : base.extraFeePct,
    useNfeTaxes: 'useNfeTaxes' in raw ? raw.useNfeTaxes !== false : base.useNfeTaxes,
  }
}

// ---------- Tarifa do Mercado Livre ----------

/** Tarifa de venda lida em /sites/MLB/listing_prices: percentual e a parte fixa (R$). */
export interface FeeModel {
  pct: number
  fixed: number
}

export interface ListingPriceRow {
  listing_type_id?: string
  listing_type_name?: string
  sale_fee_amount?: number
  sale_fee_details?: { percentage_fee?: number; fixed_fee?: number; gross_amount?: number } | null
}

/** Lê a resposta de listing_prices (lista, lista de listas ou um objeto) e devolve a linha do tipo de anúncio. */
export function pickListingPrice(raw: unknown, listingTypeId: string): ListingPriceRow | null {
  const flat = (Array.isArray(raw) ? raw.flat(2) : raw && typeof raw === 'object' ? [raw] : []) as ListingPriceRow[]
  return flat.find((r) => r && r.listing_type_id === listingTypeId) ?? null
}

/** Tarifa (R$) e o modelo (percentual + fixo) de uma linha de listing_prices; null se a linha não trouxer o valor. */
export function feeFromRow(row: ListingPriceRow | null): { amount: number; model: FeeModel } | null {
  if (!row || typeof row.sale_fee_amount !== 'number' || !Number.isFinite(row.sale_fee_amount)) return null
  const d = row.sale_fee_details ?? {}
  const pct = typeof d.percentage_fee === 'number' ? d.percentage_fee : 0
  const fixed = typeof d.fixed_fee === 'number' ? d.fixed_fee : 0
  return { amount: round2(row.sale_fee_amount), model: { pct, fixed } }
}

// ---------- Margem ----------

export type Missing = 'custo' | 'tarifa' | 'frete' | 'imposto'

export interface MarginInput {
  price: number
  /** Tarifa de venda do Mercado Livre (R$) neste preço; null = não calculada. */
  fee: number | null
  /** Custo do frete para a loja (R$); 0 = comprador paga; null = frete grátis sem custo calculado. */
  shipping: number | null
  /** Carga de impostos (%) sobre a venda; null = sem dado. */
  taxPct: number | null
  cost: number | null
  fixedCost: number
  extraPct: number
  /** Base da margem %; sem informar = sobre o preço de venda. */
  marginMode?: MarginMode
}

export interface MarginResult {
  price: number
  fee: number | null
  shipping: number | null
  tax: number | null
  extra: number
  cost: number | null
  fixedCost: number
  /** Margem em R$ (null quando falta custo, tarifa ou imposto). */
  margin: number | null
  /** Margem sobre o preço de venda (%). */
  marginPct: number | null
  /** O que faltou. "frete" não impede o cálculo, mas a margem não conta o frete. */
  missing: Missing[]
}

/** margem = preço − tarifa − frete − imposto − outras taxas − custo − custo fixo. */
export function computeMargin(i: MarginInput): MarginResult {
  const missing: Missing[] = []
  if (i.cost === null) missing.push('custo')
  if (i.fee === null) missing.push('tarifa')
  if (i.shipping === null) missing.push('frete')
  if (i.taxPct === null) missing.push('imposto')
  const tax = i.taxPct === null ? null : round2((i.price * i.taxPct) / 100)
  const extra = round2((i.price * i.extraPct) / 100)
  const ok = i.cost !== null && i.fee !== null && tax !== null
  const margin = ok ? round2(i.price - i.fee! - (i.shipping ?? 0) - tax! - extra - i.cost! - i.fixedCost) : null
  return {
    price: round2(i.price),
    fee: i.fee,
    shipping: i.shipping,
    tax,
    extra,
    cost: i.cost,
    fixedCost: i.fixedCost,
    margin,
    marginPct: marginPctOf(margin, i.price, i.cost, tax, i.marginMode),
    missing,
  }
}

/** Margem % conforme a base escolhida: sobre o preço, sobre o custo ou sobre custo + imposto. */
export function marginPctOf(margin: number | null, price: number, cost: number | null, tax: number | null, mode: MarginMode = 'PRECO'): number | null {
  if (margin === null) return null
  const base = mode === 'CUSTO' ? cost : mode === 'CUSTO_IMPOSTO' ? (cost === null || tax === null ? null : cost + tax) : price
  return base === null || base <= 0 ? null : round2((margin / base) * 100)
}

export interface PriceModel {
  fee: FeeModel
  shipping: number
  taxPct: number
  extraPct: number
  cost: number
  fixedCost: number
  marginMode?: MarginMode
}

/**
 * Preço que dá a margem alvo (%) com a tarifa no modelo informado (percentual + fixo). A tarifa real pode mudar com o
 * preço (faixas do Mercado Livre): quem chama confere a tarifa no preço encontrado e repete (ver refinePrice).
 * null = impossível (os percentuais somam 100% ou mais).
 */
export function priceForMargin(targetPct: number, m: PriceModel): number | null {
  const mode = m.marginMode ?? 'PRECO'
  const t = targetPct / 100
  // Percentuais sobre o preço (tarifa, imposto, outras taxas) e, no modo PRECO, a própria margem.
  const onPrice = (m.fee.pct + m.taxPct + m.extraPct) / 100 + (mode === 'PRECO' ? t : mode === 'CUSTO_IMPOSTO' ? (t * m.taxPct) / 100 : 0)
  const denom = 1 - onPrice
  if (denom <= 0.01) return null
  const cost = mode === 'PRECO' ? m.cost : m.cost * (1 + t)
  const p = (cost + m.fixedCost + m.fee.fixed + m.shipping) / denom
  if (!Number.isFinite(p) || p <= 0) return null
  return Math.ceil(p * 100 - 1e-6) / 100
}

/**
 * Preço que deixa um lucro em R$ depois de tarifa, imposto, outras taxas, frete, custo e custo fixo:
 * preço = (custo + lucro + custo fixo + parte fixa da tarifa + frete) ÷ (1 − tarifa% − imposto% − outras%).
 */
export function priceForProfit(profit: number, m: PriceModel): number | null {
  const denom = 1 - (m.fee.pct + m.taxPct + m.extraPct) / 100
  if (denom <= 0.01) return null
  const p = (m.cost + profit + m.fixedCost + m.fee.fixed + m.shipping) / denom
  if (!Number.isFinite(p) || p <= 0) return null
  return Math.ceil(p * 100 - 1e-6) / 100
}

/** Lucro desejado do produto: R$ informado, % do custo, ou preço de venda do ERP − custo. null = usa a margem geral. */
export function profitTargetOf(c: { profitValue: number | null; profitPct: number | null } | null, cost: number | null, erpPrice: number | null, taxPct: number | null = null, ipiPct = 0): { value: number; source: 'produto' | 'produto_pct' | 'erp' } | null {
  if (c?.profitValue != null && c.profitValue >= 0) return { value: round2(c.profitValue), source: 'produto' }
  if (c?.profitPct != null && cost !== null) return { value: round2((cost * c.profitPct) / 100), source: 'produto_pct' }
  // Como o "Lucro líquido" do ERP: valor líquido (preço de venda + IPI, que vai por fora) − custo − impostos da venda
  // (com o IPI; a carga das notas é sobre o valor com IPI). Sem tarifa de marketplace.
  if (erpPrice !== null && cost !== null) {
    const liquid = erpPrice * (1 + Math.max(0, ipiPct) / 100)
    const v = liquid - cost - (taxPct === null ? 0 : (liquid * taxPct) / 100)
    if (v > 0) return { value: round2(v), source: 'erp' }
  }
  return null
}

/**
 * Busca do preço para a margem alvo com a tarifa real: calcula, pergunta a tarifa no preço achado e recalcula até
 * estabilizar (no máximo 4 voltas). feeAt devolve o modelo da tarifa naquele preço (ou null se não deu para ler).
 */
export async function refinePrice(targetPct: number, m: PriceModel, feeAt: (price: number) => Promise<FeeModel | null>): Promise<number | null> {
  let model = m
  let price = priceForMargin(targetPct, model)
  for (let i = 0; i < 4 && price !== null; i++) {
    const fee = await feeAt(price)
    if (!fee) return null
    model = { ...model, fee }
    const next = priceForMargin(targetPct, model)
    if (next === null || Math.abs(next - price) < 0.01) return next
    price = next
  }
  return price
}

// ---------- Regras de alteração ----------

export type PriceRule = { mode: 'valor'; value: number } | { mode: 'percentual'; value: number }

/** Preço novo por valor ou por +/− % sobre o atual (arredondado em centavos). null = inválido. */
export function applyPriceRule(price: number, rule: PriceRule): number | null {
  const next = rule.mode === 'valor' ? rule.value : price * (1 + rule.value / 100)
  if (!Number.isFinite(next) || next <= 0) return null
  return round2(next)
}

/** Preço promocional por valor ou por % de desconto sobre o preço atual. */
export function promoDealPrice(price: number, rule: { mode: 'preco' | 'percentual'; value: number }): number | null {
  const next = rule.mode === 'preco' ? rule.value : price * (1 - rule.value / 100)
  if (!Number.isFinite(next) || next <= 0) return null
  return round2(next)
}

const DAY = 86_400_000
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
export const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(dayMs(d))

/**
 * Desconto individual (PRICE_DISCOUNT): desconto de 5% até menos de 80%, no máximo 14 dias, início a partir de hoje
 * (o Mercado Livre considera só a data: começa 00:00 e termina 23:59:59).
 */
export function validatePromo(p: { price: number; dealPrice: number; start: string; finish: string; today: string }): string | null {
  if (!isDay(p.start) || !isDay(p.finish)) return 'Informe o início e o fim da promoção.'
  if (p.start < p.today) return 'A promoção não pode começar antes de hoje.'
  if (p.finish < p.start) return 'O fim da promoção não pode ser antes do início.'
  if ((dayMs(p.finish) - dayMs(p.start)) / DAY > 14) return 'O Mercado Livre aceita desconto individual de no máximo 14 dias.'
  if (!(p.dealPrice > 0) || p.dealPrice >= p.price) return 'O preço promocional precisa ser menor que o preço atual.'
  const pct = (1 - p.dealPrice / p.price) * 100
  if (pct < 5 - 1e-9) return `Desconto de ${pct.toFixed(1)}%: o Mercado Livre exige no mínimo 5%.`
  if (pct >= 80) return `Desconto de ${pct.toFixed(1)}%: o Mercado Livre aceita menos de 80%.`
  return null
}

export interface CouponInput {
  name: string
  subType: 'FIXED_AMOUNT' | 'FIXED_PERCENTAGE'
  fixedAmount?: number | null
  fixedPercentage?: number | null
  minPurchaseAmount: number
  maxPurchaseAmount?: number | null
  budget: number
  start: string
  finish: string
  code?: string | null
}

/** Cupom do vendedor (SELLER_COUPON_CAMPAIGN, só MLB): regras da documentação "Cupons do vendedor". */
export function validateCoupon(c: CouponInput, today: string): string | null {
  if (!c.name?.trim()) return 'Dê um nome à campanha (só a loja vê).'
  if (c.name.trim().length > 60) return 'Nome da campanha com no máximo 60 caracteres.'
  if (!isDay(c.start) || !isDay(c.finish)) return 'Informe o início e o fim do cupom.'
  if (c.start < today) return 'O cupom não pode começar antes de hoje.'
  if (c.finish < c.start) return 'O fim do cupom não pode ser antes do início.'
  const days = (dayMs(c.finish) - dayMs(c.start)) / DAY
  if (days < 1) return 'O cupom precisa durar ao menos 1 dia (o fim depois do início).'
  if (days > 31) return 'O Mercado Livre aceita cupom de no máximo 31 dias.'
  if (!(c.minPurchaseAmount > 0)) return 'Informe o valor mínimo de compra.'
  if (!(c.budget > 0)) return 'Informe o orçamento do cupom.'
  if (c.code != null && c.code !== '' && !/^[A-Z0-9]{1,10}$/.test(c.code)) return 'O código do cupom tem até 10 letras ou números, sem espaço.'
  if (c.subType === 'FIXED_AMOUNT') {
    if (!(Number(c.fixedAmount) > 0)) return 'Informe o valor do desconto.'
    if (Number(c.fixedAmount) >= c.minPurchaseAmount) return 'O desconto precisa ser menor que o valor mínimo de compra.'
    if (c.budget <= Number(c.fixedAmount)) return 'O orçamento precisa ser maior que o valor do desconto.'
  } else {
    const p = Number(c.fixedPercentage)
    if (!(p >= 5)) return 'O desconto do cupom é de no mínimo 5%.'
    if (p > 80) return 'O desconto do cupom é de no máximo 80%.'
    const max = Number(c.maxPurchaseAmount)
    if (!(max > 5)) return 'Informe o desconto máximo por compra (mais de R$ 5).'
    if ((c.minPurchaseAmount * p) / 100 >= max) return 'O desconto aplicado à compra mínima precisa ser menor que o desconto máximo.'
    if (c.budget <= max) return 'O orçamento precisa ser maior que o desconto máximo por compra.'
  }
  return null
}

/** Corpo do POST /seller-promotions/promotions (campos documentados; datas no formato local, só o dia conta). */
export function couponBody(c: CouponInput) {
  return {
    promotion_type: 'SELLER_COUPON_CAMPAIGN',
    name: c.name.trim(),
    sub_type: c.subType,
    start_date: `${c.start}T00:00:00`,
    finish_date: `${c.finish}T00:00:00`,
    ...(c.subType === 'FIXED_AMOUNT' ? { fixed_amount: Number(c.fixedAmount) } : { fixed_percentage: Number(c.fixedPercentage), max_purchase_amount: Number(c.maxPurchaseAmount) }),
    min_purchase_amount: c.minPurchaseAmount,
    budget: c.budget,
    ...(c.code ? { partial_coupon_code: c.code } : {}),
  }
}

/**
 * Preço por unidade com o cupom, no pior caso para a loja (uma unidade que já atinge a compra mínima). Valor fixo só
 * vale se o preço atinge a compra mínima; percentual respeita o desconto máximo. null = o cupom não se aplica a uma unidade.
 */
export function couponUnitPrice(price: number, c: Pick<CouponInput, 'subType' | 'fixedAmount' | 'fixedPercentage' | 'minPurchaseAmount' | 'maxPurchaseAmount'>): number | null {
  if (price < c.minPurchaseAmount) return null
  const off = c.subType === 'FIXED_AMOUNT' ? Number(c.fixedAmount) : Math.min((price * Number(c.fixedPercentage)) / 100, Number(c.maxPurchaseAmount) || Infinity)
  return round2(Math.max(0, price - off))
}

// ---------- Envio ----------

/** Espera antes de repetir uma chamada ao Mercado Livre (429 e erro do servidor), até 3 vezes. null = não repete. */
export function sendRetryDelay(status: number, attempt: number): number | null {
  if (attempt >= 3) return null
  if (status === 429 || status >= 500) return [2_000, 5_000, 12_000][attempt]!
  return null
}

const ML_ERRORS: [RegExp, string][] = [
  [/item\.price\.not_modifiable|dynamic pricing/i, 'o anúncio está com automatização de preços ligada no Mercado Livre; desligue a automatização para mudar o preço por aqui.'],
  [/error_credibility_price|not credible/i, 'o Mercado Livre não achou o desconto crível (preço "de" recente diferente); dê um desconto maior.'],
  [/buyer_discount_not_in_range|must be in range \(5, 80\)/i, 'o desconto precisa ficar entre 5% e 80%.'],
  [/start_date cannot be earlier than today/i, 'a data de início não pode ser antes de hoje.'],
  [/finish_date cannot be earlier than start_date/i, 'o fim não pode ser antes do início.'],
  [/maximum period cannot exceed/i, 'o período passa do máximo permitido pelo Mercado Livre.'],
  [/minimum period cannot be lower/i, 'o período é menor que o mínimo (1 dia).'],
  [/the name already exists/i, 'já existe uma campanha de cupom com esse nome.'],
  [/budget cannot be decreased/i, 'o orçamento do cupom só pode aumentar.'],
  [/fixed_percentage is greater than allowed/i, 'o desconto do cupom passa do máximo permitido.'],
  [/fixed_percentage is less than allowed/i, 'o desconto do cupom é menor que o mínimo (5%).'],
  [/fixed_amount should be lower than min purchase/i, 'o desconto precisa ser menor que a compra mínima.'],
  [/budget should be greater/i, 'o orçamento precisa ser maior que o desconto.'],
  [/not upgradable/i, 'esse campo não pode mudar com o cupom já iniciado.'],
  [/reputation|reputa/i, 'a conta precisa de reputação verde para essa promoção.'],
  [/item.*(not|isn't) (a )?candidate|not_candidate|candidate/i, 'o anúncio não está apto a essa promoção (precisa estar ativo, ser novo e não ser gratuito).'],
  [/already (exists|has)|duplicated/i, 'o anúncio já tem essa promoção.'],
  [/seller\.unable_to_list|not allowed|forbidden/i, 'o Mercado Livre não permitiu a operação nesta conta.'],
]

/** Mensagem do Mercado Livre em português, quando conhecida (a original vai junto, para conferir). */
export function mlMessagePt(raw: string): string {
  const hit = ML_ERRORS.find(([re]) => re.test(raw))
  return hit ? `${hit[1]} (${raw.slice(0, 200)})` : raw
}

// ---------- Dicas ----------

export interface Tip {
  level: 'alerta' | 'dica' | 'info'
  code: string
  text: string
}

export interface TipInput {
  status: string | null
  availableQuantity: number | null
  /** Margem no preço de venda de hoje (com a promoção, se houver). */
  margin: MarginResult
  minMarginPct: number
  targetMarginPct: number | null
  /** Preço sugerido para a margem alvo (ou a mínima, se não houver alvo) e o preço de margem zero. */
  suggestedPrice: number | null
  minPrice: number | null
  /** Preço cheio (sem promoção) e o preço promocional ativo. */
  regularPrice: number
  promoPrice: number | null
  /** Margem % no preço cheio (para dizer se a promoção é que derruba a margem). */
  regularMarginPct: number | null
  competitorMin: number | null
  competitorCount: number
  listingTypeId: string | null
  /** Tarifa no outro tipo de anúncio (Clássico ↔ Premium), quando o Mercado Livre informou. */
  otherFee: { listingTypeId: string; amount: number; pct: number } | null
  freeShipping: boolean
  mandatoryFreeShipping: boolean
  /** null = vendas não lidas. */
  sales30: number | null
  sales60: number | null
  taxSource: 'sku' | 'ncm' | 'geral' | 'manual' | null
}

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pctTxt = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const LISTING: Record<string, string> = { gold_special: 'Clássico', gold_pro: 'Premium', free: 'Grátis' }
export const listingName = (id: string | null) => (id ? (LISTING[id] ?? id) : '—')

/** Dicas determinísticas do anúncio, da mais importante para a menos. Só com dados que o CRM tem. */
export function pricingTips(t: TipInput): Tip[] {
  const out: Tip[] = []
  const m = t.margin
  if (m.cost === null) out.push({ level: 'alerta', code: 'sem_custo', text: 'Informe o custo do SKU para calcular a margem.' })
  if (m.tax === null) out.push({ level: 'alerta', code: 'sem_imposto', text: 'Sem imposto: importe os XML das vendas do Mercado Envios em Fretes › Pedidos ou informe a alíquota nas configurações desta tela.' })
  if (m.margin !== null && m.margin < 0) out.push({ level: 'alerta', code: 'prejuizo', text: `Vendendo com prejuízo de ${brl(-m.margin)} por unidade.` })
  if (m.marginPct !== null && m.marginPct < t.minMarginPct) {
    const goal = t.targetMarginPct ?? t.minMarginPct
    const promoHurts = t.promoPrice !== null && t.regularMarginPct !== null && t.regularMarginPct >= t.minMarginPct
    if (promoHurts) out.push({ level: 'alerta', code: 'promocao_margem', text: `A promoção (${brl(t.promoPrice!)}) derruba a margem para ${pctTxt(m.marginPct)}, abaixo do mínimo de ${pctTxt(t.minMarginPct)}. Sem ela, a margem é ${pctTxt(t.regularMarginPct!)}.` })
    else out.push({ level: 'alerta', code: 'margem_baixa', text: `Margem de ${pctTxt(m.marginPct)}, abaixo do mínimo de ${pctTxt(t.minMarginPct)}.${t.suggestedPrice ? ` Suba o preço para ${brl(t.suggestedPrice)} para ter ${pctTxt(goal)}.` : ''}` })
  }
  if (t.mandatoryFreeShipping && !t.freeShipping) out.push({ level: 'alerta', code: 'frete_obrigatorio', text: 'O Mercado Livre exige frete grátis neste preço e o anúncio está sem.' })
  if (t.competitorMin !== null) {
    const now = t.promoPrice ?? t.regularPrice
    if (t.competitorMin < now) {
      const below = t.minPrice !== null && t.competitorMin < t.minPrice
      out.push({
        level: 'dica',
        code: 'concorrente',
        text: `Concorrente mais barato: ${brl(t.competitorMin)} (você: ${brl(now)}${t.competitorCount > 1 ? `; ${t.competitorCount} ofertas com o mesmo código` : ''}).${below ? ` Abaixo do seu preço mínimo (${brl(t.minPrice!)}): acompanhar dá prejuízo.` : ''}`,
      })
    }
  }
  if (t.status === 'paused' && (t.availableQuantity ?? 0) > 0) out.push({ level: 'dica', code: 'pausado', text: `Anúncio pausado com ${t.availableQuantity} em estoque: reative para vender.` })
  if (t.status === 'active' && t.sales60 === 0) out.push({ level: 'dica', code: 'sem_venda_60', text: 'Sem vendas nos últimos 60 dias: revise preço, título e fotos.' })
  else if (t.status === 'active' && t.sales30 === 0) out.push({ level: 'dica', code: 'sem_venda_30', text: 'Sem vendas nos últimos 30 dias.' })
  if (t.otherFee && m.fee !== null && t.listingTypeId) {
    const diff = round2(t.otherFee.amount - m.fee)
    if (t.listingTypeId === 'gold_special' && t.otherFee.listingTypeId === 'gold_pro' && diff > 0)
      out.push({ level: 'info', code: 'premium', text: `No Premium a tarifa seria ${brl(t.otherFee.amount)} (${pctTxt(t.otherFee.pct)}): ${brl(diff)} a mais por venda, com parcelamento sem juros para o comprador.` })
    if (t.listingTypeId === 'gold_pro' && t.otherFee.listingTypeId === 'gold_special' && diff < 0)
      out.push({ level: 'info', code: 'classico', text: `No Clássico a tarifa seria ${brl(t.otherFee.amount)} (${pctTxt(t.otherFee.pct)}): ${brl(-diff)} a menos por venda, sem o parcelamento sem juros.` })
  }
  if (t.freeShipping && m.shipping === null) out.push({ level: 'info', code: 'frete_nao_calculado', text: 'Frete grátis sem custo informado pelo Mercado Livre: a margem não conta o frete.' })
  if (t.taxSource === 'manual') out.push({ level: 'info', code: 'imposto_manual', text: 'Imposto pela alíquota manual: importe os XML das vendas do Mercado Envios para usar a carga real.' })
  if (t.targetMarginPct !== null && m.marginPct !== null && m.marginPct >= t.minMarginPct && m.marginPct < t.targetMarginPct && t.suggestedPrice)
    out.push({ level: 'dica', code: 'abaixo_alvo', text: `Margem de ${pctTxt(m.marginPct)}, abaixo do alvo de ${pctTxt(t.targetMarginPct)}: o preço sugerido é ${brl(t.suggestedPrice)}.` })
  const order = { alerta: 0, dica: 1, info: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}
