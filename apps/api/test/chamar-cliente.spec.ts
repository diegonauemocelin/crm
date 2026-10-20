import { describe, expect, it } from 'vitest'
import { cleanNextDay, conversationClosed, nextDayRoute, nextGapMs, DEFAULT_NEXT_DAY_TEXT, isCallOverdue, nextCallDue, nextDayWindow } from '../src/atendimento/regras'
import { DiaSeguinteService } from '../src/whatsapp/dia-seguinte.service'

const H = 3_600_000
const now = new Date('2026-10-20T15:00:00Z')
const neg = { kind: 'PRE_VENDAS' as const, forwarded: true, saleStatus: 'NEGOCIACAO' as const }

describe('em negociação: prazo para chamar o cliente', () => {
  it('ao entrar em negociação, o prazo é agora + horas configuradas', () => {
    expect(nextCallDue(neg, { ...neg, forwarded: false, callDueAt: null }, 24, undefined, now)).toEqual(new Date(now.getTime() + 24 * H))
    expect(nextCallDue(neg, null, 48, undefined, now)).toEqual(new Date(now.getTime() + 48 * H))
  })

  it('continuando em negociação, mantém o prazo; a data escolhida na ficha vale', () => {
    const due = new Date('2026-10-21T12:00:00Z')
    expect(nextCallDue(neg, { ...neg, callDueAt: due }, 24, undefined, now)).toEqual(due)
    const chosen = new Date('2026-10-25T12:00:00Z')
    expect(nextCallDue(neg, { ...neg, callDueAt: due }, 24, chosen, now)).toEqual(chosen)
  })

  it('fora da negociação não há prazo', () => {
    const due = new Date('2026-10-21T12:00:00Z')
    expect(nextCallDue({ ...neg, saleStatus: 'SIM' }, { ...neg, callDueAt: due }, 24, undefined, now)).toBeNull()
    expect(nextCallDue({ ...neg, forwarded: false }, { ...neg, callDueAt: due }, 24, undefined, now)).toBeNull()
    expect(nextCallDue({ ...neg, kind: 'POS_VENDAS' }, null, 24, undefined, now)).toBeNull()
  })

  it('avisa só depois do prazo e enquanto estiver em negociação', () => {
    expect(isCallOverdue({ ...neg, callDueAt: new Date(now.getTime() - 1) }, now)).toBe(true)
    expect(isCallOverdue({ ...neg, callDueAt: new Date(now.getTime() + H) }, now)).toBe(false)
    expect(isCallOverdue({ ...neg, saleStatus: 'NAO', callDueAt: new Date(now.getTime() - H) }, now)).toBe(false)
    expect(isCallOverdue({ ...neg, callDueAt: null }, now)).toBe(false)
  })
})

describe('mensagem automática no dia seguinte', () => {
  it('configuração inválida volta para o padrão (desligada)', () => {
    expect(cleanNextDay(null)).toEqual({ enabled: false, time: '09:00', text: DEFAULT_NEXT_DAY_TEXT, numberId: null, numberIds: [], withoutChat: false, onlyForwarded: true, saleStatuses: ['NEGOCIACAO', 'SIM', 'NAO'], gapMin: 3, gapMax: 20 })
    expect(cleanNextDay({ enabled: true, time: '25:00', text: '  ' })).toMatchObject({ enabled: true, time: '09:00', text: DEFAULT_NEXT_DAY_TEXT })
    expect(cleanNextDay({ enabled: true, time: '08:30', text: ' Oi {nome} ' })).toMatchObject({ time: '08:30', text: 'Oi {nome}' })
  })

  it('antes do horário (São Paulo) não envia; depois, vale para quem abriu pré-venda ontem', () => {
    // 11:59 em São Paulo
    expect(nextDayWindow('12:00', new Date('2026-10-20T14:59:00Z'))).toBeNull()
    const w = nextDayWindow('12:00', new Date('2026-10-20T15:00:00Z'))!
    expect(w.day).toBe('2026-10-19')
    expect(w.from.toISOString()).toBe('2026-10-19T03:00:00.000Z')
    expect(w.to.toISOString()).toBe('2026-10-20T03:00:00.000Z')
  })

  it('a virada do dia é a de São Paulo, não a do servidor (UTC)', () => {
    // 22h de 20/10 em São Paulo = 01h de 21/10 em UTC: ainda é dia 20, "ontem" é 19.
    expect(nextDayWindow('09:00', new Date('2026-10-21T01:00:00Z'))!.day).toBe('2026-10-19')
  })
})

describe('mensagem do dia seguinte: para quem vai', () => {
  it('configuração salva antes das regras: só repassadas ao vendedor, todas as situações da venda', () => {
    expect(cleanNextDay({ enabled: true, time: '07:30', text: 'Oi' })).toMatchObject({ onlyForwarded: true, saleStatuses: ['NEGOCIACAO', 'SIM', 'NAO'] })
    expect(cleanNextDay({ onlyForwarded: false, saleStatuses: ['NAO', 'X' as never, 'NEGOCIACAO'] })).toMatchObject({ onlyForwarded: false, saleStatuses: ['NEGOCIACAO', 'NAO'] })
    expect(cleanNextDay({ saleStatuses: [] })).toMatchObject({ saleStatuses: ['NEGOCIACAO', 'SIM', 'NAO'] })
  })

  it('conversa arquivada ou atendimento finalizado não recebe', () => {
    const leadAt = new Date('2026-10-19T13:00:00Z')
    expect(conversationClosed(null, leadAt)).toBe(false)
    expect(conversationClosed({ status: 'ABERTA', closedAt: null }, leadAt)).toBe(false)
    expect(conversationClosed({ status: 'ARQUIVADA', closedAt: null }, leadAt)).toBe(true)
    expect(conversationClosed({ status: 'ABERTA', closedAt: new Date('2026-10-19T18:00:00Z') }, leadAt)).toBe(true)
    // Finalizada num atendimento anterior e o cliente voltou a chamar: é atendimento novo.
    expect(conversationClosed({ status: 'ABERTA', closedAt: new Date('2026-10-10T18:00:00Z') }, leadAt)).toBe(false)
  })

  it('busca só repassadas no dia anterior, nas situações escolhidas; finalizada fica registrada e não envia', async () => {
    let where: Record<string, unknown> = {}
    const marked: Record<string, unknown>[] = []
    const sent: string[] = []
    const prisma = {
      tenantSetting: { findMany: async () => [{ tenantId: 't', value: { nextDayMessage: { enabled: true, time: '07:30', text: 'Oi {nome}', saleStatuses: ['NEGOCIACAO', 'SIM'], numberIds: ['n1'] } } }] },
      serviceRecord: {
        findMany: async (a: { where: Record<string, unknown> }) => ((where = a.where), [
          { id: 'r1', name: 'Ana', phone: '+5549999990001', leadId: null, leadAt: new Date('2026-10-19T12:00:00Z'), seller: null },
          { id: 'r2', name: 'Bia', phone: '+5549999990002', leadId: null, leadAt: new Date('2026-10-19T12:00:00Z'), seller: null },
          { id: 'r3', name: 'Caio', phone: '+5549999990003', leadId: null, leadAt: new Date('2026-10-19T12:00:00Z'), seller: null },
          { id: 'r4', name: 'Duda', phone: '+5549999990004', leadId: null, leadAt: new Date('2026-10-19T12:00:00Z'), seller: null },
        ]),
        updateMany: async (a: { where: { id: string }; data: Record<string, unknown> }) => (marked.push({ id: a.where.id, ...a.data }), { count: 1 }),
        update: async () => ({}),
      },
      whatsappNumber: { findMany: async () => [{ id: 'n1', name: 'Pré-vendas' }, { id: 'ecommerce', name: 'E-commerce' }] },
      whatsappMessage: { findFirst: async () => null },
      whatsappConversation: {
        findFirst: async (a: { where: { recordId?: string; numberId?: unknown } }) =>
          a.where.recordId === 'r1' ? { numberId: 'n1', status: 'ARQUIVADA', closedAt: null } : a.where.recordId === 'r2' ? { numberId: 'n1', status: 'ABERTA', closedAt: null } : a.where.recordId === 'r3' ? { numberId: 'ecommerce', status: 'ABERTA', closedAt: null } : null,
      },
    }
    const chat = { sendAutomatic: async (_n: unknown, phone: string) => (sent.push(phone), { waId: 'x' }) }
    await new DiaSeguinteService(prisma as never, chat as never).tick(new Date('2026-10-20T11:00:00Z'))
    expect(where).toMatchObject({ forwarded: true, saleStatus: { in: ['NEGOCIACAO', 'SIM'] } })
    expect(where.OR).toEqual([{ forwardedAt: { gte: new Date('2026-10-19T03:00:00Z'), lt: new Date('2026-10-20T03:00:00Z') } }, { forwardedAt: null, leadAt: { gte: new Date('2026-10-19T03:00:00Z'), lt: new Date('2026-10-20T03:00:00Z') } }])
    expect(marked[0]).toMatchObject({ id: 'r1', autoMessageStatus: 'NÃO ENVIADA: conversa finalizada ou arquivada' })
    expect(marked.find((m) => m.id === 'r3')).toMatchObject({ autoMessageStatus: 'NÃO ENVIADA: atendimento por um número de WhatsApp que não está nas regras' })
    expect(marked.find((m) => m.id === 'r4')).toMatchObject({ autoMessageStatus: 'NÃO ENVIADA: cliente não chamou por WhatsApp' })
    expect(sent).toEqual(['+5549999990002'])
  })
})

describe('mensagem do dia seguinte: por qual número', () => {
  const cfg = { numberIds: ['pre'], numberId: null, withoutChat: false }
  it('só atendimentos dos números escolhidos, pelo mesmo número; o do e-commerce não recebe', () => {
    expect(nextDayRoute({ numberId: 'pre' }, cfg, ['pre', 'eco'])).toEqual({ send: 'pre' })
    expect(nextDayRoute({ numberId: 'eco' }, cfg, ['pre', 'eco'])).toHaveProperty('skip')
    expect(nextDayRoute({ numberId: 'eco' }, { ...cfg, numberIds: ['pre', 'eco'] }, ['pre', 'eco'])).toEqual({ send: 'eco' })
    // Número escolhido desconectado: espera, nunca vai por outro.
    expect(nextDayRoute({ numberId: 'pre' }, cfg, ['eco'])).toEqual({ wait: true })
  })
  it('sem conversa (formulário): só com a opção ligada, pelo número escolhido para isso', () => {
    expect(nextDayRoute(null, cfg, ['pre'])).toEqual({ skip: 'cliente não chamou por WhatsApp' })
    expect(nextDayRoute(null, { ...cfg, withoutChat: true }, ['pre'])).toEqual({ send: 'pre' })
    expect(nextDayRoute(null, { ...cfg, withoutChat: true, numberId: 'eco' }, ['pre', 'eco'])).toEqual({ send: 'eco' })
  })
  it('configuração salva antes: só o número que estava selecionado, nunca todos', () => {
    expect(cleanNextDay({ numberId: '11111111-1111-4111-8111-111111111111' })).toMatchObject({ numberIds: ['11111111-1111-4111-8111-111111111111'] })
    expect(cleanNextDay({})).toMatchObject({ numberIds: [] })
  })
})

describe('mensagem do dia seguinte: intervalo entre os envios', () => {
  it('sorteia de 3 a 20 minutos (configurável de 1 a 120)', () => {
    const cfg = cleanNextDay({})
    expect(nextGapMs(cfg, () => 0)).toBe(3 * 60_000)
    expect(nextGapMs(cfg, () => 1)).toBe(20 * 60_000)
    expect(cleanNextDay({ gapMin: 30, gapMax: 10 })).toMatchObject({ gapMin: 10, gapMax: 30 })
    expect(cleanNextDay({ gapMin: 0, gapMax: 999 })).toMatchObject({ gapMin: 1, gapMax: 120 })
  })

  it('uma mensagem por vez em cada número; a próxima só depois do intervalo', async () => {
    const sent: string[] = []
    const pending = new Set(['r1', 'r2', 'r3'])
    const prisma = {
      tenantSetting: { findMany: async () => [{ tenantId: 't', value: { nextDayMessage: { enabled: true, time: '07:30', text: 'Oi', numberIds: ['n1'] } } }] },
      serviceRecord: {
        findMany: async () => [...pending].map((id) => ({ id, name: id, phone: `+55499999900${id.slice(1)}0`, leadId: null, leadAt: new Date('2026-10-19T12:00:00Z'), seller: null })),
        updateMany: async (a: { where: { id: string } }) => (pending.delete(a.where.id), { count: 1 }),
        update: async () => ({}),
      },
      whatsappNumber: { findMany: async () => [{ id: 'n1', name: 'Pré-vendas' }] },
      whatsappMessage: { findFirst: async () => null },
      whatsappConversation: { findFirst: async () => ({ numberId: 'n1', status: 'ABERTA', closedAt: null }) },
    }
    const svc = new DiaSeguinteService(prisma as never, { sendAutomatic: async (_n: unknown, phone: string) => (sent.push(phone), { waId: 'x' }) } as never)
    svc.random = () => 0.5 // 11,5 minutos
    const at = (min: number) => new Date(Date.parse('2026-10-20T11:00:00Z') + min * 60_000)
    await svc.tick(at(0))
    expect(sent).toHaveLength(1)
    await svc.tick(at(5))
    await svc.tick(at(11))
    expect(sent).toHaveLength(1)
    await svc.tick(at(12))
    expect(sent).toHaveLength(2)
  })
})
