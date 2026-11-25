import { describe, expect, it } from 'vitest'
import { canUndoCollected, collectCounts, pickupAlerts, spClock } from '../src/fretes/coletas'

describe('app da expedição: coletas', () => {
  it('volumes e notas: opcionais ou obrigatórios pela transportadora', () => {
    expect(collectCounts({}, false)).toEqual({ volumes: null, invoices: null })
    expect(collectCounts({ volumes: 12, invoices: 3 }, true)).toEqual({ volumes: 12, invoices: 3 })
    expect(() => collectCounts({ volumes: 12 }, true)).toThrow('Informe a quantidade de notas entregues na coleta.')
    expect(() => collectCounts({ volumes: -1 }, false)).toThrow('Quantidade de volumes inválida.')
    expect(() => collectCounts({ invoices: 1.5 }, false)).toThrow('Quantidade de notas inválida.')
  })
  it('desfazer o Coletou só nos 10 minutos seguintes', () => {
    const at = new Date('2026-11-25T15:00:00Z')
    expect(canUndoCollected(at, new Date('2026-11-25T15:09:00Z'))).toBe(true)
    expect(canUndoCollected(at, new Date('2026-11-25T15:11:00Z'))).toBe(false)
    expect(canUndoCollected(null, at)).toBe(false)
  })
  it('hora de São Paulo', () => {
    expect(spClock(new Date('2026-11-25T18:45:00Z'))).toEqual({ day: 3, minutes: 15 * 60 + 45 })
  })
  it('avisa 15 min antes do corte e da chegada; agendada no início do período; coleta já marcada não avisa a chegada', () => {
    const fixed = [{ carrierId: 'tw', carrier: 'TW', pickups: [{ unitId: null, days: [3], cutoff: '16:00', pickup: '16:15', minutes: 30, note: null }] }]
    const at1545 = pickupAlerts(fixed, [], { day: 3, minutes: 15 * 60 + 45 }, '2026-11-25')
    expect(at1545.map((a) => a.kind)).toEqual(['CORTE'])
    const at1600 = pickupAlerts(fixed, [], { day: 3, minutes: 16 * 60 }, '2026-11-25')
    expect(at1600.map((a) => a.kind)).toEqual(['COLETA'])
    const marked = [{ id: 'x', carrierId: 'tw', carrier: 'TW', unitId: null, period: 'FIXA', status: 'COLETANDO', slot: '16:15' }]
    expect(pickupAlerts(fixed, marked, { day: 3, minutes: 16 * 60 }, '2026-11-25')).toEqual([])
    expect(pickupAlerts(fixed, [], { day: 4, minutes: 16 * 60 }, '2026-11-25')).toEqual([])
    const ag = [{ id: 'a1', carrierId: 'rod', carrier: 'Rodonaves', unitId: null, period: 'TARDE', status: 'AGENDADA', slot: null }]
    expect(pickupAlerts([], ag, { day: 3, minutes: 12 * 60 + 45 }, '2026-11-25').map((a) => a.key)).toEqual(['2026-11-25|agendada|a1'])
  })
})
