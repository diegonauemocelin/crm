import { describe, expect, it } from 'vitest'
import { compareByCode, competitorCodes, ownCodes, usableCode } from '../src/assistente/concorrentes'

describe('concorrentes do Mercado Livre', () => {
  it('pega o código dos campos Número de peça, Modelo e OEM e do título, sem modelo de máquina curto', () => {
    const codes = competitorCodes(
      [
        { id: 'BRAND', name: 'Marca', value_name: 'Usaparts' },
        { id: 'MODEL', name: 'Modelo', value_name: '30/925441' },
        { id: 'PART_NUMBER', name: 'Número de peça', value_name: '30-925441' },
        { id: 'X', name: 'Número de identificação de peça automotiva usada', value_name: '30.925441' },
        { id: 'VEHICLE_TYPE', name: 'Tipo de veículo', value_name: 'Linha Pesada' },
      ],
      'Hélice Motor 24 Pol 9 Pás Jcb Js200 1R-0750',
    )
    expect(codes.sort()).toEqual(['1R0750', '30925441'])
    expect(usableCode('JS200')).toBe(false)
    expect(usableCode('320D')).toBe(false)
    expect(usableCode('P821575')).toBe(true)
  })

  it('mostra só os produtos iguais, a oferta mais barata de cada loja e a pior diferença primeiro', () => {
    const own = [
      { id: 'MLB1', title: 'Hélice Usaparts', price: 500, permalink: null, codes: ['30925441'] },
      { id: 'MLB2', title: 'Filtro Usaparts', price: 100, permalink: null, codes: ['P821575'] },
      { id: 'MLB3', title: 'Sem concorrente', price: 80, permalink: null, codes: ['999999'] },
    ]
    const now = Date.parse('2026-11-03T12:00:00Z')
    const r = (competitorId: string, itemId: string, price: number, codes: string[], previousPrice: number | null = null) => ({ competitorId, itemId, title: itemId, price, previousPrice, priceChangedAt: previousPrice ? new Date(now - 86_400_000) : null, permalink: null, freeShipping: false, codes })
    const rows = compareByCode(own, [r('A', 'MLBA1', 450, ['30925441']), r('A', 'MLBA2', 470, ['30925441']), r('B', 'MLBB1', 520, ['30925441']), r('B', 'MLBB2', 85, ['P821575'], 110)], now)
    expect(rows.map((x) => x.item.id)).toEqual(['MLB2', 'MLB1'])
    expect(rows[0]).toMatchObject({ cheaper: true, worst: -0.15 })
    expect(rows[0]!.offers[0]).toMatchObject({ itemId: 'MLBB2', dropped: true })
    expect(rows[1]!.offers.map((o) => [o.itemId, o.diff])).toEqual([['MLBA1', -0.1], ['MLBB1', 0.04]])
  })

  it('acha o código no título do anúncio da própria loja (32/925682 = 32925682)', () => {
    expect(ownCodes({ title: 'Filtro Ar Primario Jcb 3c 3cx 4cx 32925682' })).toContain('32925682')
    expect(competitorCodes([{ id: 'PART_NUMBER', value_name: '32/925682' }], 'Filtro de ar')).toContain('32925682')
  })
})
