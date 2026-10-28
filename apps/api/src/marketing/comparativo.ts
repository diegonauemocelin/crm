/**
 * Comparativo mensal do Dashboard executivo: faturamento do mês anterior x mês em andamento, dia a dia (acumulado), e a
 * projeção até o fim do mês pelo ritmo atual (média por dia até hoje × dias do mês). Por canal (atendimento,
 * e-commerce, marketplace) e no total. Funções puras, testadas.
 */
import type { MapOrigin } from './mapa'

export type Channel = Exclude<MapOrigin, 'tudo'>
export const CHANNELS: Channel[] = ['atendimento', 'ecommerce', 'marketplace']

/** Uma venda: atendimento com venda (data do atendimento) ou pedido pago da loja (data do pedido). */
export interface SaleRow {
  source: Channel
  at: Date
  value: number
}

export interface ChannelSummary {
  key: Channel | 'tudo'
  /** Mês anterior inteiro. */
  previous: { revenue: number; sales: number }
  /** Mês anterior até o mesmo dia de hoje (para comparar o ritmo). */
  previousToDate: { revenue: number; sales: number }
  /** Mês em andamento até hoje. */
  current: { revenue: number; sales: number }
  /** Faturamento previsto no fim do mês, pelo ritmo de hoje. */
  projection: number
  /** Projeção sobre o mês anterior inteiro (0.12 = 12% a mais); null sem base. */
  growth: number | null
  /** Mês atual sobre o anterior no mesmo ponto do mês; null sem base. */
  pace: number | null
}

export interface ComparisonPoint {
  day: number
  current: number | null
  previous: number | null
  projection: number | null
}

export interface Comparison {
  months: { current: string; previous: string }
  today: number
  daysInMonth: number
  channel: MapOrigin
  series: ComparisonPoint[]
  channels: ChannelSummary[]
}

const SP_OFFSET = 3 * 3_600_000
/** Data no horário de Brasília, como AAAA-MM-DD. */
const spDay = (d: Date) => new Date(d.getTime() - SP_OFFSET).toISOString().slice(0, 10)
const daysOf = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}
export function previousMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`
}

/** Início do mês anterior e fim do mês atual (UTC), para buscar as vendas. */
export function comparisonRange(now = new Date()) {
  const month = spDay(now).slice(0, 7)
  const prev = previousMonth(month)
  const start = new Date(Date.parse(`${prev}-01T00:00:00Z`) + SP_OFFSET)
  const end = new Date(Date.parse(`${month}-01T00:00:00Z`) + daysOf(month) * 86_400_000 + SP_OFFSET)
  return { month, prev, start, end }
}

const ratio = (a: number, b: number) => (b > 0 ? a / b - 1 : null)

export function buildComparison(rows: SaleRow[], channel: MapOrigin, now = new Date()): Comparison {
  const { month, prev } = comparisonRange(now)
  const today = Number(spDay(now).slice(8, 10))
  const daysInMonth = daysOf(month)
  const daysPrev = daysOf(prev)
  // Faturamento e vendas por canal, mês e dia.
  const cell = () => ({ revenue: Array<number>(32).fill(0), sales: Array<number>(32).fill(0) })
  const by = new Map<string, ReturnType<typeof cell>>()
  for (const r of rows) {
    const d = spDay(r.at)
    const m = d.slice(0, 7)
    if (m !== month && m !== prev) continue
    const key = `${r.source}|${m}`
    const c = by.get(key) ?? cell()
    const day = Number(d.slice(8, 10))
    c.revenue[day]! += r.value
    c.sales[day]! += 1
    by.set(key, c)
  }
  const sum = (keys: Channel[], m: string, upTo: number) => {
    let revenue = 0
    let sales = 0
    for (const k of keys) {
      const c = by.get(`${k}|${m}`)
      if (!c) continue
      for (let d = 1; d <= upTo; d++) {
        revenue += c.revenue[d]!
        sales += c.sales[d]!
      }
    }
    return { revenue: Math.round(revenue * 100) / 100, sales }
  }
  const summary = (key: Channel | 'tudo'): ChannelSummary => {
    const keys = key === 'tudo' ? CHANNELS : [key]
    const previous = sum(keys, prev, daysPrev)
    const previousToDate = sum(keys, prev, Math.min(today, daysPrev))
    const current = sum(keys, month, today)
    const projection = Math.round((current.revenue / today) * daysInMonth * 100) / 100
    return { key, previous, previousToDate, current, projection, growth: ratio(projection, previous.revenue), pace: ratio(current.revenue, previousToDate.revenue) }
  }
  const keys = channel === 'tudo' ? CHANNELS : [channel]
  const series: ComparisonPoint[] = []
  let cur = 0
  let before = 0
  const perDay = sum(keys, month, today).revenue / today
  for (let d = 1; d <= Math.max(daysInMonth, daysPrev); d++) {
    if (d <= today) cur += sum(keys, month, d).revenue - sum(keys, month, d - 1).revenue
    if (d <= daysPrev) before += sum(keys, prev, d).revenue - sum(keys, prev, d - 1).revenue
    series.push({
      day: d,
      current: d <= today ? Math.round(cur * 100) / 100 : null,
      previous: d <= daysPrev ? Math.round(before * 100) / 100 : null,
      // A projeção sai do acumulado de hoje e segue a média por dia até o fim do mês.
      projection: d >= today && d <= daysInMonth ? Math.round((cur + perDay * (d - today)) * 100) / 100 : null,
    })
  }
  return { months: { current: month, previous: prev }, today, daysInMonth, channel, series, channels: [...CHANNELS.map(summary), summary('tudo')] }
}
