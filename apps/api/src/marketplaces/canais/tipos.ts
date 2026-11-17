/**
 * Marketplaces além do Mercado Livre (Shopee, Amazon, TikTok Shop): o contrato comum de cada integração. Cada
 * adaptador (shopee.ts, amazon.ts, tiktok.ts) segue só a documentação oficial da plataforma e não guarda nada: recebe as
 * chaves do aplicativo e os tokens da loja e devolve dados limpos. Quem guarda (criptografado) é o canais.service.ts.
 */

export type ChannelKey = 'shopee' | 'amazon' | 'tiktok'
export const CHANNEL_KEYS: ChannelKey[] = ['shopee', 'amazon', 'tiktok']

/** Chaves do aplicativo de desenvolvedor da empresa na plataforma (coladas no sistema, nunca no chat). */
export interface ChannelApp {
  /** Shopee: Partner ID. Amazon: client_id do LWA. TikTok Shop: App Key. */
  appId: string
  /** Shopee: Partner Key. Amazon: client_secret do LWA. TikTok Shop: App Secret. */
  appSecret: string
  /**
   * Outras chaves que a plataforma pede, por nome (ex.: Amazon: applicationId e region; TikTok Shop: serviceId).
   * Cada adaptador diz quais usa em `appFields`.
   */
  extra: Record<string, string>
}

/** Tokens da loja conectada (depois da autorização do lojista). */
export interface ChannelTokens {
  accessToken: string
  refreshToken: string
  /** Quando o access token vence (ms desde 1970). */
  expiresAt: number
  /** Quando o refresh token vence (ms); null se a plataforma não informa. */
  refreshExpiresAt: number | null
  /** Identificador da loja/vendedor (Shopee: shop_id; Amazon: selling_partner_id; TikTok Shop: shop_cipher). */
  shopId: string
  shopName: string | null
  /** O que mais a plataforma precisa nas chamadas (ex.: Amazon: marketplaceId; TikTok Shop: shopId). */
  extra: Record<string, string>
}

/** Um anúncio (ou variação) da loja, já no formato do CRM. */
export interface ChannelListing {
  /** Id do anúncio na plataforma (Shopee: item_id; Amazon: SKU do vendedor; TikTok Shop: product_id). */
  id: string
  /** Variação (Shopee: model_id; TikTok Shop: sku_id); null quando o anúncio não tem variações. */
  variationId: string | null
  /** SKU do vendedor (código do produto no ERP), quando informado no anúncio. */
  sku: string | null
  title: string
  /** Preço atual de venda (R$). */
  price: number | null
  /** Estoque disponível. */
  stock: number | null
  /** Situação na plataforma, como ela informa (ex.: NORMAL, ACTIVE, BUYABLE). */
  status: string
  url: string | null
  image: string | null
}

export interface ListPage {
  items: ChannelListing[]
  /** Cursor da próxima página; null = acabou. */
  next: string | null
}

/** Campo de chave que a tela pede ao cadastrar o aplicativo. */
export interface AppField {
  key: 'appId' | 'appSecret' | string
  label: string
  secret: boolean
  /** Ajuda curta para a tela (onde achar no painel do desenvolvedor). */
  help: string
  /** Valores possíveis (ex.: região da Amazon); vazio = texto livre. */
  options?: { value: string; label: string }[]
}

export type Fetcher = typeof fetch

export interface ChannelAdapter {
  key: ChannelKey
  label: string
  appFields: AppField[]
  /**
   * Link para o lojista autorizar o aplicativo. O retorno vem em redirectUri com o código; `state` volta igual (quando a
   * plataforma não devolve state, o adaptador o põe no próprio redirectUri como ?state=).
   */
  authUrl(app: ChannelApp, redirectUri: string, state: string, now?: number): string
  /** Troca o código do retorno (todos os parâmetros que voltaram na URL) pelos tokens da loja. */
  exchangeCode(app: ChannelApp, params: Record<string, string>, redirectUri: string, f?: Fetcher, now?: number): Promise<ChannelTokens>
  /** Renova o access token com o refresh token. */
  refresh(app: ChannelApp, tokens: ChannelTokens, f?: Fetcher, now?: number): Promise<ChannelTokens>
  /** Uma página dos anúncios ativos (com as variações já abertas, uma linha por variação). */
  listListings(app: ChannelApp, tokens: ChannelTokens, cursor: string | null, f?: Fetcher, now?: number): Promise<ListPage>
  /** Muda o preço de um anúncio (ou variação). Lança Error com a mensagem da plataforma quando ela recusa. */
  updatePrice(app: ChannelApp, tokens: ChannelTokens, listing: Pick<ChannelListing, 'id' | 'variationId' | 'sku'>, price: number, f?: Fetcher, now?: number): Promise<void>
}

/** Erro da plataforma, com a mensagem dela (para a tela) e o código HTTP. */
export class ChannelError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message)
  }
}
