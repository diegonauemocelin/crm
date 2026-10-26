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
    expect(body).toMatchObject({ instanceName: 'crm-abc123', integration: 'WHATSAPP-BAILEYS', groupsIgnore: false, syncFullHistory: false, webhook: { url: 'http://api:3000/api/webhooks/whatsapp/s', events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT', 'MESSAGES_SET', 'MESSAGES_UPDATE', 'MESSAGES_EDITED', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CALL'] } })
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
    // Grupo: entra marcado, com o nome de quem escreveu e sem telefone (a conversa é o grupo).
    expect(parseMessage({ key: key({ remoteJid: '120363@g.us', participant: '554988831936@s.whatsapp.net' }), pushName: 'Fulano', message: { conversation: 'grupo' } })).toMatchObject({ group: true, jid: '120363@g.us', phoneDigits: null, pushName: 'Fulano', text: 'grupo' })
    expect(parseMessage({ key: key(), message: { conversation: 'oi' } })).toMatchObject({ group: false })
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

describe('Envio pelo CRM', () => {
  it('aceita só arquivos conhecidos pelos bytes; variáveis, assinatura e ritmo por número', async () => {
    const { detectOutgoing, safeFileName, applyVariables, signed, SendRate } = await import('../src/whatsapp/envio')
    const b = (...v: number[]) => Buffer.from(v)
    expect(detectOutgoing(b(0xff, 0xd8, 0xff, 0xe0), 'foto.png')).toMatchObject({ kind: 'image', mime: 'image/jpeg', ext: 'jpg' })
    expect(detectOutgoing(Buffer.from('%PDF-1.7 ...'), 'orcamento.pdf')).toMatchObject({ kind: 'document', ext: 'pdf' })
    expect(detectOutgoing(Buffer.from('OggS....'), 'audio.ogg')).toMatchObject({ kind: 'audio' })
    expect(detectOutgoing(Buffer.concat([b(0, 0, 0, 0x20), Buffer.from('ftypisom')]), 'video.mp4')).toMatchObject({ kind: 'video', mime: 'video/mp4' })
    expect(detectOutgoing(b(0x50, 0x4b, 0x03, 0x04), 'planilha.xlsx')).toMatchObject({ kind: 'document', ext: 'xlsx' })
    // Zip com outra extensão, HTML, SVG e executável: recusados.
    expect(detectOutgoing(b(0x50, 0x4b, 0x03, 0x04), 'pacote.zip')).toBeNull()
    expect(detectOutgoing(Buffer.from('<html><script>alert(1)</script>'), 'pagina.html')).toBeNull()
    expect(detectOutgoing(Buffer.from('<svg onload=alert(1)>'), 'imagem.svg')).toBeNull()
    expect(detectOutgoing(Buffer.from('MZ\x90\x00'), 'programa.exe')).toBeNull()
    expect(detectOutgoing(Buffer.from('a;b\x00c'), 'dados.csv')).toBeNull()
    expect(safeFileName('../../etc/passwd<script>.pdf', 'pdf')).toBe('.._.._etc_passwd_script_.pdf')
    const { uploadName } = await import('../src/whatsapp/envio')
    expect(uploadName(Buffer.from('Orçamento.pdf', 'utf8').toString('latin1'))).toBe('Orçamento.pdf')
    expect(uploadName('Orçamento.pdf')).toBe('Orçamento.pdf')
    expect(applyVariables('Olá {nome}, aqui é o {vendedor}!', { nome: 'João Silva', vendedor: 'Diego Naue' })).toBe('Olá João, aqui é o Diego!')
    expect(applyVariables('Olá {nome}, tudo bem?', { nome: null })).toBe('Olá, tudo bem?')
    expect(signed('Temos sim', 'Diego Naue Mocelin')).toBe('*Diego:*\nTemos sim')
    const rate = new SendRate(3, 5)
    expect([rate.check('n', 0), rate.check('n', 1000), rate.check('n', 2000)]).toEqual([null, null, null])
    expect(rate.check('n', 3000)).toBe(57)
    expect(rate.check('outro', 3000)).toBeNull()
    expect(rate.check('n', 61_000)).toBeNull()
  })
})

describe('Regras do WhatsApp (administrador)', () => {
  it('decide sozinho o que vira lead, histórico e pré-venda', async () => {
    const { decide, DEFAULT_RULES, cleanRules } = await import('../src/whatsapp/envio')
    const base = { marked: null, hasLead: false, idle: true, fromMe: false, hasPhone: true, numberOpensRecords: true }
    // Padrão: contato novo que chama vira lead e abre pré-venda.
    expect(decide(DEFAULT_RULES, base)).toEqual({ category: 'CLIENTE', linkLead: true, createLead: true, openRecord: true })
    // Contato da empresa: nada além do chat.
    expect(decide(DEFAULT_RULES, { ...base, marked: 'FORNECEDOR', hasLead: true })).toEqual({ category: 'FORNECEDOR', linkLead: false, createLead: false, openRecord: false })
    // Lead já cadastrado: histórico sempre; pré-venda só depois de X dias sem conversa e se a regra pedir.
    expect(decide(DEFAULT_RULES, { ...base, hasLead: true, idle: false })).toEqual({ category: 'CLIENTE', linkLead: true, createLead: false, openRecord: false })
    expect(decide({ ...DEFAULT_RULES, knownLead: 'SO_HISTORICO' }, { ...base, hasLead: true })).toMatchObject({ linkLead: true, openRecord: false })
    // Número que não abre pré-venda: vira lead com histórico, sem pré-venda.
    expect(decide(DEFAULT_RULES, { ...base, numberOpensRecords: false })).toMatchObject({ createLead: true, openRecord: false })
    // Regra "só lead" e regra "a classificar".
    expect(decide({ ...DEFAULT_RULES, newContact: 'SO_LEAD' }, base)).toMatchObject({ createLead: true, openRecord: false })
    expect(decide({ ...DEFAULT_RULES, newContact: 'NADA' }, base)).toEqual({ category: 'NOVO', linkLead: false, createLead: false, openRecord: false })
    expect(decide({ ...DEFAULT_RULES, newContact: 'NADA' }, { ...base, marked: 'CLIENTE' })).toMatchObject({ createLead: true, openRecord: true })
    // A empresa que iniciou (mensagem do celular): não cria lead.
    expect(decide(DEFAULT_RULES, { ...base, fromMe: true })).toMatchObject({ createLead: false, openRecord: false })
    expect(cleanRules({ newContact: 'X' as never, reopenDays: 500 })).toEqual(DEFAULT_RULES)
  })

  it('importa a lista de contatos da empresa (Google Contatos, CSV, colado do Excel)', async () => {
    const { parseContactList } = await import('../src/whatsapp/envio')
    const google = 'Name,Given Name,Phone 1 - Type,Phone 1 - Value,E-mail 1 - Value\n"Carlos Souza",Carlos,Mobile,+55 49 98877-6655,carlos@usaparts.com.br\nMaria,,Work,(41) 3333-2222 ::: (41) 99888-7777,'
    const g = parseContactList(google, 'COLEGA')
    expect(g.rows).toEqual([
      { name: 'Carlos Souza', phone: '+55 49 98877-6655', category: 'COLEGA' },
      { name: 'Maria', phone: '(41) 3333-2222', category: 'COLEGA' },
      { name: 'Maria', phone: '(41) 99888-7777', category: 'COLEGA' },
    ])
    expect(g.skipped).toBe(1)
    const simples = parseContactList('Peças Brasil;(47) 3222-1100;fornecedor\nJoão\t49999990000\tcolega', 'OUTRO')
    expect(simples.rows.map((r) => [r.name, r.category])).toEqual([['Peças Brasil', 'FORNECEDOR']])
    expect(parseContactList('João\t49999990000\tcolega', 'OUTRO').rows).toEqual([{ name: 'João', phone: '49999990000', category: 'COLEGA' }])
  })
})

describe('Áudio gravado e ligações', () => {
  it('aceita a gravação do navegador como voz e registra só o primeiro aviso de cada ligação', async () => {
    const { detectOutgoing } = await import('../src/whatsapp/envio')
    const { parseCalls } = await import('../src/whatsapp/mensagens')
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])
    expect(detectOutgoing(webm, 'audio.webm', true)).toEqual({ kind: 'audio', mime: 'audio/webm', ext: 'webm' })
    expect(detectOutgoing(webm, 'video.webm')).toBeNull()
    expect(detectOutgoing(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42')]), 'audio.m4a', true)).toMatchObject({ kind: 'audio', mime: 'audio/mp4' })
    expect(detectOutgoing(Buffer.from('<html>'), 'audio.webm', true)).toBeNull()
    const calls = parseCalls([
      { id: 'C1', from: '554988831936@s.whatsapp.net', status: 'offer', isVideo: false, date: '2026-10-11T12:00:00Z' },
      { id: 'C1', from: '554988831936@s.whatsapp.net', status: 'ringing' },
      { id: 'C2', chatId: '5511987654321@s.whatsapp.net', status: 'offer', isVideo: true },
      { id: 'G1', from: '120363@g.us', isGroup: true, status: 'offer' },
    ])
    expect(calls.map((c) => [c.callId, c.phoneDigits, c.isVideo])).toEqual([['C1', '554988831936', false], ['C2', '5511987654321', true]])
    expect(parseCalls({ id: 'C3', from: '5547991112222@s.whatsapp.net' })).toHaveLength(1)
  })
})

describe('Métricas do atendimento', () => {
  it('atendimentos, primeira resposta, tempo entre pergunta e resposta e horário comercial', async () => {
    const { analyze, businessMs, stats, slaBuckets, waitingBuckets } = await import('../src/whatsapp/metricas')
    // Segunda, 12/10/2026 (horário de Brasília = UTC-3).
    const at = (h: number, m = 0, day = 12) => new Date(Date.UTC(2026, 9, day, h + 3, m))
    const msg = (c: string, fromMe: boolean, d: Date, by: string | null = null) => ({ conversationId: c, fromMe, sentAt: d, sentById: by, type: 'texto' })
    const { sessions, turns } = analyze([
      // Conversa A: cliente escreve 2x às 9h, Ana responde 9h10; cliente pergunta 10h, resposta pelo celular 10h30.
      msg('A', false, at(9)), msg('A', false, at(9, 2)), msg('A', true, at(9, 10), 'ana'), msg('A', false, at(10)), msg('A', true, at(10, 30)),
      // Dois dias depois: novo atendimento iniciado pela empresa, cliente responde e fica sem retorno.
      msg('A', true, at(9, 0, 14), 'ana'), msg('A', false, at(9, 5, 14)),
      // Conversa B: cliente às 17h50, resposta na terça às 8h10 (comercial: 10 min + 10 min).
      msg('B', false, at(17, 50)), msg('B', true, at(8, 10, 13), 'bia'),
    ])
    expect(sessions.map((s) => [s.conversationId, s.startedBy])).toEqual([['A', 'cliente'], ['A', 'empresa'], ['B', 'cliente']])
    expect(turns.map((t) => [t.conversationId, t.first, t.ms === null ? null : t.ms / 60_000, t.responder])).toEqual([
      ['A', true, 10, 'ana'],
      ['A', false, 30, 'celular'],
      ['A', false, null, null],
      ['B', true, 860, 'bia'],
    ])
    expect(turns[3]!.businessMs! / 60_000).toBe(20)
    // Sábado 11h às segunda 9h: 1 h no sábado + 1 h na segunda.
    expect(businessMs(at(11, 0, 17), at(9, 0, 19)) / 3_600_000).toBe(2)
    expect(stats([1, 2, 3, 4, 100])).toMatchObject({ median: 3, p90: 100, avg: 22 })
    expect(slaBuckets([4, 10, 50, 300].map((m) => m * 60_000)).map((b) => b.share)).toEqual([0.25, 0.5, 0.75, 0.75])
    expect(waitingBuckets([30 * 60_000, 2 * 3_600_000, 30 * 3_600_000])).toEqual({ ate1h: 1, ate4h: 1, ate24h: 0, mais24h: 1 })
  })
})
