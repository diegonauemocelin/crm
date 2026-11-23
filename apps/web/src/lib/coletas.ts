// Painel de coletas (TV do comercial): situação de cada coleta pelo relógio do computador.

export interface PickupRow {
  carrierId: string
  carrier: string
  unit: string | null
  unitId: string | null
  days: number[]
  cutoff: string
  pickup: string
  minutes: number
  note: string | null
  /** COLETA (a transportadora busca) ou DESPACHO (a empresa leva até ela). */
  mode?: 'COLETA' | 'DESPACHO'
}

export type PickupStatus = 'CARREGANDO' | 'CHEGANDO' | 'EM_SEGUIDA' | 'ABERTA' | 'CORTE_ENCERRADO' | 'COLETADO'

export interface BoardItem extends PickupRow {
  status: PickupStatus
  /** Minutos até o ponto de corte (negativo = já passou). */
  toCutoff: number
  /** Minutos até a chegada da transportadora (negativo = já chegou). */
  toPickup: number
}

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * Coletas de hoje, na ordem do dia: carregando agora primeiro, depois as próximas pela hora da coleta (a primeira é
 * "chegando", a segunda "em seguida") e por fim as já coletadas.
 */
export function board(rows: PickupRow[], now: Date): BoardItem[] {
  const day = now.getDay()
  const t = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const items = rows
    .filter((r) => r.days.includes(day))
    .map((r) => {
      const cut = mins(r.cutoff)
      const pick = mins(r.pickup)
      const status: PickupStatus = t >= pick + r.minutes ? 'COLETADO' : t >= pick ? 'CARREGANDO' : t >= cut ? 'CORTE_ENCERRADO' : 'ABERTA'
      return { ...r, status, toCutoff: cut - t, toPickup: pick - t }
    })
  const rank = (s: PickupStatus) => (s === 'CARREGANDO' ? 0 : s === 'COLETADO' ? 2 : 1)
  items.sort((a, b) => rank(a.status) - rank(b.status) || mins(a.pickup) - mins(b.pickup) || a.carrier.localeCompare(b.carrier))
  // Próximas a chegar: a primeira é "chegando", a segunda "em seguida" (a situação do corte continua no cartão).
  const upcoming = items.filter((i) => i.status === 'ABERTA' || i.status === 'CORTE_ENCERRADO')
  return items.map((i) => (i === upcoming[0] ? { ...i, status: 'CHEGANDO' as const } : i === upcoming[1] ? { ...i, status: 'EM_SEGUIDA' as const } : i))
}

/** "1 h 05 min", "12 min", "agora". */
export function span(minutes: number) {
  const m = Math.max(0, Math.floor(minutes))
  if (m < 1) return 'agora'
  const h = Math.floor(m / 60)
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

// ---------- Coletas agendadas pela expedição ----------

export interface ScheduledPickup {
  id: string
  /** AAAA-MM-DD */
  date: string
  period: 'MANHA' | 'TARDE'
  status: 'AGENDADA' | 'COLETANDO' | 'COLETADA' | 'CANCELADA'
  carrierId: string
  carrier: string
  unitId: string | null
  unit: string | null
  note: string | null
  createdByName: string
  createdAt: string
  statusByName: string | null
  statusAt: string | null
}

export const SCHEDULE_STATUS: Record<ScheduledPickup['status'], { label: string; badge: string }> = {
  AGENDADA: { label: 'Agendada', badge: 'border-sky-500/40 text-sky-700 dark:text-sky-300' },
  COLETANDO: { label: 'Coletando agora', badge: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' },
  COLETADA: { label: 'Coletada', badge: '' },
  CANCELADA: { label: 'Cancelada', badge: 'text-muted-foreground' },
}

/** Janela de cada período (para o aviso "está chegando a hora"): manhã 08:00–12:00, tarde 13:00–18:00. */
export const PERIOD_WINDOW: Record<ScheduledPickup['period'], { start: string; end: string }> = { MANHA: { start: '08:00', end: '12:00' }, TARDE: { start: '13:00', end: '18:00' } }

/**
 * Avisos falados do painel (comparando a lista de antes com a de agora): coleta agendada, transportadora coletando, hora
 * da coleta chegando (15 min antes da coleta fixa ou no início do período agendado). Cada aviso sai uma vez (chave).
 */
export function pickupAnnouncements(
  prev: { scheduled: ScheduledPickup[] } | null,
  cur: { scheduled: ScheduledPickup[]; items: BoardItem[] },
  now: Date,
  said: Set<string>,
): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = []
  const push = (key: string, text: string) => {
    if (said.has(key)) return
    said.add(key)
    out.push({ key, text })
  }
  const before = new Map((prev?.scheduled ?? []).map((s) => [s.id, s.status]))
  const t = now.getHours() * 60 + now.getMinutes()
  for (const s of cur.scheduled) {
    const per = s.period === 'MANHA' ? 'manhã' : 'tarde'
    if (prev && !before.has(s.id) && s.status === 'AGENDADA') push(`novo:${s.id}`, `Coleta agendada: ${s.carrier}, hoje à ${per}.`)
    if (s.status === 'COLETANDO' && before.get(s.id) !== 'COLETANDO') push(`coletando:${s.id}`, `Atenção: ${s.carrier} está coletando agora.`)
    if (s.status === 'AGENDADA' && mins(PERIOD_WINDOW[s.period].start) <= t && t < mins(PERIOD_WINDOW[s.period].end)) push(`hora:${s.id}`, `Hora da coleta agendada da ${s.carrier}: pode chegar a qualquer momento.`)
  }
  for (const i of cur.items) {
    const key = `${i.carrierId}-${i.unitId}-${i.pickup}`
    if (i.status === 'CARREGANDO') push(`carregando:${key}:${now.toDateString()}`, `Atenção: ${i.carrier} está coletando agora.`)
    else if (i.toPickup > 0 && i.toPickup <= 15) push(`chegando:${key}:${now.toDateString()}`, `A ${i.carrier} chega para coletar em ${Math.max(1, Math.round(i.toPickup))} minutos.`)
  }
  return out
}
