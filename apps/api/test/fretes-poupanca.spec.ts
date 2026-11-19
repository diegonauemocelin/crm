import { describe, expect, it } from 'vitest'
import { campaignOn, cleanWalletCampaigns, periodEnd, walletBalances, walletEntry } from '../src/fretes/poupanca'

let n = 0
const id = () => `camp-00${++n}`

describe('poupança de frete dos vendedores', () => {
  it('fim do período', () => {
    expect(periodEnd('MENSAL', '2026-11-01')).toBe('2026-11-30')
    expect(periodEnd('TRIMESTRAL', '2026-01-01')).toBe('2026-03-31')
    expect(periodEnd('SEMESTRAL', '2026-07-01')).toBe('2026-12-31')
    expect(periodEnd('ANUAL', '2026-01-01')).toBe('2026-12-31')
  })

  it('limpa as campanhas', () => {
    const c = cleanWalletCampaigns(
      [
        { name: 'Vendedores 2026', pct: 20, period: 'ANUAL', start: '2026-01-01' },
        { name: 'Personalizada', pct: 15, period: 'PERSONALIZADO', start: '2026-11-10', end: '2026-12-20', active: false },
        { name: 'Sem fim', pct: 15, period: 'PERSONALIZADO', start: '2026-11-10' },
        { name: '', pct: 20, start: '2026-01-01' },
        { name: 'X', pct: -1, start: '2026-01-01' },
      ],
      id,
    )
    expect(c.map((x) => [x.name, x.end, x.active])).toEqual([
      ['Vendedores 2026', '2026-12-31', true],
      ['Personalizada', '2026-12-20', false],
    ])
    expect(campaignOn(c, '2026-11-19')?.name).toBe('Vendedores 2026')
    expect(campaignOn(c, '2027-01-02')).toBeNull()
  })

  it('saldo da nota: nota − CT-e − acréscimo sobre a cotação', () => {
    // Cotação 100, +20% = cobrar 120. Nota 120, CT-e 95: 120 − 95 − 20 = 5 para o vendedor.
    expect(walletEntry({ nota: 120, cte: 95, quote: 100, table: 98 }, 20)).toEqual({ source: 'COTACAO', base: 100, markup: 20, charge: 120, saldo: 5 })
    // Sem cotação: tabela; cobrou menos: saldo negativo.
    expect(walletEntry({ nota: 100, cte: 100, quote: null, table: 90 }, 20)).toMatchObject({ source: 'TABELA', markup: 18, saldo: -18 })
    expect(walletEntry({ nota: 130, cte: 100, quote: null, table: null }, 20)).toMatchObject({ source: 'CTE', base: 100, saldo: 10 })
  })

  it('saldo por vendedor com usos e notas sem CT-e', () => {
    const b = walletBalances(
      [
        { seller: 'Ana', nota: 120, cte: 95, markup: 20, saldo: 5 },
        { seller: 'Ana', nota: 100, cte: 100, markup: 18, saldo: -18 },
        { seller: 'Bia', nota: 200, cte: 150, markup: 30, saldo: 20 },
      ],
      [{ seller: 'Bia', value: -15 }],
      [{ seller: 'Ana', count: 2 }],
    )
    expect(b).toEqual([
      { seller: 'Bia', notas: 1, nota: 200, cte: 150, markup: 30, credito: 20, debito: 0, movimentos: -15, pendentes: 0, saldo: 5 },
      { seller: 'Ana', notas: 2, nota: 220, cte: 195, markup: 38, credito: 5, debito: 18, movimentos: 0, pendentes: 2, saldo: -13 },
    ])
  })
})
