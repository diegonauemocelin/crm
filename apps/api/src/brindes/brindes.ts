// Controle de brindes: regras sem banco (test/brindes.spec.ts).

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Mês "AAAA-MM" válido ou o mês atual (horário de São Paulo). */
export function monthOf(v: string | undefined | null, now = new Date()): string {
  if (v && MONTH.test(v)) return v
  return new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 7)
}

/** Primeiro dia do mês e primeiro dia do mês seguinte (datas, sem hora). */
export function monthRange(month: string) {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }
}

/** Data "AAAA-MM-DD" da retirada (padrão: hoje em São Paulo). */
export function dayOf(v: string | undefined | null, now = new Date()): string {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return v
  return new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
}

export interface Balance {
  giftId: string
  quota: number
  used: number
  remaining: number
}

/** Saldo do mês por brinde: cota menos o que o vendedor já entregou no mês (nunca abaixo de zero). */
export function balances(quotas: { giftId: string; monthly: number }[], used: { giftId: string; quantity: number }[]): Balance[] {
  const out = new Map<string, Balance>()
  for (const q of quotas) out.set(q.giftId, { giftId: q.giftId, quota: q.monthly, used: 0, remaining: q.monthly })
  for (const u of used) {
    const b = out.get(u.giftId) ?? { giftId: u.giftId, quota: 0, used: 0, remaining: 0 }
    b.used += u.quantity
    out.set(u.giftId, b)
  }
  for (const b of out.values()) b.remaining = Math.max(0, b.quota - b.used)
  return [...out.values()]
}

/** Por que a retirada não pode ser feita (null = pode). */
export function deliveryProblem(d: { quantity: number; stock: number; quota: number | null; used: number; giftName: string }): string | null {
  if (!Number.isInteger(d.quantity) || d.quantity < 1) return 'Informe a quantidade (1 ou mais).'
  if (d.quota === null || d.quota <= 0) return `O vendedor não tem cota de ${d.giftName} por mês. Defina em Cotas mensais.`
  const left = d.quota - d.used
  if (d.quantity > left) return left > 0 ? `Saldo do mês de ${d.giftName}: só ${left}.` : `A cota do mês de ${d.giftName} já acabou (${d.quota} de ${d.quota}).`
  if (d.quantity > d.stock) return d.stock > 0 ? `Estoque de ${d.giftName}: só ${d.stock}.` : `${d.giftName} sem estoque.`
  return null
}
