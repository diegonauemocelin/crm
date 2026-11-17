import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SHOPEE_AUTH_BR, SHOPEE_AUTH_BR_SANDBOX, SHOPEE_HOSTS, shopee, shopeeSign } from '../src/marketplaces/canais/shopee'
import { type ChannelApp, ChannelError, type ChannelTokens, type Fetcher } from '../src/marketplaces/canais/tipos'

const NOW = 1_700_000_000_000
const TS = 1_700_000_000
const app: ChannelApp = { appId: '2001887', appSecret: 'chave-secreta', extra: {} }
const tokens: ChannelTokens = {
  accessToken: 'acc',
  refreshToken: 'ref',
  expiresAt: NOW,
  refreshExpiresAt: NOW + 1000,
  shopId: '322300222',
  shopName: 'Loja',
  extra: {},
}

interface Call {
  url: URL
  method: string
  body: unknown
}

/** Fetcher falso: responde pela rota (caminho) e guarda as chamadas. */
function fake(routes: Record<string, (c: Call) => unknown>, status = 200) {
  const calls: Call[] = []
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const call: Call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const handler = routes[url.pathname]
    if (!handler) throw new Error(`rota inesperada ${url.pathname}`)
    return new Response(JSON.stringify(handler(call)), { status })
  }) as Fetcher
  return { f, calls }
}

const hmac = (base: string) => createHmac('sha256', 'chave-secreta').update(base).digest('hex')

describe('Shopee: assinatura', () => {
  it('API pública: partner_id + caminho + timestamp', () => {
    expect(shopeeSign('chave-secreta', '2001887', '/api/v2/auth/token/get', TS)).toBe(hmac(`2001887/api/v2/auth/token/get${TS}`))
  })
  it('API da loja: acrescenta access_token e shop_id, em hexadecimal minúsculo', () => {
    const s = shopeeSign('chave-secreta', '2001887', '/api/v2/product/get_item_list', TS, 'acc', '322300222')
    expect(s).toBe(hmac(`2001887/api/v2/product/get_item_list${TS}acc322300222`))
    expect(s).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('Shopee: link de autorização', () => {
  it('produção usa a URL fixa do Brasil e leva o state', () => {
    const u = new URL(shopee.authUrl(app, 'https://crm.exemplo.com.br/retorno', 'abc123', NOW))
    expect(`${u.origin}${u.pathname}`).toBe(SHOPEE_AUTH_BR)
    expect(Object.fromEntries(u.searchParams)).toEqual({
      partner_id: '2001887',
      auth_type: 'seller',
      redirect_uri: 'https://crm.exemplo.com.br/retorno',
      response_type: 'code',
      state: 'abc123',
    })
  })
  it('sandbox usa a URL de teste do Brasil', () => {
    const u = new URL(shopee.authUrl({ ...app, extra: { host: SHOPEE_HOSTS.sandbox } }, 'https://x/r', 's'))
    expect(`${u.origin}${u.pathname}`).toBe(SHOPEE_AUTH_BR_SANDBOX)
  })
  it('Partner ID não numérico é recusado', () => {
    expect(() => shopee.authUrl({ ...app, appId: 'abc' }, 'https://x/r', 's')).toThrow(ChannelError)
  })
  it('appFields: Partner ID, Partner Key (secreta) e ambiente com produção como padrão', () => {
    expect(shopee.appFields.map((a) => [a.key, a.secret])).toEqual([
      ['appId', false],
      ['appSecret', true],
      ['host', false],
    ])
    expect(shopee.appFields[2].options?.[0]).toEqual({ value: 'https://partner.shopeemobile.com', label: 'Produção' })
    expect(shopee.appFields[2].options?.some((o) => o.label === 'Teste (sandbox)')).toBe(true)
  })
})

describe('Shopee: tokens', () => {
  it('troca o code pelos tokens e busca o nome da loja', async () => {
    const { f, calls } = fake({
      '/api/v2/auth/token/get': () => ({ error: '', message: '', request_id: 'r', access_token: 'A1', refresh_token: 'R1', expire_in: 14400 }),
      '/api/v2/shop/get_shop_info': () => ({ error: '', message: '', shop_name: 'Usaparts', region: 'BR', expire_time: TS + 86400 }),
    })
    const t = await shopee.exchangeCode(app, { code: 'CODE', shop_id: '322300222', state: 'x' }, 'https://x/r', f, NOW)
    expect(t).toEqual({
      accessToken: 'A1',
      refreshToken: 'R1',
      expiresAt: NOW + 14400 * 1000,
      refreshExpiresAt: NOW + 86400 * 1000,
      shopId: '322300222',
      shopName: 'Usaparts',
      extra: { region: 'BR', authExpiresAt: String((TS + 86400) * 1000) },
    })
    const [tok, info] = calls
    expect(tok.method).toBe('POST')
    expect(tok.url.origin).toBe('https://partner.shopeemobile.com')
    expect(tok.body).toEqual({ code: 'CODE', partner_id: 2001887, shop_id: 322300222 })
    expect(Object.fromEntries(tok.url.searchParams)).toEqual({ partner_id: '2001887', timestamp: String(TS), sign: hmac(`2001887/api/v2/auth/token/get${TS}`) })
    expect(info.url.searchParams.get('sign')).toBe(hmac(`2001887/api/v2/shop/get_shop_info${TS}A1322300222`))
    expect(info.url.searchParams.get('access_token')).toBe('A1')
  })

  it('sem shop_info a conexão segue (nome fica nulo) e a renovação vale 30 dias', async () => {
    const { f } = fake({
      '/api/v2/auth/token/get': () => ({ error: '', access_token: 'A1', refresh_token: 'R1', expire_in: 14400 }),
      '/api/v2/shop/get_shop_info': () => ({ error: 'error_auth', message: 'no permission' }),
    })
    const t = await shopee.exchangeCode(app, { code: 'C', shop_id: '1' }, '', f, NOW)
    expect(t.shopName).toBeNull()
    expect(t.refreshExpiresAt).toBe(NOW + 30 * 24 * 3600 * 1000)
  })

  it('retorno sem code ou sem shop_id é recusado', async () => {
    const { f } = fake({})
    await expect(shopee.exchangeCode(app, { shop_id: '1' }, '', f, NOW)).rejects.toThrow(/code/)
    await expect(shopee.exchangeCode(app, { code: 'C' }, '', f, NOW)).rejects.toThrow(/shop_id/)
  })

  it('code inválido vira ChannelError com a mensagem da Shopee', async () => {
    const { f } = fake({ '/api/v2/auth/token/get': () => ({ error: 'error_auth', message: 'Invalid code', request_id: 'r' }) }, 403)
    const err = await shopee.exchangeCode(app, { code: 'C', shop_id: '1' }, '', f, NOW).catch((e) => e)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err.message).toContain('Invalid code')
    expect(err.message).toContain('Shopee')
    expect(err.status).toBe(403)
  })

  it('renova com refresh_token, partner_id e shop_id no corpo', async () => {
    const { f, calls } = fake({
      '/api/v2/auth/access_token/get': () => ({ error: '', partner_id: 2001887, shop_id: 322300222, access_token: 'A2', refresh_token: 'R2', expire_in: 14400 }),
    })
    const t = await shopee.refresh({ ...app, extra: { host: SHOPEE_HOSTS.sandbox } }, { ...tokens, extra: { region: 'BR' } }, f, NOW)
    expect(calls[0].url.origin).toBe(SHOPEE_HOSTS.sandbox)
    expect(calls[0].body).toEqual({ refresh_token: 'ref', partner_id: 2001887, shop_id: 322300222 })
    expect(calls[0].url.searchParams.get('sign')).toBe(hmac(`2001887/api/v2/auth/access_token/get${TS}`))
    expect(t).toMatchObject({ accessToken: 'A2', refreshToken: 'R2', expiresAt: NOW + 14400_000, shopId: '322300222', shopName: 'Loja', extra: { region: 'BR' } })
  })

  it('refresh vencido explica em português', async () => {
    const { f } = fake({ '/api/v2/auth/access_token/get': () => ({ error: 'refresh_token_expired', message: 'Your refresh_token expired.' }) })
    await expect(shopee.refresh(app, tokens, f, NOW)).rejects.toThrow(/autorize a loja de novo.*Your refresh_token expired/)
  })
})

describe('Shopee: anúncios', () => {
  const routes = (hasNext: boolean) => ({
    '/api/v2/product/get_item_list': () => ({
      error: '',
      message: '',
      response: { item: [{ item_id: 101, item_status: 'NORMAL' }, { item_id: 202, item_status: 'NORMAL' }], total_count: 3, has_next_page: hasNext, next_offset: 2 },
    }),
    '/api/v2/product/get_item_base_info': () => ({
      error: '',
      message: '',
      response: {
        item_list: [
          {
            item_id: 101,
            item_name: 'Filtro de óleo',
            item_sku: 'FO-1',
            item_status: 'NORMAL',
            has_model: false,
            price_info: [{ currency: 'BRL', original_price: 59.9, current_price: 49.9 }],
            image: { image_url_list: ['https://img/101.jpg'] },
            stock_info_v2: { summary_info: { total_reserved_stock: 0, total_available_stock: 12 }, seller_stock: [{ location_id: 'BRZ', stock: 12 }] },
          },
          {
            item_id: 202,
            item_name: 'Dente de caçamba',
            item_sku: 'DC',
            item_status: 'NORMAL',
            has_model: true,
            image: { image_url_list: ['https://img/202.jpg'] },
          },
        ],
      },
    }),
    '/api/v2/product/get_model_list': () => ({
      error: '',
      message: '',
      response: {
        tier_variation: [{ name: 'Tamanho', option_list: [{ option: 'P' }, { option: 'G', image: { image_url: 'https://img/g.jpg' } }] }],
        model: [
          { model_id: 9001, tier_index: [0], model_sku: 'DC-P', model_status: 'MODEL_NORMAL', price_info: [{ current_price: 100, original_price: 100 }], stock_info_v2: { summary_info: { total_available_stock: 3 } } },
          { model_id: 9002, tier_index: [1], model_sku: 'DC-G', model_status: 'MODEL_UNAVAILABLE', price_info: [{ current_price: 150.5, original_price: 150.5 }], stock_info_v2: { summary_info: { total_available_stock: 0 } } },
        ],
      },
    }),
  })

  it('pagina só os NORMAL, abre as variações e devolve o próximo offset', async () => {
    const { f, calls } = fake(routes(true))
    const page = await shopee.listListings(app, tokens, null, f, NOW)
    expect(page.next).toBe('2')
    expect(page.items).toEqual([
      { id: '101', variationId: null, sku: 'FO-1', title: 'Filtro de óleo', price: 49.9, stock: 12, status: 'NORMAL', url: null, image: 'https://img/101.jpg' },
      { id: '202', variationId: '9001', sku: 'DC-P', title: 'Dente de caçamba - P', price: 100, stock: 3, status: 'NORMAL', url: null, image: 'https://img/202.jpg' },
      { id: '202', variationId: '9002', sku: 'DC-G', title: 'Dente de caçamba - G', price: 150.5, stock: 0, status: 'MODEL_UNAVAILABLE', url: null, image: 'https://img/g.jpg' },
    ])
    const list = calls[0].url.searchParams
    expect(list.get('offset')).toBe('0')
    expect(list.get('page_size')).toBe('50')
    expect(list.getAll('item_status')).toEqual(['NORMAL'])
    expect(list.get('sign')).toBe(hmac(`2001887/api/v2/product/get_item_list${TS}acc322300222`))
    expect(calls[1].url.searchParams.get('item_id_list')).toBe('101,202')
    expect(calls[2].url.pathname).toBe('/api/v2/product/get_model_list')
    expect(calls[2].url.searchParams.get('item_id')).toBe('202')
    expect(calls).toHaveLength(3)
  })

  it('usa o cursor como offset e termina quando não há próxima página', async () => {
    const { f, calls } = fake(routes(false))
    const page = await shopee.listListings(app, tokens, '50', f, NOW)
    expect(calls[0].url.searchParams.get('offset')).toBe('50')
    expect(page.next).toBeNull()
  })

  it('página vazia não chama get_item_base_info', async () => {
    const { f, calls } = fake({ '/api/v2/product/get_item_list': () => ({ error: '', response: { item: [], total_count: 0, has_next_page: false } }) })
    expect(await shopee.listListings(app, tokens, null, f, NOW)).toEqual({ items: [], next: null })
    expect(calls).toHaveLength(1)
  })

  it('token vencido vira ChannelError', async () => {
    const { f } = fake({ '/api/v2/product/get_item_list': () => ({ error: 'error_auth', message: 'Invalid access_token.' }) }, 403)
    await expect(shopee.listListings(app, tokens, null, f, NOW)).rejects.toThrow(/Invalid access_token/)
  })
})

describe('Shopee: preço', () => {
  it('anúncio sem variação: price_list sem model_id', async () => {
    const { f, calls } = fake({ '/api/v2/product/update_price': () => ({ error: '', response: { failure_list: [], success_list: [{ model_id: 0, original_price: 10.13 }] } }) })
    await shopee.updatePrice(app, tokens, { id: '101', variationId: null, sku: null }, 10.129, f, NOW)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ item_id: 101, price_list: [{ original_price: 10.13 }] })
    expect(calls[0].url.searchParams.get('sign')).toBe(hmac(`2001887/api/v2/product/update_price${TS}acc322300222`))
    expect(calls[0].url.searchParams.get('shop_id')).toBe('322300222')
  })

  it('variação: model_id no price_list', async () => {
    const { f, calls } = fake({ '/api/v2/product/update_price': () => ({ error: '', response: { failure_list: [], success_list: [{ model_id: 9001, original_price: 99 }] } }) })
    await shopee.updatePrice(app, tokens, { id: '202', variationId: '9001', sku: 'DC-P' }, 99, f, NOW)
    expect(calls[0].body).toEqual({ item_id: 202, price_list: [{ model_id: 9001, original_price: 99 }] })
  })

  it('falha na variação (failure_list) vira erro com o motivo', async () => {
    const { f } = fake({ '/api/v2/product/update_price': () => ({ error: '', response: { failure_list: [{ model_id: 9001, failed_reason: 'price too low' }], success_list: [] } }) })
    await expect(shopee.updatePrice(app, tokens, { id: '202', variationId: '9001', sku: null }, 1, f, NOW)).rejects.toThrow(/price too low/)
  })

  it('erro da Shopee traz a dica em português e a mensagem original', async () => {
    const { f } = fake({
      '/api/v2/product/update_price': () => ({ error: 'error_cannt_edit_price_in_promotion', message: 'Original_price cannot be edited when item is under promotion.' }),
    })
    const err = await shopee.updatePrice(app, tokens, { id: '202', variationId: null, sku: null }, 10, f, NOW).catch((e) => e)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err.message).toContain('promoção')
    expect(err.message).toContain('Original_price cannot be edited')
  })

  it('preço inválido nem chama a Shopee', async () => {
    const { f, calls } = fake({})
    await expect(shopee.updatePrice(app, tokens, { id: '1', variationId: null, sku: null }, 0, f, NOW)).rejects.toThrow(ChannelError)
    expect(calls).toHaveLength(0)
  })

  it('resposta que não é JSON vira ChannelError com o HTTP', async () => {
    const f = (async () => new Response('<html>502</html>', { status: 502 })) as Fetcher
    await expect(shopee.updatePrice(app, tokens, { id: '1', variationId: null, sku: null }, 5, f, NOW)).rejects.toMatchObject({ status: 502 })
  })
})
