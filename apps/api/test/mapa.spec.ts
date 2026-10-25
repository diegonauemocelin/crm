import { describe, expect, it } from 'vitest'
import { aggregateMap, type MapRow, orderSource, ufOf } from '../src/marketing/mapa'

const rows: MapRow[] = [
  { source: 'atendimento', state: 'SC', city: 'Chapecó', value: 1000, sale: true },
  { source: 'atendimento', state: 'sc', city: 'chapecó ', value: 0, sale: false },
  { source: 'atendimento', state: 'Paraná', city: 'Curitiba', value: 500, sale: true },
  { source: 'ecommerce', state: 'São Paulo', city: 'Campinas', value: 250.5, sale: true },
  { source: 'marketplace', state: 'SP', city: 'Campinas', value: 99.5, sale: true },
  { source: 'marketplace', state: null, city: null, value: 80, sale: true },
  { source: 'atendimento', state: 'XX', city: null, value: 0, sale: false },
]

describe('mapa de vendas', () => {
  it('reconhece o estado pela sigla ou pelo nome, com ou sem acento', () => {
    expect(ufOf('sc')).toBe('SC')
    expect(ufOf('Paraná')).toBe('PR')
    expect(ufOf('sao paulo')).toBe('SP')
    expect(ufOf('Distrito Federal')).toBe('DF')
    expect(ufOf('XX')).toBeNull()
    expect(ufOf('')).toBeNull()
  })

  it('separa e-commerce de marketplace pelo canal do pedido', () => {
    expect(orderSource(null)).toBe('ecommerce')
    expect(orderSource('Site')).toBe('ecommerce')
    expect(orderSource('PDV')).toBe('ecommerce')
    expect(orderSource('Mercado Livre')).toBe('marketplace')
    expect(orderSource('Shopee')).toBe('marketplace')
  })

  it('tudo junto: vendas, pedidos e atendimentos por estado e cidade; sem estado fica de fora do mapa', () => {
    const r = aggregateMap(rows, 'tudo')
    expect(r.totals).toEqual({ sales: 1930, orders: 5, attendances: 4 })
    expect(r.noState).toEqual({ sales: 80, orders: 1, attendances: 1 })
    expect(r.states.map((s) => s.uf)).toEqual(['SC', 'PR', 'SP'])
    const sc = r.states[0]!
    expect(sc).toMatchObject({ sales: 1000, orders: 1, attendances: 2 })
    expect(sc.cities).toEqual([{ city: 'Chapecó', sales: 1000, orders: 1, attendances: 2 }])
    expect(r.states[2]!.cities[0]).toEqual({ city: 'Campinas', sales: 350, orders: 2, attendances: 0 })
  })

  it('filtra pela origem', () => {
    expect(aggregateMap(rows, 'atendimento').states.map((s) => [s.uf, s.sales, s.attendances])).toEqual([
      ['SC', 1000, 2],
      ['PR', 500, 1],
    ])
    expect(aggregateMap(rows, 'ecommerce').totals).toEqual({ sales: 250.5, orders: 1, attendances: 0 })
    expect(aggregateMap(rows, 'marketplace').states).toEqual([{ uf: 'SP', sales: 99.5, orders: 1, attendances: 0, cities: [{ city: 'Campinas', sales: 99.5, orders: 1, attendances: 0 }] }])
  })
})
