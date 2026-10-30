import { describe, expect, it } from 'vitest'
import { AssistPipelineService } from '../src/assistente/pipeline.service'

/** Envio das respostas ao Mercado Livre: só vale como enviada quando a pergunta aparece respondida lá. */
function make(o: { afterStatus: string; questionStatus?: string; attempts?: { sendStatus: string }[]; events?: string[] }) {
  const updates: { where: unknown; data: Record<string, unknown> }[] = []
  const statuses: { status: string; type?: string }[] = []
  const attempt = { id: 1, questionId: 10, text: 'Temos sim', kind: 'resposta', origin: 'atendente', sendStatus: 'preparada', sendRequestedAt: new Date(), reviewed: true, authorId: null, authorName: null, reviewedById: null, reviewedByName: null, ai: null }
  const question = { id: 10, mlQuestionId: '555', status: o.questionStatus ?? 'em_atendimento' }
  const prisma = {
    assistAttempt: {
      findFirst: async ({ where }: { where: { sendStatus?: unknown; id?: unknown } }) => (where.id === 1 ? attempt : where.sendStatus === 'enviada' ? ((o.attempts ?? []).some((a) => a.sendStatus === 'enviada') ? { id: 2 } : null) : null),
      updateMany: async (a: { where: unknown; data: Record<string, unknown> }) => (updates.push(a), { count: 1 }),
      update: async (a: { where: unknown; data: Record<string, unknown> }) => (updates.push(a), {}),
    },
    assistQuestion: { findUniqueOrThrow: async () => question, findUnique: async () => question, update: async () => ({}) },
    assistEvent: { findFirst: async () => ((o.events ?? []).length ? { id: 1 } : null) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }
  const assist = {
    prisma,
    addEvent: async () => undefined,
    log: async () => undefined,
    setStatus: async (_t: string, _q: number, status: string, x: { type?: string } = {}) => statuses.push({ status, type: x.type }),
  }
  let gets = 0
  const ml = {
    active: async () => true,
    getQuestion: async () => (gets++ === 0 ? { status: 'UNANSWERED' } : { status: o.afterStatus, answer: o.afterStatus === 'ANSWERED' ? { text: 'Temos sim' } : null }),
    postAnswer: async () => ({ id: 555, status: 'UNANSWERED' }),
  }
  const knowledge = { learn: async () => null }
  const svc = new AssistPipelineService(assist as never, ml as never, knowledge as never, {} as never)
  return { svc, updates, statuses }
}

describe('Envio da resposta ao Mercado Livre', () => {
  it('a volta do POST com id não basta: sem a pergunta respondida lá, fica sem confirmação', async () => {
    const { svc, updates, statuses } = make({ afterStatus: 'UNANSWERED' })
    const r = await svc.sendAttempt('t', 1, null)
    expect(r).toMatchObject({ sent: false, pendingConfirmation: true, situation: 'UNANSWERED' })
    expect(updates.at(-1)!.data.sendStatus).toBe('pendente_confirmacao')
    expect(statuses.some((s) => s.status === 'respondida')).toBe(false)
  })

  it('pergunta respondida no Mercado Livre: confirma o envio', async () => {
    const { svc, updates, statuses } = make({ afterStatus: 'ANSWERED' })
    expect(await svc.sendAttempt('t', 1, null)).toEqual({ sent: true })
    expect(updates.some((u) => u.data.sendStatus === 'enviada')).toBe(true)
    expect(statuses.at(-1)!.status).toBe('respondida')
  })

  it('pergunta dada como respondida no CRM, mas aberta no Mercado Livre: volta para as pendentes', async () => {
    const { svc, updates, statuses } = make({ afterStatus: 'UNANSWERED', questionStatus: 'resolvida', attempts: [{ sendStatus: 'enviada' }] })
    await svc.ingest('t', { id: 555, status: 'UNANSWERED', item_id: 'MLB1', text: 'oi' } as never, 'sincronização')
    expect(updates.some((u) => u.data.sendStatus === 'falha')).toBe(true)
    expect(statuses.at(-1)).toEqual({ status: 'aguardando_analise', type: 'reaberta_ml' })
  })

  it('fechada à mão e já reaberta uma vez, sem envio: não reabre de novo', async () => {
    const { svc, statuses } = make({ afterStatus: 'UNANSWERED', questionStatus: 'resolvida', events: ['reaberta_ml'] })
    await svc.ingest('t', { id: 555, status: 'UNANSWERED', item_id: 'MLB1', text: 'oi' } as never, 'sincronização')
    expect(statuses).toEqual([])
  })
})
