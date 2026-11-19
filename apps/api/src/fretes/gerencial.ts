/**
 * Visão gerencial dos fretes (funções puras, testadas em test/fretes-gerencial.spec.ts): soma os CT-es do período com o
 * frete cobrado nas notas CIF que eles transportam e o esperado pela tabela. Serve o painel gerencial (Relatórios de
 * frete) e o resumo semanal por e-mail.
 *
 * - Cobrado no CT-e: o que a transportadora cobra da empresa.
 * - Cobrado na nota (CIF): o frete que o vendedor destacou na NF-e (a empresa paga a transportadora e cobra do cliente).
 * - Esperado: cotação escolhida no pedido ou tabela vigente na data do CT-e (conciliação).
 */

export interface CteFact {
  carrier: string
  month: string
  total: number
  expected: number | null
  recStatus: string
  credit: number | null
  weight: number | null
  /** Frete das NF-es CIF do CT-e (null: nenhuma nota CIF importada). */
  nota: number | null
  seller: string | null
  uf: string | null
  city: string | null
  customer: string | null
}

/** Ranking por um campo (UF, cidade, cliente): CT-es, cobrado, nota CIF e peso. */
type Rank = { name: string; ctes: number; cobrado: number; nota: number; kg: number }
function addRank(map: Map<string, Rank>, name: string, r: CteFact) {
  const x = map.get(name) ?? { name, ctes: 0, cobrado: 0, nota: 0, kg: 0 }
  x.ctes++
  x.cobrado += r.total
  x.nota += r.nota ?? 0
  x.kg += r.weight ?? 0
  map.set(name, x)
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** Nota CIF × CT-e: abaixo (vendedor cobrou menos que a transportadora cobrou), acima, ou igual dentro da folga. */
export function notaVsCte(nota: number, cte: number, tolerance: number): 'MENOS' | 'MAIS' | 'IGUAL' {
  const d = nota - cte
  return d < -tolerance ? 'MENOS' : d > tolerance ? 'MAIS' : 'IGUAL'
}

export function summarize(rows: CteFact[], tolerance: number) {
  const t = { ctes: 0, cobrado: 0, esperado: 0, comReferencia: 0, acimaTabela: 0, acimaTabelaCtes: 0, divergentes: 0, conciliados: 0, credito: 0, kg: 0 }
  const n = { ctes: 0, nota: 0, cte: 0, menos: 0, menosValor: 0, mais: 0, maisValor: 0, iguais: 0 }
  const months = new Map<string, { month: string; cobrado: number; nota: number; esperado: number }>()
  const carriers = new Map<string, { name: string; ctes: number; cobrado: number; nota: number; acimaTabela: number; divergentes: number }>()
  const sellers = new Map<string, { name: string; ctes: number; nota: number; cte: number; menos: number; menosValor: number; mais: number; maisValor: number }>()
  const ufs = new Map<string, Rank>()
  const cities = new Map<string, Rank>()
  const customers = new Map<string, Rank>()
  for (const r of rows) {
    addRank(ufs, r.uf || '—', r)
    addRank(cities, r.city ? `${r.city}${r.uf ? `/${r.uf}` : ''}` : '—', r)
    addRank(customers, r.customer?.trim() || 'Não informado', r)
    t.ctes++
    t.cobrado += r.total
    if (r.expected !== null) {
      t.esperado += r.expected
      t.comReferencia++
      if (r.total - r.expected > tolerance) (t.acimaTabela += r.total - r.expected), t.acimaTabelaCtes++
    }
    if (r.recStatus === 'DIVERGENTE') t.divergentes++
    if (r.recStatus === 'CONCILIADO') t.conciliados++
    t.credito += r.credit ?? 0
    t.kg += r.weight ?? 0
    const m = months.get(r.month) ?? { month: r.month, cobrado: 0, nota: 0, esperado: 0 }
    m.cobrado += r.total
    m.esperado += r.expected ?? 0
    m.nota += r.nota ?? 0
    months.set(r.month, m)
    const c = carriers.get(r.carrier) ?? { name: r.carrier, ctes: 0, cobrado: 0, nota: 0, acimaTabela: 0, divergentes: 0 }
    c.ctes++
    c.cobrado += r.total
    c.nota += r.nota ?? 0
    if (r.expected !== null && r.total - r.expected > tolerance) c.acimaTabela += r.total - r.expected
    if (r.recStatus === 'DIVERGENTE') c.divergentes++
    carriers.set(r.carrier, c)
    if (r.nota === null) continue
    const cmp = notaVsCte(r.nota, r.total, tolerance)
    n.ctes++
    n.nota += r.nota
    n.cte += r.total
    if (cmp === 'MENOS') (n.menos++, (n.menosValor += r.total - r.nota))
    else if (cmp === 'MAIS') (n.mais++, (n.maisValor += r.nota - r.total))
    else n.iguais++
    const key = r.seller?.trim() || 'Sem vendedor na nota'
    const s = sellers.get(key) ?? { name: key, ctes: 0, nota: 0, cte: 0, menos: 0, menosValor: 0, mais: 0, maisValor: 0 }
    s.ctes++
    s.nota += r.nota
    s.cte += r.total
    if (cmp === 'MENOS') (s.menos++, (s.menosValor += r.total - r.nota))
    if (cmp === 'MAIS') (s.mais++, (s.maisValor += r.nota - r.total))
    sellers.set(key, s)
  }
  const top = (m: Map<string, Rank>, n: number) =>
    [...m.values()]
      .sort((a, b) => b.cobrado - a.cobrado)
      .slice(0, n)
      .map((x) => round({ ...x, pctNota: x.cobrado > 0 ? (x.nota / x.cobrado) * 100 : null }))
  const round = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])) as T
  return {
    totals: round({
      ...t,
      porKg: t.kg > 0 ? t.cobrado / t.kg : null,
      pctDivergente: t.ctes ? (t.divergentes / t.ctes) * 100 : null,
    }),
    nota: round({ ...n, resultado: n.nota - n.cte, pctMenos: n.ctes ? (n.menos / n.ctes) * 100 : null }),
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(round),
    carriers: [...carriers.values()]
      .sort((a, b) => b.cobrado - a.cobrado)
      .map((c) => round({ ...c, pctDivergente: c.ctes ? (c.divergentes / c.ctes) * 100 : 0 })),
    ufs: top(ufs, 27),
    cities: top(cities, 20),
    customers: top(customers, 20),
    sellers: [...sellers.values()].sort((a, b) => b.menosValor - a.menosValor || b.ctes - a.ctes).map((s) => round({ ...s, resultado: s.nota - s.cte })),
  }
}
export type FreightSummary = ReturnType<typeof summarize>
