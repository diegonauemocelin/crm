/**
 * Power BI (fase 1): regras puras da API de BI, sem Nest nem banco (testadas em apps/api/test/bi.spec.ts).
 * Chave de acesso, cursor da paginação, janela de datas, limite de pedidos por chave e os atendimentos do WhatsApp.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// ---------- Chave de acesso ----------

export const KEY_PREFIX = 'crmbi_'
/** crmbi_ + 32 bytes aleatórios em base64url (43 caracteres). */
export const KEY_RE = /^crmbi_[A-Za-z0-9_-]{43}$/

export function newKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** Só o resumo (sha256, hex) fica no banco. */
export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

/** Começo da chave mostrado na lista (reconhecer qual é, sem dar para usar). */
export function keyPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 4)
}

/** Comparação em tempo constante de dois resumos (mesmo tamanho; tamanhos diferentes = falso). */
export function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// ---------- Datas ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Data AAAA-MM-DD válida (calendário de verdade) ou null. */
export function parseDate(s: string | null | undefined): string | null {
  if (!s || !DATE_RE.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

/** Hoje no horário de Brasília (AAAA-MM-DD). */
export function todaySP(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** Primeiro dia da janela padrão: o mesmo dia, N meses antes (fim de mês ajustado: 31/03 - 1 mês = 28 ou 29/02). */
export function windowStart(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const total = y * 12 + (m - 1) - months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export const DEFAULT_MONTHS = 24
export const MAX_MONTHS = 120
export const MAX_PAGE = 50_000

// ---------- Cursor (paginação por chave) ----------

/**
 * Posição da leitura: a última chave entregue e o filtro da primeira página congelado (a janela não muda se a
 * leitura atravessar a meia-noite). Não é segredo: só diz de onde continuar, dentro da empresa da chave.
 */
export interface Cursor {
  /** Tabela. */
  t: string
  /** Última chave entregue. */
  k: string
  /** Filtro: "desde" (alterado desde) ou "janela" (data principal a partir de). */
  f: 'desde' | 'janela' | 'tudo'
  /** Data do filtro (AAAA-MM-DD), quando há. */
  d: string | null
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...c }), 'utf8').toString('base64url')
}

export function decodeCursor(s: string, table: string): Cursor | null {
  if (!s || s.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(s)) return null
  try {
    const o = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>
    if (o.v !== 1 || o.t !== table || typeof o.k !== 'string' || !o.k || o.k.length > 300) return null
    if (o.f !== 'desde' && o.f !== 'janela' && o.f !== 'tudo') return null
    const d = o.d === null ? null : parseDate(typeof o.d === 'string' ? o.d : null)
    if (o.f !== 'tudo' && !d) return null
    return { t: table, k: o.k, f: o.f, d: o.f === 'tudo' ? null : d }
  } catch {
    return null
  }
}

/** A chave do cursor precisa ter o formato da chave da tabela (uuid, número ou texto), senão o banco recusaria. */
export function keyFits(k: string, type: 'uuid' | 'int' | 'text'): boolean {
  if (type === 'uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)
  if (type === 'int') return /^\d{1,15}$/.test(k)
  return k.length > 0 && k.length <= 300
}

/** Filtro da leitura: "desde" pedido, janela padrão (fatos) ou tudo (dimensões). */
export function filterOf(q: { desde?: string | null; meses?: number | null }, isFact: boolean, today: string): { f: Cursor['f']; d: string | null } | { error: string } {
  if (q.desde !== undefined && q.desde !== null && q.desde !== '') {
    const d = parseDate(q.desde)
    if (!d) return { error: 'desde precisa ser uma data AAAA-MM-DD.' }
    return isFact ? { f: 'desde', d } : { f: 'tudo', d: null }
  }
  if (!isFact) return { f: 'tudo', d: null }
  const months = q.meses ?? DEFAULT_MONTHS
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) return { error: `meses precisa ser de 1 a ${MAX_MONTHS}.` }
  return { f: 'janela', d: windowStart(today, months) }
}

// ---------- Limite de pedidos por chave ----------

/** Janela deslizante simples por chave (em memória: a API roda num processo só). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** ok: pode seguir; retryAfter: segundos até liberar. */
  hit(id: string, now = Date.now()): { ok: boolean; retryAfter: number } {
    const from = now - this.windowMs
    const list = (this.hits.get(id) ?? []).filter((t) => t > from)
    if (list.length >= this.limit) {
      this.hits.set(id, list)
      return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0]! + this.windowMs - now) / 1000)) }
    }
    list.push(now)
    this.hits.set(id, list)
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k)
    return { ok: true, retryAfter: 0 }
  }
}

// ---------- Atendimentos do WhatsApp ----------

/** Mesma regra do painel do WhatsApp: um atendimento começa depois de mais de 24 h sem mensagem na conversa. */
export const SESSION_GAP_MS = 24 * 3_600_000

export interface BiMsg {
  conversationId: string
  fromMe: boolean
  sentAt: Date
  sentById: string | null
}

export interface BiSession {
  conversationId: string
  startAt: Date
  endAt: Date
  startedBy: 'cliente' | 'empresa'
  inbound: number
  outbound: number
  /** Vezes do cliente (mensagens seguidas dele) e quantas tiveram resposta. */
  turns: number
  answered: number
  /** Soma dos tempos de resposta (ms) das vezes respondidas. */
  responseMsSum: number
  firstAt: Date | null
  firstRespondedAt: Date | null
  firstMs: number | null
  firstBusinessMs: number | null
  /** Quem respondeu a primeira vez: usuário do CRM, "celular" ou null (sem resposta). */
  firstResponder: string | null
  /** A última vez do cliente ficou sem resposta (só faz sentido no último atendimento da conversa). */
  pending: boolean
}

/**
 * Atendimentos e tempos de resposta a partir das mensagens (ordenadas por conversa e horário; sem notas internas).
 * Vez do cliente: uma ou mais mensagens seguidas dele; tempo de resposta: da primeira mensagem da vez até a próxima
 * mensagem da empresa. Primeira resposta: a da primeira vez do cliente no atendimento, se ele escreveu antes da empresa.
 */
export function whatsappSessions(msgs: BiMsg[], business: (a: Date, b: Date) => number): BiSession[] {
  const out: BiSession[] = []
  let cur: BiSession | null = null
  let waitingAt: Date | null = null
  let firstOpen = false
  for (const m of msgs) {
    const newConv = !cur || cur.conversationId !== m.conversationId
    if (newConv || m.sentAt.getTime() - cur!.endAt.getTime() > SESSION_GAP_MS) {
      if (cur) cur.pending = waitingAt !== null
      cur = {
        conversationId: m.conversationId,
        startAt: m.sentAt,
        endAt: m.sentAt,
        startedBy: m.fromMe ? 'empresa' : 'cliente',
        inbound: 0,
        outbound: 0,
        turns: 0,
        answered: 0,
        responseMsSum: 0,
        firstAt: null,
        firstRespondedAt: null,
        firstMs: null,
        firstBusinessMs: null,
        firstResponder: null,
        pending: false,
      }
      out.push(cur)
      waitingAt = null
      firstOpen = true
    }
    const s = cur!
    s.endAt = m.sentAt
    if (!m.fromMe) {
      s.inbound++
      if (!waitingAt) {
        waitingAt = m.sentAt
        s.turns++
        if (firstOpen) s.firstAt = m.sentAt
        firstOpen = false
      }
    } else {
      s.outbound++
      if (waitingAt) {
        const ms = m.sentAt.getTime() - waitingAt.getTime()
        s.answered++
        s.responseMsSum += ms
        if (s.firstAt && waitingAt.getTime() === s.firstAt.getTime()) {
          s.firstRespondedAt = m.sentAt
          s.firstMs = ms
          s.firstBusinessMs = business(waitingAt, m.sentAt)
          s.firstResponder = m.sentById ?? 'celular'
        }
        waitingAt = null
      }
      // A empresa falou antes do cliente neste atendimento: a próxima vez dele não é a "primeira".
      firstOpen = false
    }
  }
  if (cur) cur.pending = waitingAt !== null
  return out
}

/** Minutos com uma casa decimal (null fica null). */
export function minutes(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / 6_000) / 10
}

/** Data e hora no horário de Brasília, sem fuso: AAAA-MM-DDTHH:MM:SS (o que a API entrega em todas as tabelas). */
export function localDateTime(d: Date | null): string | null {
  if (!d) return null
  // sv-SE escreve "AAAA-MM-DD HH:MM:SS"; o fuso America/Sao_Paulo inclui o horário de verão dos anos antigos.
  return SP_FORMAT.format(d).replace(' ', 'T')
}

const SP_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
