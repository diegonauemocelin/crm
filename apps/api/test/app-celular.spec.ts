import { describe, expect, it } from 'vitest'
import { PushService } from '../src/app-movel/push.service'
import { cleanLoginHours, outsideHoursMessage, withinLoginHours } from '../src/common/horario-acesso'

// 2026-10-26 é segunda-feira. Horário de Brasília = UTC-3.
const at = (iso: string) => new Date(iso)
const SEG_A_SEX = { enabled: true, days: [null, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '07:00', to: '19:00' }, { from: '08:00', to: '12:00' }] }

describe('Horário de acesso do perfil', () => {
  it('entra dentro do horário e não entra fora (horário de Brasília)', () => {
    expect(withinLoginHours(SEG_A_SEX, false, at('2026-10-26T10:00:00-03:00'))).toBe(true)
    expect(withinLoginHours(SEG_A_SEX, false, at('2026-10-26T06:59:00-03:00'))).toBe(false)
    expect(withinLoginHours(SEG_A_SEX, false, at('2026-10-26T19:00:00-03:00'))).toBe(false)
    // 23h em Brasília já é dia seguinte em UTC: vale o dia de Brasília.
    expect(withinLoginHours(SEG_A_SEX, false, at('2026-10-26T23:00:00-03:00'))).toBe(false)
    expect(withinLoginHours(SEG_A_SEX, false, at('2026-10-31T11:00:00-03:00'))).toBe(true)
    expect(withinLoginHours(SEG_A_SEX, false, at('2026-11-01T11:00:00-03:00'))).toBe(false)
  })

  it('administrador, horário desligado ou vazio: sempre entra', () => {
    expect(withinLoginHours(SEG_A_SEX, true, at('2026-11-01T03:00:00-03:00'))).toBe(true)
    expect(withinLoginHours({ ...SEG_A_SEX, enabled: false }, false, at('2026-11-01T03:00:00-03:00'))).toBe(true)
    expect(withinLoginHours(null, false, at('2026-11-01T03:00:00-03:00'))).toBe(true)
  })

  it('descarta horário inválido e explica o motivo', () => {
    expect(cleanLoginHours({ enabled: true, days: [{ from: '19:00', to: '07:00' }, { from: '7h', to: '9h' }] })?.days.slice(0, 2)).toEqual([null, null])
    expect(outsideHoursMessage(SEG_A_SEX, at('2026-10-26T20:00:00-03:00'))).toContain('das 07:00 às 19:00')
    expect(outsideHoursMessage(SEG_A_SEX, at('2026-11-01T10:00:00-03:00'))).toContain('domingo não tem acesso')
  })
})

describe('Notificações do app', () => {
  function make(subs: { id: string; endpoint: string }[], fail: Record<string, number> = {}) {
    const deleted: string[] = []
    const sent: string[] = []
    const store = new Map<string, unknown>()
    const prisma = {
      pushSubscription: {
        findMany: async () => subs.map((s) => ({ ...s, p256dh: 'p', auth: 'a' })),
        update: async () => ({}),
        deleteMany: async ({ where }: { where: { id: string } }) => (deleted.push(where.id), { count: 1 }),
      },
    }
    const settings = { get: async (_t: string, k: string, d: object) => ({ ...d, ...((store.get(k) as object) ?? {}) }), set: async (_t: string, k: string, v: object) => (store.set(k, v), v) }
    const svc = new PushService(prisma as never, settings as never)
    svc.sender = async (sub, payload) => {
      if (fail[sub.endpoint]) throw Object.assign(new Error('falhou'), { statusCode: fail[sub.endpoint] })
      sent.push(`${sub.endpoint}:${JSON.parse(payload).title}`)
      return {}
    }
    return { svc, deleted, sent, store }
  }

  it('manda para os aparelhos e apaga a inscrição que o celular cancelou (410)', async () => {
    const { svc, deleted, sent, store } = make([{ id: 's1', endpoint: 'e1' }, { id: 's2', endpoint: 'e2' }], { e2: 410 })
    const n = await svc.notify('t1', ['u1', 'u1'], { title: 'Oficina Pesada', body: 'Tem a bucha?', url: '/app/conversa/c1', tag: 'c1' })
    expect(n).toBe(1)
    expect(sent).toEqual(['e1:Oficina Pesada'])
    expect(deleted).toEqual(['s2'])
    // As chaves são criadas na primeira vez e a privada fica criptografada.
    const keys = store.get('web_push') as { publicKey: string; privateKeyEnc: string }
    expect(keys.publicKey.length).toBeGreaterThan(40)
    expect(keys.privateKeyEnc).not.toContain(keys.publicKey)
  })

  it('sem ninguém para avisar não faz nada', async () => {
    const { svc } = make([])
    expect(await svc.notify('t1', [], { title: 'x', body: 'y', url: '/app' })).toBe(0)
  })
})
