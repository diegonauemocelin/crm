/**
 * Sugestão de filial pelo DDD do contato (funções puras): o chat mostra, ao lado do número, qual filial costuma atender
 * aquela região (ex.: DDD 41 a 46, Paraná, Filial Cascavel). Só sinaliza: não transfere nem muda a fila.
 */

export const FILIAIS_KEY = 'whatsapp_filiais_ddd'
export const FILIAIS_MAX = 20
export const FILIAL_COLORS = ['azul', 'verde', 'laranja', 'roxo', 'rosa', 'ciano'] as const
export type FilialColor = (typeof FILIAL_COLORS)[number]

export interface FilialRule {
  name: string
  ddds: string[]
  color: FilialColor
}

/** Regras iniciais (Usaparts): PR Cascavel, RS Cachoeirinha, SC 47 Itajaí, SC 48 e 49 Matriz. */
export const DEFAULT_FILIAIS: FilialRule[] = [
  { name: 'Matriz Maravilha', ddds: ['48', '49'], color: 'laranja' },
  { name: 'Filial Itajaí', ddds: ['47'], color: 'azul' },
  { name: 'Filial Cascavel', ddds: ['41', '42', '43', '44', '45', '46'], color: 'verde' },
  { name: 'Filial Cachoeirinha', ddds: ['51', '53', '54', '55'], color: 'roxo' },
]

/** DDDs válidos do Brasil: dois dígitos de 11 a 99, sem zero no fim (10, 20, 30... não existem). */
const dddOk = (d: string) => /^[1-9][1-9]$/.test(d)

/** Lê e limpa as regras vindas da tela: nome obrigatório, DDDs válidos e sem repetir entre filiais (vale a primeira). */
export function cleanFiliais(input: unknown): FilialRule[] {
  if (!Array.isArray(input)) return []
  const used = new Set<string>()
  const out: FilialRule[] = []
  for (const raw of input.slice(0, FILIAIS_MAX)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : ''
    if (!name) continue
    const list = Array.isArray(r.ddds) ? r.ddds : typeof r.ddds === 'string' ? r.ddds.split(/[^0-9]+/) : []
    const ddds: string[] = []
    for (const d of list.map((x) => String(x).replace(/\D/g, ''))) {
      if (!dddOk(d) || used.has(d)) continue
      used.add(d)
      ddds.push(d)
    }
    const color = FILIAL_COLORS.includes(r.color as FilialColor) ? (r.color as FilialColor) : FILIAL_COLORS[out.length % FILIAL_COLORS.length]!
    out.push({ name, ddds: ddds.sort(), color })
  }
  return out
}

/** DDD do telefone brasileiro (+55DD...), ou null. */
export function dddOf(phone: string | null | undefined) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits.startsWith('55') || digits.length < 12 || digits.length > 13) return null
  const d = digits.slice(2, 4)
  return dddOk(d) ? d : null
}

/** Filial sugerida para o telefone, ou null (estrangeiro, sem DDD ou DDD sem regra). */
export function filialOf(phone: string | null | undefined, rules: FilialRule[]) {
  const ddd = dddOf(phone)
  if (!ddd) return null
  const rule = rules.find((r) => r.ddds.includes(ddd))
  return rule ? { ...rule, ddd } : null
}
