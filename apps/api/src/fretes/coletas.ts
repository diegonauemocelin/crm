// Coletas das transportadoras (painel de TV do comercial): ponto de corte (até que horas tirar pedido) e hora da coleta,
// por filial e dia da semana. Só validação aqui; a tela calcula a situação pelo relógio do computador.

export interface Pickup {
  unitId: string | null
  /** 0 = domingo … 6 = sábado. */
  days: number[]
  /** "HH:MM": último horário para tirar pedido e ainda ir nesta coleta. */
  cutoff: string
  /** "HH:MM": hora em que a transportadora chega para coletar. */
  pickup: string
  /** Minutos de carregamento depois da chegada (padrão 30). */
  minutes: number
  note: string | null
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** Limpa a lista que vem da tela; erro em texto simples quando um horário não faz sentido. */
export function cleanPickups(raw: unknown, unitIds: Set<string>): Pickup[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 40).map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>
    const cutoff = String(o.cutoff ?? '').trim()
    const pickup = String(o.pickup ?? '').trim()
    if (!HHMM.test(cutoff) || !HHMM.test(pickup)) throw new Error(`Coleta ${i + 1}: informe o ponto de corte e a hora da coleta (HH:MM).`)
    if (cutoff > pickup) throw new Error(`Coleta ${i + 1}: o ponto de corte (${cutoff}) passa da hora da coleta (${pickup}).`)
    const days = [...new Set((Array.isArray(o.days) ? o.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    if (!days.length) throw new Error(`Coleta ${i + 1}: escolha ao menos um dia da semana.`)
    const unitId = typeof o.unitId === 'string' && o.unitId ? o.unitId : null
    if (unitId && !unitIds.has(unitId)) throw new Error(`Coleta ${i + 1}: filial inválida.`)
    const minutes = Math.round(Number(o.minutes ?? 30))
    return {
      unitId,
      days,
      cutoff,
      pickup,
      minutes: Number.isFinite(minutes) && minutes >= 5 && minutes <= 600 ? minutes : 30,
      note: String(o.note ?? '').trim().slice(0, 120) || null,
    }
  })
}

// ---------- Coletas agendadas (transportadora que só vem quando a expedição agenda) ----------

export const SCHEDULE_PERIODS = ['MANHA', 'TARDE'] as const
export type SchedulePeriod = (typeof SCHEDULE_PERIODS)[number]
export const SCHEDULE_STATUSES = ['AGENDADA', 'COLETANDO', 'COLETADA', 'CANCELADA'] as const
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number]
export const PERIOD_LABEL: Record<SchedulePeriod, string> = { MANHA: 'Manhã', TARDE: 'Tarde' }

/** Data (AAAA-MM-DD) em São Paulo, com dias a somar (0 = hoje, 1 = amanhã). */
export function spDate(now: Date, plusDays = 0) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  if (!plusDays) return d
  return new Date(new Date(`${d}T12:00:00Z`).getTime() + plusDays * 86_400_000).toISOString().slice(0, 10)
}

/** Dia escolhido na tela: HOJE, AMANHA ou uma data AAAA-MM-DD (de hoje até 30 dias). */
export function scheduleDate(when: string, now: Date): string | null {
  if (when === 'HOJE') return spDate(now)
  if (when === 'AMANHA') return spDate(now, 1)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(when) || Number.isNaN(Date.parse(`${when}T12:00:00Z`))) return null
  return when >= spDate(now) && when <= spDate(now, 30) ? when : null
}

/** Mudança de situação permitida (o clique da expedição). Cancelada e coletada não voltam, exceto desfazer o "coletando". */
export function canMoveSchedule(from: string, to: ScheduleStatus) {
  if (from === to) return false
  if (from === 'AGENDADA') return to === 'COLETANDO' || to === 'COLETADA' || to === 'CANCELADA'
  if (from === 'COLETANDO') return to === 'COLETADA' || to === 'AGENDADA' || to === 'CANCELADA'
  return false
}

/** Desfazer o "Coletou" só logo depois do toque (tocou errado): 10 minutos. */
export const UNDO_COLLECTED_MS = 10 * 60_000
export function canUndoCollected(statusAt: Date | null, now: Date) {
  return !!statusAt && now.getTime() - statusAt.getTime() <= UNDO_COLLECTED_MS
}

/** Volumes e notas do "Coletou": números inteiros de 0 a 100.000; obrigatórios quando a transportadora pede. */
export function collectCounts(d: { volumes?: number | null; invoices?: number | null }, required: boolean): { volumes: number | null; invoices: number | null } {
  const one = (v: number | null | undefined, label: string) => {
    if (v === null || v === undefined) {
      if (required) throw new Error(`Informe a quantidade de ${label} entregues na coleta.`)
      return null
    }
    if (!Number.isInteger(v) || v < 0 || v > 100_000) throw new Error(`Quantidade de ${label} inválida.`)
    return v
  }
  return { volumes: one(d.volumes, 'volumes'), invoices: one(d.invoices, 'notas') }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Hora e dia da semana em São Paulo (para os avisos rodarem no servidor). */
export function spClock(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]))
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday ?? '')
  return { day, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) }
}

export interface PickupAlert {
  key: string
  kind: 'CORTE' | 'COLETA' | 'AGENDADA'
  carrierId: string
  carrier: string
  unitId: string | null
  /** HH:MM do corte, da coleta ou do início do período. */
  at: string
  pickup: string | null
}

/**
 * Avisos de 15 minutos antes: do ponto de corte e da chegada (coletas de horário fixo do dia) e do início do período
 * das coletas agendadas. Janela de 2 minutos (13 a 15 min antes) para não perder o aviso entre uma rodada e outra;
 * a chave evita repetir. Coleta já marcada (chegou ou coletou) não avisa a chegada.
 */
export function pickupAlerts(
  fixed: { carrierId: string; carrier: string; pickups: Pickup[] }[],
  scheduled: { id: string; carrierId: string; carrier: string; unitId: string | null; period: string; status: string; slot: string | null }[],
  clock: { day: number; minutes: number },
  date: string,
): PickupAlert[] {
  const out: PickupAlert[] = []
  const soon = (hhmm: string) => {
    const left = toMin(hhmm) - clock.minutes
    return left > 13 && left <= 15
  }
  for (const c of fixed) {
    for (const p of c.pickups) {
      if (!p.days.includes(clock.day)) continue
      const base = `${date}|${c.carrierId}|${p.unitId ?? '-'}|${p.pickup}`
      if (soon(p.cutoff)) out.push({ key: `${base}|corte`, kind: 'CORTE', carrierId: c.carrierId, carrier: c.carrier, unitId: p.unitId, at: p.cutoff, pickup: p.pickup })
      const marked = scheduled.some((s) => s.period === 'FIXA' && s.carrierId === c.carrierId && s.slot === p.pickup && (s.unitId ?? null) === (p.unitId ?? null) && (s.status === 'COLETANDO' || s.status === 'COLETADA'))
      if (!marked && soon(p.pickup)) out.push({ key: `${base}|coleta`, kind: 'COLETA', carrierId: c.carrierId, carrier: c.carrier, unitId: p.unitId, at: p.pickup, pickup: p.pickup })
    }
  }
  const START: Record<string, string> = { MANHA: '08:00', TARDE: '13:00' }
  for (const s of scheduled) {
    const start = START[s.period]
    if (!start || s.status !== 'AGENDADA' || !soon(start)) continue
    out.push({ key: `${date}|agendada|${s.id}`, kind: 'AGENDADA', carrierId: s.carrierId, carrier: s.carrier, unitId: s.unitId, at: start, pickup: null })
  }
  return out
}
