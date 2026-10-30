import { describe, expect, it } from 'vitest'
import { buildComparison, comparisonRange, previousMonth } from '../src/marketing/comparativo'

// 10/10/2026 às 15h de Brasília.
const now = new Date('2026-10-10T18:00:00Z')
const at = (d: string, h = 15) => new Date(`${d}T${String(h + 3).padStart(2, '0')}:00:00Z`)

describe('Comparativo mensal com projeção', () => {
  it('mês anterior e intervalo de busca no horário de Brasília', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
    const r = comparisonRange(now)
    expect([r.month, r.prev]).toEqual(['2026-10', '2026-09'])
    expect(r.start.toISOString()).toBe('2026-09-01T03:00:00.000Z')
    expect(r.end.toISOString()).toBe('2026-11-01T03:00:00.000Z')
  })

  it('acumulado por dia, projeção pelo ritmo e comparação por canal', () => {
    const rows = [
      { source: 'atendimento' as const, at: at('2026-10-01'), value: 1000 },
      { source: 'ecommerce' as const, at: at('2026-10-05'), value: 1000 },
      { source: 'atendimento' as const, at: at('2026-09-02'), value: 500 },
      { source: 'atendimento' as const, at: at('2026-09-20'), value: 2500 },
      // 23h de 30/09 em Brasília ainda é setembro (já é 01/10 em UTC).
      { source: 'marketplace' as const, at: new Date('2026-10-01T02:00:00Z'), value: 100 },
      { source: 'ecommerce' as const, at: at('2026-08-31'), value: 9999 },
    ]
    const c = buildComparison(rows, 'tudo', now)
    expect(c.today).toBe(10)
    expect(c.daysInMonth).toBe(31)
    expect(c.series).toHaveLength(31)
    expect(c.series[0]).toMatchObject({ day: 1, current: 1000, previous: 0, projection: null })
    expect(c.series[9]).toMatchObject({ current: 2000, previous: 500, projection: 2000 })
    expect(c.series[10]!.current).toBeNull()
    expect(c.series[30]).toMatchObject({ previous: null, projection: 6200 })
    expect(c.series[29]!.previous).toBe(3100)
    const total = c.channels.find((x) => x.key === 'tudo')!
    expect(total).toMatchObject({ previous: { revenue: 3100, sales: 3 }, previousToDate: { revenue: 500, sales: 1 }, current: { revenue: 2000, sales: 2 }, projection: 6200 })
    expect(total.growth).toBeCloseTo(1, 5)
    expect(total.pace).toBeCloseTo(3, 5)
    expect(c.channels.find((x) => x.key === 'marketplace')).toMatchObject({ previous: { revenue: 100 }, current: { revenue: 0 }, projection: 0, growth: -1 })
  })

  it('um canal só no gráfico', () => {
    const c = buildComparison([{ source: 'ecommerce', at: at('2026-10-03'), value: 300 }, { source: 'atendimento', at: at('2026-10-03'), value: 700 }], 'ecommerce', now)
    expect(c.series[9]!.current).toBe(300)
    expect(c.channels.find((x) => x.key === 'atendimento')!.growth).toBeNull()
  })
})
