/**
 * Leitura das respostas das APIs das plataformas (funções puras, testadas em test/marketing.spec.ts).
 * Só números agregados das contas da empresa: nenhum dado pessoal de quem viu ou clicou nos anúncios.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const toNum = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
const optNum = (v: unknown) => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const text = (v: unknown, n: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, n)
const r2 = (n: number) => Math.round(n * 100) / 100

export interface AdDayRow {
  platform: 'meta' | 'tiktok'
  level: 'campaign' | 'adset' | 'ad'
  entityId: string
  name: string
  campaignId: string
  campaignName: string
  parentId: string | null
  objective: string | null
  date: string
  spend: number
  impressions: number
  reach: number | null
  clicks: number
  leads: number
  conversations: number
  conversions: number
  videoViews: number | null
}

export interface BreakdownDayRow {
  platform: 'meta' | 'tiktok'
  date: string
  campaignId: string
  dimension: string
  key: string
  spend: number
  impressions: number
  clicks: number
  leads: number
}

// ---------- Meta ----------

/** Ações da Meta que contam como lead, conversa iniciada, conversão e visualização de vídeo. */
export const META_LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'offsite_conversion.fb_pixel_lead']
export const META_CONVERSATION_ACTIONS = ['onsite_conversion.messaging_conversation_started_7d']
export const META_CONVERSION_ACTIONS = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase']
const actionSum = (actions: unknown, types: string[]) => {
  if (!Array.isArray(actions)) return 0
  // A Meta repete a mesma conversão com nomes diferentes (purchase e omni_purchase): vale o maior, não a soma.
  return Math.max(0, ...(actions as { action_type?: string; value?: unknown }[]).filter((a) => types.includes(String(a.action_type))).map((a) => toNum(a.value)))
}

export function parseMetaInsights(data: unknown, level: AdDayRow['level']): AdDayRow[] {
  if (!Array.isArray(data)) return []
  const out: AdDayRow[] = []
  for (const r of data as Record<string, unknown>[]) {
    const date = String(r.date_start ?? '')
    const campaignId = String(r.campaign_id ?? '')
    const entityId = String(level === 'campaign' ? r.campaign_id : level === 'adset' ? r.adset_id : r.ad_id) || ''
    if (!DATE.test(date) || !/^\d{1,30}$/.test(campaignId) || !/^\d{1,30}$/.test(entityId)) continue
    out.push({
      platform: 'meta',
      level,
      entityId,
      name: text(level === 'campaign' ? r.campaign_name : level === 'adset' ? r.adset_name : r.ad_name, 300) || entityId,
      campaignId,
      campaignName: text(r.campaign_name, 300) || campaignId,
      parentId: level === 'ad' ? String(r.adset_id ?? '') || null : level === 'adset' ? campaignId : null,
      objective: text(r.objective, 60) || null,
      date,
      spend: r2(toNum(r.spend)),
      impressions: Math.round(toNum(r.impressions)),
      reach: optNum(r.reach),
      clicks: Math.round(toNum(r.inline_link_clicks ?? r.clicks)),
      leads: Math.round(actionSum(r.actions, META_LEAD_ACTIONS)),
      conversations: Math.round(actionSum(r.actions, META_CONVERSATION_ACTIONS)),
      conversions: r2(actionSum(r.actions, META_CONVERSION_ACTIONS)),
      videoViews: Array.isArray(r.actions) ? Math.round(actionSum(r.actions, ['video_view'])) : null,
    })
  }
  return out
}

export function parseMetaBreakdown(data: unknown, dimension: string, keys: string[]): BreakdownDayRow[] {
  if (!Array.isArray(data)) return []
  const out: BreakdownDayRow[] = []
  for (const r of data as Record<string, unknown>[]) {
    const date = String(r.date_start ?? '')
    const campaignId = String(r.campaign_id ?? '')
    const key = keys.map((k) => text(r[k], 80)).filter(Boolean).join(' · ')
    if (!DATE.test(date) || !/^\d{1,30}$/.test(campaignId) || !key) continue
    out.push({ platform: 'meta', date, campaignId, dimension, key, spend: r2(toNum(r.spend)), impressions: Math.round(toNum(r.impressions)), clicks: Math.round(toNum(r.inline_link_clicks ?? r.clicks)), leads: Math.round(actionSum(r.actions, META_LEAD_ACTIONS)) })
  }
  return out
}

/** Criativo do anúncio: só o que serve para comparar (título, texto, chamada, tipo e imagem). */
export function parseMetaCreative(ad: unknown) {
  const c = ((ad as { creative?: Record<string, unknown> } | null)?.creative ?? {}) as Record<string, unknown>
  const img = text(c.image_url ?? c.thumbnail_url, 1000)
  return {
    title: text(c.title, 200) || null,
    body: text(c.body, 1000) || null,
    cta: text(c.call_to_action_type, 60) || null,
    type: text(c.object_type, 40) || null,
    image: /^https:\/\//.test(img) ? img : null,
  }
}

/** Erro da Graph API em português (token vencido, sem permissão, limite de chamadas). */
export function metaError(status: number, body: unknown) {
  const e = ((body as { error?: { message?: string; code?: number } } | null)?.error ?? {}) as { message?: string; code?: number }
  if (e.code === 190) return 'Token da Meta vencido ou inválido: gere um novo token do usuário do sistema.'
  if (e.code === 10 || e.code === 200 || e.code === 100) return `Sem permissão ou campo indisponível na Meta: ${e.message ?? status}`
  if (e.code === 4 || e.code === 17 || e.code === 613 || e.code === 80004) return 'Limite de chamadas da Meta atingido: o CRM tenta de novo mais tarde.'
  return `A Meta recusou (${status}): ${e.message ?? 'sem detalhe'}`
}

// ---------- Instagram e Facebook orgânicos ----------

export interface SocialPostRow {
  network: 'instagram' | 'facebook'
  postId: string
  publishedAt: Date
  format: string
  caption: string
  permalink: string | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  reach: number | null
  impressions: number | null
  videoViews: number | null
}

export function parseIgMedia(m: Record<string, unknown>, insights: Record<string, number>): SocialPostRow | null {
  const id = String(m.id ?? '')
  const at = Date.parse(String(m.timestamp ?? ''))
  if (!/^\d{1,30}$/.test(id) || !Number.isFinite(at)) return null
  const product = String(m.media_product_type ?? '')
  const type = String(m.media_type ?? '')
  const format = product === 'REELS' ? 'Reels' : product === 'STORY' ? 'Story' : type === 'CAROUSEL_ALBUM' ? 'Carrossel' : type === 'VIDEO' ? 'Vídeo' : 'Imagem'
  const permalink = text(m.permalink, 500)
  return {
    network: 'instagram',
    postId: id,
    publishedAt: new Date(at),
    format,
    caption: text(m.caption, 2000),
    permalink: /^https:\/\//.test(permalink) ? permalink : null,
    likes: optNum(m.like_count),
    comments: optNum(m.comments_count),
    shares: insights.shares ?? null,
    saves: insights.saved ?? null,
    reach: insights.reach ?? null,
    impressions: insights.views ?? insights.impressions ?? null,
    videoViews: format === 'Reels' || format === 'Vídeo' ? (insights.views ?? null) : null,
  }
}

export function parseFbPost(p: Record<string, unknown>): SocialPostRow | null {
  const id = String(p.id ?? '')
  const at = Date.parse(String(p.created_time ?? ''))
  if (!/^\d{1,30}_\d{1,30}$|^\d{1,30}$/.test(id) || !Number.isFinite(at)) return null
  const summary = (k: string) => optNum(((p[k] as { summary?: { total_count?: unknown } } | undefined)?.summary ?? {}).total_count)
  const permalink = text(p.permalink_url, 500)
  return {
    network: 'facebook',
    postId: id,
    publishedAt: new Date(at),
    format: text(p.status_type, 40) === 'added_video' ? 'Vídeo' : text(p.status_type, 40) === 'added_photos' ? 'Imagem' : 'Publicação',
    caption: text(p.message, 2000),
    permalink: /^https:\/\//.test(permalink) ? permalink : null,
    likes: summary('reactions'),
    comments: summary('comments'),
    shares: optNum((p.shares as { count?: unknown } | undefined)?.count) ?? 0,
    saves: null,
    reach: null,
    impressions: null,
    videoViews: null,
  }
}

/** Insights da Graph API ("data": [{ name, values: [{ value, end_time }] }]) → por dia. */
export function parseDailyInsights(data: unknown): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>()
  if (!Array.isArray(data)) return out
  for (const metric of data as { name?: string; values?: { value?: unknown; end_time?: string }[] }[]) {
    for (const v of metric.values ?? []) {
      const end = Date.parse(String(v.end_time ?? ''))
      if (!metric.name || !Number.isFinite(end) || typeof v.value === 'object') continue
      // end_time é o fim do dia (meia-noite do dia seguinte, no fuso da conta): o dia é o anterior.
      const day = new Date(end - 3 * 3_600_000 - 1).toISOString().slice(0, 10)
      out.set(day, { ...(out.get(day) ?? {}), [metric.name]: toNum(v.value) })
    }
  }
  return out
}

/** Insights de uma publicação ("data": [{ name, values: [{ value }] }] ou "total_value") → { métrica: valor }. */
export function parsePostInsights(data: unknown) {
  const out: Record<string, number> = {}
  if (!Array.isArray(data)) return out
  for (const m of data as { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } }[]) {
    if (!m.name) continue
    const v = m.total_value?.value ?? m.values?.[0]?.value
    if (typeof v === 'number' || typeof v === 'string') out[m.name] = toNum(v)
  }
  return out
}

// ---------- TikTok ----------

export function parseTikTokReport(data: unknown, level: AdDayRow['level']): AdDayRow[] {
  const list = (data as { list?: unknown } | null)?.list
  if (!Array.isArray(list)) return []
  const out: AdDayRow[] = []
  for (const r of list as { dimensions?: Record<string, unknown>; metrics?: Record<string, unknown> }[]) {
    const d = r.dimensions ?? {}
    const m = r.metrics ?? {}
    const date = String(d.stat_time_day ?? '').slice(0, 10)
    const entityId = String(level === 'campaign' ? d.campaign_id : level === 'adset' ? d.adgroup_id : d.ad_id) || ''
    const campaignId = String(m.campaign_id ?? d.campaign_id ?? (level === 'campaign' ? entityId : '')) || ''
    if (!DATE.test(date) || !/^\d{1,30}$/.test(entityId)) continue
    out.push({
      platform: 'tiktok',
      level,
      entityId,
      name: text(level === 'campaign' ? m.campaign_name : level === 'adset' ? m.adgroup_name : m.ad_name, 300) || entityId,
      campaignId: /^\d{1,30}$/.test(campaignId) ? campaignId : entityId,
      campaignName: text(m.campaign_name, 300) || campaignId || entityId,
      parentId: level === 'ad' ? String(m.adgroup_id ?? '') || null : level === 'adset' ? campaignId || null : null,
      objective: text(m.objective_type, 60) || null,
      date,
      spend: r2(toNum(m.spend)),
      impressions: Math.round(toNum(m.impressions)),
      reach: optNum(m.reach),
      clicks: Math.round(toNum(m.clicks)),
      leads: 0,
      conversations: 0,
      conversions: r2(toNum(m.conversion)),
      videoViews: optNum(m.video_play_actions),
    })
  }
  return out
}

// ---------- Search Console ----------

export interface SeoRow {
  date: string
  kind: 'total' | 'query' | 'page'
  key: string
  clicks: number
  impressions: number
  position: number
}

export function parseSearchAnalytics(data: unknown, date: string, kind: SeoRow['kind']): SeoRow[] {
  const rows = (data as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows) || !DATE.test(date)) return []
  const out: SeoRow[] = []
  for (const r of rows as { keys?: unknown[]; clicks?: unknown; impressions?: unknown; position?: unknown }[]) {
    const key = kind === 'total' ? 'total' : text(r.keys?.[kind === 'query' ? 0 : 0], 500)
    if (!key) continue
    out.push({ date, kind, key, clicks: Math.round(toNum(r.clicks)), impressions: Math.round(toNum(r.impressions)), position: Math.round(toNum(r.position) * 100) / 100 })
  }
  return out
}

/** Dias a pedir: a 1ª vez, o histórico (de trás para frente, em partes); depois, os últimos dias (os dados se acertam por até 3 dias). */
export function daysToSync(today: string, backfillFrom: string | null, backfillDays: number, recentDays: number, chunk: number) {
  const day = (offset: number, base = today) => new Date(Date.parse(`${base}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
  const recent = Array.from({ length: recentDays }, (_, i) => day(-i - 1))
  const oldest = day(-backfillDays)
  const start = backfillFrom ?? day(-recentDays - 1)
  const back: string[] = []
  for (let d = start; d >= oldest && back.length < chunk; d = day(-1, d)) back.push(d)
  return { days: [...new Set([...recent, ...back])], nextBackfill: back.length ? day(-1, back[back.length - 1]!) : start, done: !back.length || back[back.length - 1]! <= oldest }
}
