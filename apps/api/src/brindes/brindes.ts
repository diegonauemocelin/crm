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
export function deliveryProblem(d: { quantity: number; stock: number; quota: number | null; used: number; giftName: string; who?: string; hasQuota?: boolean }): string | null {
  if (!Number.isInteger(d.quantity) || d.quantity < 1) return 'Informe a quantidade (1 ou mais).'
  // Brinde sem cota mensal: só o estoque limita.
  if (d.hasQuota === false) return d.quantity > d.stock ? (d.stock > 0 ? `Estoque de ${d.giftName}: só ${d.stock}.` : `${d.giftName} sem estoque.`) : null
  if (d.quota === null || d.quota <= 0) return `${d.who ?? 'O vendedor'} não tem cota de ${d.giftName} por mês. Defina em Cotas mensais.`
  const left = d.quota - d.used
  if (d.quantity > left) return left > 0 ? `Saldo do mês de ${d.giftName}: só ${left}.` : `A cota do mês de ${d.giftName} já acabou (${d.quota} de ${d.quota}).`
  if (d.quantity > d.stock) return d.stock > 0 ? `Estoque de ${d.giftName}: só ${d.stock}.` : `${d.giftName} sem estoque.`
  return null
}

/** Quem tem cota e entrega: vendedor ("s:<id>") ou filial/unidade ("u:<id>"). */
export type Holder = { kind: 'seller'; id: string } | { kind: 'unit'; id: string }

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
export const HOLDER_RE = new RegExp(`^(s|u):${UUID}$`)

/** Lê "s:<uuid>" / "u:<uuid>"; um uuid sem prefixo é vendedor (chamadas antigas). */
export function parseHolder(v: string | undefined | null): Holder | null {
  if (!v) return null
  if (new RegExp(`^${UUID}$`).test(v)) return { kind: 'seller', id: v }
  if (!HOLDER_RE.test(v)) return null
  return { kind: v[0] === 'u' ? 'unit' : 'seller', id: v.slice(2) }
}

export function holderKey(h: { sellerId?: string | null; unitId?: string | null }): string {
  return h.unitId ? `u:${h.unitId}` : `s:${h.sellerId}`
}

/** Meses "AAAA-MM" de `from` até `to` (inclusive, no máximo 24; invertidos são trocados). */
export function monthsBetween(from: string, to: string): string[] {
  let [a, b] = from <= to ? [from, to] : [to, from]
  const out: string[] = []
  while (a <= b && out.length < 24) {
    out.push(a)
    const y = Number(a.slice(0, 4))
    const m = Number(a.slice(5, 7))
    a = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  return out
}

export interface ReportRow {
  month: string
  giftId: string
  gift: string
  holder: string
  holderName: string
  holderKind: 'seller' | 'unit'
  customerCode: string
  quantity: number
  value: number
}

type Sum = { quantity: number; value: number }
const add = (m: Map<string, Sum & Record<string, unknown>>, k: string, extra: Record<string, unknown>, q: number, v: number) => {
  const cur = m.get(k) ?? { ...extra, quantity: 0, value: 0 }
  cur.quantity += q
  cur.value += v
  m.set(k, cur)
}
const round = (v: number) => Math.round(v * 100) / 100

/** Resumo dos brindes entregues: total, por brinde, por vendedor/filial e por mês. */
export function reportOf(rows: ReportRow[], months: string[]) {
  const byGift = new Map<string, Sum & Record<string, unknown>>()
  const byHolder = new Map<string, Sum & Record<string, unknown>>()
  const byMonth = new Map<string, Sum & Record<string, unknown>>(months.map((m) => [m, { month: m, quantity: 0, value: 0 }]))
  let quantity = 0
  let value = 0
  const customers = new Set<string>()
  for (const r of rows) {
    quantity += r.quantity
    value += r.value
    customers.add(r.customerCode.trim().toUpperCase())
    add(byGift, r.giftId, { giftId: r.giftId, name: r.gift }, r.quantity, r.value)
    add(byHolder, r.holder, { id: r.holder, name: r.holderName, kind: r.holderKind }, r.quantity, r.value)
    add(byMonth, r.month, { month: r.month }, r.quantity, r.value)
  }
  const sorted = (m: Map<string, Sum & Record<string, unknown>>) => [...m.values()].map((x) => ({ ...x, value: round(x.value) })).sort((a, b) => b.quantity - a.quantity || b.value - a.value)
  return {
    quantity,
    value: round(value),
    byGift: sorted(byGift) as ({ giftId: string; name: string } & Sum)[],
    byHolder: sorted(byHolder) as ({ id: string; name: string; kind: 'seller' | 'unit' } & Sum)[],
    byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, x]) => ({ ...x, value: round(x.value) })) as ({ month: string } & Sum)[],
    customers: customers.size,
  }
}

/** Linhas da retirada: junta o mesmo brinde repetido e descarta quantidade inválida (máx. 30 brindes por vez). */
export function mergeLines(items: { giftId: string; quantity: number }[]): { giftId: string; quantity: number }[] {
  const out = new Map<string, number>()
  for (const it of items.slice(0, 30)) {
    if (!it?.giftId || !Number.isInteger(it.quantity) || it.quantity < 1) continue
    out.set(it.giftId, (out.get(it.giftId) ?? 0) + it.quantity)
  }
  return [...out].map(([giftId, quantity]) => ({ giftId, quantity }))
}
