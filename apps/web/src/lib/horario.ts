/**
 * Horário comercial (WhatsApp › Regras e horário), igual ao do servidor: o tempo de espera do cliente só conta dentro
 * dele (sem a pausa do almoço, a noite e os dias fechados). Desligado: tempo corrido.
 */
export interface BusinessDay {
  start: string
  end: string
  pauseStart?: string
  pauseEnd?: string
}
export interface BusinessHours {
  enabled: boolean
  days: (BusinessDay | null)[]
}

const BRT_MS = 3 * 3_600_000
const DAY_MS = 86_400_000
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

function spans(d: BusinessDay | null | undefined): [number, number][] {
  if (!d) return []
  if (d.pauseStart && d.pauseEnd) return [[minutesOf(d.start), minutesOf(d.pauseStart)], [minutesOf(d.pauseEnd), minutesOf(d.end)]]
  return [[minutesOf(d.start), minutesOf(d.end)]]
}

/** Milissegundos de atendimento entre dois instantes. */
export function businessMs(h: BusinessHours | null | undefined, from: number, to: number) {
  if (to <= from) return 0
  if (!h?.enabled) return to - from
  let total = 0
  let day = Math.floor((from - BRT_MS) / DAY_MS) * DAY_MS + BRT_MS
  for (let guard = 0; day < to && guard < 800; guard++, day += DAY_MS) {
    const wd = new Date(day - BRT_MS).getUTCDay()
    for (const [s, e] of spans(h.days[wd])) {
      const a = Math.max(day + s * 60_000, from)
      const b = Math.min(day + e * 60_000, to)
      if (b > a) total += b - a
    }
  }
  return total
}

/** Minutos de espera desde a mensagem do cliente, contando só o horário comercial. */
export function waitingMinutes(h: BusinessHours | null | undefined, sinceIso: string, now = Date.now()) {
  return Math.max(0, Math.floor(businessMs(h, Date.parse(sinceIso), now) / 60_000))
}
