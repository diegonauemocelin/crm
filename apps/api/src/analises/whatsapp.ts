/**
 * Análises: medidas do WhatsApp, calculadas a partir dos atendimentos e das vezes do cliente (whatsapp/metricas.ts,
 * a mesma regra do painel do WhatsApp). Funções puras, testadas em test/analises.spec.ts.
 */
import { localSlot, type Session, type Turn } from '../whatsapp/metricas'
import { chaveTempo, type DimId, type Filtros, type Linha, TEMPO, VAZIO } from './modelo'

/** Dados da conversa que viram dimensão: filial (do número) e vendedor ligado à conversa. */
export interface ConversaInfo {
  filial: string | null
  vendedor: string | null
}

const QUINZE_MIN = 15 * 60_000
export const WA_MEDIDAS = ['wa_atendimentos', 'wa_recebidos', 'wa_primeira_resposta', 'wa_pct_15', 'wa_sem_resposta'] as const

function mediana(v: number[]): number | null {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function chaveDe(dim: DimId, conversa: string, at: Date, info: Map<string, ConversaInfo>): string {
  if (TEMPO.includes(dim)) return chaveTempo(dim, localSlot(at).day)
  const c = info.get(conversa)
  const v = dim === 'filial' ? c?.filial : dim === 'vendedor' ? c?.vendedor : null
  return v ?? VAZIO
}

function passa(filtros: Filtros, conversa: string, at: Date, info: Map<string, ConversaInfo>): boolean {
  for (const [dim, valores] of Object.entries(filtros) as [DimId, string[]][]) {
    if (!valores.includes(chaveDe(dim, conversa, at, info))) return false
  }
  return true
}

/**
 * Agrega os atendimentos e as primeiras vezes do cliente que começaram na janela [inicio, fim), por dimensão.
 * Primeira resposta: mediana dos minutos em horário comercial; % em 15 min sobre as primeiras vezes respondidas.
 */
export function agregarWhatsapp(o: { sessions: Session[]; turns: Turn[]; info: Map<string, ConversaInfo>; inicio: Date; fim: Date; dims: DimId[]; filtros: Filtros; medidas: string[] }): Linha[] {
  const dentro = (d: Date) => d >= o.inicio && d < o.fim
  type Acc = { chaves: string[]; atend: number; receb: number; primeiras: number[]; semResposta: number }
  const grupos = new Map<string, Acc>()
  const acc = (conversa: string, at: Date) => {
    const chaves = o.dims.map((d) => chaveDe(d, conversa, at, o.info))
    const k = chaves.join('\u0001')
    let g = grupos.get(k)
    if (!g) grupos.set(k, (g = { chaves, atend: 0, receb: 0, primeiras: [], semResposta: 0 }))
    return g
  }
  for (const s of o.sessions) {
    if (!dentro(s.startAt) || !passa(o.filtros, s.conversationId, s.startAt, o.info)) continue
    const g = acc(s.conversationId, s.startAt)
    g.atend++
    if (s.startedBy === 'cliente') g.receb++
  }
  for (const t of o.turns) {
    if (!t.first || !dentro(t.at) || !passa(o.filtros, t.conversationId, t.at, o.info)) continue
    const g = acc(t.conversationId, t.at)
    if (t.businessMs === null) g.semResposta++
    else g.primeiras.push(t.businessMs)
  }
  if (!o.dims.length && !grupos.size) grupos.set('', { chaves: [], atend: 0, receb: 0, primeiras: [], semResposta: 0 })
  return [...grupos.values()].map((g) => {
    const med = mediana(g.primeiras)
    const todos: Record<string, number | null> = {
      wa_atendimentos: g.atend,
      wa_recebidos: g.receb,
      wa_primeira_resposta: med === null ? null : Math.round((med / 60_000) * 10) / 10,
      wa_pct_15: g.primeiras.length ? g.primeiras.filter((ms) => ms <= QUINZE_MIN).length / g.primeiras.length : null,
      wa_sem_resposta: g.semResposta,
    }
    return { chaves: g.chaves, valores: Object.fromEntries(o.medidas.map((m) => [m, todos[m] ?? null])) }
  })
}
