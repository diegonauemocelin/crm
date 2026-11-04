import { describe, expect, it } from 'vitest'
import { parseRows, type RegionCity } from '../src/fretes/importacao'
import { parseIbgeSheet, parseRegionsSheet, ufByIbge } from '../src/fretes/regioes'

describe('fretes: regiões da transportadora', () => {
  it('lê a planilha Regiões (cidades pelo IBGE, prazo e dias de entrega)', () => {
    const ibge = parseIbgeSheet([
      ['Nome_UF', 'Nome_Municipio', 'Código Município Completo'],
      ['Paraná', 'Abatiá', '4100103'],
      ['Paraná', 'Almirante Tamandaré', '4100400'],
    ])
    const r = parseRegionsSheet(
      [
        ['Código', 'Descrição', 'Cidades', 'Dias Prazo', 'Tipo (C)orridos / (U)teis', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
        ['PR5', 'ABATIA', '4100103', 6, 'U', 'X', null, null, null, null],
        ['PR6', 'CURITIBA E REGIAO', '4100400,4106902', 2, 'C', 'X', 'X', 'X', 'X', 'X'],
        ['PR7', 'SEM CIDADE', '', 3, 'U', 'X', null, null, null, null],
      ],
      ibge,
    )!
    expect(ufByIbge('4100103')).toBe('PR')
    expect(r.invalid).toBe(2)
    expect(r.regions).toEqual([
      { code: 'PR5', ibge: '4100103', city: 'Abatiá', cityKey: 'abatia', uf: 'PR', deadlineDays: 6, businessDays: true, weekdays: ['SEG'] },
      { code: 'PR6', ibge: '4100400', city: 'Almirante Tamandaré', cityKey: 'almirante tamandare', uf: 'PR', deadlineDays: 2, businessDays: false, weekdays: ['SEG', 'TER', 'QUA', 'QUI', 'SEX'] },
    ])
  })

  it('a coluna Região da tabela de preço vira uma regra por cidade, com o prazo da região', () => {
    const regions = new Map<string, RegionCity[]>([
      ['PR5', [{ city: 'Abatiá', cityKey: 'abatia', uf: 'PR', deadlineDays: 6 }, { city: 'Andirá', cityKey: 'andira', uf: 'PR', deadlineDays: 4 }]],
    ])
    const mapping = [
      { column: 0, field: 'region' },
      { column: 1, field: 'var:freight' },
    ]
    const ok = parseRows([['PR5', 120], ['PR9', 80]], mapping, 2, regions)
    expect(ok.rules.map((x) => [x.city, x.uf, x.deadlineDays, x.values.freight])).toEqual([
      ['Abatiá', 'PR', 6, 120],
      ['Andirá', 'PR', 4, 120],
    ])
    expect(ok.issues.map((i) => i.message)).toEqual(['Região PR9 não está nas regiões da transportadora.'])
    expect(parseRows([['PR5', 120]], mapping, 2).issues[0]!.message).toMatch(/não tem regiões importadas/)
  })
})
