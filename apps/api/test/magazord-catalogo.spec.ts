import { describe, expect, it } from 'vitest'
import { productsDue, shrinkError, spDay, spHour } from '../src/integracoes/magazord'

// Horários de Brasília escritos com o fuso (-03:00).
const at = (s: string) => new Date(`${s}-03:00`)

describe('catálogo da Magazord: 1 vez por dia', () => {
  it('dia e hora no horário de Brasília', () => {
    expect(spDay(at('2026-10-14T01:30:00'))).toBe('2026-10-14')
    expect(spHour(at('2026-10-14T01:30:00'))).toBe(1)
    expect(spDay(new Date('2026-10-14T02:00:00Z'))).toBe('2026-10-13')
  })

  it('nunca copiado: copia já', () => {
    expect(productsDue(at('2026-10-14T15:00:00'), {}, 3)).toBe(true)
  })

  it('só depois da hora escolhida e uma vez por dia', () => {
    const st = { productsSyncedAt: at('2026-10-13T03:05:00').toISOString() }
    expect(productsDue(at('2026-10-14T02:50:00'), st, 3)).toBe(false)
    expect(productsDue(at('2026-10-14T03:00:00'), st, 3)).toBe(true)
    expect(productsDue(at('2026-10-14T03:10:00'), { productsSyncedAt: at('2026-10-14T03:02:00').toISOString() }, 3)).toBe(false)
    // Servidor desligado de madrugada: copia assim que voltar no mesmo dia.
    expect(productsDue(at('2026-10-14T10:00:00'), st, 3)).toBe(true)
  })

  it('falhou: tenta de novo depois de 1 hora, até 3 vezes no dia', () => {
    const base = { productsSyncedAt: at('2026-10-13T03:05:00').toISOString(), productsAttemptDay: '2026-10-14' }
    expect(productsDue(at('2026-10-14T03:40:00'), { ...base, productsAttempts: 1, productsAttemptAt: at('2026-10-14T03:00:00').toISOString() }, 3)).toBe(false)
    expect(productsDue(at('2026-10-14T04:01:00'), { ...base, productsAttempts: 1, productsAttemptAt: at('2026-10-14T03:00:00').toISOString() }, 3)).toBe(true)
    expect(productsDue(at('2026-10-14T09:00:00'), { ...base, productsAttempts: 3, productsAttemptAt: at('2026-10-14T05:00:00').toISOString() }, 3)).toBe(false)
    // No dia seguinte, recomeça a contagem.
    expect(productsDue(at('2026-10-15T03:00:00'), { ...base, productsAttempts: 3, productsAttemptAt: at('2026-10-14T05:00:00').toISOString() }, 3)).toBe(true)
  })

  it('não desativa o catálogo quando a loja devolve lista vazia ou bem menor', () => {
    expect(shrinkError(0, 800, false)).toMatch(/nenhum produto/)
    expect(shrinkError(0, 800, true)).toMatch(/nenhum produto/)
    expect(shrinkError(0, 0, false)).toBeNull()
    expect(shrinkError(300, 800, false)).toMatch(/só 300/)
    expect(shrinkError(300, 800, true)).toBeNull()
    expect(shrinkError(700, 800, false)).toBeNull()
    expect(shrinkError(10, 30, false)).toBeNull()
  })
})

describe('catálogo da Magazord: cópia e aviso de falha', () => {
  async function setup(pages: () => unknown) {
    const { MagazordService, DEFAULT_MAGAZORD } = await import('../src/integracoes/magazord.service')
    const store = new Map<string, Record<string, unknown>>()
    const settings = {
      get: async (_t: string, k: string, d: object) => ({ ...d, ...(store.get(k) ?? {}) }),
      set: async (_t: string, k: string, v: Record<string, unknown>) => void store.set(k, v),
      branding: async () => ({ appName: 'Usaparts' }),
    }
    const calls = { upserts: 0, deactivated: 0, mails: [] as string[] }
    const prisma = {
      storeProduct: {
        count: async () => 800,
        upsert: async () => void calls.upserts++,
        updateMany: async () => void calls.deactivated++,
      },
      ecommerceCart: { findMany: async () => [] },
      user: { findMany: async () => [{ email: 'admin@exemplo.com', name: 'Admin' }] },
    }
    const mail = { send: async (_t: string, m: { to: string }) => void calls.mails.push(m.to), simpleTemplate: () => '<p></p>' }
    const svc = new MagazordService(prisma as never, settings as never, {} as never, {} as never, {} as never, {} as never, mail as never)
    ;(svc as unknown as { get: () => Promise<unknown> }).get = async () => pages()
    const s = { ...DEFAULT_MAGAZORD, siteUrl: 'https://www.usaparts.com.br', imageBaseUrl: 'https://img.exemplo.com' }
    const run = (force = false) => (svc as unknown as { syncProducts: (t: string, s: unknown, f: boolean) => Promise<void> }).syncProducts('t', s, force)
    return { run, calls, state: () => store.get('magazord_state') ?? {}, store }
  }

  it('lista vazia: não desativa nada, guarda o erro e, na 3ª falha do dia, avisa os administradores uma vez', async () => {
    const { run, calls, state, store } = await setup(() => ({ items: [], has_more: false }))
    await run()
    expect(calls.deactivated).toBe(0)
    expect(String(state().productsError)).toMatch(/nenhum produto/)
    expect(calls.mails).toHaveLength(0)
    // Simula as próximas tentativas do dia (sem esperar 1 hora).
    for (let i = 0; i < 2; i++) {
      store.set('magazord_state', { ...state(), productsAttemptAt: new Date(Date.now() - 2 * 3_600_000).toISOString() })
      await run()
    }
    expect(state().productsAttempts).toBe(3)
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.mails).toEqual(['admin@exemplo.com'])
    store.set('magazord_state', { ...state(), productsAttemptAt: new Date(Date.now() - 2 * 3_600_000).toISOString() })
    await run()
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.mails).toHaveLength(1)
  })

  it('cópia normal: grava os produtos, desativa os que saíram e zera as tentativas', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ derivacao_id: i + 1, codigo: `P${i}`, nome: `Produto ${i}`, link: `/produto-${i}`, valor: '10,00', ativo: true }))
    const { run, calls, state } = await setup(() => ({ items: items.slice(0, 100), has_more: false }))
    // 100 produtos de 800 ativos: queda grande, a cópia automática não desativa.
    await run()
    expect(calls.upserts).toBe(100)
    expect(calls.deactivated).toBe(0)
    expect(String(state().productsError)).toMatch(/só 100/)
    // "Atualizar agora" aceita a queda.
    await run(true)
    expect(calls.deactivated).toBe(1)
    expect(state().productsError).toBeNull()
    expect(state().productsAttempts).toBe(0)
  })
})
