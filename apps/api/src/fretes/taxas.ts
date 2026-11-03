// Listas de taxas por destinatário (TDA, TDE, TDC, TVD) que a transportadora manda junto com a tabela: cada linha é um
// CPF/CNPJ com a taxa ("TAXA TDE 222/20%" = R$ 222,00 ou 20% do frete, o maior). Sem banco e sem rede
// (test/fretes-taxas.spec.ts). LGPD: o nome do destinatário não é lido.

import { normalizeHeader, parseNumber } from './importacao'
import { normalizeUf } from './cep'

export const FEE_CODES = ['TDA', 'TDE', 'TDC', 'TVD'] as const
export type FeeCode = (typeof FEE_CODES)[number]

export const FEE_LABEL: Record<FeeCode, string> = {
  TDA: 'TDA (difícil acesso)',
  TDE: 'TDE (difícil entrega)',
  TDC: 'TDC (difícil coleta)',
  TVD: 'TVD (veículo dedicado)',
}

/** Ordem de aplicação: TDE (percentual sobre o frete) antes das outras, para o % não incidir sobre taxa. */
export const FEE_ORDER: Record<FeeCode, number> = { TDE: 951, TDA: 952, TDC: 953, TVD: 954 }

export interface ParsedFee {
  doc: string
  code: FeeCode
  fixed: number
  percent: number | null
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

/** Lê uma aba de lista. Precisa das colunas de documento (CNPJ/CPF) e de taxa. */
export function parseFeeSheet(rows: unknown[][]) {
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
