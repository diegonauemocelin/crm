import { describe, expect, it } from 'vitest'
import { priceForTableMargin, tableMarginPct } from '../src/marketplaces/precos/margem'
import { erpTextReportRows, isErpTextReport } from '../src/marketplaces/precos/relatorio-erp'

const TXT = `ANALISE DE PRECO E MARGEM - ITENS INTEGRADOS AO E-COMMERCE

FILIAL SKU         DESCRICAO                                    CUSTO MEDIO  PRECO VENDA     IMPOSTOS   VALOR LIQ.   LUCRO LIQ.  MARGEM %  STATUS
-----------------------------------------------------------------------------------------------------------------------------------------
1      009356      TURBINA MOTOR                                     607,36     1.340,00       261,30     1.340,00       471,35     35,17  OK
1      011819      HELICE 10 PAS 18"  IMP. 1 LINHA                    96,37       250,56        67,74       258,70        94,59     36,56  OK
1      009945      CALCO                                               4,00         8,00         1,85         8,00         2,15     26,87  OK
1      025226      ATUADOR MOTOR PASSO                               420,74     1.210,00                                                   REVISAR TRIBUTACAO
`

describe('relatório de preço e margem do ERP (texto)', () => {
  it('reconhece o relatório e tira SKU, custo médio, lucro líquido e valor líquido', () => {
    expect(isErpTextReport(TXT)).toBe(true)
    expect(isErpTextReport('sku;custo\n1;2')).toBe(false)
    expect(erpTextReportRows(TXT)).toEqual([
      ['sku', 'custo', 'lucro', 'liquido'],
      ['009356', '607,36', '471,35', '1.340,00'],
      ['011819', '96,37', '94,59', '258,70'],
      ['009945', '4,00', '2,15', '8,00'],
      ['025226', '420,74', '', ''],
    ])
  })
})

describe('mesma margem da tabela do ERP no Mercado Livre', () => {
  // Linha do relatório: custo 607,36, valor líquido 1.340,00, lucro 471,35, margem 35,17%.
  const pm = { fee: { pct: 16, fixed: 0 }, shipping: 20, taxPct: 19.5, extraPct: 0, cost: 607.36, fixedCost: 0 }
  it('a margem é o lucro ÷ valor líquido (a coluna MARGEM % do relatório)', () => {
    expect(tableMarginPct(471.35, 1340)).toBeCloseTo(35.17, 1)
    expect(tableMarginPct(94.59, 258.7)).toBe(36.56)
    expect(tableMarginPct(null, 1340)).toBeNull()
  })
  it('o preço do Mercado Livre mantém a margem % já com o imposto do preço maior', () => {
    const p = priceForTableMargin(35.17, 471.35, pm)!
    const profit = p * (1 - 0.16 - 0.195) - 20 - 607.36
    expect(profit / p).toBeCloseTo(0.3517, 3)
    expect(profit).toBeGreaterThan(471.35)
  })
  it('nunca deixa menos lucro em R$ que a tabela', () => {
    const p = priceForTableMargin(5, 100, pm)!
    expect(p * (1 - 0.16 - 0.195) - 20 - 607.36).toBeGreaterThanOrEqual(99.99)
  })
})
