import { describe, expect, it } from 'vitest'
import { balances, dayOf, deliveryProblem, holderKey, mergeLines, monthOf, monthRange, monthsBetween, parseHolder, reportOf } from '../src/brindes/brindes'

describe('controle de brindes', () => {
  it('mês e dia', () => {
    expect(monthOf('2026-11')).toBe('2026-11')
    expect(monthOf('2026-13', new Date('2026-11-01T02:00:00Z'))).toBe('2026-10')
    expect(monthRange('2026-12')).toEqual({ start: new Date('2026-12-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') })
    expect(dayOf('2026-11-06')).toBe('2026-11-06')
    expect(dayOf('x', new Date('2026-11-06T12:00:00Z'))).toBe('2026-11-06')
  })

  it('saldo do mês vai diminuindo até zero', () => {
    const b = balances([{ giftId: 'copo', monthly: 5 }, { giftId: 'chapeu', monthly: 6 }], [{ giftId: 'copo', quantity: 2 }, { giftId: 'copo', quantity: 3 }, { giftId: 'chapeu', quantity: 1 }])
    expect(b).toEqual([
      { giftId: 'copo', quota: 5, used: 5, remaining: 0 },
      { giftId: 'chapeu', quota: 6, used: 1, remaining: 5 },
    ])
  })

  it('bloqueia sem cota, sem saldo ou sem estoque', () => {
    expect(deliveryProblem({ quantity: 1, stock: 10, quota: 5, used: 4, giftName: 'Copo' })).toBeNull()
    expect(deliveryProblem({ quantity: 2, stock: 10, quota: 5, used: 4, giftName: 'Copo' })).toBe('Saldo do mês de Copo: só 1.')
    expect(deliveryProblem({ quantity: 1, stock: 10, quota: 5, used: 5, giftName: 'Copo' })).toMatch(/já acabou/)
    expect(deliveryProblem({ quantity: 1, stock: 0, quota: 5, used: 0, giftName: 'Copo' })).toBe('Copo sem estoque.')
    expect(deliveryProblem({ quantity: 1, stock: 3, quota: null, used: 0, giftName: 'Copo' })).toMatch(/não tem cota/)
    expect(deliveryProblem({ quantity: 0, stock: 3, quota: 5, used: 0, giftName: 'Copo' })).toMatch(/quantidade/)
  })
})

describe('brindes: filiais e resumo', () => {
  const id = '3f2b8c1e-9a4d-4b7e-8c21-5d6e7f809a1b'
  it('lê vendedor ou filial', () => {
    expect(parseHolder(`u:${id}`)).toEqual({ kind: 'unit', id })
    expect(parseHolder(`s:${id}`)).toEqual({ kind: 'seller', id })
    expect(parseHolder(id)).toEqual({ kind: 'seller', id })
    expect(parseHolder('x:1')).toBeNull()
    expect(parseHolder('')).toBeNull()
    expect(holderKey({ sellerId: null, unitId: id })).toBe(`u:${id}`)
    expect(holderKey({ sellerId: id, unitId: null })).toBe(`s:${id}`)
  })
  it('meses do período, na virada do ano e invertido', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthsBetween('2027-01', '2026-12')).toEqual(['2026-12', '2027-01'])
    expect(monthsBetween('2020-01', '2030-01')).toHaveLength(24)
  })
  it('soma por brinde, por quem entregou e por mês', () => {
    const row = (month: string, giftId: string, holder: string, quantity: number, value: number, customerCode = 'C1') => ({ month, giftId, gift: giftId, holder, holderName: holder, holderKind: 'seller' as const, customerCode, quantity, value })
    const r = reportOf([row('2026-10', 'copo', 's:a', 2, 20), row('2026-11', 'copo', 'u:b', 1, 10, 'c2'), row('2026-11', 'bone', 's:a', 3, 45.5, 'c1')], ['2026-10', '2026-11'])
    expect(r.quantity).toBe(6)
    expect(r.value).toBe(75.5)
    expect(r.customers).toBe(2)
    expect(r.byGift.map((g) => [g.giftId, g.quantity])).toEqual([['bone', 3], ['copo', 3]])
    expect(r.byHolder[0]).toMatchObject({ id: 's:a', quantity: 5, value: 65.5 })
    expect(r.byMonth).toEqual([{ month: '2026-10', quantity: 2, value: 20 }, { month: '2026-11', quantity: 4, value: 55.5 }])
  })
})

describe('brindes: vários na mesma retirada e brinde sem cota', () => {
  it('junta o mesmo brinde e descarta quantidade inválida', () => {
    expect(mergeLines([{ giftId: 'a', quantity: 1 }, { giftId: 'b', quantity: 2 }, { giftId: 'a', quantity: 3 }, { giftId: 'c', quantity: 0 }])).toEqual([{ giftId: 'a', quantity: 4 }, { giftId: 'b', quantity: 2 }])
    expect(mergeLines([])).toEqual([])
  })
  it('brinde sem cota só olha o estoque', () => {
    expect(deliveryProblem({ quantity: 2, stock: 5, quota: null, used: 0, giftName: 'Caneta', hasQuota: false })).toBeNull()
    expect(deliveryProblem({ quantity: 6, stock: 5, quota: null, used: 0, giftName: 'Caneta', hasQuota: false })).toBe('Estoque de Caneta: só 5.')
    expect(deliveryProblem({ quantity: 1, stock: 5, quota: null, used: 0, giftName: 'Caneta' })).toMatch(/não tem cota/)
  })
})
