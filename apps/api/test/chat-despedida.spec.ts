import { describe, expect, it } from 'vitest'
import { isClosingMessage } from '../src/whatsapp/envio'
import { parseMessage, parseRevisionEvent, UNKNOWN_TEXT, unknownKeys } from '../src/whatsapp/mensagens'

const t = (text: string) => isClosingMessage({ type: 'texto', text })

describe('despedida do cliente (não pede resposta)', () => {
  it('agradecimentos e confirmações curtas encerram', () => {
    for (const s of ['Muito obrigada!', 'obrigado', 'Obrigadaaa', 'ok 👍', 'Ok, obrigado', 'valeu!!', 'vlw', 'Beleza, obrigado pela atenção', 'Obrigado, bom dia', 'tmj', 'Igualmente!', 'Perfeito, muito obrigado mesmo', 'kkkk obrigado', 'Show', 'Disponha']) expect(t(s), s).toBe(true)
  })

  it('só emoji ou figurinha encerra', () => {
    expect(t('👍')).toBe(true)
    expect(t('🙏🙏')).toBe(true)
    expect(isClosingMessage({ type: 'figurinha', text: null })).toBe(true)
  })

  it('pedido, pergunta ou cumprimento sozinho continua esperando resposta', () => {
    for (const s of ['Bom dia', 'Boa tarde', 'obrigado, mas qual o prazo?', 'Ok, vou ver e te aviso', 'Fico no aguardo', 'sim', 'Tem o filtro em estoque?', 'Oi bom dia hoje não estou na empresa mas assim que eu chegar verifico']) expect(t(s), s).toBe(false)
  })

  it('áudio, foto e texto longo não são adivinhados', () => {
    expect(isClosingMessage({ type: 'audio', text: null })).toBe(false)
    expect(isClosingMessage({ type: 'imagem', text: 'obrigado' })).toBe(false)
    expect(t(`obrigado ${'muito '.repeat(20)}`)).toBe(false)
  })
})

describe('edição e exclusão nos eventos da Evolution 2.3', () => {
  it('messages.edited: protocolMessage de edição e de apagar para todos', () => {
    expect(parseRevisionEvent('messages.edited', { key: { id: 'ABC123', remoteJid: '5549999999999@s.whatsapp.net', fromMe: false }, type: 'MESSAGE_EDIT', editedMessage: { conversation: 'Texto novo' } })).toEqual([{ targetWaId: 'ABC123', kind: 'editada', text: 'Texto novo' }])
    expect(parseRevisionEvent('messages.edited', { key: { id: 'ABC123' }, type: 14, editedMessage: { extendedTextMessage: { text: 'Outro texto' } } })).toEqual([{ targetWaId: 'ABC123', kind: 'editada', text: 'Outro texto' }])
    expect(parseRevisionEvent('messages.edited', { key: { id: 'ABC123' }, type: 'REVOKE' })).toEqual([{ targetWaId: 'ABC123', kind: 'apagada', text: null }])
    // Outros avisos do sistema (ex.: mensagens temporárias) não mexem em nada.
    expect(parseRevisionEvent('messages.edited', { key: { id: 'ABC123' }, type: 'EPHEMERAL_SETTING' })).toEqual([])
  })

  it('messages.delete: a chave da mensagem apagada', () => {
    expect(parseRevisionEvent('messages.delete', { remoteJid: '5549999999999@s.whatsapp.net', fromMe: false, id: 'XYZ789', status: 'DELETED' })).toEqual([{ targetWaId: 'XYZ789', kind: 'apagada', text: null }])
    expect(parseRevisionEvent('messages.delete', { key: { id: 'XYZ789' } })).toEqual([{ targetWaId: 'XYZ789', kind: 'apagada', text: null }])
  })

  it('messages.update: edição vem em message.editedMessage; confirmação de leitura não é edição', () => {
    expect(parseRevisionEvent('messages.update', { keyId: 'ABC123', status: 'SERVER_ACK', message: { editedMessage: { message: { conversation: 'Texto novo' } } } })).toEqual([{ targetWaId: 'ABC123', kind: 'editada', text: 'Texto novo' }])
    expect(parseRevisionEvent('messages.update', { keyId: 'ABC123', message: { editedMessage: { message: { protocolMessage: { key: { id: 'ORIG1' }, type: 14, editedMessage: { conversation: 'Novo' } } } } } })).toEqual([{ targetWaId: 'ORIG1', kind: 'editada', text: 'Novo' }])
    expect(parseRevisionEvent('messages.update', { keyId: 'ABC123', status: 'READ' })).toEqual([])
  })

  it('tipo desconhecido: aviso na conversa e só os nomes dos campos no registro', () => {
    const data = { key: { id: 'M1', remoteJid: '5549999999999@s.whatsapp.net', fromMe: false }, message: { algoNovoMessage: { foo: 1 } } }
    expect(parseMessage(data)?.text).toBe(UNKNOWN_TEXT)
    expect(unknownKeys(data)).toBe('algoNovoMessage')
  })
})
