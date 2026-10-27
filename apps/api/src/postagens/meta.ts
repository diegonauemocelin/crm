/**
 * Publicação na Meta (Graph API) para o Instagram profissional e a página do Facebook.
 * As mídias vão por endereço público (a Meta baixa o arquivo do CRM). O fetch é injetável para os testes.
 */
import { GRAPH } from '../marketing/config'
import type { Account, NetworkResult, PostFormat } from './postagens'

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
export interface PublishMedia {
  kind: 'imagem' | 'video'
  url: string
}
export interface PublishInput {
  format: PostFormat
  caption: string
  media: PublishMedia[]
}

export class MetaError extends Error {}

export interface Breakdown {
  key: string
  value: number
}
export interface Demographics {
  age: Breakdown[]
  gender: Breakdown[]
  city: Breakdown[]
  country: Breakdown[]
}
/** Métricas de uma conta nos últimos 28 dias (null = a Meta não informou). */
export interface AccountMetrics {
  followers: number | null
  posts: number | null
  reach: number | null
  engaged: number | null
  interactions: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
  demographics: Demographics | null
  warnings: string[]
}
export interface PostMetrics {
  reach: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
  interactions: number | null
}

/** Mensagem da Graph API em português, com a dica de permissão quando é o caso. */
export function metaMessage(status: number, body: unknown) {
  const e = (body as { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } } | null)?.error
  const msg = e?.error_user_msg || e?.message || `erro ${status}`
  if (e?.code === 10 || e?.code === 200 || /permission/i.test(msg)) return `Sem permissão para publicar: o token precisa de instagram_content_publish (Instagram) e pages_manage_posts (Facebook). (${msg})`
  if (e?.code === 9 || e?.code === 4 || /limit/i.test(msg)) return `Limite de publicações da Meta atingido. Tente mais tarde. (${msg})`
  if (e?.code === 190) return `Token da Meta vencido ou inválido: gere de novo em Configurações › Marketing Inteligente. (${msg})`
  if (e?.code === 36003 || /aspect ratio/i.test(msg)) return `Proporção da imagem não aceita pelo Instagram (use 1:1, 4:5 ou 9:16). (${msg})`
  if (e?.code === 9004 || e?.error_subcode === 2207052 || /media.*(fetch|download)|could not be fetched/i.test(msg)) return `A Meta não conseguiu baixar a mídia do CRM (o endereço do CRM precisa estar acessível na internet). (${msg})`
  return msg.slice(0, 300)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class MetaPublisher {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetcher = fetch,
    /** Espera entre as consultas do processamento de vídeo (menor nos testes). */
    private readonly pollMs = 5_000,
    /** graph.facebook.com (token da Meta) ou graph.instagram.com (conta conectada pelo login do Instagram). */
    private readonly base = GRAPH,
  ) {}

  private async call(method: 'GET' | 'POST', path: string, params: Record<string, string | boolean | undefined> = {}, token = this.token) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v))
    // a API do Instagram recebe o token como parâmetro
    if (this.base !== GRAPH) qs.set('access_token', token)
    const url = `${this.base}/${path}${method === 'GET' && qs.size ? `?${qs}` : ''}`
    const res = await this.fetcher(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? qs.toString() : undefined,
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !body || body.error) throw new MetaError(metaMessage(res.status, body))
    return body
  }

  /**
   * Contas que o token alcança: as páginas atribuídas e o Instagram profissional ligado a cada uma
   * (botão "Buscar na Meta" da lista de contas).
   */
  async discover(): Promise<Account[]> {
    const body = await this.call('GET', 'me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: '100' })
    const out: Account[] = []
    for (const p of (body.data as { id: string; name?: string; instagram_business_account?: { id: string; username?: string } }[] | undefined) ?? []) {
      const ig = p.instagram_business_account
      if (ig?.id) out.push({ id: `ig-${ig.id}`, network: 'instagram', externalId: ig.id, name: ig.username ? `@${ig.username}` : `Instagram de ${p.name ?? p.id}`, group: 'Geral' })
      out.push({ id: `fb-${p.id}`, network: 'facebook', externalId: p.id, name: p.name ?? `Página ${p.id}`, group: 'Geral' })
    }
    return out
  }

  /** Permissões do token e cada conta cadastrada (botão Testar publicação). */
  async check(accounts: Account[]) {
    const checks: { name: string; ok: boolean; message: string }[] = []
    const perms = await this.call('GET', 'me/permissions').catch(() => null)
    const granted = new Set(((perms?.data as { permission: string; status: string }[] | undefined) ?? []).filter((p) => p.status === 'granted').map((p) => p.permission))
    if (perms) {
      for (const p of ['instagram_content_publish', 'pages_manage_posts', 'pages_read_engagement']) checks.push({ name: p, ok: granted.has(p), message: granted.has(p) ? 'concedida' : 'falta no token: adicione no app da Meta e gere o token de novo' })
    }
    if (!accounts.length) checks.push({ name: 'Contas', ok: false, message: 'Nenhuma conta cadastrada: use Buscar na Meta na aba Contas.' })
    for (const a of accounts) {
      try {
        if (a.network === 'instagram') {
          checks.push(await this.instagramCheck(a))
        } else {
          const page = await this.call('GET', a.externalId, { fields: 'name,access_token' })
          checks.push({ name: `Facebook ${a.name}`, ok: !!page.access_token, message: page.access_token ? `Página ${String(page.name ?? '')}` : 'O token não traz o acesso da página (atribua a página ao usuário do sistema).' })
        }
      } catch (err) {
        checks.push({ name: `${a.network === 'instagram' ? 'Instagram' : 'Facebook'} ${a.name}`, ok: false, message: (err as Error).message })
      }
    }
    return checks
  }

  /** Instagram: o @ e quantas publicações a conta ainda pode fazer nas 24 h. */
  async instagramCheck(a: Account) {
    const ig = await this.call('GET', a.externalId, { fields: 'username' })
    const limit = await this.call('GET', `${a.externalId}/content_publishing_limit`, { fields: 'quota_usage,config' }).catch(() => null)
    const used = (limit?.data as { quota_usage?: number; config?: { quota_total?: number } }[] | undefined)?.[0]
    return { name: `Instagram ${a.name}`, ok: true, message: `@${String(ig.username ?? '')}${used ? ` · ${used.quota_usage ?? 0} de ${used.config?.quota_total ?? 50} publicações nas últimas 24 h` : ''}` }
  }

  // ---------- Métricas ----------

  /** Instagram: perfil, últimos 28 dias (alcance e interações) e o perfil dos seguidores. */
  async instagramMetrics(igId: string): Promise<AccountMetrics> {
    const warnings: string[] = []
    const profile = await this.call('GET', igId, { fields: 'followers_count,follows_count,media_count,username' })
    const until = Math.floor(Date.now() / 1000)
    const since = until - 28 * 86_400
    const totals: Record<string, number> = {}
    try {
      const ins = await this.call('GET', `${igId}/insights`, { metric: 'reach,accounts_engaged,total_interactions,likes,comments,saves,shares', period: 'day', metric_type: 'total_value', since: String(since), until: String(until) })
      for (const d of (ins.data as { name: string; total_value?: { value?: number } }[] | undefined) ?? []) totals[d.name] = Number(d.total_value?.value ?? 0)
    } catch (err) {
      warnings.push(`alcance e interações não lidos (${(err as Error).message.slice(0, 120)})`)
    }
    const demographics: Demographics = { age: [], gender: [], city: [], country: [] }
    for (const b of ['age', 'gender', 'city', 'country'] as const) {
      try {
        const r = await this.call('GET', `${igId}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: b })
        const results = (r.data as { total_value?: { breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] } }[] | undefined)?.[0]?.total_value?.breakdowns?.[0]?.results ?? []
        demographics[b] = results.map((x) => ({ key: String(x.dimension_values?.[0] ?? ''), value: Number(x.value ?? 0) })).filter((x) => x.key).sort((a, c) => c.value - a.value).slice(0, b === 'city' || b === 'country' ? 8 : 10)
      } catch {
        if (b === 'age') warnings.push('perfil dos seguidores indisponível (o Instagram só mostra com 100 seguidores ou mais)')
      }
    }
    const n = (k: string) => (k in totals ? totals[k]! : null)
    return {
      followers: Number(profile.followers_count ?? 0),
      posts: Number(profile.media_count ?? 0),
      reach: n('reach'),
      engaged: n('accounts_engaged'),
      interactions: n('total_interactions'),
      likes: n('likes'),
      comments: n('comments'),
      saves: n('saves'),
      shares: n('shares'),
      demographics: demographics.age.length || demographics.gender.length || demographics.city.length ? demographics : null,
      warnings,
    }
  }

  /** Página do Facebook: seguidores e os últimos 28 dias (a Meta não dá mais o perfil dos seguidores de páginas). */
  async facebookMetrics(pageId: string): Promise<AccountMetrics> {
    const warnings: string[] = []
    const page = await this.call('GET', pageId, { fields: 'followers_count,fan_count,access_token' })
    const pt = String(page.access_token ?? '')
    const totals: Record<string, number> = {}
    if (pt) {
      for (const metric of ['page_impressions_unique', 'page_post_engagements']) {
        try {
          const ins = await this.call('GET', `${pageId}/insights`, { metric, period: 'days_28' }, pt)
          const values = (ins.data as { values?: { value?: number }[] }[] | undefined)?.[0]?.values ?? []
          totals[metric] = Number(values[values.length - 1]?.value ?? 0)
        } catch {
          warnings.push(`${metric === 'page_impressions_unique' ? 'alcance' : 'interações'} da página não lido`)
        }
      }
    } else warnings.push('o token não traz o acesso da página')
    return {
      followers: Number(page.followers_count ?? page.fan_count ?? 0),
      posts: null,
      reach: totals.page_impressions_unique ?? null,
      engaged: null,
      interactions: totals.page_post_engagements ?? null,
      likes: null,
      comments: null,
      saves: null,
      shares: null,
      demographics: null,
      warnings,
    }
  }

  /** Números de uma postagem publicada (alcance e interações). */
  async postMetrics(network: 'instagram' | 'facebook', mediaId: string, pageId?: string): Promise<PostMetrics> {
    if (network === 'instagram') {
      const ins = await this.call('GET', `${mediaId}/insights`, { metric: 'reach,likes,comments,saved,shares,total_interactions' })
      const v: Record<string, number> = {}
      for (const d of (ins.data as { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] | undefined) ?? []) v[d.name] = Number(d.values?.[0]?.value ?? d.total_value?.value ?? 0)
      return { reach: v.reach ?? null, likes: v.likes ?? null, comments: v.comments ?? null, saves: v.saved ?? null, shares: v.shares ?? null, interactions: v.total_interactions ?? null }
    }
    const page = pageId ? await this.call('GET', pageId, { fields: 'access_token' }) : null
    const pt = String(page?.access_token ?? '') || this.token
    const p = await this.call('GET', mediaId, { fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares' }, pt)
    const likes = Number((p.reactions as { summary?: { total_count?: number } } | undefined)?.summary?.total_count ?? 0)
    const comments = Number((p.comments as { summary?: { total_count?: number } } | undefined)?.summary?.total_count ?? 0)
    const shares = Number((p.shares as { count?: number } | undefined)?.count ?? 0)
    return { reach: null, likes, comments, saves: null, shares, interactions: likes + comments + shares }
  }

  // ---------- Instagram ----------

  /** Espera o contêiner ficar pronto (vídeo leva alguns segundos ou minutos na Meta). */
  private async ready(containerId: string) {
    for (let i = 0; i < 60; i++) {
      const s = await this.call('GET', containerId, { fields: 'status_code,status' })
      if (s.status_code === 'FINISHED') return
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new MetaError(`A Meta não conseguiu processar a mídia (${String(s.status ?? s.status_code)}). Confira o formato (MP4/H.264, até 90 s nos Stories).`)
      await sleep(this.pollMs)
    }
    throw new MetaError('A Meta demorou demais para processar o vídeo. Tente publicar de novo.')
  }

  async instagram(igId: string, p: PublishInput): Promise<NetworkResult> {
    const one = p.media[0]
    if (!one) throw new MetaError('Postagem sem mídia.')
    let creation: string
    if (p.format === 'STORIES') {
      const c = await this.call('POST', `${igId}/media`, { media_type: 'STORIES', ...(one.kind === 'video' ? { video_url: one.url } : { image_url: one.url }) })
      creation = String(c.id)
    } else if (p.format === 'REELS' || one.kind === 'video') {
      const c = await this.call('POST', `${igId}/media`, { media_type: 'REELS', video_url: one.url, caption: p.caption, share_to_feed: true })
      creation = String(c.id)
    } else if (p.media.length > 1) {
      const children: string[] = []
      for (const m of p.media) children.push(String((await this.call('POST', `${igId}/media`, { image_url: m.url, is_carousel_item: true })).id))
      const c = await this.call('POST', `${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: p.caption })
      creation = String(c.id)
    } else {
      creation = String((await this.call('POST', `${igId}/media`, { image_url: one.url, caption: p.caption })).id)
    }
    await this.ready(creation)
    const pub = await this.call('POST', `${igId}/media_publish`, { creation_id: creation })
    const id = String(pub.id)
    const link = await this.call('GET', id, { fields: 'permalink' }).catch(() => null)
    return { id, permalink: (link?.permalink as string | undefined) ?? null, at: new Date().toISOString() }
  }

  // ---------- Facebook (página) ----------

  async facebook(pageId: string, p: PublishInput): Promise<NetworkResult> {
    const page = await this.call('GET', pageId, { fields: 'access_token' })
    const pt = String(page.access_token ?? '')
    if (!pt) throw new MetaError('O token não traz o acesso da página (atribua a página ao usuário do sistema no Gerenciador de Negócios).')
    const one = p.media[0]
    if (!one) throw new MetaError('Postagem sem mídia.')
    let id: string
    if (p.format === 'STORIES') {
      if (one.kind === 'video') {
        const start = await this.call('POST', `${pageId}/video_stories`, { upload_phase: 'start' }, pt)
        const videoId = String(start.video_id)
        const up = await this.fetcher(String(start.upload_url), { method: 'POST', headers: { Authorization: `OAuth ${pt}`, file_url: one.url }, signal: AbortSignal.timeout(120_000) })
        if (!up.ok) throw new MetaError(metaMessage(up.status, await up.json().catch(() => null)))
        const fin = await this.call('POST', `${pageId}/video_stories`, { upload_phase: 'finish', video_id: videoId }, pt)
        id = String(fin.post_id ?? videoId)
      } else {
        const photo = await this.call('POST', `${pageId}/photos`, { url: one.url, published: false }, pt)
        const st = await this.call('POST', `${pageId}/photo_stories`, { photo_id: String(photo.id) }, pt)
        id = String(st.post_id ?? photo.id)
      }
    } else if (one.kind === 'video') {
      const v = await this.call('POST', `${pageId}/videos`, { file_url: one.url, description: p.caption }, pt)
      id = String(v.id)
    } else if (p.media.length > 1) {
      const attached: string[] = []
      for (const m of p.media) attached.push(String((await this.call('POST', `${pageId}/photos`, { url: m.url, published: false }, pt)).id))
      const params: Record<string, string> = { message: p.caption }
      attached.forEach((a, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: a })))
      id = String((await this.call('POST', `${pageId}/feed`, params, pt)).id)
    } else {
      const ph = await this.call('POST', `${pageId}/photos`, { url: one.url, caption: p.caption }, pt)
      id = String(ph.post_id ?? ph.id)
    }
    const link = await this.call('GET', id, { fields: 'permalink_url' }, pt).catch(() => null)
    return { id, permalink: (link?.permalink_url as string | undefined) ?? null, at: new Date().toISOString() }
  }
}
