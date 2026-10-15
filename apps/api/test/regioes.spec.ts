import { describe, expect, it } from 'vitest'
import { leadRegion, regionStates } from '../src/atendimento/br'
import { cleanSteps } from '../src/automacoes/fluxo'

describe('Regiões do lead', () => {
  it('pelo estado no Brasil; país fora do Brasil é Internacional; sem estado fica sem região', () => {
    expect(leadRegion('BR', 'SC')).toBe('SUL')
    expect(leadRegion('BR', 'sp')).toBe('SUDESTE')
    expect(leadRegion('BR', 'DF')).toBe('CENTRO_OESTE')
    expect(leadRegion('BR', 'BA')).toBe('NORDESTE')
    expect(leadRegion('BR', 'AM')).toBe('NORTE')
    expect(leadRegion('PY', null)).toBe('INTERNACIONAL')
    expect(leadRegion('ar', 'SC')).toBe('INTERNACIONAL')
    expect(leadRegion('BR', null)).toBeNull()
    expect(leadRegion('BR', null, '+595981123456')).toBe('INTERNACIONAL')
    expect(leadRegion('BR', 'SC', '+5549999990000')).toBe('SUL')
    expect(leadRegion(null, 'XX')).toBeNull()
  })

  it('estados de cada região', () => {
    expect(regionStates('SUL').sort()).toEqual(['PR', 'RS', 'SC'])
    expect(regionStates('SUDESTE').sort()).toEqual(['ES', 'MG', 'RJ', 'SP'])
    expect(regionStates('CENTRO_OESTE').sort()).toEqual(['DF', 'GO', 'MS', 'MT'])
    expect(regionStates('NORTE')).toHaveLength(7)
    expect(regionStates('NORDESTE')).toHaveLength(9)
  })
})

describe('Fluxo: condição "está na região"', () => {
  it('aceita regiões válidas, sem repetir, e exige pelo menos uma', () => {
    const ok = cleanSteps([{ id: 'c', type: 'condicao', rules: [{ type: 'regiao', regions: ['SUL', 'SUL', 'INTERNACIONAL', 'MARTE'] }], yes: [], no: [] }])
    expect(ok).toMatchObject({ steps: [{ rules: [{ type: 'regiao', regions: ['SUL', 'INTERNACIONAL'] }] }] })
    expect(cleanSteps([{ id: 'c', type: 'condicao', rules: [{ type: 'regiao', regions: [] }], yes: [], no: [] }])).toMatchObject({ error: expect.stringMatching(/região/) })
  })
})
