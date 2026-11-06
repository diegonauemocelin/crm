import { describe, expect, it } from 'vitest'
import { parseMessage, UNREADABLE_TEXT } from '../src/whatsapp/mensagens'

describe('mensagem que não abriu e álbum', () => {
  it('mensagem trancada (CIPHERTEXT) vira aviso na conversa', () => {
    const p = parseMessage({ key: { id: 'X1', remoteJid: '5549999990000@s.whatsapp.net', fromMe: false }, messageStubType: 2, messageTimestamp: 1793966800, pushName: 'Emeli' })
    expect(p?.type).toBe('outro')
    expect(p?.text).toBe(UNREADABLE_TEXT)
    expect(p?.jid).toBe('5549999990000@s.whatsapp.net')
  })
  it('sem conteúdo e sem ser trancada continua ignorada', () => {
    expect(parseMessage({ key: { id: 'X2', remoteJid: '5549999990000@s.whatsapp.net', fromMe: false } })).toBeNull()
    expect(parseMessage({ key: { id: 'X3', remoteJid: '5549999990000@s.whatsapp.net', fromMe: true }, messageStubType: 2 })).toBeNull()
  })
  it('aviso de álbum não vira mensagem (as fotos chegam uma a uma)', () => {
    expect(parseMessage({ key: { id: 'X4', remoteJid: '5549999990000@s.whatsapp.net', fromMe: false }, message: { albumMessage: { expectedImageCount: 3 }, messageContextInfo: {} } })).toBeNull()
  })
})
