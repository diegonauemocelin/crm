import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { CONFIG_KEY, DEFAULT_CONFIG, DEFAULT_INTEGRATIONS, GRAPH, INTEGRATIONS_KEY, type IntegrationsConfig, type MarketingConfig } from './config'
import {
  adLibraryUrl,
  cleanCompetitors,
  cleanUsername,
  COMPETITORS_KEY,
  COMPETITORS_STATUS_KEY,
  formLeads,
  accountKey,
  audienceKey,
  MAX_IG_ACCOUNTS,
  cleanIgAccounts,
  IG_ACCOUNTS_KEY,
  type IgAudience,
  instagramPaid,
  MAX_COMPETITORS,
  onlinePeaks,
  PAID_MEDIUM,
  postTimes,
  profileStats,
  recommendTimes,
} from './instagram'
import { periods, pct } from './metricas'
import { byFormat, rankPosts } from './plataformas'
import { metaError } from './sync'
import { SYNC_KEY, type SyncStates } from './sync.service'

const day = (d: Date) => d.toISOString().slice(0, 10)

type ProfileDay = Awaited<ReturnType<PrismaService['mktSocialProfileDay']['findMany']>>[number]
/** Soma as contas dia a dia (cada coluna fica nula só se nenhuma conta informou). */
function sumDays(rows: ProfileDay[]) {
  const map = new Map<string, ProfileDay>()
  for (const r of rows) {
    const k = day(r.date)
    const cur = map.get(k)
    if (!cur) {
      map.set(k, { ...r })
      continue
    }
    for (const f of [...SUMS, 'followers', 'impressions'] as const) {
      const a = cur[f]
      const b = r[f]
      cur[f] = a === null && b === null ? null : (a ?? 0) + (b ?? 0)
    }
  }
  return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
}
const r2 = (n: number) => Math.round(n * 100) / 100
const n = (v: bigint | number | null | undefined) => Number(v ?? 0)
type ProfileSum = 'reach' | 'views' | 'accountsEngaged' | 'interactions' | 'profileViews' | 'websiteClicks' | 'linkTaps' | 'follows' | 'unfollows'
const SUMS: ProfileSum[] = ['reach', 'views', 'accountsEngaged', 'interactions', 'profileViews', 'websiteClicks', 'linkTaps', 'follows', 'unfollows']

/**
 * Tela Instagram do Marketing Inteligente: orgânico, stories, público, melhores horários, tráfego pago, tráfego do site,
 * leads de formulário e concorrentes. Só leitura das plataformas; seguidores e público nunca viram lead.
 */
@Injectable()
export class MarketingInstagramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private can(user: AuthUser, module: string) {
    return can(user.permissions, user.role.isSystem, module, 'view')
  }

  /** Perfis com acesso completo (oficial + conectados) e os só públicos. */
  private async accounts(tenantId: string) {
    const integ = { ...DEFAULT_INTEGRATIONS, ...(await this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)) }
    const official = integ.metaOrganic.instagramId
    const extra = cleanIgAccounts((await this.settings.get<{ list?: unknown }>(tenantId, IG_ACCOUNTS_KEY, {})).list, official)
    const all = [...(official ? [{ id: official, username: '', label: 'Usaparts (oficial)', owner: 'empresa' as const, sellerId: null, official: true }] : []), ...extra.map((a) => ({ ...a, official: false }))]
    return { integ, official, all, connected: all.filter((a) => a.id) }
  }

  async view(user: AuthUser, q: { from?: string; to?: string; conta?: string }) {
    const T = user.tenantId
    const p = periods(q.from, q.to)
    const range = { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) }
    const prevRange = { gte: new Date(`${p.prevFrom}T00:00:00Z`), lte: new Date(`${p.prevTo}T00:00:00Z`) }
    const { integ, official, connected } = await this.accounts(T)
    const selected = q.conta && connected.some((a) => a.id === q.conta) ? q.conta : 'todas'
    const ids = selected === 'todas' ? connected.map((a) => a.id) : [selected]
    const company = selected === 'todas' || selected === official
    // Publicações guardadas antes da 0.76 não têm conta: são da oficial.
    const postWhere = { tenantId: T, network: 'instagram', OR: [{ profileId: { in: ids } }, ...(ids.includes(official) ? [{ profileId: null }] : [])] }
    const since90 = new Date(Date.now() - 90 * 86_400_000)
    const [rawDays, prevDays, followersRows, posts, timedPosts, audience, states] = await Promise.all([
      this.prisma.mktSocialProfileDay.findMany({ where: { tenantId: T, network: 'instagram', profileId: { in: ids }, date: range }, orderBy: { date: 'asc' } }),
      this.prisma.mktSocialProfileDay.findMany({ where: { tenantId: T, network: 'instagram', profileId: { in: ids }, date: prevRange } }),
      this.prisma.mktSocialProfileDay.findMany({ where: { tenantId: T, network: 'instagram', profileId: { in: ids }, followers: { not: null } }, orderBy: { date: 'desc' }, take: 400 * Math.max(1, ids.length), select: { profileId: true, date: true, followers: true } }),
      this.prisma.mktSocialPost.findMany({ where: { ...postWhere, publishedAt: { gte: p.start, lt: p.end } }, orderBy: { publishedAt: 'desc' }, take: 1000 }),
      this.prisma.mktSocialPost.findMany({ where: { ...postWhere, publishedAt: { gte: since90 } }, select: { publishedAt: true, format: true, reach: true, likes: true, comments: true, shares: true, saves: true }, take: 3000 }),
      this.settings.get<Partial<IgAudience>>(T, audienceKey(selected === 'todas' ? official : selected), {}),
      this.settings.get<SyncStates>(T, SYNC_KEY, {}),
    ])
    // Visão geral: soma das contas por dia (o alcance somado pode contar a mesma pessoa em duas contas).
    const days = sumDays(rawDays)
    const lastByAccount = new Map<string, { date: Date; followers: number | null }[]>()
    for (const r of followersRows) lastByAccount.set(r.profileId, [...(lastByAccount.get(r.profileId) ?? []), r])
    const followersNow = lastByAccount.size ? [...lastByAccount.values()].reduce((s, l) => s + (l[0]?.followers ?? 0), 0) : null
    const followersAtStart = [...lastByAccount.values()].map((l) => [...l].reverse().find((d) => day(d.date) >= p.from)?.followers ?? null)
    const followersRow = followersNow !== null && followersAtStart.every((x) => x !== null) ? [{ followers: followersNow }, { followers: followersAtStart.reduce((s, x) => s + (x ?? 0), 0) }] : []

    // ---- Orgânico ----
    const sum = (list: typeof days, k: ProfileSum) => (list.some((d) => d[k] !== null) ? list.reduce((s, d) => s + (d[k] ?? 0), 0) : null)
    const kpis = Object.fromEntries(SUMS.map((k) => [k, { now: sum(days, k), before: sum(prevDays, k) }])) as Record<ProfileSum, { now: number | null; before: number | null }>
    const followersGrowth = followersRow.length === 2 && followersRow[0]!.followers !== followersRow[1]!.followers ? followersRow[0]!.followers - followersRow[1]!.followers : kpis.follows.now !== null ? kpis.follows.now - (kpis.unfollows.now ?? 0) : null
    const rate = (i: number | null, r: number | null) => (i !== null && r ? r2((i / r) * 100) : null)

    // ---- Conteúdo, stories e horários ----
    const feed = posts.filter((x) => x.format !== 'Story')
    const stories = posts.filter((x) => x.format === 'Story')
    const ranked = rankPosts(feed).map((x) => ({ ...x, extra: (x.extra ?? null) as Record<string, number> | null }))
    const reels = ranked.filter((x) => x.format === 'Reels' && x.extra?.avgWatchMs !== undefined)
    const ex = (x: (typeof stories)[number], k: string) => Number((x.extra as Record<string, number> | null)?.[k] ?? 0)
    const storyReach = stories.reduce((s, x) => s + (x.reach ?? 0), 0)
    const storyExits = stories.reduce((s, x) => s + ex(x, 'exits'), 0)
    const peaks = onlinePeaks(audience.online ?? null)
    const times = postTimes(timedPosts)

    const out = {
      period: { from: p.from, to: p.to, prevFrom: p.prevFrom, prevTo: p.prevTo, days: p.days },
      connected: integ.metaOrganic.enabled && !!official,
      selected,
      accounts: connected.map((a) => ({ id: a.id, label: a.label, owner: a.owner, official: a.official })),
      company,
      sync: states.metaOrganic ?? null,
      organic: {
        followers: followersNow,
        followersGrowth,
        kpis,
        engagementRate: { now: rate(kpis.interactions.now, kpis.reach.now), before: rate(kpis.interactions.before, kpis.reach.before) },
        series: days.map((d) => ({ day: day(d.date), label: `${day(d.date).slice(8, 10)}/${day(d.date).slice(5, 7)}`, reach: d.reach, views: d.views, interactions: d.interactions, follows: d.follows, profileViews: d.profileViews, followers: d.followers })),
      },
      content: {
        posts: ranked.slice(0, 100),
        byFormat: byFormat(ranked),
        postsPerWeek: r2((feed.length / Math.max(1, p.days)) * 7),
        reelsAvgWatchSec: reels.length ? r2(reels.reduce((s, x) => s + (x.extra?.avgWatchMs ?? 0), 0) / reels.length / 1000) : null,
      },
      stories: {
        count: stories.length,
        perDay: r2(stories.length / Math.max(1, p.days)),
        avgReach: stories.length && stories.some((x) => x.reach !== null) ? Math.round(storyReach / stories.length) : null,
        replies: stories.reduce((s, x) => s + ex(x, 'replies'), 0),
        exitRate: storyReach ? r2((storyExits / storyReach) * 100) : null,
        list: stories.slice(0, 60).map((x) => ({ postId: x.postId, thumb: typeof (x.extra as Record<string, unknown> | null)?.thumb === 'string' ? String((x.extra as Record<string, unknown>).thumb) : null, account: ids.length > 1 ? (connected.find((a) => a.id === (x.profileId ?? official))?.label ?? null) : null, publishedAt: x.publishedAt, permalink: x.permalink, reach: x.reach, views: x.impressions, replies: ex(x, 'replies'), tapsForward: ex(x, 'tapsForward'), tapsBack: ex(x, 'tapsBack'), exits: ex(x, 'exits') })),
      },
      times: { online: audience.online ?? null, peaks, cells: times.cells, best: times.best, recommendations: recommendTimes(peaks, times.best), basedOnPosts: timedPosts.filter((x) => x.format !== 'Story').length },
      audience: { of: selected === 'todas' ? 'oficial' : 'perfil', updatedAt: audience.updatedAt ?? null, error: audience.error ?? null, city: (audience.city ?? []).slice(0, 15), age: audience.age ?? [], gender: audience.gender ?? [], country: (audience.country ?? []).slice(0, 10) },
      // Anúncios, site e leads são da empresa: aparecem na visão geral e no perfil oficial.
      paid: company && this.can(user, 'mi_midia') ? await this.paid(T, range) : null,
      site: company ? await this.site(T, p) : null,
      leads: company && (this.can(user, 'mi_comercial') || this.can(user, 'mi_executivo')) ? await this.leads(T, p) : null,
    }
    return out
  }

  private async paid(tenantId: string, range: { gte: Date; lte: Date }) {
    const [rows, meta, daily] = await Promise.all([
      this.prisma.mktAdBreakdownDay.groupBy({ by: ['key'], where: { tenantId, platform: 'meta', dimension: 'placement', date: range }, _sum: { spend: true, impressions: true, clicks: true, leads: true } }),
      this.prisma.mktAdDay.aggregate({ where: { tenantId, platform: 'meta', level: 'campaign', date: range }, _sum: { spend: true } }),
      this.prisma.mktAdBreakdownDay.groupBy({ by: ['date'], where: { tenantId, platform: 'meta', dimension: 'placement', key: { startsWith: 'instagram' }, date: range }, _sum: { spend: true, clicks: true, leads: true }, orderBy: { date: 'asc' } }),
    ])
    const agg = instagramPaid(
      rows.map((r) => ({ key: r.key, spend: Number(r._sum.spend ?? 0), impressions: n(r._sum.impressions), clicks: n(r._sum.clicks), leads: n(r._sum.leads) })),
      Number(meta._sum.spend ?? 0),
    )
    return { ...agg, series: daily.map((d) => ({ day: day(d.date), label: `${day(d.date).slice(8, 10)}/${day(d.date).slice(5, 7)}`, spend: r2(Number(d._sum.spend ?? 0)), clicks: n(d._sum.clicks), leads: n(d._sum.leads) })) }
  }

  /** Visitas ao site vindas do Instagram (rastreamento do CRM): origem na 1ª página de cada visita. */
  private async site(tenantId: string, p: ReturnType<typeof periods>) {
    const where = `"tenantId" = $1::uuid AND "newSession" AND "occurredAt" >= $2 AND "occurredAt" < $3 AND (lower(touch->>'source') LIKE '%instagram%' OR lower(touch->>'source') = 'ig')`
    const [byMedium, perDay, pages, ident] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ meio: string | null; visitas: bigint; visitantes: bigint }[]>(`SELECT lower(touch->>'medium') AS meio, count(*) AS visitas, count(DISTINCT "visitorId") AS visitantes FROM site_pageviews WHERE ${where} GROUP BY 1`, tenantId, p.start, p.end),
      this.prisma.$queryRawUnsafe<{ dia: string; visitas: bigint }[]>(`SELECT to_char(("occurredAt" - interval '3 hours'), 'YYYY-MM-DD') AS dia, count(*) AS visitas FROM site_pageviews WHERE ${where} GROUP BY 1 ORDER BY 1`, tenantId, p.start, p.end),
      this.prisma.$queryRawUnsafe<{ pagina: string | null; visitas: bigint }[]>(`SELECT coalesce(path, '/') AS pagina, count(*) AS visitas FROM site_pageviews WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, tenantId, p.start, p.end),
      this.prisma.$queryRawUnsafe<{ visitantes: bigint }[]>(
        `SELECT count(DISTINCT v.id) AS visitantes FROM site_visitors v WHERE v."tenantId" = $1::uuid AND v."identifiedAt" >= $2 AND v."identifiedAt" < $3 AND (lower(v."lastTouch"->>'source') LIKE '%instagram%' OR lower(v."firstTouch"->>'source') LIKE '%instagram%')`,
        tenantId,
        p.start,
        p.end,
      ),
    ])
    const paidRows = byMedium.filter((r) => r.meio && PAID_MEDIUM.test(r.meio))
    const visits = byMedium.reduce((s, r) => s + n(r.visitas), 0)
    const paidVisits = paidRows.reduce((s, r) => s + n(r.visitas), 0)
    return {
      visits,
      visitors: byMedium.reduce((s, r) => s + n(r.visitantes), 0),
      paidVisits,
      organicVisits: visits - paidVisits,
      identified: n(ident[0]?.visitantes),
      series: perDay.map((r) => ({ day: r.dia, label: `${r.dia.slice(8, 10)}/${r.dia.slice(5, 7)}`, visits: n(r.visitas) })),
      pages: pages.map((r) => ({ path: r.pagina ?? '/', visits: n(r.visitas) })),
    }
  }

  /** Leads de formulário com origem no Instagram e o que viraram no Pré-Vendas. */
  private async leads(tenantId: string, p: ReturnType<typeof periods>) {
    const cfg = { ...DEFAULT_CONFIG, ...(await this.settings.get<MarketingConfig>(tenantId, CONFIG_KEY, DEFAULT_CONFIG)) }
    const conv = await this.prisma.$queryRawUnsafe<{ leadId: string; at: Date; meio: string | null; formulario: string | null; canal: string | null }[]>(
      `SELECT e."leadId", e."occurredAt" AS at, lower(e.data->'origem'->>'medium') AS meio, e.data->>'formulario' AS formulario, e.data->>'canal' AS canal
       FROM lead_events e
       WHERE e."tenantId" = $1::uuid AND e.type = 'conversao' AND e."occurredAt" >= $2 AND e."occurredAt" < $3
         AND (lower(e.data->'origem'->>'source') LIKE '%instagram%' OR lower(e.data->'origem'->>'source') = 'ig')
         AND (e.data ? 'formulario' OR e.data->>'canal' IN ('form', 'popup', 'landing'))`,
      tenantId,
      p.start,
      p.end,
    )
    const leadIds = [...new Set(conv.map((c) => c.leadId))]
    const records = leadIds.length
      ? await this.prisma.serviceRecord.findMany({ where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, leadId: { in: leadIds } }, select: { leadId: true, leadAt: true, forwarded: true, returnStatus: true, saleStatus: true, saleValue: true } })
      : []
    const formName = (c: (typeof conv)[number]) => (c.formulario ? 'Formulário de anúncio da Meta (Lead Ads)' : c.canal === 'popup' ? 'Pop-up do site' : c.canal === 'landing' ? 'Landing page' : 'Formulário do site')
    const r = formLeads(
      conv.map((c) => ({ leadId: c.leadId, at: c.at, medium: c.formulario ? (c.meio ?? 'cpc') : c.meio, form: formName(c) })),
      records.filter((x) => x.leadId).map((x) => ({ leadId: x.leadId!, leadAt: x.leadAt, forwarded: x.forwarded, returnStatus: x.returnStatus, saleStatus: x.saleStatus, saleValue: Number(x.saleValue ?? 0) })),
      cfg.qualified,
    )
    return { ...r, qualificationRate: pct(r.qualified, r.leads) }
  }

  // ---------- Perfis da empresa (oficial e vendedores) ----------

  async profiles(user: AuthUser, q: { from?: string; to?: string }) {
    const T = user.tenantId
    const p = periods(q.from, q.to)
    const range = { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) }
    const { integ, official, all } = await this.accounts(T)
    const ids = all.filter((a) => a.id).map((a) => a.id)
    const usernames = all.filter((a) => !a.id).map((a) => a.username)
    const [days, posts, pubDays, pubPosts, sellers, status] = await Promise.all([
      this.prisma.mktSocialProfileDay.findMany({ where: { tenantId: T, network: 'instagram', profileId: { in: ids } }, orderBy: { date: 'asc' } }),
      this.prisma.mktSocialPost.findMany({ where: { tenantId: T, network: 'instagram', publishedAt: { gte: p.start, lt: p.end }, OR: [{ profileId: { in: ids } }, ...(official ? [{ profileId: null }] : [])] }, select: { profileId: true, publishedAt: true, format: true, likes: true, comments: true, permalink: true, caption: true, reach: true } }),
      this.prisma.mktCompetitorDay.findMany({ where: { tenantId: T, username: { in: usernames } }, orderBy: { date: 'asc' } }),
      this.prisma.mktCompetitorPost.findMany({ where: { tenantId: T, username: { in: usernames }, publishedAt: { gte: p.start, lt: p.end } } }),
      this.prisma.seller.findMany({ where: { tenantId: T }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.settings.get<Record<string, { at: string; error: string | null }>>(T, COMPETITORS_STATUS_KEY, {}),
    ])
    const sellerName = new Map(sellers.map((x) => [x.id, x.name]))
    const rows = all.map((a) => {
      const key = accountKey(a)
      if (a.id) {
        const mine = posts.filter((x) => x.profileId === a.id || (a.official && x.profileId === null))
        const d = days.filter((x) => x.profileId === a.id)
        const inP = d.filter((x) => x.date >= range.gte && x.date <= range.lte)
        const sumOf = (k: 'reach' | 'interactions' | 'follows' | 'unfollows') => (inP.some((x) => x[k] !== null) ? inP.reduce((t, x) => t + (x[k] ?? 0), 0) : null)
        const stats = profileStats({
          username: a.username || key,
          name: a.label,
          own: true,
          days: d.filter((x) => x.followers !== null).map((x) => ({ username: key, date: x.date, name: a.label, followers: x.followers ?? 0, mediaCount: 0 })),
          posts: mine.filter((x) => x.format !== 'Story').map((x) => ({ ...x, username: key })),
          notes: [],
          from: p.from,
          to: p.to,
          periodDays: p.days,
        })
        // Sem histórico de seguidores no período: novos seguidores menos os que deixaram de seguir.
        const follows = sumOf('follows')
        return {
          key,
          ...stats,
          followersGrowth: stats.followersGrowth ?? (follows !== null ? follows - (sumOf('unfollows') ?? 0) : null),
          label: a.label,
          owner: a.owner,
          official: a.official,
          seller: a.sellerId ? (sellerName.get(a.sellerId) ?? null) : null,
          access: 'completo' as const,
          reach: sumOf('reach'),
          interactions: sumOf('interactions'),
          stories: mine.filter((x) => x.format === 'Story').length,
          status: null,
        }
      }
      return {
        key,
        ...profileStats({ username: a.username, name: a.label, own: true, days: pubDays.filter((x) => x.username === a.username), posts: pubPosts.filter((x) => x.username === a.username), notes: [], from: p.from, to: p.to, periodDays: p.days }),
        label: a.label,
        owner: a.owner,
        official: false,
        seller: a.sellerId ? (sellerName.get(a.sellerId) ?? null) : null,
        access: 'publico' as const,
        reach: null,
        interactions: null,
        stories: null,
        status: status[a.username] ?? null,
      }
    })
    const sumN = (k: 'followers' | 'feedPosts' | 'reels') => rows.reduce((t, r) => t + (r[k] ?? 0), 0)
    return {
      period: { from: p.from, to: p.to, days: p.days },
      connected: integ.metaOrganic.enabled && !!official,
      officialId: official || null,
      list: all.filter((a) => !a.official).map((a) => ({ id: a.id, username: a.username, label: a.label, owner: a.owner, sellerId: a.sellerId })),
      max: MAX_IG_ACCOUNTS,
      sellers,
      totals: { profiles: rows.length, followers: sumN('followers'), feedPosts: sumN('feedPosts'), reels: sumN('reels') },
      profiles: rows,
    }
  }

  async saveAccounts(user: AuthUser, input: unknown, ctx: RequestCtx) {
    const raw = Array.isArray(input) ? (input as Record<string, unknown>[]) : []
    if (raw.length > MAX_IG_ACCOUNTS) throw new BadRequestException(`Até ${MAX_IG_ACCOUNTS} perfis.`)
    if (raw.some((x) => !/^\d{5,30}$/.test(String(x?.id ?? '').trim()) && !cleanUsername(x?.username))) throw new BadRequestException('Cada perfil precisa do @ (ex.: @vendedor.usaparts) ou do número da conta conectada.')
    const { official } = await this.accounts(user.tenantId)
    const sellers = new Set((await this.prisma.seller.findMany({ where: { tenantId: user.tenantId }, select: { id: true } })).map((x) => x.id))
    const list = cleanIgAccounts(raw, official).map((a) => ({ ...a, sellerId: a.sellerId && sellers.has(a.sellerId) ? a.sellerId : null }))
    await this.settings.set(user.tenantId, IG_ACCOUNTS_KEY, { list })
    await this.audit.byUser(user, ctx, 'marketing.perfis_instagram_salvos', 'settings', IG_ACCOUNTS_KEY, { perfis: list.map((a) => a.username || a.id) })
    return { list }
  }

  /**
   * Páginas do Facebook e o Instagram ligado a cada uma que o token da empresa alcança: as atribuídas ao usuário do
   * sistema (me/accounts) e as do Gerenciador de Negócios (páginas próprias e de clientes). Serve para achar os IDs.
   */
  async metaAssets(user: AuthUser, fetcher: typeof fetch = fetch) {
    const integ = { ...DEFAULT_INTEGRATIONS, ...(await this.settings.get<IntegrationsConfig>(user.tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)) }
    if (!integ.metaAds.tokenEnc) throw new BadRequestException('Cadastre e salve o token da Meta no cartão Meta Ads antes de buscar.')
    const token = decrypt(integ.metaAds.tokenEnc)
    type PageRow = { id?: string; name?: string; instagram_business_account?: { id?: string; username?: string } }
    const get = async <T>(path: string) => {
      const res = await fetcher(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' })
      const body = (await res.json().catch(() => null)) as T & { error?: unknown }
      if (!res.ok) throw new BadRequestException(metaError(res.status, body))
      return body
    }
    const fields = 'id,name,instagram_business_account{id,username}'
    const pages = new Map<string, { id: string; name: string; instagram: { id: string; username: string } | null }>()
    const add = (list: PageRow[] | undefined) => {
      for (const pg of list ?? []) {
        if (!pg.id || !/^\d{5,30}$/.test(pg.id) || pages.has(pg.id)) continue
        const ig = pg.instagram_business_account
        pages.set(pg.id, { id: pg.id, name: String(pg.name ?? '').slice(0, 120), instagram: ig?.id && /^\d{5,30}$/.test(ig.id) ? { id: ig.id, username: cleanUsername(ig.username) ?? '' } : null })
      }
    }
    let firstError: unknown = null
    try {
      add((await get<{ data?: PageRow[] }>(`me/accounts?fields=${encodeURIComponent(fields)}&limit=100`)).data)
    } catch (err) {
      firstError = err
    }
    // Páginas do Gerenciador que não foram atribuídas uma a uma ao usuário do sistema.
    try {
      const biz = (await get<{ data?: { id?: string }[] }>('me/businesses?fields=id,name&limit=25')).data ?? []
      for (const b of biz.filter((x) => x.id && /^\d{5,30}$/.test(x.id))) {
        for (const edge of ['owned_pages', 'client_pages']) {
          try {
            add((await get<{ data?: PageRow[] }>(`${b.id}/${edge}?fields=${encodeURIComponent(fields)}&limit=100`)).data)
          } catch {
            // o token pode não ter acesso a uma das listas
          }
        }
      }
    } catch (err) {
      firstError ??= err
    }
    if (!pages.size && firstError) throw firstError
    return { pages: [...pages.values()].sort((x, y) => x.name.localeCompare(y.name, 'pt-BR')) }
  }

  /** Contas do Instagram que o token da empresa alcança (para adicionar perfis com dados completos). */
  async discover(user: AuthUser, fetcher: typeof fetch = fetch) {
    const { pages } = await this.metaAssets(user, fetcher)
    return {
      accounts: pages.filter((p) => p.instagram).map((p) => ({ id: p.instagram!.id, username: p.instagram!.username, name: p.name })),
    }
  }

  // ---------- Concorrentes ----------

  private async competitorList(tenantId: string) {
    return cleanCompetitors((await this.settings.get<{ list?: unknown }>(tenantId, COMPETITORS_KEY, {})).list)
  }

  async competitors(user: AuthUser, q: { from?: string; to?: string }) {
    const T = user.tenantId
    const p = periods(q.from, q.to)
    const list = await this.competitorList(T)
    const integ = { ...DEFAULT_INTEGRATIONS, ...(await this.settings.get<IntegrationsConfig>(T, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)) }
    const ig = integ.metaOrganic.instagramId
    const names = list.map((c) => c.username)
    const [days, posts, notes, status, ownDays, ownPosts] = await Promise.all([
      this.prisma.mktCompetitorDay.findMany({ where: { tenantId: T, username: { in: names } }, orderBy: { date: 'asc' } }),
      this.prisma.mktCompetitorPost.findMany({ where: { tenantId: T, username: { in: names }, publishedAt: { gte: p.start, lt: p.end } } }),
      this.prisma.mktCompetitorNote.findMany({ where: { tenantId: T, username: { in: names }, deletedAt: null }, orderBy: { date: 'desc' }, take: 1000 }),
      this.settings.get<Record<string, { at: string; error: string | null }>>(T, COMPETITORS_STATUS_KEY, {}),
      ig ? this.prisma.mktSocialProfileDay.findMany({ where: { tenantId: T, network: 'instagram', profileId: ig, followers: { not: null } }, orderBy: { date: 'asc' }, select: { date: true, followers: true } }) : Promise.resolve([]),
      // Só a conta oficial (publicações antigas sem conta também são dela).
      ig ? this.prisma.mktSocialPost.findMany({ where: { tenantId: T, network: 'instagram', publishedAt: { gte: p.start, lt: p.end }, OR: [{ profileId: ig }, { profileId: null }] }, select: { publishedAt: true, format: true, likes: true, comments: true, permalink: true, caption: true } }) : Promise.resolve([]),
    ])
    const ownStories = ownPosts.filter((x) => x.format === 'Story').length
    const own = ig
      ? {
          ...profileStats({
            username: 'sua_conta',
            name: 'Sua conta',
            own: true,
            days: ownDays.map((d) => ({ username: 'sua_conta', date: d.date, name: 'Sua conta', followers: d.followers ?? 0, mediaCount: 0 })),
            posts: ownPosts.filter((x) => x.format !== 'Story').map((x) => ({ ...x, username: 'sua_conta' })),
            notes: [],
            from: p.from,
            to: p.to,
            periodDays: p.days,
          }),
          totalPosts: null,
          storiesCount: ownStories,
          adLibrary: null,
          status: null,
        }
      : null
    const rows = list.map((c) => ({
      ...profileStats({
        username: c.username,
        name: c.label || null,
        own: false,
        days: days.filter((d) => d.username === c.username),
        posts: posts.filter((x) => x.username === c.username),
        notes: notes.filter((x) => x.username === c.username),
        from: p.from,
        to: p.to,
        periodDays: p.days,
      }),
      storiesCount: null,
      adLibrary: adLibraryUrl(c),
      status: status[c.username] ?? null,
    }))
    return {
      period: { from: p.from, to: p.to, days: p.days },
      connected: integ.metaOrganic.enabled && !!ig,
      list,
      max: MAX_COMPETITORS,
      profiles: [...(own ? [own] : []), ...rows],
      notes: notes.slice(0, 200).map((x) => ({ id: x.id, username: x.username, date: day(x.date), storiesSeen: x.storiesSeen, adsActive: x.adsActive, note: x.note })),
      growth: list.map((c) => ({ username: c.username, series: days.filter((d) => d.username === c.username && day(d.date) >= p.from).map((d) => ({ day: day(d.date), followers: d.followers })) })),
    }
  }

  async saveCompetitors(user: AuthUser, input: unknown, ctx: RequestCtx) {
    const raw = Array.isArray(input) ? input : []
    const list = cleanCompetitors(raw)
    const invalid = raw.filter((x) => !cleanUsername((x as { username?: unknown })?.username))
    if (invalid.length) throw new BadRequestException('Nome de usuário do Instagram inválido. Use só o @ (ex.: @concorrente) ou o link do perfil.')
    if (raw.length > MAX_COMPETITORS) throw new BadRequestException(`Até ${MAX_COMPETITORS} concorrentes.`)
    await this.settings.set(user.tenantId, COMPETITORS_KEY, { list })
    await this.audit.byUser(user, ctx, 'marketing.concorrentes_salvos', 'settings', COMPETITORS_KEY, { concorrentes: list.map((c) => c.username) })
    return { list }
  }

  async addNote(user: AuthUser, input: { username?: unknown; date?: unknown; storiesSeen?: unknown; adsActive?: unknown; note?: unknown }) {
    const username = cleanUsername(input.username)
    const list = await this.competitorList(user.tenantId)
    if (!username || !list.some((c) => c.username === username)) throw new NotFoundException('Concorrente não cadastrado.')
    const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
    const stories = input.storiesSeen === null || input.storiesSeen === undefined || input.storiesSeen === '' ? null : Number(input.storiesSeen)
    if (stories !== null && (!Number.isInteger(stories) || stories < 0 || stories > 200)) throw new BadRequestException('Quantidade de stories inválida.')
    const adsActive = typeof input.adsActive === 'boolean' ? input.adsActive : null
    const note = String(input.note ?? '').trim().slice(0, 500) || null
    if (stories === null && adsActive === null && !note) throw new BadRequestException('Informe os stories vistos, o anúncio ativo ou uma observação.')
    const r = await this.prisma.mktCompetitorNote.create({ data: { tenantId: user.tenantId, username, date: new Date(`${date}T00:00:00Z`), storiesSeen: stories, adsActive, note, createdById: user.id } })
    return { id: r.id }
  }

  async removeNote(user: AuthUser, id: string) {
    const r = await this.prisma.mktCompetitorNote.updateMany({ where: { id, tenantId: user.tenantId, deletedAt: null }, data: { deletedAt: new Date() } })
    if (!r.count) throw new NotFoundException('Registro não encontrado.')
    return { ok: true }
  }
}

