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
