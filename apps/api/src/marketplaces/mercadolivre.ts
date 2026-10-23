// Mercado Livre Ads (Product Ads e Display Ads): constantes, configuração e leitura das respostas da API, sem banco.
// Documentação: developers.mercadolivre.com.br — "Autenticação e Autorização" e "Product Ads" (api-version 2, Ad Groups).
// Veio do Usaparts BI (src/lib/integrations/mercadolivre.ts e ml-calc.ts), com os mesmos cálculos.

export const ML_API = 'https://api.mercadolibre.com'
export const ML_AUTH_URL = 'https://auth.mercadolivre.com.br/authorization'
/** Endereço do CRM para onde o Mercado Livre volta depois da autorização (cadastrado no aplicativo do Mercado Livre). */
export const ML_CALLBACK_PATH = '/marketplaces/mercado-livre/retorno'

export const ML_CONFIG_KEY = 'marketplace_ml'
export const ML_SYNC_KEY = 'marketplace_ml_sync'
export const ML_OAUTH_KEY = 'marketplace_ml_oauth'
export const MARKETPLACE = 'mercadolivre'

/** A API de métricas só permite consultar 90 dias para trás. */
export const ML_MAX_HISTORY_DAYS = 90
/** Janela de atribuição do Product Ads (14 dias) + 1: reprocessada a cada sincronização. */
export const ML_ATTRIBUTION_DAYS = 15
/** Sincronização automática a cada 6 horas. */
export const ML_SYNC_HOURS = 6

export type MlStatus = 'DESCONECTADO' | 'CONECTADO' | 'ERRO'

export interface MlConfig {
  clientId: string
  clientSecretEnc: string | null
  status: MlStatus
  accessTokenEnc: string | null
  refreshTokenEnc: string | null
  tokenExpiresAt: string | null
  userId: string | null
  nickname: string | null
  advertiserId: string | null
  siteId: string | null
  advertiserName: string | null
  /** Anunciante de Display Ads (habilitado pelo assessor comercial do Mercado Livre; pode ser outro). */
  displayAdvertiserId: string | null
  displayStatus: 'ATIVO' | 'NAO_HABILITADO' | null
  connectedAt: string | null
  connectedBy: string | null
  lastError: string | null
}

export const DEFAULT_ML: MlConfig = {
  clientId: '',
  clientSecretEnc: null,
  status: 'DESCONECTADO',
  accessTokenEnc: null,
  refreshTokenEnc: null,
  tokenExpiresAt: null,
  userId: null,
  nickname: null,
  advertiserId: null,
  siteId: null,
  advertiserName: null,
  displayAdvertiserId: null,
  displayStatus: null,
  connectedAt: null,
  connectedBy: null,
  lastError: null,
}

export interface MlSyncState {
  lastRunAt?: string
  lastOkAt?: string
  lastError?: string | null
  running?: boolean
  rows?: number
  apiCalls?: number
  from?: string
  to?: string
}

/** O que vai para a tela: nunca os tokens nem o segredo. */
export function mlView(c: MlConfig) {
  const { clientSecretEnc, accessTokenEnc, refreshTokenEnc, ...rest } = c
  return { ...rest, hasSecret: !!clientSecretEnc, connected: c.status !== 'DESCONECTADO' && !!refreshTokenEnc && !!accessTokenEnc }
}

export class MlError extends Error {
  constructor(
    message: string,
    public status?: number,
    public reconnect = false,
    public noPermission = false,
  ) {
    super(message)
  }
}

/** Erro do pedido de token: autorização revogada ou expirada pede Reconectar. */
export function tokenError(status: number, body: { error?: string; message?: string; error_description?: string } | null) {
  const reconnect = body?.error === 'invalid_grant' || body?.error === 'unauthorized_client'
  // Client ID ou Client Secret errado (ex.: segredo trocado no aplicativo do Mercado Livre): é só salvar o certo.
  if (body?.error === 'invalid_client') return new MlError('O Mercado Livre não aceitou o Client Secret deste aplicativo. Em developers.mercadolivre.com.br › Minhas aplicações, abra o aplicativo com este Client ID, copie o Client Secret, cole em Credenciais do aplicativo, salve e clique em Testar conexão.', status, false)
  return new MlError(
    reconnect ? 'A autorização do Mercado Livre expirou ou foi revogada. Clique em Reconectar.' : `O Mercado Livre recusou o token (${body?.error ?? status}): ${body?.message ?? body?.error_description ?? ''}`.trim(),
    status,
    reconnect,
  )
}

// ---------- Datas ----------

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
/** Hoje no horário de Brasília. */
export const todayBr = (now = Date.now()) => new Date(now - 3 * 3_600_000).toISOString().slice(0, 10)

/** Período a sincronizar: 90 dias na primeira vez; depois, os últimos 15 (atribuição tardia). Sempre até ontem. */
export function syncWindow(hasData: boolean, today = todayBr()) {
  const yesterday = addDays(today, -1)
  const days = hasData ? ML_ATTRIBUTION_DAYS : ML_MAX_HISTORY_DAYS
  return { from: addDays(yesterday, -(days - 1)), to: yesterday }
}

/** Período anterior do mesmo tamanho, para comparar. */
export function previousPeriod(from: string, to: string) {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  return { from: addDays(from, -days), to: addDays(from, -1) }
}

// ---------- Indicadores ----------

export interface AdTotals {
  impressions: number
  clicks: number
  cost: number
  revenue: number
  directRevenue: number
  indirectRevenue: number
  units: number
  items: number
}

const div = (a: number, b: number) => (b > 0 ? a / b : null)
const round = (v: number | null, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)

/** Indicadores derivados, sempre das somas do período (nunca somando taxas diárias). */
export function derive<T extends AdTotals>(t: T) {
  return {
    ...t,
    ctr: round(div(t.clicks * 100, t.impressions)),
    cpc: round(div(t.cost, t.clicks)),
    cpm: round(div(t.cost * 1000, t.impressions)),
    roas: round(div(t.revenue, t.cost)),
    acos: round(div(t.cost * 100, t.revenue)),
    cvr: round(div(t.items * 100, t.clicks)),
  }
}

/** Variação percentual contra o período anterior (sem base: null). */
export function delta(now: number | null, before: number | null) {
  if (now === null || before === null || before === 0) return null
  return round(((now - before) / Math.abs(before)) * 100, 1)
}

// ---------- Respostas da API ----------

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
export const int = (v: unknown) => Math.round(n(v))
export const money = (v: unknown) => Math.round(n(v) * 100) / 100

/** Linha do dia gravada em marketplace_ad_days. */
export interface DayRow {
  date: string
  impressions: number
  clicks: number
  cost: number
  revenue: number
  directRevenue: number
  indirectRevenue: number
  units: number
  directUnits: number
  indirectUnits: number
  items: number
  organicUnits: number
  organicRevenue: number
  pageViews: number
  addToCart: number
  checkouts: number
  eventRevenue: number
}

const EMPTY: Omit<DayRow, 'date'> = { impressions: 0, clicks: 0, cost: 0, revenue: 0, directRevenue: 0, indirectRevenue: 0, units: 0, directUnits: 0, indirectUnits: 0, items: 0, organicUnits: 0, organicRevenue: 0, pageViews: 0, addToCart: 0, checkouts: 0, eventRevenue: 0 }
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

export const CAMPAIGN_METRICS = ['clicks', 'prints', 'cost', 'direct_amount', 'indirect_amount', 'total_amount', 'direct_units_quantity', 'indirect_units_quantity', 'units_quantity', 'advertising_items_quantity', 'organic_units_quantity', 'organic_units_amount'].join(',')
export const ADGROUP_METRICS = ['clicks', 'prints', 'cost', 'direct_amount', 'indirect_amount', 'total_amount', 'units_quantity', 'advertising_items_quantity'].join(',')

type Metrics = Record<string, unknown>

function productAdsRow(date: string, m: Metrics): DayRow {
  return {
    ...EMPTY,
    date,
    impressions: int(m.prints),
    clicks: int(m.clicks),
    cost: money(m.cost),
    revenue: money(m.total_amount),
    directRevenue: money(m.direct_amount),
    indirectRevenue: money(m.indirect_amount),
    units: int(m.units_quantity),
    directUnits: int(m.direct_units_quantity),
    indirectUnits: int(m.indirect_units_quantity),
    items: int(m.advertising_items_quantity),
    organicUnits: int(m.organic_units_quantity),
    organicRevenue: money(m.organic_units_amount),
  }
}

/** Métricas diárias de uma campanha de Product Ads (a API devolve uma lista ou { results }). */
export function parseCampaignDays(raw: unknown): DayRow[] {
  const list = Array.isArray(raw) ? raw : ((raw as { results?: unknown[] } | null)?.results ?? [])
  const out: DayRow[] = []
  for (const r of list as Metrics[]) {
    const d = day(r?.date)
    if (d) out.push(productAdsRow(d, r))
  }
  return out
}

/** Métricas de um dia por grupo de anúncios ({ results: [{ ad_group_id, metrics }] }). */
export function parseAdGroupDay(raw: unknown, date: string): (DayRow & { adId: string })[] {
  const list = (raw as { results?: { ad_group_id?: unknown; metrics?: Metrics }[] } | null)?.results ?? []
  return list.filter((g) => g?.ad_group_id !== undefined && g.ad_group_id !== null).map((g) => ({ ...productAdsRow(date, g.metrics ?? {}), adId: String(g.ad_group_id) }))
}

/** Métricas diárias de Display Ads (vendas por ponto de contato, e também pela data do evento). */
export function parseDisplayDays(raw: unknown): DayRow[] {
  const list = (raw as { metrics?: Metrics[] } | null)?.metrics ?? []
  const out: DayRow[] = []
  for (const m of list) {
    const d = day(m?.date)
    if (!d) continue
    const tp = (m.touch_point ?? {}) as Metrics
    const ev = (m.event_time ?? {}) as Metrics
    const revenue = money(tp.direct_amount)
    out.push({
      ...EMPTY,
      date: d,
      impressions: int(m.prints),
      clicks: int(m.clicks),
      cost: money(m.consumed_budget),
      revenue,
      directRevenue: revenue,
      units: int(tp.units_quantity),
      items: int(tp.direct_item_quantity),
      pageViews: int(tp.attribution_ppv),
      addToCart: int(tp.attribution_add_to_cart),
      checkouts: int(tp.attribution_checkout),
      eventRevenue: money(ev.direct_amount),
    })
  }
  return out
}

export interface ApiCampaign {
  id: number | string
  name?: string
  status?: string
  strategy?: string
  budget?: number
  roas_target?: number
  acos_target?: number
  currency_id?: string
  date_created?: string
  type?: string
  goal?: string
  start_date?: string
  end_date?: string
}

export interface ApiAdGroup {
  id: number | string
  campaign_id?: number | string
  ad_group_external_id?: string
  ad_group_type?: string
  title?: string
  thumbnail?: string
  status?: string
}

/** Miniatura sempre por https (a API às vezes manda http). */
export const httpsThumb = (u: string | undefined | null) => (u ? u.replace(/^http:/, 'https:') : null)
