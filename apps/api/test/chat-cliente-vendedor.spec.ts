import { describe, expect, it } from 'vitest'
import { ChatService } from '../src/whatsapp/chat.service'

// "Enviar cliente ao vendedor": o cartão do cliente (nome e telefone) vai ao WhatsApp do vendedor, pelo mesmo número.
const user = { id: 'ana', tenantId: 't1', name: 'Ana', permissions: {}, role: { isSystem: true } }
function make(o: { sellerPhone?: string | null; existing?: boolean; contact?: boolean } = {}) {
  const sent: { type: string; text: string }[] = []
  const updates: Record<string, unknown>[] = []
  const contacts: Record<string, unknown>[] = []
  const starts: Record<string, unknown>[] = []
  const prisma = {
    seller: { findFirst: async () => ({ name: 'Cleiton André', phone: o.sellerPhone === undefined ? '(49) 99999-1111' : o.sellerPhone }) },
    lead: { findUnique: async () => ({ customerCode: '10234' }) },
    whatsappContact: { count: async () => (o.contact ? 1 : 0), create: async ({ data }: { data: Record<string, unknown> }) => (contacts.push(data), data) },
    whatsappConversation: {
      findFirst: async () => (o.existing ? { id: 'c2' } : null),
      update: async ({ data }: { data: Record<string, unknown> }) => (updates.push(data), data),
    },
  }
  const svc = new ChatService(prisma as never, {} as never, {} as never, {} as never, {} as never, { byUser: async () => undefined } as never)
  const client = {
    sendText: async (_i: string, _t: string, text: string) => (sent.push({ type: 'texto', text }), { waId: 'w1', at: new Date() }),
    sendContact: async (_i: string, _t: string, card: { text: string }) => (sent.push({ type: 'contato', text: card.text }), { waId: 'w2', at: new Date() }),
  }
  Object.assign(svc, {
    load: async () => ({ id: 'c1', numberId: 'x', category: 'CLIENTE', phone: '+5544991382805', name: 'Antonio Maruchi', leadId: 'l1' }),
    start: async (_u: unknown, d: Record<string, unknown>) => (starts.push(d), { id: 'c2' }),
    sendContext: async () => ({ client, number: { instanceName: 'i' }, target: '5549999991111', conv: { jid: 'x' } }),
    recordSent: async () => ({}),
  })
  return { svc, sent, updates, contacts, starts }
}

describe('Enviar o contato do cliente ao vendedor', () => {
  it('manda quem é (com o código) e o cartão do cliente ao WhatsApp do vendedor, pelo mesmo número', async () => {
    const { svc, sent, starts, contacts, updates } = make()
    expect(await svc.sendClientToSeller(user as never, 'c1', 's1')).toEqual({ seller: 'Cleiton André', conversationId: 'c2' })
    expect(starts[0]).toEqual({ numberId: 'x', phone: '+5549999991111' })
    expect(sent[0]).toEqual({ type: 'texto', text: 'Contato do cliente Antonio Maruchi (código 10234), enviado pela pré-venda:' })
    expect(sent[1]!.type).toBe('contato')
    expect(sent[1]!.text).toContain('Antonio Maruchi')
    // vendedor entra como colega: a resposta dele não vira lead nem pré-venda
    expect(contacts[0]).toMatchObject({ category: 'COLEGA', name: 'Cleiton André' })
    expect(updates[0]).toMatchObject({ category: 'COLEGA' })
  })

  it('conversa com o vendedor que já existe: não mexe nela', async () => {
    const { svc, updates, contacts } = make({ existing: true, contact: true })
    await svc.sendClientToSeller(user as never, 'c1', 's1')
    expect(updates).toEqual([])
    expect(contacts).toEqual([])
  })

  it('vendedor sem telefone no cadastro: avisa e não envia', async () => {
    const { svc, sent } = make({ sellerPhone: null })
    await expect(svc.sendClientToSeller(user as never, 'c1', 's1')).rejects.toThrow(/não tem telefone/)
    expect(sent).toEqual([])
  })
})
