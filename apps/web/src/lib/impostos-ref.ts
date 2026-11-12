/**
 * Referência de impostos sobre a venda para pessoa física (CPF), para sugerir a alíquota de Preços e promoções.
 * ICMS: alíquotas internas (modais) de 2026 por UF, com o adicional de fundo de pobreza onde há (tabelas publicadas
 * em 2026; há divergências entre fontes em alguns estados: AL, BA, MA, PI, RO, SE, PR, DF, TO). Confira com a
 * contabilidade. Venda interestadual a não contribuinte (EC 87/2015): o remetente recolhe a alíquota interestadual
 * (7% ou 12%) e o DIFAL (interna do destino − interestadual) vai para o destino; somados = alíquota interna do destino.
 * PIS/COFINS: Lucro Presumido 0,65% + 3% (cumulativo); Lucro Real 1,65% + 7,6% (não cumulativo, sem créditos).
 * Simples Nacional: os tributos vêm no DAS (alíquota efetiva da empresa).
 */

export const ICMS_REF_DATE = '2026'

/** Alíquota interna modal (%) e adicional do fundo de combate à pobreza (%), por UF. */
export const ICMS_INTERNO: Record<string, { rate: number; fcp?: number }> = {
  AC: { rate: 19 }, AL: { rate: 20.5, fcp: 1 }, AP: { rate: 18 }, AM: { rate: 20 }, BA: { rate: 20.5 }, CE: { rate: 20 },
  DF: { rate: 20 }, ES: { rate: 17 }, GO: { rate: 19 }, MA: { rate: 23 }, MT: { rate: 17 }, MS: { rate: 17 },
  MG: { rate: 18 }, PA: { rate: 19 }, PB: { rate: 20 }, PR: { rate: 19.5 }, PE: { rate: 20.5 }, PI: { rate: 22.5 },
  RJ: { rate: 20, fcp: 2 }, RN: { rate: 20 }, RS: { rate: 17 }, RO: { rate: 19.5 }, RR: { rate: 20 }, SC: { rate: 17 },
  SP: { rate: 18 }, SE: { rate: 19, fcp: 1 }, TO: { rate: 20 },
}

const SUL_SUDESTE_SEM_ES = ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']

/** Alíquota interestadual: de Sul/Sudeste (menos ES) para Norte, Nordeste, Centro-Oeste e ES = 7%; demais = 12%. */
export function interstateRate(origin: string, dest: string) {
  return SUL_SUDESTE_SEM_ES.includes(origin) && !SUL_SUDESTE_SEM_ES.includes(dest) ? 7 : 12
}

export type TaxRegime = 'PRESUMIDO' | 'REAL' | 'SIMPLES'
export const PIS_COFINS: Record<Exclude<TaxRegime, 'SIMPLES'>, number> = { PRESUMIDO: 3.65, REAL: 9.25 }

const r2 = (n: number) => Math.round(n * 100) / 100

export interface TaxEstimate {
  uf: string
  /** ICMS que fica com a origem (interna na mesma UF; interestadual nas outras). */
  icmsOrigin: number
  /** DIFAL + fundo de pobreza do destino. */
  difal: number
  pisCofins: number
  total: number
}

/** Carga estimada (% sobre a venda) de uma venda para CPF da origem para o destino. Simples: só o DAS. */
export function taxForSale(origin: string, dest: string, regime: TaxRegime, simplesPct = 0): TaxEstimate {
  const d = ICMS_INTERNO[dest] ?? { rate: 0 }
  const internal = d.rate + (d.fcp ?? 0)
  if (regime === 'SIMPLES') return { uf: dest, icmsOrigin: 0, difal: 0, pisCofins: 0, total: r2(simplesPct) }
  const same = origin === dest
  const inter = same ? internal : interstateRate(origin, dest)
  const difal = same ? 0 : Math.max(0, internal - inter)
  const pc = PIS_COFINS[regime]
  return { uf: dest, icmsOrigin: r2(inter), difal: r2(difal), pisCofins: pc, total: r2(inter + difal + pc) }
}

/** Média simples das 27 UFs (quando as vendas vão para o Brasil todo). */
export function averageTax(origin: string, regime: TaxRegime, simplesPct = 0) {
  const all = Object.keys(ICMS_INTERNO).map((uf) => taxForSale(origin, uf, regime, simplesPct).total)
  return r2(all.reduce((s, x) => s + x, 0) / all.length)
}
