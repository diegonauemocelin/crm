import { describe, expect, it } from 'vitest'
import { AI_DEFAULTS } from '../src/assistente/constantes'
import { buildAnswer, classifyQuestion, extractCep, forbiddenContent, itemSku, parseFreightOptions } from '../src/assistente/frete'

describe('perguntas do Mercado Livre: é sobre frete?', () => {
  it('frete com CEP', () => {
    for (const t of ['Qual o frete para 01310-100?', 'quanto fica o frete pra 89201000', 'Boa tarde, entrega em 88.010-000?', 'cep 30140071', '01310-100']) expect(classifyQuestion(t), t).toEqual({ kind: 'frete', cep: expect.stringMatching(/^\d{8}$/) })
  })

  it('frete sem CEP', () => {
    for (const t of ['Qual o valor do frete?', 'Envia para Curitiba?', 'Qual o prazo de entrega para SP?', 'Vocês mandam pelos correios?']) expect(classifyQuestion(t)?.kind, t).toBe('frete_sem_cep')
  })

  it('frete junto com outro assunto fica para uma pessoa', () => {
    for (const t of ['Serve no Corolla 2015? E o frete para 01310-100?', 'Tem em estoque? qual o frete', 'É original? envia hoje?']) expect(classifyQuestion(t)?.kind, t).toBe('misto')
  })

  it('pergunta que não é de frete não é tocada', () => {
    for (const t of ['Serve no Gol G5?', 'É original?', 'Tem nota fiscal?', 'Qual a medida do disco?', 'vocês tem o 32925682?']) expect(classifyQuestion(t), t).toBeNull()
  })

  it('CEP em vários formatos', () => {
    expect(extractCep('cep 01310-100')).toBe('01310100')
    expect(extractCep('01.310-100')).toBe('01310100')
    expect(extractCep('00000-000')).toBeNull()
    expect(extractCep('sem cep')).toBeNull()
  })
})

describe('cotação da Magazord', () => {
  it('lista de serviços com transportadora, valor e prazo (mais barata primeiro)', () => {
    const data = { transportadoras: [{ transportadora: { nome: 'Jadlog' }, servicos: [{ servico: '.Package', valor: '45,90', prazo: 6 }, { servico: '.Com', valor: 62.3, prazoEntrega: '4' }] }, { nome: 'Correios PAC', valorFrete: 39.9, diasUteis: 8 }] }
    expect(parseFreightOptions(data)).toEqual([
      { name: 'Correios PAC', price: 39.9, days: 8 },
      { name: 'Jadlog .Package', price: 45.9, days: 6 },
      { name: 'Jadlog .Com', price: 62.3, days: 4 },
    ])
  })

  it('lista direta e frete grátis; opção com erro fica de fora', () => {
    expect(parseFreightOptions([{ descricao: 'Retira na loja', valor: 0, prazo: 1 }, { descricao: 'Expresso', valor: 10, erro: 'CEP não atendido' }])).toEqual([{ name: 'Retira na loja', price: 0, days: 1 }])
    expect(parseFreightOptions(null)).toEqual([])
    expect(parseFreightOptions({ status: 'success', data: [] })).toEqual([])
  })

  it('resposta com as opções e o CEP formatado', () => {
    const a = buildAnswer({ intro: AI_DEFAULTS.frete_intro, outro: AI_DEFAULTS.frete_outro }, '01310100', [{ name: 'PAC', price: 39.9, days: 8 }, { name: 'Retira', price: 0, days: null }])
    expect(a).toContain('01310-100')
    expect(a).toContain('- PAC: R$ 39,90, entrega em até 8 dias úteis')
    expect(a).toContain('- Retira: grátis')
    expect(a.length).toBeLessThanOrEqual(2000)
  })

  it('textos com telefone, e-mail ou link são barrados (o Mercado Livre bloqueia)', () => {
    expect(forbiddenContent('Chame no (47) 99999-1234')).toBeTruthy()
    expect(forbiddenContent('veja www.loja.com.br')).toBeTruthy()
    expect(forbiddenContent('vendas@loja.com')).toBeTruthy()
    expect(forbiddenContent(AI_DEFAULTS.frete_intro)).toBeNull()
    expect(forbiddenContent(AI_DEFAULTS.frete_outro)).toBeNull()
    expect(forbiddenContent(AI_DEFAULTS.frete_ask_cep_text)).toBeNull()
  })

  it('SKU do anúncio: SELLER_SKU, campo do vendedor ou primeira variação', () => {
    expect(itemSku({ attributes: [{ id: 'SELLER_SKU', value_name: 'ABC-1' }] })).toBe('ABC-1')
    expect(itemSku({ seller_custom_field: 'X9' })).toBe('X9')
    expect(itemSku({ variations: [{ attributes: [{ id: 'SELLER_SKU', value_name: 'V1' }] }] })).toBe('V1')
    expect(itemSku({})).toBeNull()
  })
})
