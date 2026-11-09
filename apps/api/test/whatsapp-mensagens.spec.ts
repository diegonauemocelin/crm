import { describe, expect, it } from 'vitest'
import { deafAction } from '../src/whatsapp/evolution'
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

describe('número que envia mas não recebe', () => {
  const H = 3_600_000
  const now = 10 * H
  it('renova a conexão, depois avisa; dentro do normal não faz nada', () => {
    expect(deafAction({ lastInbound: now - H, sentSince: 5, lastRefresh: 0, warned: false }, now, true)).toBe('renovar')
    expect(deafAction({ lastInbound: now - 2 * H, sentSince: 8, lastRefresh: now - 40 * 60_000, warned: false }, now, true)).toBe('avisar')
    expect(deafAction({ lastInbound: now - 2 * H, sentSince: 8, lastRefresh: now - 10 * 60_000, warned: false }, now, true)).toBe('nada')
    expect(deafAction({ lastInbound: now - 2 * H, sentSince: 8, lastRefresh: now - 40 * 60_000, warned: true }, now, true)).toBe('nada')
    expect(deafAction({ lastInbound: now - H, sentSince: 2, lastRefresh: 0, warned: false }, now, true)).toBe('nada')
    expect(deafAction({ lastInbound: now - 10 * 60_000, sentSince: 9, lastRefresh: 0, warned: false }, now, true)).toBe('nada')
    expect(deafAction({ lastInbound: now - H, sentSince: 9, lastRefresh: 0, warned: false }, now, false)).toBe('nada')
  })
})
