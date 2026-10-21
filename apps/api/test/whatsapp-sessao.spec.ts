import { describe, expect, it } from 'vitest'

process.env.EVOLUTION_WEBHOOK_SECRET ??= 'segredo-de-teste-123456'

/** Banco de mentira com um número só: o suficiente para as regras de sessão do WhatsappService. */
function fakePrisma(start: Record<string, unknown>) {
  const row: Record<string, unknown> = { id: 'n1', tenantId: 't1', name: 'E-commerce', instanceName: 'crm-abc123', phone: '+5549999990000', deletedAt: null, statusReason: null, connectingAt: null, ...start }
  const wn = {
    findUnique: async () => ({ ...row }),
    findFirst: async () => ({ ...row }),
    findMany: async ({ where }: { where: { status?: string } }) => (where.status && where.status === row.status ? [{ ...row }] : []),
    count: async () => 0,
    update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(row, data) && { ...row },
  }
  return { row, prisma: { whatsappNumber: wn, $transaction: async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: async () => 0, whatsappNumber: wn }) } }
}

type Route = (method: string, path: string) => Response
async function service(start: Record<string, unknown>, route: Route) {
  const { WhatsappService } = await import('../src/whatsapp/whatsapp.service')
  const { EvolutionClient } = await import('../src/whatsapp/evolution')
  const { row, prisma } = fakePrisma(start)
  const calls: string[] = []
  const fetcher = (async (u: string, init: { method: string }) => {
    const path = String(u).replace('http://e', '')
    calls.push(`${init.method} ${path.split('?')[0]}`)
    return route(init.method, path)
  }) as unknown as typeof fetch
  const audit = { byUser: async () => undefined }
  const chat = {} as { clientOf?: unknown }
  const s = new WhatsappService(prisma as never, audit as never, chat as never)
  s.client = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, fetcher, 0)
  s.client.onSessionDead = (i) => void s.markDead(i)
  s.restartWaitMs = 0
  return { s, row, calls }
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
const closed = (status = 500) => json({ status, response: { message: ['Error: Connection Closed'] } }, status)
const user = { id: 'u1', tenantId: 't1', email: 'a@b.c' } as never
const ctx = {} as never

describe('Sessão do WhatsApp que morre por dentro da Evolution (Connection Closed)', () => {
  it('a conferência periódica reinicia; continuando morta, o número aparece desconectado com o motivo', async () => {
    const { s, row, calls } = await service({ status: 'CONECTADO' }, (_m, p) =>
      p.startsWith('/instance/connectionState') ? json({ instance: { state: 'open' } }) : p.startsWith('/chat/whatsappNumbers') ? closed() : json({}),
    )
    await s.tick()
    expect(calls).toEqual(['GET /instance/connectionState/crm-abc123', 'POST /chat/whatsappNumbers/crm-abc123', 'POST /instance/restart/crm-abc123', 'POST /chat/whatsappNumbers/crm-abc123'])
    expect(row.status).toBe('DESCONECTADO')
    expect(String(row.statusReason)).toMatch(/Connection Closed/)
  })

  it('se o reinício resolve, o número segue conectado', async () => {
    let probes = 0
    const { s, row } = await service({ status: 'CONECTADO' }, (_m, p) =>
      p.startsWith('/instance/connectionState') ? json({ instance: { state: 'open' } }) : p.startsWith('/chat/whatsappNumbers') ? (++probes === 1 ? closed() : json([{ exists: true, jid: '5549999990000@s.whatsapp.net' }])) : json({}),
    )
    await s.tick()
    expect(row.status).toBe('CONECTADO')
  })

  it('Desconectar funciona mesmo com a sessão morta (a Evolution devolve 500 no logout)', async () => {
    const { s, row, calls } = await service({ status: 'CONECTADO' }, (m, p) => (p.startsWith('/instance/logout') ? closed(500) : json({})))
    await s.disconnect(user, 'n1', ctx)
    expect(calls).toEqual(['DELETE /instance/logout/crm-abc123', 'DELETE /instance/delete/crm-abc123'])
    expect(row.status).toBe('DESCONECTADO')
  })

  it('Conectar com a sessão morta apaga a instância e devolve QR Code novo', async () => {
    let created = false
    const qr = 'data:image/png;base64,AAAA'
    const { s, calls } = await service({ status: 'DESCONECTADO' }, (m, p) => {
      if (p.startsWith('/instance/connect/')) return created ? json({ base64: qr, instance: { state: 'connecting' } }) : json({ instance: { state: 'open' } })
      if (p.startsWith('/chat/whatsappNumbers')) return closed()
      if (p.startsWith('/instance/create')) return (created = true), json({})
      return json({})
    })
    const r = await s.connect(user, 'n1', ctx)
    expect(calls).toContain('DELETE /instance/delete/crm-abc123')
    expect(calls).toContain('POST /instance/create')
    expect(r.qr).toBe(qr)
  })

  it('um envio que falha duas vezes marca o número como desconectado na hora', async () => {
    const { s, row } = await service({ status: 'CONECTADO' }, (_m, p) => (p.startsWith('/message/') ? closed(400) : json({})))
    await expect(s.client!.sendText('crm-abc123', '5547999990000', 'oi')).rejects.toThrow(/Conectar/)
    await new Promise((r) => setTimeout(r, 10))
    expect(row.status).toBe('DESCONECTADO')
  })
})
