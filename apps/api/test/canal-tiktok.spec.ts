import { describe, expect, it } from 'vitest'
import { tiktok, tiktokSign } from '../src/marketplaces/canais/tiktok'
import { type ChannelApp, ChannelError, type ChannelTokens, type Fetcher } from '../src/marketplaces/canais/tipos'

const app: ChannelApp = { appId: 'appkey1', appSecret: 'segredo', extra: { serviceId: '7123456789' } }
const NOW = 1_763_380_800_000 // 17/11/2025 12:00 UTC

interface Call {
  url: URL
  method: string
  headers: Record<string, string>
  body: string | undefined
}

function fake(responses: { status?: number; json: unknown }[]) {
  const calls: Call[] = []
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    })
    const r = responses.shift()
    if (!r) throw new Error('chamada inesperada')
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as Fetcher
  return { f, calls }
}

const tokens: ChannelTokens = {
  accessToken: 'TTP_acesso',
  refreshToken: 'TTP_refresh',
  expiresAt: NOW + 3600_000,
  refreshExpiresAt: null,
  shopId: 'ROW_cifra',
  shopName: 'Loja BR',
  extra: { shopId: '7000', region: 'BR', sellerType: 'LOCAL' },
}

/** O mesmo cálculo da assinatura, refeito a partir da URL e do corpo realmente enviados. */
function expectSigned(c: Call) {
  const q: Record<string, string> = {}
  c.url.searchParams.forEach((v, k) => (q[k] = v))
  expect(q.sign).toBe(tiktokSign(app.appSecret, c.url.pathname, q, c.body ?? ''))
  expect(q.app_key).toBe('appkey1')
  expect(q.timestamp).toBe(String(NOW / 1000))
  expect(q.access_token).toBeUndefined()
  expect(c.headers['x-tts-access-token']).toBe('TTP_acesso')
}

describe('TikTok Shop: assinatura', () => {
  it('confere com o exemplo do guia "Sign your API request" (Get Authorized Shops)', () => {
    const sign = tiktokSign('e59af819cc', '/authorization/202309/shops', { app_key: '29a39d', timestamp: '1623812664' })
    expect(sign).toBe('b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8')
  })

  it('ignora sign e access_token e põe o corpo antes do segredo final', () => {
    const a = tiktokSign('s', '/p', { b: '2', a: '1', sign: 'x', access_token: 'y' }, '{"k":1}')
    const b = tiktokSign('s', '/p', { a: '1', b: '2' }, '{"k":1}')
    expect(a).toBe(b)
    expect(a).not.toBe(tiktokSign('s', '/p', { a: '1', b: '2' }))
  })
})

describe('TikTok Shop: autorização e tokens', () => {
  it('link de autorização com service_id e state', () => {
    const url = new URL(tiktok.authUrl(app, 'https://crm.exemplo/retorno', 'abc123'))
    expect(url.origin + url.pathname).toBe('https://services.tiktokshop.com/open/authorize')
    expect(url.searchParams.get('service_id')).toBe('7123456789')
    expect(url.searchParams.get('state')).toBe('abc123')
  })

  it('sem Service ID não gera o link', () => {
    expect(() => tiktok.authUrl({ ...app, extra: {} }, 'x', 's')).toThrow(ChannelError)
  })

  it('troca o código pelos tokens e pega a loja (shop_cipher) em Get Authorized Shops', async () => {
    const { f, calls } = fake([
      {
        json: {
          code: 0,
          message: 'success',
          request_id: 'r1',
          data: {
            access_token: 'TTP_acesso',
            access_token_expire_in: 1_763_985_600,
            refresh_token: 'TTP_refresh',
            refresh_token_expire_in: 1_795_000_000,
            open_id: 'open1',
            seller_name: 'Vendedor',
            seller_base_region: 'BR',
            user_type: 0,
          },
        },
      },
      {
        json: {
          code: 0,
          message: 'Success',
          request_id: 'r2',
          data: { shops: [{ id: '7000', name: 'Loja BR', region: 'BR', seller_type: 'LOCAL', cipher: 'ROW_cifra', code: 'BRLCODE' }] },
        },
      },
    ])
    const t = await tiktok.exchangeCode(app, { code: 'TTP_codigo', state: 'abc' }, 'https://crm.exemplo/retorno', f, NOW)

    const tok = calls[0]!
    expect(tok.url.origin + tok.url.pathname).toBe('https://auth.tiktok-shops.com/api/v2/token/get')
    expect(tok.method).toBe('GET')
    expect(Object.fromEntries(tok.url.searchParams)).toEqual({
      app_key: 'appkey1',
      app_secret: 'segredo',
      auth_code: 'TTP_codigo',
      grant_type: 'authorized_code',
    })

    const shops = calls[1]!
    expect(shops.url.origin + shops.url.pathname).toBe('https://open-api.tiktokglobalshop.com/authorization/202309/shops')
    expect(shops.method).toBe('GET')
    expect(shops.body).toBeUndefined()
    expectSigned(shops)

    expect(t).toEqual({
      accessToken: 'TTP_acesso',
      refreshToken: 'TTP_refresh',
      expiresAt: 1_763_985_600_000,
      refreshExpiresAt: 1_795_000_000_000,
      shopId: 'ROW_cifra',
      shopName: 'Loja BR',
      extra: { shopId: '7000', region: 'BR', sellerType: 'LOCAL', shopCode: 'BRLCODE', openId: 'open1' },
    })
  })

  it('lojista recusou (code=null&error=auth_denied)', async () => {
    const { f, calls } = fake([])
    await expect(tiktok.exchangeCode(app, { code: 'null', error: 'auth_denied' }, 'x', f, NOW)).rejects.toThrow(/não foi concedida/)
    expect(calls).toHaveLength(0)
  })

  it('código vencido: erro da plataforma em português', async () => {
    const { f } = fake([{ json: { code: 36004004, message: 'Invalid auth code.', request_id: 'r' } }])
    const err = await tiktok.exchangeCode(app, { code: 'velho' }, 'x', f, NOW).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChannelError)
    expect((err as Error).message).toBe('TikTok Shop recusou (troca do código): Invalid auth code. (código 36004004)')
  })

  it('renova com o refresh token e mantém a loja', async () => {
    const { f, calls } = fake([
      {
        json: {
          code: 0,
          message: 'success',
          data: { access_token: 'TTP_novo', access_token_expire_in: 1_764_000_000, refresh_token: 'TTP_refresh2', refresh_token_expire_in: 1_796_000_000 },
        },
      },
    ])
    const t = await tiktok.refresh(app, tokens, f, NOW)
    const c = calls[0]!
    expect(c.url.origin + c.url.pathname).toBe('https://auth.tiktok-shops.com/api/v2/token/refresh')
    expect(Object.fromEntries(c.url.searchParams)).toEqual({
      app_key: 'appkey1',
      app_secret: 'segredo',
      refresh_token: 'TTP_refresh',
      grant_type: 'refresh_token',
    })
    expect(t).toEqual({
      ...tokens,
      accessToken: 'TTP_novo',
      refreshToken: 'TTP_refresh2',
      expiresAt: 1_764_000_000_000,
      refreshExpiresAt: 1_796_000_000_000,
    })
  })
})

describe('TikTok Shop: anúncios', () => {
  const page1 = {
    code: 0,
    message: 'Success',
    request_id: 'r',
    data: {
      total_count: 3,
      next_page_token: 'WzE3ODY0Njk5NDg1MTgsIjE3MzY5OTA2MTM0NTI5ODE4MTciXQ==',
      products: [
        {
          id: '1729592969712207008',
          title: 'Filtro de óleo',
          status: 'ACTIVATE',
          skus: [
            {
              id: 'sku1',
              seller_sku: 'FO-123',
              price: { currency: 'BRL', tax_exclusive_price: '89.90', sale_price: '99.90' },
              inventory: [
                { warehouse_id: 'w1', quantity: 5 },
                { warehouse_id: 'w2', quantity: 3 },
              ],
            },
            { id: 'sku2', seller_sku: '', price: { currency: 'BRL', tax_exclusive_price: '120.00' }, inventory: [] },
          ],
        },
        { id: 'p2', title: 'Rolete', status: 'ACTIVATE', skus: [{ id: 'sku3', seller_sku: 'RL-1', price: { currency: 'BRL', sale_price: '300' } }] },
      ],
    },
  }

  it('busca os ativos (POST assinado com o corpo) e abre uma linha por SKU', async () => {
    const { f, calls } = fake([{ json: page1 }])
    const page = await tiktok.listListings(app, tokens, null, f, NOW)
    const c = calls[0]!
    expect(c.method).toBe('POST')
    expect(c.url.origin + c.url.pathname).toBe('https://open-api.tiktokglobalshop.com/product/202502/products/search')
    expect(c.url.searchParams.get('shop_cipher')).toBe('ROW_cifra')
    expect(c.url.searchParams.get('page_size')).toBe('100')
    expect(c.url.searchParams.has('page_token')).toBe(false)
    expect(c.body).toBe('{"status":"ACTIVATE"}')
    expect(c.headers['content-type']).toBe('application/json')
    expectSigned(c)

    expect(page.next).toBe('WzE3ODY0Njk5NDg1MTgsIjE3MzY5OTA2MTM0NTI5ODE4MTciXQ==')
    expect(page.items).toEqual([
      { id: '1729592969712207008', variationId: 'sku1', sku: 'FO-123', title: 'Filtro de óleo', price: 89.9, stock: 8, status: 'ACTIVATE', url: null, image: null },
      { id: '1729592969712207008', variationId: 'sku2', sku: null, title: 'Filtro de óleo', price: 120, stock: null, status: 'ACTIVATE', url: null, image: null },
      { id: 'p2', variationId: 'sku3', sku: 'RL-1', title: 'Rolete', price: 300, stock: null, status: 'ACTIVATE', url: null, image: null },
    ])
  })

  it('próxima página com page_token (assinado sem codificar) e fim sem next_page_token', async () => {
    const { f, calls } = fake([{ json: { code: 0, message: 'Success', data: { total_count: 3, products: [] } } }])
    const page = await tiktok.listListings(app, tokens, 'abc==', f, NOW)
    const c = calls[0]!
    expect(c.url.searchParams.get('page_token')).toBe('abc==')
    expectSigned(c)
    expect(page).toEqual({ items: [], next: null })
  })

  it('vendedor global (CROSS_BORDER) usa sale_price', async () => {
    const { f } = fake([{ json: page1 }])
    const page = await tiktok.listListings(app, { ...tokens, extra: { ...tokens.extra, sellerType: 'CROSS_BORDER' } }, null, f, NOW)
    expect(page.items[0]!.price).toBe(99.9)
  })

  it('token vencido vira ChannelError com a mensagem e o HTTP', async () => {
    const { f } = fake([{ status: 401, json: { code: 105002, message: 'Expired credentials', request_id: 'r' } }])
    const err = await tiktok.listListings(app, tokens, null, f, NOW).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChannelError)
    expect((err as ChannelError).status).toBe(401)
    expect((err as Error).message).toBe('TikTok Shop recusou (lista de produtos): Expired credentials (código 105002)')
  })
})

describe('TikTok Shop: preço', () => {
  it('atualiza o preço do SKU (amount + currency BRL)', async () => {
    const { f, calls } = fake([{ json: { code: 0, data: {}, message: 'Success', request_id: 'r' } }])
    await tiktok.updatePrice(app, tokens, { id: '1729592969712207008', variationId: 'sku1', sku: 'FO-123' }, 95.5, f, NOW)
    const c = calls[0]!
    expect(c.method).toBe('POST')
    expect(c.url.origin + c.url.pathname).toBe('https://open-api.tiktokglobalshop.com/product/202309/products/1729592969712207008/prices/update')
    expect(c.url.searchParams.get('shop_cipher')).toBe('ROW_cifra')
    expect(JSON.parse(c.body!)).toEqual({ skus: [{ id: 'sku1', price: { amount: '95.50', currency: 'BRL' } }] })
    expectSigned(c)
  })

  it('vendedor global manda sale_price', async () => {
    const { f, calls } = fake([{ json: { code: 0, data: {}, message: 'Success' } }])
    await tiktok.updatePrice(app, { ...tokens, extra: { ...tokens.extra, sellerType: 'CROSS_BORDER' } }, { id: 'p', variationId: 's', sku: null }, 10, f, NOW)
    expect(JSON.parse(calls[0]!.body!)).toEqual({ skus: [{ id: 's', price: { currency: 'BRL', sale_price: '10.00' } }] })
  })

  it('recusa da plataforma (preço travado por promoção)', async () => {
    const { f } = fake([{ json: { code: 12052038, message: 'Product price locked due to ongoing promotion.', request_id: 'r' } }])
    await expect(tiktok.updatePrice(app, tokens, { id: 'p', variationId: 's', sku: null }, 10, f, NOW)).rejects.toThrow(
      'TikTok Shop recusou (mudança de preço): Product price locked due to ongoing promotion. (código 12052038)',
    )
  })

  it('sem SKU não chama a API', async () => {
    const { f, calls } = fake([])
    await expect(tiktok.updatePrice(app, tokens, { id: 'p', variationId: null, sku: null }, 10, f, NOW)).rejects.toThrow(ChannelError)
    expect(calls).toHaveLength(0)
  })
})
