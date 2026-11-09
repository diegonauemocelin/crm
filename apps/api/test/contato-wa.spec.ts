import { describe, expect, it } from 'vitest'
import { cleanJid, downloadPhoto, formatPhone, guessMentionJid, jidKind, mentionView, phoneOfJid, photoDue, PHOTO_REFRESH_MS, PhotoQueue, profilePictureUrl } from '../src/whatsapp/contato-wa'

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const detect = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 ? { mime: 'image/jpeg', ext: 'jpg' } : b.toString('ascii', 0, 3) === 'GIF' ? { mime: 'image/gif', ext: 'gif' } : null)
const fakeFetch = (body: Buffer, init: { status?: number; length?: number } = {}) =>
  (async () => new Response(new Uint8Array(body), { status: init.status ?? 200, headers: init.length !== undefined ? { 'content-length': String(init.length) } : {} })) as unknown as typeof fetch

describe('identificador do WhatsApp', () => {
  it('separa telefone, @lid escondido e grupo', () => {
    expect(jidKind('5549988632548@s.whatsapp.net')).toBe('telefone')
    expect(jidKind('5549988632548:12@s.whatsapp.net')).toBe('telefone')
    expect(jidKind('102310483099718@lid')).toBe('lid')
    expect(jidKind('120363025246125888@g.us')).toBe('grupo')
    expect(jidKind('status@broadcast')).toBe('outro')
    expect(jidKind(null)).toBe('outro')
    expect(cleanJid('5549988632548:3@s.whatsapp.net')).toBe('5549988632548@s.whatsapp.net')
  })

  it('só telefone de verdade vira telefone (o @lid não)', () => {
    expect(phoneOfJid('5549988632548@s.whatsapp.net')).toBe('+5549988632548')
    expect(phoneOfJid('102310483099718@lid')).toBeNull()
    expect(phoneOfJid('120363025246125888@g.us')).toBeNull()
  })

  it('formata o telefone para mostrar', () => {
    expect(formatPhone('+5549988632548')).toBe('+55 (49) 98863-2548')
    expect(formatPhone('554936640888')).toBe('+55 (49) 3664-0888')
    expect(formatPhone('+13055551234')).toBe('+13055551234')
    expect(formatPhone('123')).toBeNull()
  })
})

describe('menção no grupo', () => {
  it('menção antiga: celular do Brasil é telefone, o resto é @lid', () => {
    expect(guessMentionJid('5549988632548')).toBe('5549988632548@s.whatsapp.net')
    expect(guessMentionJid('554988632548')).toBe('554988632548@s.whatsapp.net')
    expect(guessMentionJid('102310483099718')).toBe('102310483099718@lid')
  })

  it('@lid sem telefone conhecido fica marcado como escondido', () => {
    expect(mentionView('102310483099718', ['102310483099718@lid'], 'Ana', new Map())).toEqual({ id: '102310483099718', jid: '102310483099718@lid', name: 'Ana', phone: null, hidden: true })
  })

  it('@lid com o telefone que o grupo informa', () => {
    const phones = new Map([['102310483099718@lid', '+5549988632548']])
    expect(mentionView('102310483099718', ['102310483099718@s.whatsapp.net', '102310483099718@lid'], null, phones)).toMatchObject({ jid: '102310483099718@lid', phone: '+5549988632548', hidden: false })
  })

  it('telefone mencionado', () => {
    expect(mentionView('5549988632548', ['5549988632548@s.whatsapp.net'], 'João', new Map())).toMatchObject({ phone: '+5549988632548', hidden: false })
  })
})

describe('foto do perfil', () => {
  it('confere de novo depois de 7 dias (e quando nunca conferiu)', () => {
    const now = Date.parse('2026-11-09T12:00:00Z')
    expect(photoDue(null, now)).toBe(true)
    expect(photoDue(new Date(now - 60_000), now)).toBe(false)
    expect(photoDue(new Date(now - PHOTO_REFRESH_MS), now)).toBe(true)
  })

  it('só aceita o endereço https do WhatsApp', () => {
    expect(profilePictureUrl({ wuid: 'x', profilePictureUrl: 'https://pps.whatsapp.net/v/t61/abc.jpg?oh=1&oe=2' })).toBe('https://pps.whatsapp.net/v/t61/abc.jpg?oh=1&oe=2')
    expect(profilePictureUrl({ profilePictureUrl: null })).toBeNull()
    expect(profilePictureUrl({})).toBeNull()
    expect(profilePictureUrl(null)).toBeNull()
    expect(profilePictureUrl({ profilePictureUrl: 'http://pps.whatsapp.net/a.jpg' })).toBeNull()
    expect(profilePictureUrl({ profilePictureUrl: 'https://evil.com/a.jpg' })).toBeNull()
    expect(profilePictureUrl({ profilePictureUrl: 'https://pps.whatsapp.net.evil.com/a.jpg' })).toBeNull()
    expect(profilePictureUrl({ profilePictureUrl: 'https://pps.whatsapp.net:8443/a.jpg' })).toBeNull()
  })

  it('baixa só imagem aceita e dentro do limite', async () => {
    expect(await downloadPhoto('https://pps.whatsapp.net/a', detect, fakeFetch(JPG))).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' })
    expect(await downloadPhoto('https://pps.whatsapp.net/a', detect, fakeFetch(Buffer.from('<svg/>')))).toBeNull()
    expect(await downloadPhoto('https://pps.whatsapp.net/a', detect, fakeFetch(Buffer.from('GIF89a')))).toBeNull()
    expect(await downloadPhoto('https://pps.whatsapp.net/a', detect, fakeFetch(JPG, { length: 5_000_000 }))).toBeNull()
    expect(await downloadPhoto('https://pps.whatsapp.net/a', detect, fakeFetch(Buffer.concat([JPG, Buffer.alloc(100)])), { maxBytes: 50 })).toBeNull()
    await expect(downloadPhoto('https://pps.whatsapp.net/a', detect, fakeFetch(JPG, { status: 403 }))).rejects.toThrow()
  })

  it('fila: uma por vez, sem repetir, e a aberta vai na frente', async () => {
    const done: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const q = new PhotoQueue(
      async (id) => {
        if (id === 'a') await gate
        done.push(id)
      },
      { concurrency: 1, delayMs: 0 },
    )
    expect(q.add('a')).toBe(true)
    expect(q.add('b')).toBe(true)
    expect(q.add('b')).toBe(false)
    expect(q.add('c', true)).toBe(true)
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(done).toEqual(['a', 'c', 'b'])
    // Logo depois de tentar não entra de novo (cooldown).
    expect(q.add('a')).toBe(false)
    expect(q.size).toBe(0)
  })
})
