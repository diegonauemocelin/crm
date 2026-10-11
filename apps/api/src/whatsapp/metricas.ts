/**
 * Métricas de atendimento do WhatsApp (funções puras, testáveis). Definições:
 * - Atendimento: começa quando o cliente escreve depois de mais de 24 h sem conversa (ou na primeira mensagem);
 *   se a empresa escreve primeiro depois desse intervalo, é um atendimento iniciado pela empresa.
 * - Vez do cliente: uma ou mais mensagens seguidas do cliente. Tempo de resposta = da primeira mensagem dessa vez
 *   até a próxima mensagem da empresa. Primeira resposta = a da primeira vez do atendimento.
 * - Tempo comercial: só conta seg. a sex. das 8h às 18h e sáb. das 8h às 12h (horário de Brasília).
 */

export const SESSION_GAP_MS = 24 * 3_600_000
const BRT = -3 * 3_600_000
/** Horário comercial por dia da semana (0 = domingo): [início, fim] em horas. */
export const BUSINESS: Record<number, [number, number] | null> = { 0: null, 1: [8, 18], 2: [8, 18], 3: [8, 18], 4: [8, 18], 5: [8, 18], 6: [8, 12] }

export interface Msg {
  conversationId: string
  fromMe: boolean
  sentAt: Date
  /** Usuário do CRM que enviou (null = pelo celular, ou mensagem do cliente). */
  sentById: string | null
  type: string
}

export interface Turn {
  conversationId: string
  at: Date
  respondedAt: Date | null
  responder: string | null
  /** Primeira vez do cliente no atendimento. */
  first: boolean
  ms: number | null
  businessMs: number | null
}

export interface Session {
  conversationId: string
  startAt: Date
  startedBy: 'cliente' | 'empresa'
}

/** Milissegundos de horário comercial entre dois instantes. */
export function businessMs(a: Date, b: Date): number {
  if (b <= a) return 0
  let total = 0
  // Dia a dia, em horário de Brasília.
  let dayStart = Math.floor((a.getTime() + BRT) / 86_400_000) * 86_400_000
  const endLocal = b.getTime() + BRT
  const startLocal = a.getTime() + BRT
  for (let guard = 0; dayStart < endLocal && guard < 400; guard++, dayStart += 86_400_000) {
    const wd = new Date(dayStart).getUTCDay()
    const h = BUSINESS[wd]
    if (h) {
      const s = Math.max(dayStart + h[0] * 3_600_000, startLocal)
      const e = Math.min(dayStart + h[1] * 3_600_000, endLocal)
      if (e > s) total += e - s
    }
  }
  return total
}

/** Hora e dia da semana em Brasília (para o mapa de calor). */
export function localSlot(d: Date) {
  const l = new Date(d.getTime() + BRT)
  return { weekday: l.getUTCDay(), hour: l.getUTCHours(), day: l.toISOString().slice(0, 10) }
}

export function inBusiness(d: Date) {
  const { weekday, hour } = localSlot(d)
  const h = BUSINESS[weekday]
  return !!h && hour >= h[0] && hour < h[1]
}

/** Atendimentos e vezes do cliente a partir das mensagens (já ordenadas por conversa e horário). */
export function analyze(messages: Msg[]) {
  const sessions: Session[] = []
  const turns: Turn[] = []
  let conv: string | null = null
  let prev: Date | null = null
  let waiting: Turn | null = null
  let firstOfSession = false
  const close = () => {
    if (waiting) turns.push(waiting)
    waiting = null
  }
  for (const m of messages) {
    if (m.conversationId !== conv) {
      close()
      conv = m.conversationId
      prev = null
    }
    const newSession = !prev || m.sentAt.getTime() - prev.getTime() > SESSION_GAP_MS
    if (newSession) {
      close()
      sessions.push({ conversationId: m.conversationId, startAt: m.sentAt, startedBy: m.fromMe ? 'empresa' : 'cliente' })
      firstOfSession = true
    }
    if (!m.fromMe) {
      if (!waiting) {
        waiting = { conversationId: m.conversationId, at: m.sentAt, respondedAt: null, responder: null, first: firstOfSession, ms: null, businessMs: null }
        firstOfSession = false
      }
    } else {
      if (waiting) {
        waiting.respondedAt = m.sentAt
        waiting.responder = m.sentById ?? 'celular'
        waiting.ms = m.sentAt.getTime() - waiting.at.getTime()
        waiting.businessMs = businessMs(waiting.at, m.sentAt)
        turns.push(waiting)
        waiting = null
      }
      // A empresa falou antes de o cliente escrever neste atendimento: a próxima vez do cliente não é "primeira".
      firstOfSession = false
    }
    prev = m.sentAt
  }
  close()
  return { sessions, turns }
}

export function stats(values: number[]) {
  if (!values.length) return { count: 0, avg: null, median: null, p90: null }
  const v = [...values].sort((a, b) => a - b)
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))]!
  return { count: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, median: q(0.5), p90: q(0.9) }
}

/** % das primeiras respostas dentro de cada meta (5 min, 15 min, 1 h, 4 h). */
export function slaBuckets(ms: number[]) {
  const limits = [5, 15, 60, 240].map((m) => m * 60_000)
  const n = ms.length
  return limits.map((l) => ({ minutes: l / 60_000, share: n ? ms.filter((x) => x <= l).length / n : null }))
}

/** Faixas de espera de quem ainda aguarda resposta. */
export function waitingBuckets(waitMs: number[]) {
  const b = { ate1h: 0, ate4h: 0, ate24h: 0, mais24h: 0 }
  for (const w of waitMs) {
    if (w <= 3_600_000) b.ate1h++
    else if (w <= 4 * 3_600_000) b.ate4h++
    else if (w <= 24 * 3_600_000) b.ate24h++
    else b.mais24h++
  }
  return b
}

const fmtMin = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`)
const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/**
 * Leitura automática: o que mais chama atenção no período, em frases curtas.
 * Só entra o que tem amostra suficiente (para não tirar conclusão de 2 casos).
 */
export function insights(i: {
  turns: Turn[]
  waitingOver24h: number
  sellers: { name: string; median: number | null; count: number }[]
  overallMedian: number | null
  outsideShare: number | null
  heat: number[][]
  frtSlowHour: { weekday: number; hour: number; median: number; count: number } | null
  conversion: number | null
  previousMedian: number | null
}) {
  const out: { tone: 'bom' | 'atencao' | 'neutro'; text: string }[] = []
  if (i.waitingOver24h > 0) out.push({ tone: 'atencao', text: `${i.waitingOver24h} conversa(s) de cliente esperando resposta há mais de 24 h. Vale resolver primeiro.` })
  if (i.overallMedian !== null && i.previousMedian !== null && i.previousMedian > 0) {
    const d = (i.overallMedian - i.previousMedian) / i.previousMedian
    if (Math.abs(d) >= 0.15) out.push({ tone: d < 0 ? 'bom' : 'atencao', text: `A primeira resposta típica ${d < 0 ? 'ficou mais rápida' : 'ficou mais lenta'}: ${fmtMin(i.overallMedian)} contra ${fmtMin(i.previousMedian)} no período anterior.` })
  }
  if (i.frtSlowHour && i.frtSlowHour.count >= 5 && i.overallMedian && i.frtSlowHour.median > i.overallMedian * 1.5) {
    out.push({ tone: 'atencao', text: `O horário mais lento é ${WEEKDAY[i.frtSlowHour.weekday]} às ${i.frtSlowHour.hour}h: primeira resposta típica de ${fmtMin(i.frtSlowHour.median)} (${i.frtSlowHour.count} atendimentos).` })
  }
  const ranked = i.sellers.filter((s) => s.count >= 5 && s.median !== null)
  if (ranked.length >= 2 && i.overallMedian) {
    const slow = [...ranked].sort((a, b) => b.median! - a.median!)[0]!
    const fast = [...ranked].sort((a, b) => a.median! - b.median!)[0]!
    if (slow.median! > i.overallMedian * 1.5) out.push({ tone: 'atencao', text: `${slow.name} responde em ${fmtMin(slow.median!)} (típico), acima da equipe (${fmtMin(i.overallMedian)}).` })
    if (fast !== slow) out.push({ tone: 'bom', text: `${fast.name} é quem responde mais rápido: ${fmtMin(fast.median!)} (típico).` })
  }
  if (i.outsideShare !== null && i.outsideShare >= 0.25) out.push({ tone: 'neutro', text: `${Math.round(i.outsideShare * 100)}% das mensagens de clientes chegam fora do horário comercial. Uma mensagem automática de ausência ou um plantão podem ajudar.` })
  // Pico de volume (dia/hora com mais mensagens).
  let peak = { w: 0, h: 0, n: 0 }
  i.heat.forEach((row, w) => row.forEach((n, h) => (n > peak.n ? (peak = { w, h, n }) : null)))
  if (peak.n >= 10) out.push({ tone: 'neutro', text: `O pico de mensagens é ${WEEKDAY[peak.w]} às ${peak.h}h: bom horário para ter mais gente atendendo.` })
  if (i.conversion !== null) out.push({ tone: i.conversion >= 0.2 ? 'bom' : 'neutro', text: `${Math.round(i.conversion * 100)}% das pré-vendas do WhatsApp viraram venda no período.` })
  return out.slice(0, 6)
}
