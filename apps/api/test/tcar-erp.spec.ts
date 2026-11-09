import { describe, expect, it } from 'vitest'
import { allowedRoute, budgetFrom, clientAddressFrom, clientQuery, docNumber, documentQuery, laneOf, photosFrom, photosQuery, preNoteFrom, weightOf } from '../src/tcar/erp'
import { allowedAction, productFrom } from '../src/tcar/tcar'

describe('Tcar: rotas permitidas', () => {
  it('só GET nas rotas de leitura conhecidas, com os parâmetros conhecidos', () => {
    expect(allowedRoute('/produtos', 'GET', { limit: 200, offset: 0, incluir_referencias: 'S' })).toBe(true)
    expect(allowedRoute('/produtos/ABC%2F1/fotos', 'GET', { max_fotos: 6 })).toBe(true)
    expect(allowedRoute('/orcamentos/1001', 'GET', { incluir_servicos: 'false' })).toBe(true)
    expect(allowedRoute('/pre-notas/789', 'GET')).toBe(true)
    expect(allowedRoute('/clientes/456', 'GET')).toBe(true)
    // Escrita, rotas fora da lista, parâmetros desconhecidos ou caminho estranho: nunca.
    expect(allowedRoute('/orcamentos/1001/frete', 'PATCH')).toBe(false)
    expect(allowedRoute('/orcamentos', 'POST')).toBe(false)
    expect(allowedRoute('/orcamentos', 'GET')).toBe(false)
    expect(allowedRoute('/clientes', 'GET')).toBe(false)
    expect(allowedRoute('/clientes/abc', 'GET')).toBe(false)
    expect(allowedRoute('/clientes/1', 'DELETE')).toBe(false)
    // Notas fiscais não são lidas da Tcar (o XML entra por importação em Fretes).
    expect(allowedRoute('/notas-fiscais', 'GET')).toBe(false)
    expect(allowedRoute('/notas-fiscais/123/xml', 'GET', { chave_nfe: '1' })).toBe(false)
    expect(allowedRoute('/produtos/../clientes', 'GET')).toBe(false)
    expect(allowedRoute('/produtos/../fotos', 'GET')).toBe(false)
    expect(allowedRoute('/produtos', 'GET', { incluir_inativos: 1 })).toBe(false)
    expect(allowedRoute('/clientes/1', 'GET', { x: 'y' })).toBe(false)
    expect(allowedRoute('/clientes/1', 'GET', { q: { a: 1 } })).toBe(false)
    expect(allowedAction('/produtos/ABC', 'GET')).toBe(true)
  })

  it('montagem das consultas', () => {
    expect(photosQuery('A/B')).toEqual({ cmd: '/produtos/A%2FB/fotos', query_params: { max_fotos: 6 } })
    expect(documentQuery('ORCAMENTO', ' 0012 ')).toEqual({ cmd: '/orcamentos/12', query_params: { incluir_servicos: 'false', incluir_servicos_terceiros: 'false' } })
    expect(documentQuery('PRE_NOTA', '789').cmd).toBe('/pre-notas/789')
    expect(() => documentQuery('ORCAMENTO', '12/../1')).toThrow()
    expect(docNumber('0')).toBeNull()
    expect(clientQuery(456).cmd).toBe('/clientes/456')
    expect(() => clientQuery(-1)).toThrow()
  })

  it('faixas da fila: tela, produtos e fotos separadas', () => {
    expect(laneOf('live')).toBe('tela')
    expect(laneOf('doc')).toBe('tela')
    expect(laneOf('full')).toBe('produtos')
    expect(laneOf('nf-xml')).toBeNull()
    expect(laneOf('photos')).toBe('fotos')
    expect(laneOf('outra')).toBeNull()
  })
})

describe('Tcar: produtos (peso) e fotos', () => {
  it('peso bruto e líquido do cadastro; zero = sem peso', () => {
    expect(productFrom({ epctb_codigo: 'P', epctb_nome: 'X', epctb_pesobruto: 0.35, epctb_pesoliq: 0.32 })).toMatchObject({ grossWeight: 0.35, netWeight: 0.32 })
    expect(productFrom({ epctb_codigo: 'P', epctb_nome: 'X', epctb_pesobruto: 0 })).toMatchObject({ grossWeight: null, netWeight: null })
  })

  it('aceita só imagens de verdade (pelos bytes) e endereços https, capa primeiro', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')
    const svg = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')
    const r = photosFrom({
      data: [
        { tipo: 'blob', base64: jpg, mime: 'image/jpeg' },
        { tipo: 'blob', base64: svg, mime: 'image/png' },
        { tipo: 'url', url: 'http://inseguro/x.jpg' },
        { tipo: 'url', url: 'https://cdn.exemplo/ml-02.jpg' },
        { tipo: 'blob', base64: png },
      ],
    })
    expect(r.photos.map((p) => (p.kind === 'blob' ? p.mime : p.url))).toEqual(['image/jpeg', 'https://cdn.exemplo/ml-02.jpg', 'image/png'])
    expect(r.skipped).toBe(2)
    expect(photosFrom({ data: [{ tipo: 'blob', base64: jpg }, { tipo: 'blob', base64: png }] }, 1).photos).toHaveLength(1)
    expect(photosFrom({ data: [], total: 0 }).photos).toEqual([])
  })

  it('peso da carga: quantidade × peso bruto; lista as peças sem peso', () => {
    const w = new Map<string, number | null>([['A', 0.35], ['B', null], ['C', 2]])
    expect(weightOf([{ code: 'A', quantity: 2 }, { code: 'B', quantity: 1 }, { code: 'C', quantity: 3 }, { code: 'D', quantity: 1 }], w)).toEqual({ total: 6.7, missing: ['B', 'D'] })
  })
})

describe('Tcar: orçamento, pré-nota e cliente', () => {
  it('orçamento: cabeçalho, peças e só o CNPJ do cliente', () => {
    const d = budgetFrom({
      data: {
        atorc_numero: 1001,
        fll_codigo: 1,
        atorc_situacao: 'N',
        atorc_dtaemi: '2026-05-21 09:14:00',
        atorc_totalpeca: 91.8,
        atorc_totalgeral: 251.8,
        cln_codigo_cliente: 456,
        cliente_nome: 'Transportadora Exemplo Ltda',
        cliente_cnpj: '12345678000199',
        itens: [
          { atoit_seq: 1, atoit_codigo: 'PROD001', atoit_descricao: 'Filtro de oleo', atoit_qtdade: 2, atoit_vlr_unitario: 45.9, atoit_vlr_total: 91.8 },
          { atoit_codigo: 'ZERO', atoit_qtdade: 0 },
        ],
      },
    })!
    expect(d).toMatchObject({ type: 'ORCAMENTO', number: '1001', branchId: 1, status: 'N', statusLabel: 'Aberto', productsTotal: 91.8, total: 251.8, customerCode: 456, customerCnpj: '12345678000199', personType: 'PJ' })
    expect(d.items).toEqual([{ code: 'PROD001', description: 'Filtro de oleo', quantity: 2, unitPrice: 45.9, total: 91.8 }])
    expect(budgetFrom({ data: { cliente_cnpj: '12345678900' } })).toBeNull()
    expect(budgetFrom({ data: { atorc_numero: 5, cliente_cnpj: '123.456.789-00' } })).toMatchObject({ customerCnpj: null, personType: 'PF' })
  })

  it('pré-nota (venda): o "fornecedor" da API é o cliente', () => {
    const d = preNoteFrom({
      data: {
        chave: { id: 789, filial: 1 },
        cabecalho: { numero: 789, data_emissao: '2026-06-10', situacao: 'N' },
        fornecedor: { codigo: 456, nome: 'CLIENTE EXEMPLO LTDA', fantasia: 'EXEMPLO', cnpj_cpf: '12345678000195' },
        filial: { codigo: 1, nome: 'MATRIZ' },
        totais: { valor_produtos: 1750, valor_total: 1850, valor_frete: 100 },
        itens: [{ sequencia: 1, produto_codigo: 'PROD001', descricao: 'FILTRO DE OLEO', quantidade: 10, valor_unitario: 45.9, valor_total: 459, valor_liquido: 459 }],
      },
    })!
    expect(d).toMatchObject({ type: 'PRE_NOTA', number: '789', branchId: 1, statusLabel: 'Pendente', productsTotal: 1750, total: 1850, freight: 100, customerCode: 456, customerName: 'CLIENTE EXEMPLO LTDA', customerCnpj: '12345678000195' })
    expect(d.items[0]).toMatchObject({ code: 'PROD001', quantity: 10, total: 459 })
  })

  it('cliente: só CEP, cidade, UF e IBGE (nada de telefone, e-mail ou CPF)', () => {
    const a = clientAddressFrom({ data: { cln_codigo: 456, cln_nome: 'FULANO', cln_cpfcnpj: '12345678900', cln_fone: '11999998888', cln_email: 'x@example.com', cep_cep: '01310-100', cdd_codigo: 3550308, uf_estado: 'sp', cidade_nome: 'Sao Paulo' } })
    expect(a).toEqual({ zip: '01310100', city: 'Sao Paulo', uf: 'SP', ibge: '3550308' })
    expect(clientAddressFrom({ data: {} })).toEqual({ zip: null, city: null, uf: null, ibge: null })
  })
})
