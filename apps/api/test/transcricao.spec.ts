import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanTranscript } from '../src/email/ia'

describe('transcrição de áudio do chat', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40)
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64')
    process.env.APP_URL ??= 'http://localhost:5173'
    process.env.DATABASE_URL ??= 'postgresql://x@localhost/x'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('limpa o texto que volta do modelo', () => {
    expect(cleanTranscript('Transcrição: "Bom dia, preciso do filtro 1R-0750."')).toBe('Bom dia, preciso do filtro 1R-0750.')
    expect(cleanTranscript('```\nOi\n```')).toBe('Oi')
  })

  it('manda o áudio ao Gemini junto com o pedido e devolve o texto', async () => {
    const { encrypt } = await import('../src/common/crypto')
    const { EmailAiService } = await import('../src/email/ia.service')
    const settings = { get: async (_t: string, _k: string, d: object) => ({ ...d, apiKeyEnc: encrypt('AIza' + 'x'.repeat(30)) }) }
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!init?.body) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }))
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Preciso de uma bomba hidráulica para 320D.' }] } }] }))
    })
    const ai = new EmailAiService(settings as never, {} as never)
    const text = await ai.transcribe('t1', Buffer.from('OggS-audio'), 'audio/ogg')
    expect(text).toBe('Preciso de uma bomba hidráulica para 320D.')
    const parts = (bodies[0] as { contents: { parts: Record<string, unknown>[] }[] }).contents[0]!.parts
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'audio/ogg', data: Buffer.from('OggS-audio').toString('base64') } })
  })

  it('sem chave do Gemini, explica onde cadastrar', async () => {
    const { EmailAiService } = await import('../src/email/ia.service')
    const ai = new EmailAiService({ get: async (_t: string, _k: string, d: object) => d } as never, {} as never)
    await expect(ai.transcribe('t1', Buffer.from('x'), 'audio/ogg')).rejects.toThrow(/chave do Gemini/)
  })
})
