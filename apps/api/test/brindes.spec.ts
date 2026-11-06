import { describe, expect, it } from 'vitest'
import { balances, dayOf, deliveryProblem, monthOf, monthRange } from '../src/brindes/brindes'

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
