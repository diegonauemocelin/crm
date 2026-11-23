/**
 * Poupança de frete dos vendedores (funções puras, testadas em test/fretes-poupanca.spec.ts).
 *
 * Como a empresa trabalha: o vendedor cota o frete e cobra do cliente a cotação + o acréscimo da campanha (ex.: 20%).
 * Em cada nota CIF: saldo do vendedor = frete cobrado na nota − (cotação + acréscimo). Ex.: cotação 298,53 + 20% =
 * 358,24 a cobrar; a nota cobrou 430,00: 71,76 vão para a poupança. Cobrou menos que cotação + acréscimo: desconta.
 * O vendedor usa a poupança em outra negociação (registrado como "uso", que tira do saldo).
 *
 * Base do acréscimo: a cotação escolhida no pedido; sem cotação, o esperado pela tabela no CT-e; sem os dois, o CT-e.
 */

export const WALLET_KEY = 'fretes_poupanca_campanhas'
export const WALLET_PERIODS = { MENSAL: 'Mensal', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual', PERSONALIZADO: 'Personalizado' } as const
export type WalletPeriod = keyof typeof WALLET_PERIODS
const MONTHS: Record<Exclude<WalletPeriod, 'PERSONALIZADO'>, number> = { MENSAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 }

export interface WalletCampaign {
  id: string
  name: string
  active: boolean
  /** Acréscimo sobre a cotação (%), que o vendedor cobra do cliente e fica com a empresa. */
  pct: number
  /** % próprio de alguns vendedores (nome como vem na nota); quem não está aqui usa o pct da campanha. */
  sellerPcts: { seller: string; pct: number }[]
  period: WalletPeriod
  /** Início e fim (AAAA-MM-DD, inclusive), pela data de emissão da nota. */
  start: string
  end: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Último dia do período que começa em `start` (mensal, trimestral, semestral ou anual). */
export function periodEnd(period: Exclude<WalletPeriod, 'PERSONALIZADO'>, start: string) {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number]
  const next = new Date(Date.UTC(y, m - 1 + MONTHS[period], d))
  return new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10)
}

export function cleanWalletCampaigns(input: unknown, newId: () => string): WalletCampaign[] {
  if (!Array.isArray(input)) return []
  const out: WalletCampaign[] = []
  for (const raw of input.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : ''
    const pct = typeof r.pct === 'number' && Number.isFinite(r.pct) && r.pct >= 0 && r.pct <= 200 ? Math.round(r.pct * 100) / 100 : null
    const period = (typeof r.period === 'string' && r.period in WALLET_PERIODS ? r.period : 'MENSAL') as WalletPeriod
    const start = typeof r.start === 'string' && DATE.test(r.start) ? r.start : null
    if (!name || pct === null || !start) continue
    const end = period === 'PERSONALIZADO' ? (typeof r.end === 'string' && DATE.test(r.end) && r.end >= start ? r.end : null) : periodEnd(period, start)
    if (!end) continue
    const sellerPcts: WalletCampaign['sellerPcts'] = []
    for (const x of Array.isArray(r.sellerPcts) ? r.sellerPcts.slice(0, 200) : []) {
      const o = (x ?? {}) as Record<string, unknown>
      const seller = typeof o.seller === 'string' ? o.seller.trim().slice(0, 120) : ''
      const p = typeof o.pct === 'number' && Number.isFinite(o.pct) && o.pct >= 0 && o.pct <= 200 ? Math.round(o.pct * 100) / 100 : null
      if (seller && p !== null && !sellerPcts.some((s) => foldName(s.seller) === foldName(seller))) sellerPcts.push({ seller, pct: p })
    }
    out.push({ id: typeof r.id === 'string' && /^[\w-]{6,60}$/.test(r.id) ? r.id : newId(), name, active: r.active !== false, pct, sellerPcts, period, start, end })
  }
  return out
}

const foldName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

/** % que o vendedor cobra do cliente nesta campanha: o dele, se tiver; senão o da campanha. */
export function pctFor(c: Pick<WalletCampaign, 'pct'> & { sellerPcts?: WalletCampaign['sellerPcts'] }, seller: string | null | undefined) {
  if (!seller) return c.pct
  const k = foldName(seller)
  return c.sellerPcts?.find((s) => foldName(s.seller) === k)?.pct ?? c.pct
}

/** Campanha ativa que vale na data (AAAA-MM-DD), para mostrar na cotação quanto cobrar do cliente. */
export function campaignOn(list: WalletCampaign[], date: string) {
  return list.find((c) => c.active && c.start <= date && date <= c.end) ?? null
}

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * Uma nota CIF: base (cotação; sem ela, a tabela; sem as duas, o CT-e), quanto cobrar do cliente (base + acréscimo) e
 * o saldo do vendedor (cobrado na nota − cobrar). Null quando ainda não há base (sem cotação, tabela nem CT-e).
 */
export function walletEntry(v: { nota: number; cte: number | null; quote: number | null; table: number | null }, pct: number) {
  const source = v.quote !== null && v.quote > 0 ? ('COTACAO' as const) : v.table !== null && v.table > 0 ? ('TABELA' as const) : v.cte !== null && v.cte > 0 ? ('CTE' as const) : null
  if (!source) return null
  const base = source === 'COTACAO' ? v.quote! : source === 'TABELA' ? v.table! : v.cte!
  const markup = r2((base * pct) / 100)
  const charge = r2(base + markup)
  return { source, base: r2(base), markup, charge, saldo: r2(v.nota - charge) }
}

export interface WalletMove {
  seller: string
  value: number
}

/** Saldo por vendedor: o que as notas geraram (a favor e contra), o usado e o disponível. */
export function walletBalances(entries: { seller: string; nota: number; cte: number; markup: number; saldo: number }[], moves: WalletMove[], pending: { seller: string; count: number }[] = []) {
  const by = new Map<string, { seller: string; notas: number; nota: number; cte: number; markup: number; credito: number; debito: number; movimentos: number; pendentes: number }>()
  const get = (s: string) => {
    let x = by.get(s)
    if (!x) by.set(s, (x = { seller: s, notas: 0, nota: 0, cte: 0, markup: 0, credito: 0, debito: 0, movimentos: 0, pendentes: 0 }))
    return x
  }
  for (const e of entries) {
    const x = get(e.seller)
    x.notas++
    x.nota += e.nota
    x.cte += e.cte
    x.markup += e.markup
    if (e.saldo >= 0) x.credito += e.saldo
    else x.debito += -e.saldo
  }
  for (const m of moves) get(m.seller).movimentos += m.value
  for (const p of pending) get(p.seller).pendentes += p.count
  return [...by.values()]
    .map((x) => ({ ...x, nota: r2(x.nota), cte: r2(x.cte), markup: r2(x.markup), credito: r2(x.credito), debito: r2(x.debito), movimentos: r2(x.movimentos), saldo: r2(x.credito - x.debito + x.movimentos) }))
    .sort((a, b) => b.saldo - a.saldo || a.seller.localeCompare(b.seller))
}
