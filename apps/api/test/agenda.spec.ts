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
