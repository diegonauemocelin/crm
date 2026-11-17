import { describe, expect, it } from 'vitest'
import { AMAZON_BR_MARKETPLACE_ID, amazon, amazonLoginRedirect, amzDate } from '../src/marketplaces/canais/amazon'
import { ChannelError, type ChannelApp, type ChannelTokens } from '../src/marketplaces/canais/tipos'

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0)
const app: ChannelApp = { appId: 'amzn1.application-oa2-client.abc', appSecret: 'segredo', extra: { applicationId: 'amzn1.sp.solution.123', region: 'na' } }
const tokens: ChannelTokens = {
  accessToken: 'Atza|acesso',
  refreshToken: 'Atzr|refresh',
  expiresAt: NOW + 3600_000,
  refreshExpiresAt: null,
  shopId: 'A3SELLER',
  shopName: null,
  extra: { marketplaceId: AMAZON_BR_MARKETPLACE_ID },
}

interface Call {
  url: string
  init: RequestInit
}
function mock(...responses: [number, unknown][]) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses.shift()
    if (!r) throw new Error('chamada inesperada: ' + url)
    return new Response(JSON.stringify(r[1]), { status: r[0], headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { f, calls }
}
const form = (c: Call) => Object.fromEntries(new URLSearchParams(String(c.init.body)))
const header = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k]

describe('canal Amazon (SP-API)', () => {
  it('link de autorização no Seller Central do Brasil (version=beta só em rascunho)', () => {
    const u = new URL(amazon.authUrl(app, 'https://crm.exemplo.com.br/retorno', 'st-1'))
    expect(u.origin + u.pathname).toBe('https://sellercentral.amazon.com.br/apps/authorize/consent')
    expect(Object.fromEntries(u.searchParams)).toEqual({ application_id: 'amzn1.sp.solution.123', state: 'st-1' })
    const beta = new URL(amazon.authUrl({ ...app, extra: { ...app.extra, version: 'beta' } }, 'x', 's'))
    expect(beta.searchParams.get('version')).toBe('beta')
    expect(() => amazon.authUrl({ ...app, extra: {} }, 'x', 's')).toThrow(ChannelError)
  })

  it('etapa do Log-in URI: volta para o amazon_callback_uri com amazon_state, state e redirect_uri', () => {
    const url = amazonLoginRedirect(
      app,
      { amazon_callback_uri: 'https://sellercentral.amazon.com.br/apps/authorize/confirm/amzn1.sp.solution.123', amazon_state: 'az', selling_partner_id: 'A3SELLER' },
      'https://crm.exemplo.com.br/retorno',
      'novo',
    )
    const u = new URL(url)
    expect(u.searchParams.get('amazon_state')).toBe('az')
    expect(u.searchParams.get('state')).toBe('novo')
    expect(u.searchParams.get('redirect_uri')).toBe('https://crm.exemplo.com.br/retorno')
    expect(() => amazonLoginRedirect(app, { amazon_callback_uri: 'https://malicioso.com/x', amazon_state: 'a' }, 'r', 's')).toThrow(/domínio/)
  })

  it('troca o spapi_oauth_code no LWA e busca o nome da loja', async () => {
    const { f, calls } = mock(
      [200, { access_token: 'Atza|novo', token_type: 'bearer', expires_in: 3600, refresh_token: 'Atzr|novo' }],
      [200, { payload: [{ marketplace: { id: AMAZON_BR_MARKETPLACE_ID, defaultCurrencyCode: 'BRL' }, participation: { isParticipating: true }, storeName: 'Loja BR' }] }],
    )
    const t = await amazon.exchangeCode(app, { spapi_oauth_code: 'COD', state: 'st', selling_partner_id: 'A3SELLER' }, 'https://crm.exemplo.com.br/retorno', f, NOW)
    expect(calls[0]!.url).toBe('https://api.amazon.com/auth/o2/token')
    expect(calls[0]!.init.method).toBe('POST')
    expect(header(calls[0]!, 'Content-Type')).toContain('application/x-www-form-urlencoded')
    expect(form(calls[0]!)).toEqual({
      grant_type: 'authorization_code',
      code: 'COD',
      redirect_uri: 'https://crm.exemplo.com.br/retorno',
      client_id: app.appId,
      client_secret: 'segredo',
    })
    expect(calls[1]!.url).toBe('https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations')
    expect(header(calls[1]!, 'x-amz-access-token')).toBe('Atza|novo')
    expect(header(calls[1]!, 'x-amz-date')).toBe('20261117T120000Z')
    expect(header(calls[1]!, 'user-agent')).toMatch(/Language=/)
    expect(header(calls[1]!, 'authorization')).toBeUndefined()
    expect(t).toEqual({
      accessToken: 'Atza|novo',
      refreshToken: 'Atzr|novo',
      expiresAt: NOW + 3600_000,
      refreshExpiresAt: NOW + 365 * 24 * 3600_000,
      shopId: 'A3SELLER',
      shopName: 'Loja BR',
      extra: { marketplaceId: AMAZON_BR_MARKETPLACE_ID, currency: 'BRL' },
    })
  })

  it('troca sem nome da loja quando a Sellers API recusa; erro do LWA vira ChannelError', async () => {
    const ok = mock([200, { access_token: 'a', expires_in: 3600, refresh_token: 'r' }], [403, { errors: [{ code: 'Unauthorized', message: 'Access denied' }] }])
    const t = await amazon.exchangeCode(app, { spapi_oauth_code: 'C', selling_partner_id: 'S' }, 'r', ok.f, NOW)
    expect(t.shopName).toBeNull()
    const bad = mock([400, { error: 'invalid_grant', error_description: 'The authorization code is invalid' }])
    await expect(amazon.exchangeCode(app, { spapi_oauth_code: 'C', selling_partner_id: 'S' }, 'r', bad.f, NOW)).rejects.toMatchObject({
      message: 'Amazon recusou a autorização: The authorization code is invalid',
      status: 400,
    })
    await expect(amazon.exchangeCode(app, { amazon_callback_uri: 'https://amazon.com/x', amazon_state: 'a' }, 'r', bad.f, NOW)).rejects.toThrow(/Log-in URI/)
  })

  it('renova o access token com o refresh token', async () => {
    const { f, calls } = mock([200, { access_token: 'Atza|renovado', token_type: 'bearer', expires_in: 3600, refresh_token: 'Atzr|refresh' }])
    const t = await amazon.refresh(app, { ...tokens, refreshExpiresAt: 123 }, f, NOW)
    expect(form(calls[0]!)).toEqual({ grant_type: 'refresh_token', refresh_token: 'Atzr|refresh', client_id: app.appId, client_secret: 'segredo' })
    expect(t).toMatchObject({ accessToken: 'Atza|renovado', refreshToken: 'Atzr|refresh', expiresAt: NOW + 3600_000, refreshExpiresAt: 123, shopId: 'A3SELLER' })
  })

  it('lista os anúncios com searchListingsItems e pagina pelo nextToken', async () => {
    const item = {
      sku: 'FIL-123',
      summaries: [
        {
          marketplaceId: AMAZON_BR_MARKETPLACE_ID,
          asin: 'B0TESTE123',
          productType: 'AUTO_PART',
          status: ['BUYABLE', 'DISCOVERABLE'],
          itemName: 'Filtro de óleo',
          mainImage: { link: 'https://m.media-amazon.com/images/I/x.jpg', height: 500, width: 500 },
        },
      ],
      offers: [
        { marketplaceId: AMAZON_BR_MARKETPLACE_ID, offerType: 'B2B', price: { currencyCode: 'BRL', amount: '80.00' } },
        { marketplaceId: AMAZON_BR_MARKETPLACE_ID, offerType: 'B2C', price: { currencyCode: 'BRL', amount: '89.90' } },
      ],
      fulfillmentAvailability: [{ fulfillmentChannelCode: 'DEFAULT', quantity: 7 }],
    }
    const { f, calls } = mock(
      [200, { numberOfResults: 2, pagination: { nextToken: 'abc=' }, items: [item] }],
      [200, { numberOfResults: 2, items: [{ sku: 'SEM-ASIN', summaries: [{ marketplaceId: AMAZON_BR_MARKETPLACE_ID, status: [] }] }] }],
    )
    const p1 = await amazon.listListings(app, tokens, null, f, NOW)
    expect(calls[0]!.url).toBe(
      'https://sellingpartnerapi-na.amazon.com/listings/2021-08-01/items/A3SELLER?marketplaceIds=A2Q3Y263D00KWC&includedData=summaries,offers,fulfillmentAvailability&pageSize=20&sortBy=sku&sortOrder=ASC',
    )
    expect(calls[0]!.init.method).toBe('GET')
    expect(p1).toEqual({
      items: [
        {
          id: 'FIL-123',
          variationId: null,
          sku: 'FIL-123',
          title: 'Filtro de óleo',
          price: 89.9,
          stock: 7,
          status: 'BUYABLE,DISCOVERABLE',
          url: 'https://www.amazon.com.br/dp/B0TESTE123',
          image: 'https://m.media-amazon.com/images/I/x.jpg',
        },
      ],
      next: 'abc=',
    })
    const p2 = await amazon.listListings(app, tokens, p1.next, f, NOW)
    expect(calls[1]!.url).toContain('&pageToken=abc%3D')
    expect(p2.next).toBeNull()
    expect(p2.items[0]).toMatchObject({ id: 'SEM-ASIN', title: 'SEM-ASIN', price: null, stock: null, url: null, image: null, status: '' })
  })

  it('erro da SP-API vira ChannelError com a mensagem da Amazon', async () => {
    const { f } = mock([403, { errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.', details: '' }] }])
    const err = await amazon.listListings(app, tokens, null, f, NOW).catch((e) => e)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err.message).toBe('Amazon recusou a lista de anúncios: Access to requested resource is denied.')
    expect(err.status).toBe(403)
  })

  it('muda o preço com patchListingsItem (merge em purchasable_offer, our_price)', async () => {
    const { f, calls } = mock(
      [200, { sku: 'FIL/1', summaries: [{ marketplaceId: AMAZON_BR_MARKETPLACE_ID, productType: 'AUTO_PART' }], offers: [{ marketplaceId: AMAZON_BR_MARKETPLACE_ID, offerType: 'B2C', price: { currencyCode: 'BRL', amount: '10' } }] }],
      [200, { sku: 'FIL/1', status: 'ACCEPTED', submissionId: 'x', issues: [] }],
    )
    await amazon.updatePrice(app, tokens, { id: 'FIL/1', variationId: null, sku: 'FIL/1' }, 99.999, f, NOW)
    expect(calls[0]!.url).toBe('https://sellingpartnerapi-na.amazon.com/listings/2021-08-01/items/A3SELLER/FIL%2F1?marketplaceIds=A2Q3Y263D00KWC&includedData=summaries,offers')
    expect(calls[1]!.url).toBe('https://sellingpartnerapi-na.amazon.com/listings/2021-08-01/items/A3SELLER/FIL%2F1?marketplaceIds=A2Q3Y263D00KWC')
    expect(calls[1]!.init.method).toBe('PATCH')
    expect(header(calls[1]!, 'content-type')).toBe('application/json')
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      productType: 'AUTO_PART',
      patches: [
        {
          op: 'merge',
          path: '/attributes/purchasable_offer',
          value: [{ marketplace_id: AMAZON_BR_MARKETPLACE_ID, currency: 'BRL', audience: 'ALL', our_price: [{ schedule: [{ value_with_tax: 100 }] }] }],
        },
      ],
    })
  })

  it('preço recusado: status INVALID, erro HTTP e anúncio sem productType', async () => {
    const getOk: [number, unknown] = [200, { sku: 'A', summaries: [{ marketplaceId: AMAZON_BR_MARKETPLACE_ID, productType: 'AUTO_PART' }] }]
    const invalid = mock(getOk, [200, { sku: 'A', status: 'INVALID', submissionId: 'y', issues: [{ code: '1', message: 'Preço fora do limite', severity: 'ERROR' }, { code: '2', message: 'aviso', severity: 'WARNING' }] }])
    await expect(amazon.updatePrice(app, tokens, { id: 'A', variationId: null, sku: 'A' }, 10, invalid.f, NOW)).rejects.toThrow('Amazon recusou o preço: Preço fora do limite')
    const http = mock(getOk, [400, { errors: [{ code: 'InvalidInput', message: 'Invalid input', details: 'patches' }] }])
    await expect(amazon.updatePrice(app, tokens, { id: 'A', variationId: null, sku: 'A' }, 10, http.f, NOW)).rejects.toMatchObject({ message: 'Amazon recusou o preço: Invalid input — patches', status: 400 })
    const semTipo = mock([200, { sku: 'A', summaries: [] }])
    await expect(amazon.updatePrice(app, tokens, { id: 'A', variationId: null, sku: 'A' }, 10, semTipo.f, NOW)).rejects.toThrow(/productType/)
    await expect(amazon.updatePrice(app, tokens, { id: 'A', variationId: null, sku: 'A' }, 0, semTipo.f, NOW)).rejects.toThrow(/preço inválido/)
  })

  it('x-amz-date no formato da documentação', () => {
    expect(amzDate(Date.UTC(2019, 3, 30, 12, 36, 0))).toBe('20190430T123600Z')
  })
})
