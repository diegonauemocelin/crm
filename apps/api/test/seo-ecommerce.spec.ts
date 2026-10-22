import { describe, expect, it } from 'vitest'
import { seoFromMagazord, seoToMagazord } from '../src/integracoes/magazord'
import { changedFields, cleanHtml, cleanSeoFields, parseSeoAnswer, plainText, seoPrompt, seoScore } from '../src/integracoes/seo'

const detail = {
  codigoProduto: 'KIT-PC200',
  nomeProduto: 'KIT PINOS E BUCHA KOMATSU PC200',
  marca: { id: 1, nome: 'Usaparts' },
  categorias: [{ nome: 'Material rodante' }, { nome: 'Pinos e buchas', principal: true }],
  atributos: [{ nome: 'Aplicação', valor: 'Komatsu PC200' }, { nome: '', valor: 'x' }],
  ean: [{ codigo: '789000', principal: true }],
  produtoLoja: [{ loja: 2, titulo: 'outra loja' }, { loja: 1, titulo: 'KIT PINOS E BUCHA KOMATSU PC200', tituloComplemento: '', descricao: '<p>APLICAÇÃO:</p><p>KOMATSU PC-200</p>', descricaoResumida: '' }],
}
const page = { id: 77, title: 'KIT PINOS E BUCHA KOMATSU PC200', titleSeo: 'KIT PINOS E BUCHA KOMATSU PC200', metaDescription: '', url_pagina: '/kit-pinos-e-bucha-pc200' }

describe('SEO do e-commerce: Magazord', () => {
  it('lê a aba SEO (página) e a Descrição Geral da loja certa', () => {
    const r = seoFromMagazord(detail, page, 1)
    expect(r.productCode).toBe('KIT-PC200')
    expect(r.pageId).toBe(77)
    expect(r.categories[0]).toBe('Pinos e buchas')
    expect(r.attributes).toEqual([{ name: 'Aplicação', value: 'Komatsu PC200' }])
    expect(r.fields).toMatchObject({ seoTitle: 'KIT PINOS E BUCHA KOMATSU PC200', url: 'kit-pinos-e-bucha-pc200', title: 'KIT PINOS E BUCHA KOMATSU PC200', metaDescription: '' })
    expect(seoFromMagazord({ ...detail, produtoLoja: [] }, null, 1).pageId).toBeNull()
  })

  it('envia só o que mudou: página (aba SEO) e produto x loja (Descrição Geral) separados', () => {
    expect(seoToMagazord({ seoTitle: 'Kit Pinos e Bucha Komatsu PC200 | Usaparts', metaDescription: 'Meta' }, 1)).toEqual({ page: { loja: 1, titleSeo: 'Kit Pinos e Bucha Komatsu PC200 | Usaparts', metaDescription: 'Meta' }, product: null })
    expect(seoToMagazord({ description: '<p>x</p>', searchKeywords: 'pino, bucha' }, 1)).toEqual({ page: null, product: { produtoLoja: [{ loja: 1, descricao: '<p>x</p>' }], palavraChave: 'pino, bucha' } })
    expect(seoToMagazord({}, 1)).toEqual({ page: null, product: null })
  })

  it('o Subtítulo (tituloComplemento) fica como está na loja: não é lido, sugerido nem enviado', () => {
    const r = seoFromMagazord({ ...detail, produtoLoja: [{ loja: 1, titulo: 'T', tituloComplemento: '<strong>Part Number: </strong>73156667' }] }, page, 1)
    expect(JSON.stringify(r)).not.toContain('Part Number')
    expect(seoToMagazord({ subtitle: 'novo', title: 'T2' }, 1)).toEqual({ page: null, product: { produtoLoja: [{ loja: 1, titulo: 'T2' }] } })
    expect(seoToMagazord({ subtitle: 'novo' }, 1)).toEqual({ page: null, product: null })
    expect(cleanSeoFields({ subtitle: 'x', title: 'y' } as never)).toEqual({ title: 'y' })
    expect(seoPrompt({ name: 'P', code: 'C', brand: null, categories: [], attributes: [], ean: null }, {})).not.toMatch(/subt[ií]tulo|subtitle/i)
  })
})

describe('SEO do e-commerce: regras', () => {
  it('HTML da descrição sem script, estilo nem atributos', () => {
    expect(cleanHtml('<p style="color:red" onclick="x()">Oi <b>forte</b></p><script>alert(1)</script><ul><li>a</li></ul><img src=x onerror=y>')).toBe('<p>Oi <strong>forte</strong></p><ul><li>a</li></ul>')
    expect(plainText('<p>Aplicação:</p><ul><li>PC200</li></ul>')).toBe('Aplicação:\nPC200')
  })

  it('nota: produto do print (só título em maiúsculas, sem meta e descrição curta) fica baixo; completo fica alto', () => {
    const fraco = seoScore(seoFromMagazord(detail, page, 1).fields)
    expect(fraco.score).toBeLessThan(60)
    expect(fraco.issues.map((i) => i.field)).toEqual(expect.arrayContaining(['seoTitle', 'metaDescription', 'description']))
    const bom = seoScore({ seoTitle: 'Kit Pinos e Bucha para Komatsu PC200 | Usaparts', metaDescription: 'Kit de pinos e buchas para a Komatsu PC200 com importação direta e suporte técnico. Peça seu orçamento e receba em todo o Brasil.', description: `<p>${'Texto completo do produto. '.repeat(30)}</p>`, summary: 'Resumo' })
    expect(bom.score).toBe(100)
    expect(seoScore({ seoTitle: 'Kit Pinos e Bucha para Komatsu PC200 | Usaparts' }, true).issues.some((i) => i.text.includes('igual'))).toBe(true)
  })

  it('limpa o que vem da IA ou da tela; detecta o que mudou', () => {
    const f = cleanSeoFields({ seoTitle: '  Título  ', url: 'Kit Pinos & Bucha PC-200', description: '<p onclick=x>a</p>', inventado: 'x' } as never)
    expect(f).toEqual({ seoTitle: 'Título', url: 'kit-pinos-bucha-pc-200', description: '<p>a</p>' })
    expect(changedFields({ seoTitle: 'A', title: 'B' }, { seoTitle: 'A ', title: 'C' })).toEqual(['title'])
  })

  it('pedido para a IA traz os dados reais e a regra de não inventar; resposta em JSON é aceita', () => {
    const p = seoPrompt({ name: 'Kit', code: 'K1', brand: 'Usaparts', categories: ['Pinos'], attributes: [{ name: 'Aplicação', value: 'PC200' }], ean: null }, { description: '<p>APLICAÇÃO: PC200</p>' })
    expect(p).toContain('- Aplicação: PC200')
    expect(p).toContain('APLICAÇÃO: PC200')
    expect(parseSeoAnswer('```json\n{"seoTitle":"Kit Pinos","metaDescription":"M","description":"<p>D</p><script>x</script>"}\n```')).toEqual({ seoTitle: 'Kit Pinos', metaDescription: 'M', description: '<p>D</p>' })
    expect(parseSeoAnswer('sem json')).toBeNull()
  })
})
