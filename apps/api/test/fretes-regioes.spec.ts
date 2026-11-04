import { describe, expect, it } from 'vitest'
import { parseRows, type RegionCity } from '../src/fretes/importacao'
import { privateIp } from '../src/fretes/download'
import { htmlTableRows, ibgeByCity, parseIbgeSheet, parseRegionsSheet, ufByIbge } from '../src/fretes/regioes'

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

  it('lê a lista de cidades atendidas do site (tabela HTML com a base responsável) e completa o IBGE', () => {
    const html = `<table><tr><td>Viopex – Cidades atendidas</td></tr><tr><td>ID Cidade</td><td>Cidade</td><td>Estado</td><td>Base Responsável</td><td>Endereço</td><td>Responsável</td><td>Telefone</td><td>Coleta</td><td>Observações</td></tr>
      <tr><td>928188</td><td>ALAGOINHAS</td><td>BA</td><td>SALVADOR</td><td>RUA DA LIBERIA, 130</td><td>IVANA</td><td>(71) 40098-143</td><td>Sim</td><td>SOMENTE COM FRETE PAGO PELO REMETENTE.</td></tr>
      <tr><td>924635</td><td>ABELARDO LUZ </td><td>SC</td><td>XANXERÊ</td><td></td><td></td><td></td><td>Não</td><td>RETIRA NA CIDADE DE XANXERÊ.</td></tr>
      <tr><td>507260</td><td>Paraíso - TO</td><td>TO</td><td>Paraíso</td><td>Av. Alfredo Nasser (Rodoviária)</td><td>Valdines</td><td>(63) 99255-3875</td><td>Sim</td><td>Atendimento em horário comercial</td></tr></table>`
    const r = parseRegionsSheet(htmlTableRows(html))!
    expect(r.invalid).toBe(0)
    expect(r.regions.map((x) => [x.code, x.city, x.uf, x.ibge, x.pickup])).toEqual([
      ['SALVADOR', 'ALAGOINHAS', 'BA', '2900702', true],
      ['XANXERÊ', 'ABELARDO LUZ', 'SC', '4200101', false],
      ['PARAÍSO', 'Paraíso', 'TO', null, true],
    ])
    expect(r.regions[0]!.contact).toBe('RUA DA LIBERIA, 130 · IVANA · (71) 40098-143')
    expect(r.regions[1]!.note).toBe('RETIRA NA CIDADE DE XANXERÊ.')
    expect(ibgeByCity('BA', "DIAS D AVILA")).toBe(ibgeByCity('BA', "Dias d'Ávila"))
  })

  it('não busca lista de cidades em endereço de rede interna', () => {
    expect(['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.20.0.2', '169.254.1.1', '::1', '::ffff:10.1.1.1', 'fd00::1'].every(privateIp)).toBe(true)
    expect(['201.76.41.87', '8.8.8.8', '2804:14c::1'].some(privateIp)).toBe(false)
  })
})
