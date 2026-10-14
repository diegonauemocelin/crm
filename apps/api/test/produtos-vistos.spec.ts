import { describe, expect, it } from 'vitest'
import { groupByPage, itemMatches, productStatus, rankOpportunities } from '../src/catalogo/vistos'
import { pagePath } from '../src/rastreamento/origem'

const row = (o: Partial<Parameters<typeof groupByPage>[0][number]>) => ({
  id: 'p1', code: '042442', externalId: '9001', name: 'Filtro Racor', brand: 'Racor', price: 75.74, stock: 3, image: null, url: 'https://www.usaparts.com.br/filtro-racor', path: '/filtro-racor', active: true, ...o,
})

describe('caminho da página', () => {
  it('ignora domínio, parâmetros, barra final e maiúsculas', () => {
    expect(pagePath('https://www.usaparts.com.br/Filtro-Racor-RE539465/?utm_source=x#avaliacoes')).toBe('/filtro-racor-re539465')
    expect(pagePath('https://app.usaparts.com.br/filtro-racor-re539465')).toBe('/filtro-racor-re539465')
    expect(pagePath('https://www.usaparts.com.br/')).toBeNull()
    expect(pagePath(null)).toBeNull()
  })
})

describe('produtos vistos', () => {
  it('junta as variações da mesma página', () => {
    const pages = groupByPage([
      row({}),
      row({ id: 'p2', code: '042442', externalId: '9002', name: 'Filtro Racor - Kit 2', price: 70, stock: 2 }),
      row({ id: 'p3', externalId: '9003', name: 'Filtro Racor - Kit 3', price: 10, stock: -1, active: false }),
      row({ id: 'p4', code: 'X1', externalId: 'X1', name: 'Outro', path: '/outro', stock: null }),
    ])
    const p = pages.get('/filtro-racor')!
    expect(p.name).toBe('Filtro Racor')
    expect(p.price).toBe(70)
    expect(p.stock).toBe(5)
    expect(p.codes).toEqual(['042442', '9001', '9002', '9003'])
    expect(pages.get('/outro')!.stock).toBeNull()
  })

  it('reconhece o item pelo código do produto ou da variação', () => {
    expect(itemMatches('042442', ['042442'])).toBe(true)
    expect(itemMatches('042442P', ['042442'])).toBe(true)
    expect(itemMatches('0424429999', ['042442'])).toBe(false)
    expect(itemMatches('12', ['1'])).toBe(false)
    expect(itemMatches('', ['042442'])).toBe(false)
  })

  it('situação: comprou, no carrinho ou só viu (só conta depois da visita)', () => {
    const page = groupByPage([row({})]).get('/filtro-racor')!
    const v = { leadId: 'L1', path: '/filtro-racor', views: 3, firstAt: new Date('2026-10-05T10:00:00Z'), lastAt: new Date('2026-10-08T10:00:00Z') }
    const cart = (status: number, at: string, code = '042442') => ({ leadId: 'L1', status, at: new Date(at), items: [{ code }] })
    expect(productStatus(v, page, [], [])).toBe('viu')
    expect(productStatus(v, page, [cart(2, '2026-10-06T00:00:00Z')], [])).toBe('carrinho')
    expect(productStatus(v, page, [cart(3, '2026-10-06T00:00:00Z')], [])).toBe('comprou')
    expect(productStatus(v, page, [cart(3, '2026-09-01T00:00:00Z')], [])).toBe('viu')
    expect(productStatus(v, page, [cart(3, '2026-10-06T00:00:00Z', 'OUTRO')], [])).toBe('viu')
    expect(productStatus(v, page, [], [{ leadId: 'L1', at: new Date('2026-10-09T00:00:00Z'), items: [{ id: '042442P' }] }])).toBe('comprou')
    expect(productStatus(v, page, [{ leadId: 'L1', status: 3, at: new Date('2026-10-06T00:00:00Z'), items: [{ url: 'https://www.usaparts.com.br/filtro-racor?x=1' }] }], [])).toBe('comprou')
  })

  it('oportunidades: carrinho primeiro, depois quem viu mais', () => {
    const at = (d: string) => new Date(d)
    const out = rankOpportunities([
      { id: 'a', views: 2, lastAt: at('2026-10-08'), status: 'viu' },
      { id: 'b', views: 5, lastAt: at('2026-10-01'), status: 'viu' },
      { id: 'c', views: 1, lastAt: at('2026-10-02'), status: 'carrinho' },
    ])
    expect(out.map((o) => o.id)).toEqual(['c', 'b', 'a'])
  })
})
