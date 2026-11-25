import { describe, expect, it } from 'vitest'
import { type DiagCte, diagnose, diagnoseCarrier } from '../src/fretes/diagnostico'

let seq = 0
const cte = (p: Partial<DiagCte> & { lines?: NonNullable<DiagCte['recDetail']>['lines']; notes?: string[] }): DiagCte => {
  seq++
  const { lines, notes, ...rest } = p
  return {
    id: `id${seq}`,
    number: String(seq),
    carrierId: 'c1',
    carrierName: 'Transp',
    recStatus: 'DIVERGENTE',
    recTypes: [],
    total: 100,
    expectedTotal: 100,
    difference: 0,
    icms: null,
    cityFim: 'Chapecó',
    ufFim: 'SC',
    recDetail: { allowed: 1, lines: lines ?? [], notes: notes ?? [] },
    ...rest,
  }
}

describe('diagnóstico das tabelas pelos CT-es', () => {
  it('ICMS por dentro: a diferença é o ICMS do CT-e', () => {
    const list = [1, 2, 3].map(() => cte({ total: 67.11, expectedTotal: 59.06, difference: 8.05, icms: { rate: 12, value: 8.05 } }))
    const f = diagnoseCarrier(list)
    expect(f[0]).toMatchObject({ code: 'ICMS_POR_DENTRO', action: 'AJUSTAR', count: 3 })
  })

  it('ICMS a mais: o esperado passa o cobrado no valor do ICMS', () => {
    const list = [1, 2, 3].map(() => cte({ total: 59.06, expectedTotal: 66.15, difference: -7.09, icms: { rate: 12, value: 7.09 } }))
    expect(diagnoseCarrier(list).map((x) => x.code)).toContain('ICMS_A_MAIS')
  })

  it('taxa com outro nome vira ajuste de "Nomes no CT-e"; taxa sem par vira pedido', () => {
    const renamed = [1, 2, 3].map(() => cte({ lines: [{ name: 'TAXA EMEX', expected: null, charged: 12, difference: 12, status: 'NAO_PREVISTA' }, { name: 'Emergência', expected: 12, charged: null, difference: -12, status: 'NAO_COBRADA' }] }))
    const extra = [1, 2, 3].map(() => cte({ lines: [{ name: 'TDE', expected: null, charged: 30, difference: 30, status: 'NAO_PREVISTA' }] }))
    const f = diagnoseCarrier([...renamed, ...extra])
    expect(f.find((x) => x.code.startsWith('NOME_'))).toMatchObject({ action: 'AJUSTAR' })
    expect(f.find((x) => x.code.startsWith('TAXA_'))).toMatchObject({ action: 'PEDIR', count: 3 })
    // O componente renomeado não aparece também como "não cobrado".
    expect(f.some((x) => x.code.startsWith('NAO_COBRA_'))).toBe(false)
  })

  it('componente cobrado sempre acima: possível reajuste', () => {
    const list = [100, 110, 120].map((v) => cte({ lines: [{ name: 'Frete peso', expected: v, charged: v * 1.08, difference: v * 0.08, status: 'DIFERENTE' }] }))
    const f = diagnoseCarrier(list)
    expect(f[0]).toMatchObject({ action: 'PEDIR' })
    expect(f[0]!.title).toContain('8% acima')
  })

  it('alíquota diferente repetida e destinos sem regra', () => {
    const rate = [1, 2, 3].map(() => cte({ ufFim: 'RS', notes: ['Alíquota de ICMS diferente: esperada 7%, cobrada 12%.'] }))
    const noRef = [1, 2].map(() => cte({ recStatus: 'SEM_REFERENCIA', expectedTotal: null, difference: null, cityFim: 'Erechim', ufFim: 'RS', recDetail: { reason: 'Nenhuma tabela...', tables: [{ table: 'T', reason: 'A tabela não tem regra para este destino. Destino: Erechim/RS, CEP 99700-000.' }] } }))
    const f = diagnoseCarrier([...rate, ...noRef])
    expect(f.find((x) => x.code === 'ALIQUOTA_RS')?.title).toContain('7%')
    expect(f.find((x) => x.code === 'SEM_COBERTURA')).toMatchObject({ action: 'PEDIR', count: 2 })
    expect(f.find((x) => x.code === 'SEM_COBERTURA')!.detail).toContain('Erechim/RS (2)')
  })

  it('poucos casos não viram achado; agrupa por transportadora', () => {
    const ok = cte({ recStatus: 'CONCILIADO', carrierId: 'c2', carrierName: 'Outra' })
    const one = cte({ total: 67.11, expectedTotal: 59.06, difference: 8.05, icms: { rate: 12, value: 8.05 } })
    const r = diagnose([ok, one])
    expect(r).toHaveLength(2)
    expect(r.every((c) => c.findings.length === 0)).toBe(true)
    expect(r.find((c) => c.carrierId === 'c1')?.acima).toBe(8.05)
  })
})
