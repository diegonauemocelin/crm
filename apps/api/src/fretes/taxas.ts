// Listas de taxas por destinatário (TDA, TDE, TDC, TVD) que a transportadora manda junto com a tabela: cada linha é um
// CPF/CNPJ com a taxa ("TAXA TDE 222/20%" = R$ 222,00 ou 20% do frete, o maior). Sem banco e sem rede
// (test/fretes-taxas.spec.ts). LGPD: o nome do destinatário não é lido.

import { normalizeHeader, parseCepRange, parseNumber } from './importacao'
import { ufByIbge } from './regioes'
import { normalizeUf } from './cep'

export const FEE_CODES = ['TDA', 'TDE', 'TDC', 'TVD', 'EMEX', 'TRT'] as const
export type FeeCode = (typeof FEE_CODES)[number]

export const FEE_LABEL: Record<FeeCode, string> = {
  TDA: 'TDA (difícil acesso)',
  TDE: 'TDE (difícil entrega)',
  TDC: 'TDC (difícil coleta)',
  TVD: 'TVD (veículo dedicado)',
  EMEX: 'EMEX',
  TRT: 'TRT (restrição de trânsito)',
}

/** Ordem de aplicação: TDE (percentual sobre o frete) antes das outras, para o % não incidir sobre taxa. */
export const FEE_ORDER: Record<FeeCode, number> = { EMEX: 950, TDE: 951, TDA: 952, TDC: 953, TVD: 954, TRT: 955 }

/** Base do percentual da taxa: sobre o frete, sobre a nota ou valor por kg. */
export type FeeBasis = 'FRETE' | 'NF' | 'KG'

export interface ParsedFee {
  /** CPF/CNPJ do destinatário; null = taxa pelo destino (ibge, CEP, região ou UF). */
  doc: string | null
  code: FeeCode
  fixed: number
  percent: number | null
  basis?: FeeBasis
  ibge?: string | null
  cepStart?: number | null
  cepEnd?: number | null
  region?: string | null
  city: string | null
  uf: string | null
  since: Date | null
}

const TAX = /\b(TDA|TDE|TDC|TVD)\b\s*:?\s*([\d.,]+)\s*(?:\/\s*([\d.,]+)\s*%)?/i

/** "TAXA TDA: 74.47", "TAXA TDE 222/20%", "TAXA TDC 47.39/0%". */
export function parseFeeText(raw: unknown): { code: FeeCode; fixed: number; percent: number | null } | null {
  const m = TAX.exec(String(raw ?? ''))
  if (!m) return null
  // Ponto decimal ("74.47") como a transportadora exporta; vírgula também vale.
  const num = (x: string) => (x.includes(',') ? parseNumber(x) : Number(x))
  const fixed = num(m[2]!)
  const pct = m[3] ? num(m[3]) : null
  if (fixed === null || Number.isNaN(fixed) || fixed < 0) return null
  return { code: m[1]!.toUpperCase() as FeeCode, fixed, percent: pct && !Number.isNaN(pct) && pct > 0 ? pct : null }
}

/** CPF/CNPJ que o Excel guardou como número (sem os zeros da frente): completa pelo tipo de pessoa da linha. */
export function normalizeDoc(raw: unknown, personHint: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (!d || d.length > 14) return null
  const hint = normalizeHeader(personHint)
  const pf = /^f/.test(hint) || /fis/.test(hint)
  const pj = /^j/.test(hint) || /jur/.test(hint)
  if (pf && d.length <= 11) return d.padStart(11, '0')
  if (pj || d.length > 11) return d.padStart(14, '0')
  return d.length === 11 ? d : null
}

/**
 * Taxa pelo nome do arquivo ou da aba ("..._Restricoes_TDE.xlsx", "TcD", aba "TVD"). TCD é a mesma TDC (difícil coleta).
 */
export function feeCodeFromName(name: unknown): FeeCode | null {
  const m = /(?:^|[^a-z])(tda|tde|tdc|tcd|tvd|emex|trt)(?:[^a-z]|$)/i.exec(String(name ?? ''))
  if (!m) return null
  const c = m[1]!.toUpperCase()
  return (c === 'TCD' ? 'TDC' : c) as FeeCode
}

/**
 * Lista no formato "Planilha Restrições" exportado por sistemas de frete: uma taxa por arquivo, colunas CNPJ e CPF
 * separadas, TIPO VALOR (FIXO, PERCENTUAL_FR, PERCENTUAL_NF ou KG), VALOR e VALOR MINIMO. PERCENTUAL_FR 20 com mínimo
 * 222 = R$ 222,00 ou 20% do frete, o maior. Sem CNPJ/CPF, a linha vale pelo destino: COD IBGE, CEP INICIAL e FINAL,
 * REGIAO ou só a UF (ex.: EMEX 20% do frete nas cidades da lista). Por m³ não é aceito e conta como linha inválida.
 */
function parseRestrictionSheet(rows: unknown[][], headerIdx: number, code: FeeCode) {
  const h = rows[headerIdx]!.map(normalizeHeader)
  const col = (re: RegExp) => h.findIndex((x) => re.test(x))
  const cCnpj = col(/^cnpj$/)
  const cCpf = col(/^cpf$/)
  const cDoc = col(/^(cnpj ?\/ ?cpf|cpf ?\/ ?cnpj|documento)$/)
  const cKind = col(/^tipo ?valor$/)
  const cValue = col(/^valor$/)
  const cMin = col(/^valor ?minimo$/)
  const cUf = col(/^uf$/)
  const cIbge = col(/ibge/)
  const cCepA = col(/^cep ?(inicial|inicio|de)$/)
  const cCepB = col(/^cep ?(final|fim|ate)$/)
  const cRegion = col(/^regiao$/)
  const fees: ParsedFee[] = []
  let invalid = 0
  const filled = (r: unknown[], i: number) => i >= 0 && r[i] !== null && r[i] !== undefined && String(r[i]).trim() !== ''
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === '')) continue
    const doc =
      (cCnpj >= 0 && r[cCnpj] !== null && r[cCnpj] !== undefined && String(r[cCnpj]).trim() !== '' ? normalizeDoc(r[cCnpj], 'JURIDICA') : null) ??
      (cCpf >= 0 && r[cCpf] !== null && r[cCpf] !== undefined && String(r[cCpf]).trim() !== '' ? normalizeDoc(r[cCpf], 'FISICA') : null) ??
      (cDoc >= 0 ? normalizeDoc(r[cDoc], null) : null)
    const kind = normalizeHeader(r[cKind]).replace(/\s+/g, '_')
    const num = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : typeof v === 'number' ? v : parseNumber(String(v)))
    const value = num(r[cValue])
    const min = cMin >= 0 ? num(r[cMin]) : null
    const floor = min !== null && min > 0 ? min : 0
    let fee: { fixed: number; percent: number | null; basis: FeeBasis } | null = null
    if (kind === 'fixo' && value !== null && value >= 0) fee = { fixed: value, percent: null, basis: 'FRETE' }
    else if ((kind === 'percentual_fr' || kind === 'percentual') && value !== null && value > 0) fee = { fixed: floor, percent: value, basis: 'FRETE' }
    else if (kind === 'percentual_nf' && value !== null && value > 0) fee = { fixed: floor, percent: value, basis: 'NF' }
    else if (kind === 'kg' && value !== null && value > 0) fee = { fixed: floor, percent: value, basis: 'KG' }
    const uf = cUf >= 0 ? normalizeUf(r[cUf]) : null
    // Pelo destino (sem documento): cidade pelo IBGE, faixa de CEP, região da transportadora ou o estado inteiro.
    const ibgeRaw = filled(r, cIbge) ? String(r[cIbge]).replace(/\D/g, '') : ''
    const ibge = ibgeRaw.length === 7 && ufByIbge(ibgeRaw) ? ibgeRaw : null
    const a = filled(r, cCepA) ? parseCepRange(r[cCepA]) : null
    const b = filled(r, cCepB) ? parseCepRange(r[cCepB]) : null
    const ceps = a && b && a !== 'invalido' && b !== 'invalido' && a.start <= b.end ? { cepStart: a.start, cepEnd: b.end } : null
    const region = filled(r, cRegion) ? String(r[cRegion]).trim().toUpperCase().slice(0, 40) : null
    const where = doc ? null : ibge || ceps || region || uf ? { ibge, cepStart: ceps?.cepStart ?? null, cepEnd: ceps?.cepEnd ?? null, region } : null
    if ((!doc && !where) || !fee || (filled(r, cIbge) && !ibge) || ((a || b) && !ceps)) {
      invalid++
      continue
    }
    fees.push({ doc, code, ...fee, ...(where ?? {}), city: null, uf: uf ?? (ibge ? ufByIbge(ibge) : null), since: null })
  }
  return { fees, invalid }
}

/**
 * Lê uma aba de lista. Precisa das colunas de documento (CNPJ/CPF) e de taxa ("TAXA TDE 222/20%"), ou do formato
 * "Planilha Restrições" (TIPO VALOR e VALOR), em que a taxa vem do nome da aba ou do arquivo (`code`).
 */
export function parseFeeSheet(rows: unknown[][], code?: FeeCode | null) {
  const restrIdx = rows.slice(0, 10).findIndex((r) => r.some((c) => /^(cnpj|cpf|uf|cod ibge|ibge|regiao|cep inicial)$/.test(normalizeHeader(c))) && r.some((c) => /^tipo ?valor$/.test(normalizeHeader(c))) && r.some((c) => normalizeHeader(c) === 'valor'))
  if (restrIdx >= 0) return code ? parseRestrictionSheet(rows, restrIdx, code) : null
  const headerIdx = rows.slice(0, 10).findIndex((r) => r.some((c) => /^(cnpj|cpf|cnpj ?\/ ?cpf|cpf ?\/ ?cnpj|documento)$/.test(normalizeHeader(c))) && r.some((c) => /taxa/.test(normalizeHeader(c))))
  if (headerIdx < 0) return null
  const h = rows[headerIdx]!.map(normalizeHeader)
  const col = (re: RegExp) => h.findIndex((x) => re.test(x))
  const cDoc = col(/^(cnpj|cpf|cnpj ?\/ ?cpf|cpf ?\/ ?cnpj|documento)$/)
  const cTax = col(/taxa/)
  const cKind = col(/fis|jur|pessoa/)
  const cCity = col(/cidade/)
  const cUf = col(/^uf|estado/)
  const cSince = col(/data/)
  const fees: ParsedFee[] = []
  let invalid = 0
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === '')) continue
    const doc = normalizeDoc(r[cDoc], cKind >= 0 ? r[cKind] : null)
    const tax = parseFeeText(r[cTax])
    if (!doc || !tax) {
      invalid++
      continue
    }
    const sinceRaw = cSince >= 0 ? r[cSince] : null
    // O leitor de planilha entrega datas como "dd/mm/aaaa".
    const br = typeof sinceRaw === 'string' ? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(sinceRaw) : null
    const since = sinceRaw instanceof Date ? sinceRaw : br ? new Date(`${br[3]}-${br[2]}-${br[1]}T00:00:00Z`) : null
    fees.push({
      doc,
      ...tax,
      city: cCity >= 0 ? String(r[cCity] ?? '').trim().slice(0, 120) || null : null,
      uf: cUf >= 0 ? normalizeUf(r[cUf]) : null,
      since: since && !Number.isNaN(since.getTime()) ? since : null,
    })
  }
  return { fees, invalid }
}
