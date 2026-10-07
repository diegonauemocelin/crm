import { describe, expect, it } from 'vitest'
import { absoluteUrl, cleanHttpsBase, productFrom } from '../src/integracoes/magazord'

const ctx = { siteUrl: 'https://www.usaparts.com.br', imageBase: 'https://usaparts.cdn.magazord.com.br' }

describe('catálogo de produtos da Magazord', () => {
  it('monta nome, preços, imagem e link completos', () => {
    const p = productFrom(
      {
        derivacao_id: 77,
        produto_id: 10,
        codigo: 'RE539465',
        nome: 'Filtro de combustível',
        derivacao_nome: 'Único',
        valor: '75.74',
        valor_de: 90,
        qtde_estoque: '12',
        link: '/filtro-de-combustivel-re539465',
        midias: [
          { path: 'img/2024/01/produto/10/', arquivo_nome: 'b.jpg', ordem: 2 },
          { path: '/img/2024/01/produto/10', arquivo_nome: 'a.jpg', ordem: 1 },
        ],
      },
      ctx,
    )
    expect(p).toEqual({
      externalId: '77',
      code: 'RE539465',
      name: 'Filtro de combustível',
      brand: null,
      price: 75.74,
      priceFrom: 90,
      stock: 12,
      image: 'https://usaparts.cdn.magazord.com.br/img/2024/01/produto/10/a.jpg',
      url: 'https://www.usaparts.com.br/filtro-de-combustivel-re539465',
      active: true,
    })
  })

  it('aceita endereços já completos, preço com vírgula e ignora preço "de" menor', () => {
    const p = productFrom({ produto_id: 5, nome: 'Bomba', derivacao_nome: '24V', valor: '1.234,50', valor_de: '1.000,00', link: 'https://loja.com/b', midias: [{ path: 'https://cdn.x.com/b.png' }] }, { siteUrl: null, imageBase: null })
    expect(p).toMatchObject({ externalId: '5', name: 'Bomba - 24V', price: 1234.5, priceFrom: null, url: 'https://loja.com/b', image: 'https://cdn.x.com/b.png' })
  })

  it('sem identificador ou nome não entra; link perigoso é descartado', () => {
    expect(productFrom({ nome: 'x' }, ctx)).toBeNull()
    expect(productFrom({ produto_id: 1 }, ctx)).toBeNull()
    expect(absoluteUrl('javascript:alert(1)', ctx.siteUrl)).toBeNull()
    expect(absoluteUrl('http://inseguro.com/a', ctx.siteUrl)).toBeNull()
    expect(cleanHttpsBase('http://x.com')).toBeNull()
    expect(cleanHttpsBase('www.usaparts.com.br/')).toBe('https://www.usaparts.com.br')
  })
})
