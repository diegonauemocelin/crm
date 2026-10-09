import { describe, expect, it } from 'vitest'
import { cleanQr, EvolutionClient, EvolutionError, phoneFromJid, statusOf } from '../src/whatsapp/evolution'

describe('Evolution API (cliente)', () => {
  it('situação, número que conectou e QR Code só como imagem PNG', () => {
    expect([statusOf('open'), statusOf('connecting'), statusOf('close'), statusOf(undefined)]).toEqual(['CONECTADO', 'CONECTANDO', 'DESCONECTADO', 'DESCONECTADO'])
    expect(phoneFromJid('5549988831936@s.whatsapp.net')).toBe('+5549988831936')
    expect(phoneFromJid('5549988831936:12@s.whatsapp.net')).toBe('+5549988831936')
    expect(phoneFromJid('123@g.us')).toBeNull()
    expect(cleanQr('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(cleanQr('javascript:alert(1)')).toBeNull()
    expect(cleanQr('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
  })

  it('manda a chave, cria a instância com o endereço de eventos e explica os erros', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/instance/connect/crm-abc123')) return new Response(JSON.stringify({ response: { message: ['Instance not found'] } }), { status: 404 })
      return new Response(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const c = new EvolutionClient({ url: 'http://evolution:8080', apiKey: 'chave' }, fake)
    await c.createInstance('crm-abc123', 'http://api:3000/api/webhooks/whatsapp/s')
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe('chave')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body).toMatchObject({ instanceName: 'crm-abc123', integration: 'WHATSAPP-BAILEYS', groupsIgnore: true, syncFullHistory: false, webhook: { url: 'http://api:3000/api/webhooks/whatsapp/s', events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED'] } })
    const err = await c.connect('crm-abc123').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EvolutionError)
    expect((err as EvolutionError).status).toBe(404)
    expect((err as Error).message).toContain('Instance not found')
    // Já desconectada: logout não é erro.
    const c2 = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, (async () => new Response('{}', { status: 400 })) as typeof fetch)
    await expect(c2.logout('crm-x')).resolves.toBeUndefined()
    // Serviço fora do ar: mensagem que diz o que fazer.
    const c3 = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, (async () => { throw new TypeError('fetch failed') }) as typeof fetch)
    await expect(c3.health()).rejects.toThrow(/deploy\/whatsapp\.sh status/)
  })
})
