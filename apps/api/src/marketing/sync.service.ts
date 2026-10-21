import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { decrypt } from '../common/crypto'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { DEFAULT_GA4, type Ga4Settings, GA_TOKEN_URL, signJwt } from '../relatorios/ga4'
import { SettingsService } from '../settings/settings.service'
import { DEFAULT_INTEGRATIONS, GRAPH, INTEGRATIONS_KEY, type IntegrationKey, type IntegrationsConfig, SC_SCOPE, TIKTOK_API } from './config'
import { audienceKey, cleanCompetitors, cleanIgAccounts, COMPETITORS_KEY, COMPETITORS_STATUS_KEY, IG_ACCOUNTS_KEY, type IgAudience, type ProfileField } from './instagram'
import {
  parseCompetitor,
  parseDemographics,
  parseOnlineFollowers,
  parseTotalValues,
  type AdDayRow,
  type BreakdownDayRow,
  daysToSync,
  metaError,
  parseDailyInsights,
  parseFbPost,
  parseIgMedia,
  parseMetaBreakdown,
  parseMetaCreative,
  parseMetaInsights,
  parsePostInsights,
  parseSearchAnalytics,
  parseTikTokReport,
  type SeoRow,
  type SocialPostRow,
} from './sync'

export const SYNC_KEY = 'mkt_sync'
const TICK_MS = 30 * 60_000
const HOURS: Record<IntegrationKey, number> = { metaAds: 3, metaOrganic: 6, tiktok: 3, searchConsole: 6 }
const BACKFILL_DAYS = 90

export interface SyncState {
  lastRunAt?: string
  lastOkAt?: string
  lastError?: string | null
  rows?: number
  /** Próximo dia do histórico a buscar (de trás para frente) e se o histórico terminou. */
  backfillFrom?: string | null
  backfillDone?: boolean
  running?: boolean
}
export type SyncStates = Partial<Record<IntegrationKey, SyncState>>

const today = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Explica o erro de permissão da Meta (#10/#200) dizendo o que acrescentar ao token. */
function permissionHint(message: string) {
  return /#10\b|#200\b|permission/i.test(message) ? 'o token precisa de instagram_basic e instagram_manage_insights: adicione no app e gere o token de novo' : message
}

/** Sincroniza Meta Ads, Instagram/Facebook, TikTok e Search Console (só leitura), de tempos em tempos e sob pedido. */
@Injectable()
export class MarketingSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketingSyncService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private readonly competitorsBusy = new Set<string>()
  /** Intervalo entre chamadas às APIs (respeita os limites das plataformas); zerado nos testes. */
  gapMs = 300
  fetcher: typeof fetch = (...a) => fetch(...a)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  states(tenantId: string) {
    return this.settings.get<SyncStates>(tenantId, SYNC_KEY, {})
  }

  private async setState(tenantId: string, key: IntegrationKey, patch: SyncState) {
    const all = await this.states(tenantId)
    await this.settings.set(tenantId, SYNC_KEY, { ...all, [key]: { ...(all[key] ?? {}), ...patch } })
  }

  /** A cada 30 minutos: roda cada integração ligada quando passou o intervalo dela. Uma de cada vez. */
  async tick(now = Date.now()) {
    if (this.busy) return
    this.busy = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: INTEGRATIONS_KEY }, select: { tenantId: true, value: true } })
      for (const row of rows) {
        const c = { ...DEFAULT_INTEGRATIONS, ...((row.value as Partial<IntegrationsConfig> | null) ?? {}) }
        const st = await this.states(row.tenantId)
        for (const key of Object.keys(HOURS) as IntegrationKey[]) {
          if (!c[key].enabled) continue
          const last = st[key]?.lastRunAt ? Date.parse(st[key]!.lastRunAt!) : 0
          if (now - last < HOURS[key] * 3_600_000) continue
          await this.run(row.tenantId, key, c)
        }
      }
    } catch (err) {
      this.logger.error(`Sincronização do marketing: ${(err as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  /** "Sincronizar agora" em Configurações. */
  async syncNow(user: AuthUser, key: IntegrationKey) {
    const c = { ...DEFAULT_INTEGRATIONS, ...(await this.settings.get<IntegrationsConfig>(user.tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)) }
    if (!c[key].enabled) throw new BadRequestException('Ligue e salve a integração antes de sincronizar.')
    const st = (await this.states(user.tenantId))[key]
    if (st?.running && st.lastRunAt && Date.now() - Date.parse(st.lastRunAt) < 30 * 60_000) throw new BadRequestException('A sincronização já está rodando. Aguarde alguns minutos.')
    void this.run(user.tenantId, key, c)
    return { ok: true, message: 'Sincronização iniciada. Os dados aparecem em alguns minutos.' }
  }

  /**
   * Concorrentes: busca os dados públicos agora (ao salvar a lista ou pelo botão), sem esperar a próxima
   * sincronização da Meta orgânica. Devolve o motivo quando não dá para buscar.
   */
  async syncCompetitorsNow(tenantId: string): Promise<{ ok: boolean; message: string }> {
    const c = { ...DEFAULT_INTEGRATIONS, ...(await this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)) }
    const official = c.metaOrganic.instagramId
    if (!c.metaOrganic.enabled || !official || !c.metaAds.tokenEnc) return { ok: false, message: 'Conecte o Instagram oficial em Configurações › Marketing (Meta orgânico) para buscar os concorrentes.' }
    if (this.competitorsBusy.has(tenantId)) return { ok: true, message: 'A busca já está rodando. Os dados aparecem em instantes.' }
    this.competitorsBusy.add(tenantId)
    const auth = { headers: { Authorization: `Bearer ${decrypt(c.metaAds.tokenEnc)}` } }
    const accounts = cleanIgAccounts((await this.settings.get<{ list?: unknown }>(tenantId, IG_ACCOUNTS_KEY, {})).list, official)
    void this.syncPublicProfiles(tenantId, official, auth, accounts.filter((a) => !a.id).map((a) => a.username))
      .catch((err: unknown) => this.logger.warn(`Concorrentes: ${(err as Error).message}`))
      .finally(() => this.competitorsBusy.delete(tenantId))
    return { ok: true, message: 'Buscando os dados dos concorrentes. Aparecem em instantes.' }
  }

  async run(tenantId: string, key: IntegrationKey, c: IntegrationsConfig) {
    const st = (await this.states(tenantId))[key] ?? {}
    await this.setState(tenantId, key, { lastRunAt: new Date().toISOString(), running: true })
    try {
      const r =
        key === 'metaAds' ? await this.syncMetaAds(tenantId, c, st) : key === 'metaOrganic' ? await this.syncMetaOrganic(tenantId, c) : key === 'tiktok' ? await this.syncTikTok(tenantId, c, st) : await this.syncSearchConsole(tenantId, c, st)
      const warning = 'warning' in r ? (r.warning ?? null) : null
      await this.setState(tenantId, key, { running: false, lastOkAt: new Date().toISOString(), lastError: warning ? warning.slice(0, 300) : null, rows: r.rows, ...(r.backfill ?? {}) })
      return r
    } catch (err) {
      const message = ((err as Error).message || 'falha').slice(0, 300)
      this.logger.warn(`Marketing (${key}): ${message}`)
      await this.setState(tenantId, key, { running: false, lastError: message })
      return { rows: 0, error: message }
    }
  }

  private async getJson(url: string, init: RequestInit = {}, onError: (status: number, body: unknown) => string = (s) => `Erro ${s}`) {
    await sleep(this.gapMs)
    const res = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(30_000), redirect: 'error' })
    const body = (await res.json().catch(() => null)) as unknown
    if (!res.ok) throw new Error(onError(res.status, body))
    return body as Record<string, unknown>
  }

  /** Lista com paginação da Graph API (segue o "next" até 40 páginas). */
  private async graphAll(url: string, token: string) {
    const out: Record<string, unknown>[] = []
    let next: string | null = url
    for (let page = 0; next && page < 40; page++) {
      const body = await this.getJson(next, { headers: { Authorization: `Bearer ${token}` } }, metaError)
      out.push(...((body.data as Record<string, unknown>[] | undefined) ?? []))
      const n = (body.paging as { next?: string } | undefined)?.next
      next = n && n.startsWith(GRAPH.replace(/\/v[\d.]+$/, '')) ? n : null
    }
    return out
  }

  // ---------- Meta Ads ----------

  private async syncMetaAds(tenantId: string, c: IntegrationsConfig, st: SyncState) {
    const token = decrypt(c.metaAds.tokenEnc!)
    const until = today()
    // 1ª vez: últimos 90 dias (em 3 partes de 30); depois: os últimos 7 dias (a Meta ainda ajusta a atribuição).
    const ranges: { since: string; until: string }[] = []
    if (!st.backfillDone) for (let i = 0; i < 3; i++) ranges.push({ since: addDays(until, -(i + 1) * 30 + 1), until: addDays(until, -i * 30) })
    else ranges.push({ since: addDays(until, -7), until })
    let rows = 0
    const fields = 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,objective,spend,impressions,reach,clicks,inline_link_clicks,actions'
    for (const act of c.metaAds.adAccountIds) {
      for (const r of ranges) {
        const tr = encodeURIComponent(JSON.stringify(r))
        for (const level of ['campaign', 'adset', 'ad'] as const) {
          const data = await this.graphAll(`${GRAPH}/${act}/insights?level=${level}&time_increment=1&time_range=${tr}&fields=${fields}&limit=500`, token)
          rows += await this.storeAdDays(tenantId, parseMetaInsights(data, level))
        }
        for (const [dimension, keys] of [['placement', ['publisher_platform', 'platform_position']], ['device', ['device_platform']], ['region', ['region']], ['age_gender', ['age', 'gender']]] as const) {
          try {
            const data = await this.graphAll(`${GRAPH}/${act}/insights?level=campaign&time_increment=1&time_range=${tr}&breakdowns=${keys.join(',')}&fields=campaign_id,spend,impressions,clicks,inline_link_clicks,actions&limit=500`, token)
            rows += await this.storeBreakdowns(tenantId, parseMetaBreakdown(data, dimension, [...keys]))
          } catch (err) {
            this.logger.warn(`Meta (${dimension}): ${(err as Error).message}`)
          }
        }
      }
      // Criativos dos anúncios (título, texto, chamada, imagem), para comparar.
      try {
        const ads = await this.graphAll(`${GRAPH}/${act}/ads?fields=id,creative{title,body,image_url,thumbnail_url,object_type,call_to_action_type}&limit=200`, token)
        for (const ad of ads) {
          const id = String(ad.id ?? '')
          if (!/^\d{1,30}$/.test(id)) continue
          await this.prisma.mktAdDay.updateMany({ where: { tenantId, platform: 'meta', level: 'ad', entityId: id }, data: { creative: parseMetaCreative(ad) } })
        }
      } catch (err) {
        this.logger.warn(`Meta (criativos): ${(err as Error).message}`)
      }
    }
    return { rows, backfill: { backfillDone: true } }
  }

  private async storeAdDays(tenantId: string, rows: AdDayRow[]) {
    if (!rows.length) return 0
    const col = <K extends keyof AdDayRow>(k: K) => rows.map((r) => (r[k] === null || r[k] === undefined ? '' : String(r[k])))
    await this.prisma.$executeRaw`
      INSERT INTO mkt_ad_days (id, "tenantId", platform, level, "entityId", name, "campaignId", "campaignName", "parentId", objective, date, spend, impressions, reach, clicks, leads, conversations, conversions, "videoViews", "updatedAt")
      SELECT gen_random_uuid(), ${tenantId}::uuid, x.p, x.lv, x.e, x.n, x.c, x.cn, nullif(x.pa, ''), nullif(x.o, ''), x.d::date, x.s::numeric, x.im::int, nullif(x.re, '')::int, x.cl::int, x.le::int, x.co::int, x.cv::numeric, nullif(x.vv, '')::int, now()
      FROM unnest(${col('platform')}::text[], ${col('level')}::text[], ${col('entityId')}::text[], ${col('name')}::text[], ${col('campaignId')}::text[], ${col('campaignName')}::text[], ${col('parentId')}::text[],
        ${col('objective')}::text[], ${col('date')}::text[], ${col('spend')}::text[], ${col('impressions')}::text[], ${col('reach')}::text[], ${col('clicks')}::text[], ${col('leads')}::text[],
        ${col('conversations')}::text[], ${col('conversions')}::text[], ${col('videoViews')}::text[])
        AS x(p, lv, e, n, c, cn, pa, o, d, s, im, re, cl, le, co, cv, vv)
      ON CONFLICT ("tenantId", platform, level, "entityId", date) DO UPDATE SET name = EXCLUDED.name, "campaignId" = EXCLUDED."campaignId", "campaignName" = EXCLUDED."campaignName",
        "parentId" = EXCLUDED."parentId", objective = EXCLUDED.objective, spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, reach = EXCLUDED.reach, clicks = EXCLUDED.clicks,
        leads = EXCLUDED.leads, conversations = EXCLUDED.conversations, conversions = EXCLUDED.conversions, "videoViews" = EXCLUDED."videoViews", "updatedAt" = now()`
    return rows.length
  }

  private async storeBreakdowns(tenantId: string, list: BreakdownDayRow[]) {
    const rows = [...new Map(list.map((r) => [`${r.platform}|${r.date}|${r.campaignId}|${r.dimension}|${r.key}`, r])).values()]
    if (!rows.length) return 0
    const col = <K extends keyof BreakdownDayRow>(k: K) => rows.map((r) => String(r[k]))
    await this.prisma.$executeRaw`
      INSERT INTO mkt_ad_breakdown_days (id, "tenantId", platform, date, "campaignId", dimension, key, spend, impressions, clicks, leads, "updatedAt")
      SELECT gen_random_uuid(), ${tenantId}::uuid, x.p, x.d::date, x.c, x.dim, x.k, x.s::numeric, x.im::int, x.cl::int, x.le::int, now()
      FROM unnest(${col('platform')}::text[], ${col('date')}::text[], ${col('campaignId')}::text[], ${col('dimension')}::text[], ${col('key')}::text[], ${col('spend')}::text[], ${col('impressions')}::text[], ${col('clicks')}::text[], ${col('leads')}::text[])
        AS x(p, d, c, dim, k, s, im, cl, le)
      ON CONFLICT ("tenantId", platform, date, "campaignId", dimension, key) DO UPDATE SET spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, leads = EXCLUDED.leads, "updatedAt" = now()`
    return rows.length
  }

  // ---------- Instagram e Facebook orgânicos ----------

  private async syncMetaOrganic(tenantId: string, c: IntegrationsConfig) {
    const token = decrypt(c.metaAds.tokenEnc!)
    const auth = { headers: { Authorization: `Bearer ${token}` } }
    const until = Math.floor(Date.now() / 1000)
    const since = until - 28 * 86_400
    const day = today()
    let rows = 0
    const posts: SocialPostRow[] = []
    const errors: string[] = []
    // Perfis do Instagram: o oficial (da integração) e os outros conectados ao Gerenciador de Negócios da empresa.
    const official = c.metaOrganic.instagramId
    const accounts = cleanIgAccounts((await this.settings.get<{ list?: unknown }>(tenantId, IG_ACCOUNTS_KEY, {})).list, official)
    const connected = [...new Set([official, ...accounts.map((a) => a.id)].filter(Boolean))]
    for (const ig of connected) {
      const label = ig === official ? 'oficial' : (accounts.find((a) => a.id === ig)?.label ?? ig)
      try {
        const warnings: string[] = []
        rows += await this.syncIgAccount(tenantId, ig, token, auth, day, since, until, posts, warnings)
        if (warnings.length) errors.push(`Instagram ${label}: ${warnings.join('; ')}`)
      } catch (err) {
        errors.push(`Instagram ${label}: ${permissionHint((err as Error).message)}`)
      }
    }
    // Concorrentes e perfis só públicos (vendedores fora do Gerenciador): lidos pela conta oficial.
    if (official) {
      try {
        await this.syncPublicProfiles(tenantId, official, auth, accounts.filter((a) => !a.id).map((a) => a.username))
      } catch (err) {
        errors.push(`Perfis públicos: ${(err as Error).message}`)
      }
    }
    const page = c.metaOrganic.pageId
    if (page) {
      try {
        const info = await this.getJson(`${GRAPH}/${page}?fields=access_token,followers_count,fan_count`, auth, metaError)
        const pageToken = String(info.access_token ?? '') || token
        const pAuth = { headers: { Authorization: `Bearer ${pageToken}` } }
        const daily = new Map<string, Record<string, number>>()
        for (const metric of ['page_impressions_unique', 'page_views_total', 'page_post_engagements']) {
          try {
            const r = await this.getJson(`${GRAPH}/${page}/insights?metric=${metric}&period=day&since=${since}&until=${until}`, pAuth, metaError)
            for (const [d, v] of parseDailyInsights(r.data)) daily.set(d, { ...(daily.get(d) ?? {}), ...v })
          } catch {
            // idem: métrica indisponível.
          }
        }
        daily.set(day, { ...(daily.get(day) ?? {}), followers: Number(info.followers_count ?? info.fan_count ?? 0) })
        rows += await this.storeProfileDays(tenantId, 'facebook', page, daily, { reach: 'page_impressions_unique', profileViews: 'page_views_total' })
        // Publicações da própria página: published_posts pede só pages_read_engagement; posts pede também pages_read_user_content.
        const postFields = 'id,message,created_time,permalink_url,status_type,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)&limit=50'
        let list: Record<string, unknown>[] = []
        try {
          list = (await this.graphAll(`${GRAPH}/${page}/published_posts?fields=${postFields}`, pageToken)).slice(0, 100)
        } catch {
          try {
            list = (await this.graphAll(`${GRAPH}/${page}/posts?fields=${postFields}`, pageToken)).slice(0, 100)
          } catch (err) {
            errors.push(`Facebook: publicações da página não lidas (${/pages_read_user_content|#10\b/.test((err as Error).message) ? 'adicione a permissão pages_read_user_content no app e gere o token de novo' : (err as Error).message}). Seguidores da página foram atualizados.`)
          }
        }
        for (const p of list) {
          const row = parseFbPost(p)
          if (row) posts.push({ ...row, profileId: page })
        }
      } catch (err) {
        errors.push(`Facebook: ${(err as Error).message}`)
      }
    }
    for (const p of posts) {
      const data = { publishedAt: p.publishedAt, format: p.format, caption: p.caption, permalink: p.permalink, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, reach: p.reach, impressions: p.impressions, videoViews: p.videoViews, ...(p.extra ? { extra: p.extra } : {}), ...(p.profileId ? { profileId: p.profileId } : {}) }
      await this.prisma.mktSocialPost.upsert({ where: { tenantId_network_postId: { tenantId, network: p.network, postId: p.postId } }, create: { tenantId, network: p.network, postId: p.postId, ...data }, update: data })
    }
    rows += posts.length
    if (errors.length && !rows) throw new Error(errors.join(' · '))
    // Parte sincronizou e parte não (ex.: o perfil de um vendedor saiu do Gerenciador): avisa sem perder o resto.
    return { rows, backfill: undefined as SyncState | undefined, warning: errors.length ? `Parte não sincronizou: ${errors.join(' · ')}` : null }
  }

  /** Um perfil do Instagram com acesso completo: dias, publicações, stories e público. */
  private async syncIgAccount(tenantId: string, ig: string, token: string, auth: RequestInit, day: string, since: number, until: number, posts: SocialPostRow[], warnings: string[]) {
    let rows = 0
    const profile = await this.getJson(`${GRAPH}/${ig}?fields=followers_count,media_count`, auth, metaError)
    const daily = new Map<string, Record<string, number>>()
    const merge = (d: string, v: Record<string, number>) => daily.set(d, { ...(daily.get(d) ?? {}), ...v })
    for (const metric of ['reach', 'follower_count']) {
      try {
        const r = await this.getJson(`${GRAPH}/${ig}/insights?metric=${metric}&period=day&since=${since}&until=${until}`, auth, metaError)
        for (const [d, v] of parseDailyInsights(r.data)) merge(d, v)
      } catch {
        // Métrica que a conta ou a versão da API não oferece: fica "Não disponível" (follower_count pede 100+ seguidores).
      }
    }
    // Métricas de total do dia (a API só entrega como "total_value"): 28 dias na 1ª vez, depois os 3 últimos.
    const known = await this.prisma.mktSocialProfileDay.count({ where: { tenantId, network: 'instagram', profileId: ig, accountsEngaged: { not: null } } })
    for (let i = known ? 3 : 28; i >= 1; i--) {
      const d = addDays(day, -i)
      const s0 = Math.floor(Date.parse(`${d}T03:00:00Z`) / 1000)
      const range = `period=day&metric_type=total_value&since=${s0}&until=${s0 + 86_400}`
      for (const metrics of ['accounts_engaged,total_interactions,profile_links_taps,views,profile_views,website_clicks', 'accounts_engaged,total_interactions']) {
        try {
          merge(d, parseTotalValues((await this.getJson(`${GRAPH}/${ig}/insights?metric=${metrics}&${range}`, auth, metaError)).data))
          break
        } catch {
          // tenta a lista menor
        }
      }
      try {
        merge(d, parseTotalValues((await this.getJson(`${GRAPH}/${ig}/insights?metric=follows_and_unfollows&breakdown=follow_type&${range}`, auth, metaError)).data))
      } catch {
        // conta sem a métrica
      }
    }
    if (![...daily.values()].some((v) => v.reach !== undefined || v.accounts_engaged !== undefined)) warnings.push('alcance e interações não lidos (o token precisa de instagram_manage_insights)')
    merge(day, { followers: Number(profile.followers_count ?? 0) })
    rows += await this.storeProfileDays(tenantId, 'instagram', ig, daily, {
      reach: 'reach', profileViews: 'profile_views', websiteClicks: 'website_clicks', follows: 'follower', unfollows: 'non_follower', accountsEngaged: 'accounts_engaged', interactions: 'total_interactions', linkTaps: 'profile_links_taps', views: 'views',
    })
    // Novos seguidores do dia pela série follower_count, quando a quebra por tipo não vier.
    for (const [d, v] of daily) if (v.follower === undefined && v.follower_count !== undefined) await this.prisma.mktSocialProfileDay.updateMany({ where: { tenantId, network: 'instagram', profileId: ig, date: new Date(`${d}T00:00:00Z`) }, data: { follows: Math.round(v.follower_count) } })

    // Sem a permissão de publicações, o resto (seguidores, público) é gravado assim mesmo e o aviso diz o que falta.
    let media: Record<string, unknown>[] = []
    try {
      media = (await this.graphAll(`${GRAPH}/${ig}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,media_url,thumbnail_url&limit=50`, token)).slice(0, 100)
    } catch (err) {
      warnings.push(`publicações não lidas (${permissionHint((err as Error).message)})`)
    }
    for (const m of media) {
      if (Date.parse(String(m.timestamp ?? '')) < Date.now() - 120 * 86_400_000) continue
      const reels = m.media_product_type === 'REELS'
      let insights: Record<string, number> = {}
      for (const metrics of [reels ? 'reach,saved,shares,views,total_interactions,ig_reels_avg_watch_time' : 'reach,saved,shares,views,total_interactions', 'reach,saved,shares,views', 'reach,saved']) {
        try {
          insights = parsePostInsights((await this.getJson(`${GRAPH}/${m.id}/insights?metric=${metrics}`, auth, metaError)).data)
          break
        } catch {
          // tenta a lista menor (publicações antigas não têm "views").
        }
      }
      const p = parseIgMedia(m, insights)
      if (p) posts.push({ ...p, profileId: ig })
    }
    // Stories ficam 24 h na API: a sincronização a cada 6 h guarda cada um antes de sumir.
    try {
      const stories = await this.graphAll(`${GRAPH}/${ig}/stories?fields=id,caption,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url&limit=50`, token)
      for (const st0 of stories) {
        let insights: Record<string, number> = {}
        for (const metrics of ['reach,replies,shares,views,total_interactions', 'reach,replies']) {
          try {
            insights = parsePostInsights((await this.getJson(`${GRAPH}/${st0.id}/insights?metric=${metrics}`, auth, metaError)).data)
            break
          } catch {
            // idem
          }
        }
        try {
          insights = { ...insights, ...parseTotalValues((await this.getJson(`${GRAPH}/${st0.id}/insights?metric=navigation&breakdown=story_navigation_action_type`, auth, metaError)).data) }
        } catch {
          // sem navegação
        }
        const p = parseIgMedia({ ...st0, media_product_type: 'STORY' }, insights)
        if (p) posts.push({ ...p, profileId: ig })
      }
    } catch {
      // conta sem permissão para stories
    }
    await this.syncIgAudience(tenantId, ig, auth)
    return rows
  }

  private async storeProfileDays(tenantId: string, network: string, profileId: string, daily: Map<string, Record<string, number>>, map: Partial<Record<ProfileField, string>>) {
    let n = 0
    for (const [date, v] of daily) {
      const pick = (k?: string) => (k && v[k] !== undefined ? Math.round(v[k]!) : undefined)
      const data: Partial<Record<ProfileField | 'followers', number>> = { followers: pick('followers') }
      for (const [field, key] of Object.entries(map) as [ProfileField, string][]) data[field] = pick(key)
      const clean = Object.fromEntries(Object.entries(data).filter(([, x]) => x !== undefined))
      await this.prisma.mktSocialProfileDay.upsert({ where: { tenantId_network_profileId_date: { tenantId, network, profileId, date: new Date(`${date}T00:00:00Z`) } }, create: { tenantId, network, profileId, date: new Date(`${date}T00:00:00Z`), ...clean }, update: clean })
      n++
    }
    return n
  }

  /** Público do Instagram: horas em que os seguidores ficam online e cidade, idade, gênero e país (só totais). */
  private async syncIgAudience(tenantId: string, ig: string, auth: RequestInit) {
    const out: IgAudience = { updatedAt: new Date().toISOString(), online: null, city: [], age: [], gender: [], country: [], error: null }
    const errors: string[] = []
    try {
      out.online = parseOnlineFollowers((await this.getJson(`${GRAPH}/${ig}/insights?metric=online_followers&period=lifetime`, auth, metaError)).data)
    } catch (err) {
      // A Meta não oferece em toda conta/versão: a tela usa o desempenho das publicações.
      errors.push(`horários online: ${(err as Error).message}`)
    }
    // A Meta já mudou o parâmetro de período desta métrica entre versões: tenta as formas aceitas até uma responder.
    for (const b of ['city', 'age', 'gender', 'country'] as const) {
      let last = ''
      for (const extra of ['', '&timeframe=last_90_days', '&timeframe=last_30_days', '&timeframe=this_month']) {
        try {
          const list = parseDemographics((await this.getJson(`${GRAPH}/${ig}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${b}${extra}`, auth, metaError)).data)
          if (list.length) {
            out[b] = list
            last = ''
            break
          }
          last = 'a Meta respondeu sem dados'
        } catch (err) {
          last = (err as Error).message
        }
      }
      if (last) errors.push(`${b}: ${last}`)
    }
    out.error = errors.length ? errors.join(' · ').slice(0, 600) : null
    const prev = await this.settings.get<Partial<IgAudience>>(tenantId, audienceKey(ig), {})
    // Não apaga o que já tinha se a Meta não respondeu desta vez.
    await this.settings.set(tenantId, audienceKey(ig), {
      ...out,
      online: out.online ?? prev.online ?? null,
      city: out.city.length ? out.city : (prev.city ?? []),
      age: out.age.length ? out.age : (prev.age ?? []),
      gender: out.gender.length ? out.gender : (prev.gender ?? []),
      country: out.country.length ? out.country : (prev.country ?? []),
    })
  }

  /** Concorrentes e perfis só públicos: perfil e últimas publicações (Business Discovery). Só contas comerciais ou de criador. */
  private async syncPublicProfiles(tenantId: string, ig: string, auth: RequestInit, extra: string[]) {
    const list = [...cleanCompetitors((await this.settings.get<{ list?: unknown }>(tenantId, COMPETITORS_KEY, {})).list), ...extra.map((username) => ({ username, label: '' }))].filter((c, i, all) => all.findIndex((x) => x.username === c.username) === i)
    const day = today()
    const status: Record<string, { at: string; error: string | null }> = {}
    for (const comp of list) {
      try {
        const fields = `business_discovery.username(${comp.username}){username,name,followers_count,media_count,media.limit(50){id,caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink}}`
        const c = parseCompetitor(await this.getJson(`${GRAPH}/${ig}?fields=${encodeURIComponent(fields)}`, auth, metaError))
        if (!c) throw new Error('Perfil não encontrado.')
        await this.prisma.mktCompetitorDay.upsert({
          where: { tenantId_username_date: { tenantId, username: c.username, date: new Date(`${day}T00:00:00Z`) } },
          create: { tenantId, username: c.username, date: new Date(`${day}T00:00:00Z`), name: c.name, followers: c.followers, mediaCount: c.mediaCount },
          update: { name: c.name, followers: c.followers, mediaCount: c.mediaCount },
        })
        for (const p of c.posts) {
          const data = { publishedAt: p.publishedAt, format: p.format, caption: p.caption, permalink: p.permalink, likes: p.likes, comments: p.comments }
          await this.prisma.mktCompetitorPost.upsert({ where: { tenantId_username_postId: { tenantId, username: c.username, postId: p.postId } }, create: { tenantId, username: c.username, postId: p.postId, ...data }, update: data })
        }
        status[comp.username] = { at: new Date().toISOString(), error: null }
      } catch (err) {
        const msg = (err as Error).message
        status[comp.username] = { at: new Date().toISOString(), error: /code.?110|not found|não encontrado|cannot be found|invalid user/i.test(msg) ? 'Perfil não encontrado ou não é conta comercial/criador (a Meta só mostra dados públicos dessas contas).' : msg.slice(0, 200) }
      }
    }
    await this.settings.set(tenantId, COMPETITORS_STATUS_KEY, status)
  }

  // ---------- TikTok ----------

  private async syncTikTok(tenantId: string, c: IntegrationsConfig, st: SyncState) {
    const token = decrypt(c.tiktok.tokenEnc!)
    const end = today()
    const ranges: { start: string; end: string }[] = []
    // O relatório diário do TikTok aceita até 30 dias por pedido.
    if (!st.backfillDone) for (let i = 0; i < 3; i++) ranges.push({ start: addDays(end, -(i + 1) * 30 + 1), end: addDays(end, -i * 30) })
    else ranges.push({ start: addDays(end, -7), end })
    let rows = 0
    const levels = [
      { level: 'campaign' as const, data: 'AUCTION_CAMPAIGN', dim: 'campaign_id', attrs: ['campaign_name', 'objective_type'] },
      { level: 'adset' as const, data: 'AUCTION_ADGROUP', dim: 'adgroup_id', attrs: ['adgroup_name', 'campaign_id', 'campaign_name'] },
      { level: 'ad' as const, data: 'AUCTION_AD', dim: 'ad_id', attrs: ['ad_name', 'adgroup_id', 'campaign_id', 'campaign_name'] },
    ]
    for (const adv of c.tiktok.advertiserIds) {
      for (const r of ranges) {
        for (const l of levels) {
          for (let page = 1; page <= 20; page++) {
            const q = new URLSearchParams({
              advertiser_id: adv,
              report_type: 'BASIC',
              data_level: l.data,
              dimensions: JSON.stringify([l.dim, 'stat_time_day']),
              metrics: JSON.stringify(['spend', 'impressions', 'reach', 'clicks', 'conversion', 'video_play_actions', ...l.attrs]),
              start_date: r.start,
              end_date: r.end,
              page: String(page),
              page_size: '1000',
            })
            const body = (await this.getJson(`${TIKTOK_API}/report/integrated/get/?${q}`, { headers: { 'Access-Token': token } })) as { code?: number; message?: string; data?: { page_info?: { total_page?: number } } }
            if (body.code !== 0) throw new Error(`O TikTok recusou: ${body.message ?? body.code}`)
            rows += await this.storeAdDays(tenantId, parseTikTokReport(body.data, l.level))
            if ((body.data?.page_info?.total_page ?? 1) <= page) break
          }
        }
      }
    }
    return { rows, backfill: { backfillDone: true } }
  }

  // ---------- Search Console ----------

  private async scToken(tenantId: string) {
    const ga = await this.settings.get<Ga4Settings>(tenantId, 'ga4', DEFAULT_GA4)
    if (!ga.privateKeyEnc || !ga.clientEmail) throw new Error('Envie a conta de serviço em Configurações › Google Analytics.')
    const body = await this.getJson(GA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(ga.clientEmail, decrypt(ga.privateKeyEnc), Date.now(), SC_SCOPE) }),
    }, () => 'O Google recusou a conta de serviço.')
    return String(body.access_token)
  }

  private async syncSearchConsole(tenantId: string, c: IntegrationsConfig, st: SyncState) {
    const token = await this.scToken(tenantId)
    const site = encodeURIComponent(c.searchConsole.siteUrl)
    // O Search Console tem atraso de 2 a 3 dias: pede os 4 dias recentes e, aos poucos, os últimos 90.
    const plan = daysToSync(today(), st.backfillDone ? null : (st.backfillFrom ?? null), BACKFILL_DAYS, 4, st.backfillDone ? 0 : 15)
    let rows = 0
    for (const date of plan.days) {
      const all: SeoRow[] = []
      for (const [kind, dims, limit] of [['total', [], 1], ['query', ['query'], 500], ['page', ['page'], 500]] as const) {
        const body = await this.getJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ startDate: date, endDate: date, dimensions: dims, rowLimit: limit }),
        }, (s) => (s === 403 ? 'Sem acesso à propriedade do Search Console: adicione a conta de serviço como usuário.' : `O Search Console recusou (${s}).`))
        all.push(...parseSearchAnalytics(body, date, kind))
      }
      // Troca o dia inteiro: consultas que saíram do topo não ficam com números antigos.
      await this.prisma.$transaction([
        this.prisma.mktSeoDay.deleteMany({ where: { tenantId, date: new Date(`${date}T00:00:00Z`) } }),
        this.prisma.mktSeoDay.createMany({ data: all.map((r) => ({ tenantId, date: new Date(`${r.date}T00:00:00Z`), kind: r.kind, key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position })), skipDuplicates: true }),
      ])
      rows += all.length
    }
    return { rows, backfill: { backfillFrom: plan.nextBackfill, backfillDone: st.backfillDone || plan.done } }
  }
}
