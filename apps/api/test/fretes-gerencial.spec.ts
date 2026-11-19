import { describe, expect, it } from 'vitest'
import { notaVsCte, summarize, type CteFact } from '../src/fretes/gerencial'

const row = (p: Partial<CteFact>): CteFact => ({ carrier: 'A', month: '2026-11', total: 100, expected: 100, recStatus: 'CONCILIADO', credit: null, weight: 10, nota: null, seller: null, uf: 'SC', city: 'Itajai', customer: 'Cliente X', ...p })

describe('visão gerencial dos fretes', () => {
  it('nota × CT-e com folga', () => {
    expect(notaVsCte(90, 100, 1)).toBe('MENOS')
    expect(notaVsCte(99.5, 100, 1)).toBe('IGUAL')
    expect(notaVsCte(120, 100, 1)).toBe('MAIS')
  })

  it('soma CT-es, tabela, divergência e o cobrado nas notas CIF', () => {
    const s = summarize(
      [
        row({ total: 120, expected: 100, recStatus: 'DIVERGENTE', nota: 80, seller: 'Ana', credit: 5 }),
        row({ total: 50, expected: null, recStatus: 'SEM_REFERENCIA', nota: null, carrier: 'B', month: '2026-10' }),
        row({ total: 100, expected: 100, nota: 130, seller: 'Bia' }),
        row({ total: 60, expected: 60, nota: 60, seller: 'Ana' }),
      ],
      1,
    )
    expect(s.totals).toMatchObject({ ctes: 4, cobrado: 330, esperado: 260, comReferencia: 3, acimaTabela: 20, acimaTabelaCtes: 1, divergentes: 1, conciliados: 2, credito: 5, kg: 40, porKg: 8.25, pctDivergente: 25 })
    expect(s.nota).toMatchObject({ ctes: 3, nota: 270, cte: 280, menos: 1, menosValor: 40, mais: 1, maisValor: 30, iguais: 1, resultado: -10 })
    expect(s.months.map((m) => m.month)).toEqual(['2026-10', '2026-11'])
    expect(s.carriers[0]).toMatchObject({ name: 'A', ctes: 3, cobrado: 280, acimaTabela: 20 })
    expect(s.sellers[0]).toMatchObject({ name: 'Ana', ctes: 2, menos: 1, menosValor: 40, resultado: -40 })
    expect(s.sellers[1]).toMatchObject({ name: 'Bia', mais: 1, maisValor: 30 })
    expect(s.ufs[0]).toMatchObject({ name: 'SC', ctes: 4, cobrado: 330 })
    expect(s.cities[0]!.name).toBe('Itajai/SC')
    expect(s.customers[0]).toMatchObject({ name: 'Cliente X', nota: 270 })
  })

  it('sem CT-es', () => {
    const s = summarize([], 1)
    expect(s.totals.porKg).toBeNull()
    expect(s.nota.pctMenos).toBeNull()
  })
})
