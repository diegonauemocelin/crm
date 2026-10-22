import { describe, expect, it } from 'vitest'
import { AI_DEFAULTS, outcomeOf } from '../src/assistente/constantes'
import { type AssistContext, validate } from '../src/assistente/ia'
import { classifyRow, type RowData } from '../src/assistente/importacao.service'
import { generateRules } from '../src/assistente/regras'
import { classifyForLearning, cleanAnswer, codeKey, computePriority, extractCodes, itemCodes, questionSimilarity } from '../src/assistente/texto'
import { readXlsx } from '../src/assistente/xlsx-leitor'
import { toXlsx } from '../src/marketing/arquivos'

const ctx = (o: Partial<AssistContext> = {}): AssistContext =>
  ({
    anuncios_da_loja_encontrados: [],
    anuncio_da_pergunta: { id: 'MLB1', titulo: 'Filtro de ar JCB', preco: 100, moeda: 'BRL', quantidade_disponivel: 2, status: 'active', codigo_peca: 'ABC-123', sku: null, marca_peca: null, descricao: '', atributos: [] },
    conhecimentos_aprovados: [],
    aplicacoes: [],
    anuncios_relacionados_ao_codigo: [],
    anuncios_complementares: [],
    dados_detectados: { codigos: [], marcas: [], modelos: [] },
    anuncios_com_link_permitido: ['MLB1'],
    frete_calculado: null,
    ...o,
  }) as AssistContext

describe('assistente: textos (mesma lógica do painel)', () => {
  it('códigos e semelhança entre perguntas', () => {
    expect(extractCodes('serve o 1R-0750 na 416E?')).toEqual(['1R0750', '416E'])
    expect(codeKey('32/925682')).toBe('32925682')
    expect(questionSimilarity('Tem garantia?', 'tem garantia')).toBe(1)
    expect(questionSimilarity('Tem garantia?', 'Qual a medida do disco?')).toBe(0)
  })

  it('código OEM separado do de referência', () => {
    const c = itemCodes({ sellerSku: 'UP-1', partNumber: '32/925682', attributes: [{ id: 'OEM', name: 'OEM', value: '32/925682' }] })
    expect([...c.ref]).toEqual(['UP1'])
    expect([...c.oem]).toEqual(['32925682'])
  })

  it('aprendizado: preço e frete não viram conhecimento', () => {
    expect(classifyForLearning('Qual o preço?')).toHaveProperty('skip')
    expect(classifyForLearning('Qual o frete para Curitiba?')).toHaveProperty('skip')
    expect(classifyForLearning('Serve na 416E?')).toMatchObject({ scoped: true })
  })

  it('resposta aprendida sem saudação e com marcador no lugar do link', () => {
    expect(cleanAnswer('Bom dia! Veja: https://produto.mercadolivre.com.br/MLB-1-x', [{ id: 'MLB1', permalink: 'https://produto.mercadolivre.com.br/MLB-1-x' }])).toBe('Veja: {{LINK:MLB1}}')
    expect(cleanAnswer('Olá, veja https://site.com', [])).toBe('veja')
  })

  it('prioridade sobe com a idade e a intenção de compra', () => {
    const now = Date.parse('2026-10-22T12:00:00Z')
    expect(computePriority({ receivedAt: '2026-10-21T00:00:00Z', purchaseIntent: true, text: 'quero', pendingReason: 'A' }, now).level).toBe('alta')
    expect(computePriority({ receivedAt: '2026-10-22T11:30:00Z', text: 'oi' }, now).level).toBe('baixa')
  })

  it('funil: comprou, desistiu no checkout e cancelou depois de pagar', () => {
    const now = Date.parse('2026-10-22T12:00:00Z')
    expect(outcomeOf('paid', true, '2026-10-20', now)).toBe('comprou')
    expect(outcomeOf('cancelled', false, '2026-10-20', now)).toBe('desistiu_checkout')
    expect(outcomeOf('cancelled', true, '2026-10-20', now)).toBe('cancelou_apos_pagar')
    expect(outcomeOf('payment_required', false, '2026-10-22T10:00:00Z', now)).toBe('aguardando_pagamento')
    expect(outcomeOf('payment_required', false, '2026-10-10T10:00:00Z', now)).toBe('desistiu_checkout')
  })
})

describe('assistente: modo Sem IA', () => {
  const settings = { ...AI_DEFAULTS }
  const app = (status: string) => ({ codigo: 'ABC-123', produto: 'Filtro', marca_peca: null, marca_maquina: 'Caterpillar', modelo: '416E', sistema: null, aplicacao: 'Retro 416E', status_validacao: status, anuncio_id: 'MLB1' })
  const det = { codigos: [], marcas: [], modelos: ['416E'] }

  it('compatibilidade confirmada responde', () => {
    const r = generateRules({ settings, question: 'Serve na 416E?', greeting: 'Bom dia!', context: ctx({ dados_detectados: det, aplicacoes: [app('confirmada')] as never }) })
    expect(r.decision).toBe('responder')
    expect(r.answer).toContain('416E')
  })

  it('aplicação pendente não confirma', () => {
    const r = generateRules({ settings, question: 'Serve na 416E?', greeting: 'Bom dia!', context: ctx({ dados_detectados: det, aplicacoes: [app('pendente')] as never }) })
    expect(r.decision).not.toBe('responder')
  })

  it('pergunta igual a um conhecimento aprovado usa a resposta aprovada', () => {
    const k = { id: 5, categoria: 'Garantia e troca', titulo: 'Garantia', marca_maquina: null, modelo: null, codigo: null, produto: null, aplicacao: null, pergunta: 'Tem garantia?', resposta_aprovada: '90 dias.', fonte: 'x', semelhanca_com_a_pergunta: 1 }
    const r = generateRules({ settings, question: 'Tem garantia?', greeting: 'Boa noite!', context: ctx({ conhecimentos_aprovados: [k] }) })
    expect(r.decision).toBe('responder')
    expect(r.knowledge_ids_used).toEqual([5])
    expect(r.answer).toContain('90 dias.')
  })

  it('a validação descarta conhecimento e anúncios que não estavam no contexto', () => {
    const v = validate({ decision: 'responder', knowledge_ids_used: [5, 99], complementary_item_ids: ['MLB9'], confidence: 3 }, { knowledge: new Set([5]), complementary: new Set(), links: new Set() } as never)
    expect(v.knowledge_ids_used).toEqual([5])
    expect(v.complementary_item_ids).toEqual([])
    expect(v.confidence).toBe(1)
  })
})

describe('assistente: planilha da base de conhecimento', () => {
  it('lê o Excel gerado pelo CRM', () => {
    const buf = toXlsx([{ name: 'Conhecimentos', header: ['Categoria', 'Marca', 'Resposta'], rows: [['Filtros', 'JCB', 'Sim, & serve.'], ['Motor', 'CAT', 123]] }], 't')
    const [ws] = readXlsx(buf)
    expect(ws!.name).toBe('Conhecimentos')
    expect(ws!.rows.map((r) => r.cells)).toEqual([['Categoria', 'Marca', 'Resposta'], ['Filtros', 'JCB', 'Sim, & serve.'], ['Motor', 'CAT', '123']])
    expect(() => readXlsx(new TextEncoder().encode('não é excel'))).toThrow(/Excel/)
  })

  it('classifica linhas: novo, duplicado e erro', () => {
    const row: RowData = { category: 'Filtros', brand: 'JCB', model: '3C', part_code: 'UP-1', product: 'Filtro', application: 'JCB 3C', question: '', answer: 'Sim.', source: 'Catálogo', status: 'Ativo' }
    const seen = new Map<string, number>()
    const first = classifyRow({ ...row }, seen, () => undefined)
    expect(first.action).toBe('novo')
    seen.set(first.key!, 2)
    expect(classifyRow({ ...row }, seen, () => undefined).action).toBe('duplicado')
    expect(classifyRow({ ...row, answer: '' }, new Map(), () => undefined).action).toBe('erro')
  })
})
