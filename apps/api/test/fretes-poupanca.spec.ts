import { describe, expect, it } from 'vitest'
import { campaignOn, cleanWalletCampaigns, chargeOf, pctFor, periodEnd, surchargeBase, walletBalances, walletEntry } from '../src/fretes/poupanca'

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

  it('saldo da nota: cobrado na nota − (cotação + acréscimo)', () => {
    // Exemplo do usuário: cotação 298,53 + 20% = 358,24 a cobrar; nota 430,00: saldo 71,76 (o CT-e não entra).
    expect(walletEntry({ nota: 430, cte: 354.19, quote: 298.53, table: null }, 20)).toEqual({ source: 'COTACAO', base: 298.53, markup: 59.71, charge: 358.24, saldo: 71.76 })
    // Sem cotação: tabela; cobrou menos que tabela + 20%: saldo negativo.
    expect(walletEntry({ nota: 100, cte: 100, quote: null, table: 90 }, 20)).toMatchObject({ source: 'TABELA', charge: 108, saldo: -8 })
    // Sem cotação nem tabela (transportadora sem tabela cadastrada): fica de fora, mesmo com CT-e.
    expect(walletEntry({ nota: 130, cte: 100, quote: null, table: null }, 20)).toBeNull()
    // Sem cotação, tabela nem CT-e: ainda sem base.
    expect(walletEntry({ nota: 130, cte: null, quote: null, table: null }, 20)).toBeNull()
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

describe('% próprio de cada vendedor', () => {
  it('usa o % do vendedor (sem acento nem caixa) e, sem ele, o padrão da campanha', () => {
    const [c] = cleanWalletCampaigns([{ name: 'Nov', pct: 20, period: 'MENSAL', start: '2026-11-01', sellerPcts: [{ seller: 'João Silva', pct: 15 }, { seller: 'joao silva', pct: 30 }, { seller: '', pct: 5 }] }], () => 'id-123456')
    expect(c!.sellerPcts).toEqual([{ seller: 'João Silva', pct: 15 }])
    expect(pctFor(c!, 'JOAO  SILVA')).toBe(15)
    expect(pctFor(c!, 'Maria')).toBe(20)
    expect(pctFor(c!, null)).toBe(20)
    // cotação 100: João cobra 115; nota cobrou 120 → 5 de poupança
    expect(walletEntry({ nota: 120, cte: 90, quote: 100, table: null }, pctFor(c!, 'João Silva'))).toMatchObject({ charge: 115, saldo: 5 })
  })
})

describe('reajuste de tabela + % do vendedor', () => {
  it('base da poupança: frete + reajuste da transportadora escolhida; sem reajuste, a cotação', () => {
    const results = [
      { tableId: 't1', campaign: { mode: 'ACRESCIMO', label: 'acréscimo de 16% na tabela', customerPrice: 83.02 } },
      { tableId: 't2', campaign: { mode: 'DESCONTO', label: '10% de desconto', customerPrice: 50 } },
      { tableId: 't3', campaign: { label: 'acréscimo de 10% na tabela', customerPrice: 110 } },
    ]
    expect(surchargeBase(results, 't1')).toBe(83.02)
    expect(surchargeBase(results, 't2')).toBeNull()
    expect(surchargeBase(results, 't3')).toBe(110)
    expect(surchargeBase(results, null)).toBeNull()
    // frete 71,57 + reajuste = 83,02; vendedor 20% → 99,62; a nota cobrou 100 → 0,38 de poupança
    expect(chargeOf(83.02, 20)).toBe(99.62)
    expect(walletEntry({ nota: 100, cte: 70, quote: 83.02, table: null }, 20)).toMatchObject({ charge: 99.62, saldo: 0.38 })
  })
})
