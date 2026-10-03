/** Indicadores do dashboard de Pré/Pós-Vendas. Função pura sobre as linhas já filtradas (testada). */
import { regionOf } from './br'
import { isOverdue, type ReturnStatus, type SaleStatus } from './regras'

export interface DashRow {
  leadAt: Date
  sellerId: string | null
  unitId: string | null
  originId: string | null
  customerTypeId: string | null
  state: string | null
  country: string
  brandIds: string[]
  partTypeIds: string[]
  forwarded: boolean
  forwardedAt: Date | null
  returnStatus: ReturnStatus | null
  returnedAt: Date | null
  saleStatus: SaleStatus
  lostReasonId: string | null
  saleValue: number | null
}

const NONE = 'none'
const pct = (part: number, total: number) => (total > 0 ? part / total : null)
const round2 = (n: number) => Math.round(n * 100) / 100

export function kpis(rows: DashRow[], alertHours: number, now = new Date()) {
  const total = rows.length
  const forwarded = rows.filter((r) => r.forwarded).length
  const returned = rows.filter((r) => r.returnStatus === 'SIM').length
  const sales = rows.filter((r) => r.saleStatus === 'SIM')
  const revenue = round2(sales.reduce((s, r) => s + (r.saleValue ?? 0), 0))
  const times = rows
    .filter((r) => r.forwardedAt && r.returnedAt && r.returnedAt >= r.forwardedAt)
    .map((r) => (r.returnedAt!.getTime() - r.forwardedAt!.getTime()) / 3_600_000)
  return {
    total,
    forwarded,
    forwardRate: pct(forwarded, total),
    returned,
    returnRate: pct(returned, forwarded),
    avgReturnHours: times.length ? round2(times.reduce((a, b) => a + b, 0) / times.length) : null,
    sales: sales.length,
    conversion: pct(sales.length, total),
    revenue,
    ticket: sales.length ? round2(revenue / sales.length) : null,
    lost: rows.filter((r) => r.saleStatus === 'NAO').length,
    negotiating: rows.filter((r) => r.saleStatus === 'NEGOCIACAO').length,
    overdue: rows.filter((r) => isOverdue(r, alertHours, now)).length,
  }
}

function countBy(rows: DashRow[], key: (r: DashRow) => string | string[] | null) {
  const map = new Map<string, { id: string; leads: number; sales: number; revenue: number }>()
  for (const r of rows) {
    const k = key(r)
    const keys = Array.isArray(k) ? (k.length ? k : [NONE]) : [k ?? NONE]
    for (const id of keys) {
      const e = map.get(id) ?? { id, leads: 0, sales: 0, revenue: 0 }
      e.leads++
      if (r.saleStatus === 'SIM') {
        e.sales++
        e.revenue = round2(e.revenue + (r.saleValue ?? 0))
      }
      map.set(id, e)
    }
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads)
}

/** Diário até 62 dias, semanal até ~1 ano, mensal acima disso. */
export function bucketOf(date: Date, granularity: 'dia' | 'semana' | 'mes') {
  const sp = new Date(date.getTime() - 3 * 3_600_000)
  if (granularity === 'mes') return sp.toISOString().slice(0, 7)
  if (granularity === 'semana') {
    const day = (sp.getUTCDay() + 6) % 7
    return new Date(sp.getTime() - day * 86_400_000).toISOString().slice(0, 10)
  }
  return sp.toISOString().slice(0, 10)
}

export function buildDashboard(current: DashRow[], previous: DashRow[], opts: { from: string; to: string; alertHours: number }) {
  const days = Math.round((Date.parse(opts.to) - Date.parse(opts.from)) / 86_400_000) + 1
  const granularity = days <= 62 ? 'dia' : days <= 400 ? 'semana' : 'mes'

  const timelineMap = new Map<string, { bucket: string; leads: number; sales: number; revenue: number }>()
  for (const r of current) {
    const b = bucketOf(r.leadAt, granularity)
    const e = timelineMap.get(b) ?? { bucket: b, leads: 0, sales: 0, revenue: 0 }
    e.leads++
    if (r.saleStatus === 'SIM') {
      e.sales++
      e.revenue = round2(e.revenue + (r.saleValue ?? 0))
    }
    timelineMap.set(b, e)
  }

  const lost = current.filter((r) => r.saleStatus === 'NAO')
  let acc = 0
  const pareto = countBy(lost, (r) => r.lostReasonId).map((e) => {
    acc += e.leads
    return { id: e.id, count: e.leads, cumulative: lost.length ? acc / lost.length : 0 }
  })

  const sellers = countBy(current, (r) => r.sellerId).map((e) => {
    const mine = current.filter((r) => (r.sellerId ?? NONE) === e.id)
    const k = kpis(mine, opts.alertHours)
    return { id: e.id, leads: k.total, forwarded: k.forwarded, returned: k.returned, returnRate: k.returnRate, avgReturnHours: k.avgReturnHours, sales: k.sales, revenue: k.revenue, conversion: k.conversion }
  })
  sellers.sort((a, b) => b.revenue - a.revenue || b.sales - a.sales || b.leads - a.leads)

  const units = countBy(current, (r) => r.unitId).map((e) => {
    const mine = current.filter((r) => (r.unitId ?? NONE) === e.id)
    const k = kpis(mine, opts.alertHours)
    return { id: e.id, leads: k.total, sales: k.sales, revenue: k.revenue, conversion: k.conversion, returnRate: k.returnRate }
  })

  return {
    granularity,
    byUnit: units,
    kpis: kpis(current, opts.alertHours),
    previousKpis: kpis(previous, opts.alertHours),
    timeline: [...timelineMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    byOrigin: countBy(current, (r) => r.originId),
    byCustomerType: countBy(current, (r) => r.customerTypeId),
    byState: countBy(current, (r) => (r.country !== 'BR' ? 'EX' : r.state)),
    byRegion: countBy(current, (r) => (r.country !== 'BR' ? 'Exterior' : regionOf(r.state))),
    byBrand: countBy(current, (r) => r.brandIds),
    byPartType: countBy(current, (r) => r.partTypeIds),
    lostReasons: pareto,
    sellers,
  }
}
