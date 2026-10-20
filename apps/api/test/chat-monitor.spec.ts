import { describe, expect, it } from 'vitest'
import { ChatService } from '../src/whatsapp/chat.service'

// Sem equipe: ninguém tem a pessoa como gestora e não há setores.
const empty = { user: { findMany: async () => [] }, whatsappSector: { findMany: async () => [] } }
const svc = () => new ChatService(empty as never, {} as never, {} as never, {} as never, {} as never, {} as never)
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
    whatsappSector: { findMany: async () => [] },
    seller: { findUnique: async (a: { where: { userId: string } }) => (sellerOf[a.where.userId] ? { id: sellerOf[a.where.userId] } : null) },
    whatsappNumber: {
      findMany: async (a: { where: { OR: ({ userIds?: { has: string } } | { sellerIds?: { has: string } })[] } }) =>
        numbers.filter((n) => a.where.OR.some((o) => ('userIds' in o && n.userIds.includes(o.userIds!.has)) || ('sellerIds' in o && n.sellerIds.includes(o.sellerIds!.has)))).map((n) => ({ id: n.id })),
    },
  })
  const who = (id: string) => ({ id, name: id, tenantId: 't', role: { isSystem: false }, permissions: { chat: own } }) as never

  it('login sem cadastro de vendedor (ex.: Pré-Vendas) vê só os números ligados a ele', async () => {
    const s = new ChatService(prisma({}) as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    expect(await s.where(who('u1'))).toEqual({ tenantId: 't', OR: [{ numberId: { in: ['n1'] } }, { assignedUserId: 'u1' }] })
    // Sem número: só o que for passado para ele.
    expect(await s.where(who('u5'))).toEqual({ tenantId: 't', OR: [{ assignedUserId: 'u5' }] })
  })

  it('vendedor: números do vendedor e do login, mais as conversas passadas para ele', async () => {
    const s = new ChatService(prisma({ u1: 's2' }) as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    expect(await s.where(who('u1'))).toEqual({ tenantId: 't', OR: [{ numberId: { in: ['n1', 'n2'] } }, { assignedUserId: 'u1' }, { assignedSellerId: 's2' }] })
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

describe('vários atendentes no mesmo número', () => {
  type C = { numberId: string; assignedUserId: string | null; category: string; sectorId: string | null; helperUserIds?: string[] }
  // Avalia o filtro como o banco faria, numa conversa.
  const match = (c: C, w: Record<string, unknown>): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'OR') return (v as Record<string, unknown>[]).some((x) => match(c, x))
      const val = c[k as keyof C]
      if (v && typeof v === 'object' && 'not' in v) return val !== (v as { not: unknown }).not
      if (v && typeof v === 'object' && 'in' in v) return (v as { in: unknown[] }).in.includes(val)
      if (v && typeof v === 'object' && 'has' in v) return ((val as string[] | undefined) ?? []).includes((v as { has: string }).has)
      if (v && typeof v === 'object' && 'hasSome' in v) return ((val as string[] | undefined) ?? []).some((x) => (v as { hasSome: string[] }).hasSome.includes(x))
      return val === v
    })
  const sector = (id: string, userIds: string[], extra: Partial<import('../src/whatsapp/atendentes').Sector> = {}) => ({ id, name: id, numberIds: [], userIds, managerIds: [], visibility: 'PROPRIAS' as const, ...extra })
  const base = { numberId: 'n1', sectorId: null, category: 'CLIENTE' }

  it('setor: limpa o nome, as listas e a visibilidade', async () => {
    const { cleanSector } = await import('../src/whatsapp/atendentes')
    const u = '11111111-1111-1111-1111-111111111111'
    expect(cleanSector({ name: '  Pós   venda ', userIds: [u, u, 'x'], managerIds: null, visibility: 'qualquer' })).toEqual({ name: 'Pós venda', description: null, numberIds: [], userIds: [u], managerIds: [], visibility: 'PROPRIAS' })
    expect(cleanSector({ name: 'Vendas', visibility: 'SETOR' }).visibility).toBe('SETOR')
  })

  it('atendente vê as dele, a fila do setor dele e os contatos da empresa; não as de clientes de outro atendente', async () => {
    const { splitWhere } = await import('../src/whatsapp/atendentes')
    const where = splitWhere('u1', [{ id: 'n1' }], [sector('sv', ['u1']), sector('sf', ['u2']), sector('so', ['u1'], { numberIds: ['n9'] })])
    const sees = (c: C) => where.some((w) => match(c, w as Record<string, unknown>))
    expect(sees({ ...base, assignedUserId: 'u1' })).toBe(true)
    expect(sees({ ...base, assignedUserId: 'u2' })).toBe(false)
    expect(sees({ ...base, assignedUserId: null })).toBe(true)
    expect(sees({ ...base, assignedUserId: null, sectorId: 'sv' })).toBe(true)
    expect(sees({ ...base, assignedUserId: null, sectorId: 'sf' })).toBe(false)
    // Setor dele, mas que não atende neste número.
    expect(sees({ ...base, assignedUserId: null, sectorId: 'so' })).toBe(false)
    expect(sees({ ...base, assignedUserId: 'u2', category: 'COLEGA' })).toBe(true)
    expect(sees({ ...base, numberId: 'n2', assignedUserId: null })).toBe(false)
  })

  it('setor com visibilidade "todo o setor": vê as conversas dos colegas do setor, não as de outro setor', async () => {
    const { splitWhere } = await import('../src/whatsapp/atendentes')
    const where = splitWhere('u1', [{ id: 'n1' }], [sector('sv', ['u1', 'u2'], { visibility: 'SETOR' }), sector('sf', ['u3'])])
    const sees = (c: C) => where.some((w) => match(c, w as Record<string, unknown>))
    expect(sees({ ...base, assignedUserId: 'u2', sectorId: 'sv' })).toBe(true)
    expect(sees({ ...base, assignedUserId: 'u3', sectorId: 'sf' })).toBe(false)
  })

  it('gestor acompanha a equipe: quem o tem como gestor e os setores que gerencia', async () => {
    const { teamOf, teamWhere } = await import('../src/whatsapp/atendentes')
    const team = teamOf('g', [{ id: 'v1', managerIds: ['g'] }, { id: 'v2', managerIds: ['outro'] }], [sector('sv', ['v3', 'g'], { managerIds: ['g'] }), sector('sf', ['v4'])])
    expect(team).toEqual({ userIds: ['v1', 'v3'], sectorIds: ['sv'] })
    const w = teamWhere(team)!
    const sees = (c: C) => match(c, w as Record<string, unknown>)
    expect(sees({ ...base, assignedUserId: 'v1' })).toBe(true)
    expect(sees({ ...base, assignedUserId: 'v3' })).toBe(true)
    expect(sees({ ...base, assignedUserId: null, sectorId: 'sv' })).toBe(true)
    expect(sees({ ...base, assignedUserId: 'v2' })).toBe(false)
    expect(sees({ ...base, assignedUserId: 'v4', sectorId: 'sf' })).toBe(false)
    expect(teamWhere(teamOf('ninguem', [], []))).toBeNull()
  })

  it('gestor sem a permissão de monitoramento só monitora a equipe dele', async () => {
    const prisma = { user: { findMany: async () => [{ id: 'v1', managerIds: ['g'] }] }, whatsappSector: { findMany: async () => [] } }
    const s = new ChatService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const gestor = { id: 'g', tenantId: 't', role: { isSystem: false }, permissions: { chat: view } } as never
    expect(await s.monitorAccess(gestor)).toEqual({ scope: 'EQUIPE' })
    expect(await s.monitorScope(gestor)).toEqual({ tenantId: 't', OR: [{ assignedUserId: { in: ['v1'] } }, { helperUserIds: { hasSome: ['v1'] } }] })
    expect(await svc().monitorAccess(gestor)).toEqual({ scope: null })
  })
})

describe('cores do atraso de resposta', () => {
  it('verde, amarelo e vermelho pelo tempo desde a última mensagem do cliente', async () => {
    const { responseColor, cleanRules } = await import('../src/whatsapp/envio')
    const r = { yellowMinutes: 15, redMinutes: 60 }
    const now = Date.parse('2026-10-16T12:00:00Z')
    const ago = (m: number) => new Date(now - m * 60_000)
    expect(responseColor(false, ago(5), r, now)).toBe('verde')
    expect(responseColor(false, ago(20), r, now)).toBe('amarelo')
    expect(responseColor(false, ago(90), r, now)).toBe('vermelho')
    expect(responseColor(true, ago(90), r, now)).toBeNull()
    expect(responseColor(false, null, r, now)).toBeNull()
    expect(cleanRules({ yellowMinutes: 30, redMinutes: 20 })).toMatchObject({ yellowMinutes: 30, redMinutes: 60 })
    expect(cleanRules({})).toMatchObject({ yellowMinutes: 15, redMinutes: 60 })
  })
})

describe('aba Aguardando vendedor', () => {
  it('acha a conversa pela pré-venda, pelo lead ou pelo telefone (pré-venda aberta à mão, sem ligação com a conversa)', async () => {
    let where: { OR?: unknown[] } = {}
    const prisma = {
      serviceRecord: { findMany: async () => [{ id: 'r1', leadId: null, phone: '+5542999751979' }] },
      whatsappConversation: { findMany: async (a: { where: { OR: unknown[] } }) => ((where = a.where), [{ id: 'c1' }]) },
    }
    const s = new ChatService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    expect(await (s as unknown as { waitingSellerIds: (t: string) => Promise<string[]> }).waitingSellerIds('t')).toEqual(['c1'])
    expect(where.OR).toEqual([{ recordId: { in: ['r1'] } }, { phone: { in: ['+5542999751979', '+554299751979'] } }])
  })
})
