import { describe, expect, it } from 'vitest'
import { ChatService } from '../src/whatsapp/chat.service'
import { cleanRetention, cleanRules, DEFAULT_RETENTION, retentionCutoffs } from '../src/whatsapp/envio'

describe('WhatsApp: prazo de guarda (LGPD)', () => {
  it('padrão: cliente 5 anos, demais contatos 2 anos, mídia 12 meses; limites conferidos', () => {
    expect(cleanRules({}).retention).toEqual(DEFAULT_RETENTION)
    expect(DEFAULT_RETENTION).toEqual({ enabled: true, clientMonths: 60, otherMonths: 24, mediaMonths: 12 })
    expect(cleanRetention({ enabled: false, clientMonths: 2, otherMonths: 500, mediaMonths: 0 })).toEqual({ enabled: false, clientMonths: 60, otherMonths: 24, mediaMonths: 12 })
    // A mídia nunca fica mais tempo que as mensagens.
    expect(cleanRetention({ clientMonths: 24, otherMonths: 6, mediaMonths: 36 }).mediaMonths).toBe(6)
  })

  it('datas de corte em meses de 30 dias', () => {
    const now = Date.parse('2026-10-15T12:00:00Z')
    const c = retentionCutoffs({ enabled: true, clientMonths: 60, otherMonths: 24, mediaMonths: 12 }, now)
    expect(c.media.toISOString()).toBe(new Date(now - 360 * 86_400_000).toISOString())
    expect(c.other.toISOString()).toBe(new Date(now - 720 * 86_400_000).toISOString())
    expect(c.client.toISOString()).toBe(new Date(now - 1800 * 86_400_000).toISOString())
  })

  it('apaga primeiro os arquivos, depois as mensagens e as conversas vazias, e registra na auditoria', async () => {
    const calls: string[] = []
    const removed: string[] = []
    const audits: { action: string; data: Record<string, number | object> }[] = []
    let fileBatch = [
      { id: 'm1', fileId: 'f1' },
      { id: 'm2', fileId: 'f2' },
    ]
    const prisma = {
      whatsappNumber: { findMany: async () => [{ tenantId: 't1' }] },
      whatsappMessage: {
        findMany: async () => {
          const b = fileBatch
          fileBatch = []
          return b
        },
        updateMany: async ({ data }: { data: { mediaStatus: string } }) => void calls.push(`midia:${data.mediaStatus}`),
      },
      $executeRaw: async () => (calls.push('mensagens'), 7),
      whatsappConversation: { deleteMany: async () => (calls.push('conversas'), { count: 2 }) },
    }
    const files = { remove: async (id: string) => void removed.push(id) }
    const settings = { get: async (_t: string, _k: string, d: object) => d }
    const audit = { log: async (e: { action: string; data: Record<string, number | object> }) => void audits.push(e) }
    const s = new ChatService(prisma as never, files as never, {} as never, {} as never, settings as never, audit as never)
    const r = await s.applyRetention(Date.parse('2026-10-15T12:00:00Z'))
    expect(removed).toEqual(['f1', 'f2'])
    expect(calls).toEqual(['midia:APAGADA', 'mensagens', 'conversas'])
    expect(r).toEqual([{ tenantId: 't1', files: 2, messages: 7, conversations: 2 }])
    expect(audits[0]).toMatchObject({ action: 'whatsapp.prazo_de_guarda', data: { arquivos: 2, mensagens: 7, conversas: 2 } })
  })

  it('desligado: não apaga nada', async () => {
    let touched = false
    const prisma = { whatsappNumber: { findMany: async () => [{ tenantId: 't1' }] }, whatsappMessage: { findMany: async () => ((touched = true), []) } }
    const settings = { get: async () => ({ retention: { enabled: false } }) }
    const s = new ChatService(prisma as never, {} as never, {} as never, {} as never, settings as never, {} as never)
    expect(await s.applyRetention()).toEqual([])
    expect(touched).toBe(false)
  })
})
