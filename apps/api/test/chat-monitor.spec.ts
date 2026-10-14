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
