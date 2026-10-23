import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import { decrypt, encrypt, safeEqual } from '../common/crypto'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import {
  ADGROUP_METRICS,
  type ApiAdGroup,
  type ApiCampaign,
  CAMPAIGN_METRICS,
  type DayRow,
  DEFAULT_ML,
  httpsThumb,
  MARKETPLACE,
  ML_API,
  ML_AUTH_URL,
  ML_CALLBACK_PATH,
  ML_CONFIG_KEY,
  ML_OAUTH_KEY,
  ML_SYNC_HOURS,
  ML_SYNC_KEY,
  type MlConfig,
  MlError,
  type MlSyncState,
  parseAdGroupDay,
  parseCampaignDays,
  parseDisplayDays,
  syncWindow,
  tokenError,
} from './mercadolivre'

const TICK_MS = 30 * 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface OAuthPending {
  state: string
  verifierEnc: string
  userId: string
  expiresAt: string
}

type StoredDay = DayRow & { entityId: string; campaignId: string }

/** Mercado Livre Ads: autorização (OAuth com PKCE), sincronização a cada 6 horas e sob pedido. Só leitura. */
@Injectable()
export class MercadoLivreService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MercadoLivreService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private readonly refreshing = new Map<string, Promise<string>>()
  /** Pausa entre chamadas aos grupos de anúncios (limite de requisições do Mercado Livre); zerada nos testes. */
  gapMs = 120
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

  redirectUri() {
    return `${env.appUrl}${ML_CALLBACK_PATH}`
  }

  async config(tenantId: string): Promise<MlConfig> {
    return { ...DEFAULT_ML, ...(await this.settings.get<Partial<MlConfig>>(tenantId, ML_CONFIG_KEY, {})) }
  }

  async patch(tenantId: string, patch: Partial<MlConfig>) {
    const next = { ...(await this.config(tenantId)), ...patch }
    await this.settings.set(tenantId, ML_CONFIG_KEY, next)
    return next
  }

  async syncState(tenantId: string): Promise<MlSyncState> {
    return this.settings.get<MlSyncState>(tenantId, ML_SYNC_KEY, {})
  }

  async setSyncState(tenantId: string, patch: MlSyncState) {
    await this.settings.set(tenantId, ML_SYNC_KEY, { ...(await this.syncState(tenantId)), ...patch })
  }

  /** Client ID e Client Secret do aplicativo do Mercado Livre (segredo criptografado; vazio mantém o atual). */
  async saveCredentials(tenantId: string, clientId: string, secret?: string) {
    const c = await this.config(tenantId)
    if (!/^\d{3,30}$/.test(clientId.trim())) throw new BadRequestException('O Client ID do Mercado Livre tem só números (ex.: 1234567890123456).')
    if (!secret && !c.clientSecretEnc) throw new BadRequestException('Informe o Client Secret do aplicativo do Mercado Livre.')
    return this.patch(tenantId, { clientId: clientId.trim(), ...(secret ? { clientSecretEnc: encrypt(secret.trim()) } : {}) })
  }

  // ---------- Autorização ----------

  async startAuthorization(user: AuthUser) {
    const c = await this.config(user.tenantId)
    if (!c.clientId || !c.clientSecretEnc) throw new BadRequestException('Cadastre o Client ID e o Client Secret do aplicativo do Mercado Livre antes de conectar.')
    const state = randomBytes(24).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    const pending: OAuthPending = { state, verifierEnc: encrypt(verifier), userId: user.id, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }
    await this.settings.set(user.tenantId, ML_OAUTH_KEY, pending)
    const url = new URL(ML_AUTH_URL)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: this.redirectUri(),
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString()
    return { url: url.toString() }
  }

  /** Volta do Mercado Livre: a tela do CRM manda o code e o state (o cookie de sessão não vem na volta de outro site). */
  async completeAuthorization(user: AuthUser, code: string, state: string) {
    const pending = await this.settings.get<Partial<OAuthPending>>(user.tenantId, ML_OAUTH_KEY, {})
    if (!pending.state || !safeEqual(pending.state, state) || pending.userId !== user.id || Date.parse(pending.expiresAt ?? '') < Date.now()) {
      throw new BadRequestException('Autorização inválida ou expirada. Clique em Conectar de novo.')
    }
    await this.settings.set(user.tenantId, ML_OAUTH_KEY, {})
    const c = await this.config(user.tenantId)
    const token = await this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: c.clientId,
      client_secret: decrypt(c.clientSecretEnc!),
      code,
      redirect_uri: this.redirectUri(),
      code_verifier: decrypt(pending.verifierEnc!),
    })
    const me = (await this.fetcher(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(30_000) })
      .then((r) => r.json())
      .catch(() => ({}))) as { nickname?: string }
    const sameAccount = c.userId === String(token.user_id)
    await this.patch(user.tenantId, {
      status: 'CONECTADO',
      accessTokenEnc: encrypt(token.access_token),
      refreshTokenEnc: encrypt(token.refresh_token),
      tokenExpiresAt: new Date(Date.now() + (token.expires_in - 120) * 1000).toISOString(),
      userId: String(token.user_id),
      nickname: me.nickname ?? null,
      connectedAt: new Date().toISOString(),
      connectedBy: user.name,
      lastError: null,
      // Outra conta do Mercado Livre: o anunciante escolhido antes não vale mais.
      ...(sameAccount ? {} : { advertiserId: null, siteId: null, advertiserName: null, displayAdvertiserId: null, displayStatus: null }),
    })
    const advertisers = await this.listAdvertisers(user.tenantId).catch(() => [])
    const now = await this.config(user.tenantId)
    if (!now.advertiserId && advertisers.length === 1) await this.selectAdvertiser(user.tenantId, advertisers[0]!.advertiserId, advertisers)
    return { nickname: me.nickname ?? null, advertisers }
  }

  private async tokenRequest(body: Record<string, string>) {
    const res = await this.fetcher(`${ML_API}/oauth/token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(30_000),
    })
    const json = (await res.json().catch(() => null)) as { access_token: string; refresh_token: string; expires_in: number; user_id: number; error?: string; message?: string } | null
    if (!res.ok || !json?.access_token) {
      const err = tokenError(res.status, json)
      // Segredo recusado: diz qual Client ID foi usado e o final do segredo salvo, para conferir com o do aplicativo.
      if (json?.error === 'invalid_client') {
        const secret = body.client_secret ?? ''
        err.message += ` (enviado: Client ID ${body.client_id}; Client Secret salvo com ${secret.length} caracteres, terminando em …${secret.slice(-4)})`
      }
      this.logger.warn(`Mercado Livre recusou o pedido de token (${body.grant_type}): ${res.status} ${json?.error ?? ''} ${json?.message ?? ''}`.trim())
      throw err
    }
    return json
  }

  private async accessToken(tenantId: string): Promise<string> {
    const c = await this.config(tenantId)
    if (!c.accessTokenEnc || !c.refreshTokenEnc) throw new MlError('O Mercado Livre não está conectado.', 401, true)
    if (c.tokenExpiresAt && Date.parse(c.tokenExpiresAt) > Date.now() + 60_000) return decrypt(c.accessTokenEnc)
    // O refresh token é de uso único: uma renovação por vez por empresa.
    const running = this.refreshing.get(tenantId)
    if (running) return running
    const p = (async () => {
      try {
        const fresh = await this.config(tenantId)
        if (fresh.tokenExpiresAt && Date.parse(fresh.tokenExpiresAt) > Date.now() + 60_000) return decrypt(fresh.accessTokenEnc!)
        const token = await this.tokenRequest({ grant_type: 'refresh_token', client_id: fresh.clientId, client_secret: decrypt(fresh.clientSecretEnc!), refresh_token: decrypt(fresh.refreshTokenEnc!) })
        await this.patch(tenantId, { accessTokenEnc: encrypt(token.access_token), refreshTokenEnc: encrypt(token.refresh_token), tokenExpiresAt: new Date(Date.now() + (token.expires_in - 120) * 1000).toISOString() })
        return token.access_token
      } catch (err) {
        if (err instanceof MlError && err.reconnect) await this.patch(tenantId, { status: 'ERRO', lastError: err.message })
        throw err
      } finally {
        this.refreshing.delete(tenantId)
      }
    })()
    this.refreshing.set(tenantId, p)
    return p
  }

  async apiGet<T>(tenantId: string, path: string, params: Record<string, string | number> = {}, apiVersion?: string, counter?: { calls: number }): Promise<T> {
    const url = new URL(ML_API + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await this.accessToken(tenantId)
      if (counter) counter.calls++
      const res = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(apiVersion ? { 'api-version': apiVersion } : {}) },
        signal: AbortSignal.timeout(60_000),
        redirect: 'error',
      })
      if (res.ok) return (await res.json()) as T
      if (res.status === 401 && attempt === 0) {
        await this.patch(tenantId, { tokenExpiresAt: new Date(0).toISOString() })
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        await sleep(this.gapMs ? 1000 * 2 ** attempt : 0)
        continue
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      const msg = body.message ?? body.error ?? res.statusText
      if (res.status === 404 && String(msg).includes('No permissions found')) throw new MlError('Produto de publicidade não habilitado nesta conta do Mercado Livre.', 404, false, true)
      throw new MlError(`O Mercado Livre respondeu ${res.status} em ${path}: ${msg}`, res.status)
    }
    throw new MlError(`Mercado Livre indisponível ou limite de requisições atingido em ${path}. Tente de novo mais tarde.`, 429)
  }

  /** POST na API (ex.: responder pergunta). Sem repetir em erro de servidor: a resposta pode ter sido gravada. */
  async apiPost<T>(tenantId: string, path: string, body: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(tenantId)
      const res = await this.fetcher(ML_API + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      })
      if (res.ok) return (await res.json().catch(() => ({}))) as T
      if (res.status === 401 && attempt === 0) {
        await this.patch(tenantId, { tokenExpiresAt: new Date(0).toISOString() })
        continue
      }
      const b = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      const msg = b.message ?? b.error ?? res.statusText
      if (res.status === 403) throw new MlError(`O Mercado Livre não deixou responder (${msg}). Confira se o aplicativo tem permissão de escrita em Perguntas e respostas e reconecte.`, 403)
      throw new MlError(`O Mercado Livre respondeu ${res.status} em ${path}: ${msg}`, res.status)
    }
    throw new MlError('O Mercado Livre recusou o acesso. Reconecte a conta.', 401, true)
  }

  async listAdvertisers(tenantId: string, product: 'PADS' | 'DISPLAY' = 'PADS', counter?: { calls: number }) {
    const r = await this.apiGet<{ advertisers?: { advertiser_id: number; site_id: string; advertiser_name: string; account_name: string }[] }>(tenantId, '/advertising/advertisers', { product_id: product }, '1', counter)
    return (r.advertisers ?? []).map((a) => ({ advertiserId: String(a.advertiser_id), siteId: a.site_id, name: a.advertiser_name, account: a.account_name }))
  }

  async selectAdvertiser(tenantId: string, advertiserId: string, known?: { advertiserId: string; siteId: string; name: string }[]) {
    const list = known ?? (await this.listAdvertisers(tenantId))
    const a = list.find((x) => x.advertiserId === advertiserId)
    if (!a) throw new BadRequestException('Anunciante não encontrado nesta conta do Mercado Livre.')
    const display = await this.detectDisplay(tenantId, a.siteId).catch(() => ({ displayAdvertiserId: null, displayStatus: null }))
    return this.patch(tenantId, { advertiserId: a.advertiserId, siteId: a.siteId, advertiserName: a.name, ...display })
  }

  /** Testar conexão: token válido e acesso ao Product Ads. */
  async test(tenantId: string) {
    try {
      const advertisers = await this.listAdvertisers(tenantId)
      await this.patch(tenantId, { status: 'CONECTADO', lastError: null })
      return { ok: true, message: `Conexão funcionando: ${advertisers.length} anunciante(s) de Product Ads.`, advertisers }
    } catch (err) {
      const msg = err instanceof MlError && err.noPermission ? 'Esta conta não tem o Product Ads habilitado (Mercado Livre › Meu perfil › Publicidade).' : (err as Error).message
      return { ok: false, message: msg, advertisers: [] }
    }
  }

  async disconnect(tenantId: string) {
    return this.patch(tenantId, { status: 'DESCONECTADO', accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, lastError: null })
  }

  /** Anunciante de Display Ads. Sem permissão = produto não habilitado (não é erro). */
  private async detectDisplay(tenantId: string, siteId: string | null, counter?: { calls: number }): Promise<Pick<MlConfig, 'displayAdvertiserId' | 'displayStatus'>> {
    try {
      const list = await this.listAdvertisers(tenantId, 'DISPLAY', counter)
      const match = list.find((a) => a.siteId === siteId) ?? list[0]
      return match ? { displayAdvertiserId: match.advertiserId, displayStatus: 'ATIVO' } : { displayAdvertiserId: null, displayStatus: 'NAO_HABILITADO' }
    } catch (err) {
      if (err instanceof MlError && (err.noPermission || err.status === 404)) return { displayAdvertiserId: null, displayStatus: 'NAO_HABILITADO' }
      throw err
    }
  }

  // ---------- Sincronização ----------

  /** A cada 30 minutos: sincroniza as empresas conectadas cuja última sincronização passou de 6 horas. */
  async tick(now = Date.now()) {
    if (this.busy) return
    this.busy = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: ML_CONFIG_KEY }, select: { tenantId: true, value: true } })
      for (const row of rows) {
        const c = row.value as Partial<MlConfig> | null
        if (c?.status !== 'CONECTADO' || !c.advertiserId) continue
        const st = await this.syncState(row.tenantId)
        const last = st.lastRunAt ? Date.parse(st.lastRunAt) : 0
        if (now - last < ML_SYNC_HOURS * 3_600_000) continue
        await this.sync(row.tenantId).catch((err: unknown) => this.logger.warn(`Mercado Livre: ${(err as Error).message}`))
      }
    } catch (err) {
      this.logger.error(`Sincronização do Mercado Livre: ${(err as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  async syncNow(tenantId: string) {
    const c = await this.config(tenantId)
    if (c.status === 'DESCONECTADO' || !c.refreshTokenEnc) throw new BadRequestException('Conecte o Mercado Livre antes de sincronizar.')
    if (!c.advertiserId) throw new BadRequestException('Escolha o anunciante do Product Ads antes de sincronizar.')
    const st = await this.syncState(tenantId)
    if (st.running && st.lastRunAt && Date.now() - Date.parse(st.lastRunAt) < 30 * 60_000) throw new BadRequestException('A sincronização já está rodando. Aguarde alguns minutos.')
    void this.sync(tenantId).catch((err: unknown) => this.logger.warn(`Mercado Livre: ${(err as Error).message}`))
    return { ok: true, message: 'Sincronização iniciada. Os dados aparecem em alguns minutos.' }
  }

  async sync(tenantId: string) {
    const c = await this.config(tenantId)
    if (!c.advertiserId || !c.siteId) throw new MlError('Escolha o anunciante do Product Ads antes de sincronizar.')
    const hasApiData = (await this.prisma.marketplaceAdDay.count({ where: { tenantId, marketplace: MARKETPLACE, source: 'api' } })) > 0
    const win = syncWindow(hasApiData)
    await this.setSyncState(tenantId, { lastRunAt: new Date().toISOString(), running: true, from: win.from, to: win.to })
    const counter = { calls: 0 }
    const site = c.siteId
    const adv = c.advertiserId
    let rows = 0
    try {
      // 1) campanhas de Product Ads
      const campaigns: ApiCampaign[] = []
      for (let offset = 0; ; offset += 50) {
        const page = await this.apiGet<{ paging: { total: number }; results: ApiCampaign[] }>(tenantId, `/advertising/${site}/advertisers/${adv}/product_ads/campaigns/search`, { limit: 50, offset }, '2', counter)
        campaigns.push(...page.results)
        if (offset + 50 >= page.paging.total || page.results.length === 0) break
      }
      for (const cp of campaigns) await this.saveCampaign(tenantId, 'product_ads', cp, adv)

      // 2) métricas diárias por campanha
      const activeDays = new Map<string, string[]>()
      for (const cp of campaigns) {
        const cid = String(cp.id)
        const r = await this.apiGet<unknown>(tenantId, `/advertising/${site}/product_ads/campaigns/${cid}`, { date_from: win.from, date_to: win.to, metrics: CAMPAIGN_METRICS, aggregation_type: 'DAILY' }, '2', counter)
        const days = parseCampaignDays(r)
        rows += await this.storeDays(tenantId, 'product_ads', 'campaign', days.map((d) => ({ ...d, entityId: cid, campaignId: cid })))
        activeDays.set(cid, days.filter((d) => d.impressions > 0 || d.cost > 0).map((d) => d.date))
      }

      // 3) grupos de anúncios (título, miniatura, campanha)
      const known = new Set(campaigns.map((cp) => String(cp.id)))
      for (let offset = 0; ; offset += 500) {
        const page = await this.apiGet<{ paging: { total: number }; results: ApiAdGroup[] }>(tenantId, `/advertising/${site}/advertisers/${adv}/product_ads/ad_groups/search`, { date_from: win.from, date_to: win.to, limit: 500, offset, metrics: 'CLICKS' }, '2', counter)
        for (const g of page.results) {
          const cid = g.campaign_id !== undefined && known.has(String(g.campaign_id)) ? String(g.campaign_id) : null
          const data = { campaignId: cid, externalId: g.ad_group_external_id ?? null, type: g.ad_group_type ?? null, title: g.title ?? null, thumbnail: httpsThumb(g.thumbnail), status: g.status ?? null }
          await this.prisma.marketplaceAd.upsert({ where: { tenantId_marketplace_adId: { tenantId, marketplace: MARKETPLACE, adId: String(g.id) } }, create: { tenantId, marketplace: MARKETPLACE, adId: String(g.id), ...data }, update: data })
        }
        if (offset + 500 >= page.paging.total || page.results.length === 0) break
      }

      // 4) métricas dos grupos de anúncios: um dia por chamada, só nos dias com atividade
      for (const [cid, days] of activeDays) {
        for (const d of days) {
          const r = await this.apiGet<unknown>(tenantId, `/advertising/${site}/product_ads/campaigns/${cid}/ad_groups/metrics`, { date_from: d, date_to: d, metrics: ADGROUP_METRICS }, '2', counter)
          const list = parseAdGroupDay(r, d)
          for (const g of list) {
            await this.prisma.marketplaceAd.upsert({ where: { tenantId_marketplace_adId: { tenantId, marketplace: MARKETPLACE, adId: g.adId } }, create: { tenantId, marketplace: MARKETPLACE, adId: g.adId, campaignId: cid }, update: {} })
          }
          rows += await this.storeDays(tenantId, 'product_ads', 'ad', list.map((g) => ({ ...g, entityId: g.adId, campaignId: cid })))
          await sleep(this.gapMs)
        }
      }

      // 5) Display Ads (produto opcional: sem habilitação, fica zerado e a tela explica)
      const display = await this.detectDisplay(tenantId, site, counter)
      await this.patch(tenantId, display)
      if (display.displayAdvertiserId) rows += await this.syncDisplay(tenantId, display.displayAdvertiserId, win, counter)

      await this.patch(tenantId, { status: 'CONECTADO', lastError: null })
      await this.setSyncState(tenantId, { running: false, lastOkAt: new Date().toISOString(), lastError: null, rows, apiCalls: counter.calls })
      return { rows, apiCalls: counter.calls, window: win, campaigns: campaigns.length }
    } catch (err) {
      const msg = ((err as Error).message || 'falha').slice(0, 500)
      await this.setSyncState(tenantId, { running: false, lastError: msg, rows, apiCalls: counter.calls })
      if (err instanceof MlError && err.reconnect) await this.patch(tenantId, { status: 'ERRO', lastError: msg })
      throw err
    }
  }

  private async syncDisplay(tenantId: string, displayAdv: string, win: { from: string; to: string }, counter: { calls: number }) {
    const list = await this.apiGet<{ results?: ApiCampaign[] }>(tenantId, `/advertising/advertisers/${displayAdv}/display/campaigns`, { sort_by: 'start_date', sort_order: 'desc' }, '1', counter)
    let rows = 0
    for (const cp of list.results ?? []) {
      await this.saveCampaign(tenantId, 'display', cp, displayAdv)
      const start = cp.start_date?.slice(0, 10)
      const end = cp.end_date?.slice(0, 10)
      // Campanha fora da janela de datas: não há métricas a buscar.
      if ((start && start > win.to) || (end && end < win.from)) continue
      const cid = String(cp.id)
      const r = await this.apiGet<unknown>(tenantId, `/advertising/advertisers/${displayAdv}/display/campaigns/${cid}/metrics`, { date_from: win.from, date_to: win.to }, '1', counter)
      rows += await this.storeDays(tenantId, 'display', 'campaign', parseDisplayDays(r).map((d) => ({ ...d, entityId: cid, campaignId: cid })))
    }
    return rows
  }

  private async saveCampaign(tenantId: string, product: 'product_ads' | 'display', cp: ApiCampaign, advertiserId: string) {
    const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : null)
    const data = {
      name: cp.name ?? `Campanha ${cp.id}`,
      status: cp.status ?? null,
      strategy: cp.strategy ?? cp.goal ?? null,
      budget: cp.budget ?? null,
      roasTarget: cp.roas_target ?? null,
      acosTarget: cp.acos_target ?? null,
      startDate: date(cp.start_date),
      endDate: date(cp.end_date),
      extra: { advertiserId, currencyId: cp.currency_id ?? null, type: cp.type ?? null, goal: cp.goal ?? null, dateCreated: cp.date_created ?? null },
    }
    await this.prisma.marketplaceCampaign.upsert({
      where: { tenantId_marketplace_product_campaignId: { tenantId, marketplace: MARKETPLACE, product, campaignId: String(cp.id) } },
      create: { tenantId, marketplace: MARKETPLACE, product, campaignId: String(cp.id), ...data },
      update: data,
    })
  }

  /** Grava os dias de uma vez (o dia sincronizado pela API substitui o que veio do BI). */
  private async storeDays(tenantId: string, product: string, level: 'campaign' | 'ad', list: StoredDay[]) {
    const rows = [...new Map(list.map((r) => [`${r.entityId}|${r.date}`, r])).values()]
    if (!rows.length) return 0
    const col = <K extends keyof StoredDay>(k: K) => rows.map((r) => String(r[k]))
    await this.prisma.$executeRaw`
      INSERT INTO marketplace_ad_days (id, "tenantId", marketplace, product, level, "entityId", "campaignId", date, impressions, clicks, cost, revenue, "directRevenue", "indirectRevenue",
        units, "directUnits", "indirectUnits", items, "organicUnits", "organicRevenue", "pageViews", "addToCart", checkouts, "eventRevenue", source, "updatedAt")
      SELECT gen_random_uuid(), ${tenantId}::uuid, ${MARKETPLACE}, ${product}, ${level}, x.e, x.c, x.d::date, x.im::int, x.cl::int, x.co::numeric, x.rv::numeric, x.dr::numeric, x.ir::numeric,
        x.u::int, x.du::int, x.iu::int, x.it::int, x.ou::int, x.orv::numeric, x.pv::int, x.ac::int, x.ck::int, x.er::numeric, 'api', now()
      FROM unnest(${col('entityId')}::text[], ${col('campaignId')}::text[], ${col('date')}::text[], ${col('impressions')}::text[], ${col('clicks')}::text[], ${col('cost')}::text[],
        ${col('revenue')}::text[], ${col('directRevenue')}::text[], ${col('indirectRevenue')}::text[], ${col('units')}::text[], ${col('directUnits')}::text[], ${col('indirectUnits')}::text[],
        ${col('items')}::text[], ${col('organicUnits')}::text[], ${col('organicRevenue')}::text[], ${col('pageViews')}::text[], ${col('addToCart')}::text[], ${col('checkouts')}::text[], ${col('eventRevenue')}::text[])
        AS x(e, c, d, im, cl, co, rv, dr, ir, u, du, iu, it, ou, orv, pv, ac, ck, er)
      ON CONFLICT ("tenantId", marketplace, product, level, "entityId", date) DO UPDATE SET "campaignId" = EXCLUDED."campaignId", impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        cost = EXCLUDED.cost, revenue = EXCLUDED.revenue, "directRevenue" = EXCLUDED."directRevenue", "indirectRevenue" = EXCLUDED."indirectRevenue", units = EXCLUDED.units,
        "directUnits" = EXCLUDED."directUnits", "indirectUnits" = EXCLUDED."indirectUnits", items = EXCLUDED.items, "organicUnits" = EXCLUDED."organicUnits", "organicRevenue" = EXCLUDED."organicRevenue",
        "pageViews" = EXCLUDED."pageViews", "addToCart" = EXCLUDED."addToCart", checkouts = EXCLUDED.checkouts, "eventRevenue" = EXCLUDED."eventRevenue", source = 'api', "updatedAt" = now()`
    return rows.length
  }
}
