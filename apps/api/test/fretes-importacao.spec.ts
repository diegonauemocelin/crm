import { describe, expect, it } from 'vitest'
import { checkMapping, parseCepRange, parseNumber, parseRows, suggestMapping, weightBand } from '../src/fretes/importacao'

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
