import { describe, expect, it } from 'vitest'
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
  it('reconhece o relatório e tira SKU, custo médio e lucro líquido', () => {
    expect(isErpTextReport(TXT)).toBe(true)
    expect(isErpTextReport('sku;custo\n1;2')).toBe(false)
    expect(erpTextReportRows(TXT)).toEqual([
      ['sku', 'custo', 'lucro'],
      ['009356', '607,36', '471,35'],
      ['011819', '96,37', '94,59'],
      ['009945', '4,00', '2,15'],
      ['025226', '420,74', ''],
    ])
  })
})
