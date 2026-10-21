import { describe, expect, it } from 'vitest'

process.env.APP_ENCRYPTION_KEY ??= 'H4PJOukwpXWzE9TmKoZCou4pmz+pCtBGrGPehYJlFDQ='

describe('Busca de página e Instagram (Meta)', () => {
  it('junta as páginas do usuário do sistema e as do Gerenciador, com o Instagram ligado', async () => {
    const { encrypt } = await import('../src/common/crypto')
    const { MarketingInstagramService } = await import('../src/marketing/instagram.service')
    const integ = { metaAds: { enabled: true, adAccountIds: [], tokenEnc: encrypt('EAAB' + 'x'.repeat(40)), lastTest: null } }
    const settings = { get: async (_t: string, key: string, def: unknown) => (key === 'mkt_integracoes' ? integ : def) }
    const s = new MarketingInstagramService({} as never, settings as never, {} as never)
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    const fetcher = (async (u: string) => {
      const url = String(u)
      if (url.includes('/me/accounts')) return json({ data: [] })
      if (url.includes('/me/businesses')) return json({ data: [{ id: '90000001' }] })
      if (url.includes('/90000001/owned_pages')) return json({ data: [{ id: '100200300', name: 'Usaparts', instagram_business_account: { id: '17841400000001', username: 'usaparts.distribuidora' } }, { id: '100200301', name: 'Usaparts Loja' }] })
      if (url.includes('/client_pages')) return json({ error: { code: 200, message: 'no' } }, 400)
      return json({}, 404)
    }) as unknown as typeof fetch
    const r = await s.metaAssets({ tenantId: 't1' } as never, fetcher)
    expect(r.pages).toEqual([
      { id: '100200300', name: 'Usaparts', instagram: { id: '17841400000001', username: 'usaparts.distribuidora' } },
      { id: '100200301', name: 'Usaparts Loja', instagram: null },
    ])
    const d = await s.discover({ tenantId: 't1' } as never, fetcher)
    expect(d.accounts).toEqual([{ id: '17841400000001', username: 'usaparts.distribuidora', name: 'Usaparts' }])
  })
})
