import { describe, expect, it } from 'vitest'
import { fullPermissions } from '../src/common/permissions'
import {
  aceita,
  chavesDoPeriodo,
  chaveTempo,
  consultaSql,
  csv,
  DIM_IDS,
  escopoDe,
  escopoFonte,
  FONTE_BY_ID,
  janelaComparacao,
  juntar,
  lerFiltros,
  lerLista,
  limites,
  MEDIDA_BY_ID,
  MEDIDAS,
  nivelAtual,
  ordenar,
  PAGINAS,
  paginasPermitidas,
  type Perms,
  podeFonte,
  proximoNivel,
  registrosSql,
  rotulo,
  somarMeses,
  VAZIO,
  validarPeriodo,
  variacao,
  whereSql,
} from '../src/analises/modelo'
import { agregarWhatsapp } from '../src/analises/whatsapp'
import { MEDIDAS_USADAS as MEDIDAS_TELA, PAGINAS_UI } from '../../web/src/lib/analises-paginas'
import {
  comFiltro,
  datasDoPeriodo,
  descer,
  filtrosDaUrl,
  filtrosParaApi,
  formatar,
  nivelDoDrill,
  periodoDaUrl,
  podeDescer,
  subir,
  textoVariacao,
} from '../../web/src/lib/analises-modelo'

const ATEND = FONTE_BY_ID.get('atendimentos')!.sql!
const LEADS = FONTE_BY_ID.get('leads')!.sql!
const TENANT = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'
const UNIT = '33333333-3333-3333-3333-333333333333'

const perfil = (mods: Record<string, { view?: boolean; export?: boolean; scope?: 'OWN' | 'UNIT' | 'ALL' }>, isSystem = false): Perms => ({ isSystem, permissions: mods })

describe('análises: período e comparação', () => {
  it('valida o período', () => {
    expect(validarPeriodo('2026-01-01', '2026-01-31')).toEqual({ de: '2026-01-01', ate: '2026-01-31' })
    expect(validarPeriodo('2026-02-30', '2026-03-01')).toHaveProperty('erro')
    expect(validarPeriodo('2026-03-02', '2026-03-01')).toHaveProperty('erro')
    expect(validarPeriodo('2020-01-01', '2026-01-01')).toHaveProperty('erro')
    expect(validarPeriodo("2026-01-01' OR 1=1", '2026-01-02')).toHaveProperty('erro')
  })

  it('limites no horário de Brasília (fim exclusivo)', () => {
    const { inicio, fim } = limites('2026-03-01', '2026-03-31')
    expect(inicio.toISOString()).toBe('2026-03-01T03:00:00.000Z')
    expect(fim.toISOString()).toBe('2026-04-01T03:00:00.000Z')
  })

  it('janelas de comparação', () => {
    expect(janelaComparacao('2026-03-01', '2026-03-31', 'anterior')).toEqual({ de: '2026-01-29', ate: '2026-02-28' })
    expect(janelaComparacao('2026-03-10', '2026-03-16', 'anterior')).toEqual({ de: '2026-03-03', ate: '2026-03-09' })
    expect(janelaComparacao('2026-03-01', '2026-03-31', 'mes_anterior')).toEqual({ de: '2026-02-01', ate: '2026-02-28' })
    expect(janelaComparacao('2026-02-01', '2026-02-28', 'mes_anterior')).toEqual({ de: '2026-01-01', ate: '2026-01-31' })
    expect(janelaComparacao('2028-02-01', '2028-02-29', 'ano_anterior')).toEqual({ de: '2027-02-01', ate: '2027-02-28' })
    expect(janelaComparacao('2026-01-15', '2026-01-20', 'mes_anterior')).toEqual({ de: '2025-12-15', ate: '2025-12-20' })
    expect(somarMeses('2026-05-31', -1)).toBe('2026-04-30')
  })

  it('variação: % e diferença', () => {
    expect(variacao(120, 100)).toEqual({ variacao: 20, diferenca: 20 })
    expect(variacao(5, 0)).toEqual({ variacao: null, diferenca: 5 })
    expect(variacao(null, 3)).toEqual({ variacao: null, diferenca: null })
  })
})

describe('análises: dimensões, hierarquias e nomes', () => {
  it('chaves de tempo iguais às do SQL', () => {
    expect(chaveTempo('ano', '2026-08-15')).toBe('2026')
    expect(chaveTempo('trimestre', '2026-08-15')).toBe('2026-T3')
    expect(chaveTempo('mes', '2026-08-15')).toBe('2026-08')
    expect(chaveTempo('dia', '2026-08-15')).toBe('2026-08-15')
    expect(ATEND.dims.trimestre).toContain(`'YYYY-"T"Q'`)
  })

  it('nomes das chaves', () => {
    expect(rotulo('mes', '2026-03')).toBe('mar/2026')
    expect(rotulo('trimestre', '2026-T2')).toBe('2º tri/2026')
    expect(rotulo('situacao', 'SIM')).toBe('Vendeu')
    expect(rotulo('filial', VAZIO)).toBe('Sem filial')
    expect(rotulo('vendedor', 'x', new Map([['x', 'Ana']]))).toBe('Ana')
  })

  it('hierarquias descem um nível por vez', () => {
    expect(proximoNivel('calendario', 'ano')).toBe('trimestre')
    expect(proximoNivel('calendario', 'dia')).toBeNull()
    expect(proximoNivel('origem', 'canal')).toBe('origem')
    expect(nivelAtual('comercial', ['filial'])).toBe('vendedor')
    expect(nivelAtual('calendario', [])).toBe('ano')
  })

  it('chaves do período respeitam o drill-down', () => {
    expect(chavesDoPeriodo('mes', '2026-01-15', '2026-04-02')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(chavesDoPeriodo('mes', '2025-11-01', '2026-02-10', { ano: ['2026'] })).toEqual(['2026-01', '2026-02'])
    expect(chavesDoPeriodo('dia', '2026-01-30', '2026-02-02')).toHaveLength(4)
    expect(chavesDoPeriodo('filial', '2026-01-01', '2026-01-02')).toEqual([])
  })

  it('cada fonte diz as dimensões que aceita', () => {
    expect(aceita(FONTE_BY_ID.get('atendimentos')!, 'motivo')).toBe(true)
    expect(aceita(FONTE_BY_ID.get('leads')!, 'motivo')).toBe(false)
    expect(aceita(FONTE_BY_ID.get('whatsapp')!, 'mes')).toBe(true)
    expect(aceita(FONTE_BY_ID.get('whatsapp')!, 'uf')).toBe(false)
  })
})

describe('análises: pedido da tela', () => {
  it('filtros: só dimensões conhecidas e ids válidos', () => {
    expect(lerFiltros('{"uf":["PR","SC","PR"],"filial":["__vazio"]}')).toEqual({ filtros: { uf: ['PR', 'SC'], filial: ['__vazio'] } })
    expect(lerFiltros('{"tabela":["x"]}')).toHaveProperty('erro')
    expect(lerFiltros('{"filial":["1; DROP TABLE leads"]}')).toHaveProperty('erro')
    expect(lerFiltros('nao é json')).toHaveProperty('erro')
    expect(lerFiltros(undefined)).toEqual({ filtros: {} })
    expect(lerFiltros(JSON.stringify({ uf: Array.from({ length: 31 }, (_, i) => `U${i}`) }))).toHaveProperty('erro')
  })

  it('listas de medidas e dimensões fechadas', () => {
    expect(lerLista('vendas,receita,vendas', new Set(MEDIDA_BY_ID.keys()), 5)).toEqual({ itens: ['vendas', 'receita'] })
    expect(lerLista('vendas,"x"', new Set(MEDIDA_BY_ID.keys()), 5)).toHaveProperty('erro')
    expect(lerLista('mes,filial,uf,cidade', new Set(DIM_IDS), 3)).toHaveProperty('erro')
  })
})

describe('análises: SQL seguro e com o escopo do CRM', () => {
  const base = { tenantId: TENANT, inicio: new Date('2026-03-01T03:00:00Z'), fim: new Date('2026-04-01T03:00:00Z') }

  it('valores do usuário vão como parâmetro, nunca no texto', () => {
    const w = whereSql(ATEND, { ...base, escopo: { tipo: 'ALL' }, filtros: { cidade: ["Maravilha'; DROP TABLE leads; --"], filial: [VAZIO] } })
    const q = consultaSql(ATEND, [MEDIDA_BY_ID.get('vendas')!, MEDIDA_BY_ID.get('receita')!], ['filial', 'vendedor'], w, 101)
    expect(q.sql).not.toContain('DROP TABLE')
    expect(q.values).toContainEqual(["Maravilha'; DROP TABLE leads; --"])
    expect(q.values).toContain(TENANT)
    expect(q.values).toContain(101)
    expect(q.sql).toContain(`r.kind = 'PRE_VENDAS'`)
    expect(q.sql).toContain('IS NULL')
    expect(q.sql).toContain('GROUP BY 1, 2')
    expect(q.sql).toContain('ORDER BY 3 DESC')
  })

  it('escopo: próprios = vendedor ligado ao login; unidade = unidade do usuário; sem unidade não vê nada', () => {
    const own = whereSql(ATEND, { ...base, escopo: escopoDe('OWN', { id: USER, unitId: UNIT }), filtros: {} })
    expect(own.sql).toContain('r."sellerId" IN (SELECT sx.id FROM sellers sx')
    expect(own.values).toContain(USER)
    const unit = whereSql(LEADS, { ...base, escopo: escopoDe('UNIT', { id: USER, unitId: UNIT }), filtros: {} })
    expect(unit.sql).toContain('l."unitId" = ')
    expect(unit.values).toContain(UNIT)
    const semUnidade = whereSql(LEADS, { ...base, escopo: escopoDe('UNIT', { id: USER, unitId: null }), filtros: {} })
    expect(semUnidade.sql).toContain('FALSE')
    expect(whereSql(ATEND, { ...base, escopo: { tipo: 'ALL' }, filtros: {} }).sql).not.toContain('sellers sx')
  })

  it('tempo vem em ordem de data; registros com a condição da medida', () => {
    const w = whereSql(ATEND, { ...base, escopo: { tipo: 'ALL' }, filtros: {}, condicao: MEDIDA_BY_ID.get('vendas')!.condicao })
    expect(consultaSql(ATEND, [MEDIDA_BY_ID.get('atendimentos')!], ['mes'], w, 10).sql).toContain('ORDER BY 1 ASC')
    const r = registrosSql(ATEND, w, 50, 100)
    expect(r.sql).toContain(`r."saleStatus" = 'SIM'`)
    expect(r.values.slice(-2)).toEqual([50, 100])
  })

  it('toda medida de fonte SQL tem agregado e id seguro', () => {
    for (const m of MEDIDAS) {
      expect(m.id).toMatch(/^[a-z0-9_]+$/)
      if (FONTE_BY_ID.get(m.fonte)!.sql) expect(m.agregado, m.id).toBeTruthy()
    }
  })

  it('filtro em dimensão que a fonte não tem é recusado', () => {
    expect(() => whereSql(LEADS, { ...base, escopo: { tipo: 'ALL' }, filtros: { motivo: [VAZIO] } })).toThrow()
  })
})

describe('análises: permissões', () => {
  it('cada fonte segue o módulo do CRM', () => {
    const vendedor = perfil({ pre_vendas: { view: true, scope: 'OWN' } })
    expect(podeFonte(vendedor, 'atendimentos')).toBe(true)
    expect(podeFonte(vendedor, 'atendimentos', 'export')).toBe(false)
    expect(podeFonte(vendedor, 'leads')).toBe(false)
    expect(escopoFonte(vendedor, 'atendimentos')).toBe('OWN')
    expect(paginasPermitidas(vendedor).map((p) => p.id)).toEqual(['visao-geral', 'comercial'])
    const chat = perfil({ chat: { view: true } })
    expect(paginasPermitidas(chat).map((p) => p.id)).toEqual(['visao-geral'])
    expect(paginasPermitidas(perfil({}))).toEqual([])
    const admin = perfil({}, true)
    expect(escopoFonte(admin, 'leads')).toBe('ALL')
    expect(podeFonte(perfil(fullPermissions()), 'whatsapp', 'export')).toBe(true)
  })
})

describe('análises: junção e ordem', () => {
  it('junta fontes pela chave e ordena', () => {
    const l = juntar(
      [
        [{ chaves: ['2026-02'], valores: { vendas: 3 } }, { chaves: ['2026-01'], valores: { vendas: 1 } }],
        [{ chaves: ['2026-01'], valores: { leads: 10 } }],
      ],
      ['vendas', 'leads'],
    )
    expect(ordenar(l, ['mes'], 'vendas')).toEqual([
      { chaves: ['2026-01'], valores: { vendas: 1, leads: 10 } },
      { chaves: ['2026-02'], valores: { vendas: 3, leads: null } },
    ])
    const f = ordenar([{ chaves: ['a'], valores: { v: 1 } }, { chaves: ['b'], valores: { v: 5 } }, { chaves: ['c'], valores: { v: null } }], ['filial'], 'v')
    expect(f.map((x) => x.chaves[0])).toEqual(['b', 'a', 'c'])
  })

  it('CSV com ponto e vírgula, BOM e sem fórmula', () => {
    const s = csv(['A', 'B'], [['=1+1', 2.5], ['x;y', null]])
    expect(s.startsWith('﻿')).toBe(true)
    expect(s).toContain("'=1+1;2,5")
    expect(s).toContain('"x;y";')
  })
})

describe('análises: WhatsApp', () => {
  const d = (s: string) => new Date(s)
  const info = new Map([
    ['c1', { filial: 'f1', vendedor: 'v1' }],
    ['c2', { filial: 'f2', vendedor: null }],
  ])
  const sessions = [
    { conversationId: 'c1', startAt: d('2026-03-02T12:00:00Z'), startedBy: 'cliente' as const },
    { conversationId: 'c2', startAt: d('2026-03-03T12:00:00Z'), startedBy: 'empresa' as const },
    { conversationId: 'c2', startAt: d('2026-02-10T12:00:00Z'), startedBy: 'cliente' as const },
  ]
  const turn = (c: string, at: string, ms: number | null) => ({ conversationId: c, at: d(at), respondedAt: null, responder: null, first: true, ms, businessMs: ms })
  const turns = [turn('c1', '2026-03-02T12:00:00Z', 10 * 60_000), turn('c2', '2026-03-05T12:00:00Z', 30 * 60_000), turn('c2', '2026-03-06T12:00:00Z', null)]
  const janela = { inicio: d('2026-03-01T03:00:00Z'), fim: d('2026-04-01T03:00:00Z') }
  const medidas = ['wa_atendimentos', 'wa_recebidos', 'wa_primeira_resposta', 'wa_pct_15', 'wa_sem_resposta']

  it('totais do período', () => {
    const [t] = agregarWhatsapp({ sessions, turns, info, ...janela, dims: [], filtros: {}, medidas })
    expect(t!.valores).toEqual({ wa_atendimentos: 2, wa_recebidos: 1, wa_primeira_resposta: 20, wa_pct_15: 0.5, wa_sem_resposta: 1 })
  })

  it('por filial e com filtro de vendedor vazio', () => {
    const porFilial = agregarWhatsapp({ sessions, turns, info, ...janela, dims: ['filial'], filtros: {}, medidas: ['wa_atendimentos'] })
    expect(porFilial.map((l) => [l.chaves[0], l.valores.wa_atendimentos]).sort()).toEqual([
      ['f1', 1],
      ['f2', 1],
    ])
    const [semVendedor] = agregarWhatsapp({ sessions, turns, info, ...janela, dims: [], filtros: { vendedor: [VAZIO] }, medidas: ['wa_atendimentos'] })
    expect(semVendedor!.valores.wa_atendimentos).toBe(1)
  })
})

describe('análises: regras da tela', () => {
  it('períodos prontos', () => {
    expect(datasDoPeriodo('30', '2026-11-10')).toEqual({ de: '2026-10-12', ate: '2026-11-10' })
    expect(datasDoPeriodo('mes_passado', '2026-03-15')).toEqual({ de: '2026-02-01', ate: '2026-02-28' })
    expect(datasDoPeriodo('mes_passado', '2026-01-15')).toEqual({ de: '2025-12-01', ate: '2025-12-31' })
    expect(datasDoPeriodo('12m', '2026-11-10')).toEqual({ de: '2025-12-01', ate: '2026-11-10' })
    expect(periodoDaUrl(new URLSearchParams('de=2026-01-01&ate=2026-01-31'), '2026-11-10')).toEqual({ de: '2026-01-01', ate: '2026-01-31', periodo: null })
    expect(periodoDaUrl(new URLSearchParams('de=2026-02-31&ate=2026-01-31'), '2026-11-10').periodo).toBe('30')
  })

  it('filtros no endereço (link compartilhável)', () => {
    const p = comFiltro(new URLSearchParams('periodo=30'), 'uf', ['PR', 'SC'])
    expect(p.toString()).toBe('periodo=30&uf=PR%7CSC')
    expect(filtrosDaUrl(p)).toEqual({ uf: ['PR', 'SC'] })
    expect(filtrosDaUrl(comFiltro(p, 'uf', null))).toEqual({})
    expect(filtrosParaApi({ uf: ['SC', 'PR'], filial: ['a'] })).toBe('{"filial":["a"],"uf":["PR","SC"]}')
    expect(filtrosParaApi({})).toBe('')
  })

  it('drill-down: desce, sobe e pula o nível já filtrado na página', () => {
    const niveis = ['ano', 'trimestre', 'mes', 'dia'] as const
    let drill = descer([], { dim: 'ano', chave: '2026', rotulo: '2026' })
    expect(nivelDoDrill([...niveis], drill)).toBe('trimestre')
    drill = descer(drill, { dim: 'trimestre', chave: '2026-T1', rotulo: '1º tri/2026' })
    expect(nivelDoDrill([...niveis], drill)).toBe('mes')
    expect(subir(drill, 0)).toHaveLength(1)
    expect(subir(drill, -1)).toEqual([])
    expect(nivelDoDrill(['filial', 'vendedor'], [], { filial: ['x'] })).toBe('vendedor')
    expect(podeDescer([...niveis], 'dia')).toBeNull()
  })

  it('formatos', () => {
    expect(formatar('pct', 0.256)).toBe('25,6%')
    expect(formatar('minutos', 90)).toBe('1,5 h')
    expect(formatar('inteiro', null)).toBe('—')
    expect(textoVariacao('pct', { variacao: 10, diferenca: 0.034 }).texto).toBe('+3,4 p.p.')
    expect(textoVariacao('inteiro', { variacao: -12.5, diferenca: -5 }).texto).toBe('-12,5%')
  })

  it('as medidas usadas pelas páginas existem na API', () => {
    for (const id of MEDIDAS_TELA) expect(MEDIDA_BY_ID.has(id), id).toBe(true)
    expect(PAGINAS_UI.map((p) => p.id)).toEqual(PAGINAS.map((p) => p.id))
  })
})
