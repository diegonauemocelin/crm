import { describe, expect, it } from 'vitest'
import { pickVersionsAt } from '../src/fretes/versoes'

const d = (s: string) => new Date(`${s}T12:00:00Z`)
const v = (id: string, published: string, from: string | null = null, tableId = 't') => ({ id, tableId, publishedAt: d(published), ctesFrom: from ? d(from) : null })

describe('versão da tabela na data do CT-e', () => {
  it('sem correção: a última publicada até a data', () => {
    const list = [v('v1', '2026-10-01'), v('v2', '2026-11-20'), v('v3', '2026-11-26')]
    expect(pickVersionsAt(list, d('2026-11-25')).get('t')).toBe('v2')
    expect(pickVersionsAt(list, d('2026-10-15')).get('t')).toBe('v1')
    expect(pickVersionsAt(list, d('2026-09-01')).has('t')).toBe(false)
  })
  it('correção vale desde a data e ganha da versão que corrige', () => {
    const list = [v('v1', '2026-10-01'), v('v2', '2026-11-20'), v('v3', '2026-11-26', '2026-11-01')]
    expect(pickVersionsAt(list, d('2026-11-25')).get('t')).toBe('v3')
    expect(pickVersionsAt(list, d('2026-11-21')).get('t')).toBe('v3')
    expect(pickVersionsAt(list, d('2026-10-20')).get('t')).toBe('v1')
  })
  it('separa por tabela', () => {
    const list = [v('a1', '2026-11-01', null, 'a'), v('b1', '2026-11-30', '2026-11-01', 'b')]
    const r = pickVersionsAt(list, d('2026-11-10'))
    expect([r.get('a'), r.get('b')]).toEqual(['a1', 'b1'])
  })
})
