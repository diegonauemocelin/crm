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
