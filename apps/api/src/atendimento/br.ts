/** Dados e normalizações brasileiras usadas nos atendimentos. Funções puras (testadas em test/atendimento.spec.ts). */

export const UFS = {
  AC: { name: 'Acre', region: 'Norte' },
  AL: { name: 'Alagoas', region: 'Nordeste' },
  AP: { name: 'Amapá', region: 'Norte' },
  AM: { name: 'Amazonas', region: 'Norte' },
  BA: { name: 'Bahia', region: 'Nordeste' },
  CE: { name: 'Ceará', region: 'Nordeste' },
  DF: { name: 'Distrito Federal', region: 'Centro-Oeste' },
  ES: { name: 'Espírito Santo', region: 'Sudeste' },
  GO: { name: 'Goiás', region: 'Centro-Oeste' },
  MA: { name: 'Maranhão', region: 'Nordeste' },
  MT: { name: 'Mato Grosso', region: 'Centro-Oeste' },
  MS: { name: 'Mato Grosso do Sul', region: 'Centro-Oeste' },
  MG: { name: 'Minas Gerais', region: 'Sudeste' },
  PA: { name: 'Pará', region: 'Norte' },
  PB: { name: 'Paraíba', region: 'Nordeste' },
  PR: { name: 'Paraná', region: 'Sul' },
  PE: { name: 'Pernambuco', region: 'Nordeste' },
  PI: { name: 'Piauí', region: 'Nordeste' },
  RJ: { name: 'Rio de Janeiro', region: 'Sudeste' },
  RN: { name: 'Rio Grande do Norte', region: 'Nordeste' },
  RS: { name: 'Rio Grande do Sul', region: 'Sul' },
  RO: { name: 'Rondônia', region: 'Norte' },
  RR: { name: 'Roraima', region: 'Norte' },
  SC: { name: 'Santa Catarina', region: 'Sul' },
  SP: { name: 'São Paulo', region: 'Sudeste' },
  SE: { name: 'Sergipe', region: 'Nordeste' },
  TO: { name: 'Tocantins', region: 'Norte' },
} as const

export type UF = keyof typeof UFS
export const UF_LIST = Object.keys(UFS) as UF[]
export const REGIONS = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'] as const

const DDD_UF: Record<string, UF> = {}
const DDD_RANGES: [UF, number[]][] = [
  ['SP', [11, 12, 13, 14, 15, 16, 17, 18, 19]],
  ['RJ', [21, 22, 24]],
  ['ES', [27, 28]],
  ['MG', [31, 32, 33, 34, 35, 37, 38]],
  ['PR', [41, 42, 43, 44, 45, 46]],
  ['SC', [47, 48, 49]],
  ['RS', [51, 53, 54, 55]],
  ['DF', [61]],
  ['GO', [62, 64]],
  ['TO', [63]],
  ['MT', [65, 66]],
  ['MS', [67]],
  ['AC', [68]],
  ['RO', [69]],
  ['BA', [71, 73, 74, 75, 77]],
  ['SE', [79]],
  ['PE', [81, 87]],
  ['AL', [82]],
  ['PB', [83]],
  ['RN', [84]],
  ['CE', [85, 88]],
  ['PI', [86, 89]],
  ['PA', [91, 93, 94]],
  ['AM', [92, 97]],
  ['RR', [95]],
  ['AP', [96]],
  ['MA', [98, 99]],
]
for (const [uf, ddds] of DDD_RANGES) for (const d of ddds) DDD_UF[String(d)] = uf

export function regionOf(uf: string | null | undefined): string | null {
  return uf && uf in UFS ? UFS[uf as UF].region : null
}

function plain(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const UF_BY_NAME = new Map(UF_LIST.map((uf) => [plain(UFS[uf].name), uf]))

/** Aceita a sigla ("SP") ou o nome do estado, com ou sem acento ("Sao Paulo"). */
export function ufFromText(text: string | null | undefined): UF | null {
  if (!text) return null
  const t = text.trim()
  if (t.length === 2 && t.toUpperCase() in UFS) return t.toUpperCase() as UF
  return UF_BY_NAME.get(plain(t)) ?? null
}

/**
 * Normaliza telefone brasileiro para E.164 (+55DDNNNNNNNN). Aceita "55 47 9647-0159", "(51) 99999-9999",
 * "5547996470159" etc. Retorna null quando o texto não é um telefone brasileiro reconhecível.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length !== 10 && digits.length !== 11) return null
  if (!DDD_UF[digits.slice(0, 2)]) return null
  // Celular com 11 dígitos começa com 9 depois do DDD.
  if (digits.length === 11 && digits[2] !== '9') return null
  return `+55${digits}`
}

export function ufFromPhone(e164: string | null | undefined): UF | null {
  if (!e164?.startsWith('+55')) return null
  return DDD_UF[e164.slice(3, 5)] ?? null
}

/** "R$ 9.540,00" → 9540; "1234.5" → 1234.5; vazio → null. */
export function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null
  let s = raw.replace(/[R$\s]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/** "17/07/2026" → Date ao meio-dia de São Paulo (evita trocar de dia por fuso). Rejeita anos fora de 2000–2100. */
export function parseBrDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw?.trim() ?? '')
  if (!m) return null
  const [, d, mo, y] = m.map(Number) as [number, number, number, number]
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, mo - 1, d, 15, 0, 0))
  return date.getUTCDate() === d ? date : null
}
