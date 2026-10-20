/**
 * Marketing Inteligente: canal de cada lead e a regra de atribuição (testadas em test/marketing.spec.ts).
 * O toque (origem da visita ou da conversão) é o mesmo formato do rastreamento do site (rastreamento/origem.ts).
 */

export const CHANNELS = {
  google_ads: { label: 'Google Ads', paid: true },
  meta_ads: { label: 'Meta Ads (Facebook e Instagram)', paid: true },
  tiktok_ads: { label: 'TikTok Ads', paid: true },
  outras_midias: { label: 'Outras mídias pagas', paid: true },
  email: { label: 'E-mail marketing', paid: false },
  busca_organica: { label: 'Busca orgânica (SEO)', paid: false },
  social_organico: { label: 'Redes sociais (orgânico)', paid: false },
  indicacao: { label: 'Indicação de outros sites', paid: false },
  direto: { label: 'Acesso direto', paid: false },
  nao_identificado: { label: 'Origem não identificada', paid: false },
} as const
export type Channel = keyof typeof CHANNELS
export const CHANNEL_KEYS = Object.keys(CHANNELS) as Channel[]
export const isChannel = (v: unknown): v is Channel => typeof v === 'string' && v in CHANNELS

export interface TouchLike {
  source?: string
  medium?: string
  campaign?: string
  campaignId?: string
  term?: string
  content?: string
  landing?: string
}

const PAID_MEDIUM = /^(cpc|ppc|paid|paid[_-]?social|cpm|cpv|display|ads?|pago|midia[_-]?paga|remarketing|retargeting)$/
const META = /^(facebook|instagram|meta|fb|ig|messenger|audience[_-]?network)$/
const SOCIAL = /^(facebook|instagram|meta|fb|ig|linkedin|youtube|tiktok|twitter|x|pinterest|whatsapp|threads)$/
const SEARCH = /^(google|bing|yahoo|duckduckgo|ecosia|brave|yandex)$/
const CLICK_ID = /[?&](gclid|gbraid|wbraid)=/i

/** Canal de um toque. Ordem: mídia paga (pelo meio ou código de clique) > e-mail > orgânico > indicação > direto. */
export function channelOfTouch(t: TouchLike | null | undefined): Channel {
  if (!t) return 'nao_identificado'
  const source = (t.source ?? '').trim().toLowerCase()
  const medium = (t.medium ?? '').trim().toLowerCase()
  const paid = PAID_MEDIUM.test(medium) || CLICK_ID.test(t.landing ?? '')
  if (paid) {
    if (source === 'google' || source === 'youtube' || CLICK_ID.test(t.landing ?? '')) return 'google_ads'
    if (META.test(source)) return 'meta_ads'
    if (source === 'tiktok') return 'tiktok_ads'
    return 'outras_midias'
  }
  if (medium === 'email' || source === 'email' || source === 'newsletter') return 'email'
  if (medium === 'organico' || medium === 'organic') return 'busca_organica'
  if (medium === 'social') return 'social_organico'
  if (medium === 'referencia' || medium === 'referral') return 'indicacao'
  if (medium === 'direto' || source === 'direto' || source === '(direct)') return 'direto'
  if (!source) return 'nao_identificado'
  if (SEARCH.test(source)) return 'busca_organica'
  if (SOCIAL.test(source)) return 'social_organico'
  return 'indicacao'
}

export type AttributionModel = 'ultimo' | 'primeiro'
export const ATTRIBUTION_MODELS: Record<AttributionModel, string> = {
  ultimo: 'Último toque não direto',
  primeiro: 'Primeiro toque não direto',
}
export const WINDOWS = [7, 14, 30, 60, 90] as const

export interface Touch {
  t: TouchLike
  at: Date | null
}

const DAY = 86_400_000
/** Tolerância depois do contato: a conversão (formulário, WhatsApp) é gravada junto com o atendimento, às vezes segundos depois. */
const AFTER_TOLERANCE = DAY

/**
 * Toque que leva o crédito, dentro da janela antes do contato.
 * Acesso direto só leva o crédito quando não há nenhum outro toque na janela.
 */
export function pickTouch(touches: Touch[], contactAt: Date, model: AttributionModel, windowDays: number): Touch | null {
  const min = contactAt.getTime() - windowDays * DAY
  const max = contactAt.getTime() + AFTER_TOLERANCE
  const inWindow = touches
    .filter((x) => x.t && typeof x.t === 'object' && (!x.at || (x.at.getTime() >= min && x.at.getTime() <= max)))
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
  if (!inWindow.length) return null
  const notDirect = inWindow.filter((x) => channelOfTouch(x.t) !== 'direto' && channelOfTouch(x.t) !== 'nao_identificado')
  const pool = notDirect.length ? notDirect : inWindow
  return (model === 'primeiro' ? pool[0] : pool[pool.length - 1]) ?? null
}

export interface Attribution {
  channel: Channel
  campaignId: string | null
  campaign: string | null
  /** Anúncio (Meta: utm_content / nome do anúncio). */
  ad: string | null
  term: string | null
  source: string | null
  medium: string | null
  /** Como o canal foi descoberto: clique no anúncio do Google, toque do site ou da conversão, origem do cadastro, ou nenhum. */
  how: 'clique_google' | 'toque' | 'origem_google' | 'nenhum'
  touchAt: Date | null
}

export interface RecordAds {
  adsVia: string | null
  adsCampaignId: string | null
  adsCampaign: string | null
  adsTerm: string | null
}

const clip = (v: string | undefined | null) => (v ? v.trim().slice(0, 160) || null : null)

/**
 * Atribuição de um atendimento, nesta ordem:
 * 1. clique em anúncio do Google já identificado no atendimento;
 * 2. origem "Google" no cadastro, sem campanha (1 e 2 são a mesma regra do painel do Google Ads, então os números batem);
 * 3. toque da pessoa (site, formulário, Lead Ads) pelo modelo e janela escolhidos;
 * 4. não identificado.
 */
export function attribute(r: RecordAds, touches: Touch[], contactAt: Date, model: AttributionModel, windowDays: number): Attribution {
  if (r.adsVia === 'ANUNCIO') {
    return { channel: 'google_ads', campaignId: r.adsCampaignId, campaign: r.adsCampaign, ad: null, term: r.adsTerm, source: 'google', medium: 'cpc', how: 'clique_google', touchAt: null }
  }
  if (r.adsVia === 'ORIGEM') return { channel: 'google_ads', campaignId: null, campaign: null, ad: null, term: null, source: 'google', medium: null, how: 'origem_google', touchAt: null }
  const picked = pickTouch(touches, contactAt, model, windowDays)
  const channel = picked ? channelOfTouch(picked.t) : 'nao_identificado'
  if (picked && channel !== 'direto' && channel !== 'nao_identificado') {
    const t = picked.t
    return { channel, campaignId: clip(t.campaignId), campaign: clip(t.campaign), ad: clip(t.content), term: clip(t.term), source: clip(t.source), medium: clip(t.medium), how: 'toque', touchAt: picked.at }
  }
  if (picked) return { channel, campaignId: null, campaign: null, ad: null, term: null, source: clip(picked.t.source), medium: clip(picked.t.medium), how: 'toque', touchAt: picked.at }
  return { channel: 'nao_identificado', campaignId: null, campaign: null, ad: null, term: null, source: null, medium: null, how: 'nenhum', touchAt: null }
}

/** Chave da campanha (canal + número, ou canal + nome quando não há número). */
export function campaignKey(a: { channel: Channel; campaignId: string | null; campaign: string | null }) {
  if (a.campaignId) return `${a.channel}|id:${a.campaignId}`
  if (a.campaign) return `${a.channel}|nome:${a.campaign.trim().toLowerCase()}`
  return `${a.channel}|-`
}
