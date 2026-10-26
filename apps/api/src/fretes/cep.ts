// CEP, UF e região: normalização e a faixa oficial de CEPs de cada estado (Correios). Sem banco e sem rede.

/** Faixas de CEP por UF (5 primeiros dígitos). */
const UF_RANGES: [number, number, string][] = [
  [1000, 19999, 'SP'],
  [20000, 28999, 'RJ'],
  [29000, 29999, 'ES'],
  [30000, 39999, 'MG'],
  [40000, 48999, 'BA'],
  [49000, 49999, 'SE'],
  [50000, 56999, 'PE'],
  [57000, 57999, 'AL'],
  [58000, 58999, 'PB'],
  [59000, 59999, 'RN'],
  [60000, 63999, 'CE'],
  [64000, 64999, 'PI'],
  [65000, 65999, 'MA'],
  [66000, 68899, 'PA'],
  [68900, 68999, 'AP'],
  [69000, 69299, 'AM'],
  [69300, 69399, 'RR'],
  [69400, 69899, 'AM'],
  [69900, 69999, 'AC'],
  [70000, 72799, 'DF'],
  [72800, 72999, 'GO'],
  [73000, 73699, 'DF'],
  [73700, 76799, 'GO'],
  [76800, 76999, 'RO'],
  [77000, 77999, 'TO'],
  [78000, 78899, 'MT'],
  [79000, 79999, 'MS'],
  [80000, 87999, 'PR'],
  [88000, 89999, 'SC'],
  [90000, 99999, 'RS'],
]

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const

export const REGION_BY_UF: Record<string, string> = {
  AC: 'NORTE', AP: 'NORTE', AM: 'NORTE', PA: 'NORTE', RO: 'NORTE', RR: 'NORTE', TO: 'NORTE',
  AL: 'NORDESTE', BA: 'NORDESTE', CE: 'NORDESTE', MA: 'NORDESTE', PB: 'NORDESTE', PE: 'NORDESTE', PI: 'NORDESTE', RN: 'NORDESTE', SE: 'NORDESTE',
  DF: 'CENTRO-OESTE', GO: 'CENTRO-OESTE', MT: 'CENTRO-OESTE', MS: 'CENTRO-OESTE',
  ES: 'SUDESTE', MG: 'SUDESTE', RJ: 'SUDESTE', SP: 'SUDESTE',
  PR: 'SUL', RS: 'SUL', SC: 'SUL',
}

/** "89874-000", "89.874-000", 89874000 ou 1310100 (Excel tira o zero da frente) → "89874000". Inválido: null. */
export function normalizeCep(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!digits || digits.length > 8) return null
  const cep = digits.padStart(8, '0')
  return /^0{8}$/.test(cep) ? null : cep
}

export const formatCep = (cep: string | number | null | undefined) => {
  if (cep === null || cep === undefined) return '—'
  const s = String(cep).padStart(8, '0')
  return `${s.slice(0, 5)}-${s.slice(5)}`
}

export function ufByCep(cep: string | null | undefined): string | null {
  if (!cep) return null
  const p = Number(cep.slice(0, 5))
  return UF_RANGES.find(([a, b]) => p >= a && p <= b)?.[2] ?? null
}

/** Cidade para comparação: sem acento, minúscula, espaços simples, sem " - UF" no fim. */
export function cityKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[-/]\s*[a-z]{2}\s*$/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s || null
}

export function normalizeUf(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase()
  return (UFS as readonly string[]).includes(s) ? s : null
}

/** CNPJ com dígitos verificadores válidos (só números). */
export function validCnpj(raw: string | null | undefined): boolean {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const digit = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = w.reduce((s, wi, i) => s + wi * Number(d[i]), 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return digit(12) === Number(d[12]) && digit(13) === Number(d[13])
}

/** CPF com dígitos verificadores válidos (só números). */
export function validCpf(raw: string | null | undefined): boolean {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const digit = (len: number) => {
    const sum = [...d.slice(0, len)].reduce((s, c, i) => s + Number(c) * (len + 1 - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10])
}
