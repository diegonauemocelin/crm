import { describe, expect, it } from 'vitest'
import { alreadyKnown, cleanCriteria, cnpjOf, distanceKm, emailOf, hasValidContact, instagramOf, mergePhones, nameKey, osmPlaces, osmTerms, overpassQuery, phoneOf, prospectsFromAi, siteOf } from '../src/prospeccao/prospeccao'

describe('busca de leads: regras puras', () => {
  it('critérios limpos (raio, quantidade, palavras-chave)', () => {
    const c = cleanCriteria({ place: ' Chapecó, SC ', radiusKm: 999, segment: 'Terraplenagem', keywords: 'Escavadeira, pá carregadeira, escavadeira', limit: 2 })
    expect(c).toMatchObject({ place: 'Chapecó, SC', radiusKm: 300, limit: 5, keywords: ['escavadeira', 'pá carregadeira'], onlyWithContact: true })
  })

  it('telefone: DDD válido, celular x fixo', () => {
    expect(phoneOf('(49) 98863-2548', 'site')).toEqual({ value: '+5549988632548', kind: 'celular', source: 'site', whatsapp: null })
    expect(phoneOf('49 3664-0888', 'site')!.kind).toBe('fixo')
    expect(phoneOf('(20) 3333-4444', 'site')).toBeNull()
    expect(phoneOf('123', 'site')).toBeNull()
  })

  it('e-mail: formato e descarte de endereços de sistema', () => {
    expect(emailOf('Contato@Empresa.com.br', 'site')!.value).toBe('contato@empresa.com.br')
    expect(emailOf('noreply@empresa.com.br', 'site')).toBeNull()
    expect(emailOf('logo@2x.png', 'site')).toBeNull()
  })

  it('CNPJ com dígitos verificadores', () => {
    expect(cnpjOf('11.222.333/0001-81')).toBe('11222333000181')
    expect(cnpjOf('11.222.333/0001-82')).toBeNull()
    expect(cnpjOf('00000000000000')).toBeNull()
  })

  it('site e Instagram', () => {
    expect(siteOf('www.empresa.com.br')).toBe('https://www.empresa.com.br')
    expect(siteOf('https://facebook.com/empresa')).toBeNull()
    expect(instagramOf('@empresa.terraplenagem')).toBe('https://instagram.com/empresa.terraplenagem')
  })

  it('distância e nome comparável', () => {
    expect(distanceKm({ lat: -27.1, lon: -53.0 }, { lat: -27.1, lon: -53.0 })).toBe(0)
    expect(Math.round(distanceKm({ lat: -26.8, lon: -53.3 }, { lat: -27.1, lon: -52.6 }))).toBeGreaterThan(60)
    expect(nameKey('Terraplenagem São José LTDA')).toBe(nameKey('TERRAPLENAGEM SAO JOSE'))
  })

  it('consulta do mapa: termos sem acento e regex com acento', () => {
    const t = osmTerms({ segment: 'Construção', keywords: ['escavadeira', 'x'] })
    expect(t).toEqual(['construcao', 'escavadeira'])
    const q = overpassQuery({ lat: -27.1, lon: -52.6 }, 50, t)
    expect(q).toContain('around:50000,-27.10000,-52.60000')
    expect(q).toContain('[cç]')
  })

  it('lugares do OpenStreetMap', () => {
    const p = osmPlaces({ elements: [{ lat: -27, lon: -52, tags: { name: 'Terraplenagem Oeste', phone: '+55 49 3322-1100', website: 'terraoeste.com.br', 'addr:city': 'Chapecó' } }, { center: { lat: -27, lon: -52 }, tags: { name: 'Terraplenagem Oeste' } }, { tags: {} }] })
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ name: 'Terraplenagem Oeste', city: 'Chapecó', site: 'https://terraoeste.com.br' })
    expect(p[0]!.phones[0]!.value).toBe('+554933221100')
  })

  it('resultado da IA validado; já conhecido e contato válido', () => {
    const [a] = prospectsFromAi({ empresas: [{ nome: 'Obras Sul', cnpj: '11222333000181', segmento: 'terraplenagem', cidade: 'Chapecó', uf: 'sc', endereco: '', site: 'obrassul.com.br', instagram: '', telefones: [{ numero: '(49) 99999-0000', fonte: 'site' }, { numero: 'xx', fonte: 'site' }], emails: [{ email: 'vendas@obrassul.com.br', fonte: 'site' }], nota: 130, motivo: 'Frota de escavadeiras', fontes: ['https://obrassul.com.br', 'http://x'] }] })
    expect(a).toMatchObject({ cnpj: '11222333000181', uf: 'SC', score: 100, sources: ['https://obrassul.com.br'] })
    expect(a!.phones).toHaveLength(1)
    expect(alreadyKnown(a!, { phones: new Set(['+5549999990000']), emails: new Set() })).toBe(true)
    expect(hasValidContact({ phones: [], emails: [{ value: 'a@b.com', source: 's', mx: false }] })).toBe(false)
    expect(mergePhones([phoneOf('49999990000', 'site')!, phoneOf('(49) 99999-0000', 'mapa')!])[0]!.source).toBe('site, mapa')
  })
})
