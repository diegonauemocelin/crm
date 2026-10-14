import { describe, expect, it } from 'vitest'
import { ChatService } from '../src/whatsapp/chat.service'

const svc = () => new ChatService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
const user = (permissions: Record<string, unknown>, isSystem = false) => ({ id: 'u', tenantId: 't', role: { isSystem }, permissions }) as never
const view = { view: true, create: false, edit: false, delete: false, export: false, scope: 'OWN' }

describe('monitorar conversas', () => {
  it('só com a permissão "Monitorar conversas" (ou administrador)', async () => {
    const s = svc()
    expect(s.canMonitor(user({ chat: view }))).toBe(false)
    expect(s.canMonitor(user({ monitoramento: view }))).toBe(true)
    expect(s.canMonitor(user({}, true))).toBe(true)
    await expect(s.conversations(user({ chat: view }), { monitor: true })).rejects.toThrow(/monitorar/)
    await expect(s.conversation(user({ chat: view }), '00000000-0000-0000-0000-000000000000', undefined, { ctx: {} as never })).rejects.toThrow(/monitorar/)
    await expect(s.media(user({ chat: view }), 'm', true)).rejects.toThrow(/monitorar/)
  })
})

describe('nota interna', () => {
  it('só com permissão; grava como interna, sem mudar a prévia nem o "aguardando resposta", e avisa quem atende', async () => {
    const created: Record<string, unknown>[] = []
    const updates: Record<string, unknown>[] = []
    const prisma = {
      whatsappConversation: { findFirst: async () => ({ id: 'c', name: 'Cliente', phone: '5549' }), update: async (a: { data: Record<string, unknown> }) => void updates.push(a.data) },
      whatsappMessage: { create: async (a: { data: Record<string, unknown> }) => (created.push(a.data), { id: 'm', ...a.data }) },
    }
    const s = new ChatService(prisma as never, {} as never, {} as never, {} as never, {} as never, { byUser: async () => undefined } as never)
    const gestor = { id: 'u', name: 'Gestora', tenantId: 't', role: { isSystem: false }, permissions: { monitoramento: { ...view, create: true } } } as never
    await expect(s.addNote(user({ monitoramento: view }), 'c', 'oi', {} as never)).rejects.toThrow(/nota interna/)
    await expect(s.addNote(gestor, 'c', '   ', {} as never)).rejects.toThrow(/Escreva/)
    const r = await s.addNote(gestor, 'c', 'Desconto de 5% liberado', {} as never)
    expect(r.internal).toBe(true)
    expect(created[0]).toMatchObject({ internal: true, type: 'nota', fromMe: true, sentByName: 'Gestora', text: 'Desconto de 5% liberado' })
    expect(String(created[0]!.waId)).toMatch(/^nota:/)
    expect(updates).toEqual([{ noteUnread: true }])
  })
})

describe('cada login vê só o seu chat', () => {
  const own = { view: true, create: true, edit: false, delete: false, export: false, scope: 'OWN' }
  const numbers = [
    { id: 'n1', userIds: ['u1'], sellerIds: [] },
    { id: 'n2', userIds: [], sellerIds: ['s2'] },
    { id: 'n3', userIds: ['u9'], sellerIds: [] },
  ]
  const prisma = (sellerOf: Record<string, string>) => ({
    seller: { findUnique: async (a: { where: { userId: string } }) => (sellerOf[a.where.userId] ? { id: sellerOf[a.where.userId] } : null) },
    whatsappNumber: {
      findMany: async (a: { where: { OR: ({ userIds?: { has: string } } | { sellerIds?: { has: string } })[] } }) =>
        numbers.filter((n) => a.where.OR.some((o) => ('userIds' in o && n.userIds.includes(o.userIds!.has)) || ('sellerIds' in o && n.sellerIds.includes(o.sellerIds!.has)))).map((n) => ({ id: n.id })),
    },
  })
  const who = (id: string) => ({ id, name: id, tenantId: 't', role: { isSystem: false }, permissions: { chat: own } }) as never

  it('login sem cadastro de vendedor (ex.: Pré-Vendas) vê só os números ligados a ele', async () => {
    const s = new ChatService(prisma({}) as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    expect(await s.where(who('u1'))).toEqual({ tenantId: 't', OR: [{ numberId: { in: ['n1'] } }] })
    expect(await s.where(who('u5'))).toEqual({ id: { in: [] } })
  })

  it('vendedor: números do vendedor e do login, mais as conversas passadas para ele', async () => {
    const s = new ChatService(prisma({ u1: 's2' }) as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    expect(await s.where(who('u1'))).toEqual({ tenantId: 't', OR: [{ numberId: { in: ['n1', 'n2'] } }, { assignedSellerId: 's2' }] })
  })
})

describe('nome do atendente nas mensagens', () => {
  it('usa o nome escolhido, limpo da formatação do WhatsApp; vazio volta ao primeiro nome', async () => {
    const { signed, cleanSignature } = await import('../src/whatsapp/envio')
    expect(signed('Olá!', 'Diego Naue Mocelin')).toBe('*Diego:*\nOlá!')
    expect(signed('Olá!', 'Diego Naue Mocelin', 'Diego - Vendas')).toBe('*Diego - Vendas:*\nOlá!')
    expect(signed('Olá!', 'Diego Naue', '  *Diego*_Vendas_:\n ')).toBe('*Diego Vendas:*\nOlá!')
    expect(signed('Olá!', 'Diego Naue', '   ')).toBe('*Diego:*\nOlá!')
    expect(cleanSignature('x'.repeat(80))).toHaveLength(40)
    expect(cleanSignature(null)).toBeNull()
  })
})
