// Motor de cálculo do frete: peso cubado e taxado, escolha da regra (destino e faixa de peso), componentes na ordem de
// aplicação e ICMS. Sem banco e sem rede (test/fretes-motor.spec.ts). O serviço busca as regras candidatas e grava o resultado.

import { type CalcSettings, type ComponentDef, componentVar } from './catalogo'
import { cityKey, interstateIcms } from './cep'
import { compileFormula, evaluate, FormulaError, money, roundTo } from './formula'

export interface Volume {
  quantity: number
  /** kg por unidade. */
  weight: number
  /** cm. */
  length: number
  width: number
  height: number
}

export interface Measures {
  realWeight: number
  cubicMeters: number
  quantity: number
  warnings: string[]
}

/** Limites de bom senso: medida acima disso quase sempre é milímetro digitado como centímetro (ou grama como kg). */
const MAX_CM = 1500
const MAX_KG_UNIT = 30000

/**
 * Peso real e cubagem dos volumes (dimensões em cm, peso em kg por unidade). Sem volumes com peso, vale o peso total
 * informado. Volumes sem medidas não entram na cubagem.
 */
export function measure(volumes: Volume[], declaredWeight: number | null | undefined): Measures {
  const warnings: string[] = []
  let real = 0
  let m3 = 0
  let qty = 0
  for (const [i, v] of volumes.entries()) {
    const q = Math.max(0, Math.trunc(v.quantity || 0))
    if (!q) continue
    for (const [k, label] of [['length', 'comprimento'], ['width', 'largura'], ['height', 'altura']] as const) {
      if (v[k] < 0) throw new Error(`Volume ${i + 1}: ${label} negativo.`)
      if (v[k] > MAX_CM) throw new Error(`Volume ${i + 1}: ${label} de ${v[k]} cm. As medidas são em centímetros (confira se não foi digitado em milímetros).`)
    }
    if (v.weight < 0 || v.weight > MAX_KG_UNIT) throw new Error(`Volume ${i + 1}: peso de ${v.weight} kg fora do esperado (o peso é em kg por unidade).`)
    qty += q
    real += q * (v.weight || 0)
    if (v.length && v.width && v.height) m3 += (q * v.length * v.width * v.height) / 1_000_000
    else warnings.push(`Volume ${i + 1} sem as três medidas: não entra na cubagem.`)
  }
  const declared = declaredWeight && declaredWeight > 0 ? declaredWeight : 0
  if (declared && real && Math.abs(declared - real) > 0.01) warnings.push(`Peso total informado (${declared} kg) diferente da soma dos volumes (${roundTo(real, 3)} kg): vale o maior.`)
  return { realWeight: roundTo(Math.max(real, declared), 3), cubicMeters: roundTo(m3, 6), quantity: qty || (declared ? 1 : 0), warnings }
}

export function weights(m: Measures, s: Pick<CalcSettings, 'cubageFactor' | 'useCubage' | 'cubageExemptM3'>) {
  const cubed = roundTo(m.cubicMeters * (s.cubageFactor || 0), 3)
  const exempt = !!s.cubageExemptM3 && m.cubicMeters <= s.cubageExemptM3 + 1e-9
  const taxed = s.useCubage && !exempt ? Math.max(m.realWeight, cubed) : m.realWeight
  return { real: m.realWeight, cubed, taxed: roundTo(taxed, 3) }
}

export interface RuleLike {
  id?: string
  cepStart: number | null
  cepEnd: number | null
  uf: string | null
  city: string | null
  weightMin: number
  weightMax: number | null
  deadlineDays: number | null
  restricted: boolean
  values: Record<string, number>
}

export interface Destination {
  zip: number
  uf: string | null
  city: string | null
}

export type MatchBy = 'CEP' | 'CIDADE' | 'UF'
export type RuleMatch = { rule: RuleLike; by: MatchBy; exceeded: boolean; weightLimit: number } | { rule: null; reason: string }

/**
 * Regra do destino: faixa de CEP (a mais estreita) > cidade > UF. Dentro do destino, a faixa de peso que contém o peso
 * taxado (no limite entre duas faixas, vale a de baixo). Acima da última faixa, usa a última e marca o excedente.
 */
export function matchRule(rules: RuleLike[], dest: Destination, weight: number): RuleMatch {
  const city = cityKey(dest.city)
  const byCep = rules.filter((r) => r.cepStart !== null && r.cepEnd !== null && dest.zip >= r.cepStart && dest.zip <= r.cepEnd)
  let group: RuleLike[] = []
  let by: MatchBy = 'CEP'
  if (byCep.length) {
    const width = Math.min(...byCep.map((r) => r.cepEnd! - r.cepStart!))
    const best = byCep.filter((r) => r.cepEnd! - r.cepStart! === width)
    const key = `${best[0]!.cepStart}-${best[0]!.cepEnd}`
    group = best.filter((r) => `${r.cepStart}-${r.cepEnd}` === key)
  } else {
    const noCep = rules.filter((r) => r.cepStart === null)
    const byCity = city ? noCep.filter((r) => r.city && cityKey(r.city) === city && (!r.uf || !dest.uf || r.uf === dest.uf)) : []
    if (byCity.length) {
      group = byCity
      by = 'CIDADE'
    } else {
      group = dest.uf ? noCep.filter((r) => !r.city && r.uf === dest.uf) : []
      by = 'UF'
    }
  }
  if (!group.length) return { rule: null, reason: 'A tabela não tem regra para este destino (a transportadora não atende ou a região não foi cadastrada).' }

  const sorted = [...group].sort((a, b) => (a.weightMax ?? Infinity) - (b.weightMax ?? Infinity) || a.weightMin - b.weightMin)
  const inBand = sorted.find((r) => weight >= r.weightMin - 1e-9 && weight <= (r.weightMax ?? Infinity) + 1e-9)
  if (inBand) return { rule: inBand, by, exceeded: false, weightLimit: inBand.weightMax ?? inBand.weightMin }
  // Abaixo da primeira faixa (ex.: faixa começa em 1 kg): cobra a primeira.
  const first = [...group].sort((a, b) => a.weightMin - b.weightMin)[0]!
  if (weight < first.weightMin) return { rule: first, by, exceeded: false, weightLimit: first.weightMax ?? first.weightMin }
  const last = sorted[sorted.length - 1]!
  return { rule: last, by, exceeded: true, weightLimit: last.weightMax ?? last.weightMin }
}

export interface ComponentResult {
  code: string
  name: string
  cteName: string | null
  value: number
  inTax: boolean
  formula: string
  /** Condição de incidência não atendida: não cobra. */
  skipped: boolean
  missing: string[]
}

export interface CalcInput {
  cargoValue: number
  totalValue?: number | null
  personType: 'PF' | 'PJ'
  measures: Measures
  /** Sem nota fiscal (só declaração de conteúdo): vale o preço SVD quando a tabela tem. */
  noInvoice?: boolean
  /** Origem e destino no mesmo estado (ICMS interno). */
  sameState?: boolean
  /** UFs de origem e destino: alíquota pela legislação quando a versão não fixa uma. */
  originUf?: string | null
  destUf?: string | null
  /** Alíquotas internas por UF cadastradas pela empresa (frete dentro do mesmo estado). */
  internalRates?: Record<string, number>
  /** Reprodução de cotação: a alíquota usada na época. */
  forceIcmsRate?: number | null
  /** Taxas extras deste envio (ex.: destinatário na lista de TDE da transportadora). */
  extraComponents?: ComponentDef[]
}

export interface CalcResult {
  ok: boolean
  error: string | null
  components: ComponentResult[]
  subtotal: number
  icms: { mode: CalcSettings['icmsMode']; rate: number | null; base: number; value: number }
  total: number
  weights: { real: number; cubed: number; taxed: number }
  variables: Record<string, number>
  warnings: string[]
}

/** Calcula os componentes da regra escolhida. Erro de fórmula não vira valor: o resultado sai com ok=false e o motivo. */
export function calculate(components: ComponentDef[], settings: CalcSettings, match: Extract<RuleMatch, { rule: RuleLike }>, input: CalcInput): CalcResult {
  const w = weights(input.measures, settings)
  const rule = match.rule
  const warnings = [...input.measures.warnings]
  const vars: Record<string, number> = {
    ...rule.values,
    cargo_value: input.cargoValue,
    total_value: input.totalValue && input.totalValue > 0 ? input.totalValue : input.cargoValue,
    weight: w.taxed,
    real_weight: w.real,
    cubed_weight: w.cubed,
    cubage: input.measures.cubicMeters,
    volumes: input.measures.quantity,
    is_pf: input.personType === 'PF' ? 1 : 0,
    is_pj: input.personType === 'PJ' ? 1 : 0,
    no_invoice: input.noInvoice ? 1 : 0,
    weight_limit: match.weightLimit,
    weight_start: rule.weightMin,
    deadline: rule.deadlineDays ?? 0,
    subtotal: 0,
  }
  const out: ComponentResult[] = []
  const fail = (error: string): CalcResult => ({
    ok: false,
    error,
    components: out,
    subtotal: 0,
    icms: { mode: settings.icmsMode, rate: null, base: 0, value: 0 },
    total: 0,
    weights: w,
    variables: vars,
    warnings,
  })
  if (match.exceeded) {
    if (!((rule.values.over_weight ?? 0) > 0) && !((rule.values.freight_kg ?? 0) > 0)) {
      return fail(`Peso taxado de ${w.taxed} kg acima da última faixa (${match.weightLimit} kg) e a tabela não tem valor de excedente para este destino.`)
    }
    warnings.push(`Peso acima da última faixa (${match.weightLimit} kg): cobrado o excedente.`)
  }

  let subtotal = 0
  for (const c of [...components, ...(input.extraComponents ?? [])].filter((x) => x.active).sort((a, b) => a.order - b.order)) {
    try {
      if (c.condition?.trim()) {
        const cond = evaluate(compileFormula(c.condition), vars)
        if (!cond.value) {
          out.push({ code: c.code, name: c.name, cteName: c.cteName ?? null, value: 0, inTax: c.inTax, formula: c.formula, skipped: true, missing: cond.missing })
          vars[componentVar(c.code)] = 0
          continue
        }
      }
      const r = evaluate(compileFormula(c.formula), vars)
      const value = money(r.value)
      if (value < 0) warnings.push(`${c.name} ficou negativo (${value.toFixed(2)}): confira a fórmula.`)
      out.push({ code: c.code, name: c.name, cteName: c.cteName ?? null, value, inTax: c.inTax, formula: c.formula, skipped: false, missing: r.missing })
      vars[componentVar(c.code)] = value
      subtotal = money(subtotal + value)
      vars.subtotal = subtotal
    } catch (e) {
      if (e instanceof FormulaError) return fail(`Componente ${c.name}: ${e.message}`)
      throw e
    }
  }

  const icmsRate = icmsRateFor(rule, settings, input)
  const rate = icmsRate.rate
  if (settings.icmsMode !== 'NAO_INCIDE' && icmsRate.note) warnings.push(icmsRate.note)
  const base = money(out.filter((c) => c.inTax && !c.skipped).reduce((s, c) => s + c.value, 0))
  let icms = 0
  if (settings.icmsMode !== 'NAO_INCIDE') {
    if (rate === null || rate === undefined) warnings.push(icmsRate.missing ?? 'Alíquota de ICMS não informada (nem na regra nem nos parâmetros): ICMS não calculado.')
    else if (rate < 0 || rate >= 100) return fail(`Alíquota de ICMS inválida: ${rate}%.`)
    else {
      icms = settings.icmsMode === 'SOMADO' ? money(base / (1 - rate / 100) - base) : money((base * rate) / 100)
      if (icmsRate.source) warnings.push(`ICMS ${rate}% (${icmsRate.source}).`)
    }
  }
  const total = settings.icmsMode === 'SOMADO' ? money(subtotal + icms) : subtotal
  if (total <= 0) warnings.push('Frete total zerado: a regra pode estar sem valores para este destino.')
  return { ok: true, error: null, components: out, subtotal, icms: { mode: settings.icmsMode, rate: rate ?? null, base, value: icms }, total, weights: w, variables: vars, warnings }
}

/**
 * Alíquota do ICMS do frete, nesta ordem: a da regra (coluna da tabela), a fixada na versão (interestadual ou no mesmo
 * estado) e, sem nenhuma, a da legislação: interestadual pela Resolução do Senado 22/1989 e interna pela tabela de
 * alíquotas por UF da empresa (Fretes → Filiais). Sem alíquota interna cadastrada, o ICMS não é calculado.
 */
export function icmsRateFor(rule: RuleLike, settings: CalcSettings, input: Pick<CalcInput, 'sameState' | 'originUf' | 'destUf' | 'internalRates' | 'forceIcmsRate'>): { rate: number | null; source: string | null; note?: string; missing?: string } {
  if (input.forceIcmsRate !== undefined) return { rate: input.forceIcmsRate, source: null }
  if (Number.isFinite(rule.values.icms_aliq)) return { rate: rule.values.icms_aliq!, source: null }
  const same = input.sameState ?? (!!input.originUf && input.originUf === input.destUf)
  if (same) {
    if (settings.icmsRateIntra !== null && settings.icmsRateIntra !== undefined) return { rate: settings.icmsRateIntra, source: null }
    const uf = input.destUf ?? input.originUf
    const internal = uf ? input.internalRates?.[uf] : undefined
    if (internal !== undefined) return { rate: internal, source: `alíquota interna de ${uf} cadastrada` }
    return { rate: null, source: null, missing: `Frete dentro de ${uf ?? 'um mesmo estado'} sem alíquota interna cadastrada (Fretes → Filiais → ICMS): ICMS não calculado.` }
  }
  if (settings.icmsRate !== null && settings.icmsRate !== undefined) return { rate: settings.icmsRate, source: null }
  const inter = interstateIcms(input.originUf, input.destUf)
  if (inter !== null) return { rate: inter, source: `interestadual ${input.originUf}→${input.destUf}, Resolução do Senado 22/1989` }
  return { rate: null, source: null }
}

/** Data prevista somando dias úteis (sábado e domingo não contam; feriados não são conhecidos pelo sistema). */
/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC. */
function easter(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(year, month - 1, day)
}

const holidayCache = new Map<number, Set<string>>()
/** Feriados nacionais (Lei 662/1949 e alterações, Lei 14.759/2023): fixos e a Sexta-feira Santa. Estaduais e municipais ficam de fora. */
export function nationalHolidays(year: number) {
  let set = holidayCache.get(year)
  if (!set) {
    const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((md) => `${year}-${md}`)
    const goodFriday = new Date(easter(year) - 2 * 86_400_000).toISOString().slice(0, 10)
    set = new Set([...fixed, goodFriday])
    holidayCache.set(year, set)
  }
  return set
}

/** Soma dias úteis: pula sábados, domingos e feriados nacionais. */
export function addBusinessDays(from: Date, days: number) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  let left = Math.max(0, Math.trunc(days))
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6 && !nationalHolidays(d.getUTCFullYear()).has(d.toISOString().slice(0, 10))) left--
  }
  return d
}
