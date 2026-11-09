import { describe, expect, it } from 'vitest'
import { MODULE_KEYS } from '../src/common/permissions'
import {
  cleanMlDescription,
  cleanMlFixed,
  DEFAULT_ML_FIXED,
  withFixedText,
  cleanMlSeoFields,
  forbiddenContent,
  isMlItemId,
  mlChangedFields,
  mlSeoPrompt,
  mlSeoScore,
  mlSeoSystem,
  mlTitleAllowed,
  parseMlSeoAnswer,
} from '../src/marketplaces/seo-ml'

const attrs = [
  { id: 'BRAND', name: 'Marca', value: 'Usaparts' },
  { id: 'PART_NUMBER', name: 'Número de peça', value: '6754-71-6110' },
  { id: 'MODEL', name: 'Modelo', value: '' },
]
const good = [
  'PRODUTO',
  'Bomba d\'água para motor de escavadeira, peça de reposição nova.',
  '',
  'ESPECIFICAÇÕES',
  '- Material: ferro fundido',
  '- Código: 6754-71-6110',
  '',
  'APLICAÇÃO',
  '- Consulte a aplicação para o seu modelo e número de série pelo campo de perguntas.',
  '',
  'DÚVIDAS',
  'Use o campo de perguntas do anúncio. '.repeat(15),
].join('\n')

describe('SEO Marketplace: nota do anúncio', () => {
  it('anúncio completo tira nota alta; vazio tira nota baixa com os motivos', () => {
    const ok = mlSeoScore({ title: 'Bomba d\'água Usaparts 6754-71-6110 Escavadeira', description: good, brand: 'Usaparts', partNumber: '6754-71-6110', attributes: attrs })
    expect(ok.score).toBeGreaterThanOrEqual(90)
    const bad = mlSeoScore({ title: '', description: '', brand: null, partNumber: null, attributes: [] })
    expect(bad.score).toBeLessThan(40)
    expect(bad.issues.map((i) => i.field)).toEqual(expect.arrayContaining(['title', 'description', 'attributes']))
  })

  it('título acima de 60, sem marca e sem código perde pontos', () => {
    const r = mlSeoScore({ title: 'Bomba de água para motor de escavadeira hidráulica da linha amarela completa', description: good, brand: 'Usaparts', partNumber: '6754-71-6110', attributes: attrs })
    const texts = r.issues.filter((i) => i.field === 'title').map((i) => i.text)
    expect(texts.some((t) => t.includes('até 60'))).toBe(true)
    expect(texts.some((t) => t.includes('marca'))).toBe(true)
    expect(texts.some((t) => t.includes('código'))).toBe(true)
  })

  it('descrição com contato perde pontos; código de peça não é telefone', () => {
    expect(forbiddenContent('Chame no WhatsApp (49) 98863-2548')).toContain('telefone ou WhatsApp')
    expect(forbiddenContent('vendas@empresa.com.br')).toContain('e-mail')
    expect(forbiddenContent('veja www.loja.com.br')).toContain('link')
    expect(forbiddenContent('Compre pelo Mercado Livre. Código 6754-71-6110, ref. 1R-0750 e 3304 4352-4356')).toEqual([])
    const r = mlSeoScore({ title: 'Bomba Usaparts 6754-71-6110', description: `${good}\nLigue (49) 3664-0888`, brand: 'Usaparts', partNumber: '6754-71-6110', attributes: attrs })
    expect(r.issues.some((i) => i.field === 'description' && i.text.includes('não aceita'))).toBe(true)
  })
})

describe('SEO Marketplace: textos', () => {
  it('descrição vira texto simples (sem HTML) e título fica em até 60', () => {
    expect(cleanMlDescription('<p>Linha 1</p><ul><li>a</li><li>b &amp; c</li></ul>\n\n\n\nfim')).toBe('Linha 1\n- a\n- b & c\n\nfim')
    const f = cleanMlSeoFields({ title: `  ${'x'.repeat(80)}  `, description: '<b>oi</b>', price: 10 })
    expect(f.title).toHaveLength(60)
    expect(f.description).toBe('oi')
    expect(Object.keys(f)).toEqual(['title', 'description'])
  })

  it('lê a resposta da IA (com ou sem markdown) e ignora campos vazios', () => {
    expect(parseMlSeoAnswer('```json\n{"description":"<p>Nova</p>","title":""}\n```')).toEqual({ description: 'Nova' })
    expect(parseMlSeoAnswer('sem json')).toBeNull()
    expect(parseMlSeoAnswer('{"preco": 10}')).toBeNull()
  })

  it('só os campos que mudaram vão para o Mercado Livre', () => {
    expect(mlChangedFields({ title: 'A', description: 'x' }, { title: 'A ', description: 'y' })).toEqual(['description'])
  })

  it('o prompt usa só os dados do anúncio, proíbe contato e não pede título quando o anúncio tem vendas', () => {
    const facts = { id: 'MLB123456789', title: 'Bomba', description: 'Atual', brand: 'Usaparts', partNumber: '6754-71-6110', sellerSku: 'BA-1', attributes: attrs }
    const sem = mlSeoPrompt(facts, { titleAllowed: false })
    expect(sem).toContain('6754-71-6110')
    expect(sem).toContain('deixe vazio')
    expect(sem).not.toContain('Modelo:')
    expect(mlSeoPrompt(facts, { titleAllowed: true, instruction: 'citar PC200' })).toContain('citar PC200')
    const sys = mlSeoSystem('Usaparts', '')
    expect(sys).toContain('Nunca invente compatibilidade')
    expect(sys).toContain('telefone')
  })

  it('título só muda sem vendas e fora do catálogo; id do anúncio validado', () => {
    expect(mlTitleAllowed({ sold_quantity: 0 })).toBe(true)
    expect(mlTitleAllowed({ sold_quantity: 3 })).toBe(false)
    expect(mlTitleAllowed({ sold_quantity: 0, catalog_listing: true })).toBe(false)
    expect(isMlItemId('MLB1234567890')).toBe(true)
    expect(isMlItemId('MLB12/../x')).toBe(false)
  })

  it('a permissão do módulo existe', () => {
    expect(MODULE_KEYS).toContain('seo_marketplace')
  })
})

describe('SEO Marketplace: texto fixo da loja', () => {
  it('vai no fim de todas as descrições, sem repetir', () => {
    const fixed = 'DIFERENCIAIS DA LOJA\n- Envio imediato'
    const d = withFixedText('PRODUTO\nBomba\n\nDÚVIDAS\nUse o campo de perguntas.', fixed)
    expect(d.endsWith(fixed)).toBe(true)
    expect(withFixedText(d, fixed)).toBe(d)
    expect(withFixedText('Texto', '')).toBe('Texto')
    expect(withFixedText('x'.repeat(20), fixed, 30).endsWith(fixed)).toBe(true)
  })
  it('não aceita contato no texto fixo', () => {
    expect(cleanMlFixed('Chame no WhatsApp (49) 99999-0000')).toHaveProperty('error')
    expect(cleanMlFixed(DEFAULT_ML_FIXED)).toEqual({ text: DEFAULT_ML_FIXED })
  })
})
