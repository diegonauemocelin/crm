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
    expect(body).toMatchObject({ instanceName: 'crm-abc123', integration: 'WHATSAPP-BAILEYS', groupsIgnore: true, syncFullHistory: false, webhook: { url: 'http://api:3000/api/webhooks/whatsapp/s', events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT', 'SEND_MESSAGE'] } })
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

describe('Mensagens recebidas (Evolution)', () => {
  it('lê texto, mídia, localização; usa o telefone do LID; ignora grupo, status e reação', async () => {
    const { parseMessage, phoneFromDigits, phoneVariants, previewOf } = await import('../src/whatsapp/mensagens')
    const key = (o: Record<string, unknown> = {}) => ({ id: 'ABC1', remoteJid: '554988831936@s.whatsapp.net', fromMe: false, ...o })
    const t = parseMessage({ key: key(), pushName: 'Diego', messageTimestamp: 1760000000, message: { conversation: 'Preciso do filtro JCB' } })!
    expect(t).toMatchObject({ waId: 'ABC1', fromMe: false, jid: '554988831936@s.whatsapp.net', phoneDigits: '554988831936', pushName: 'Diego', type: 'texto', text: 'Preciso do filtro JCB', media: null })
    expect(t.at.toISOString()).toBe(new Date(1760000000 * 1000).toISOString())
    // Número escondido (LID) com o telefone em remoteJidAlt.
    expect(parseMessage({ key: key({ remoteJid: '123456789@lid', remoteJidAlt: '5511987654321@s.whatsapp.net' }), message: { conversation: 'oi' } })).toMatchObject({ jid: '5511987654321@s.whatsapp.net', phoneDigits: '5511987654321' })
    expect(parseMessage({ key: key({ remoteJid: '123456789@lid' }), message: { conversation: 'oi' } })).toMatchObject({ jid: '123456789@lid', phoneDigits: null })
    // Foto temporária com legenda, documento com legenda e áudio.
    expect(parseMessage({ key: key(), message: { ephemeralMessage: { message: { imageMessage: { caption: 'peça', mimetype: 'image/jpeg', fileLength: '20480' } } } } })).toMatchObject({ type: 'imagem', text: 'peça', media: { mime: 'image/jpeg', size: 20480 } })
    expect(parseMessage({ key: key(), message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'orçamento.pdf', mimetype: 'application/pdf', caption: 'segue' } } } } })).toMatchObject({ type: 'documento', text: 'segue', media: { fileName: 'orçamento.pdf' } })
    expect(parseMessage({ key: key(), message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } } })).toMatchObject({ type: 'audio', media: { mime: 'audio/ogg' } })
    expect(parseMessage({ key: key(), message: { locationMessage: { degreesLatitude: -27.1, degreesLongitude: -52.6, name: 'Loja' } } })!.text).toBe('Loja · -27.100000, -52.600000')
    // Enviada pelo celular da empresa.
    expect(parseMessage({ key: key({ fromMe: true }), pushName: 'Empresa', message: { conversation: 'Bom dia' } })).toMatchObject({ fromMe: true, pushName: null })
    // Não é conversa com cliente.
    expect(parseMessage({ key: key({ remoteJid: '120363@g.us' }), message: { conversation: 'grupo' } })).toBeNull()
    expect(parseMessage({ key: key({ remoteJid: 'status@broadcast' }), message: { conversation: 'status' } })).toBeNull()
    expect(parseMessage({ key: key(), message: { reactionMessage: { text: '👍' } } })).toBeNull()
    expect(parseMessage({ key: key(), message: { protocolMessage: { type: 0 } } })).toBeNull()
    // Telefone: celular brasileiro sem o 9 ganha o 9; busca pelas duas formas.
    expect(phoneFromDigits('554988831936')).toBe('+5549988831936')
    expect(phoneFromDigits('554933221100')).toBe('+554933221100')
    expect(phoneFromDigits('351912345678')).toBe('+351912345678')
    expect(phoneVariants('+5549988831936')).toEqual(['+5549988831936', '+554988831936'])
    expect(previewOf({ type: 'imagem', text: 'peça  nova' })).toBe('Foto: peça nova')
    expect(previewOf({ type: 'audio', text: null })).toBe('Áudio')
  })
})
