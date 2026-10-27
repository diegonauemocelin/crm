/**
 * Horário de acesso do perfil: em quais dias e horas quem tem o perfil pode entrar no sistema (computador e app).
 * Fora dele, o login é recusado e quem já estava dentro é desconectado. Horário de Brasília. O Administrador não tem
 * limite (para ninguém ficar trancado para fora).
 */
export interface DayWindow {
  /** "HH:MM" */
  from: string
  to: string
}

export interface LoginHours {
  enabled: boolean
  /** Índice 0 = domingo … 6 = sábado; null = não entra nesse dia. */
  days: (DayWindow | null)[]
}

export const DEFAULT_LOGIN_HOURS: LoginHours = {
  enabled: false,
  days: [null, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '08:00', to: '12:00' }],
}

const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))

/** Lê o que veio do banco ou da tela; descarta o que não faz sentido. */
export function cleanLoginHours(raw: unknown): LoginHours | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { enabled?: unknown; days?: unknown }
  const days = Array.isArray(r.days) ? r.days : []
  const clean = Array.from({ length: 7 }, (_, i) => {
    const d = days[i] as { from?: unknown; to?: unknown } | null | undefined
    if (!d || typeof d.from !== 'string' || typeof d.to !== 'string' || !HHMM.test(d.from) || !HHMM.test(d.to) || minutes(d.to) <= minutes(d.from)) return null
    return { from: d.from, to: d.to }
  })
  return { enabled: r.enabled === true, days: clean }
}

/** Dia da semana e minuto do dia em Brasília. */
function spNow(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) }
}

/** Pode entrar agora? Sem horário ligado (ou Administrador), sempre pode. */
export function withinLoginHours(raw: unknown, isSystem: boolean, now = new Date()) {
  if (isSystem) return true
  const h = cleanLoginHours(raw)
  if (!h?.enabled) return true
  const { day, minute } = spNow(now)
  const w = h.days[day]
  return !!w && minute >= minutes(w.from) && minute < minutes(w.to)
}

/** Texto para quem foi barrado: o horário de hoje ou que hoje não tem acesso. */
export function outsideHoursMessage(raw: unknown, now = new Date()) {
  const h = cleanLoginHours(raw)
  const { day } = spNow(now)
  const w = h?.days[day]
  return w ? `Fora do horário de acesso do seu perfil. Hoje (${DAY_NAMES[day]}) o acesso vai das ${w.from} às ${w.to}.` : `Fora do horário de acesso do seu perfil: ${DAY_NAMES[day]} não tem acesso.`
}
