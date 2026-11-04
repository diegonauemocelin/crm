import { describe, expect, it } from 'vitest'
import { board, span } from '../../web/src/lib/coletas'
import { cleanPickups } from '../src/fretes/coletas'

const row = (carrier: string, cutoff: string, pickup: string, days = [1, 2, 3, 4, 5]) => ({ carrierId: carrier, carrier, unit: null, unitId: null, days, cutoff, pickup, minutes: 30, note: null })

describe('fretes: painel de coletas (TV)', () => {
  it('carregando, chegando, em seguida e coletado pelo relógio do computador', () => {
    const rows = [row('Ouro e Prata', '14:00', '15:00'), row('São Miguel', '15:30', '16:30'), row('Patrus', '10:00', '11:00'), row('Alfa', '16:00', '17:00'), row('Só sábado', '09:00', '10:00', [6])]
    const now = new Date(2026, 10, 4, 15, 10) // quarta, 15:10
    const b = board(rows, now)
    expect(b.map((x) => [x.carrier, x.status])).toEqual([
      ['Ouro e Prata', 'CARREGANDO'],
      ['São Miguel', 'CHEGANDO'],
      ['Alfa', 'EM_SEGUIDA'],
      ['Patrus', 'COLETADO'],
    ])
    expect(span(b[1]!.toCutoff)).toBe('20 min')
    expect(span(65)).toBe('1 h 05 min')
  })

  it('valida os horários das coletas', () => {
    expect(cleanPickups([{ days: [1, 1, 9], cutoff: '15:00', pickup: '16:00' }], new Set())).toEqual([{ unitId: null, days: [1], cutoff: '15:00', pickup: '16:00', minutes: 30, note: null }])
    expect(() => cleanPickups([{ days: [1], cutoff: '17:00', pickup: '16:00' }], new Set())).toThrow(/passa da hora da coleta/)
    expect(() => cleanPickups([{ days: [1], cutoff: '15:00', pickup: '16:00', unitId: 'x' }], new Set())).toThrow(/filial inválida/)
  })
})
