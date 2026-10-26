import { describe, expect, it } from 'vitest'

process.env.EVOLUTION_WEBHOOK_SECRET ??= 'segredo-de-teste-123456'
const SECRET = process.env.EVOLUTION_WEBHOOK_SECRET

/** Banco de mentira com um número só: o suficiente para as regras de sessão do WhatsappService. */
function fakePrisma(start: Record<string, unknown>) {
  const row: Record<string, unknown> = { id: 'n1', tenantId: 't1', name: 'E-commerce', instanceName: 'crm-abc123', phone: '+5549999990000', deletedAt: null, statusReason: null, connectingAt: null, ...start }
  const matches = (where: Record<string, unknown> = {}) => Object.entries(where).every(([k, v]) => k === 'tenantId' || k === 'deletedAt' || row[k] === v)
  const wn = {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => (matches(where) ? { ...row } : null),
    findFirst: async () => ({ ...row }),
    findMany: async ({ where }: { where: { status?: string } }) => (!where.status || where.status === row.status ? [{ ...row }] : []),
    count: async () => 0,
    update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(row, data) && { ...row },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => (matches(where) ? (Object.assign(row, data), { count: 1 }) : { count: 0 }),
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
const state = (s: string) => json({ instance: { state: s } })
const user = { id: 'u1', tenantId: 't1', email: 'a@b.c' } as never
const ctx = {} as never
const settle = () => new Promise((r) => setTimeout(r, 10))
const qr = 'data:image/png;base64,AAAA'

describe('Sessão do WhatsApp que morre por dentro da Evolution (Connection Closed)', () => {
  it('a conferência periódica reinicia; continuando morta, o número aparece desconectado com o motivo', async () => {
    const { s, row, calls } = await service({ status: 'CONECTADO' }, (_m, p) =>
      p.startsWith('/instance/connectionState') ? state('open') : p.startsWith('/chat/whatsappNumbers') ? closed() : json({}),
    )
    await s.tick()
    expect(calls.slice(0, 4)).toEqual(['GET /instance/connectionState/crm-abc123', 'POST /chat/whatsappNumbers/crm-abc123', 'POST /instance/restart/crm-abc123', 'POST /chat/whatsappNumbers/crm-abc123'])
    expect(row.status).toBe('DESCONECTADO')
    expect(String(row.statusReason)).toMatch(/Connection Closed/)
  })

  it('se o reinício resolve, o número segue conectado', async () => {
    let probes = 0
    const { s, row } = await service({ status: 'CONECTADO' }, (_m, p) =>
      p.startsWith('/instance/connectionState') ? state('open') : p.startsWith('/chat/whatsappNumbers') ? (++probes === 1 ? closed() : json([{ exists: true, jid: '5549999990000@s.whatsapp.net' }])) : json({}),
    )
    await s.tick()
    expect(row.status).toBe('CONECTADO')
  })

  it('reconectando sozinha ("connecting"): só na segunda conferência seguida o número aparece desconectado, sem mexer na sessão', async () => {
    const { s, row, calls } = await service({ status: 'CONECTADO' }, (_m, p) => (p.startsWith('/instance/connectionState') ? state('connecting') : json({})))
    await s.tick()
    expect(row.status).toBe('CONECTADO')
    ;(s as unknown as { lastFullCheck: number }).lastFullCheck = 0
    await s.tick()
    expect(row.status).toBe('DESCONECTADO')
    expect(row.statusReason).toBe('Conexão perdida')
    expect(calls.some((c) => c.includes('/instance/restart') || c.includes('/instance/logout'))).toBe(false)
  })

  it('um envio que falha duas vezes marca o número como desconectado na hora', async () => {
    const { s, row } = await service({ status: 'CONECTADO' }, (_m, p) => (p.startsWith('/message/') ? closed(400) : json({})))
    await expect(s.client!.sendText('crm-abc123', '5547999990000', 'oi')).rejects.toThrow(/Conectar/)
    await settle()
    expect(row.status).toBe('DESCONECTADO')
  })

  it('envio durante a reconexão automática: espera voltar e manda, sem reiniciar a conexão', async () => {
    let sends = 0
    let polls = 0
    const { s, row, calls } = await service({ status: 'CONECTADO' }, (_m, p) => {
      if (p.startsWith('/message/')) return ++sends === 1 ? closed() : json({ key: { id: 'W1', remoteJid: '5547999990000@s.whatsapp.net' } })
      if (p.startsWith('/instance/connectionState')) return state(++polls < 3 ? 'connecting' : 'open')
      return json({})
    })
    const r = await s.client!.sendText('crm-abc123', '5547999990000', 'oi')
    expect(r.waId).toBe('W1')
    expect(calls.some((c) => c.includes('/instance/restart'))).toBe(false)
    expect(row.status).toBe('CONECTADO')
  })

  it('envio que falha com a Evolution dizendo "aberta": aí sim reinicia antes de tentar de novo', async () => {
    let sends = 0
    const { s, calls } = await service({ status: 'CONECTADO' }, (_m, p) => {
      if (p.startsWith('/message/')) return ++sends === 1 ? closed() : json({ key: { id: 'W2' } })
      if (p.startsWith('/instance/connectionState')) return state('open')
      return json({})
    })
    await s.client!.sendText('crm-abc123', '5547999990000', 'oi')
    expect(calls).toContain('POST /instance/restart/crm-abc123')
  })
})

describe('Desconectar e QR Code novo', () => {
  it('Desconectar troca a instância, apaga a antiga em segundo plano e não depende da Evolution aceitar o logout', async () => {
    const { s, row, calls } = await service({ status: 'CONECTADO' }, (_m, p) => (p.startsWith('/instance/logout') ? closed(500) : json({})))
    await s.disconnect(user, 'n1', ctx)
    await settle()
    expect(row.status).toBe('DESCONECTADO')
    expect(row.statusReason).toBe('Desconectado pelo CRM')
    expect(row.instanceName).not.toBe('crm-abc123')
    expect(row.instanceName).toMatch(/^crm-[a-z0-9x]{6,20}$/)
    expect(calls).toEqual(['DELETE /instance/logout/crm-abc123', 'DELETE /instance/delete/crm-abc123'])
  })

  it('depois do Desconectar, a sessão antiga reconectando sozinha não volta o número para "Conectado"', async () => {
    const { s, row } = await service({ status: 'CONECTADO' }, () => json({}))
    await s.disconnect(user, 'n1', ctx)
    // Evento da instância antiga: o número não é mais dela.
    await s.webhook(SECRET, { event: 'CONNECTION_UPDATE', instance: 'crm-abc123', data: { state: 'open' } })
    // Mesmo um "open" com o nome atual (corrida) não religa um número desconectado pela equipe.
    await s.webhook(SECRET, { event: 'CONNECTION_UPDATE', instance: row.instanceName, data: { state: 'open' } })
    expect(row.status).toBe('DESCONECTADO')
  })

  it('Conectar depois do Desconectar cria a instância nova e mostra o QR Code', async () => {
    const created = new Set<string>()
    const { s, row, calls } = await service({ status: 'DESCONECTADO', statusReason: 'Desconectado pelo CRM', instanceName: 'crm-novo12345' }, (m, p) => {
      const name = p.split('/').pop()!
      if (p.startsWith('/instance/create')) return created.add('crm-novo12345'), json({})
      if (p.startsWith('/instance/connect/')) return created.size ? json({ base64: qr, instance: { state: 'connecting' } }) : json({ status: 404 }, 404)
      return json({ name })
    })
    const r = await s.connect(user, 'n1', ctx)
    expect(r.qr).toBe(qr)
    expect(row.status).toBe('CONECTANDO')
    expect(calls).toContain('POST /instance/create')
    // Não pergunta à instância antiga se ela voltou: a equipe desconectou de propósito.
    expect(calls[0]).not.toMatch(/connectionState/)
  })

  it('caiu por motivo passageiro e a sessão voltou sozinha: Conectar religa sem QR Code', async () => {
    const { s, row, calls } = await service({ status: 'DESCONECTADO', statusReason: 'Conexão perdida' }, (_m, p) =>
      p.startsWith('/instance/connectionState') ? state('open') : p.startsWith('/chat/whatsappNumbers') ? json([{ exists: true }]) : json({}),
    )
    await s.connect(user, 'n1', ctx)
    expect(row.status).toBe('CONECTADO')
    expect(row.instanceName).toBe('crm-abc123')
    expect(calls).not.toContain('POST /instance/create')
  })

  it('sessão que não voltou: Conectar começa numa instância nova (QR Code novo, sem reaproveitar a credencial antiga)', async () => {
    const { s, row, calls } = await service({ status: 'DESCONECTADO', statusReason: 'A sessão caiu' }, (_m, p) => {
      if (p.startsWith('/instance/connectionState')) return state(p.endsWith('/crm-abc123') ? 'open' : 'connecting')
      if (p.startsWith('/chat/whatsappNumbers')) return closed()
      if (p.startsWith('/instance/connect/')) return json({ base64: qr, instance: { state: 'connecting' } })
      return json({})
    })
    const r = await s.connect(user, 'n1', ctx)
    await settle()
    expect(r.qr).toBe(qr)
    expect(row.instanceName).not.toBe('crm-abc123')
    expect(calls).toContain('DELETE /instance/delete/crm-abc123')
  })

  it('Novo QR Code funciona com o número aparecendo conectado', async () => {
    const { s, row } = await service({ status: 'CONECTADO' }, (_m, p) => (p.startsWith('/instance/connect/') ? json({ base64: qr, instance: { state: 'connecting' } }) : json({})))
    const r = await s.connect(user, 'n1', ctx, true)
    expect(r.qr).toBe(qr)
    expect(row.status).toBe('CONECTANDO')
    expect(row.instanceName).not.toBe('crm-abc123')
    // Sem pedir QR Code novo, um número conectado fica como está.
    const { s: s2, row: row2 } = await service({ status: 'CONECTADO' }, () => json({}))
    await s2.connect(user, 'n1', ctx)
    expect(row2.instanceName).toBe('crm-abc123')
  })

  it('QR Code de uma instância antiga não aparece na tela', async () => {
    const { s, row } = await service({ status: 'CONECTANDO' }, () => json({}))
    await s.webhook(SECRET, { event: 'QRCODE_UPDATED', instance: 'crm-abc123', data: { qrcode: { base64: qr } } })
    expect((await s.qrStatus(user, 'n1')).qr).toBe(qr)
    row.instanceName = 'crm-outra1234'
    expect((await s.qrStatus(user, 'n1')).qr).toBeNull()
  })

  it('a conferência apaga na Evolution as instâncias que nenhum número usa mais', async () => {
    const { s, calls } = await service({ status: 'DESCONECTADO' }, (_m, p) =>
      p.startsWith('/instance/fetchInstances')
        ? json([
            { name: 'crm-abc123', connectionStatus: 'open' },
            { name: 'crm-velha1234', connectionStatus: 'close' },
            { name: 'crm-reconecta1', connectionStatus: 'connecting' },
            { name: 'outro-sistema', connectionStatus: 'close' },
          ])
        : json({}),
    )
    await s.tick()
    expect(calls).toContain('DELETE /instance/delete/crm-velha1234')
    expect(calls.some((c) => c.endsWith('/crm-abc123') && c.startsWith('DELETE'))).toBe(false)
    expect(calls.some((c) => c.endsWith('/crm-reconecta1') || c.endsWith('/outro-sistema'))).toBe(false)
  })
})
