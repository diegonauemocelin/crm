import { describe, expect, it } from 'vitest'
import { allowedAction, detailQuery, fold, nextSync, productFrom, productQuery, rowsOf, tcarDate } from '../src/tcar/tcar'

const row = {
  fll_codigo: 1,
  epctb_codigo: 'PROD001',
  epctb_nome: 'FILTRO DE ÓLEO',
  epctb_ean: '7891234567890',
  epctb_codigofabrica: 'FAB-12345',
  epctb_codigointegracao: 'INTEG-001',
  epctb_unidade: 'UN',
  epapl_id: 'MT',
  epcte_estoquedisponivel: 17.0,
  epcte_custcont: 28.5,
  epprc_preco: 45.9,
  epprc_precorevenda: 43.6,
  grupo_descricao: 'PECAS',
  subgrupo_descricao: 'FILTROS',
  marca_descricao: 'MANN',
  epctb_codigoref1: 'REF-A1',
  epctb_codigoref2: null,
  epctb_codigoimp1: 'IMP-001',
  epctb_utilizadoem: 'JCB 3CX, 4CX',
  filiais: [{ fll_codigo: 2, fll_nome: 'FILIAL SUL', estoque_disponivel: 5, preco: 46.5, preco_revenda: 44, custo_contabil: 30.15 }],
}

describe('Tcar: produto', () => {
  it('converte o produto, junta as referências e nunca copia o custo', () => {
    const p = productFrom(row, 'epctb_utilizadoem')!
    expect(p).toMatchObject({ code: 'PROD001', name: 'FILTRO DE ÓLEO', factoryCode: 'FAB-12345', integrationCode: 'INTEG-001', refs: ['REF-A1', 'IMP-001'], brand: 'MANN', application: 'MT', usedIn: 'JCB 3CX, 4CX', stock: 17, price: 45.9, resalePrice: 43.6 })
    expect(p.branches).toEqual([{ id: 2, name: 'FILIAL SUL', available: 5, price: 46.5, resalePrice: 44 }])
    expect(JSON.stringify(p)).not.toMatch(/28\.5|30\.15|cust/i)
    expect(p.searchText).toContain('filtro de oleo')
    expect(p.searchText).toContain('ref-a1')
  })

  it('sem o campo configurado, o "utilizado em" fica vazio; campo com nome estranho é ignorado', () => {
    expect(productFrom(row)!.usedIn).toBeNull()
    expect(productFrom(row, 'x; drop')!.usedIn).toBeNull()
    expect(productFrom({ epctb_codigo: 'X' })).toBeNull()
  })

  it('lê os formatos de resposta da Tcar (lista, detalhe com data e objeto direto)', () => {
    expect(rowsOf({ data: [row], pagination: { total: 320 } })).toMatchObject({ total: 320 })
    expect(rowsOf({ data: row }).rows).toHaveLength(1)
    expect(rowsOf({ status: 'success', data: { data: [row] } }).rows).toHaveLength(1)
    expect(rowsOf(row).rows).toHaveLength(1)
    expect(rowsOf({ status: 'error', code: 404 }).rows).toHaveLength(0)
    expect(fold('Ação')).toBe('acao')
  })
})

describe('Tcar: consultas', () => {
  it('pede páginas de produtos com referências, filiais e alterados desde (horário de Brasília)', () => {
    const q = productQuery({ offset: 400, since: new Date('2026-10-15T13:00:00Z'), branchIds: [1, 2] })
    expect(q).toEqual({ cmd: '/produtos', verb: 'GET', query_params: { limit: 200, offset: 400, incluir_referencias: 'S', alterado_desde: '2026-10-15 10:00:00', include: 'filiais', branch_ids: '1,2' } })
    expect(tcarDate(new Date('2026-10-15T02:30:00Z'))).toBe('2026-10-14 23:30:00')
    expect(detailQuery('AB/12', []).cmd).toBe('/produtos/AB%2F12')
  })

  it('só leituras de produtos podem ir para a Tcar', () => {
    expect(allowedAction('/produtos', 'GET')).toBe(true)
    expect(allowedAction('/produtos/ABC', 'GET')).toBe(true)
    expect(allowedAction('/produtos', 'POST')).toBe(false)
    expect(allowedAction('/clientes', 'GET')).toBe(false)
    expect(allowedAction('/produtos/../clientes', 'GET')).toBe(false)
    expect(allowedAction('/orcamentos/1', 'DELETE')).toBe(false)
  })

  it('cópia completa quando nunca feita ou vencida; senão, os alterados a cada N minutos', () => {
    const s = { fullEveryHours: 6, incrementalMinutes: 10 }
    const now = new Date('2026-10-15T12:00:00Z')
    expect(nextSync(now, {}, s)).toBe('full')
    expect(nextSync(now, { fullRunning: true }, s)).toBeNull()
    expect(nextSync(now, { lastFullAt: '2026-10-15T07:00:00Z', lastIncrementalAt: '2026-10-15T11:55:00Z' }, s)).toBeNull()
    expect(nextSync(now, { lastFullAt: '2026-10-15T07:00:00Z', lastIncrementalAt: '2026-10-15T11:45:00Z' }, s)).toBe('incremental')
    expect(nextSync(now, { lastFullAt: '2026-10-15T05:00:00Z', lastIncrementalAt: '2026-10-15T11:59:00Z' }, s)).toBe('full')
  })
})
