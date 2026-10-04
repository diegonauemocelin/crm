import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { normalizePhone } from '../src/atendimento/br'
import { decodeText, detectDelimiter, maybeGunzip, parseDelimited, readTable } from '../src/leads/arquivo'
import { convertCustom, convertRow, isRdExport, normalizeTags, parseAnyDate, parseStage, suggestMapping } from '../src/leads/mapeamento'
import { computeScore, DEFAULT_RULES, DEFAULT_SCORE_SETTINGS, gradeOf } from '../src/leads/scoring'

const RD_HEADERS = [
  'Email', 'Nome', 'Telefone', 'Celular', 'Facebook', 'Linkedin', 'Website', 'Cargo', 'Empresa', 'País', 'Estado', 'Cidade',
  'Estágio no funil', 'Dono do Lead', 'Data da última oportunidade', 'Data da última venda', 'Valor da última venda',
  'Lead Scoring - Perfil', 'Lead Scoring - Interesse', 'Status para comunicação por email', 'Tags',
]

describe('leitura de arquivos', () => {
  it('lê o "Texto Unicode" do Excel (UTF-16 com tabulação)', async () => {
    const text = 'Email\tNome\r\nana@x.com\tAna Ação\r\n'
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    expect(decodeText(buf)).toBe(text)
    const rows = await readTable(buf)
    expect(rows).toEqual([['Email', 'Nome'], ['ana@x.com', 'Ana Ação']])
  })

  it('aceita UTF-8 com BOM, Windows-1252 e arquivo compactado em gzip', async () => {
    expect(decodeText(Buffer.from('﻿nome;cidade\nJoão;Itajaí', 'utf8'))).toBe('nome;cidade\nJoão;Itajaí')
    expect(decodeText(Buffer.from([0x4a, 0x6f, 0xe3, 0x6f]))).toBe('João')
    const rows = await readTable(gzipSync(Buffer.from('a,b\n1,2\n,\n', 'utf8')))
    expect(rows).toEqual([['a', 'b'], ['1', '2']])
  })

  it('detecta o separador e respeita campos entre aspas', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\n')).toBe('\t')
    expect(parseDelimited('nome,tags\n"Silva, Ana","revenda,newsletter"\n', ',')).toEqual([['nome', 'tags'], ['Silva, Ana', 'revenda,newsletter']])
  })

  it('recusa gzip malicioso grande demais (zip bomb)', () => {
    const bomb = gzipSync(Buffer.alloc(70 * 1024 * 1024))
    expect(() => maybeGunzip(bomb)).toThrow(/grande demais/)
  })
})

describe('importação do RD Station', () => {
  it('reconhece o export do RD e sugere o mapeamento', () => {
    expect(isRdExport(RD_HEADERS)).toBe(true)
    const m = suggestMapping(RD_HEADERS, [])
    expect(m.Email).toBe('email')
    expect(m['Celular']).toBe('mobile')
    expect(m['Estágio no funil']).toBe('stage')
    expect(m['Dono do Lead']).toBe('owner')
    expect(m['Status para comunicação por email']).toBe('emailOptIn')
    expect(m['Valor da última venda']).toBe('lastSaleValue')
    expect(m['Lead Scoring - Perfil']).toBe('ignore')
    expect(m.Facebook).toBe('ignore')
  })

  it('converte uma linha real do RD', () => {
    const cells = [
      'Joao@Exemplo.com.br', '~João da Silva', '+55 (47) 3333-4444', '+55 (47) 99647-0159', '', '', '', 'Comprador', 'Silva Peças', '', 'SC', 'Itajaí',
      'Cliente', 'comercial@usaparts.com.br', '2026-09-02 16:30:10 -0300', '2023-04-17 12:14:42 -0300', '221.72', 'd', '0', 'false',
      'importacao-2022-10-02-21:34:09,revenda,Newsletter',
    ]
    const { lead, problems } = convertRow(RD_HEADERS, cells, suggestMapping(RD_HEADERS, []), /^importacao-/i)
    expect(problems).toEqual([])
    expect(lead.email).toBe('joao@exemplo.com.br')
    expect(lead.name).toBe('João da Silva')
    expect(lead.phone).toBe('+5547996470159')
    expect(lead.state).toBe('SC')
    expect(lead.stage).toBe('CLIENTE')
    expect(lead.ownerEmail).toBe('comercial@usaparts.com.br')
    expect(lead.emailOptIn).toBe(false)
    expect(lead.lastSaleValue).toBe(221.72)
    expect(lead.lastSaleAt?.toISOString()).toBe('2023-04-17T15:14:42.000Z')
    expect(lead.tags).toEqual(['revenda', 'newsletter'])
  })

  it('aponta e-mails inválidos e telefones com código do país repetido', () => {
    const m = suggestMapping(['Email', 'Telefone'], [])
    expect(convertRow(['Email', 'Telefone'], ['sbmirandawmgindustria.com.br', ''], m, null).problems[0]).toMatch(/e-mail inválido/)
    expect(convertRow(['Email', 'Telefone'], ['rudi@gmail.com@gmail', ''], m, null).lead.email).toBeNull()
    expect(normalizePhone('+55 +5547996470159')).toBe('+5547996470159')
    expect(normalizePhone('+55 55 99999-1234')).toBe('+5555999991234')
    expect(normalizePhone('+55 01555999710654')).toBe('+5555999710654')
    expect(normalizePhone('015 47 3333-4444')).toBe('+554733334444')
  })

  it('estágios, datas e tags', () => {
    expect(parseStage('Lead Qualificado')).toBe('QUALIFICADO')
    expect(parseStage('cliente')).toBe('CLIENTE')
    expect(parseStage('outro')).toBeNull()
    expect(parseAnyDate('02/10/2026')?.toISOString()).toBe('2026-10-02T15:00:00.000Z')
    expect(parseAnyDate('lixo')).toBeNull()
    expect(normalizeTags(['Revenda, revenda ;  VIP', 'importacao-2024'], /^importacao-/)).toEqual(['revenda', 'vip'])
  })

  it('valida campos personalizados pelo tipo', () => {
    expect(convertCustom({ key: 'frota', type: 'NUMBER', options: [] }, '1.200')).toEqual({ value: 1200 })
    expect(convertCustom({ key: 'segmento', type: 'SELECT', options: ['Agrícola', 'Construção'] }, 'agricola')).toEqual({ value: 'Agrícola' })
    expect(convertCustom({ key: 'segmento', type: 'SELECT', options: ['Agrícola'] }, 'Naval')).toHaveProperty('error')
    expect(convertCustom({ key: 'frota_propria', type: 'BOOLEAN', options: [] }, 'sim')).toEqual({ value: true })
  })
})

describe('lead scoring', () => {
  const rules = DEFAULT_RULES.map((r) => ({ ...r, active: true }))
  const now = new Date('2026-10-03T12:00:00Z')

  it('soma perfil e interesse e classifica em A/B/C/D', () => {
    const lead = { stage: 'CLIENTE', state: 'SC', phone: '+5547996470159', email: 'a@b.com', tags: ['revenda'], customFields: {} }
    const events = [
      { type: 'atendimento', occurredAt: new Date('2026-09-20T12:00:00Z') },
      { type: 'venda', occurredAt: new Date('2026-09-21T12:00:00Z') },
    ]
    const s = computeScore(lead, events, rules, DEFAULT_SCORE_SETTINGS, now)
    expect(s.profile).toBe(60) // 25 + 20 + 10 + 10 = 65, limitado a 60
    expect(s.interest).toBe(40)
    expect(s.grade).toBe('A')
  })

  it('interesse decai: eventos fora da janela deixam de contar', () => {
    const lead = { stage: 'LEAD', state: null, phone: null, email: 'a@b.com', tags: [], customFields: {} }
    const old = [{ type: 'venda', occurredAt: new Date('2026-01-01T12:00:00Z') }]
    const s = computeScore(lead, old, rules, DEFAULT_SCORE_SETTINGS, now)
    expect(s.interest).toBe(0)
    expect(s.grade).toBe('D')
  })

  it('regras de campo personalizado e faixas', () => {
    const lead = { stage: 'LEAD', state: 'SP', phone: null, email: null, tags: [], customFields: { segmento: 'Agrícola' } }
    const custom = [{ dimension: 'PERFIL' as const, field: 'custom:segmento', operator: 'eq', value: 'Agrícola', points: 40, active: true }]
    expect(computeScore(lead, [], custom, DEFAULT_SCORE_SETTINGS, now).profile).toBe(40)
    expect(gradeOf(59, DEFAULT_SCORE_SETTINGS)).toBe('B')
    expect(gradeOf(15, DEFAULT_SCORE_SETTINGS)).toBe('C')
  })
})
