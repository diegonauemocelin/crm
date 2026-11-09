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
  /** Nome do serviço de entrega que aparece no Google (ex.: "Entrega"). */
  service: string
  /** Dias úteis para separar e postar o pedido (manuseio). */
  handlingMin: number
  handlingMax: number
  /** Produtos atualizados por rodada (uma por noite); cada produto leva uma simulação por CEP de cada estado. */
  batchSize: number
  /** CEPs de cada estado (vazio = o CEP de referência). Vale o frete mais alto entre eles. */
  ceps: Partial<Record<Uf, string[]>>
  /** Fonte suplementar criada no Merchant Center (accounts/{id}/dataSources/{id}). */
  dataSource: string | null
  preparedAt: string | null
  lastRunAt: string | null
  lastError: string | null
}

export const DEFAULT_MERCHANT_FRETE: MerchantFreteConfig = {
  enabled: false,
  merchantId: '',
  service: 'Entrega',
  handlingMin: 1,
  handlingMax: 2,
  batchSize: 200,
  ceps: {},
  dataSource: null,
  preparedAt: null,
  lastRunAt: null,
  lastError: null,
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
  const enabled = input.enabled ?? cur.enabled
  if (enabled && !merchantId) return { error: 'Informe o número da conta do Merchant Center.' }
  const ceps: Partial<Record<Uf, string[]>> = {}
  for (const uf of UFS) {
    const raw = input.ceps?.[uf] ?? cur.ceps[uf]
    const list = (Array.isArray(raw) ? raw : []).map((c) => String(c).replace(/\D/g, '')).filter((c) => c.length === 8)
    if (list.length) ceps[uf] = [...new Set(list)].slice(0, 5)
  }
  const service = String(input.service ?? cur.service).trim().slice(0, 60) || 'Entrega'
  return { ...cur, enabled, merchantId, service, handlingMin, handlingMax, batchSize, ceps, dataSource: merchantId === cur.merchantId ? cur.dataSource : null, preparedAt: merchantId === cur.merchantId ? cur.preparedAt : null }
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
