import { describe, expect, it } from 'vitest'
import { ChatService } from '../src/whatsapp/chat.service'

// Número X: Ana (login no número), Bruno (vendedor do número) e Carla (setor que escolheu o número X).
// Diego está só no número Y e num setor de outro número: não pode receber nem participar de conversa do X.
const user = { id: 'ana', tenantId: 't1', name: 'Ana', permissions: {}, role: { isSystem: true } }
function make(conv: Record<string, unknown> = {}) {
  const updates: Record<string, unknown>[] = []
  const prisma = {
    whatsappNumber: { findUnique: async () => ({ userIds: ['ana'], sellerIds: ['s-bruno'] }) },
    seller: { findMany: async () => [{ userId: 'bruno' }] },
    user: {
      count: async () => 1,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, name: id })),
    },
    whatsappConversation: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data)
        return { id: 'c1', ...data }
      },
    },
  }
  const svc = new ChatService(prisma as never, {} as never, {} as never, {} as never, {} as never, { byUser: async () => undefined } as never)
  Object.assign(svc, {
    load: async () => ({ id: 'c1', numberId: 'x', assignedUserId: 'ana', helperUserIds: [], ...conv }),
    sectors: async () => [
      { id: 'sx', name: 'Vendas X', numberIds: ['x'], userIds: ['carla'], managerIds: [], visibility: 'PROPRIAS' },
      { id: 'sy', name: 'Vendas Y', numberIds: ['y'], userIds: ['diego'], managerIds: [], visibility: 'PROPRIAS' },
    ],
  })
  return { svc, updates }
}

describe('Transferir e adicionar participantes: só no mesmo número', () => {
  it('transfere para quem está no número (login, vendedor ou setor do número)', async () => {
    for (const to of ['bruno', 'carla']) {
      const { svc, updates } = make()
      await svc.assign(user as never, 'c1', { userId: to }, {} as never)
      expect(updates[0]?.assignedUserId).toBe(to)
    }
  })

  it('não transfere para quem atende em outro número', async () => {
    const { svc, updates } = make()
    await expect(svc.assign(user as never, 'c1', { userId: 'diego' }, {} as never)).rejects.toThrow(/mesmo número/)
    expect(updates).toEqual([])
  })

  it('setor de outro número não aparece para transferir', async () => {
    const { svc } = make()
    await expect(svc.assign(user as never, 'c1', { userId: null, sectorId: 'sy' }, {} as never)).rejects.toThrow(/Setor inválido/)
  })

  it('participantes: só do mesmo número', async () => {
    const { svc, updates } = make()
    await svc.setHelpers(user as never, 'c1', ['bruno', 'carla'], {} as never)
    expect(updates[0]?.helperUserIds).toEqual(['bruno', 'carla'])
    await expect(make().svc.setHelpers(user as never, 'c1', ['carla', 'diego'], {} as never)).rejects.toThrow(/mesmo número/)
  })
})
