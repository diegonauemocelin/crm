/**
 * Shopee (Open Platform, API v2), seguindo só a documentação oficial:
 *
 * - Autorização e assinatura: https://open.shopee.com/developer-guide/20 ("Authorization and Authentication").
 *   Link de autorização no formato novo (URL fixa por região + partner_id, auth_type=seller, redirect_uri,
 *   response_type=code e `state`, que a Shopee devolve igual no retorno). Brasil: https://open.shopee.com.br/auth;
 *   sandbox do Brasil: https://open.sandbox.test-stable.shopee.com.br/auth. O retorno traz `code` e `shop_id`
 *   (ou `main_account_id`, quando autorizado pela conta principal).
 *   Assinatura (sign): HMAC-SHA256 com a Partner Key, hexadecimal minúsculo, sobre
 *   partner_id + caminho + timestamp (APIs públicas) ou partner_id + caminho + timestamp + access_token + shop_id (APIs da loja).
 * - Domínios das chamadas: https://open.shopee.com/developer-guide/16 ("API calls"): partner.shopeemobile.com
 *   (servidor perto de Singapura), openplatform.shopee.com.br (servidor perto dos EUA) e o sandbox
 *   openplatform.sandbox.test-stable.shopee.sg. GET leva tudo na URL; POST leva os comuns na URL e o resto no corpo JSON.
 * - Tokens: POST /api/v2/auth/token/get (v2.public.get_access_token) e POST /api/v2/auth/access_token/get
 *   (v2.public.refresh_access_token). access_token vale 4 h (`expire_in` em segundos); refresh_token vale 30 dias e
 *   só pode ser usado uma vez (a renovação devolve um novo).
 * - Loja: GET /api/v2/shop/get_shop_info (shop_name, region, expire_time da autorização).
 * - Anúncios: GET /api/v2/product/get_item_list (offset, page_size 1–100, item_status=NORMAL),
 *   GET /api/v2/product/get_item_base_info (item_id_list, até 50) e, para quem tem variações (has_model),
 *   GET /api/v2/product/get_model_list (item_id). Preço: price_info.current_price; estoque:
 *   stock_info_v2.summary_info.total_available_stock (guia "Stock & Price Management": https://open.shopee.com/developer-guide/223).
 * - Preço: POST /api/v2/product/update_price (item_id + price_list[{ model_id?, original_price }]; sem variação, o
 *   model_id fica de fora, como no exemplo do guia 223).
 * - Erros: toda resposta traz `error` (vazio = sucesso), `message` e `request_id`.
 */
import { createHmac } from 'node:crypto'
import { type ChannelAdapter, type ChannelApp, ChannelError, type ChannelListing, type ChannelTokens, type Fetcher } from './tipos'

/** Domínios da API (guia "API calls"). O primeiro é o padrão. */
export const SHOPEE_HOSTS = {
  producao: 'https://partner.shopeemobile.com',
  producaoAmericas: 'https://openplatform.shopee.com.br',
  sandbox: 'https://openplatform.sandbox.test-stable.shopee.sg',
} as const
export const SHOPEE_DEFAULT_HOST = SHOPEE_HOSTS.producao

/** URL fixa de autorização do Brasil (guia "Authorization and Authentication"). */
export const SHOPEE_AUTH_BR = 'https://open.shopee.com.br/auth'
export const SHOPEE_AUTH_BR_SANDBOX = 'https://open.sandbox.test-stable.shopee.com.br/auth'

export const SHOPEE_PATHS = {
  token: '/api/v2/auth/token/get',
  refresh: '/api/v2/auth/access_token/get',
  shopInfo: '/api/v2/shop/get_shop_info',
  itemList: '/api/v2/product/get_item_list',
  itemBaseInfo: '/api/v2/product/get_item_base_info',
  modelList: '/api/v2/product/get_model_list',
  updatePrice: '/api/v2/product/update_price',
} as const

/** get_item_list: page_size na faixa [1,100]; get_item_base_info: até 50 ids. Uma página = um lote de 50. */
const PAGE_SIZE = 50
const BASE_INFO_MAX = 50
/** refresh_token vale 30 dias (guia de autorização e v2.public.refresh_access_token). */
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Domínio escolhido no cadastro do aplicativo (só os da documentação; qualquer outro valor cai no padrão). */
export function shopeeHost(app: ChannelApp): string {
  const h = (app.extra?.host ?? '').trim().replace(/\/+$/, '')
  return (Object.values(SHOPEE_HOSTS) as string[]).includes(h) ? h : SHOPEE_DEFAULT_HOST
}

const isSandbox = (app: ChannelApp) => shopeeHost(app) === SHOPEE_HOSTS.sandbox

/** sign = HMAC-SHA256(partner_key, partner_id + caminho + timestamp [+ access_token + shop_id]) em hexadecimal minúsculo. */
export function shopeeSign(partnerKey: string, partnerId: string, path: string, timestamp: number, accessToken = '', shopId = ''): string {
  return createHmac('sha256', partnerKey).update(`${partnerId}${path}${timestamp}${accessToken}${shopId}`).digest('hex')
}

const secondsOf = (now: number) => Math.floor(now / 1000)

function partnerIdOf(app: ChannelApp): string {
  const id = String(app.appId ?? '').trim()
  if (!/^\d+$/.test(id)) throw new ChannelError('Shopee: o Partner ID deve ser só números (veja em Open Platform Console › App List).')
  if (!app.appSecret) throw new ChannelError('Shopee: falta a Partner Key do aplicativo.')
  return id
}

/** Mensagens em português para os códigos mais comuns da lista de erros da documentação; a da Shopee vai junto. */
const ERROR_HINTS: Record<string, string> = {
  error_sign: 'assinatura recusada (confira a Partner Key e o relógio do servidor)',
  error_auth: 'acesso recusado (autorização da loja vencida ou chaves erradas)',
  invalid_partner_id: 'Partner ID inválido',
  error_param: 'parâmetro inválido',
  error_permission: 'o aplicativo não tem permissão para esta função',
  error_rate_limit: 'muitas chamadas seguidas; tente de novo em instantes',
  error_limit: 'limite diário de chamadas do aplicativo atingido',
  error_server: 'erro no servidor da Shopee; tente mais tarde',
  error_inner: 'erro no servidor da Shopee; tente mais tarde',
  error_system_busy: 'a Shopee está demorando para responder; tente mais tarde',
  refresh_token_expired: 'a renovação venceu; autorize a loja de novo',
  shop_access_expired: 'a autorização da loja venceu; autorize de novo',
  shop_banned: 'a conta da loja está bloqueada na Shopee',
  shop_no_linked: 'a loja não está mais ligada ao aplicativo; autorize de novo',
  error_shop_refresh_token: 'refresh token inválido para esta loja; autorize de novo',
  source_ip_undeclared: 'o IP do servidor não está na lista de IPs do aplicativo (Open Platform Console › App List)',
  error_item_not_found: 'anúncio não encontrado',
  error_item_not_belong_shop: 'o anúncio não é desta loja',
  error_invalid_price: 'preço em formato inválido',
  error_price_exceed_min_limitt: 'preço abaixo do mínimo permitido',
  error_price_exceed_max_limitt: 'preço acima do máximo permitido',
  error_cannt_edit_price_in_promotion: 'o preço não pode ser mudado enquanto o anúncio está em promoção',
  error_item_uneditable: 'o anúncio não pode ser editado na situação atual',
}

export function shopeeErrorMessage(error: string, message: string): string {
  const hint = ERROR_HINTS[error]
  const detail = [error, message].filter(Boolean).join(': ')
  return hint ? `Shopee: ${hint} (${detail})` : `Shopee recusou o pedido (${detail || 'sem detalhe'})`
}

type Json = Record<string, unknown>

async function call(f: Fetcher, url: string, init: RequestInit): Promise<Json> {
  let res: Response
  try {
    res = await f(url, init)
  } catch (e) {
    throw new ChannelError(`Shopee: não foi possível conectar (${e instanceof Error ? e.message : String(e)})`)
  }
  const text = await res.text()
  let body: Json = {}
  try {
    body = text ? (JSON.parse(text) as Json) : {}
  } catch {
    throw new ChannelError(`Shopee: resposta inesperada (HTTP ${res.status})`, res.status)
  }
  const error = typeof body.error === 'string' ? body.error : ''
  const message = typeof body.message === 'string' ? body.message : typeof body.msg === 'string' ? body.msg : ''
  if (error) throw new ChannelError(shopeeErrorMessage(error, message), res.status)
  if (!res.ok) throw new ChannelError(shopeeErrorMessage(`HTTP ${res.status}`, message), res.status)
  return body
}

type Query = Record<string, string | number | string[]>

function buildUrl(host: string, path: string, query: Query): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) for (const x of v) qs.append(k, x)
    else qs.append(k, String(v))
  }
  return `${host}${path}?${qs.toString()}`
}

/** Chamada de API pública (tokens): sign sem access_token/shop_id, corpo JSON. */
function publicPost(app: ChannelApp, path: string, body: Json, f: Fetcher, now: number) {
  const partnerId = partnerIdOf(app)
  const ts = secondsOf(now)
  const url = buildUrl(shopeeHost(app), path, { partner_id: partnerId, timestamp: ts, sign: shopeeSign(app.appSecret, partnerId, path, ts) })
  return call(f, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function shopCommon(app: ChannelApp, tokens: ChannelTokens, path: string, now: number): Query {
  const partnerId = partnerIdOf(app)
  const ts = secondsOf(now)
  return {
    partner_id: partnerId,
    timestamp: ts,
    access_token: tokens.accessToken,
    shop_id: tokens.shopId,
    sign: shopeeSign(app.appSecret, partnerId, path, ts, tokens.accessToken, tokens.shopId),
  }
}

/** API da loja, GET: parâmetros comuns e do pedido na URL. */
function shopGet(app: ChannelApp, tokens: ChannelTokens, path: string, params: Query, f: Fetcher, now: number) {
  return call(f, buildUrl(shopeeHost(app), path, { ...shopCommon(app, tokens, path, now), ...params }), { method: 'GET' })
}

/** API da loja, POST: comuns na URL, parâmetros no corpo JSON. */
function shopPost(app: ChannelApp, tokens: ChannelTokens, path: string, body: Json, f: Fetcher, now: number) {
  return call(f, buildUrl(shopeeHost(app), path, shopCommon(app, tokens, path, now)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Json[]) : [])

function tokensFrom(body: Json, shopId: string, now: number, prev?: ChannelTokens): ChannelTokens {
  const accessToken = str(body.access_token)
  const refreshToken = str(body.refresh_token)
  const expireIn = num(body.expire_in)
  if (!accessToken || !refreshToken) throw new ChannelError('Shopee: a resposta não trouxe os tokens da loja.')
  return {
    accessToken,
    refreshToken,
    // expire_in: validade do access_token em segundos (4 h segundo a documentação).
    expiresAt: now + (expireIn && expireIn > 0 ? expireIn : 4 * 60 * 60) * 1000,
    refreshExpiresAt: now + REFRESH_TTL_MS,
    shopId,
    shopName: prev?.shopName ?? null,
    extra: { ...(prev?.extra ?? {}) },
  }
}

/** Nome, região e vencimento da autorização da loja (v2.shop.get_shop_info). Falha aqui não impede a conexão. */
async function withShopInfo(app: ChannelApp, tokens: ChannelTokens, f: Fetcher, now: number): Promise<ChannelTokens> {
  try {
    const info = await shopGet(app, tokens, SHOPEE_PATHS.shopInfo, {}, f, now)
    const extra = { ...tokens.extra }
    const region = str(info.region)
    if (region) extra.region = region
    const expireTime = num(info.expire_time)
    const authEnds = expireTime && expireTime > 0 ? expireTime * 1000 : null
    if (authEnds) extra.authExpiresAt = String(authEnds)
    return {
      ...tokens,
      shopName: str(info.shop_name) ?? tokens.shopName,
      // A renovação só funciona dentro da validade da autorização (até 365 dias, escolhida pelo lojista).
      refreshExpiresAt: authEnds && tokens.refreshExpiresAt ? Math.min(tokens.refreshExpiresAt, authEnds) : tokens.refreshExpiresAt,
      extra,
    }
  } catch {
    return tokens
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const availableStock = (stockInfo: unknown): number | null => num(obj(obj(stockInfo).summary_info).total_available_stock)
const currentPrice = (priceInfo: unknown): number | null => num(arr(priceInfo)[0]?.current_price)

/** Converte um item (get_item_base_info) e, se houver, suas variações (get_model_list) em linhas do CRM. */
export function shopeeRows(item: Json, models: Json | null): ChannelListing[] {
  const id = str(item.item_id)
  if (!id) return []
  const title = str(item.item_name) ?? ''
  const status = str(item.item_status) ?? ''
  const imageList = obj(item.image).image_url_list
  const image = Array.isArray(imageList) ? str(imageList[0]) : null
  if (!models) {
    return [
      {
        id,
        variationId: null,
        sku: str(item.item_sku),
        title,
        price: currentPrice(item.price_info),
        stock: availableStock(item.stock_info_v2),
        status,
        url: null,
        image,
      },
    ]
  }
  const tiers = arr(models.tier_variation)
  return arr(models.model).flatMap((m): ChannelListing[] => {
    const modelId = str(m.model_id)
    if (!modelId) return []
    const idx = Array.isArray(m.tier_index) ? (m.tier_index as unknown[]).map((n) => num(n)) : []
    const options = idx.map((n, t) => (n === null ? null : arr(obj(tiers[t]).option_list)[n] ?? null))
    const names = options.map((o) => (o ? str(o.option) : null)).filter((s): s is string => !!s)
    const optionImage = options.map((o) => (o ? str(obj(o.image).image_url) : null)).find((s) => !!s) ?? null
    const modelStatus = str(m.model_status)
    return [
      {
        id,
        variationId: modelId,
        sku: str(m.model_sku),
        title: names.length ? `${title} - ${names.join(' / ')}` : title,
        price: currentPrice(m.price_info),
        stock: availableStock(m.stock_info_v2),
        // MODEL_UNAVAILABLE: a variação não aparece para o comprador; nas demais vale a situação do anúncio.
        status: modelStatus === 'MODEL_UNAVAILABLE' ? modelStatus : status,
        url: null,
        image: optionImage ?? image,
      },
    ]
  })
}

export const shopee: ChannelAdapter = {
  key: 'shopee',
  label: 'Shopee',
  appFields: [
    {
      key: 'appId',
      label: 'Partner ID',
      secret: false,
      help: 'No Shopee Open Platform Console (open.shopee.com), menu App List: abra o aplicativo e copie o Partner ID (Live Partner ID para a loja real; Test Partner ID só funciona no sandbox).',
    },
    {
      key: 'appSecret',
      label: 'Partner Key',
      secret: true,
      help: 'Na mesma tela do aplicativo em App List, a Partner Key (Live ou Test, do mesmo ambiente do Partner ID). Cadastre também o domínio do CRM em Redirect URL Domain.',
    },
    {
      key: 'host',
      label: 'Ambiente',
      secret: false,
      help: 'Produção para a loja real. Teste (sandbox) só com Test Partner ID e lojas de teste criadas no Console.',
      options: [
        { value: SHOPEE_HOSTS.producao, label: 'Produção' },
        { value: SHOPEE_HOSTS.producaoAmericas, label: 'Produção (servidor nas Américas)' },
        { value: SHOPEE_HOSTS.sandbox, label: 'Teste (sandbox)' },
      ],
    },
  ],

  authUrl(app, redirectUri, state) {
    const partnerId = partnerIdOf(app)
    const qs = new URLSearchParams({ partner_id: partnerId, auth_type: 'seller', redirect_uri: redirectUri, response_type: 'code', state })
    return `${isSandbox(app) ? SHOPEE_AUTH_BR_SANDBOX : SHOPEE_AUTH_BR}?${qs.toString()}`
  },

  async exchangeCode(app, params, _redirectUri, f = fetch, now = Date.now()) {
    const code = (params.code ?? '').trim()
    if (!code) throw new ChannelError('Shopee: o retorno da autorização veio sem o código (code).')
    const digits = (v: string | undefined) => (/^\d+$/.test((v ?? '').trim()) ? (v ?? '').trim() : '')
    const shopIdParam = digits(params.shop_id)
    const mainAccountId = digits(params.main_account_id)
    if (!shopIdParam && !mainAccountId) {
      throw new ChannelError('Shopee: o retorno da autorização veio sem o shop_id da loja.')
    }
    const partnerId = Number(partnerIdOf(app))
    const body: Json = shopIdParam ? { code, partner_id: partnerId, shop_id: Number(shopIdParam) } : { code, partner_id: partnerId, main_account_id: Number(mainAccountId) }
    const res = await publicPost(app, SHOPEE_PATHS.token, body, f, now)
    let shopId = shopIdParam
    if (!shopId) {
      const list = Array.isArray(res.shop_id_list) ? res.shop_id_list.map((x) => str(x)).filter((x): x is string => !!x) : []
      if (list.length !== 1) {
        throw new ChannelError('Shopee: a autorização pela conta principal trouxe mais de uma loja (ou nenhuma). Autorize entrando com a conta da loja.')
      }
      shopId = list[0] ?? ''
    }
    return withShopInfo(app, tokensFrom(res, shopId, now), f, now)
  },

  async refresh(app, tokens, f = fetch, now = Date.now()) {
    const partnerId = Number(partnerIdOf(app))
    const res = await publicPost(app, SHOPEE_PATHS.refresh, { refresh_token: tokens.refreshToken, partner_id: partnerId, shop_id: Number(tokens.shopId) }, f, now)
    const next = tokensFrom(res, str(res.shop_id) ?? tokens.shopId, now, tokens)
    // A autorização tem validade própria: a renovação não passa dela.
    const authEnds = num(tokens.extra?.authExpiresAt)
    if (authEnds && next.refreshExpiresAt) next.refreshExpiresAt = Math.min(next.refreshExpiresAt, authEnds)
    return next
  },

  async listListings(app, tokens, cursor, f = fetch, now = Date.now()) {
    const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0
    const page = obj(
      (await shopGet(app, tokens, SHOPEE_PATHS.itemList, { offset, page_size: PAGE_SIZE, item_status: ['NORMAL'] }, f, now)).response,
    )
    const ids = arr(page.item)
      .map((i) => str(i.item_id))
      .filter((x): x is string => !!x)
    const items: ChannelListing[] = []
    for (const batch of chunk(ids, BASE_INFO_MAX)) {
      const info = obj((await shopGet(app, tokens, SHOPEE_PATHS.itemBaseInfo, { item_id_list: batch.join(',') }, f, now)).response)
      const byId = new Map(arr(info.item_list).map((it) => [str(it.item_id), it]))
      for (const id of batch) {
        const item = byId.get(id)
        if (!item) continue
        const models = item.has_model === true ? obj((await shopGet(app, tokens, SHOPEE_PATHS.modelList, { item_id: id }, f, now)).response) : null
        items.push(...shopeeRows(item, models))
      }
    }
    const nextOffset = num(page.next_offset)
    return { items, next: page.has_next_page === true && nextOffset !== null && nextOffset > offset ? String(nextOffset) : null }
  },

  async updatePrice(app, tokens, listing, price, f = fetch, now = Date.now()) {
    if (!/^\d+$/.test(listing.id)) throw new ChannelError('Shopee: id do anúncio inválido.')
    if (!Number.isFinite(price) || price <= 0) throw new ChannelError('Shopee: preço inválido.')
    // Brasil aceita duas casas decimais (descrição de original_price em v2.product.update_price).
    const original_price = Math.round(price * 100) / 100
    const entry: Json = listing.variationId && /^\d+$/.test(listing.variationId) ? { model_id: Number(listing.variationId), original_price } : { original_price }
    const res = await shopPost(app, tokens, SHOPEE_PATHS.updatePrice, { item_id: Number(listing.id), price_list: [entry] }, f, now)
    const failure = arr(obj(res.response).failure_list)[0]
    if (failure) throw new ChannelError(`Shopee não aceitou o preço: ${str(failure.failed_reason) ?? 'sem motivo informado'}`)
  },
}
