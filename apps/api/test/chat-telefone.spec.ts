import { describe, expect, it } from 'vitest'
import { phoneFromText, splitLinks, splitPhones } from '../../web/src/lib/links'
import { Prisma } from '../src/generated/prisma/client'
import { ChatService } from '../src/whatsapp/chat.service'
import { EvolutionClient, parseNumberChecks } from '../src/whatsapp/evolution'
import { phoneLabel, whatsappOf } from '../src/whatsapp/mensagens'

const phones = (text: string) => splitPhones(text).filter((p) => p.phone).map((p) => [p.text, p.phone])

describe('telefone escrito na mensagem', () => {
  it('acha os formatos que o cliente digita, com DDD', () => {
    expect(phones('Me chama no (49) 98863-2548 por favor')).toEqual([['(49) 98863-2548', '+5549988632548']])
    expect(phones('Tel: 49988632548.')).toEqual([['49988632548', '+5549988632548']])
    expect(phones('+55 49 98863-2548')).toEqual([['+55 49 98863-2548', '+5549988632548']])
    expect(phones('5549988632548')).toEqual([['5549988632548', '+5549988632548']])
    expect(phones('049 98863-2548')).toEqual([['049 98863-2548', '+5549988632548']])
    expect(phones('(11)91234-5678')).toEqual([['(11)91234-5678', '+5511912345678']])
    expect(phones('+1 305 555 1234')).toEqual([['+1 305 555 1234', '+13055551234']])
    expect(phones('049 98863-2548 ou (049) 3664-0888')).toEqual([['049 98863-2548', '+5549988632548'], ['(049) 3664-0888', '+554936640888']])
    // Texto longo só de números não trava (busca limitada por telefone).
    const t0 = performance.now()
    phones(Array.from({ length: 3000 }, (_, i) => String(1000 + i)).join(' '))
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(phones('_(49) 98863-2548_')).toEqual([['(49) 98863-2548', '+5549988632548']])
    expect(phones('(49)  98863-2548')).toEqual([['(49)  98863-2548', '+5549988632548']])
  })

  it('número solto antes do telefone (item de lista, dia, loja) não gruda nele', () => {
    for (const t of ['1 - (49) 3664-0888', '1. (49) 3664-0888', '2) (49) 3664-0888', 'Loja 3 (49) 3664-0888', 'dia 5 (49) 3664-0888', 'Opções:\n1 - (49) 3664-0888']) {
      expect(phones(t)).toEqual([['(49) 3664-0888', '+554936640888']])
    }
    expect(phones('(49) 3664-0888 - (49) 98863-2548')).toEqual([
      ['(49) 3664-0888', '+554936640888'],
      ['(49) 98863-2548', '+5549988632548'],
    ])
    expect(phones('(49) 3664-0888/(49) 98863-2548')).toEqual([
      ['(49) 3664-0888', '+554936640888'],
      ['(49) 98863-2548', '+5549988632548'],
    ])
  })

  it('separa vários telefones seguidos', () => {
    expect(phones('Fixo (49) 3664-0888 e cel 49 9 8863-2548')).toEqual([
      ['(49) 3664-0888', '+554936640888'],
      ['49 9 8863-2548', '+5549988632548'],
    ])
    expect(phones('(49) 98863-2548 49 3664-0888')).toEqual([
      ['(49) 98863-2548', '+5549988632548'],
      ['49 3664-0888', '+554936640888'],
    ])
  })

  it('não confunde com CPF, CNPJ, datas, valores, códigos de peça nem número sem DDD', () => {
    for (const t of [
      'CPF 123.456.789-09', 'CPF 479.123.456-01', '119.876.543-21', '047.456.789-01', 'cpf: 11987654321', 'CNPJ 01.704.079/0001-00',
      'Pedido 4776503 de R$ 1.234,56 em 20/10/2026', 'código 1R-0750 e 320/07123', 'peça 6I-2501 qtd 2', '98863-2548', 'DDD inválido (20) 98863-2548',
      // Códigos de peça (Komatsu, Isuzu, Yanmar, Kubota) e códigos de 10 dígitos soltos.
      'Bomba Komatsu 6754-61-2110 PC200-8', '6754-71-6110', '195-78-21331', '175-27-22325', '419-22-12345', '8-98018858-0', '1-13240184-0', '119802-55800', '129900-35151', '16271-32430', 'ref 1234567890',
      // Linha digitável de boleto (Sicredi, Sicoob) e chave de NF-e em blocos de 4.
      'Linha digitavel: 74891.12345 12345.678901 12345.678901 1 23450000010000', '75691.31407 01130.051202',
      'Chave 4226 1001 7040 7900 0100 5500 1000 1234 5517 6036 3031', 'Chave 4226 0419 8765 4321 0001 5500 1000 0123 4510 1234 5678', 'Chave 4226 1001 7040 7900 0100 5500 1000 0479 1211 2345 6789',
    ]) {
      expect(phones(t)).toEqual([])
    }
    expect(phoneFromText('(49) 3863-2548 ')).toBe('+554938632548')
    expect(phoneFromText('49 18863-2548')).toBeNull()
  })

  it('telefone dentro de link continua sendo o link', () => {
    expect(splitLinks('https://wa.me/5549988632548')).toEqual([{ text: 'https://wa.me/5549988632548', href: 'https://wa.me/5549988632548' }])
  })
})

describe('conferir se o telefone tem WhatsApp', () => {
  it('lê a resposta da Evolution e acha a forma do celular que tem conta', () => {
    const checks = parseNumberChecks([
      { exists: false, jid: '5549988632548@s.whatsapp.net', number: '5549988632548' },
      { exists: true, jid: '554988632548@s.whatsapp.net', number: '554988632548' },
      'lixo',
    ])
    expect(checks).toHaveLength(2)
    expect(whatsappOf(checks)).toEqual({ exists: true, jid: '554988632548@s.whatsapp.net' })
    expect(whatsappOf(parseNumberChecks([{ exists: false, number: '5549988632548' }]))).toEqual({ exists: false, jid: null })
    expect(whatsappOf(parseNumberChecks({ error: 'x' }))).toBeNull()
    expect(phoneLabel('+5549988632548')).toBe('(49) 98863-2548')
  })

  it('pergunta no formato da Evolution', async () => {
    const calls: { url: string; body: unknown }[] = []
    const fake = (async (u: string, init: RequestInit) => (calls.push({ url: String(u), body: JSON.parse(String(init.body)) }), new Response('[{"exists":true,"jid":"5549988632548@s.whatsapp.net","number":"5549988632548"}]'))) as unknown as typeof fetch
    const c = new EvolutionClient({ url: 'http://e', apiKey: 'k' }, fake, 0)
    expect(await c.checkNumbers('loja', ['5549988632548', '554988632548'])).toEqual([{ exists: true, jid: '5549988632548@s.whatsapp.net', number: '5549988632548' }])
    expect(calls[0]).toEqual({ url: 'http://e/chat/whatsappNumbers/loja', body: { numbers: ['5549988632548', '554988632548'] } })
  })
})

describe('abrir conversa pelo telefone', () => {
  const admin = { id: 'u', name: 'Admin', tenantId: 't', unitId: null, role: { isSystem: true }, permissions: {} } as never
  const setup = (answer: unknown, status = 'CONECTADO', existing: { id: string } | null = null) => {
    const created: Record<string, unknown>[] = []
    const asked: string[][] = []
    const prisma = {
      whatsappNumber: {
        findMany: async () => [{ id: 'n1', name: 'Loja', phone: '+554936640888', status }],
        findUnique: async () => ({ splitAttendance: false, instanceName: 'loja', status }),
      },
      whatsappConversation: {
        findUnique: async (a: { where: { numberId_jid: { jid: string } } }) => (existing && a.where.numberId_jid.jid === '554988632548@s.whatsapp.net' ? { ...existing, leadId: null, assignedUserId: null, category: 'CLIENTE' } : null),
        findFirst: async () => null,
        create: async (a: { data: Record<string, unknown> }) => (created.push(a.data), { id: 'nova' }),
      },
    }
    const s = new ChatService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    s.clientOf = () => ({ checkNumbers: async (_i: string, numbers: string[]) => (asked.push(numbers), answer instanceof Error ? Promise.reject(answer) : answer) }) as never
    return { s, created, asked }
  }

  it('sem WhatsApp: não abre e explica', async () => {
    const { s, created, asked } = setup([{ exists: false, jid: null, number: '5549988632548' }])
    await expect(s.start(admin, { numberId: 'n1', phone: '+5549988632548' })).rejects.toThrow('O telefone (49) 98863-2548 não tem WhatsApp')
    expect(asked).toEqual([['5549988632548', '554988632548']])
    expect(created).toEqual([])
  })

  it('com WhatsApp: abre com o identificador que o WhatsApp usa (celular antigo sem o 9)', async () => {
    const { s, created } = setup([{ exists: true, jid: '554988632548@s.whatsapp.net', number: '554988632548' }])
    expect(await s.start(admin, { numberId: 'n1', phone: '+5549988632548' })).toEqual({ id: 'nova' })
    expect(created[0]).toMatchObject({ jid: '554988632548@s.whatsapp.net', phone: '+5549988632548', numberId: 'n1' })
  })

  it('já existe conversa com esse identificador: reaproveita', async () => {
    const { s, created } = setup([{ exists: true, jid: '554988632548@s.whatsapp.net', number: '554988632548' }], 'CONECTADO', { id: 'antiga' })
    expect(await s.start(admin, { numberId: 'n1', phone: '+5549988632548' })).toEqual({ id: 'antiga' })
    expect(created).toEqual([])
  })

  it('número desconectado ou serviço fora do ar: abre sem conferir', async () => {
    const off = setup([{ exists: false, jid: null, number: '5549988632548' }], 'DESCONECTADO')
    expect(await off.s.start(admin, { numberId: 'n1', phone: '(49) 98863-2548' })).toEqual({ id: 'nova' })
    expect(off.asked).toEqual([])
    const down = setup(new Error('O serviço de WhatsApp não respondeu.'))
    expect(await down.s.start(admin, { numberId: 'n1', phone: '(49) 98863-2548' })).toEqual({ id: 'nova' })
    expect(down.created[0]).toMatchObject({ jid: '5549988632548@s.whatsapp.net' })
  })

  it('aberta ao mesmo tempo por outro clique: usa a conversa que ficou, sem erro', async () => {
    const { s } = setup([{ exists: true, jid: '5511912345678@s.whatsapp.net', number: '5511912345678' }])
    const prisma = (s as unknown as { prisma: { whatsappConversation: Record<string, unknown> } }).prisma
    let created = false
    prisma.whatsappConversation.create = async () => {
      created = true
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' })
    }
    prisma.whatsappConversation.findUnique = async () => (created ? { id: 'ja-aberta', leadId: null, assignedUserId: null, category: 'CLIENTE' } : null)
    expect(await s.start(admin, { numberId: 'n1', phone: '(11) 91234-5678' })).toEqual({ id: 'ja-aberta' })
  })

  it('número estrangeiro com + não passa pela regra do DDD', async () => {
    const { s, created, asked } = setup([{ exists: true, jid: '19995551234@s.whatsapp.net', number: '19995551234' }])
    await s.start(admin, { numberId: 'n1', phone: '+1 999 555 1234' })
    expect(asked).toEqual([['19995551234']])
    expect(created[0]).toMatchObject({ phone: '+19995551234' })
  })
})
