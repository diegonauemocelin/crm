import { describe, expect, it } from 'vitest'
import { buildAnswer, classifyQuestion, DEFAULT_QUESTIONS, extractCep, forbiddenContent, itemSku, parseFreightOptions } from '../src/marketplaces/perguntas'
import { MlQuestionsService } from '../src/marketplaces/perguntas.service'

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
    for (const t of ['Serve no Gol G5?', 'É original?', 'Tem nota fiscal?', 'Qual a medida do disco?']) expect(classifyQuestion(t), t).toBeNull()
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
    const a = buildAnswer(DEFAULT_QUESTIONS, '01310100', [{ name: 'PAC', price: 39.9, days: 8 }, { name: 'Retira', price: 0, days: null }])
    expect(a).toContain('01310-100')
    expect(a).toContain('- PAC: R$ 39,90, entrega em até 8 dias úteis')
    expect(a).toContain('- Retira: grátis')
    expect(a.length).toBeLessThanOrEqual(2000)
  })

  it('textos com telefone, e-mail ou link são barrados (o Mercado Livre bloqueia)', () => {
    expect(forbiddenContent('Chame no (47) 99999-1234')).toBeTruthy()
    expect(forbiddenContent('veja www.loja.com.br')).toBeTruthy()
    expect(forbiddenContent('vendas@loja.com')).toBeTruthy()
    expect(forbiddenContent(DEFAULT_QUESTIONS.intro)).toBeNull()
    expect(forbiddenContent(DEFAULT_QUESTIONS.outro)).toBeNull()
    expect(forbiddenContent(DEFAULT_QUESTIONS.askCepText)).toBeNull()
  })

  it('SKU do anúncio: SELLER_SKU, campo do vendedor ou primeira variação', () => {
    expect(itemSku({ attributes: [{ id: 'SELLER_SKU', value_name: 'ABC-1' }] })).toBe('ABC-1')
    expect(itemSku({ seller_custom_field: 'X9' })).toBe('X9')
    expect(itemSku({ variations: [{ attributes: [{ id: 'SELLER_SKU', value_name: 'V1' }] }] })).toBe('V1')
    expect(itemSku({})).toBeNull()
  })
})

describe('fluxo: sugerir ou responder sozinho', () => {
  const make = (mode: 'sugerir' | 'automatico', freight: unknown = [{ nome: 'PAC', valor: 39.9, prazo: 8 }]) => {
    const rows: Record<string, unknown>[] = []
    const posted: unknown[] = []
    const store = new Map<string, unknown>([['marketplace_ml_perguntas', { enabled: true, mode, enabledAt: '2026-01-01T00:00:00Z' }]])
    const prisma = {
      marketplaceQuestion: {
        findMany: async () => rows.map((r) => ({ questionId: r.questionId })),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const r = { id: `id${rows.length}`, ...data }
          rows.push(r)
          return r
        },
        findFirst: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
        updateMany: async () => ({ count: 0 }),
      },
    }
    const settings = { get: async (_t: string, k: string, d: object) => ({ ...d, ...((store.get(k) as object) ?? {}) }), set: async (_t: string, k: string, v: object) => (store.set(k, v), v) }
    const ml = {
      config: async () => ({ status: 'CONECTADO', userId: '123' }),
      apiGet: async (_t: string, path: string) => {
        if (path === '/questions/search')
          return {
            total: 3,
            questions: [
              { id: 1, item_id: 'MLB1', text: 'Qual o frete para 01310-100?', status: 'UNANSWERED', date_created: '2026-10-22T10:00:00Z' },
              { id: 2, item_id: 'MLB1', text: 'Serve no Gol?', status: 'UNANSWERED', date_created: '2026-10-22T10:01:00Z' },
              { id: 3, item_id: 'MLB1', text: 'Tem em estoque e qual o frete?', status: 'UNANSWERED', date_created: '2026-10-22T10:02:00Z' },
            ],
          }
        return { title: 'Pastilha', price: 120, permalink: 'https://x', attributes: [{ id: 'SELLER_SKU', value_name: 'PAST-1' }] }
      },
      apiPost: async (_t: string, path: string, body: unknown) => (posted.push({ path, body }), {}),
    }
    const calls: unknown[] = []
    const magazord = { simulateFreight: async (...a: unknown[]) => (calls.push(a), freight) }
    const svc = new MlQuestionsService(prisma as never, settings as never, ml as never, magazord as never)
    return { svc, rows, posted, calls }
  }

  it('modo sugerir: deixa a resposta pronta e não envia; só pega as de frete', async () => {
    const { svc, rows, posted, calls } = make('sugerir')
    const r = await svc.check('t1')
    expect(r.created).toBe(2)
    expect(posted).toEqual([])
    expect(calls[0]).toEqual(['t1', '01310100', [{ sku: 'PAST-1', quantity: 1, price: 120 }]])
    expect(rows.find((x) => x.questionId === '1')).toMatchObject({ status: 'sugerida', sku: 'PAST-1', kind: 'frete' })
    expect(String(rows.find((x) => x.questionId === '1')!.answer)).toContain('PAC: R$ 39,90')
    expect(rows.find((x) => x.questionId === '3')).toMatchObject({ status: 'revisar', kind: 'misto' })
    // Na segunda leitura não repete.
    expect((await svc.check('t1')).created).toBe(0)
  })

  it('modo automático: responde só a de frete puro', async () => {
    const { svc, rows, posted } = make('automatico')
    await svc.check('t1')
    expect(posted).toEqual([{ path: '/answers', body: { question_id: 1, text: expect.stringContaining('01310-100') } }])
    expect(rows.find((x) => x.questionId === '1')).toMatchObject({ status: 'respondida', answeredBy: 'automático' })
    expect(rows.find((x) => x.questionId === '3')!.status).toBe('revisar')
  })

  it('sem opção de frete na Magazord: não responde, fica como erro para uma pessoa', async () => {
    const { svc, rows, posted } = make('automatico', { data: [] })
    await svc.check('t1')
    expect(posted).toEqual([])
    expect(rows.find((x) => x.questionId === '1')).toMatchObject({ status: 'erro', error: expect.stringContaining('Magazord') })
  })
})
