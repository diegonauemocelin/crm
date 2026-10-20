/** Marketing Inteligente: períodos, período anterior equivalente e agrupamento (dia, semana, mês, trimestre, ano). */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000
/** Horário de Brasília (sem horário de verão desde 2019), o mesmo dos outros painéis. */
const SP_OFFSET = 3 * 3_600_000
export const MAX_DAYS = 731

export const GRANULARITIES = ['dia', 'semana', 'mes', 'trimestre', 'ano'] as const
export type Granularity = (typeof GRANULARITIES)[number]

export interface Period {
  from: string
  to: string
  days: number
  start: Date
  end: Date
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
export const todaySP = (now = Date.now()) => new Date(now - SP_OFFSET).toISOString().slice(0, 10)

export function periodOf(from: string, to: string): Period {
  return {
    from,
    to,
    days: Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1,
    start: new Date(`${from}T00:00:00-03:00`),
    end: new Date(Date.parse(`${to}T00:00:00-03:00`) + DAY),
  }
}

/** Período pedido (padrão: últimos 30 dias até hoje), com no máximo 2 anos. Datas trocadas são desviradas. */
export function makePeriod(from?: string, to?: string, now = Date.now()): Period {
  let t = to && DATE.test(to) ? to : todaySP(now)
  let f = from && DATE.test(from) ? from : addDays(t, -29)
  if (f > t) [f, t] = [t, f]
  const min = addDays(t, -(MAX_DAYS - 1))
  return periodOf(f < min ? min : f, t)
}

/** Período anterior equivalente: o mesmo número de dias, logo antes. */
export function previousPeriod(p: Period): Period {
  const to = addDays(p.from, -1)
  return periodOf(addDays(to, -(p.days - 1)), to)
}

export function autoGranularity(days: number): Granularity {
  return days <= 62 ? 'dia' : days <= 200 ? 'semana' : days <= 800 ? 'mes' : 'trimestre'
}

export function parseGranularity(g: string | undefined, days: number): Granularity {
  return (GRANULARITIES as readonly string[]).includes(g ?? '') ? (g as Granularity) : autoGranularity(days)
}

/** Data local (Brasília) "aaaa-mm-dd" de um instante. */
export const localDay = (d: Date) => new Date(d.getTime() - SP_OFFSET).toISOString().slice(0, 10)

/** Chave do grupo de um dia local "aaaa-mm-dd": o próprio dia, a segunda-feira da semana, "aaaa-mm", "aaaa-T1" ou "aaaa". */
export function bucketOfDay(day: string, g: Granularity): string {
  if (g === 'dia') return day
  if (g === 'mes') return day.slice(0, 7)
  if (g === 'ano') return day.slice(0, 4)
  if (g === 'trimestre') return `${day.slice(0, 4)}-T${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`
  const d = new Date(`${day}T00:00:00Z`)
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10)
}

export const bucketOf = (d: Date, g: Granularity) => bucketOfDay(localDay(d), g)

/** Todos os grupos do período, em ordem (o gráfico não pula períodos sem dados). */
export function bucketsOf(p: Period, g: Granularity): string[] {
  const out: string[] = []
  for (let day = p.from; day <= p.to; day = addDays(day, 1)) {
    const b = bucketOfDay(day, g)
    if (out[out.length - 1] !== b) out.push(b)
  }
  return out
}

export const inPeriod = (d: Date | null | undefined, p: Period) => !!d && d >= p.start && d < p.end
export const dayInPeriod = (day: string, p: Period) => day >= p.from && day <= p.to
