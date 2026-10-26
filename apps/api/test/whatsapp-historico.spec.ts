import { describe, expect, it } from 'vitest'
import { WEBHOOK_EVENTS } from '../src/whatsapp/evolution'
import { HISTORY_HOURS, historyFrom, historyName, historyNote, historyPatch, pickHistory } from '../src/whatsapp/historico'
import { parseMessage } from '../src/whatsapp/mensagens'

const H = 3_600_000
const now = new Date('2026-10-26T13:00:00Z')
const ago = (h: number) => new Date(now.getTime() - h * H)
const CLIENT = '5549988887777@s.whatsapp.net'

/** Mensagem como a Evolution manda no messages.set: messageTimestamp em segundos e chave sem remoteJidAlt. */
function msg(id: string, hoursAgo: number, o: { jid?: string; fromMe?: boolean; text?: string; pushName?: string; message?: Record<string, unknown> } = {}) {
  return {
    key: { id, remoteJid: o.jid ?? CLIENT, fromMe: o.fromMe ?? false },
    pushName: o.pushName ?? (o.fromMe ? 'Você' : 'Cliente Teste'),
    status: 'DELIVERY_ACK',
    message: o.message ?? { conversation: o.text ?? 'oi' },
    messageType: 'conversation',
    messageTimestamp: Math.floor(ago(hoursAgo).getTime() / 1000),
  }
}

type Conv = Parameters<typeof historyPatch>[0] & { unread: number; status: string; lastPreview?: string | null; closedByName?: string | null }
const conv = (c: Partial<Conv> = {}): Conv => ({ lastMessageAt: null, lastInboundAt: null, lastFromMe: false, noReplyNeeded: false, closedAt: null, botFlowId: null, phone: null, name: null, unread: 0, status: 'ABERTA', ...c })

/** Aplica o que historyPatch devolve como o banco aplicaria (unread com increment). */
function apply(c: Conv, patch: ReturnType<typeof historyPatch>): Conv {
  const { unread, ...rest } = patch as Record<string, unknown>
  const next = { ...c, ...rest } as Conv
  if (typeof unread === 'number') next.unread = unread
  else if (unread && typeof unread === 'object') next.unread = c.unread + (unread as { increment: number }).increment
  return next
}

const parsed = (m: ReturnType<typeof msg>) => parseMessage(m)!

describe('Histórico do WhatsApp ao conectar pelo QR Code (messages.set)', () => {
  it('a Evolution passa a mandar o histórico para o CRM', () => {
    expect(WEBHOOK_EVENTS).toContain('MESSAGES_SET')
    expect(WEBHOOK_EVENTS).toContain('MESSAGES_UPSERT')
  })

  it('janela: as últimas 48 horas, nunca antes do cadastro do número nem de um lead apagado (LGPD)', () => {
    expect(HISTORY_HOURS).toBe(48)
    expect(historyFrom(now)).toEqual(ago(48))
    expect(historyFrom(now, [null, undefined, ago(100)])).toEqual(ago(48))
    expect(historyFrom(now, [ago(30), ago(5)])).toEqual(ago(5))
  })

  it('só mensagens de conversa dentro da janela, sem grupo nem repetição, da mais antiga para a mais nova', () => {
    const r = pickHistory(
      [
        msg('C3', 1, { text: 'ainda aguardo' }),
        msg('C2', 18, { fromMe: true, text: 'vou verificar' }),
        msg('C1', 19, { text: 'preciso do filtro de óleo da 320D' }),
        msg('C1', 19, { text: 'preciso do filtro de óleo da 320D' }),
        msg('ANTIGA', 60),
        msg('G1', 2, { jid: '120363000000000000@g.us' }),
        msg('R1', 3, { message: { reactionMessage: { key: { id: 'C1' }, text: '👍' } } }),
        msg('S1', 3, { jid: 'status@broadcast' }),
      ],
      ago(48),
    )
    expect(r.items.map((p) => p.waId)).toEqual(['C1', 'C2', 'C3'])
    expect(r).toMatchObject({ recebidas: 8, foraDaJanela: 1, grupos: 1, ignoradas: 3 })
    // Data e hora originais (não a hora em que o histórico chegou).
    expect(r.items[0]!.at.getTime()).toBe(Math.floor(ago(19).getTime() / 1000) * 1000)
    expect(r.items[0]!.text).toBe('preciso do filtro de óleo da 320D')
  })

  it('mesma hora: fica a ordem de envio (o WhatsApp manda a mais nova primeiro)', () => {
    const r = pickHistory([msg('DEPOIS', 2, { text: 'segunda' }), msg('ANTES', 2, { text: 'primeira' })], ago(48))
    expect(r.items.map((p) => p.waId)).toEqual(['ANTES', 'DEPOIS'])
  })

  it('pedido sem lista não quebra', () => {
    expect(pickHistory(null, ago(48))).toMatchObject({ items: [], recebidas: 0 })
    expect(pickHistory({ data: 1 }, ago(48)).items).toEqual([])
  })

  it('conversa pelo @lid (sem o telefone) entra sem telefone, para juntar depois com a do telefone', () => {
    const [p] = pickHistory([msg('L1', 3, { jid: '123456789012345@lid' })], ago(48)).items
    expect(p).toMatchObject({ jid: '123456789012345@lid', phoneDigits: null, lid: null })
  })

  it('nome: os dígitos que a Evolution manda quando não sabe o nome não viram nome da conversa', () => {
    expect(historyName('5549988887777')).toBeNull()
    expect(historyName('+55 (49) 98888-7777')).toBeNull()
    expect(historyName(null)).toBeNull()
    expect(historyName('João da Retroescavadeira')).toBe('João da Retroescavadeira')
  })
})

describe('Conversa com mensagens do histórico (sem nada automático)', () => {
  it('conversa parada desde antes da queda: o cliente conta como não lido, reabre e aguarda resposta', () => {
    const c = conv({ lastMessageAt: ago(30), lastInboundAt: ago(31), lastFromMe: true, closedAt: ago(29), closedByName: 'Ana' })
    const patch = historyPatch(c, parsed(msg('C1', 19, { text: 'preciso do filtro' })), { phone: '+5549988887777', name: 'Cliente Teste' })
    expect(patch).toMatchObject({ lastMessageAt: ago(19), lastFromMe: false, lastInboundAt: ago(19), noReplyNeeded: false, unread: { increment: 1 }, status: 'ABERTA', closedAt: null, closedByName: null })
    expect(patch.lastPreview).toBe('preciso do filtro')
    // Telefone e nome só preenchem o que estava vazio.
    expect(patch).toMatchObject({ phone: '+5549988887777', name: 'Cliente Teste' })
    expect(historyPatch(conv({ phone: '+5549911112222', name: 'Já tinha' }), parsed(msg('C1', 19)), { phone: '+5549988887777', name: 'Outro' })).not.toHaveProperty('name')
  })

  it('sequência da queda (cliente, resposta pelo celular, cliente de novo): termina com 1 não lida', () => {
    let c = conv({ lastMessageAt: ago(30), lastInboundAt: ago(30) })
    for (const m of [msg('C1', 19, { text: 'tem o filtro?' }), msg('C2', 18, { fromMe: true, text: 'temos sim, mando o valor' }), msg('C3', 2, { text: 'e o valor?' })]) c = apply(c, historyPatch(c, parsed(m), { phone: null, name: null }))
    expect(c).toMatchObject({ unread: 1, status: 'ABERTA', lastFromMe: false, lastInboundAt: ago(2), noReplyNeeded: false, lastMessageAt: ago(2), lastPreview: 'e o valor?' })
  })

  it('resposta pelo celular depois da última mensagem do cliente zera as não lidas e para a espera', () => {
    const c = conv({ lastMessageAt: ago(19), lastInboundAt: ago(19), unread: 2 })
    expect(historyPatch(c, parsed(msg('C2', 18, { fromMe: true, text: 'temos sim' })), { phone: null, name: null })).toMatchObject({ unread: 0, noReplyNeeded: true, lastFromMe: true })
    // Com o robô atendendo, a resposta não para a espera (igual ao ao vivo); promessa de retorno também não.
    expect(historyPatch({ ...c, botFlowId: 'f1' }, parsed(msg('C2', 18, { fromMe: true, text: 'temos sim' })), { phone: null, name: null })).not.toHaveProperty('noReplyNeeded')
    const holding = historyPatch(c, parsed(msg('C2', 18, { fromMe: true, text: 'vou verificar e te retorno' })), { phone: null, name: null })
    expect(holding).toMatchObject({ unread: 0 })
    expect(holding).not.toHaveProperty('noReplyNeeded')
  })

  it('cliente que já escreveu de novo ao vivo: a mensagem de ontem só entra no meio da conversa', () => {
    const c = conv({ lastMessageAt: ago(1), lastInboundAt: ago(2), lastFromMe: true, unread: 0, noReplyNeeded: true })
    expect(historyPatch(c, parsed(msg('C1', 19)), { phone: null, name: null })).toEqual({})
    // Resposta antiga pelo celular também não zera nada de agora.
    expect(historyPatch(conv({ lastMessageAt: ago(1), lastInboundAt: ago(1), unread: 3 }), parsed(msg('C2', 18, { fromMe: true })), { phone: null, name: null })).toEqual({})
  })

  it('atendimento finalizado hoje sem ver a mensagem de ontem: reabre e conta não lida, sem mudar o resumo da lista', () => {
    const c = conv({ lastMessageAt: ago(3), lastInboundAt: ago(40), lastFromMe: true, closedAt: ago(3), status: 'ABERTA' })
    const patch = historyPatch(c, parsed(msg('C1', 19, { text: 'preciso do orçamento' })), { phone: null, name: null })
    expect(patch).toMatchObject({ unread: { increment: 1 }, status: 'ABERTA', closedAt: null, lastInboundAt: ago(19) })
    expect(patch).not.toHaveProperty('lastMessageAt')
    expect(patch).not.toHaveProperty('lastPreview')
  })

  it('despedida logo depois de finalizado não reabre', () => {
    const c = conv({ lastMessageAt: ago(20), lastInboundAt: ago(21), lastFromMe: true, closedAt: ago(20) })
    const patch = historyPatch(c, parsed(msg('C1', 19, { text: 'Muito obrigado!' })), { phone: null, name: null })
    expect(patch).not.toHaveProperty('unread')
    expect(patch).not.toHaveProperty('closedAt')
    expect(patch).toMatchObject({ lastInboundAt: ago(19), lastMessageAt: ago(19) })
  })

  it('não liga lead, não abre pré-venda, não muda atendente nem tira o robô', () => {
    const patch = historyPatch(conv({ botFlowId: 'f1' }), parsed(msg('C2', 1, { fromMe: true })), { phone: null, name: null })
    for (const k of ['leadId', 'recordId', 'category', 'assignedUserId', 'botFlowId', 'botState', 'awaySentAt']) expect(patch).not.toHaveProperty(k)
  })

  it('nota na conversa explica de onde vieram as mensagens', () => {
    expect(historyNote(1)).toMatch(/^1 mensagem que não tinha chegado ao CRM foi recuperada do histórico do WhatsApp/)
    expect(historyNote(3)).toMatch(/^3 mensagens que não tinham chegado ao CRM foram recuperadas/)
    expect(historyNote(3)).toMatch(/Não foi aberto lead nem pré-venda e nenhuma resposta automática foi enviada/)
  })
})
