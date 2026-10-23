import { describe, expect, it } from 'vitest'
import type { AuthUser } from '../src/common/types'
import { isMarketplaceChannel } from '../src/marketplaces/marketplaces.service'
import { DEFAULT_ML, delta, derive, mlView, parseAdGroupDay, parseCampaignDays, parseDisplayDays, previousPeriod, syncWindow, tokenError } from '../src/marketplaces/mercadolivre'
import { MercadoLivreService } from '../src/marketplaces/mercadolivre.service'

describe('Mercado Livre Ads: cálculos (mesmos do Usaparts BI)', () => {
  it('indicadores saem das somas do período', () => {
    const d = derive({ impressions: 10_000, clicks: 200, cost: 500, revenue: 2_000, directRevenue: 1_500, indirectRevenue: 500, units: 12, items: 10 })
    expect(d.ctr).toBe(2)
    expect(d.cpc).toBe(2.5)
    expect(d.cpm).toBe(50)
    expect(d.roas).toBe(4)
    expect(d.acos).toBe(25)
    expect(d.cvr).toBe(5)
  })

  it('sem base não inventa taxa', () => {
    const d = derive({ impressions: 0, clicks: 0, cost: 0, revenue: 0, directRevenue: 0, indirectRevenue: 0, units: 0, items: 0 })
    expect([d.ctr, d.cpc, d.roas, d.acos]).toEqual([null, null, null, null])
    expect(delta(10, 0)).toBeNull()
    expect(delta(150, 100)).toBe(50)
  })

  it('janela: 90 dias na primeira vez, depois 15, sempre até ontem', () => {
    expect(syncWindow(false, '2026-10-22')).toEqual({ from: '2026-07-24', to: '2026-10-21' })
    expect(syncWindow(true, '2026-10-22')).toEqual({ from: '2026-10-07', to: '2026-10-21' })
    expect(previousPeriod('2026-10-01', '2026-10-31')).toEqual({ from: '2026-08-31', to: '2026-09-30' })
  })
})

describe('Mercado Livre Ads: leitura das respostas da API', () => {
  it('campanha por dia (lista ou results)', () => {
    const row = { date: '2026-10-20T00:00:00', prints: 1000, clicks: 30, cost: 45.678, direct_amount: 300, indirect_amount: 50, total_amount: 350, units_quantity: 4, advertising_items_quantity: 3, organic_units_quantity: 2, organic_units_amount: 99.9 }
    const [a] = parseCampaignDays([row])
    expect(a).toMatchObject({ date: '2026-10-20', impressions: 1000, clicks: 30, cost: 45.68, revenue: 350, directRevenue: 300, indirectRevenue: 50, units: 4, items: 3, organicUnits: 2, organicRevenue: 99.9 })
    expect(parseCampaignDays({ results: [row, { prints: 1 }] })).toHaveLength(1)
    expect(parseCampaignDays(null)).toEqual([])
  })

  it('grupos de anúncios de um dia', () => {
    const list = parseAdGroupDay({ results: [{ ad_group_id: 77, metrics: { prints: 10, clicks: 2, cost: 1.5, total_amount: 20 } }, { metrics: {} }] }, '2026-10-20')
    expect(list).toEqual([expect.objectContaining({ adId: '77', date: '2026-10-20', impressions: 10, clicks: 2, cost: 1.5, revenue: 20 })])
  })

  it('Display: vendas pelo ponto de contato e pela data do evento', () => {
    const [d] = parseDisplayDays({ metrics: [{ date: '2026-10-19', prints: 500, clicks: 9, consumed_budget: 12.3, touch_point: { direct_amount: 80, units_quantity: 2, direct_item_quantity: 1, attribution_ppv: 40, attribution_add_to_cart: 5, attribution_checkout: 3 }, event_time: { direct_amount: 60 } }] })
    expect(d).toMatchObject({ impressions: 500, clicks: 9, cost: 12.3, revenue: 80, directRevenue: 80, units: 2, items: 1, pageViews: 40, addToCart: 5, checkouts: 3, eventRevenue: 60 })
  })

  it('autorização revogada pede Reconectar', () => {
    expect(tokenError(400, { error: 'invalid_grant' }).reconnect).toBe(true)
    expect(tokenError(500, { error: 'server' }).reconnect).toBe(false)
    // Client Secret errado: não pede Reconectar, pede o segredo certo.
    const bad = tokenError(400, { error: 'invalid_client', message: 'invalid client_id or client_secret' })
    expect(bad.reconnect).toBe(false)
    expect(bad.message).toContain('Client Secret')
  })

  it('tela nunca recebe tokens nem segredo', () => {
    const v = mlView({ ...DEFAULT_ML, clientSecretEnc: 'x', accessTokenEnc: 'y', refreshTokenEnc: 'z', status: 'CONECTADO' })
    expect(v).not.toHaveProperty('clientSecretEnc')
    expect(v).not.toHaveProperty('accessTokenEnc')
    expect(v).not.toHaveProperty('refreshTokenEnc')
    expect(v.hasSecret).toBe(true)
    expect(v.connected).toBe(true)
  })

  it('canais de venda que são marketplace', () => {
    for (const c of ['Mercado Livre', 'Shopee', 'Amazon', 'Magazine Luiza']) expect(isMarketplaceChannel(c), c).toBe(true)
    for (const c of ['Site', 'PDV', 'Manual', null]) expect(isMarketplaceChannel(c), String(c)).toBe(false)
  })
})

describe('Mercado Livre: autorização com PKCE', () => {
  const user = { id: 'u1', tenantId: 't1', name: 'Diego' } as AuthUser
  const make = () => {
    const store = new Map<string, unknown>()
    const settings = {
      get: async (_t: string, k: string, d: object) => ({ ...d, ...((store.get(k) as object) ?? {}) }),
      set: async (_t: string, k: string, v: object) => {
        store.set(k, v)
        return v
      },
    }
    const calls: string[] = []
    const svc = new MercadoLivreService({} as never, settings as never)
    svc.gapMs = 0
    svc.fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/oauth/token')) {
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('code_verifier')).toBeTruthy()
        return new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 21600, user_id: 123 }), { status: 200 })
      }
      if (url.endsWith('/users/me')) return new Response(JSON.stringify({ nickname: 'USAPARTS' }), { status: 200 })
      if (url.includes('product_id=PADS')) return new Response(JSON.stringify({ advertisers: [{ advertiser_id: 9, site_id: 'MLB', advertiser_name: 'Usaparts', account_name: 'x' }] }), { status: 200 })
      if (url.includes('product_id=DISPLAY')) return new Response(JSON.stringify({ message: 'No permissions found' }), { status: 404 })
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    return { svc, store, calls }
  }

  it('segredo recusado (invalid_client): mostra o Client ID usado e o final do segredo salvo, nunca ele inteiro', async () => {
    const { svc } = make()
    svc.fetcher = (async () => new Response(JSON.stringify({ error: 'invalid_client', message: 'invalid client_id or client_secret' }), { status: 400 })) as typeof fetch
    await svc.saveCredentials('t1', '6156699654672393', 'abcdefghijklmnopqrstuvwxyz12WXYZ')
    const { url } = await svc.startAuthorization(user)
    const err = await svc.completeAuthorization(user, 'CODE', new URL(url).searchParams.get('state')!).catch((e: Error) => e)
    expect((err as Error).message).toContain('não aceitou o Client Secret')
    expect((err as Error).message).toContain('Client ID 6156699654672393; Client Secret salvo com 32 caracteres, terminando em …WXYZ')
    expect((err as Error).message).not.toContain('abcdefghijklmnop')
  })

  it('sem credenciais não conecta', async () => {
    const { svc } = make()
    await expect(svc.startAuthorization(user)).rejects.toThrow(/Client ID/)
  })

  it('conecta, escolhe o único anunciante e marca Display como não habilitado', async () => {
    const { svc } = make()
    await svc.saveCredentials('t1', '1234567890', 'segredo')
    const { url } = await svc.startAuthorization(user)
    const u = new URL(url)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('redirect_uri')).toMatch(/\/marketplaces\/mercado-livre\/retorno$/)
    await expect(svc.completeAuthorization(user, 'CODE', 'outro-state')).rejects.toThrow(/expirada/)
    const r = await svc.completeAuthorization(user, 'CODE', u.searchParams.get('state')!)
    expect(r.nickname).toBe('USAPARTS')
    const c = await svc.config('t1')
    expect(c).toMatchObject({ status: 'CONECTADO', userId: '123', advertiserId: '9', siteId: 'MLB', displayStatus: 'NAO_HABILITADO' })
    expect(c.accessTokenEnc).not.toBe('AT')
    // o state é de uso único
    await expect(svc.completeAuthorization(user, 'CODE', u.searchParams.get('state')!)).rejects.toThrow()
  })
})
