/**
 * Amazon (Selling Partner API, loja Amazon.com.br). Segue só a documentação oficial:
 * - Autorização pelo site: https://developer-docs.amazon.com/sp-api/docs/website-authorization-workflow
 * - Token do Login with Amazon (LWA) e cabeçalhos: https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api
 * - Endpoints por região: https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints
 * - Marketplace do Brasil: https://developer-docs.amazon.com/sp-api/docs/marketplace-ids
 * - Seller Central do Brasil: https://developer-docs.amazon.com/sp-api/docs/seller-central-urls
 * - Anúncios (Listings Items API 2021-08-01): https://developer-docs.amazon.com/sp-api/reference/listings-items-v2021-08-01
 *   (modelo: github.com/amzn/selling-partner-api-models/models/listings-items-api-model/listingsItems_2021-08-01.json)
 * - Preço (purchasable_offer / our_price): https://developer-docs.amazon.com/sp-api/docs/manage-purchasable-offer
 * - Nome da loja (Sellers API getMarketplaceParticipations): models/sellers-api-model/sellers.json
 *
 * A documentação atual não pede assinatura AWS (SigV4): a chamada leva só o access token do LWA em
 * `x-amz-access-token`, mais `x-amz-date` e `user-agent`. Por isso aqui não há assinatura.
 *
 * Fluxo de autorização pelo site (passos da Amazon): o lojista abre o authUrl no Seller Central; a Amazon chama o
 * "Log-in URI" cadastrado no aplicativo com amazon_callback_uri, amazon_state e selling_partner_id; o sistema devolve o
 * lojista para amazon_callback_uri (ver `amazonLoginRedirect`); a Amazon então manda para o "Redirect URI" com
 * spapi_oauth_code, state e selling_partner_id (é aí que entra `exchangeCode`). O código vale 5 minutos.
 */
import { ChannelError, type AppField, type ChannelAdapter, type ChannelApp, type ChannelListing, type ChannelTokens, type Fetcher } from './tipos'

export const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
/** Marketplace Amazon.com.br (tabela "North America and Brazil"). */
export const AMAZON_BR_MARKETPLACE_ID = 'A2Q3Y263D00KWC'
/** Seller Central do Brasil (base do link de consentimento). */
export const AMAZON_BR_SELLER_CENTRAL = 'https://sellercentral.amazon.com.br'
/** Endpoints por região. Só a América do Norte (que atende a loja do Brasil) está liberada aqui. */
export const AMAZON_ENDPOINTS: Record<string, string> = { na: 'https://sellingpartnerapi-na.amazon.com' }

/** A documentação pede user-agent com nome do app, versão e linguagem em toda chamada à SP-API. */
const USER_AGENT = 'CRM-Usaparts/1.0 (Language=TypeScript; Platform=Node.js)'
/** O lojista precisa reautorizar o aplicativo público a cada 365 dias (docs: reauthorize-applications). */
const REAUTH_MS = 365 * 24 * 3600 * 1000
/** Máximo de pageSize do searchListingsItems. */
const PAGE_SIZE = 20

const fields: AppField[] = [
  {
    key: 'appId',
    label: 'Client ID (LWA)',
    secret: false,
    help: 'Solution Provider Portal (ou Seller Central › Apps e serviços › Desenvolver aplicativos) › seu aplicativo › Credenciais LWA › Client identifier.',
  },
  {
    key: 'appSecret',
    label: 'Client Secret (LWA)',
    secret: true,
    help: 'Na mesma tela das credenciais LWA, o Client secret. Fica guardado criptografado.',
  },
  {
    key: 'applicationId',
    label: 'ID do aplicativo (App ID)',
    secret: false,
    help: 'Identificador do aplicativo na Amazon, começa com amzn1.sp.solution ou amzn1.sellerapps.app. Usado no link de autorização.',
  },
  {
    key: 'region',
    label: 'Região da SP-API',
    secret: false,
    help: 'A loja Amazon.com.br é atendida pelo endpoint da América do Norte.',
    options: [{ value: 'na', label: 'América do Norte (inclui Brasil)' }],
  },
  {
    key: 'version',
    label: 'Situação do aplicativo',
    secret: false,
    help: 'Use "Rascunho" só para testar um aplicativo que ainda está em Draft (a Amazon pede version=beta no link).',
    options: [
      { value: '', label: 'Publicado' },
      { value: 'beta', label: 'Rascunho (Draft)' },
    ],
  },
]

function endpointOf(app: ChannelApp): string {
  const region = (app.extra.region || 'na').toLowerCase()
  const url = AMAZON_ENDPOINTS[region]
  if (!url) throw new ChannelError(`Amazon: região "${region}" não suportada.`)
  return url
}

function marketplaceOf(tokens: ChannelTokens): string {
  return tokens.extra.marketplaceId || AMAZON_BR_MARKETPLACE_ID
}

/** Formato de x-amz-date do exemplo da documentação (20190430T123600Z). */
export function amzDate(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

/** Mensagem dos erros da SP-API ({ errors: [{ code, message, details }] }). */
export function spApiErrorMessage(body: any): string | null {
  const errors = Array.isArray(body?.errors) ? body.errors : []
  const parts = errors
    .map((e: any) => [e?.message, e?.details].filter((x) => typeof x === 'string' && x.trim()).join(' — ') || e?.code)
    .filter(Boolean)
  return parts.length ? parts.join('; ') : null
}

// ---------------------------------------------------------------- LWA

async function lwaToken(form: Record<string, string>, f: Fetcher, prefix: string): Promise<any> {
  const res = await f(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  })
  const body = await readJson(res)
  if (!res.ok || !body?.access_token) {
    // Erros do LWA: { error, error_description } (Login with Amazon, Access Token Errors).
    const msg = body?.error_description || body?.error || spApiErrorMessage(body) || `HTTP ${res.status}`
    throw new ChannelError(`${prefix}: ${msg}`, res.status)
  }
  return body
}

function requireApp(app: ChannelApp) {
  if (!app.appId || !app.appSecret) throw new ChannelError('Amazon: informe o Client ID e o Client Secret do LWA.')
}

// ---------------------------------------------------------------- SP-API

interface SpRequest {
  method: 'GET' | 'PATCH'
  path: string
  query?: [string, string][]
  body?: unknown
}

/** Monta a query sem codificar as vírgulas das listas (a SP-API não distingue %2C de vírgula). */
function queryString(query: [string, string][] = []): string {
  if (!query.length) return ''
  return '?' + query.map(([k, v]) => `${encodeURIComponent(k)}=${v.split(',').map(encodeURIComponent).join(',')}`).join('&')
}

async function spApi(app: ChannelApp, tokens: ChannelTokens, req: SpRequest, f: Fetcher, now: number, prefix: string): Promise<any> {
  const headers: Record<string, string> = {
    'x-amz-access-token': tokens.accessToken,
    'x-amz-date': amzDate(now),
    'user-agent': USER_AGENT,
    accept: 'application/json',
  }
  if (req.body !== undefined) headers['content-type'] = 'application/json'
  const res = await f(endpointOf(app) + req.path + queryString(req.query), {
    method: req.method,
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
  })
  const body = await readJson(res)
  if (!res.ok) throw new ChannelError(`${prefix}: ${spApiErrorMessage(body) || `HTTP ${res.status}`}`, res.status)
  return body
}

// ---------------------------------------------------------------- conversão

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function byMarketplace<T extends { marketplaceId?: string }>(list: unknown, marketplaceId: string): T | undefined {
  if (!Array.isArray(list)) return undefined
  return (list as T[]).find((x) => x?.marketplaceId === marketplaceId)
}

/** Converte um item do searchListingsItems/getListingsItem para o formato do CRM. */
export function amazonListing(item: any, marketplaceId: string): ChannelListing {
  const sku = String(item?.sku ?? '')
  const summary = byMarketplace<any>(item?.summaries, marketplaceId) ?? (Array.isArray(item?.summaries) ? item.summaries[0] : undefined)
  const offers: any[] = Array.isArray(item?.offers) ? item.offers.filter((o: any) => o?.marketplaceId === marketplaceId) : []
  const offer = offers.find((o) => o?.offerType === 'B2C') ?? offers[0]
  const avail: any[] = Array.isArray(item?.fulfillmentAvailability) ? item.fulfillmentAvailability : []
  const quantities = avail.map((a) => num(a?.quantity)).filter((q): q is number => q !== null)
  const asin = typeof summary?.asin === 'string' && summary.asin ? summary.asin : null
  return {
    id: sku,
    variationId: null,
    sku: sku || null,
    title: (typeof summary?.itemName === 'string' && summary.itemName) || sku,
    price: num(offer?.price?.amount),
    stock: quantities.length ? quantities.reduce((a, b) => a + b, 0) : null,
    status: Array.isArray(summary?.status) ? summary.status.join(',') : '',
    url: asin ? `https://www.amazon.com.br/dp/${encodeURIComponent(asin)}` : null,
    image: (typeof summary?.mainImage?.link === 'string' && summary.mainImage.link) || null,
  }
}

/** Corpo do patchListingsItem para mudar só o preço base (our_price), como no guia "Manage purchasable offer". */
export function amazonPriceBody(productType: string, marketplaceId: string, currency: string, price: number) {
  return {
    productType,
    patches: [
      {
        op: 'merge',
        path: '/attributes/purchasable_offer',
        value: [
          {
            marketplace_id: marketplaceId,
            currency,
            audience: 'ALL',
            our_price: [{ schedule: [{ value_with_tax: Math.round(price * 100) / 100 }] }],
          },
        ],
      },
    ],
  }
}

/**
 * Passo do "Log-in URI": a Amazon chama o sistema com amazon_callback_uri, amazon_state e selling_partner_id; o sistema
 * devolve o lojista para amazon_callback_uri com amazon_state, um state novo e o redirect_uri (cadastrado no aplicativo).
 * Retorna a URL para onde redirecionar. Só aceita destino https em domínio da Amazon.
 */
export function amazonLoginRedirect(app: ChannelApp, params: Record<string, string>, redirectUri: string, state: string): string {
  const callback = params.amazon_callback_uri
  const amazonState = params.amazon_state
  if (!callback || !amazonState) throw new ChannelError('Amazon: o retorno não trouxe amazon_callback_uri e amazon_state.')
  let url: URL
  try {
    url = new URL(callback)
  } catch {
    throw new ChannelError('Amazon: amazon_callback_uri inválido.')
  }
  if (url.protocol !== 'https:' || !/(^|\.)amazon\.com(\.br)?$/i.test(url.hostname)) {
    throw new ChannelError('Amazon: amazon_callback_uri fora do domínio da Amazon.')
  }
  url.searchParams.set('amazon_state', amazonState)
  url.searchParams.set('state', state)
  if (redirectUri) url.searchParams.set('redirect_uri', redirectUri)
  if (app.extra.version === 'beta' || params.version === 'beta') url.searchParams.set('version', 'beta')
  return url.toString()
}

// ---------------------------------------------------------------- adaptador

export const amazon: ChannelAdapter = {
  key: 'amazon',
  label: 'Amazon',
  appFields: fields,

  authUrl(app, _redirectUri, state) {
    // A documentação do link de consentimento só prevê application_id, state e (rascunho) version=beta; o retorno vai
    // para o Redirect URI cadastrado no aplicativo.
    const applicationId = (app.extra.applicationId || '').trim()
    if (!applicationId) throw new ChannelError('Amazon: informe o ID do aplicativo (App ID).')
    const q = new URLSearchParams({ application_id: applicationId, state })
    if (app.extra.version === 'beta') q.set('version', 'beta')
    return `${AMAZON_BR_SELLER_CENTRAL}/apps/authorize/consent?${q.toString()}`
  },

  async exchangeCode(app, params, redirectUri, f = fetch, now = Date.now()) {
    requireApp(app)
    const code = params.spapi_oauth_code
    if (!code) {
      if (params.amazon_callback_uri) {
        throw new ChannelError('Amazon: este retorno é a etapa de login (Log-in URI); devolva o lojista para amazon_callback_uri antes de trocar o código.')
      }
      throw new ChannelError('Amazon: o retorno não trouxe o código de autorização (spapi_oauth_code).')
    }
    const sellerId = params.selling_partner_id
    if (!sellerId) throw new ChannelError('Amazon: o retorno não trouxe o selling_partner_id.')
    const body = await lwaToken(
      { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: app.appId, client_secret: app.appSecret },
      f,
      'Amazon recusou a autorização',
    )
    if (!body.refresh_token) throw new ChannelError('Amazon recusou a autorização: o LWA não devolveu o refresh token.')
    const tokens: ChannelTokens = {
      accessToken: String(body.access_token),
      refreshToken: String(body.refresh_token),
      expiresAt: now + (num(body.expires_in) ?? 3600) * 1000,
      refreshExpiresAt: now + REAUTH_MS,
      shopId: sellerId,
      shopName: null,
      extra: { marketplaceId: AMAZON_BR_MARKETPLACE_ID },
    }
    // Nome da loja e moeda do marketplace (Sellers API). Se o aplicativo não tiver acesso, segue sem eles.
    try {
      const part = await spApi(app, tokens, { method: 'GET', path: '/sellers/v1/marketplaceParticipations' }, f, now, 'Amazon')
      const list: any[] = Array.isArray(part?.payload) ? part.payload : []
      const br = list.find((p) => p?.marketplace?.id === AMAZON_BR_MARKETPLACE_ID)
      if (br?.storeName) tokens.shopName = String(br.storeName)
      if (br?.marketplace?.defaultCurrencyCode) tokens.extra.currency = String(br.marketplace.defaultCurrencyCode)
    } catch {
      /* opcional */
    }
    return tokens
  },

  async refresh(app, tokens, f = fetch, now = Date.now()) {
    requireApp(app)
    if (!tokens.refreshToken) throw new ChannelError('Amazon: a loja não tem refresh token; autorize de novo.')
    const body = await lwaToken(
      { grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: app.appId, client_secret: app.appSecret },
      f,
      'Amazon recusou a renovação do acesso',
    )
    return {
      ...tokens,
      accessToken: String(body.access_token),
      refreshToken: body.refresh_token ? String(body.refresh_token) : tokens.refreshToken,
      expiresAt: now + (num(body.expires_in) ?? 3600) * 1000,
    }
  },

  async listListings(app, tokens, cursor, f = fetch, now = Date.now()) {
    const marketplaceId = marketplaceOf(tokens)
    const query: [string, string][] = [
      ['marketplaceIds', marketplaceId],
      ['includedData', 'summaries,offers,fulfillmentAvailability'],
      ['pageSize', String(PAGE_SIZE)],
      ['sortBy', 'sku'],
      ['sortOrder', 'ASC'],
    ]
    if (cursor) query.push(['pageToken', cursor])
    const body = await spApi(
      app,
      tokens,
      { method: 'GET', path: `/listings/2021-08-01/items/${encodeURIComponent(tokens.shopId)}`, query },
      f,
      now,
      'Amazon recusou a lista de anúncios',
    )
    const items: any[] = Array.isArray(body?.items) ? body.items : []
    const next = body?.pagination?.nextToken
    return {
      items: items.filter((i) => i?.sku).map((i) => amazonListing(i, marketplaceId)),
      next: typeof next === 'string' && next ? next : null,
    }
  },

  async updatePrice(app, tokens, listing, price, f = fetch, now = Date.now()) {
    if (!(Number.isFinite(price) && price > 0)) throw new ChannelError('Amazon: preço inválido.')
    const sku = listing.sku || listing.id
    if (!sku) throw new ChannelError('Amazon: anúncio sem SKU.')
    const marketplaceId = marketplaceOf(tokens)
    const path = `/listings/2021-08-01/items/${encodeURIComponent(tokens.shopId)}/${encodeURIComponent(sku)}`
    // O patchListingsItem exige o productType: vem do resumo do próprio anúncio.
    const current = await spApi(
      app,
      tokens,
      { method: 'GET', path, query: [['marketplaceIds', marketplaceId], ['includedData', 'summaries,offers']] },
      f,
      now,
      'Amazon recusou a leitura do anúncio',
    )
    const summary = byMarketplace<any>(current?.summaries, marketplaceId)
    const productType = summary?.productType
    if (!productType) throw new ChannelError('Amazon: o anúncio não informou o tipo de produto (productType) neste marketplace.')
    const offer = Array.isArray(current?.offers)
      ? current.offers.find((o: any) => o?.marketplaceId === marketplaceId && o?.offerType === 'B2C')
      : undefined
    const currency = offer?.price?.currencyCode || tokens.extra.currency || (marketplaceId === AMAZON_BR_MARKETPLACE_ID ? 'BRL' : '')
    if (!currency) throw new ChannelError('Amazon: não foi possível saber a moeda do anúncio.')
    const result = await spApi(
      app,
      tokens,
      { method: 'PATCH', path, query: [['marketplaceIds', marketplaceId]], body: amazonPriceBody(productType, marketplaceId, currency, price) },
      f,
      now,
      'Amazon recusou o preço',
    )
    if (result?.status === 'INVALID') {
      const issues: any[] = Array.isArray(result?.issues) ? result.issues : []
      const msgs = issues.filter((i) => i?.severity === 'ERROR').map((i) => i?.message).filter(Boolean)
      throw new ChannelError(`Amazon recusou o preço: ${msgs.join('; ') || 'envio inválido'}`, 400)
    }
  },
}
