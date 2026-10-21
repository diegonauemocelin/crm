/**
 * Detalhes do Google Ads que o script manda para o Marketing Inteligente (funções puras, testadas em test/marketing.spec.ts):
 * recortes por dispositivo, rede, região, página de destino, anúncio, grupo e tipo de campanha, e os termos de pesquisa.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^\d{1,20}$/
const MAX_ROWS = 5000
export const DETAIL_DIMENSIONS = ['type', 'device', 'network', 'region', 'landing', 'ad', 'adgroup'] as const
export type DetailDimension = (typeof DETAIL_DIMENSIONS)[number]

export interface DetailRow {
  date: string
  campaignId: string
  dimension: DetailDimension
  key: string
  label: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  conversionValue: number
  impressionShare: number | null
}
export interface SearchTermRow {
  date: string
  campaignId: string
  adGroupId: string
  term: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
}

const text = (v: unknown, n: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, n)
const num = (v: unknown, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null
}
const r2 = (n: number) => Math.round(n * 100) / 100

export function cleanDetail(raw: unknown): DetailRow[] | { error: string } {
  const rows = (raw as { detail?: { rows?: unknown } } | null)?.detail?.rows
  if (!Array.isArray(rows)) return { error: 'Detalhes ausentes.' }
  if (rows.length > MAX_ROWS) return { error: 'Linhas demais em um envio (máximo 5.000).' }
  const out: DetailRow[] = []
  for (const r of rows as Record<string, unknown>[]) {
    const date = String(r?.d ?? '')
    const campaignId = String(r?.c ?? '')
    const dimension = String(r?.dim ?? '') as DetailDimension
    const key = text(r?.k, 500)
    const cost = num(r?.cost, 1e9)
    const clicks = num(r?.cl, 1e9)
    const impressions = num(r?.im, 1e10)
    const conversions = num(r?.cv, 1e9)
    const value = num(r?.val ?? 0, 1e11)
    if (!DATE.test(date) || !ID.test(campaignId) || !DETAIL_DIMENSIONS.includes(dimension) || !key || cost === null || clicks === null || impressions === null || conversions === null || value === null) continue
    const share = num(r?.is, 1)
    out.push({ date, campaignId, dimension, key, label: text(r?.l, 300) || key, cost: r2(cost), clicks: Math.round(clicks), impressions: Math.round(impressions), conversions: r2(conversions), conversionValue: r2(value), impressionShare: share === null || share === 0 ? null : Math.round(share * 10000) / 10000 })
  }
  // Mesma linha repetida no lote (o banco recusaria): fica a última.
  const unique = new Map(out.map((x) => [`${x.date}|${x.campaignId}|${x.dimension}|${x.key}`, x]))
  return [...unique.values()]
}

export function cleanTerms(raw: unknown): SearchTermRow[] | { error: string } {
  const rows = (raw as { terms?: { rows?: unknown } } | null)?.terms?.rows
  if (!Array.isArray(rows)) return { error: 'Termos de pesquisa ausentes.' }
  if (rows.length > MAX_ROWS) return { error: 'Linhas demais em um envio (máximo 5.000).' }
  const out = new Map<string, SearchTermRow>()
  for (const r of rows as Record<string, unknown>[]) {
    const date = String(r?.d ?? '')
    const campaignId = String(r?.c ?? '')
    const adGroupId = String(r?.g ?? '')
    const term = text(r?.t, 300).toLowerCase()
    const cost = num(r?.cost, 1e9)
    const clicks = num(r?.cl, 1e9)
    const impressions = num(r?.im, 1e10)
    const conversions = num(r?.cv, 1e9)
    if (!DATE.test(date) || !ID.test(campaignId) || !ID.test(adGroupId) || !term || cost === null || clicks === null || impressions === null || conversions === null) continue
    out.set(`${date}|${adGroupId}|${term}`, { date, campaignId, adGroupId, term, cost: r2(cost), clicks: Math.round(clicks), impressions: Math.round(impressions), conversions: r2(conversions) })
  }
  return [...out.values()]
}

export const DIMENSION_LABEL: Record<DetailDimension, string> = {
  type: 'Tipo de campanha',
  device: 'Dispositivo',
  network: 'Rede',
  region: 'Região',
  landing: 'Página de destino',
  ad: 'Anúncio',
  adgroup: 'Grupo de anúncios',
}

/** Nomes do Google (enum) em português. */
export const VALUE_LABEL: Record<string, string> = {
  SEARCH: 'Pesquisa',
  DISPLAY: 'Display',
  VIDEO: 'Vídeo',
  SHOPPING: 'Shopping',
  PERFORMANCE_MAX: 'Performance Max',
  DEMAND_GEN: 'Geração de demanda',
  DISCOVERY: 'Discovery',
  LOCAL: 'Local',
  SMART: 'Inteligente',
  MULTI_CHANNEL: 'Multicanal',
  MOBILE: 'Celular',
  DESKTOP: 'Computador',
  TABLET: 'Tablet',
  CONNECTED_TV: 'TV conectada',
  OTHER: 'Outros',
  SEARCH_PARTNERS: 'Parceiros de pesquisa',
  CONTENT: 'Rede de Display',
  YOUTUBE_SEARCH: 'YouTube (pesquisa)',
  YOUTUBE_WATCH: 'YouTube',
  YOUTUBE: 'YouTube',
  MIXED: 'Misto (Performance Max)',
  GOOGLE_TV: 'Google TV',
  UNKNOWN: 'Não informado',
  UNSPECIFIED: 'Não informado',
}
export const valueLabel = (v: string) => VALUE_LABEL[v] ?? v

// ---------- Sugestão de palavras negativas (para revisão humana) ----------

/**
 * Palavras que costumam trazer quem não compra peças (procura emprego, curso, material grátis...). A lista é
 * editável em Configurações › Marketing Inteligente; o CRM só sugere, quem decide é a pessoa.
 */
export const DEFAULT_ALERT_WORDS = ['grátis', 'gratis', 'emprego', 'vaga', 'vagas', 'curso', 'apostila', 'download', 'baixar', 'pdf', 'manual', 'o que é', 'como funciona', 'salário', 'salario', 'aluguel', 'alugar', 'locação', 'miniatura', 'brinquedo', 'desenho', 'simulador', 'jogo']

export interface TermSummary {
  term: string
  campaignIds: string[]
  cost: number
  clicks: number
  impressions: number
  conversions: number
}

export type SuggestionReason = 'palavra' | 'sem_conversao'
export interface NegativeSuggestion extends TermSummary {
  reason: SuggestionReason
  detail: string
  /** Palavra da lista que apareceu no termo. */
  word?: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Sugere termos para negativar: (1) com palavra da lista de alerta e algum custo; (2) com gasto relevante e
 * nenhuma conversão no Google. Termos que já viraram conversão nunca entram. É só sugestão: nada vai para o Google.
 */
export function negativeSuggestions(terms: TermSummary[], words: string[], opts: { minCost: number; minClicks: number }): NegativeSuggestion[] {
  const list = words.map((w) => norm(w.trim())).filter(Boolean)
  const out: NegativeSuggestion[] = []
  for (const t of terms) {
    if (t.conversions > 0 || t.cost <= 0) continue
    const n = ` ${norm(t.term)} `
    const word = list.find((w) => n.includes(` ${w} `) || (w.includes(' ') && n.includes(w)))
    if (word) out.push({ ...t, reason: 'palavra', word, detail: `Contém “${word}”, palavra que costuma trazer quem não compra peças.` })
    else if (t.cost >= opts.minCost && t.clicks >= opts.minClicks) out.push({ ...t, reason: 'sem_conversao', detail: `${t.clicks} cliques e nenhuma conversão no período.` })
  }
  return out.sort((a, b) => b.cost - a.cost)
}
