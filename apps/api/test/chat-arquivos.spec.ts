import { describe, expect, it } from 'vitest'
import { ChatService, toCallRange } from '../src/whatsapp/chat.service'

describe('Leads para chamar: período', () => {
  it('hoje, ontem e período do calendário viram dias inteiros em Brasília', () => {
    expect(toCallRange('2026-10-20', '2026-10-20')).toEqual({ from: new Date('2026-10-20T03:00:00Z'), to: new Date('2026-10-21T03:00:00Z') })
    expect(toCallRange('2026-10-20', '2026-10-15')).toEqual({ from: new Date('2026-10-15T03:00:00Z'), to: new Date('2026-10-21T03:00:00Z') })
    expect(toCallRange(undefined, undefined)).toBeNull()
  })
})

describe('arquivos no chat', () => {
  const user = { id: 'u', name: 'Ana', tenantId: 't', role: { isSystem: true, name: 'Adm' }, permissions: {} } as never
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
  const PDF = Buffer.from('%PDF-1.4\n')
  const setup = () => {
    const sent: { mediatype: string; fileName: string; caption?: string }[] = []
    const s = new ChatService({ whatsappQuickReply: { findFirst: async () => ({ id: 'q', userId: null, fileId: 'f1', fileName: 'catalogo.pdf' }) } } as never, { saveBuffer: async () => ({ id: 'a' }), read: async () => ({ content: PDF }) } as never, {} as never, {} as never, {} as never, {} as never)
    const fake = s as unknown as Record<string, unknown>
    fake.sendContext = async () => ({ conv: { id: 'c', tenantId: 't' }, number: { instanceName: 'i', signMessages: false }, client: { sendMedia: async (_i: string, _t: string, m: { mediatype: string; fileName: string; caption?: string }) => (sent.push(m), { waId: 'w', remoteJid: null, at: new Date() }) }, target: '55' })
    fake.recordSent = async (_u: unknown, _c: unknown, _r: unknown, m: unknown) => m
    return { s, sent }
  }

  it('foto acima de 16 MB vai como documento (até 64 MB); acima de 64 MB recusa', async () => {
    const { s, sent } = setup()
    await s.sendFile(user, 'c', { buffer: PNG, size: 20 * 1024 * 1024, originalname: 'foto.png' } as never)
    await s.sendFile(user, 'c', { buffer: PNG, size: 2 * 1024 * 1024, originalname: 'foto.png' } as never)
    expect(sent.map((x) => x.mediatype)).toEqual(['document', 'image'])
    await expect(s.sendFile(user, 'c', { buffer: PNG, size: 65 * 1024 * 1024, originalname: 'foto.png' } as never)).rejects.toThrow('64 MB')
  })

  it('resposta rápida com arquivo manda o arquivo guardado com a legenda', async () => {
    const { s, sent } = setup()
    await s.sendQuickReplyFile(user, 'c', 'q', 'Segue nosso catálogo')
    expect(sent[0]).toMatchObject({ mediatype: 'document', fileName: 'catalogo.pdf', caption: 'Segue nosso catálogo' })
  })
})

describe('nome do arquivo ao baixar a mídia', () => {
  it('foto, vídeo e áudio sem nome ganham nome com a extensão do tipo', async () => {
    const { mediaFileName, contentDisposition } = await import('../src/whatsapp/mensagens')
    const at = new Date('2026-10-20T20:45:00Z')
    expect(mediaFileName(null, 'image/jpeg', at)).toBe('foto-20261020-1745.jpg')
    expect(mediaFileName(null, 'image/webp', null)).toBe('foto.webp')
    expect(mediaFileName(null, 'video/mp4', at)).toBe('video-20261020-1745.mp4')
    expect(mediaFileName(null, 'audio/ogg; codecs=opus', at)).toBe('audio-20261020-1745.ogg')
    expect(mediaFileName('Catálogo JCB.pdf', 'application/pdf')).toBe('Catálogo JCB.pdf')
    expect(mediaFileName('desenho', 'image/png')).toBe('desenho.png')
    expect(mediaFileName('planilha.xlsx', 'application/octet-stream')).toBe('planilha.xlsx')
    expect(mediaFileName('../a/b:c.pdf', 'application/pdf')).toBe('.._a_b_c.pdf')
    expect(contentDisposition("Catálogo d'água.pdf", false)).toBe("attachment; filename=\"Catalogo d_agua.pdf\"; filename*=UTF-8''Cat%C3%A1logo%20d%27%C3%A1gua.pdf")
  })
})
