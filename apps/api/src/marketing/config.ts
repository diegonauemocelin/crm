/**
 * Configurações do Marketing Inteligente (Configurações › Marketing Inteligente) e dos relatórios automáticos.
 * Funções puras: valores padrão, limpeza do que a tela manda e o próximo horário de envio de cada relatório.
 */
import { normalizePhone } from '../atendimento/br'
import { type AttributionModel, DAY_MS, type Filters, type QualifiedRule } from './metricas'

export const GRAPH = 'https://graph.facebook.com/v23.0'
export const TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3'
export const SC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

export const CONFIG_KEY = 'mkt_config'
export const INTEGRATIONS_KEY = 'mkt_integracoes'
export const REPORTS_KEY = 'mkt_relatorios'

export interface MarketingConfig {
  qualified: QualifiedRule
  marginPct: number
  fixedMonthly: number
  fixedNote: string
  marketingOriginIds: string[]
  attribution: { model: AttributionModel; windowDays: number }
  /** Palavras que levam um termo de pesquisa à lista de sugestões de negativas (null = lista padrão). */
  negativeWords: string[] | null
  updatedAt: string | null
}
export const DEFAULT_CONFIG: MarketingConfig = {
  qualified: 'repassado_retorno',
  marginPct: 30,
  fixedMonthly: 0,
  fixedNote: '',
  marketingOriginIds: [],
  attribution: { model: 'ultimo', windowDays: 90 },
  negativeWords: null,
  updatedAt: null,
}

export function cleanConfig(input: Partial<MarketingConfig>, current: MarketingConfig, validOrigins: Set<string>): MarketingConfig | { error: string } {
  const margin = Number(input.marginPct ?? current.marginPct)
  if (!Number.isFinite(margin) || margin < 0 || margin > 100) return { error: 'Margem de contribuição: de 0 a 100%.' }
  const fixed = Number(input.fixedMonthly ?? current.fixedMonthly)
  if (!Number.isFinite(fixed) || fixed < 0 || fixed > 100_000_000) return { error: 'Custos fixos de marketing inválidos.' }
  const window = Number(input.attribution?.windowDays ?? current.attribution.windowDays)
  if (!Number.isInteger(window) || window < 1 || window > 365) return { error: 'Janela de atribuição: de 1 a 365 dias.' }
  return {
    qualified: input.qualified === 'repassado' ? 'repassado' : 'repassado_retorno',
    marginPct: Math.round(margin * 100) / 100,
    fixedMonthly: Math.round(fixed * 100) / 100,
    fixedNote: String(input.fixedNote ?? current.fixedNote).slice(0, 200),
    marketingOriginIds: [...new Set((input.marketingOriginIds ?? current.marketingOriginIds).filter((id) => validOrigins.has(id)))].slice(0, 100),
    attribution: { model: input.attribution?.model === 'primeiro' ? 'primeiro' : 'ultimo', windowDays: window },
    negativeWords:
      input.negativeWords === undefined
        ? current.negativeWords
        : input.negativeWords === null
          ? null
          : [...new Set(input.negativeWords.map((w) => String(w).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 200),
    updatedAt: new Date().toISOString(),
  }
}

// ---------- Integrações (somente leitura nas plataformas) ----------

export interface ConnectionTest {
  at: string
  ok: boolean
  message: string
}
export interface IntegrationsConfig {
  metaAds: { enabled: boolean; adAccountIds: string[]; tokenEnc: string | null; lastTest: ConnectionTest | null }
  metaOrganic: { enabled: boolean; pageId: string; instagramId: string; lastTest: ConnectionTest | null }
  tiktok: { enabled: boolean; advertiserIds: string[]; tokenEnc: string | null; lastTest: ConnectionTest | null }
  searchConsole: { enabled: boolean; siteUrl: string; lastTest: ConnectionTest | null }
}
export const DEFAULT_INTEGRATIONS: IntegrationsConfig = {
  metaAds: { enabled: false, adAccountIds: [], tokenEnc: null, lastTest: null },
  metaOrganic: { enabled: false, pageId: '', instagramId: '', lastTest: null },
  tiktok: { enabled: false, advertiserIds: [], tokenEnc: null, lastTest: null },
  searchConsole: { enabled: false, siteUrl: '', lastTest: null },
}
export type IntegrationKey = keyof IntegrationsConfig
export const INTEGRATION_KEYS: IntegrationKey[] = ['metaAds', 'metaOrganic', 'tiktok', 'searchConsole']

/** Contas de anúncio da Meta: "act_123" ou só os números. */
export const cleanMetaAccount = (s: string) => {
  const m = s.trim().match(/^(?:act_)?(\d{5,20})$/)
  return m ? `act_${m[1]}` : null
}
export const cleanDigits = (s: string, min = 5, max = 25) => {
  const t = s.trim()
  return new RegExp(`^\\d{${min},${max}}$`).test(t) ? t : null
}
/** Propriedade do Search Console: "https://www.site.com.br/" ou "sc-domain:site.com.br". */
export const cleanSiteUrl = (s: string) => {
  const t = s.trim()
  if (/^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return t.toLowerCase()
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.protocol}//${u.host}${u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`}`
  } catch {
    return null
  }
}

/** O que vai para a tela: nunca o token, só se existe. */
export function integrationsView(c: IntegrationsConfig) {
  return {
    metaAds: { enabled: c.metaAds.enabled, adAccountIds: c.metaAds.adAccountIds, hasToken: !!c.metaAds.tokenEnc, lastTest: c.metaAds.lastTest },
    metaOrganic: { ...c.metaOrganic, hasToken: !!c.metaAds.tokenEnc },
    tiktok: { enabled: c.tiktok.enabled, advertiserIds: c.tiktok.advertiserIds, hasToken: !!c.tiktok.tokenEnc, lastTest: c.tiktok.lastTest },
    searchConsole: c.searchConsole,
  }
}

// ---------- Relatórios automáticos ----------

export const REPORT_SECTIONS = [
  { key: 'resumo_ia', label: 'Resumo do período escrito pela IA (Gemini), a partir dos números agregados' },
  { key: 'kpis', label: 'Indicadores principais (investimento, leads, vendas, faturamento, CPL, ROAS, ROI)' },
  { key: 'plataformas', label: 'Resultado por plataforma' },
  { key: 'campanhas', label: 'Campanhas (as 15 com mais investimento ou faturamento)' },
  { key: 'funil', label: 'Funil de marketing e vendas' },
  { key: 'vendedores', label: 'Resultado por vendedor' },
  { key: 'regioes', label: 'Resultado por estado e região' },
  { key: 'marcas', label: 'Resultado por marca da máquina' },
  { key: 'categorias', label: 'Resultado por tipo de peça' },
  { key: 'origens', label: 'Resultado por origem do lead' },
  { key: 'email', label: 'E-mail marketing do período' },
  { key: 'loja', label: 'Loja virtual (Magazord): vendas, canais de venda e produtos mais vendidos' },
  { key: 'mercado_livre', label: 'Mercado Livre Ads: investimento, receita atribuída, ROAS, ACOS e campanhas' },
  { key: 'recomendacoes', label: 'Recomendações (diagnósticos com os números)' },
  { key: 'saude', label: 'Saúde dos dados (fontes, última atualização, leads sem campanha)' },
] as const
export type ReportSection = (typeof REPORT_SECTIONS)[number]['key']
const SECTION_KEYS = new Set<string>(REPORT_SECTIONS.map((s) => s.key))

export const REPORT_PERIODS = [
  { key: 'ontem', label: 'Ontem' },
  { key: 'ultimos7', label: 'Últimos 7 dias' },
  { key: 'semana_anterior', label: 'Semana anterior (segunda a domingo)' },
  { key: 'ultimos30', label: 'Últimos 30 dias' },
  { key: 'mes_atual', label: 'Mês atual até ontem' },
  { key: 'mes_anterior', label: 'Mês anterior' },
] as const
export type ReportPeriod = (typeof REPORT_PERIODS)[number]['key']

export type Frequency = 'diario' | 'semanal' | 'mensal'

export interface ReportSchedule {
  id: string
  name: string
  active: boolean
  emails: string[]
  /** Celulares que recebem pelo WhatsApp (+55...): resumo em texto com o PDF. */
  whatsapp: string[]
  /** Número de WhatsApp da empresa que envia (vazio = o primeiro conectado). */
  whatsappNumberId: string | null
  frequency: Frequency
  /** 0 = domingo … 6 = sábado (semanal). */
  weekday: number
  /** 1 a 28 (mensal). */
  monthDay: number
  /** Hora de Brasília (0 a 23). */
  hour: number
  period: ReportPeriod
  sections: ReportSection[]
  filters: Filters
  /** Anexo do e-mail: nenhum, PDF ou Excel. */
  attach: 'none' | 'pdf' | 'xlsx'
  createdBy: string | null
  /** Criado (ou reativado) em: não manda os envios de antes disso. */
  createdAt: string
  lastSentAt: string | null
  lastError: string | null
}
export interface ReportRun {
  at: string
  scheduleId: string
  name: string
  ok: boolean
  to: number
  message: string
  manual: boolean
}
export interface ReportsState {
  schedules: ReportSchedule[]
  runs: ReportRun[]
}
export const DEFAULT_REPORTS: ReportsState = { schedules: [], runs: [] }
export const MAX_SCHEDULES = 30

/** Pausa entre um celular e outro no envio pelo WhatsApp: sorteada entre 40 s e 2 min (intervalo fixo parece robô). */
export function whatsappGap(random = Math.random) {
  return 40_000 + Math.floor(random() * 80_000)
}

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,}$/i

export function cleanSchedule(input: Partial<ReportSchedule>, prev: ReportSchedule | null, id: string, by: string | null): ReportSchedule | { error: string } {
  const name = String(input.name ?? prev?.name ?? '').trim().slice(0, 80)
  if (!name) return { error: 'Dê um nome ao relatório.' }
  const emails = [...new Set((input.emails ?? prev?.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
  if (emails.length > 20) return { error: 'No máximo 20 e-mails por relatório.' }
  const bad = emails.find((e) => !EMAIL.test(e))
  if (bad) return { error: `E-mail inválido: ${bad}` }
  const rawPhones = (input.whatsapp ?? prev?.whatsapp ?? []).map((x) => String(x).trim()).filter(Boolean)
  const badPhone = rawPhones.find((x) => !normalizePhone(x))
  if (badPhone) return { error: `Celular inválido para WhatsApp: ${badPhone} (use DDD + número, ex.: (49) 98863-2548).` }
  const whatsapp = [...new Set(rawPhones.map((x) => normalizePhone(x)!))]
  if (whatsapp.length > 20) return { error: 'No máximo 20 celulares por relatório.' }
  if (!emails.length && !whatsapp.length) return { error: 'Cadastre ao menos um e-mail ou um celular de WhatsApp para receber o relatório.' }
  const numberId = input.whatsappNumberId !== undefined ? input.whatsappNumberId : (prev?.whatsappNumberId ?? null)
  const frequency: Frequency = input.frequency === 'semanal' || input.frequency === 'mensal' ? input.frequency : 'diario'
  const int = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v ?? d)
    return Number.isInteger(n) && n >= min && n <= max ? n : d
  }
  const sections = [...new Set((input.sections ?? prev?.sections ?? []).filter((s) => SECTION_KEYS.has(s)))] as ReportSection[]
  if (!sections.length) return { error: 'Escolha ao menos uma informação para ir no relatório.' }
  const period = (REPORT_PERIODS.some((p) => p.key === input.period) ? input.period : (prev?.period ?? (frequency === 'mensal' ? 'mes_anterior' : frequency === 'semanal' ? 'semana_anterior' : 'ontem'))) as ReportPeriod
  return {
    id,
    name,
    active: input.active ?? prev?.active ?? true,
    emails,
    whatsapp,
    whatsappNumberId: typeof numberId === 'string' && /^[0-9a-f-]{36}$/.test(numberId) ? numberId : null,
    frequency,
    weekday: int(input.weekday, prev?.weekday ?? 1, 0, 6),
    monthDay: int(input.monthDay, prev?.monthDay ?? 1, 1, 28),
    hour: int(input.hour, prev?.hour ?? 8, 0, 23),
    period,
    sections,
    filters: cleanFilters(input.filters ?? prev?.filters ?? {}),
    attach: input.attach === 'pdf' || input.attach === 'xlsx' ? input.attach : input.attach === 'none' ? 'none' : (prev?.attach ?? 'none'),
    createdBy: prev?.createdBy ?? by,
    createdAt: prev && (prev.active || !(input.active ?? prev.active)) ? prev.createdAt : new Date().toISOString(),
    lastSentAt: prev?.lastSentAt ?? null,
    lastError: prev?.lastError ?? null,
  }
}

const ID = /^[0-9a-f-]{36}$|^\d{1,25}$|^-$/
export function cleanFilters(f: Partial<Record<keyof Filters, unknown>>): Filters {
  const out: Filters = {}
  if (f.platform === 'google' || f.platform === 'meta' || f.platform === 'tiktok' || f.platform === 'outros') out.platform = f.platform
  for (const k of ['campaignId', 'brandId', 'partTypeId', 'unitId', 'sellerId', 'originId', 'customerTypeId'] as const) {
    const v = typeof f[k] === 'string' ? (f[k] as string).trim() : ''
    if (v && ID.test(v)) out[k] = v
  }
  if (typeof f.state === 'string' && /^[A-Z]{2}$/.test(f.state)) out.state = f.state
  if (typeof f.region === 'string' && ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul', 'Exterior', 'Sem estado'].includes(f.region)) out.region = f.region
  if (f.saleStatus === 'SIM' || f.saleStatus === 'NAO' || f.saleStatus === 'NEGOCIACAO') out.saleStatus = f.saleStatus
  if (f.cliente === 'novo' || f.cliente === 'recorrente') out.cliente = f.cliente
  return out
}

/** Partes da data no horário de Brasília. */
const local = (ms: number) => {
  const d = new Date(ms - 3 * 3_600_000)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay(), h: d.getUTCHours(), day: d.toISOString().slice(0, 10) }
}
const atLocal = (y: number, m: number, d: number, h: number) => Date.UTC(y, m, d, h + 3)

/** Próximo envio depois de "after" (ms), no horário de Brasília. */
export function nextRun(s: Pick<ReportSchedule, 'frequency' | 'weekday' | 'monthDay' | 'hour'>, after: number) {
  const l = local(after)
  for (let i = 0; i <= 62; i++) {
    const day = local(atLocal(l.y, l.m, l.d + i, 12))
    const ok = s.frequency === 'diario' || (s.frequency === 'semanal' && day.w === s.weekday) || (s.frequency === 'mensal' && day.d === s.monthDay)
    const at = atLocal(day.y, day.m, day.d, s.hour)
    if (ok && at > after) return at
  }
  return null
}

/** Está na hora de mandar: o horário do agendamento já passou e o último envio é anterior a ele. */
export function isDue(s: ReportSchedule, now: number) {
  if (!s.active) return false
  const last = Math.max(s.lastSentAt ? Date.parse(s.lastSentAt) : 0, s.createdAt ? Date.parse(s.createdAt) : 0)
  // Procura o horário previsto mais recente até agora (nas últimas 2 horas, para não mandar atrasado demais depois de o servidor ficar fora).
  const due = nextRun(s, Math.max(last, now - 2 * 3_600_000))
  return due !== null && due <= now
}

/** Datas do período do relatório (aaaa-mm-dd), relativo ao dia do envio. */
export function reportPeriod(p: ReportPeriod, now: number) {
  const l = local(now)
  const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
  const yesterday = day(l.y, l.m, l.d - 1)
  switch (p) {
    case 'ontem':
      return { from: yesterday, to: yesterday }
    case 'ultimos7':
      return { from: day(l.y, l.m, l.d - 7), to: yesterday }
    case 'ultimos30':
      return { from: day(l.y, l.m, l.d - 30), to: yesterday }
    case 'semana_anterior': {
      const back = ((l.w + 6) % 7) + 7
      return { from: day(l.y, l.m, l.d - back), to: day(l.y, l.m, l.d - back + 6) }
    }
    case 'mes_atual':
      return l.d === 1 ? { from: day(l.y, l.m - 1, 1), to: yesterday } : { from: day(l.y, l.m, 1), to: yesterday }
    case 'mes_anterior':
      return { from: day(l.y, l.m - 1, 1), to: day(l.y, l.m, 0) }
  }
}

export const describeFrequency = (s: Pick<ReportSchedule, 'frequency' | 'weekday' | 'monthDay' | 'hour'>) => {
  const h = `${String(s.hour).padStart(2, '0')}h`
  if (s.frequency === 'diario') return `Todo dia às ${h}`
  if (s.frequency === 'semanal') return `${s.weekday === 0 || s.weekday === 6 ? 'Todo' : 'Toda'} ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][s.weekday]} às ${h}`
  return `Todo dia ${s.monthDay} às ${h}`
}

export { DAY_MS }
