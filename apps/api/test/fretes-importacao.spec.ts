import { describe, expect, it } from 'vitest'
import { checkMapping, parseCepRange, parseNumber, parseRows, suggestMapping, weightBand, cubageFactorOf, tableNotes } from '../src/fretes/importacao'

describe('fretes: leitura da planilha', () => {
  it('números no formato brasileiro', () => {
    expect(parseNumber('R$ 1.234,56')).toBe(1234.56)
    expect(parseNumber('0,30%')).toBe(0.3)
    expect(parseNumber('12.5')).toBe(12.5)
    expect(parseNumber('1.234.567')).toBe(1234567)
    expect(parseNumber(' - ')).toBeNull()
    expect(parseNumber('abc')).toBeNaN()
    expect(parseNumber(7)).toBe(7)
  })

  it('CEP com e sem zero e prefixo de 5 dígitos', () => {
    expect(parseCepRange('89874-000')).toEqual({ start: 89874000, end: 89874000 })
    expect(parseCepRange(1310100)).toEqual({ start: 1310100, end: 1310100 })
    expect(parseCepRange('89874')).toEqual({ start: 89874000, end: 89874999 })
    expect(parseCepRange('123456789')).toBe('invalido')
    expect(parseCepRange('')).toBeNull()
  })
})

describe('fretes: mapeamento', () => {
  it('reconhece colunas comuns e faixas de peso em colunas', () => {
    expect(weightBand('Até 10 kg')).toEqual({ min: null, max: 10 })
    expect(weightBand('10,01 a 20 KG')).toEqual({ min: 10.01, max: 20 })
    expect(weightBand('Frete')).toBeNull()
    const m = suggestMapping(['CEP Inicial', 'CEP Final', 'UF', 'Cidade', 'Prazo', 'Até 10 kg', 'Até 20 kg', 'Excedente (R$/kg)', 'Ad Valorem (%)', 'GRIS', 'GRIS Mínimo', 'Pedágio', 'Frete Mínimo'])
    expect(m).toEqual([
      { column: 0, field: 'cep_start' },
      { column: 1, field: 'cep_end' },
      { column: 2, field: 'uf' },
      { column: 3, field: 'city' },
      { column: 4, field: 'deadline' },
      { column: 5, field: 'var:freight', weightMin: 0, weightMax: 10 },
      { column: 6, field: 'var:freight', weightMin: 10, weightMax: 20 },
      { column: 7, field: 'var:over_weight' },
      { column: 8, field: 'var:advalorem' },
      { column: 9, field: 'var:gris' },
      { column: 10, field: 'var:gris_min' },
      { column: 11, field: 'var:toll' },
      { column: 12, field: 'var:min_freight' },
    ])
    expect(checkMapping(m, 13)).toEqual([])
    expect(checkMapping([{ column: 0, field: 'uf' }], 1)).toContain('Mapeie ao menos uma coluna de valor (frete, taxas).')
    expect(checkMapping([{ column: 0, field: 'cep_start' }, { column: 1, field: 'var:freight' }], 2)).toContain('Mapeie juntos o CEP inicial e o CEP final.')
  })
})

describe('fretes: validação das linhas', () => {
  const mapping = [
    { column: 0, field: 'cep_start' },
    { column: 1, field: 'cep_end' },
    { column: 2, field: 'uf' },
    { column: 3, field: 'deadline' },
    { column: 4, field: 'var:freight', weightMin: 0, weightMax: 10 },
    { column: 5, field: 'var:freight', weightMin: 10, weightMax: 20 },
    { column: 6, field: 'var:gris' },
  ]

  it('cada faixa de peso vira uma regra; erros e duplicadas são rejeitados com a linha da planilha', () => {
    const rows = [
      ['89874-000', '89874-999', 'SC', 2, '20,00', '30,00', '0,1%'],
      ['', '', '', '', '', '', ''],
      ['85800-000', '85819-999', 'PR', 3, '25', 'abc', '0,1'],
      ['89874000', '89874999', 'SC', 2, '21', '31', ''],
      ['99999-999', '90000-000', 'RS', 4, '1', '2', ''],
      ['88000-000', '88099-999', 'PR', 1, '5', '', '150'],
    ]
    const r = parseRows(rows, mapping, 2)
    expect(r.readLines).toBe(5)
    expect(r.rules).toHaveLength(2)
    expect(r.rules[0]).toMatchObject({ line: 2, cepStart: 89874000, cepEnd: 89874999, uf: 'SC', deadlineDays: 2, weightMin: 0, weightMax: 10, values: { freight: 20, gris: 0.1 } })
    expect(r.rules[1]).toMatchObject({ weightMin: 10, weightMax: 20, values: { freight: 30, gris: 0.1 } })
    const msgs = r.issues.map((i) => `${i.line}:${i.level}:${i.message}`)
    expect(msgs).toContain('4:erro:Faixa 10–20 kg: "abc" não é valor válido.')
    expect(msgs.some((m) => m.startsWith('5:erro:Duplicada') && m.includes('linha 2'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('6:erro:CEP inicial'))).toBe(true)
    expect(msgs).toContain('7:erro:GRIS de 150% passa de 100%.')
    expect(msgs.some((m) => m.startsWith('7:alerta:CEP 88000-000 é de SC'))).toBe(true)
    expect(r.errorLines).toBe(4)
    expect(r.importedLines).toBe(1)
  })

  it('formato com peso inicial e final em colunas e destino por cidade', () => {
    const r = parseRows(
      [
        ['Cascavel', 'PR', 0, 30, 45.9, ''],
        ['Cascavel', 'PR', 30.01, '', 2.1, 'sim'],
      ],
      [
        { column: 0, field: 'city' },
        { column: 1, field: 'uf' },
        { column: 2, field: 'weight_min' },
        { column: 3, field: 'weight_max' },
        { column: 4, field: 'var:freight' },
        { column: 5, field: 'restricted' },
      ],
      5,
    )
    expect(r.issues).toEqual([])
    expect(r.rules).toEqual([
      expect.objectContaining({ city: 'Cascavel', cityKey: 'cascavel', uf: 'PR', weightMin: 0, weightMax: 30, restricted: false, values: { freight: 45.9 } }),
      expect.objectContaining({ weightMin: 30.01, weightMax: null, restricted: true }),
    ])
  })
})

describe('fretes: layouts reais das transportadoras', () => {
  it('São Miguel: TAXA/QUILO/% NF, GRIS e GRIS %, pedágio por fração, prazo máximo e coluna de texto ignorada', () => {
    const headers = ['UNIDADE ORIGEM', 'CIDADE', 'UF', 'REGIÃO', 'CEP PRINCIPAL', 'CEP INICIAL', 'CEP FINAL', 'PREVISÃO DE ENTREGA', 'MINIMO', 'MÁXIMO', 'TAXA', 'QUILO', '% NF', 'TAS', 'GRIS', 'GRIS %', 'PEDÁGIO FRAÇÃO 100 Kg', 'MERC. VOLUMOSA -  kg³', 'ICMS']
    const data = [['ITAJAI', 'ABATIA', 'PR', 'PR5', '86460-000', '86460-000', '86464-999', ' De 2 a 6 dias', 2, 6, 41.11, 0.941, 0.5, 3, 3.79, 0.17, 3.79, 265, 'CONFORME LEGISLACAO']]
    const m = suggestMapping(headers, data)
    const by = Object.fromEntries(m.map((x) => [headers[x.column], x.field]))
    expect(by).toEqual({
      CIDADE: 'city', UF: 'uf', 'CEP INICIAL': 'cep_start', 'CEP FINAL': 'cep_end', 'MÁXIMO': 'deadline', TAXA: 'var:freight', QUILO: 'var:freight_kg',
      '% NF': 'var:freight_value', TAS: 'var:tas', GRIS: 'var:gris_min', 'GRIS %': 'var:gris', 'PEDÁGIO FRAÇÃO 100 Kg': 'var:toll',
    })
    const r = parseRows(data, m, 2)
    expect(r.rules[0]).toMatchObject({ cepStart: 86460000, cepEnd: 86464999, deadlineDays: 6, values: { freight: 41.11, freight_kg: 0.941, freight_value: 0.5, gris: 0.17, gris_min: 3.79, toll: 3.79, tas: 3 } })
  })

  it('Viopex: destino por UF, % guardado como fração, excedente em R$/ton, faixa "–" vale a de cima e observações', () => {
    const headers = ['Item', 'Código', 'Origem', 'Destino', 'Mercadoria', 'Ida/Volta', 'TRT mínimo (R$)', 'Adic. valor mercadoria (%)', 'Até 5 kg (R$)', 'Até 10 kg (R$)', 'Até 20 kg (R$)', 'Até 30 kg (R$)', 'Excedente (R$/ton)']
    const data = [
      [7, 'CO184349', 'SC', 'MT', 'TODAS', 'IDA/VOLTA', 80, 0.008014, 71.28, 83.16, '–', 95.04, 1097.24],
      [14, 'CO184353', 'SC', 'SC', 'TODAS', 'IDA/VOLTA', 80, 0.005724, 33.26, 35.64, 38.02, 40.39, 1088.16],
      ['“–” = faixa não existe na tabela daquele destino (vale a próxima faixa acima).', null, null, null, null, null, null, null, null, null, null, null, null],
    ]
    const m = suggestMapping(headers, data)
    expect(m.find((x) => headers[x.column] === 'Destino')?.field).toBe('uf')
    expect(m.some((x) => headers[x.column] === 'Origem')).toBe(false)
    expect(m.find((x) => headers[x.column] === 'Adic. valor mercadoria (%)')).toMatchObject({ field: 'var:freight_value', scale: 100 })
    expect(m.find((x) => headers[x.column] === 'Excedente (R$/ton)')).toMatchObject({ field: 'var:over_weight', scale: 0.001 })
    const r = parseRows(data, m, 2)
    expect(r.issues).toEqual([])
    expect(r.rules.filter((x) => x.uf === 'MT').map((x) => [x.weightMin, x.weightMax, x.values.freight])).toEqual([[0, 5, 71.28], [5, 10, 83.16], [10, 30, 95.04]])
    expect(r.rules.find((x) => x.uf === 'SC')!.values).toMatchObject({ freight_value: 0.5724, over_weight: 1.08816 })
    expect(tableNotes([{ rows: [['ICMS', 'Já incluso no valor do frete calculado pela tabela'], ['Cubagem', '300,00 kg/m³']] }])).toEqual({ icmsIncluded: true, cubage: 300 })
  })

  it('São Miguel: o fator de cubagem (MERC. VOLUMOSA kg³) vira parâmetro da versão', () => {
    const headers = ['CIDADE', 'TAXA', 'MERC. VOLUMOSA -  kg³', 'ICMS']
    expect(cubageFactorOf(headers, [['A', 1, 265, 'X'], ['B', 2, 265, 'X'], ['C', 3, '265', 'X']])).toBe(265)
    expect(cubageFactorOf(headers, [['A', 1, 265, 'X'], ['B', 2, 300, 'X']])).toBeNull()
    expect(cubageFactorOf(['CIDADE', 'TAXA'], [['A', 1]])).toBeNull()
  })
})

