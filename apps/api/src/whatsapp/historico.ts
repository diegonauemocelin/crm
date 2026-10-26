/**
 * Histórico que o WhatsApp manda quando o número é conectado de novo pelo QR Code (evento messages.set da Evolution).
 * Recupera as mensagens das últimas horas que não chegaram ao CRM (ex.: sessão caída): entram com a data original e
 * sem nenhuma ação automática. Regras sem banco (testadas em whatsapp-historico.spec.ts).
 */
import { answersClient, isClosingMessage } from './envio'
import { type ParsedMessage, parseMessage, previewOf } from './mensagens'

/** Até quantas horas para trás o histórico entra: cobre a queda de uma noite ou de um dia sem trazer de volta conversas antigas. */
export const HISTORY_HOURS = 48

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
export function historyPatch(conv: HistoryConv, p: Pick<ParsedMessage, 'at' | 'fromMe' | 'type' | 'text'>, o: { phone: string | null; name: string | null }) {
  const later = !conv.lastMessageAt || p.at >= conv.lastMessageAt
  const newestInbound = !conv.lastInboundAt || p.at >= conv.lastInboundAt
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
export function historyNote(count: number) {
  const what = count === 1 ? '1 mensagem que não tinha chegado ao CRM foi recuperada' : `${count} mensagens que não tinham chegado ao CRM foram recuperadas`
  return `${what} do histórico do WhatsApp (número conectado de novo pelo QR Code), com a data e a hora originais. Não foi aberto lead nem pré-venda e nenhuma resposta automática foi enviada: confira se o cliente ainda espera retorno.`
}
