/**
 * Contas das telas das plataformas (Google Ads em detalhe, Meta/TikTok, SEO e redes sociais).
 * Funções puras, testadas em test/marketing.spec.ts. Métrica que a fonte não trouxe fica null ("Não disponível").
 */
import { div, pct } from './metricas'

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ---------- Mídia (Meta, TikTok e recortes do Google) ----------

export interface MediaDay {
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
  creative?: unknown
}

/** Resultado da campanha pelo objetivo: lead, conversa, compra ou clique (nunca somados entre si). */
export function resultOf(objective: string | null) {
  const o = (objective ?? '').toUpperCase()
  if (/LEAD/.test(o)) return 'leads' as const
  if (/MESSAG/.test(o)) return 'conversations' as const
  if (/SALES|CONVERSION|PURCHASE|SHOP|PRODUCT_SALES/.test(o)) return 'conversions' as const
  if (/VIDEO|AWARENESS|REACH|BRAND/.test(o)) return 'videoViews' as const
  return 'clicks' as const
}
export const RESULT_LABEL = { leads: 'Leads', conversations: 'Conversas iniciadas', conversions: 'Conversões', videoViews: 'Visualizações de vídeo', clicks: 'Cliques' }

export function aggregateMedia(rows: MediaDay[]) {
  const map = new Map<string, MediaDay[]>()
  for (const r of rows) map.set(r.entityId, [...(map.get(r.entityId) ?? []), r])
  return [...map.entries()]
    .map(([entityId, list]) => {
      const last = list.reduce((a, b) => (a.date > b.date ? a : b))
      const sum = (k: 'spend' | 'impressions' | 'clicks' | 'leads' | 'conversations' | 'conversions') => list.reduce((s, x) => s + x[k], 0)
      const reachKnown = list.every((x) => x.reach !== null)
      const views = list.some((x) => x.videoViews !== null) ? list.reduce((s, x) => s + (x.videoViews ?? 0), 0) : null
      const spend = Math.round(sum('spend') * 100) / 100
      const impressions = sum('impressions')
      const clicks = sum('clicks')
      // Alcance somado dia a dia é maior que o alcance real do período (a mesma pessoa conta em vários dias): a tela avisa.
      const reach = reachKnown ? list.reduce((s, x) => s + (x.reach ?? 0), 0) : null
      const result = resultOf(last.objective)
      const results = result === 'videoViews' ? (views ?? 0) : result === 'clicks' ? clicks : sum(result)
      return {
        entityId,
        name: last.name,
        campaignId: last.campaignId,
        campaignName: last.campaignName,
        parentId: last.parentId,
        objective: last.objective,
        creative: last.creative ?? null,
        spend,
        impressions,
        reach,
        clicks,
        leads: sum('leads'),
        conversations: sum('conversations'),
        conversions: Math.round(sum('conversions') * 100) / 100,
        videoViews: views,
        ctr: r2(pct(clicks, impressions)),
        cpc: r2(div(spend, clicks)),
        cpm: impressions > 0 ? r2((spend / impressions) * 1000) : null,
        frequency: reach ? r2(impressions / reach) : null,
        result,
        resultLabel: RESULT_LABEL[result],
        results,
        costPerResult: r2(div(spend, results)),
        days: list.length,
      }
    })
    .sort((a, b) => b.spend - a.spend)
}

export interface Fatigue {
  entityId: string
  name: string
  reasons: string[]
}

/**
 * Sinais de cansaço do anúncio (últimos 7 dias contra os 7 anteriores): CTR caiu 30% ou mais, custo por resultado
 * subiu 30% ou mais, ou frequência alta (3,5 ou mais). Só com amostra suficiente (1.000 impressões em cada janela).
 */
export function fatigue(rows: MediaDay[], today: string): Fatigue[] {
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
  const recent = rows.filter((r) => r.date > day(7))
  const before = rows.filter((r) => r.date > day(14) && r.date <= day(7))
  const a = new Map(aggregateMedia(recent).map((x) => [x.entityId, x]))
  const b = new Map(aggregateMedia(before).map((x) => [x.entityId, x]))
  const out: Fatigue[] = []
  for (const [id, now] of a) {
    const reasons: string[] = []
    const prev = b.get(id)
    if (prev && now.impressions >= 1000 && prev.impressions >= 1000) {
      if (now.ctr !== null && prev.ctr !== null && prev.ctr > 0 && now.ctr <= prev.ctr * 0.7) reasons.push(`CTR caiu de ${prev.ctr.toLocaleString('pt-BR')}% para ${now.ctr.toLocaleString('pt-BR')}%`)
      if (now.costPerResult !== null && prev.costPerResult !== null && now.results >= 5 && prev.results >= 5 && now.costPerResult >= prev.costPerResult * 1.3)
        reasons.push(`custo por resultado subiu de R$ ${prev.costPerResult.toLocaleString('pt-BR')} para R$ ${now.costPerResult.toLocaleString('pt-BR')}`)
    }
    if (now.frequency !== null && now.frequency >= 3.5 && now.impressions >= 1000) reasons.push(`frequência de ${now.frequency.toLocaleString('pt-BR')} na última semana (aprox.)`)
    if (reasons.length) out.push({ entityId: id, name: now.name, reasons })
  }
  return out
}

// ---------- SEO ----------

export interface SeoAgg {
  key: string
  clicks: number
  impressions: number
  /** Posição média ponderada pelas impressões. */
  position: number | null
  ctr: number | null
}

export function aggregateSeo(rows: { key: string; clicks: number; impressions: number; position: number }[]): SeoAgg[] {
  const map = new Map<string, { clicks: number; impressions: number; posWeighted: number }>()
  for (const r of rows) {
    const m = map.get(r.key) ?? { clicks: 0, impressions: 0, posWeighted: 0 }
    m.clicks += r.clicks
    m.impressions += r.impressions
    m.posWeighted += r.position * r.impressions
    map.set(r.key, m)
  }
  return [...map.entries()]
    .map(([key, m]) => ({ key, clicks: m.clicks, impressions: m.impressions, position: m.impressions ? Math.round((m.posWeighted / m.impressions) * 10) / 10 : null, ctr: r2(pct(m.clicks, m.impressions)) }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
}

/** CTR esperado por posição (referência de mercado, aproximada): usado só para apontar consultas com espaço para melhorar. */
const EXPECTED_CTR = [0, 28, 15, 10, 7, 5, 4, 3, 2.5, 2, 1.8]
export const expectedCtr = (position: number) => EXPECTED_CTR[Math.min(10, Math.max(1, Math.round(position)))] ?? 1.5

/**
 * Oportunidades: consultas com muitas impressões, na 1ª ou 2ª página (posição 4 a 20) e CTR abaixo do esperado.
 * Melhorar título/descrição ou o conteúdo da página pode trazer mais cliques (é potencial, não garantia).
 */
export function seoOpportunities(list: SeoAgg[], minImpressions = 100) {
  return list
    .filter((q) => q.position !== null && q.position >= 4 && q.position <= 20 && q.impressions >= minImpressions && (q.ctr ?? 0) < expectedCtr(q.position))
    .map((q) => ({ ...q, expectedCtr: expectedCtr(q.position!), potentialClicks: Math.max(0, Math.round((q.impressions * expectedCtr(q.position!)) / 100 - q.clicks)) }))
    .sort((a, b) => b.potentialClicks - a.potentialClicks)
}

/** Agrupa consultas ou páginas por marca/categoria (pelo nome aparecendo no texto). Uma linha pode entrar em mais de um grupo. */
export function groupByNames(list: SeoAgg[], names: string[]) {
  const groups = names
    .map((n) => ({ name: n, key: norm(n).trim() }))
    .filter((n) => n.key.length >= 3)
    .map((n) => {
      const re = new RegExp(`(^|[^a-z0-9])${n.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\\-_/]+')}([^a-z0-9]|$)`)
      const hit = list.filter((q) => re.test(norm(decodeSafe(q.key))))
      const clicks = hit.reduce((s, q) => s + q.clicks, 0)
      const impressions = hit.reduce((s, q) => s + q.impressions, 0)
      return { name: n.name, items: hit.length, clicks, impressions, ctr: r2(pct(clicks, impressions)) }
    })
  return groups.filter((g) => g.items > 0).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
}
const decodeSafe = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Caminho da página (sem domínio, parâmetros e barra final), para cruzar a página de entrada do lead com o Search Console. */
export function pagePath(url: string | null | undefined) {
  if (!url) return null
  try {
    const u = new URL(url)
    return (u.pathname.replace(/\/+$/, '') || '/').toLowerCase()
  } catch {
    return null
  }
}

// ---------- Redes sociais ----------

export interface PostRow {
  network: string
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

export function rankPosts<T extends PostRow>(posts: T[]) {
  return posts
    .map((p) => {
      const engagement = (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)
      return { ...p, engagement, engagementRate: p.reach ? r2((engagement / p.reach) * 100) : null }
    })
    .sort((a, b) => (b.engagementRate ?? -1) - (a.engagementRate ?? -1) || b.engagement - a.engagement)
}

export function byFormat(posts: ReturnType<typeof rankPosts<PostRow>>) {
  const map = new Map<string, ReturnType<typeof rankPosts<PostRow>>>()
  for (const p of posts) map.set(p.format, [...(map.get(p.format) ?? []), p])
  return [...map.entries()]
    .map(([format, list]) => {
      const reach = list.every((p) => p.reach !== null) ? list.reduce((s, p) => s + (p.reach ?? 0), 0) : null
      const engagement = list.reduce((s, p) => s + p.engagement, 0)
      return { format, posts: list.length, engagement, reach, avgEngagement: Math.round(engagement / list.length), engagementRate: reach ? r2((engagement / reach) * 100) : null }
    })
    .sort((a, b) => b.engagement - a.engagement)
}

/** Tema da publicação: marcas e tipos de peça citados no texto (para ver quais temas engajam mais). */
export function themesOf(caption: string, names: string[]) {
  const t = ` ${norm(caption)} `
  return names.filter((n) => {
    const k = norm(n).trim()
    return k.length >= 3 && new RegExp(`[^a-z0-9]${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(t)
  })
}
