import { describe, expect, it } from 'vitest'
import { auditHints, hasDifference, suggestedCause } from '../src/fretes/conferencia'

const base = { freightMode: '0', nfeFreight: 100, cteTotal: 100, tableExpected: 100, quoted: null }

describe('conferência de frete', () => {
  it('sem diferença dentro da folga', () => {
    const h = auditHints({ ...base, cteTotal: 100.5 }, 1)
    expect(h).toEqual([])
    expect(hasDifference(h)).toBe(false)
  })

  it('nota abaixo do CT-e e da tabela: vendedor cobrou menos', () => {
    const v = { ...base, nfeFreight: 80, cteTotal: 120, tableExpected: 110 }
    const h = auditHints(v, 1)
    expect(h.map((x) => x.kind)).toEqual(['NOTA_MENOR_CTE', 'NOTA_MENOR_TABELA', 'CTE_ACIMA_TABELA'])
    expect(h[0]!.diff).toBe(-40)
    expect(suggestedCause(v, h)).toBe('TRANSPORTADORA_ACIMA')
    const v2 = { ...v, cteTotal: 110 }
    expect(suggestedCause(v2, auditHints(v2, 1))).toBe('VENDEDOR_COBROU_MENOS')
  })

  it('CIF sem frete na nota sugere frete não destacado', () => {
    const v = { ...base, nfeFreight: 0 }
    expect(suggestedCause(v, auditHints(v, 1))).toBe('FRETE_NAO_DESTACADO')
  })

  it('FOB não compara a nota; CT-e acima da tabela continua valendo', () => {
    const v = { ...base, freightMode: '1', nfeFreight: 0, cteTotal: 130 }
    expect(auditHints(v, 1).map((x) => x.kind)).toEqual(['CTE_ACIMA_TABELA'])
  })

  it('falta de dado vira aviso, não diferença', () => {
    const h = auditHints({ freightMode: null, nfeFreight: null, cteTotal: null, tableExpected: null, quoted: 50 }, 1)
    expect(h.map((x) => x.kind)).toEqual(['SEM_NOTA', 'SEM_CTE'])
    expect(hasDifference(h)).toBe(false)
    expect(auditHints({ ...base, tableExpected: null }, 1).map((x) => x.kind)).toEqual(['SEM_TABELA'])
  })
})
