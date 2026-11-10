// Frete no Google Shopping: regras sem banco (test/merchant-frete.spec.ts). O frete de cada produto é simulado na
// Magazord (a mesma conta do carrinho) para um ou mais CEPs de cada estado e enviado ao Merchant Center numa fonte
// suplementar, com uma tarifa por estado (região do Merchant Center definida pelas faixas de CEP).

export const MERCHANT_KEY = 'merchant_frete'
export const CONTENT_SCOPE = 'https://www.googleapis.com/auth/content'
export const MERCHANT_API = 'https://merchantapi.googleapis.com'
export const SUPPLEMENTAL_NAME = 'CRM - Frete por estado'

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const
export type Uf = (typeof UFS)[number]

/** Faixas de CEP de cada estado, em prefixos (início e fim com o mesmo tamanho, como o Merchant Center pede). */
export const UF_CEP_RANGES: Record<Uf, [string, string][]> = {
  SP: [['01*', '19*']],
  RJ: [['20*', '28*']],
  ES: [['29*', '29*']],
  MG: [['30*', '39*']],
  BA: [['40*', '48*']],
  SE: [['49*', '49*']],
  PE: [['50*', '56*']],
  AL: [['57*', '57*']],
  PB: [['58*', '58*']],
  RN: [['59*', '59*']],
  CE: [['60*', '63*']],
  PI: [['64*', '64*']],
  MA: [['65*', '65*']],
  PA: [['66*', '67*'], ['680*', '688*']],
  AP: [['689*', '689*']],
  AM: [['690*', '692*'], ['694*', '698*']],
  RR: [['693*', '693*']],
  AC: [['699*', '699*']],
  DF: [['70*', '71*'], ['720*', '727*'], ['730*', '736*']],
  GO: [['728*', '729*'], ['737*', '739*'], ['74*', '75*'], ['760*', '767*']],
  RO: [['768*', '769*']],
  TO: [['77*', '77*']],
  MT: [['780*', '788*']],
  MS: [['79*', '79*']],
  PR: [['80*', '87*']],
  SC: [['88*', '89*']],
  RS: [['90*', '99*']],
}

/** CEP de referência de cada estado (centro da capital). Dá para trocar ou somar CEPs do interior na tela. */
export const UF_REF_CEP: Record<Uf, string> = {
  AC: '69900062', AL: '57020000', AM: '69005000', AP: '68900073', BA: '40010000', CE: '60010000', DF: '70040010', ES: '29010000',
  GO: '74003010', MA: '65010000', MG: '30110000', MS: '79002000', MT: '78005000', PA: '66010000', PB: '58010000', PE: '50010000',
  PI: '64000020', PR: '80010000', RJ: '20010000', RN: '59010000', RO: '76801000', RR: '69301000', RS: '90010000', SC: '88010000',
  SE: '49010000', SP: '01001000', TO: '77001002',
}

export const regionId = (uf: Uf) => `crm-uf-${uf.toLowerCase()}`

export interface MerchantFreteConfig {
  enabled: boolean
  /** Número da conta no Merchant Center. */
  merchantId: string
  /** E-mail Google de uma PESSOA administradora do Merchant Center: o Google não aceita conta de serviço no registro do projeto. */
  developerEmail: string
  /** Nome do serviço de entrega que aparece no Google (ex.: "Entrega"). */
  service: string
  /** Dias úteis para separar e postar o pedido (manuseio). */
  handlingMin: number
  handlingMax: number
  /** Produtos atualizados por rodada (uma por noite); cada produto leva uma simulação por CEP de cada estado. */
  batchSize: number
  /** CEPs de cada estado (vazio = o CEP de referência). Vale o frete mais alto entre eles. */
  ceps: Partial<Record<Uf, string[]>>
  /**
   * De onde vem o frete: 'magazord' simula no carrinho da loja (o mesmo valor que o cliente paga; recomendado) e
   * 'crm' calcula pelas tabelas das transportadoras cadastradas em Fretes.
   */
  source: FreteSource
  /** Fonte 'crm': filial de origem (precisa ter o CEP de expedição). */
  unitId: string | null
  /** Fonte 'crm': só estas transportadoras (vazio = todas as ativas da filial). */
  carrierIds: string[]
  /** Fonte 'magazord': consultas por minuto à simulação de frete (a Magazord responde 429 quando passa do limite). */
  magazordPerMinute: number
  /** Produto sem mudança de preço/peso/CEPs é refeito só depois destes dias (a tabela da loja pode ter mudado). */
  refreshDays: number
  /** Fonte suplementar criada no Merchant Center (accounts/{id}/dataSources/{id}). */
  dataSource: string | null
  preparedAt: string | null
  lastRunAt: string | null
  lastError: string | null
  /** Resumo da última rodada (enviados, com erro, sem mudança). */
  lastSummary: string | null
  /** Rodada pausada pelo limite da Magazord: continua a partir desta hora (dentro da janela da noite). */
  resumeAt: string | null
}

export type FreteSource = 'magazord' | 'crm'

export const DEFAULT_MERCHANT_FRETE: MerchantFreteConfig = {
  enabled: false,
  merchantId: '',
  developerEmail: '',
  service: 'Entrega',
  handlingMin: 1,
  handlingMax: 2,
  batchSize: 200,
  ceps: {},
  source: 'magazord',
  unitId: null,
  carrierIds: [],
  magazordPerMinute: 40,
  refreshDays: 7,
  dataSource: null,
  preparedAt: null,
  lastRunAt: null,
  lastError: null,
  lastSummary: null,
  resumeAt: null,
}

/** CEPs usados para o estado: os configurados (8 números) ou o de referência. */
export function cepsOf(cfg: Pick<MerchantFreteConfig, 'ceps'>, uf: Uf): string[] {
  const list = (cfg.ceps[uf] ?? []).map((c) => c.replace(/\D/g, '')).filter((c) => c.length === 8)
  return list.length ? [...new Set(list)].slice(0, 5) : [UF_REF_CEP[uf]]
}

export function cleanConfig(input: Partial<MerchantFreteConfig>, cur: MerchantFreteConfig): MerchantFreteConfig | { error: string } {
  const merchantId = String(input.merchantId ?? cur.merchantId).replace(/\D/g, '')
  const int = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v ?? d)
    return Number.isInteger(n) && n >= min && n <= max ? n : null
  }
  const handlingMin = int(input.handlingMin, cur.handlingMin, 0, 30)
  const handlingMax = int(input.handlingMax, cur.handlingMax, 0, 30)
  const batchSize = int(input.batchSize, cur.batchSize, 10, 2000)
  if (handlingMin === null || handlingMax === null || handlingMin > handlingMax) return { error: 'Prazo de manuseio: de 0 a 30 dias úteis, com o mínimo menor ou igual ao máximo.' }
  if (batchSize === null) return { error: 'Produtos por rodada: de 10 a 2.000.' }
  const magazordPerMinute = int(input.magazordPerMinute, cur.magazordPerMinute ?? DEFAULT_MERCHANT_FRETE.magazordPerMinute, 5, 120)
  if (magazordPerMinute === null) return { error: 'Consultas por minuto na Magazord: de 5 a 120.' }
  const refreshDays = int(input.refreshDays, cur.refreshDays ?? DEFAULT_MERCHANT_FRETE.refreshDays, 1, 60)
  if (refreshDays === null) return { error: 'Refazer o frete de cada produto: de 1 a 60 dias.' }
  const rawSource = input.source ?? cur.source ?? 'magazord'
  if (rawSource !== 'magazord' && rawSource !== 'crm') return { error: 'Fonte do frete inválida.' }
  const source: FreteSource = rawSource
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const rawUnit = input.unitId === undefined ? (cur.unitId ?? null) : input.unitId
  const unitId = rawUnit ? String(rawUnit).trim() : null
  if (unitId && !uuid.test(unitId)) return { error: 'Filial de origem inválida.' }
  if (source === 'crm' && !unitId) return { error: 'Escolha a filial de origem do frete calculado pelo CRM.' }
  const rawCarriers = input.carrierIds ?? cur.carrierIds ?? []
  if (!Array.isArray(rawCarriers)) return { error: 'Transportadoras inválidas.' }
  const carrierIds = [...new Set(rawCarriers.map((c) => String(c).trim()))]
  if (carrierIds.length > 50 || carrierIds.some((c) => !uuid.test(c))) return { error: 'Transportadoras inválidas.' }
  const enabled = input.enabled ?? cur.enabled
  if (enabled && !merchantId) return { error: 'Informe o número da conta do Merchant Center.' }
  const ceps: Partial<Record<Uf, string[]>> = {}
  for (const uf of UFS) {
    const raw = input.ceps?.[uf] ?? cur.ceps[uf]
    const list = (Array.isArray(raw) ? raw : []).map((c) => String(c).replace(/\D/g, '')).filter((c) => c.length === 8)
    if (list.length) ceps[uf] = [...new Set(list)].slice(0, 5)
  }
  const service = String(input.service ?? cur.service).trim().slice(0, 60) || 'Entrega'
  const developerEmail = String(input.developerEmail ?? cur.developerEmail ?? '').trim().toLowerCase().slice(0, 120)
  if (developerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(developerEmail)) return { error: 'E-mail da pessoa administradora inválido.' }
  if (developerEmail.endsWith('.gserviceaccount.com')) return { error: 'Use o e-mail Google de uma pessoa (não o da conta de serviço): o Google não aceita conta de serviço no registro.' }
  return { ...DEFAULT_MERCHANT_FRETE, ...cur, enabled, merchantId, developerEmail, service, handlingMin, handlingMax, batchSize, ceps, source, unitId, carrierIds, magazordPerMinute, refreshDays, dataSource: merchantId === cur.merchantId ? cur.dataSource : null, preparedAt: merchantId === cur.merchantId ? cur.preparedAt : null }
}

export interface UfQuote {
  uf: Uf
  /** Frete do estado (o mais alto entre os CEPs, da opção mais barata de cada um); null = sem entrega para o estado. */
  price: number | null
  days: number | null
}

/** Frete do estado: em cada CEP vale a opção mais barata; entre os CEPs, a mais cara (o anúncio nunca mostra menos que o carrinho). */
export function ufQuote(uf: Uf, perCep: { price: number; days: number | null }[][]): UfQuote {
  let price: number | null = null
  let days: number | null = null
  for (const opts of perCep) {
    if (!opts.length) return { uf, price: null, days: null }
    const best = [...opts].sort((a, b) => a.price - b.price || (a.days ?? 99) - (b.days ?? 99))[0]!
    if (price === null || best.price > price) price = best.price
    if (best.days !== null && (days === null || best.days > days)) days = best.days
  }
  return { uf, price, days }
}

const micros = (v: number) => String(Math.round(v * 1_000_000))

/** Atributo shipping do produto: uma tarifa por estado com entrega (região do Merchant Center). */
export function shippingAttribute(quotes: UfQuote[], cfg: Pick<MerchantFreteConfig, 'service' | 'handlingMin' | 'handlingMax'>) {
  return quotes
    .filter((q) => q.price !== null)
    .map((q) => ({
      price: { amountMicros: micros(q.price!), currencyCode: 'BRL' },
      country: 'BR',
      region: regionId(q.uf),
      service: cfg.service,
      ...(q.days !== null ? { minHandlingTime: String(cfg.handlingMin), maxHandlingTime: String(cfg.handlingMax), minTransitTime: String(q.days), maxTransitTime: String(q.days) } : {}),
    }))
}

/** Produto do Merchant Center → SKU da Magazord: pelo id da oferta (código ou SKU) ou pelo endereço da página. */
export function matchSku(offer: { offerId: string; link?: string | null }, store: { externalId: string; code: string; path: string | null; url: string | null }[]): string | null {
  const id = offer.offerId.trim().toLowerCase()
  const byId = store.find((s) => s.externalId.toLowerCase() === id || s.code.toLowerCase() === id)
  if (byId) return byId.externalId
  if (!offer.link) return null
  let path: string
  try {
    path = new URL(offer.link).pathname.replace(/\/+$/, '').toLowerCase()
  } catch {
    return null
  }
  if (!path) return null
  const byPath = store.find((s) => {
    const p = (s.path ?? (s.url ? (() => { try { return new URL(s.url).pathname } catch { return '' } })() : '')).replace(/\/+$/, '').toLowerCase()
    return !!p && p === path
  })
  return byPath?.externalId ?? null
}

// ---------- Ritmo das consultas à Magazord ----------

/** Esperas depois de cada 429 da Magazord (sem Retry-After); depois da última, desiste do produto nesta rodada. */
export const MAGAZORD_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const
/** Produtos seguidos sem resposta por causa do limite: a rodada pausa e continua mais tarde. */
export const PAUSE_AFTER_LIMITED = 3
/** Quanto a rodada pausada espera para continuar. */
export const RESUME_AFTER_MS = 30 * 60_000

export interface RateHeaders {
  retryAfter?: string | null
  remaining?: string | null
  reset?: string | null
}
export interface RateInfo {
  retryAfterMs: number | null
  remaining: number | null
  resetMs: number | null
}

/**
 * Cabeçalhos de limite: Retry-After (segundos ou data HTTP), X-RateLimit-Remaining e X-RateLimit-Reset (segundos até
 * liberar, ou o horário Unix em que libera).
 */
export function parseRate(h: RateHeaders, now = Date.now()): RateInfo {
  const n = (v: string | null | undefined) => {
    if (v === null || v === undefined || v.trim() === '') return null
    const x = Number(v.trim())
    return Number.isFinite(x) ? x : null
  }
  let retryAfterMs: number | null = null
  const ra = n(h.retryAfter)
  if (ra !== null) retryAfterMs = Math.max(0, ra * 1000)
  else if (h.retryAfter) {
    const at = Date.parse(h.retryAfter)
    if (Number.isFinite(at)) retryAfterMs = Math.max(0, at - now)
  }
  const remaining = n(h.remaining)
  const reset = n(h.reset)
  const resetMs = reset === null ? null : reset > 1e9 ? Math.max(0, reset * 1000 - now) : Math.max(0, reset * 1000)
  return { retryAfterMs, remaining: remaining === null ? null : Math.max(0, Math.floor(remaining)), resetMs }
}

/** Espera antes de tentar de novo depois de um 429 (null = desiste do produto nesta rodada). Máximo de 2 minutos. */
export function retryWait(attempt: number, rate: Pick<RateInfo, 'retryAfterMs'>): number | null {
  if (attempt >= MAGAZORD_BACKOFF_MS.length) return null
  const base = MAGAZORD_BACKOFF_MS[attempt]!
  return Math.min(120_000, rate.retryAfterMs !== null ? Math.max(rate.retryAfterMs, 1_000) : base)
}

export const gapOf = (perMinute: number) => Math.ceil(60_000 / Math.max(1, perMinute))

/**
 * Ritmo das chamadas: um intervalo mínimo entre elas (das consultas por minuto configuradas), que aumenta 50% a cada
 * 429 (até 15 s) e volta aos poucos ao normal; quando a Magazord avisa que acabou a cota, espera ela liberar.
 */
export class Pacer {
  gap: number
  private next = 0
  constructor(
    readonly base: number,
    readonly maxGap = 15_000,
  ) {
    this.gap = base
  }

  /** Quanto esperar antes da próxima chamada (e reserva a vez). */
  take(now: number) {
    const at = Math.max(now, this.next)
    this.next = at + this.gap
    return at - now
  }

  ok(rate: RateInfo, now: number) {
    this.gap = Math.max(this.base, Math.round(this.gap * 0.95))
    if (rate.remaining !== null && rate.resetMs !== null && rate.remaining < 3) this.next = Math.max(this.next, now + Math.ceil(rate.resetMs / (rate.remaining + 1)))
  }

  limited() {
    this.gap = Math.min(this.maxGap, Math.round(this.gap * 1.5))
  }
}

/** Consultas por produto (um CEP de cada estado, ou os configurados) e duração estimada da rodada, em minutos. */
export function estimateRun(cfg: Pick<MerchantFreteConfig, 'ceps' | 'batchSize' | 'magazordPerMinute' | 'source'>, products?: number) {
  const calls = UFS.reduce((s, uf) => s + cepsOf(cfg, uf).length, 0)
  const n = products ?? cfg.batchSize
  // Envio ao Merchant Center: uma chamada por produto, espaçada em ~1,1 s.
  const sendMs = n * 1_100
  const quoteMs = cfg.source === 'crm' ? n * calls * 20 : n * calls * gapOf(cfg.magazordPerMinute)
  return { calls, products: n, minutes: Math.ceil((sendMs + quoteMs) / 60_000) }
}

// ---------- Produtos sem mudança ----------

/** Guardado em merchant_shipping_items.quotes: frete por estado e a "impressão digital" do que foi usado no cálculo. */
export interface StoredQuotes {
  ufs: UfQuote[]
  fp: string
}
export function storedUfs(json: unknown): UfQuote[] {
  if (Array.isArray(json)) return json as UfQuote[]
  const o = json as Partial<StoredQuotes> | null
  return o && Array.isArray(o.ufs) ? o.ufs : []
}
export function storedFp(json: unknown): string | null {
  const o = json as Partial<StoredQuotes> | null
  return o && !Array.isArray(o) && typeof o.fp === 'string' ? o.fp : null
}

/** O que muda o frete do produto: fonte, preço, peso (CRM), CEPs, filial/transportadoras e versões das tabelas (CRM). */
export function fingerprint(x: { source: FreteSource; price: number; weight: number | null; ceps: Partial<Record<Uf, string[]>>; unitId?: string | null; carrierIds?: string[]; tables?: string }) {
  const ceps = UFS.map((uf) => cepsOf({ ceps: x.ceps }, uf).join(',')).join(';')
  const parts = [x.source, x.price.toFixed(2), ceps]
  if (x.source === 'crm') parts.push(x.weight === null ? '' : x.weight.toFixed(3), x.unitId ?? '', [...(x.carrierIds ?? [])].sort().join(','), x.tables ?? '')
  return parts.join('|')
}

/**
 * Precisa recalcular: nunca enviado, com erro, algo mudou (impressão digital) ou passou o prazo de refazer (a tabela
 * da loja pode ter mudado sem o CRM saber).
 */
export function isDue(item: { sentAt: Date | null; error: string | null; quotes: unknown }, fp: string, refreshDays: number, now = Date.now()) {
  if (!item.sentAt || item.error) return true
  if (storedFp(item.quotes) !== fp) return true
  return now - item.sentAt.getTime() >= refreshDays * 86_400_000
}

// ---------- Frete pelas tabelas do CRM ----------

/**
 * Peso bruto (kg) do produto na Tcar: pelo código do produto na loja (o mesmo elo do BI, store_products.code =
 * tcar_products.code) e, se não achar, pelo SKU; sem diferenciar maiúsculas. weights vem de weightIndex.
 */
export function tcarWeightFor(product: { code: string | null; externalId: string }, weights: Map<string, number | null>): number | null {
  for (const key of [product.code, product.externalId]) {
    const k = key?.trim().toLowerCase()
    if (!k) continue
    const w = weights.get(k)
    if (w !== null && w !== undefined && w > 0) return w
  }
  return null
}

/** Índice de pesos para tcarWeightFor (monta uma vez por rodada). */
export function weightIndex(rows: { code: string; grossWeight: number | null }[]) {
  const m = new Map<string, number | null>()
  for (const r of rows) {
    const k = r.code.trim().toLowerCase()
    if (!k) continue
    const cur = m.get(k)
    if (cur === undefined || cur === null || !(cur > 0)) m.set(k, r.grossWeight)
  }
  return m
}

/** Opções que valem das tabelas do CRM (status OK com valor), só das transportadoras escolhidas (vazio = todas). */
export function crmOptions(results: { status: string; total: number | null; deadlineDays: number | null; carrierId: string }[], carrierIds: string[] = []) {
  const only = new Set(carrierIds)
  return results
    .filter((r) => r.status === 'OK' && r.total !== null && r.total >= 0 && (!only.size || only.has(r.carrierId)))
    .map((r) => ({ price: Math.round(r.total! * 100) / 100, days: r.deadlineDays }))
    .sort((a, b) => a.price - b.price || (a.days ?? 99) - (b.days ?? 99))
}
