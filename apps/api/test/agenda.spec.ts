import { describe, expect, it } from 'vitest'
import { contactsFromWhatsapp, parseContactList, parseVcf } from '../src/whatsapp/envio'

describe('Agenda: contatos do celular (.vcf)', () => {
  it('lê nome e todos os telefones (Android 2.1 com acento em quoted-printable, iPhone 3.0, linhas dobradas)', () => {
    const android = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Silva;Jo=C3=A3o;;;',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jo=C3=A3o Silva - Fornecedor Pe=',
      '=C3=A7as',
      'TEL;CELL:+55 49 99988-7766',
      'TEL;WORK:(49) 3322-1100',
      'PHOTO;ENCODING=BASE64;JPEG:/9j/4AAQSkZJRgABAQ==',
      'END:VCARD',
    ].join('\r\n')
    const iphone = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Souza;Carla;;;', 'item1.TEL;type=CELL;type=pref:49 9 8877-', ' 6655', 'END:VCARD'].join('\n')
    const semNome = ['BEGIN:VCARD', 'VERSION:3.0', 'ORG:Transportadora Oeste;', 'TEL:4733334444', 'END:VCARD', 'BEGIN:VCARD', 'FN:Sem Telefone', 'EMAIL:x@y.com', 'END:VCARD'].join('\n')
    const r = parseVcf(`${android}\r\n${iphone}\n${semNome}`)
    expect(r.rows).toEqual([
      { name: 'João Silva - Fornecedor Peças', phone: '+55 49 99988-7766', category: null },
      { name: 'João Silva - Fornecedor Peças', phone: '(49) 3322-1100', category: null },
      { name: 'Carla Souza', phone: '49 9 8877-6655', category: null },
      { name: 'Transportadora Oeste', phone: '4733334444', category: null },
    ])
    expect(r.skipped).toBe(1)
  })

  it('lista CSV sem tipo fica sem classificação; com a palavra "cliente" vira cliente', () => {
    expect(parseContactList('Ana;(49) 99999-0000\nBeto;(49) 98888-0000;cliente', null).rows).toEqual([
      { name: 'Ana', phone: '(49) 99999-0000', category: null },
      { name: 'Beto', phone: '(49) 98888-0000', category: 'CLIENTE' },
    ])
  })
})

describe('Agenda: contatos do WhatsApp conectado', () => {
  it('só pessoas com telefone, sem repetir; grupos e @lid ficam de fora', () => {
    const list = [
      { remoteJid: '554999887766@s.whatsapp.net', pushName: 'Carlos' },
      { remoteJid: '554999887766@s.whatsapp.net', pushName: 'Carlos de novo' },
      { remoteJid: '120363000000000000@g.us', pushName: 'Grupo da equipe' },
      { remoteJid: '123456789012345@lid', pushName: 'Sem telefone' },
      { id: '5547988776655@s.whatsapp.net', name: 'Fornecedor X', pushName: 'fx' },
      { remoteJid: 'status@broadcast' },
      { remoteJid: '5541977665544@s.whatsapp.net' },
    ]
    expect([...contactsFromWhatsapp(list)]).toEqual([
      { name: 'Carlos', phone: '+554999887766', category: null },
      { name: 'Fornecedor X', phone: '+5547988776655', category: null },
      { name: null, phone: '+5541977665544', category: null },
    ])
    expect([...contactsFromWhatsapp({ erro: true })]).toEqual([])
  })

  it('aceita a lista dentro de um objeto, o telefone alternativo do número escondido (@lid) e conta o que ficou de fora', () => {
    const r = contactsFromWhatsapp({
      contacts: [
        { remoteJid: '123456789012345@lid', remoteJidAlt: '5549988776655@s.whatsapp.net', pushName: 'Ana' },
        { id: 'clx9abc', remoteJid: '998877665544332@lid', pushName: 'Escondido' },
        { remoteJid: '5547999990000@c.us', name: 'Bruno' },
        { id: 'clx9def', phoneNumber: '+5541988887777', pushName: 'Carla' },
        { remoteJid: '120363000000000000@g.us' },
      ],
    })
    expect([...r]).toEqual([
      { name: 'Ana', phone: '+5549988776655', category: null },
      { name: 'Bruno', phone: '+5547999990000', category: null },
      { name: 'Carla', phone: '+5541988887777', category: null },
    ])
    expect(r.stats).toEqual({ total: 5, hidden: 1, groups: 1 })
  })
})

describe('Leads para chamar: por onde chegou', () => {
  it('formulário (com o nome), pop-up, botão de WhatsApp sem mensagem, loja virtual e origem', async () => {
    const { toCallVia } = await import('../src/whatsapp/envio')
    expect(toCallVia({ channel: 'formulario', formName: 'Orçamento de peças' }, null, false, null)).toEqual({ kind: 'formulario', label: 'Formulário: Orçamento de peças' })
    expect(toCallVia({ channel: 'landing', formName: null }, null, false, null).label).toBe('Formulário do site')
    expect(toCallVia({ channel: 'popup', formName: 'Cupom' }, null, false, null).label).toBe('Pop-up: Cupom')
    expect(toCallVia({ channel: 'whatsapp', formName: null }, null, false, null).kind).toBe('whatsapp')
    expect(toCallVia(null, { conversao: 'botão de WhatsApp "LP JCB"' }, false, null)).toEqual({ kind: 'whatsapp', label: 'Botão de WhatsApp "LP JCB"' })
    expect(toCallVia(null, { source: 'ecommerce' }, false, null)).toEqual({ kind: 'ecommerce', label: 'Loja virtual' })
    expect(toCallVia(null, null, true, null).label).toBe('Loja virtual')
    expect(toCallVia(null, null, false, 'RD Station')).toEqual({ kind: 'outro', label: 'RD Station' })
  })
})

describe('Contatos do Google (CSV exportado)', () => {
  it('lê o formato novo em português: nome montado, todos os telefones e o tipo pelo marcador', async () => {
    const { parseGoogleContacts } = await import('../src/whatsapp/envio')
    const { parseCsv } = await import('../src/atendimento/planilha')
    const csv = [
      'Nome,Nome do meio,Sobrenome,Organização - Nome,Marcadores,Telefone 1 - Rótulo,Telefone 1 - Valor,Telefone 2 - Rótulo,Telefone 2 - Valor',
      'Carlos,,Souza,,* myContacts ::: Fornecedor,Celular,+55 49 98877-6655,Trabalho,(49) 3333-2222 ::: (49) 3333-2223',
      ',,,Peças Brasil,* myContacts,Trabalho,(47) 3222-1100,,',
      'Sem,,Telefone,,,,,,',
      '"Ana ""Aninha""",,Lima,,Cliente,Celular,47 99999-0000,,',
    ].join('\n')
    const r = parseGoogleContacts(parseCsv(csv))!
    expect(r.rows).toEqual([
      { name: 'Carlos Souza', phone: '+55 49 98877-6655', category: 'FORNECEDOR' },
      { name: 'Carlos Souza', phone: '(49) 3333-2222', category: 'FORNECEDOR' },
      { name: 'Carlos Souza', phone: '(49) 3333-2223', category: 'FORNECEDOR' },
      { name: 'Peças Brasil', phone: '(47) 3222-1100', category: null },
      { name: 'Ana "Aninha" Lima', phone: '47 99999-0000', category: 'CLIENTE' },
    ])
    expect(r.skipped).toBe(1)
  })

  it('lê o formato em inglês e recusa o que não é do Google', async () => {
    const { parseGoogleContacts } = await import('../src/whatsapp/envio')
    const { parseCsv } = await import('../src/atendimento/planilha')
    const en = parseGoogleContacts(parseCsv('First Name,Middle Name,Last Name,Phone 1 - Label,Phone 1 - Value\nMaria,,Silva,Mobile,+1 555 123 4567'))!
    expect(en.rows).toEqual([{ name: 'Maria Silva', phone: '+1 555 123 4567', category: null }])
    expect(parseGoogleContacts(parseCsv('Nome;Telefone\nAna;49999990000'))).toBeNull()
  })
})

describe('Compartilhar contato no chat', () => {
  it('monta o cartão com o 55 e recusa nome ou telefone inválidos', async () => {
    const { contactCard } = await import('../src/whatsapp/envio')
    expect(contactCard('  Roberto   Vendas ', '(47) 99999-0000')).toEqual({ fullName: 'Roberto Vendas', wuid: '5547999990000', phoneNumber: '+55 47 99999-0000', text: 'Roberto Vendas · +55 47 99999-0000' })
    expect(contactCard('Loja', '+55 47 3222-1100')).toMatchObject({ wuid: '554732221100', phoneNumber: '+55 47 3222-1100' })
    expect(contactCard('Fornecedor EUA', '+1 555 123 4567')).toMatchObject({ wuid: '15551234567', phoneNumber: '+15551234567' })
    expect(contactCard('', '47999990000')).toEqual({ error: 'Informe o nome do contato.' })
    expect(contactCard('Ana', '123')).toHaveProperty('error')
  })

  it('mostra nome e telefone do contato que o cliente mandou', async () => {
    const { parseMessage } = await import('../src/whatsapp/mensagens')
    const key = { id: 'C1', remoteJid: '5547999990000@s.whatsapp.net', fromMe: false }
    const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Mecânico João\nTEL;type=CELL;waid=5547988887777:+55 47 98888-7777\nEND:VCARD'
    expect(parseMessage({ key, message: { contactMessage: { displayName: 'Mecânico João', vcard } } })?.text).toBe('Mecânico João · +5547988887777')
    const semWaid = 'BEGIN:VCARD\r\nFN:Loja\r\nTEL;TYPE=WORK:(47) 3222-1100\r\nEND:VCARD'
    expect(parseMessage({ key, message: { contactsArrayMessage: { contacts: [{ displayName: 'Loja', vcard: semWaid }, { displayName: 'Sem tel' }] } } })?.text).toBe('Loja · (47) 3222-1100\nSem tel')
  })
})

describe('Reagir e responder no chat', () => {
  it('lê a citação (resposta) e a reação que chegam do WhatsApp', async () => {
    const { parseMessage, parseReaction } = await import('../src/whatsapp/mensagens')
    const key = { id: 'R1', remoteJid: '5547999990000@s.whatsapp.net', fromMe: false }
    const reply = parseMessage({ key, message: { extendedTextMessage: { text: 'Esse mesmo', contextInfo: { stanzaId: 'ORIG1', quotedMessage: { imageMessage: { caption: 'farol' } } } } } })
    expect(reply).toMatchObject({ text: 'Esse mesmo', quoted: { waId: 'ORIG1', text: 'Foto: farol' } })
    expect(parseMessage({ key, message: { conversation: 'oi' } })?.quoted).toBeNull()
    // Reação não vira mensagem: vem pelo parseReaction.
    const data = { key, pushName: 'Ana', message: { reactionMessage: { key: { id: 'ORIG1' }, text: '👍' } } }
    expect(parseMessage(data)).toBeNull()
    expect(parseReaction(data)).toEqual({ targetWaId: 'ORIG1', emoji: '👍', fromMe: false, reactor: '5547999990000@s.whatsapp.net', name: 'Ana' })
    expect(parseReaction({ key, message: { conversation: 'oi' } })).toBeNull()
  })

  it('guarda uma reação por pessoa: troca a anterior e tira com emoji vazio', async () => {
    const { withReaction } = await import('../src/whatsapp/mensagens')
    const a = withReaction(null, { emoji: '👍', by: 'them', key: 'c1', name: 'Ana' })
    const b = withReaction(a, { emoji: '❤️', by: 'them', key: 'c1', name: 'Ana' })
    expect(b).toEqual([{ emoji: '❤️', by: 'them', key: 'c1', name: 'Ana' }])
    const c = withReaction(b, { emoji: '😂', by: 'me', key: 'me', name: 'Diego' })
    expect(c).toHaveLength(2)
    expect(withReaction(c, { emoji: '', by: 'them', key: 'c1', name: null })).toEqual([{ emoji: '😂', by: 'me', key: 'me', name: 'Diego' }])
    expect(withReaction('lixo', { emoji: '👍', by: 'me', key: 'me', name: null })).toHaveLength(1)
  })
})

describe('Envio quando a conexão do número cai (Connection Closed)', () => {
  const closed = () => new Response(JSON.stringify({ status: 400, error: 'Bad Request', response: { message: ['Error: Connection Closed'] } }), { status: 400 })
  const ok = () => new Response(JSON.stringify({ key: { id: 'W1', remoteJid: '5547999990000@s.whatsapp.net' }, messageTimestamp: 1760000000 }), { status: 200 })

  // Respostas por endereço: o envio na ordem da lista; a situação da conexão (connectionState) sempre a mesma.
  const evo = (sends: (() => Response)[], state: string | null, calls: string[] = []) =>
    (async (u: string) => {
      calls.push(String(u))
      if (String(u).includes('/instance/connectionState')) return new Response(JSON.stringify(state ? { instance: { state } } : {}), { status: 200 })
      if (String(u).includes('/instance/restart')) return new Response('{}', { status: 200 })
      return sends.shift()!()
    }) as unknown as typeof fetch

  it('Evolution dizendo "aberta" e o envio falha: reinicia a conexão do número e envia de novo', async () => {
    const { EvolutionClient } = await import('../src/whatsapp/evolution')
    const calls: string[] = []
    const c = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, evo([closed, ok], 'open', calls), 0)
    const r = await c.sendText('crm-abc123', '5547999990000', 'oi')
    expect(r.waId).toBe('W1')
    expect(calls).toEqual(['http://e/message/sendText/crm-abc123', 'http://e/instance/connectionState/crm-abc123', 'http://e/instance/restart/crm-abc123', 'http://e/message/sendText/crm-abc123'])
  })

  it('reconectando sozinha: espera e envia de novo sem reiniciar (reiniciar derrubaria a reconexão)', async () => {
    const { EvolutionClient } = await import('../src/whatsapp/evolution')
    const calls: string[] = []
    const c = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, evo([closed, ok], 'connecting', calls), 0)
    expect((await c.sendText('crm-abc123', '5547999990000', 'oi')).waId).toBe('W1')
    expect(calls.some((u) => u.includes('/instance/restart'))).toBe(false)
  })

  it('caindo de novo, explica o que fazer; outros erros passam direto', async () => {
    const { EvolutionClient, CONNECTION_CLOSED_MESSAGE } = await import('../src/whatsapp/evolution')
    const c = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, evo([closed, closed], 'open'), 0)
    await expect(c.sendText('crm-abc123', '5547999990000', 'oi')).rejects.toThrow(CONNECTION_CLOSED_MESSAGE)
    const calls: string[] = []
    const c2 = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, (async (u: string) => (calls.push(String(u)), new Response(JSON.stringify({ response: { message: ['number not exists'] } }), { status: 400 }))) as unknown as typeof fetch, 0)
    await expect(c2.sendText('crm-abc123', '5547999990000', 'oi')).rejects.toThrow(/number not exists/)
    expect(calls).toHaveLength(1)
  })

  it('sessão morta: avisa o CRM, a conferência pelo próprio número detecta e o logout sem saída é reconhecido', async () => {
    const { EvolutionClient, EvolutionError, isConnectionClosed } = await import('../src/whatsapp/evolution')
    const dead: string[] = []
    const c = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, evo([closed, closed], 'open'), 0)
    c.onSessionDead = (i) => dead.push(i)
    await expect(c.sendText('crm-abc123', '5547999990000', 'oi')).rejects.toThrow()
    expect(dead).toEqual(['crm-abc123'])

    const probe = (res: () => Response) => new EvolutionClient({ url: 'http://e', apiKey: 'k' }, (async () => res()) as unknown as typeof fetch, 0)
    expect(await probe(closed).alive('crm-abc123', '+5549999990000')).toBe(false)
    expect(await probe(() => new Response(JSON.stringify([{ exists: true, jid: '5549999990000@s.whatsapp.net', number: '5549999990000' }]), { status: 200 })).alive('crm-abc123', '+5549999990000')).toBe(true)
    expect(await probe(() => new Response('{}', { status: 502 })).alive('crm-abc123', '+5549999990000')).toBeNull()
    expect(await probe(closed).alive('crm-abc123', null)).toBeNull()

    // O logout de uma sessão morta devolve 500 "Connection Closed": o CRM reconhece e apaga a instância.
    const closed500 = () => new Response(JSON.stringify({ status: 500, error: 'Internal Server Error', response: { message: ['Error: Connection Closed'] } }), { status: 500 })
    const err = await probe(closed500).logout('crm-abc123').catch((e: unknown) => e)
    expect(err instanceof EvolutionError && isConnectionClosed(err.message)).toBe(true)
  })
})
