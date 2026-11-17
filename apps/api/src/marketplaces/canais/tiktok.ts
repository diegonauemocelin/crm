/**
 * TikTok Shop (Partner API, estilo 202309 em diante), seguindo só a documentação oficial do Partner Center:
 *
 * - Autorização do lojista: https://partner.tiktokshop.com/docv2/page/authorization-overview-202407
 *   (link `https://services.tiktokshop.com/open/authorize?service_id=...` para fora dos EUA; o retorno vai para a
 *   Redirect URL cadastrada no app, com `code` e `state`; recusa volta com `code=null&error=auth_denied`).
 * - Tokens: GET `https://auth.tiktok-shops.com/api/v2/token/get` (grant_type=authorized_code) e `/api/v2/token/refresh`
 *   (grant_type=refresh_token); `access_token_expire_in` e `refresh_token_expire_in` são timestamps Unix (segundos).
 * - Assinatura: https://partner.tiktokshop.com/docv2/page/sign-your-api-request (HMAC-SHA256 com o app_secret sobre
 *   app_secret + caminho + parâmetros da query em ordem alfabética {chave}{valor} sem `sign`/`access_token` + corpo
 *   exato enviado + app_secret). Token no cabeçalho `x-tts-access-token`. Parâmetros comuns:
 *   https://partner.tiktokshop.com/docv2/page/common-parameters (app_key, timestamp em segundos, sign).
 * - Domínio das chamadas: https://open-api.tiktokglobalshop.com (https://partner.tiktokshop.com/docv2/page/methods-and-endpoints).
 * - Lojas autorizadas (shop_cipher): GET /authorization/202309/shops (get-authorized-shops-202309).
 * - Anúncios: POST /product/202502/products/search (search-products-202502, a versão mais nova da referência).
 * - Preço: POST /product/202309/products/{product_id}/prices/update (update-price-202309).
 * - Erros: resposta `{ code, message, request_id }`, `code` 0 = sucesso (https://partner.tiktokshop.com/docv2/page/common-errors).
 */
import { createHmac } from 'node:crypto'
import { type ChannelAdapter, type ChannelApp, ChannelError, type ChannelListing, type ChannelTokens, type Fetcher } from './tipos'

export const TIKTOK_API = 'https://open-api.tiktokglobalshop.com'
export const TIKTOK_AUTH = 'https://auth.tiktok-shops.com'
/** Link de autorização do lojista para o "resto do mundo" (inclui o Brasil); os EUA usam services.us.tiktokshop.com. */
export const TIKTOK_AUTHORIZE = 'https://services.tiktokshop.com/open/authorize'

/** Até 100 por página (Search Products: page_size, faixa válida 1–100). */
const PAGE_SIZE = 100

/** Moeda por região, como a referência do Update Price lista. */
const CURRENCY_BY_REGION: Record<string, string> = {
  BR: 'BRL',
  CZ: 'CZK',
  FR: 'EUR',
  DE: 'EUR',
  IE: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  GR: 'EUR',
  PT: 'EUR',
  GB: 'GBP',
  HU: 'HUF',
  ID: 'IDR',
  JP: 'JPY',
  MX: 'MXN',
  MY: 'MYR',
  PH: 'PHP',
  PL: 'PLN',
  SG: 'SGD',
  TH: 'THB',
  US: 'USD',
  VN: 'VND',
}

/**
 * Assinatura do pedido conforme o guia "Sign your API request". `query` são os parâmetros da URL (sem codificar);
 * `body` é o texto exato que vai no corpo (vazio quando não há corpo).
 */
export function tiktokSign(secret: string, path: string, query: Record<string, string>, body = ''): string {
  const keys = Object.keys(query)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort()
  const input = secret + path + keys.map((k) => `${k}${query[k]}`).join('') + body + secret
  return createHmac('sha256', secret).update(input).digest('hex')
}

interface TtsResponse<T> {
  code?: number
  message?: string
  request_id?: string
  data?: T
}

async function readJson<T>(res: Response, what: string): Promise<TtsResponse<T>> {
  const text = await res.text()
  let json: TtsResponse<T> | null = null
  try {
    json = text ? (JSON.parse(text) as TtsResponse<T>) : null
  } catch {
    json = null
  }
  if (!json || typeof json !== 'object') {
    throw new ChannelError(`TikTok Shop (${what}): resposta inválida (HTTP ${res.status}).`, res.status)
  }
  if (json.code !== 0 || !res.ok) {
    const msg = json.message || `HTTP ${res.status}`
    const code = json.code !== undefined && json.code !== 0 ? ` (código ${json.code})` : ''
    throw new ChannelError(`TikTok Shop recusou (${what}): ${msg}${code}`, res.status)
  }
  return json
}

function seconds(now: number): string {
  return String(Math.floor(now / 1000))
}

/** Chamada assinada à Open API (estilo 202309: versão no caminho, token no cabeçalho). */
async function call<T>(
  app: ChannelApp,
  accessToken: string,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>,
  body: unknown,
  what: string,
  f: Fetcher,
  now: number,
): Promise<T> {
  const query: Record<string, string> = { ...params, app_key: app.appId, timestamp: seconds(now) }
  const bodyText = body === undefined ? '' : JSON.stringify(body)
  query.sign = tiktokSign(app.appSecret, path, query, bodyText)
  const url = `${TIKTOK_API}${path}?${new URLSearchParams(query).toString()}`
  const res = await f(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-tts-access-token': accessToken },
    ...(body === undefined ? {} : { body: bodyText }),
  })
  const json = await readJson<T>(res, what)
  return (json.data ?? {}) as T
}

interface TokenData {
  access_token?: string
  access_token_expire_in?: number
  refresh_token?: string
  refresh_token_expire_in?: number
  open_id?: string
  seller_name?: string
  seller_base_region?: string
  user_type?: number
  granted_scopes?: string[]
}

async function tokenCall(app: ChannelApp, path: string, params: Record<string, string>, what: string, f: Fetcher): Promise<TokenData> {
  const query = new URLSearchParams({ app_key: app.appId, app_secret: app.appSecret, ...params })
  const res = await f(`${TIKTOK_AUTH}${path}?${query.toString()}`, { method: 'GET' })
  const json = await readJson<TokenData>(res, what)
  const d = json.data
  if (!d?.access_token || !d.refresh_token) throw new ChannelError(`TikTok Shop (${what}): a resposta veio sem os tokens.`, res.status)
  return d
}

/** `*_expire_in` é timestamp Unix em segundos (Authorization overview). */
function expiry(ts: number | undefined): number | null {
  return typeof ts === 'number' && ts > 0 ? ts * 1000 : null
}

interface Shop {
  id?: string
  name?: string
  region?: string
  seller_type?: string
  cipher?: string
  code?: string
}

function currencyOf(tokens: ChannelTokens): string {
  return CURRENCY_BY_REGION[(tokens.extra.region || 'BR').toUpperCase()] ?? 'BRL'
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Valor com 2 casas, como texto (o Update Price recebe preço em string, ex.: "1.32"). */
function money(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2)
}

interface SearchSku {
  id?: string
  seller_sku?: string
  price?: { currency?: string; tax_exclusive_price?: string; sale_price?: string }
  inventory?: { warehouse_id?: string; quantity?: number }[]
}
interface SearchProduct {
  id?: string
  title?: string
  status?: string
  skus?: SearchSku[]
}

export const tiktok: ChannelAdapter = {
  key: 'tiktok',
  label: 'TikTok Shop',
  appFields: [
    {
      key: 'appId',
      label: 'App Key',
      secret: false,
      help: 'No Partner Center do TikTok Shop, em App & Service, abra o seu app: o App Key aparece nos detalhes do app.',
    },
    {
      key: 'appSecret',
      label: 'App Secret',
      secret: true,
      help: 'Na mesma página de detalhes do app no Partner Center (App & Service). Não compartilhe: ele assina todas as chamadas.',
    },
    {
      key: 'serviceId',
      label: 'Service ID',
      secret: false,
      help:
        'Também nos detalhes do app no Partner Center (App & Service). É usado no link de autorização do lojista. ' +
        'Cadastre no app, como Redirect URL, o endereço de retorno que o sistema mostra.',
    },
  ],

  authUrl(app, _redirectUri, state) {
    // O retorno vai para a Redirect URL cadastrada no app do Partner Center (o link não leva redirect_uri).
    const serviceId = app.extra.serviceId?.trim()
    if (!serviceId) throw new ChannelError('TikTok Shop: informe o Service ID do app para gerar o link de autorização.')
    const q = new URLSearchParams({ service_id: serviceId, state })
    return `${TIKTOK_AUTHORIZE}?${q.toString()}`
  },

  async exchangeCode(app, params, _redirectUri, f = fetch, now = Date.now()) {
    const code = params.code
    if (params.error || !code || code === 'null') {
      throw new ChannelError(`TikTok Shop: a autorização não foi concedida${params.error ? ` (${params.error})` : ''}.`)
    }
    const d = await tokenCall(app, '/api/v2/token/get', { auth_code: code, grant_type: 'authorized_code' }, 'troca do código', f)
    const data = await call<{ shops?: Shop[] }>(app, d.access_token!, 'GET', '/authorization/202309/shops', {}, undefined, 'lojas autorizadas', f, now)
    const shops = (data.shops ?? []).filter((s) => s.cipher)
    const shop = shops.find((s) => (s.region || '').toUpperCase() === 'BR') ?? shops[0]
    if (!shop?.cipher) throw new ChannelError('TikTok Shop: nenhuma loja autorizada para este app.')
    const extra: Record<string, string> = {}
    if (shop.id) extra.shopId = shop.id
    if (shop.region) extra.region = shop.region
    if (shop.seller_type) extra.sellerType = shop.seller_type
    if (shop.code) extra.shopCode = shop.code
    if (d.open_id) extra.openId = d.open_id
    return {
      accessToken: d.access_token!,
      refreshToken: d.refresh_token!,
      expiresAt: expiry(d.access_token_expire_in) ?? now,
      refreshExpiresAt: expiry(d.refresh_token_expire_in),
      shopId: shop.cipher,
      shopName: shop.name || d.seller_name || null,
      extra,
    }
  },

  async refresh(app, tokens, f = fetch, now = Date.now()) {
    const d = await tokenCall(app, '/api/v2/token/refresh', { refresh_token: tokens.refreshToken, grant_type: 'refresh_token' }, 'renovação do token', f)
    return {
      ...tokens,
      accessToken: d.access_token!,
      refreshToken: d.refresh_token!,
      expiresAt: expiry(d.access_token_expire_in) ?? now,
      refreshExpiresAt: expiry(d.refresh_token_expire_in) ?? tokens.refreshExpiresAt,
      extra: { ...tokens.extra },
    }
  },

  async listListings(app, tokens, cursor, f = fetch, now = Date.now()) {
    const params: Record<string, string> = { shop_cipher: tokens.shopId, page_size: String(PAGE_SIZE) }
    if (cursor) params.page_token = cursor
    const data = await call<{ products?: SearchProduct[]; next_page_token?: string }>(
      app,
      tokens.accessToken,
      'POST',
      '/product/202502/products/search',
      params,
      { status: 'ACTIVATE' },
      'lista de produtos',
      f,
      now,
    )
    // Vendedor local: tax_exclusive_price é o preço exibido na página (antes de descontos). Vendedor global
    // (CROSS_BORDER): o preço exibido é sale_price; tax_exclusive_price é o preço antes de impostos e frete internacional.
    const global = (tokens.extra.sellerType || '').toUpperCase() === 'CROSS_BORDER'
    const items: ChannelListing[] = []
    for (const p of data.products ?? []) {
      if (!p.id) continue
      for (const s of p.skus ?? []) {
        const price = global ? num(s.price?.sale_price) ?? num(s.price?.tax_exclusive_price) : num(s.price?.tax_exclusive_price) ?? num(s.price?.sale_price)
        const inv = s.inventory ?? []
        const stock = inv.length ? inv.reduce((t, w) => t + (typeof w.quantity === 'number' ? w.quantity : 0), 0) : null
        items.push({
          id: p.id,
          variationId: s.id ?? null,
          sku: s.seller_sku || null,
          title: p.title ?? '',
          price,
          stock,
          status: p.status ?? '',
          url: null,
          image: null,
        })
      }
    }
    return { items, next: data.next_page_token || null }
  },

  async updatePrice(app, tokens, listing, price, f = fetch, now = Date.now()) {
    if (!listing.variationId) throw new ChannelError('TikTok Shop: o preço é mudado por SKU e este anúncio veio sem o ID do SKU.')
    if (!(price > 0)) throw new ChannelError('TikTok Shop: preço inválido.')
    const currency = currencyOf(tokens)
    const global = (tokens.extra.sellerType || '').toUpperCase() === 'CROSS_BORDER'
    // Local: price.amount é o preço exibido. Global: price.sale_price é o preço final exibido (amount fica de fora,
    // porque para ele é o preço antes de impostos e frete).
    const skuPrice = global ? { currency, sale_price: money(price) } : { amount: money(price), currency }
    await call<unknown>(
      app,
      tokens.accessToken,
      'POST',
      `/product/202309/products/${encodeURIComponent(listing.id)}/prices/update`,
      { shop_cipher: tokens.shopId },
      { skus: [{ id: listing.variationId, price: skuPrice }] },
      'mudança de preço',
      f,
      now,
    )
  },
}
