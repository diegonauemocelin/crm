import { describe, expect, it } from 'vitest'
import { canMoveSchedule, scheduleDate, spDate } from '../src/fretes/coletas'

describe('coletas agendadas', () => {
  // 23/11/2026 02:00 UTC = 22/11 23:00 em São Paulo.
  const now = new Date('2026-11-23T02:00:00Z')

  it('hoje e amanhã pelo fuso de São Paulo', () => {
    expect(spDate(now)).toBe('2026-11-22')
    expect(scheduleDate('HOJE', now)).toBe('2026-11-22')
    expect(scheduleDate('AMANHA', now)).toBe('2026-11-23')
  })

  it('data escolhida: de hoje até 30 dias', () => {
    expect(scheduleDate('2026-11-25', now)).toBe('2026-11-25')
    expect(scheduleDate('2026-11-21', now)).toBeNull()
    expect(scheduleDate('2027-02-01', now)).toBeNull()
    expect(scheduleDate('ontem', now)).toBeNull()
  })

  it('mudanças de situação', () => {
    expect(canMoveSchedule('AGENDADA', 'COLETANDO')).toBe(true)
    expect(canMoveSchedule('COLETANDO', 'COLETADA')).toBe(true)
    expect(canMoveSchedule('COLETANDO', 'AGENDADA')).toBe(true)
    expect(canMoveSchedule('COLETADA', 'AGENDADA')).toBe(false)
    expect(canMoveSchedule('CANCELADA', 'COLETANDO')).toBe(false)
  })
})
