import { describe, expect, it, vi } from 'vitest'
import { cleanContactCheck, cleanForwardMessage } from '../src/atendimento/regras'
import { RepasseService } from '../src/whatsapp/repasse.service'

const now = new Date('2026-10-28T15:00:00Z')

function setup() {
  const updates: unknown[] = []
  const prisma = {
    serviceRecord: {
      findMany: vi.fn(async () => [{ id: 'r1', name: 'Maria Souza', phone: '+5547999990000', leadId: null, leadAt: now, seller: { name: 'João Lima' } }]),
      updateMany: vi.fn(async (a: unknown) => (updates.push(a), { count: 1 })),
      update: vi.fn(async (a: unknown) => (updates.push(a), {})),
    },
    whatsappNumber: { findMany: vi.fn(async () => [{ id: 'n1', name: 'Pré vendas', status: 'CONECTADO' }]) },
    whatsappConversation: { findFirst: vi.fn(async () => ({ numberId: 'n1', status: 'ABERTA', closedAt: null })) },
    whatsappMessage: { findFirst: vi.fn(async () => null) },
  }
  const chat = { rules: vi.fn(async () => ({ businessHours: { enabled: false, days: [] } })), sendAutomatic: vi.fn(async () => true) }
  const svc = new RepasseService(prisma as never, chat as never)
  return { svc, prisma, chat, updates }
}

describe('Mensagens do repasse ao vendedor', () => {
  it('aviso do repasse: na hora (sem esperar) e grava o resultado no campo dele', async () => {
    const { svc, prisma, chat, updates } = setup()
    await svc.runTenant('t1', cleanForwardMessage({ enabled: true, numberIds: ['n1'], since: '2026-10-01T00:00:00Z' }), now, 'forward')
    const where = (prisma.serviceRecord.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where.forwardMessageAt).toBeNull()
    expect((where.forwardedAt as { lte: Date }).lte).toEqual(now)
    expect(chat.sendAutomatic).toHaveBeenCalledWith(expect.anything(), '+5547999990000', expect.stringContaining('vendedor João'), 'Mensagem automática (depois do repasse)', expect.anything())
    expect(JSON.stringify(updates)).toContain('"forwardMessageStatus":"ENVIADA"')
  })

  it('pergunta se o vendedor já chamou: 30 minutos depois, só com vendedor, campo próprio', async () => {
    const { svc, prisma, chat, updates } = setup()
    await svc.runTenant('t1', cleanContactCheck({ enabled: true, numberIds: ['n1'], since: '2026-10-01T00:00:00Z' }), now, 'check')
    const where = (prisma.serviceRecord.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where.contactCheckAt).toBeNull()
    expect(where.sellerId).toEqual({ not: null })
    expect((where.forwardedAt as { lte: Date }).lte).toEqual(new Date(now.getTime() - 30 * 60_000))
    expect(chat.sendAutomatic).toHaveBeenCalledWith(expect.anything(), '+5547999990000', expect.stringMatching(/Maria! O vendedor João já entrou em contato/), 'Mensagem automática (o vendedor já chamou?)', expect.anything())
    expect(JSON.stringify(updates)).toContain('"contactCheckStatus":"ENVIADA"')
    expect(JSON.stringify(updates)).not.toContain('forwardMessage')
  })
})
