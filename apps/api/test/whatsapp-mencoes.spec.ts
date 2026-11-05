import { describe, expect, it } from 'vitest'
import { parseMessage } from '../src/whatsapp/mensagens'

describe('WhatsApp: menções em grupo', () => {
  it('lê quem escreveu (telefone e @lid) e quem foi mencionado', () => {
    const p = parseMessage({
      key: { id: 'ABC', remoteJid: '120363000000000000@g.us', fromMe: false, participant: '202310743531599@lid', participantAlt: '5549999990000@s.whatsapp.net' },
      pushName: 'Jean Barbieri',
      messageTimestamp: 1793800000,
      message: { extendedTextMessage: { text: '@202310743531599 @253544804430033', contextInfo: { mentionedJid: ['202310743531599@lid', '253544804430033@lid'] } } },
    })!
    expect(p.group).toBe(true)
    expect(p.senders).toEqual(['202310743531599@lid', '5549999990000@s.whatsapp.net'])
    expect(p.mentions).toEqual(['202310743531599@lid', '253544804430033@lid'])
  })
  it('conversa normal: sem remetentes de grupo', () => {
    const p = parseMessage({ key: { id: 'X', remoteJid: '5549999990000@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' } })!
    expect(p.senders).toEqual([])
    expect(p.mentions).toEqual([])
  })
})
