import { describe, expect, it } from 'vitest'
import { ChatService } from '../src/whatsapp/chat.service'
import { parseMessage } from '../src/whatsapp/mensagens'

const key = { id: 'R2', remoteJid: '5549999991111@s.whatsapp.net', fromMe: false }

describe('mensagem recebida em resposta a outra', () => {
  it('Evolution v2: resposta de texto vira "conversation" e o contextInfo vem fora da mensagem', () => {
    const data = {
      key,
      pushName: 'João',
      messageType: 'conversation',
      message: { conversation: 'Esse mesmo, pode mandar', messageContextInfo: { deviceListMetadata: {} } },
      contextInfo: { stanzaId: 'ORC1', participant: '5549988632548@s.whatsapp.net', quotedMessage: { conversation: 'Segue o orçamento do filtro hidráulico: R$ 380,00' } },
      messageTimestamp: 1760900000,
    }
    expect(parseMessage(data)).toMatchObject({ type: 'texto', text: 'Esse mesmo, pode mandar', quoted: { waId: 'ORC1', text: 'Segue o orçamento do filtro hidráulico: R$ 380,00' } })
  })

  it('resposta com foto e citação de documento; sem contextInfo não é resposta', () => {
    const foto = parseMessage({ key, message: { imageMessage: { caption: 'É esta peça?', mimetype: 'image/jpeg' } }, contextInfo: { stanzaId: 'DOC1', quotedMessage: { documentMessage: { fileName: 'orcamento.pdf' } } } })
    expect(foto?.quoted).toEqual({ waId: 'DOC1', text: 'Documento: orcamento.pdf' })
    expect(parseMessage({ key, message: { conversation: 'oi' }, contextInfo: { expiration: 0 } })?.quoted).toBeNull()
    expect(parseMessage({ key, message: { conversation: 'oi' }, contextInfo: null })?.quoted).toBeNull()
  })

  it('no chat: a citação diz de quem era a mensagem respondida e aponta para ela', () => {
    const s = new ChatService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const user = { id: 'u', tenantId: 't', role: { isSystem: true }, permissions: {} } as never
    const row = { id: 'm2', fromMe: false, type: 'texto', text: 'Esse mesmo', fileName: null, mime: null, mediaStatus: null, fileId: null, sentAt: new Date(), sentByName: null, status: null, internal: false, quotedText: 'Segue o orçamento', quotedWaId: 'ORC1', reactions: [], editedAt: null, deletedAt: null, transcript: null, sentById: null }
    const view = (s as unknown as { messageView: (m: unknown, u: unknown, q?: unknown) => Record<string, unknown> }).messageView(row, user, { id: 'm1', fromMe: true })
    expect(view).toMatchObject({ quotedText: 'Segue o orçamento', quotedFromMe: true, quotedId: 'm1' })
    expect((s as unknown as { messageView: (m: unknown, u: unknown) => Record<string, unknown> }).messageView(row, user)).toMatchObject({ quotedFromMe: null, quotedId: null })
  })
})
