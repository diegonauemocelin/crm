import { describe, expect, it } from 'vitest'
import { cheapestRivals, itemLink, type RivalOffer } from '../src/marketplaces/precos/concorrentes-preco'

const o = (itemId: string, price: number, source: RivalOffer['source'] = 'CODIGO', seller: string | null = 'LOJA'): RivalOffer => ({ itemId, title: null, price, permalink: null, seller, freeShipping: false, source })

describe('preços de concorrentes', () => {
  it('fica com os 2 mais baratos, sem o próprio anúncio nem repetidos', () => {
    const r = cheapestRivals([o('MLB3', 300), o('MLB1', 250), o('MLB9', 100), o('MLB2', 260, 'CATALOGO'), o('MLB1', 250, 'CATALOGO', null), o('MLB4', 0)], 'MLB9')
    expect(r.map((x) => x.itemId)).toEqual(['MLB1', 'MLB2'])
    expect(r[0].source).toBe('CODIGO')
  })
  it('prefere a loja cadastrada quando o mesmo anúncio vem do catálogo', () => {
    const r = cheapestRivals([o('MLB1', 250, 'CATALOGO', null), o('MLB1', 250, 'CODIGO', 'X')], 'MLB0')
    expect(r).toHaveLength(1)
    expect(r[0].seller).toBe('X')
  })
  it('link público', () => expect(itemLink('MLB123')).toBe('https://produto.mercadolivre.com.br/MLB-123'))
})
