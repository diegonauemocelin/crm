// Planilha "Regiões" do sistema de frete da transportadora: código da região (PR1, SC3...), descrição, cidades pelo
// código do IBGE, prazo (dias úteis ou corridos) e os dias da semana com entrega. A tabela de preço por região usa
// o código; aqui só a leitura, sem banco e sem rede (test/fretes-regioes.spec.ts).

import { normalizeHeader } from './importacao'
import { cityKey } from './cep'

/** Os 2 primeiros dígitos do código IBGE do município são o estado. */
const IBGE_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}
export const ufByIbge = (ibge: string) => IBGE_UF[ibge.slice(0, 2)] ?? null

const WEEKDAYS: [RegExp, string][] = [
  [/^seg/, 'SEG'],
  [/^ter/, 'TER'],
  [/^qua/, 'QUA'],
  [/^qui/, 'QUI'],
  [/^sex/, 'SEX'],
  [/^sab/, 'SAB'],
  [/^dom/, 'DOM'],
]

export interface ParsedRegion {
  code: string
  ibge: string | null
  city: string
  cityKey: string
  uf: string
  deadlineDays: number | null
  businessDays: boolean
  weekdays: string[]
}

/** Aba com os nomes das cidades pelo código do IBGE (Nome_UF, Nome_Municipio, Código Município Completo). */
export function parseIbgeSheet(rows: unknown[][]): Map<string, string> | null {
  const h = (rows[0] ?? []).map(normalizeHeader)
  const cName = h.findIndex((x) => /municipio|cidade/.test(x) && !/codigo/.test(x))
  const cCode = h.findIndex((x) => /codigo|ibge/.test(x))
  if (cName < 0 || cCode < 0) return null
  const map = new Map<string, string>()
  for (const r of rows.slice(1)) {
    const code = String(r?.[cCode] ?? '').replace(/\D/g, '')
    const name = String(r?.[cName] ?? '').trim()
    if (code.length === 7 && name) map.set(code, name)
  }
  return map.size ? map : null
}

/** É a planilha de regiões? (cabeçalho com Código, Cidades e Prazo). */
export function regionHeaderIndex(rows: unknown[][]) {
  return rows.slice(0, 10).findIndex((r) => {
    const h = (r ?? []).map(normalizeHeader)
    return h.some((x) => x === 'codigo' || x === 'regiao' || x === 'codigo regiao') && h.some((x) => /^cidades?$|ibge/.test(x)) && h.some((x) => /prazo/.test(x))
  })
}

/**
 * Lê a aba de regiões. Uma linha pode ter várias cidades ("4100103,4100400"): vira uma região por cidade. O nome da
 * cidade vem da aba do IBGE quando há; sem ela, da descrição (que é o nome da cidade quando a linha tem uma só).
 */
export function parseRegionsSheet(rows: unknown[][], ibgeNames?: Map<string, string> | null) {
  const hi = regionHeaderIndex(rows)
  if (hi < 0) return null
  const h = rows[hi]!.map(normalizeHeader)
  const col = (re: RegExp) => h.findIndex((x) => re.test(x))
  const cCode = col(/^(codigo|regiao|codigo regiao)$/)
  const cDesc = col(/^descricao|^nome/)
  const cCities = col(/^cidades?$|ibge/)
  const cDays = col(/prazo/)
  const cKind = col(/^tipo/)
  const dayCols = WEEKDAYS.map(([re, d]) => [h.findIndex((x) => re.test(x)), d] as const).filter(([i]) => i >= 0)
  const out: ParsedRegion[] = []
  let invalid = 0
  for (const r of rows.slice(hi + 1)) {
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === '')) continue
    const code = String(r[cCode] ?? '').trim().toUpperCase().slice(0, 40)
    const ibges = String(r[cCities] ?? '')
      .split(/[,;\s]+/)
      .map((x) => x.replace(/\D/g, ''))
      .filter((x) => x.length === 7)
    const desc = cDesc >= 0 ? String(r[cDesc] ?? '').trim() : ''
    const days = Number(String(r[cDays] ?? '').replace(',', '.'))
    const kind = cKind >= 0 ? normalizeHeader(r[cKind]) : ''
    const weekdays = dayCols.filter(([i]) => /^(x|s|sim|1)$/i.test(String(r[i] ?? '').trim())).map(([, d]) => d)
    if (!code || !ibges.length) {
      invalid++
      continue
    }
    for (const ibge of ibges) {
      const uf = ufByIbge(ibge)
      const city = ibgeNames?.get(ibge) ?? (ibges.length === 1 ? desc : '')
      const key = cityKey(city)
      if (!uf || !city || !key) {
        invalid++
        continue
      }
      out.push({
        code,
        ibge,
        city: city.slice(0, 120),
        cityKey: key,
        uf,
        deadlineDays: Number.isFinite(days) && days >= 0 && days <= 365 && String(r[cDays] ?? '').trim() !== '' ? Math.round(days) : null,
        businessDays: !/^c/.test(kind),
        weekdays,
      })
    }
  }
  return { regions: out, invalid }
}
