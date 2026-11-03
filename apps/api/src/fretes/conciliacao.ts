// Conciliação do CT-e: compara o que a transportadora cobrou com o esperado (a opção escolhida na cotação ou o cálculo
// pela tabela vigente na data do CT-e), no total e componente a componente. Sem banco e sem rede
// (test/fretes-conciliacao.spec.ts).

import { money } from './formula'

export interface ExpectedRef {
  total: number
  components: { code: string; name: string; cteName?: string | null; value: number; skipped?: boolean }[]
  icms: { mode: string; rate: number | null; value: number } | null
  /** Peso taxado usado no cálculo (kg). */
  weight: number | null
}

export interface ChargedCte {
  total: number
  components: { name: string; value: number }[]
  icms: { rate: number | null; value: number | null } | null
  weight: number | null
}

export interface Tolerance {
  /** Diferença aceita em reais. */
  value: number
  /** Diferença aceita em % do esperado. Vale a maior das duas. */
  percent: number
}

export type RecType = 'DIVERGENCIA_VALOR' | 'DIVERGENCIA_PESO' | 'TAXA_NAO_PREVISTA' | 'TAXA_DUPLICADA' | 'COBRADO_A_MENOR'

export const REC_TYPE_LABEL: Record<RecType, string> = {
  DIVERGENCIA_VALOR: 'Divergência de valor',
  DIVERGENCIA_PESO: 'Divergência de peso',
  TAXA_NAO_PREVISTA: 'Taxa não prevista',
  TAXA_DUPLICADA: 'Taxa duplicada',
  COBRADO_A_MENOR: 'Cobrado abaixo do cotado',
}

export interface RecLine {
  name: string
  expected: number | null
  charged: number | null
  difference: number
  status: 'OK' | 'DIFERENTE' | 'NAO_PREVISTA' | 'NAO_COBRADA' | 'DUPLICADA'
}

export interface RecResult {
  status: 'CONCILIADO' | 'DIVERGENTE'
  types: RecType[]
  expectedTotal: number
  chargedTotal: number
  difference: number
  allowed: number
  lines: RecLine[]
  notes: string[]
}

/** Nome comparável: "FRETE PESO", "Frete peso" e "FRETE_PESO" viram FRETEPESO. */
export const normName = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^PEDAGIOFRACAO.*/, 'PEDAGIO')
    .replace(/^ADVALOREM$/, 'ADVALOREM')

const ICMS_NAMES = new Set(['ICMS', 'IMPOSTO', 'IMPOSTOS', 'OUTROS', 'TRIBUTOS'])
const LINE_TOLERANCE = 0.02

export function reconcile(expected: ExpectedRef, cte: ChargedCte, tol: Tolerance): RecResult {
  const notes: string[] = []
  const types = new Set<RecType>()
  const lines: RecLine[] = []
  const exp = expected.components.filter((c) => !c.skipped && Math.abs(c.value) > 0.004)
  const used = new Set<number>()
  const seen = new Map<string, number>()
  const icmsValue = cte.icms?.value ?? null
  let icmsCharged: number | null = null

  for (const c of cte.components) {
    const n = normName(c.name)
    if (!(Math.abs(c.value) > 0.004)) continue
    // ICMS somado ao frete costuma vir como "OUTROS" (ou "ICMS") com o mesmo valor do imposto do CT-e.
    if (ICMS_NAMES.has(n) && icmsValue !== null && Math.abs(c.value - icmsValue) <= LINE_TOLERANCE && icmsCharged === null) {
      icmsCharged = c.value
      continue
    }
    if (seen.has(n)) {
      types.add('TAXA_DUPLICADA')
      lines.push({ name: c.name, expected: null, charged: c.value, difference: money(c.value), status: 'DUPLICADA' })
      continue
    }
    seen.set(n, c.value)
    const idx = exp.findIndex((e, i) => !used.has(i) && [e.cteName, e.name, e.code].some((x) => x && normName(x) === n))
    if (idx < 0) {
      types.add('TAXA_NAO_PREVISTA')
      lines.push({ name: c.name, expected: null, charged: c.value, difference: money(c.value), status: 'NAO_PREVISTA' })
      continue
    }
    used.add(idx)
    const e = exp[idx]!
    const diff = money(c.value - e.value)
    lines.push({ name: c.name, expected: e.value, charged: c.value, difference: diff, status: Math.abs(diff) <= LINE_TOLERANCE ? 'OK' : 'DIFERENTE' })
  }
  exp.forEach((e, i) => {
    if (!used.has(i)) lines.push({ name: e.name, expected: e.value, charged: null, difference: money(-e.value), status: 'NAO_COBRADA' })
  })
  // ICMS: o esperado somado (por dentro) contra o do CT-e.
  const expIcms = expected.icms && expected.icms.mode === 'SOMADO' ? expected.icms.value : null
  if (expIcms !== null || icmsCharged !== null) {
    const charged = icmsCharged ?? (expIcms !== null ? icmsValue : null)
    const diff = money((charged ?? 0) - (expIcms ?? 0))
    lines.push({ name: 'ICMS', expected: expIcms, charged, difference: diff, status: Math.abs(diff) <= LINE_TOLERANCE ? 'OK' : charged === null ? 'NAO_COBRADA' : 'DIFERENTE' })
    if (expected.icms?.rate && cte.icms?.rate && Math.abs(expected.icms.rate - cte.icms.rate) > 0.001) notes.push(`Alíquota de ICMS diferente: esperada ${expected.icms.rate}%, cobrada ${cte.icms.rate}%.`)
  }

  const difference = money(cte.total - expected.total)
  const allowed = money(Math.max(tol.value, (expected.total * tol.percent) / 100))
  if (difference > allowed) types.add('DIVERGENCIA_VALOR')
  else if (difference < -allowed) types.add('COBRADO_A_MENOR')
  if (expected.weight && cte.weight && cte.weight > expected.weight * 1.05 + 0.5) {
    types.add('DIVERGENCIA_PESO')
    notes.push(`Peso do CT-e (${cte.weight} kg) maior que o da cotação (${expected.weight} kg).`)
  }
  // Taxa extra pequena dentro da tolerância do total não trava a conciliação; continua listada para conferência.
  const blocking = [...types].filter((t) => t !== 'COBRADO_A_MENOR' && !(t === 'TAXA_NAO_PREVISTA' && Math.abs(difference) <= allowed))
  if (types.has('COBRADO_A_MENOR')) notes.push('Cobrado abaixo do cotado: confira se falta componente (pode vir cobrança complementar).')
  return {
    status: blocking.length ? 'DIVERGENTE' : 'CONCILIADO',
    types: [...types],
    expectedTotal: money(expected.total),
    chargedTotal: money(cte.total),
    difference,
    allowed,
    lines,
    notes,
  }
}
