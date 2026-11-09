import { describe, expect, it } from 'vitest'
import { cepsOf, cleanConfig, DEFAULT_MERCHANT_FRETE, matchSku, regionId, shippingAttribute, UF_CEP_RANGES, UF_REF_CEP, UFS, ufQuote } from '../src/merchant/frete-google'

describe('frete no Google Shopping', () => {
  it('cada estado tem faixas de CEP válidas e o CEP de referência cai numa delas', () => {
    for (const uf of UFS) {
      const ranges = UF_CEP_RANGES[uf]
      expect(ranges.length, uf).toBeGreaterThan(0)
      for (const [b, e] of ranges) expect(b.length, uf).toBe(e.length)
      const cep = UF_REF_CEP[uf]
      const inside = ranges.some(([b, e]) => {
        const n = b.length - 1
        const p = cep.slice(0, n)
        return p >= b.slice(0, n) && p <= e.slice(0, n)
      })
      expect(inside, `${uf} ${cep}`).toBe(true)
    }
  })

  it('frete do estado: a opção mais barata de cada CEP, e a maior entre os CEPs', () => {
    expect(ufQuote('SC', [[{ price: 30, days: 5 }, { price: 25, days: 8 }], [{ price: 40, days: 9 }]])).toEqual({ uf: 'SC', price: 40, days: 9 })
    expect(ufQuote('AC', [[{ price: 30, days: 5 }], []])).toEqual({ uf: 'AC', price: null, days: null })
  })

  it('atributo shipping por região, em micros', () => {
    const s = shippingAttribute([{ uf: 'SC', price: 39.9, days: 4 }, { uf: 'AC', price: null, days: null }], { service: 'Entrega', handlingMin: 1, handlingMax: 2 })
    expect(s).toEqual([{ price: { amountMicros: '39900000', currencyCode: 'BRL' }, country: 'BR', region: regionId('SC'), service: 'Entrega', minHandlingTime: '1', maxHandlingTime: '2', minTransitTime: '4', maxTransitTime: '4' }])
  })

  it('CEPs do estado e validação da configuração', () => {
    expect(cepsOf({ ceps: {} }, 'SC')).toEqual(['88010000'])
    expect(cepsOf({ ceps: { SC: ['89874-000', 'x'] } }, 'SC')).toEqual(['89874000'])
    expect(cleanConfig({ enabled: true }, DEFAULT_MERCHANT_FRETE)).toEqual({ error: 'Informe o número da conta do Merchant Center.' })
    expect(cleanConfig({ handlingMin: 3, handlingMax: 1 }, DEFAULT_MERCHANT_FRETE)).toMatchObject({ error: expect.stringMatching(/manuseio/) })
  })

  it('liga o produto do Google ao SKU da Magazord pelo id ou pelo endereço', () => {
    const store = [{ externalId: 'ABC-1', code: '1001', path: '/filtro-de-ar', url: null }, { externalId: 'XYZ', code: '2002', path: null, url: 'https://loja.com.br/kit-filtro' }]
    expect(matchSku({ offerId: 'abc-1' }, store)).toBe('ABC-1')
    expect(matchSku({ offerId: '1001' }, store)).toBe('ABC-1')
    expect(matchSku({ offerId: 'zz', link: 'https://loja.com.br/kit-filtro/' }, store)).toBe('XYZ')
    expect(matchSku({ offerId: 'zz', link: 'https://loja.com.br/outro' }, store)).toBeNull()
  })
})
