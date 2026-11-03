import { describe, expect, it } from 'vitest'
import { normName, reconcile } from '../src/fretes/conciliacao'

// Esperado pela tabela de Cachoeirinha (Maravilha, 0,9 kg, NF R$ 45,93) x CT-e 1.591.853 da Expresso São Miguel.
const expected = {
  total: 74.42,
  components: [
    { code: 'FRETE_PESO', name: 'Frete peso', value: 54.68 },
    { code: 'FRETE_VALOR', name: 'Frete valor', value: 0.23 },
    { code: 'ADVALOREM', name: 'ADVALOREM', value: 0 },
    { code: 'GRIS', name: 'GRIS', value: 3.79 },
    { code: 'PEDAGIO', name: 'PEDÁGIO', value: 3.79 },
    { code: 'TAS', name: 'TAS', value: 3 },
    { code: 'T-CPF', name: 'T-CPF', value: 0, skipped: true },
  ],
  icms: { mode: 'SOMADO', rate: 12, value: 8.93 },
  weight: 0.9,
}
const cte = {
  total: 79.11,
  components: [
    { name: 'FRETE PESO', value: 58.81 },
    { name: 'FRETE VALOR', value: 0.23 },
    { name: 'PEDAGIO', value: 3.79 },
    { name: 'GRIS', value: 3.79 },
    { name: 'OUTROS', value: 9.49 },
    { name: 'TAS', value: 3 },
  ],
  icms: { rate: 12, value: 9.49 },
  weight: 0.9,
}

describe('fretes: conciliação do CT-e', () => {
  it('aponta a divergência do CT-e real no frete peso e no ICMS, reconhecendo "OUTROS" como ICMS', () => {
    const r = reconcile(expected, cte, { value: 1, percent: 2 })
    expect(r).toMatchObject({ status: 'DIVERGENTE', types: ['DIVERGENCIA_VALOR'], expectedTotal: 74.42, chargedTotal: 79.11, difference: 4.69, allowed: 1.49 })
    const by = Object.fromEntries(r.lines.map((l) => [l.name, [l.expected, l.charged, l.difference, l.status]]))
    expect(by['FRETE PESO']).toEqual([54.68, 58.81, 4.13, 'DIFERENTE'])
    expect(by['GRIS']).toEqual([3.79, 3.79, 0, 'OK'])
    expect(by['ICMS']).toEqual([8.93, 9.49, 0.56, 'DIFERENTE'])
    expect(r.lines.some((l) => l.name === 'OUTROS')).toBe(false)
  })

  it('dentro da tolerância concilia; taxa extra e duplicada são apontadas', () => {
    expect(reconcile(expected, cte, { value: 5, percent: 0 }).status).toBe('CONCILIADO')
    const extra = reconcile(expected, { ...cte, total: 79.11 + 40 + 3, components: [...cte.components, { name: 'TDE', value: 40 }, { name: 'TAS', value: 3 }] }, { value: 1, percent: 2 })
    expect(extra.types).toEqual(expect.arrayContaining(['TAXA_NAO_PREVISTA', 'TAXA_DUPLICADA', 'DIVERGENCIA_VALOR']))
    expect(extra.lines.find((l) => l.name === 'TDE')).toMatchObject({ status: 'NAO_PREVISTA', charged: 40 })
  })

  it('peso maior que o cotado e cobrança abaixo', () => {
    const r = reconcile(expected, { ...cte, weight: 30 }, { value: 10, percent: 0 })
    expect(r.types).toContain('DIVERGENCIA_PESO')
    expect(r.status).toBe('DIVERGENTE')
    const low = reconcile(expected, { ...cte, total: 50 }, { value: 1, percent: 0 })
    expect(low.types).toContain('COBRADO_A_MENOR')
    expect(low.status).toBe('CONCILIADO')
  })

  it('nomes de componente comparáveis', () => {
    expect(normName('Frete peso')).toBe(normName('FRETE_PESO'))
    expect(normName('PEDÁGIO FRAÇÃO 100 Kg')).toBe('PEDAGIO')
    expect(normName('T-CPF')).toBe(normName('TCPF'))
  })
})
