/**
 * Histórico que o WhatsApp manda quando o número é conectado de novo pelo QR Code (evento messages.set da Evolution).
 * Recupera as mensagens das últimas horas que não chegaram ao CRM (ex.: sessão caída): entram com a data original e
 * sem nenhuma ação automática. Regras sem banco (testadas em whatsapp-historico.spec.ts).
 */
import { answersClient, isClosingMessage } from './envio'
import { type ParsedMessage, parseMessage, phoneFromDigits, previewOf } from './mensagens'

/** Até quantas horas para trás o histórico entra: cobre a queda de uma noite ou de um dia sem trazer de volta conversas antigas. */
export const HISTORY_HOURS = 48

/** "Importar mensagens do aparelho": períodos que a tela oferece (dias) e o padrão. */
export const IMPORT_DAYS_OPTIONS = [2, 7, 15, 30] as const
export const IMPORT_DAYS_DEFAULT = 15

/** Período válido (2 a 30 dias); qualquer outro valor vira o padrão de 15. */
export function importDays(v: unknown) {
  const d = Number(v)
  return Number.isInteger(d) && d >= 2 && d <= 30 ? d : IMPORT_DAYS_DEFAULT
}

/** Janela do histórico do número: com "Importar mensagens do aparelho" ligado, o período escolhido; desligado, as 48 h de sempre. */
export function historyHours(n: { importHistory: boolean; importHistoryDays: number }) {
  return n.importHistory ? importDays(n.importHistoryDays) * 24 : HISTORY_HOURS
}

/**
 * Mensagem antiga do histórico (fora das últimas 48 h): entra só como registro. Não conta como não lida, não reabre a
 * conversa e não entra no tempo de espera; nada dispara por ela.
 */
export function isOldHistory(at: Date, now: Date) {
  return now.getTime() - at.getTime() > HISTORY_HOURS * 3_600_000
}

/**
 * Chave da conversa de uma mensagem do histórico: (número, contato). O mesmo contato em dois números são duas
 * conversas; nada do histórico do número A entra em conversa do número B. Também é a fila de gravação (uma por conversa).
 */
export function historyConvKey(numberId: string, p: Pick<ParsedMessage, 'phoneDigits' | 'jid'>) {
  return `${numberId}:${phoneFromDigits(p.phoneDigits) ?? p.jid}`
}

/** Onde procurar a conversa da mensagem: sempre dentro do número que recebeu (pelo contato, pelo telefone ou pelo @lid). */
export function historyConvWhere(numberId: string, p: Pick<ParsedMessage, 'phoneDigits' | 'jid'>) {
  const phone = phoneFromDigits(p.phoneDigits)
  const or: ({ jid: string } | { phone: string } | { lid: string })[] = [{ jid: p.jid }]
  if (phone) or.push({ phone })
  if (p.jid.endsWith('@lid')) or.push({ lid: p.jid })
  return { numberId, OR: or }
}

type ConvCandidate = { id: string; numberId: string; jid: string; phone: string | null; lid: string | null }

/**
 * Escolhe a conversa entre as candidatas: só as do próprio número (mesmo que venham outras), primeiro pelo contato
 * (jid), depois pelo telefone e por fim pelo @lid. Nenhuma: a mensagem abre conversa nova neste número.
 */
export function matchHistoryConversation<C extends ConvCandidate>(candidates: C[], numberId: string, p: Pick<ParsedMessage, 'phoneDigits' | 'jid'>): C | null {
  const own = candidates.filter((c) => c.numberId === numberId)
  const phone = phoneFromDigits(p.phoneDigits)
  return own.find((c) => c.jid === p.jid) ?? (phone ? own.find((c) => c.phone === phone) : undefined) ?? (p.jid.endsWith('@lid') ? own.find((c) => c.lid === p.jid) : undefined) ?? null
}

/** Mensagens já gravadas: a busca é só nas conversas do número que recebeu (o mesmo id em outro número não conta). */
export function historyKnownWhere(tenantId: string, numberId: string, waIds: string[]) {
  return { tenantId, waId: { in: waIds }, conversation: { numberId } }
}

/** Mensagens por lote na gravação do histórico. */
export const HISTORY_BATCH = 200

/** Lotes da gravação: a importação grava e mostra o andamento a cada lote, sem segurar o servidor num pedido gigante. */
export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += Math.max(1, size)) out.push(list.slice(i, i + Math.max(1, size)))
  return out
}

/** O WhatsApp avisa no último pedaço do histórico (isLatest ou progresso 100%). */
export function historyIsLast(extra: { isLatest?: unknown; progress?: unknown }) {
  return extra.isLatest === true || Number(extra.progress) >= 100
}

export type HistoryStatus = 'AGUARDANDO' | 'IMPORTANDO' | 'CONCLUIDO'

/** Sem pedaço novo do histórico por este tempo, a importação é dada por terminada (o aviso de fim pode não vir). */
export const HISTORY_IDLE_MS = 10 * 60_000
/** Conectado e o WhatsApp não mandou nada do histórico neste tempo: não há o que importar. */
export const HISTORY_WAIT_MS = 15 * 60_000

/** A conferência periódica encerra a importação parada? */
export function historyStale(
  n: { historyStatus: string | null; historyUpdatedAt: Date | null; status: string; connectedAt: Date | null },
  now: Date,
) {
  if (n.historyStatus === 'IMPORTANDO') return !n.historyUpdatedAt || now.getTime() - n.historyUpdatedAt.getTime() > HISTORY_IDLE_MS
  if (n.historyStatus === 'AGUARDANDO') return n.status === 'CONECTADO' && !!n.connectedAt && now.getTime() - n.connectedAt.getTime() > HISTORY_WAIT_MS
  return false
}

/** Nome que aparece na nota deixada nas conversas que receberam mensagens do histórico. */
export const HISTORY_NAME = 'Histórico do WhatsApp'

/** Começo da janela: as últimas HISTORY_HOURS, nunca antes das datas-limite (cadastro do número, lead apagado pela LGPD). */
export function historyFrom(now: Date, floors: (Date | null | undefined)[] = [], hours = HISTORY_HOURS) {
  return new Date(Math.max(now.getTime() - hours * 3_600_000, ...floors.filter((d): d is Date => !!d).map((d) => d.getTime())))
}

export interface HistoryPick {
  /** Mensagens de conversa dentro da janela, sem repetição, da mais antiga para a mais nova. */
  items: ParsedMessage[]
  recebidas: number
  foraDaJanela: number
  /** Grupos ficam de fora: o histórico de grupo não mexe nas não lidas da aba Grupos. */
  grupos: number
  /** Reação, aviso do sistema, status, canal ou mensagem repetida no mesmo pedido. */
  ignoradas: number
}

/** Lê o pedido messages.set (lista de mensagens no formato do messages.upsert, sem o telefone das conversas @lid). */
export function pickHistory(data: unknown, from: Date): HistoryPick {
  const list = Array.isArray(data) ? data : []
  const out: HistoryPick = { items: [], recebidas: list.length, foraDaJanela: 0, grupos: 0, ignoradas: 0 }
  const seen = new Set<string>()
  // O WhatsApp manda cada conversa da mais nova para a mais antiga: lendo de trás para frente, empate fica na ordem de envio.
  for (let i = list.length - 1; i >= 0; i--) {
    const p = parseMessage(list[i])
    if (!p || seen.has(p.waId)) {
      out.ignoradas++
      continue
    }
    seen.add(p.waId)
    if (p.group) out.grupos++
    else if (p.at < from) out.foraDaJanela++
    else out.items.push(p)
  }
  out.items.sort((a, b) => a.at.getTime() - b.at.getTime())
  return out
}

/** Nome do contato: sem nome no histórico, a Evolution manda os dígitos do número (não servem de nome da conversa). */
export function historyName(pushName: string | null) {
  return pushName && !/^\+?[\d\s().-]+$/.test(pushName) ? pushName : null
}

type HistoryConv = {
  lastMessageAt: Date | null
  lastInboundAt: Date | null
  lastFromMe: boolean
  noReplyNeeded: boolean
  closedAt: Date | null
  botFlowId: string | null
  phone: string | null
  name: string | null
}

/**
 * O que muda na conversa com uma mensagem do histórico (gravada fora de ordem, depois de outras mais novas):
 * - resumo da lista (última mensagem, prévia) só quando ela é a mais nova da conversa;
 * - mensagem do cliente que é a última dele (não escreveu de novo depois) conta como não lida e reabre o atendimento:
 *   ninguém a viu no CRM, mesmo que a conversa tenha sido finalizada depois (só a despedida logo depois do fim não reabre);
 * - resposta pelo celular depois da última mensagem do cliente zera as não lidas e para o tempo de espera.
 * Não liga lead, não abre pré-venda, não muda atendente e não tira o robô da conversa.
 */
export function historyPatch(conv: HistoryConv, p: Pick<ParsedMessage, 'at' | 'fromMe' | 'type' | 'text'>, o: { phone: string | null; name: string | null; old?: boolean }) {
  const later = !conv.lastMessageAt || p.at >= conv.lastMessageAt
  const newestInbound = !conv.lastInboundAt || p.at >= conv.lastInboundAt
  // Mensagem antiga (importação de dias atrás): só o registro e o resumo; o cliente não fica "esperando" por ela.
  if (o.old) {
    return {
      ...(o.phone && !conv.phone ? { phone: o.phone } : {}),
      ...(o.name && !conv.name ? { name: o.name } : {}),
      ...(later ? { lastMessageAt: p.at, lastPreview: previewOf(p), lastFromMe: p.fromMe } : {}),
      ...(!p.fromMe && newestInbound ? { lastInboundAt: p.at, noReplyNeeded: true } : {}),
    }
  }
  const goodbye = !p.fromMe && (conv.lastFromMe || conv.noReplyNeeded) && isClosingMessage(p)
  const staysClosed = goodbye && !!conv.closedAt && p.at.getTime() - conv.closedAt.getTime() < 2 * 86_400_000
  const reply = p.fromMe ? (newestInbound ? { unread: 0, ...(!conv.botFlowId && answersClient(p) ? { noReplyNeeded: true } : {}) } : {}) : {}
  const inbound = !p.fromMe && newestInbound ? { lastInboundAt: p.at, noReplyNeeded: false, ...(staysClosed ? {} : { unread: { increment: 1 }, status: 'ABERTA', closedAt: null, closedByName: null }) } : {}
  return {
    ...(o.phone && !conv.phone ? { phone: o.phone } : {}),
    ...(o.name && !conv.name ? { name: o.name } : {}),
    ...(later ? { lastMessageAt: p.at, lastPreview: previewOf(p), lastFromMe: p.fromMe } : {}),
    ...reply,
    ...inbound,
  }
}

/** Nota interna na conversa: quem atende entende por que apareceram mensagens antigas e que nada automático saiu. */
export function historyNote(count: number, importDaysChosen?: number) {
  if (importDaysChosen) {
    const what = count === 1 ? '1 mensagem foi importada' : `${count} mensagens foram importadas`
    return `${what} do aparelho (Importar mensagens do aparelho, últimos ${importDaysChosen} dias), com a data e a hora originais. Não foi aberto lead nem pré-venda e nenhuma resposta automática foi enviada. Mensagens com mais de 2 dias entram só como registro (não contam como não lidas nem no tempo de espera).`
  }
  const what = count === 1 ? '1 mensagem que não tinha chegado ao CRM foi recuperada' : `${count} mensagens que não tinham chegado ao CRM foram recuperadas`
  return `${what} do histórico do WhatsApp (número conectado de novo pelo QR Code), com a data e a hora originais. Não foi aberto lead nem pré-venda e nenhuma resposta automática foi enviada: confira se o cliente ainda espera retorno.`
}
