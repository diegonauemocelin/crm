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
