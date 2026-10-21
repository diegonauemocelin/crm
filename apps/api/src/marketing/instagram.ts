/**
 * Instagram no Marketing Inteligente: público, melhores horários e comparação com concorrentes (funções puras, testadas).
 * Seguidores, curtidas e o público ficam só como números somados: nada daqui cria ou altera lead na base do CRM.
 */

export const IG_AUDIENCE_KEY = 'mkt_ig_publico'
export const COMPETITORS_KEY = 'mkt_concorrentes'
export const COMPETITORS_STATUS_KEY = 'mkt_concorrentes_status'
export const MAX_COMPETITORS = 10

/** Colunas do dia do perfil que a sincronização preenche. */
export type ProfileField = 'reach' | 'profileViews' | 'websiteClicks' | 'follows' | 'unfollows' | 'accountsEngaged' | 'interactions' | 'linkTaps' | 'views'

export interface IgAudience {
  updatedAt: string
  /** Média de seguidores online por dia da semana (0 = domingo) e hora de Brasília. */
  online: number[][] | null
  city: { key: string; value: number }[]
  age: { key: string; value: number }[]
  gender: { key: string; value: number }[]
  country: { key: string; value: number }[]
  /** O que a Meta respondeu quando recusou (para mostrar na tela o motivo real). */
  error?: string | null
}

export interface Competitor {
  username: string
  /** Nome para buscar na Biblioteca de Anúncios da Meta (página do Facebook). */
  label: string
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/** "@usaparts", link do perfil ou nome: vira o nome de usuário (letras, números, ponto e _). */
export function cleanUsername(v: unknown) {
  const s = String(v ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase()
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null
}

export function cleanCompetitors(v: unknown): Competitor[] {
  const out: Competitor[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const username = cleanUsername((x as { username?: unknown })?.username)
    if (!username || out.some((c) => c.username === username)) continue
    const label = String((x as { label?: unknown }).label ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    out.push({ username, label })
    if (out.length >= MAX_COMPETITORS) break
  }
  return out
}

/** Biblioteca de Anúncios da Meta (anúncios ativos no Brasil) buscando pelo nome do concorrente. */
export function adLibraryUrl(c: Competitor) {
  const q = encodeURIComponent(c.label || c.username)
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q=${q}&search_type=keyword_unordered&media_type=all`
}

// ---------- Melhores horários ----------

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/** Hora e dia da semana em Brasília (sem horário de verão desde 2019). */
export function brTime(d: Date) {
  const t = new Date(d.getTime() - 3 * 3_600_000)
  return { weekday: t.getUTCDay(), hour: t.getUTCHours() }
}

interface TimedPost {
  publishedAt: Date
  format: string
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
}

/** Faixas de 3 horas (00-03, 03-06...): com poucas publicações, a hora exata não diz nada. */
export const SLOT_HOURS = 3
const slotOf = (hour: number) => Math.floor(hour / SLOT_HOURS) * SLOT_HOURS

/**
 * Desempenho das publicações por dia da semana e faixa de horário (Brasília): alcance médio e engajamento médio.
 * Só sugere faixa com 2 publicações ou mais; stories ficam de fora (têm outra lógica de alcance).
 */
export function postTimes(posts: TimedPost[]) {
  const cells = new Map<string, { weekday: number; slot: number; posts: number; reach: number; withReach: number; engagement: number }>()
  for (const p of posts) {
    if (p.format === 'Story') continue
    const { weekday, hour } = brTime(p.publishedAt)
    const slot = slotOf(hour)
    const k = `${weekday}|${slot}`
    const c = cells.get(k) ?? { weekday, slot, posts: 0, reach: 0, withReach: 0, engagement: 0 }
    c.posts++
    c.engagement += (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)
    if (p.reach !== null) {
      c.reach += p.reach
      c.withReach++
    }
    cells.set(k, c)
  }
  const list = [...cells.values()].map((c) => ({
    weekday: c.weekday,
    slot: c.slot,
    label: `${WEEKDAYS[c.weekday]}, ${String(c.slot).padStart(2, '0')}h–${String(c.slot + SLOT_HOURS).padStart(2, '0')}h`,
    posts: c.posts,
    avgReach: c.withReach ? Math.round(c.reach / c.withReach) : null,
    avgEngagement: r1(c.engagement / c.posts),
    engagementRate: c.reach ? r2((c.engagement / c.reach) * 100) : null,
  }))
  // Ordena pelo alcance médio quando a rede informa alcance; senão, pelo engajamento médio.
  const score = (x: (typeof list)[number]) => x.avgReach ?? x.avgEngagement
  const best = list.filter((x) => x.posts >= 2).sort((a, b) => score(b) - score(a)).slice(0, 3)
  return { cells: list, best }
}

/** Horas de pico do público online: as 3 faixas com mais seguidores online, na média da semana e por dia. */
export function onlinePeaks(online: number[][] | null) {
  if (!online || online.length !== 7) return null
  const byHour = Array.from({ length: 24 }, (_, h) => Math.round(online.reduce((s, row) => s + (row[h] ?? 0), 0) / 7))
  const max = Math.max(...byHour)
  if (!max) return null
  const peaks = byHour
    .map((v, h) => ({ hour: h, value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .sort((a, b) => a.hour - b.hour)
  const byWeekday = online.map((row, d) => {
    const top = row.map((v, h) => ({ hour: h, value: v })).sort((a, b) => b.value - a.value)[0]!
    return { weekday: d, label: WEEKDAYS[d]!, total: row.reduce((s, v) => s + v, 0), peakHour: top.value ? top.hour : null }
  })
  const bestDay = [...byWeekday].sort((a, b) => b.total - a.total)[0]!
  return { byHour, peaks, byWeekday, bestDay: bestDay.label }
}

/**
 * Recomendação de horário: publicar um pouco antes do pico do público (o post começa a circular quando eles entram)
 * e conferir com as faixas que já deram mais alcance.
 */
export function recommendTimes(peaks: ReturnType<typeof onlinePeaks>, best: ReturnType<typeof postTimes>['best']) {
  const out: string[] = []
  if (peaks) for (const p of peaks.peaks) out.push(`${String((p.hour + 23) % 24).padStart(2, '0')}h–${String(p.hour).padStart(2, '0')}h (o público mais ativo é às ${String(p.hour).padStart(2, '0')}h)`)
  for (const b of best) out.push(`${b.label} (média de ${b.avgReach !== null ? `${b.avgReach.toLocaleString('pt-BR')} de alcance` : `${b.avgEngagement.toLocaleString('pt-BR')} interações`} em ${b.posts} publicações)`)
  return out
}

// ---------- Concorrentes ----------

export interface CompetitorDayRow {
  username: string
  date: Date
  name: string | null
  followers: number
  mediaCount: number
}
export interface CompetitorPost {
  username: string
  publishedAt: Date
  format: string
  likes: number | null
  comments: number | null
  permalink: string | null
  caption: string
}
export interface CompetitorNoteRow {
  username: string
  date: Date
  storiesSeen: number | null
  adsActive: boolean | null
}

const day = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Uma linha por perfil (o da empresa e cada concorrente), com o mesmo cálculo para todos: só o que é público.
 * Engajamento por publicação = (curtidas + comentários) ÷ seguidores. Curtidas ocultas pelo dono ficam de fora da média.
 */
export function profileStats(input: {
  username: string
  name: string | null
  own: boolean
  days: CompetitorDayRow[]
  posts: CompetitorPost[]
  notes: CompetitorNoteRow[]
  from: string
  to: string
  periodDays: number
}) {
  const days = [...input.days].sort((a, b) => a.date.getTime() - b.date.getTime())
  const inPeriod = days.filter((d) => day(d.date) >= input.from && day(d.date) <= input.to)
  const last = days[days.length - 1] ?? null
  const first = inPeriod[0] ?? null
  const followers = last?.followers ?? null
  const posts = input.posts.filter((p) => day(new Date(p.publishedAt.getTime() - 3 * 3_600_000)) >= input.from && day(new Date(p.publishedAt.getTime() - 3 * 3_600_000)) <= input.to)
  const feed = posts.filter((p) => p.format !== 'Reels' && p.format !== 'Story')
  const reels = posts.filter((p) => p.format === 'Reels')
  const withLikes = posts.filter((p) => p.likes !== null)
  const interactions = withLikes.reduce((s, p) => s + (p.likes ?? 0) + (p.comments ?? 0), 0)
  const avgInteractions = withLikes.length ? interactions / withLikes.length : null
  const notes = input.notes.filter((n) => day(n.date) >= input.from && day(n.date) <= input.to)
  const storyNotes = notes.filter((n) => n.storiesSeen !== null)
  const adNotes = [...input.notes].filter((n) => n.adsActive !== null).sort((a, b) => b.date.getTime() - a.date.getTime())
  const top = [...withLikes].sort((a, b) => (b.likes ?? 0) + (b.comments ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0)))[0] ?? null
  const weeks = Math.max(1, input.periodDays) / 7
  return {
    username: input.username,
    name: input.name ?? last?.name ?? null,
    own: input.own,
    followers,
    followersGrowth: first && last && first !== last ? last.followers - first.followers : null,
    totalPosts: last?.mediaCount ?? null,
    feedPosts: feed.length,
    reels: reels.length,
    postsPerWeek: r1(posts.length / weeks),
    avgLikes: withLikes.length ? Math.round(withLikes.reduce((s, p) => s + (p.likes ?? 0), 0) / withLikes.length) : null,
    avgComments: withLikes.length ? r1(withLikes.reduce((s, p) => s + (p.comments ?? 0), 0) / withLikes.length) : null,
    engagementRate: avgInteractions !== null && followers ? r2((avgInteractions / followers) * 100) : null,
    hiddenLikes: posts.length - withLikes.length,
    lastPostAt: posts.length ? posts.reduce((m, p) => (p.publishedAt > m ? p.publishedAt : m), posts[0]!.publishedAt).toISOString() : null,
    topPost: top ? { permalink: top.permalink, caption: top.caption.slice(0, 140), format: top.format, interactions: (top.likes ?? 0) + (top.comments ?? 0) } : null,
    /** Stories: só o que a equipe registrou (a API não mostra stories de outras contas). */
    storiesDaysSeen: storyNotes.filter((n) => (n.storiesSeen ?? 0) > 0).length,
    storiesAvg: storyNotes.length ? r1(storyNotes.reduce((s, n) => s + (n.storiesSeen ?? 0), 0) / storyNotes.length) : null,
    storyChecks: storyNotes.length,
    /** Anúncio ativo: a última conferência na Biblioteca de Anúncios. */
    adsActive: adNotes[0]?.adsActive ?? null,
    adsCheckedAt: adNotes[0] ? day(adNotes[0].date) : null,
  }
}

// ---------- Tráfego pago no Instagram (posicionamentos da Meta) ----------

const POSITION_LABEL: Record<string, string> = {
  feed: 'Feed',
  instagram_stories: 'Stories',
  instagram_reels: 'Reels',
  instagram_explore: 'Explorar',
  instagram_explore_grid_home: 'Explorar (grade)',
  instagram_profile_feed: 'Feed do perfil',
  instagram_profile_reels: 'Reels do perfil',
  instagram_search: 'Busca',
}
export const positionLabel = (key: string) => {
  const pos = key.split(' · ')[1] ?? key
  return POSITION_LABEL[pos] ?? pos.replace(/^instagram_/, '').replace(/_/g, ' ')
}

/** Só o que a Meta entregou no Instagram (publisher_platform = instagram), por posicionamento. */
export function instagramPaid(rows: { key: string; spend: number; impressions: number; clicks: number; leads: number }[], metaSpend: number) {
  const map = new Map<string, { label: string; spend: number; impressions: number; clicks: number; leads: number }>()
  for (const r of rows) {
    if (!r.key.startsWith('instagram')) continue
    const label = positionLabel(r.key)
    const m = map.get(label) ?? { label, spend: 0, impressions: 0, clicks: 0, leads: 0 }
    m.spend += r.spend
    m.impressions += r.impressions
    m.clicks += r.clicks
    m.leads += r.leads
    map.set(label, m)
  }
  const positions = [...map.values()]
    .map((m) => ({ ...m, spend: r2(m.spend), ctr: m.impressions ? r2((m.clicks / m.impressions) * 100) : null, cpc: m.clicks ? r2(m.spend / m.clicks) : null, cpl: m.leads ? r2(m.spend / m.leads) : null }))
    .sort((a, b) => b.spend - a.spend)
  const t = positions.reduce((s, p) => ({ spend: s.spend + p.spend, impressions: s.impressions + p.impressions, clicks: s.clicks + p.clicks, leads: s.leads + p.leads }), { spend: 0, impressions: 0, clicks: 0, leads: 0 })
  return {
    totals: { ...t, spend: r2(t.spend), ctr: t.impressions ? r2((t.clicks / t.impressions) * 100) : null, cpc: t.clicks ? r2(t.spend / t.clicks) : null, cpl: t.leads ? r2(t.spend / t.leads) : null, shareOfMeta: metaSpend ? r1((t.spend / metaSpend) * 100) : null },
    positions,
  }
}

// ---------- Leads de formulário vindos do Instagram ----------

/** Meio pago: anúncio (cpc, paid...) ou formulário de anúncio da Meta. */
export const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|paid|paid_social|paidsocial|ads?|anuncio|patrocinado)$/i

export interface FormConversion {
  leadId: string
  at: Date
  medium: string | null
  form: string
}
export interface LeadRecord {
  leadId: string
  leadAt: Date
  forwarded: boolean
  returnStatus: string | null
  saleStatus: string
  saleValue: number
}

/**
 * Só quem preencheu formulário (Lead Ads da Meta ou formulário/pop-up/landing do site) com origem no Instagram.
 * Seguidor, curtida, comentário ou mensagem não é lead e não conta como possível venda.
 * Venda = atendimento do Pré-Vendas do mesmo lead, aberto a partir da conversão, marcado como vendido.
 */
export function formLeads(conv: FormConversion[], records: LeadRecord[], qualifiedRule: 'repassado_retorno' | 'repassado') {
  const first = new Map<string, FormConversion>()
  for (const c of [...conv].sort((a, b) => a.at.getTime() - b.at.getTime())) if (!first.has(c.leadId)) first.set(c.leadId, c)
  const byLead = new Map<string, LeadRecord[]>()
  for (const r of records) byLead.set(r.leadId, [...(byLead.get(r.leadId) ?? []), r])
  const forms = new Map<string, number>()
  let paid = 0
  let qualified = 0
  let sales = 0
  let revenue = 0
  for (const [leadId, c] of first) {
    if (c.medium && PAID_MEDIUM.test(c.medium)) paid++
    forms.set(c.form, (forms.get(c.form) ?? 0) + 1)
    const recs = (byLead.get(leadId) ?? []).filter((r) => r.leadAt.getTime() >= c.at.getTime() - 60_000)
    if (recs.some((r) => r.forwarded && (qualifiedRule === 'repassado' || r.returnStatus === 'SIM'))) qualified++
    const sold = recs.filter((r) => r.saleStatus === 'SIM')
    if (sold.length) {
      sales++
      revenue += sold.reduce((s, r) => s + r.saleValue, 0)
    }
  }
  const leads = first.size
  return {
    leads,
    paid,
    organic: leads - paid,
    qualified,
    sales,
    revenue: r2(revenue),
    conversionRate: leads ? r1((sales / leads) * 100) : null,
    forms: [...forms.entries()].map(([form, n]) => ({ form, leads: n })).sort((a, b) => b.leads - a.leads),
  }
}

// ---------- Perfis da empresa (oficial e vendedores) ----------

export const IG_ACCOUNTS_KEY = 'mkt_ig_contas'
export const MAX_IG_ACCOUNTS = 30

/**
 * Perfil do Instagram da empresa. Com id (conta no Gerenciador de Negócios da empresa): dados completos.
 * Só com @ (conta comercial fora do Gerenciador, como a de um vendedor): só os dados públicos.
 */
export interface IgAccount {
  id: string
  username: string
  label: string
  owner: 'empresa' | 'vendedor'
  sellerId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function cleanIgAccounts(v: unknown, officialId = ''): IgAccount[] {
  const out: IgAccount[] = []
  for (const x of Array.isArray(v) ? (v as Record<string, unknown>[]) : []) {
    const id = /^\d{5,30}$/.test(String(x?.id ?? '').trim()) ? String(x.id).trim() : ''
    const username = cleanUsername(x?.username) ?? ''
    if (!id && !username) continue
    if (id && id === officialId) continue
    if (out.some((a) => (id && a.id === id) || (username && a.username === username))) continue
    out.push({
      id,
      username,
      label: String(x.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || (username ? `@${username}` : `Conta ${id}`),
      owner: x.owner === 'vendedor' ? 'vendedor' : 'empresa',
      sellerId: typeof x.sellerId === 'string' && UUID.test(x.sellerId) ? x.sellerId : null,
    })
    if (out.length >= MAX_IG_ACCOUNTS) break
  }
  return out
}

/** Chave de cada perfil na tela: o id quando conectado, "@usuario" quando só público. */
export const accountKey = (a: { id: string; username: string }) => a.id || `@${a.username}`
export const audienceKey = (igId: string) => `${IG_AUDIENCE_KEY}:${igId}`
