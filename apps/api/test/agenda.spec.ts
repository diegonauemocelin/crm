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
    expect(contactsFromWhatsapp(list)).toEqual([
      { name: 'Carlos', phone: '+554999887766', category: null },
      { name: 'Fornecedor X', phone: '+5547988776655', category: null },
      { name: null, phone: '+5541977665544', category: null },
    ])
    expect(contactsFromWhatsapp({ erro: true })).toEqual([])
  })
})
