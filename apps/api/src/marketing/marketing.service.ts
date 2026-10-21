import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { DEFAULT_GOOGLE_ADS, type GoogleAdsSettings, SCRIPT_KEY, type ScriptState } from '../googleads/googleads'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { DEFAULT_GA4, type Ga4Settings, GA_TOKEN_URL, signJwt } from '../relatorios/ga4'
import { SettingsService } from '../settings/settings.service'
import {
  GRAPH,
  SC_SCOPE,
  TIKTOK_API,
  CONFIG_KEY,
  type ConnectionTest,
  cleanConfig,
  cleanDigits,
  cleanFilters,
  cleanMetaAccount,
  cleanSiteUrl,
  DEFAULT_CONFIG,
  DEFAULT_INTEGRATIONS,
  INTEGRATIONS_KEY,
  type IntegrationKey,
  type IntegrationsConfig,
  integrationsView,
  type MarketingConfig,
} from './config'
import {
  applyCostFilters,
  applyFilters,
  attributedCampaign,
  breakdown,
  CRM_ONLY_FILTERS,
  type CostRow,
  delta,
  type Dimension,
  type Filters,
  funnel,
  GRANULARITIES,
  type Granularity,
  indicators,
  localDay,
  periods,
  PLATFORMS,
  platformOf,
  type RecordRow,
  regionOf,
  REGIONS,
  type Rules,
  series,
} from './metricas'
import { DEFAULT_ALERT_WORDS, negativeSuggestions } from '../googleads/detalhes'
import { fatigue } from './plataformas'
import { recommendations } from './recomendacoes'
import { SYNC_KEY, type SyncStates } from './sync.service'

const STATES = Object.keys(REGIONS).sort()

/** Campanha de Meta/TikTok pelo link do anúncio (utm_campaign com o número, utm_source da plataforma), dentro da janela. */
export function touchCampaign(leadAt: Date, touch: unknown, at: Date | null | undefined, platform: 'meta' | 'tiktok', windowDays: number) {
  const t = (touch ?? {}) as { source?: string; campaign?: string; campaignId?: string }
  const src = String(t.source ?? '').toLowerCase()
  const same = platform === 'tiktok' ? /tik ?tok/.test(src) : /facebook|instagram|\bmeta\b|\bfb\b|\big\b/.test(src)
  if (!same || !t.campaignId) return { id: null, name: null }
  if (at && leadAt.getTime() - at.getTime() > windowDays * 86_400_000) return { id: null, name: null }
  return { id: t.campaignId, name: t.campaign ?? null }
}

export interface AnalysisQuery {
  from?: string
  to?: string
  visao?: string
  filters: Partial<Record<keyof Filters, unknown>>
}

/** Marketing Inteligente: lê o CRM e o investimento das plataformas e calcula os indicadores. Não grava nada no CRM. */
@Injectable()
export class MarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  assertCan(user: AuthUser, module: string, action: Action = 'view') {
    if (!can(user.permissions, user.role.isSystem, module, action)) throw new ForbiddenException('Seu perfil não tem acesso a esta parte do Marketing Inteligente.')
  }

  config(tenantId: string) {
    return this.settings.get<MarketingConfig>(tenantId, CONFIG_KEY, DEFAULT_CONFIG)
  }

  async saveConfig(user: AuthUser, input: Partial<MarketingConfig>, ctx: RequestCtx) {
    const current = await this.config(user.tenantId)
    const origins = await this.prisma.lookupItem.findMany({ where: { tenantId: user.tenantId, type: 'ORIGEM' }, select: { id: true } })
    const next = cleanConfig(input, current, new Set(origins.map((o) => o.id)))
    if ('error' in next) throw new BadRequestException(next.error)
    await this.settings.set(user.tenantId, CONFIG_KEY, next)
    await this.audit.byUser(user, ctx, 'marketing.config_updated', 'settings', CONFIG_KEY, {
      leadQualificado: next.qualified,
      margem: next.marginPct,
      custosFixos: next.fixedMonthly,
      atribuicao: next.attribution,
      origensMarketing: next.marketingOriginIds.length,
    })
    return next
  }

  // ---------- Integrações ----------

  integrations(tenantId: string) {
    return this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)
  }

  async saveIntegration(user: AuthUser, key: IntegrationKey, input: Record<string, unknown>, ctx: RequestCtx) {
    const all = await this.integrations(user.tenantId)
    const next: IntegrationsConfig = structuredClone({ ...DEFAULT_INTEGRATIONS, ...all })
    const list = (v: unknown, clean: (s: string) => string | null, label: string) => {
      const items = (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((x) => String(x)).filter((x) => x.trim())
      const out: string[] = []
      for (const i of items) {
        const c = clean(i)
        if (!c) throw new BadRequestException(`${label}: valor inválido (${i}).`)
        if (!out.includes(c)) out.push(c)
      }
      return out.slice(0, 20)
    }
    const token = typeof input.token === 'string' ? input.token.trim() : ''
    if (token && (token.length < 20 || token.length > 2000 || /\s/.test(token))) throw new BadRequestException('Token de acesso inválido.')
    const enabled = input.enabled === true
    if (key === 'metaAds') {
      next.metaAds = { ...next.metaAds, enabled, adAccountIds: list(input.adAccountIds, cleanMetaAccount, 'Conta de anúncios'), tokenEnc: token ? encrypt(token) : input.removeToken === true ? null : next.metaAds.tokenEnc }
      if (enabled && (!next.metaAds.tokenEnc || !next.metaAds.adAccountIds.length)) throw new BadRequestException('Para ligar, informe o token de acesso e ao menos uma conta de anúncios.')
    } else if (key === 'metaOrganic') {
      const pageId = String(input.pageId ?? '').trim()
      const instagramId = String(input.instagramId ?? '').trim()
      if (pageId && !cleanDigits(pageId)) throw new BadRequestException('ID da página do Facebook inválido (só números).')
      if (instagramId && !cleanDigits(instagramId)) throw new BadRequestException('ID da conta do Instagram inválido (só números).')
      next.metaOrganic = { ...next.metaOrganic, enabled, pageId, instagramId }
      if (enabled && !next.metaAds.tokenEnc) throw new BadRequestException('Para ligar, salve antes o token da Meta (em Meta Ads).')
      if (enabled && !pageId && !instagramId) throw new BadRequestException('Informe a página do Facebook e/ou a conta do Instagram.')
    } else if (key === 'tiktok') {
      next.tiktok = { ...next.tiktok, enabled, advertiserIds: list(input.advertiserIds, (s) => cleanDigits(s, 5, 25), 'ID do anunciante'), tokenEnc: token ? encrypt(token) : input.removeToken === true ? null : next.tiktok.tokenEnc }
      if (enabled && (!next.tiktok.tokenEnc || !next.tiktok.advertiserIds.length)) throw new BadRequestException('Para ligar, informe o token de acesso e ao menos um anunciante.')
    } else {
      const raw = String(input.siteUrl ?? '').trim()
      const siteUrl = raw ? cleanSiteUrl(raw) : ''
      if (siteUrl === null) throw new BadRequestException('Propriedade inválida: use o endereço do site (https://www.usaparts.com.br/) ou sc-domain:usaparts.com.br.')
      next.searchConsole = { ...next.searchConsole, enabled, siteUrl }
      if (enabled && !siteUrl) throw new BadRequestException('Informe a propriedade do Search Console.')
    }
    await this.settings.set(user.tenantId, INTEGRATIONS_KEY, next)
    await this.audit.byUser(user, ctx, 'marketing.integration_updated', 'settings', `${INTEGRATIONS_KEY}.${key}`, { ligado: enabled, tokenAlterado: !!token || input.removeToken === true })
    return integrationsView(next)
  }

  /** Testa a conexão só lendo (nome da conta). O resultado fica guardado para a saúde dos dados. */
  async testIntegration(user: AuthUser, key: IntegrationKey, fetcher: typeof fetch = fetch) {
    const all = { ...DEFAULT_INTEGRATIONS, ...(await this.integrations(user.tenantId)) }
    let result: ConnectionTest
    try {
      const message = await this.probe(user.tenantId, key, all, fetcher)
      result = { at: new Date().toISOString(), ok: true, message }
    } catch (err) {
      result = { at: new Date().toISOString(), ok: false, message: ((err as Error).message || 'Falha na conexão.').slice(0, 300) }
    }
    const next = structuredClone(all)
    next[key] = { ...next[key], lastTest: result } as never
    await this.settings.set(user.tenantId, INTEGRATIONS_KEY, next)
    return result
  }

  private async probe(tenantId: string, key: IntegrationKey, c: IntegrationsConfig, fetcher: typeof fetch) {
    const get = async (url: string, headers: Record<string, string> = {}) => {
      const res = await fetcher(url, { headers, signal: AbortSignal.timeout(15_000), redirect: 'error' })
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return { ok: res.ok, status: res.status, body }
    }
    const metaError = (b: Record<string, unknown> | null, status: number) => {
      const e = (b?.error ?? {}) as { message?: string; code?: number }
      if (e.code === 190) return 'Token da Meta vencido ou inválido: gere um novo token do usuário do sistema.'
      if (e.code === 10 || e.code === 200) return `Sem permissão: ${key === 'metaAds' ? 'o token precisa de ads_read e a conta de anúncios atribuída ao usuário do sistema' : 'o token precisa de pages_read_engagement, instagram_basic e instagram_manage_insights, e a página/Instagram atribuídos ao usuário do sistema'}. (${e.message ?? status})`
      return `A Meta recusou (${status}): ${e.message ?? 'sem detalhe'}`
    }
    if (key === 'metaAds' || key === 'metaOrganic') {
      if (!c.metaAds.tokenEnc) throw new Error('Salve o token de acesso da Meta antes de testar.')
      const token = decrypt(c.metaAds.tokenEnc)
      const auth = { Authorization: `Bearer ${token}` }
      const ids = key === 'metaAds' ? c.metaAds.adAccountIds : [c.metaOrganic.pageId, c.metaOrganic.instagramId].filter(Boolean)
      if (!ids.length) throw new Error(key === 'metaAds' ? 'Informe ao menos uma conta de anúncios.' : 'Informe a página e/ou o Instagram.')
      const names: string[] = []
      for (const id of ids) {
        const fields = key === 'metaAds' ? 'name,account_status,currency' : id === c.metaOrganic.instagramId ? 'username,followers_count' : 'name,followers_count'
        const r = await get(`${GRAPH}/${id}?fields=${fields}`, auth)
        if (!r.ok) throw new Error(metaError(r.body, r.status))
        names.push(String(r.body?.name ?? r.body?.username ?? id))
      }
      return `Conectado: ${names.join(', ')}.`
    }
    if (key === 'tiktok') {
      if (!c.tiktok.tokenEnc) throw new Error('Salve o token de acesso do TikTok antes de testar.')
      const r = await get(`${TIKTOK_API}/advertiser/info/?advertiser_ids=${encodeURIComponent(JSON.stringify(c.tiktok.advertiserIds))}`, { 'Access-Token': decrypt(c.tiktok.tokenEnc) })
      const body = r.body as { code?: number; message?: string; data?: { list?: { name?: string }[] } } | null
      if (!r.ok || body?.code !== 0) throw new Error(`O TikTok recusou: ${body?.message ?? r.status}`)
      return `Conectado: ${(body.data?.list ?? []).map((a) => a.name).join(', ') || 'anunciante encontrado'}.`
    }
    // Search Console: usa a conta de serviço do Google Analytics (Configurações › Google Analytics).
    const ga = await this.settings.get<Ga4Settings>(tenantId, 'ga4', DEFAULT_GA4)
    if (!ga.privateKeyEnc || !ga.clientEmail) throw new Error('Envie antes o arquivo da conta de serviço em Configurações › Google Analytics (a mesma conta serve para o Search Console).')
    if (!c.searchConsole.siteUrl) throw new Error('Informe a propriedade do Search Console.')
    const tokenRes = await fetcher(GA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(ga.clientEmail, decrypt(ga.privateKeyEnc), Date.now(), SC_SCOPE) }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
    const tok = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null
    if (!tokenRes.ok || !tok?.access_token) throw new Error('O Google recusou a conta de serviço. Confira o arquivo de chave em Configurações › Google Analytics.')
    const r = await get(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(c.searchConsole.siteUrl)}`, { Authorization: `Bearer ${tok.access_token}` })
    if (r.status === 403 || r.status === 404) throw new Error(`Sem acesso à propriedade: no Search Console, em Configurações › Usuários e permissões, adicione ${ga.clientEmail} (permissão Completa ou Restrita).`)
    if (!r.ok) throw new Error(`O Search Console recusou (${r.status}).`)
    return `Conectado: ${c.searchConsole.siteUrl} (${String(r.body?.permissionLevel ?? 'acesso ok')}).`
  }

  // ---------- Dados ----------

  /** Nomes para os filtros e as tabelas (marcas, tipos de peça, origens, vendedores, filiais). */
  async names(tenantId: string) {
    const [items, units, sellers, ads] = await Promise.all([
      this.prisma.lookupItem.findMany({ where: { tenantId, type: { in: ['ORIGEM', 'MARCA', 'TIPO_PECA', 'TIPO_CLIENTE'] } }, select: { id: true, name: true, type: true, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.unit.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.seller.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.settings.get<GoogleAdsSettings>(tenantId, 'google_ads', DEFAULT_GOOGLE_ADS),
    ])
    const map = new Map<string, string>()
    for (const i of [...items, ...units, ...sellers]) map.set(i.id, i.name)
    return { items, units, sellers, map, campaigns: ads.campaigns ?? {} }
  }

  async options(user: AuthUser) {
    const n = await this.names(user.tenantId)
    const since = new Date(Date.now() - 400 * 86_400_000)
    const [costCamps, recCamps] = await Promise.all([
      this.prisma.googleAdsCampaignDay.groupBy({ by: ['campaignId'], where: { tenantId: user.tenantId, date: { gte: since } }, _max: { campaignName: true } }),
      this.prisma.serviceRecord.groupBy({ by: ['adsCampaignId'], where: { tenantId: user.tenantId, kind: 'PRE_VENDAS', deletedAt: null, adsVia: 'ANUNCIO', adsCampaignId: { not: null }, leadAt: { gte: since } }, _max: { adsCampaign: true } }),
    ])
    const campaigns = new Map<string, string>()
    for (const c of costCamps) campaigns.set(c.campaignId, n.campaigns[c.campaignId] || c._max.campaignName || `Campanha nº ${c.campaignId}`)
    for (const c of recCamps) if (c.adsCampaignId && !campaigns.has(c.adsCampaignId)) campaigns.set(c.adsCampaignId, n.campaigns[c.adsCampaignId] || c._max.adsCampaign || `Campanha nº ${c.adsCampaignId}`)
    const of = (type: string) => n.items.filter((i) => i.type === type).map((i) => ({ id: i.id, name: i.name, active: i.active }))
    return {
      platforms: PLATFORMS,
      campaigns: [...campaigns.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      brands: of('MARCA'),
      partTypes: of('TIPO_PECA'),
      origins: of('ORIGEM'),
      customerTypes: of('TIPO_CLIENTE'),
      units: n.units,
      sellers: n.sellers,
      states: STATES,
      regions: ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul', 'Exterior', 'Sem estado'],
      granularities: GRANULARITIES,
    }
  }

  /** Atendimentos do Pré-Vendas do período, já com plataforma, campanha atribuída e cliente novo/recorrente. */
  async loadRecords(tenantId: string, start: Date, end: Date, cfg: MarketingConfig, campaignNames: Record<string, string>) {
    const list = await this.prisma.serviceRecord.findMany({
      where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, leadAt: { gte: start, lt: end } },
      select: {
        id: true, leadId: true, phone: true, leadAt: true, forwarded: true, forwardedAt: true, returnStatus: true, returnedAt: true, saleStatus: true, saleValue: true,
        firstActionAt: true, state: true, country: true, unitId: true, sellerId: true, originId: true, customerTypeId: true, brandIds: true, partTypeIds: true,
        adsVia: true, adsCampaignId: true, adsCampaign: true, adsTouchAt: true,
        origin: { select: { name: true } },
        lead: { select: { adsFirstCampaignId: true, adsFirstCampaign: true, adsFirstAt: true, lastConversion: true, lastConversionAt: true, firstConversion: true, firstConversionAt: true } },
      },
    })
    const leadIds = [...new Set(list.map((r) => r.leadId).filter((x): x is string => !!x))]
    const phones = [...new Set(list.filter((r) => !r.leadId && r.phone).map((r) => r.phone!))]
    // Recorrente: já comprou antes do período (venda no Pré-Vendas ou pedido na loja virtual).
    const [prevSales, prevOrders] = await Promise.all([
      leadIds.length || phones.length
        ? this.prisma.serviceRecord.findMany({
            where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, saleStatus: 'SIM', leadAt: { lt: start }, OR: [...(leadIds.length ? [{ leadId: { in: leadIds } }] : []), ...(phones.length ? [{ phone: { in: phones } }] : [])] },
            select: { leadId: true, phone: true },
            distinct: ['leadId', 'phone'],
          })
        : Promise.resolve([]),
      leadIds.length ? this.prisma.ecommerceOrder.findMany({ where: { tenantId, leadId: { in: leadIds }, orderedAt: { lt: start } }, select: { leadId: true }, distinct: ['leadId'] }) : Promise.resolve([]),
    ])
    const buyers = new Set<string>([...prevSales.flatMap((s) => [s.leadId, s.phone]), ...prevOrders.map((o) => o.leadId)].filter((x): x is string => !!x))
    return list.map((r): RecordRow => {
      const source = (r.lead?.lastConversion as { source?: string } | null)?.source ?? null
      const platform = platformOf({ adsVia: r.adsVia, originName: r.origin?.name ?? null, source })
      const camp =
        platform === 'google'
          ? attributedCampaign(
              {
                leadAt: r.leadAt,
                recordCampaignId: r.adsVia === 'ANUNCIO' ? r.adsCampaignId : null,
                recordCampaign: r.adsCampaign,
                recordTouchAt: r.adsTouchAt,
                firstCampaignId: r.lead?.adsFirstCampaignId ?? null,
                firstCampaign: r.lead?.adsFirstCampaign ?? null,
                firstTouchAt: r.lead?.adsFirstAt ?? null,
              },
              cfg.attribution.model,
              cfg.attribution.windowDays,
            )
          : platform === 'meta' || platform === 'tiktok'
            ? touchCampaign(r.leadAt, cfg.attribution.model === 'primeiro' ? r.lead?.firstConversion : r.lead?.lastConversion, cfg.attribution.model === 'primeiro' ? r.lead?.firstConversionAt : r.lead?.lastConversionAt, platform, cfg.attribution.windowDays)
            : { id: null, name: null }
      return {
        id: r.id,
        leadId: r.leadId,
        dedupeKey: r.leadId ?? (r.phone ? `tel:${r.phone}` : r.id),
        leadAt: r.leadAt,
        forwarded: r.forwarded,
        forwardedAt: r.forwardedAt,
        returnStatus: r.returnStatus,
        returnedAt: r.returnedAt,
        saleStatus: r.saleStatus,
        saleValue: r.saleValue ? Number(r.saleValue) : 0,
        firstActionAt: r.firstActionAt,
        state: r.state?.trim().toUpperCase() || null,
        country: r.country,
        unitId: r.unitId,
        sellerId: r.sellerId,
        originId: r.originId,
        customerTypeId: r.customerTypeId,
        brandIds: r.brandIds,
        partTypeIds: r.partTypeIds,
        platform,
        campaignId: camp.id,
        campaignName: camp.id ? campaignNames[camp.id] || camp.name || null : null,
        recurring: (!!r.leadId && buyers.has(r.leadId)) || (!!r.phone && buyers.has(r.phone)),
      }
    })
  }

  /** Investimento por dia e campanha: Google Ads (script) + Meta Ads e TikTok Ads (sincronizados). */
  async loadCosts(tenantId: string, from: string, to: string, campaignNames: Record<string, string>): Promise<CostRow[]> {
    const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }
    const [rows, other] = await Promise.all([
      this.prisma.googleAdsCampaignDay.findMany({ where: { tenantId, date: range }, select: { date: true, campaignId: true, campaignName: true, cost: true, clicks: true, impressions: true, conversions: true } }),
      this.prisma.mktAdDay.findMany({ where: { tenantId, level: 'campaign', date: range }, select: { platform: true, date: true, campaignId: true, campaignName: true, spend: true, clicks: true, impressions: true, conversions: true } }),
    ])
    const paid: CostRow[] = other.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      platform: r.platform === 'tiktok' ? 'tiktok' : 'meta',
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      cost: Number(r.spend),
      clicks: r.clicks,
      impressions: r.impressions,
      // Conversões da plataforma = compras/conversões que ela conta; leads e conversas aparecem à parte na tela da plataforma.
      conversions: Number(r.conversions),
    }))
    return [...paid, ...rows.map((r): CostRow => ({
      date: r.date.toISOString().slice(0, 10),
      platform: 'google',
      campaignId: r.campaignId,
      campaignName: campaignNames[r.campaignId] || r.campaignName,
      cost: Number(r.cost),
      clicks: r.clicks,
      impressions: r.impressions,
      conversions: Number(r.conversions),
    }))]
  }

  /** Tudo o que as telas do módulo mostram, para o período e os filtros (e o período anterior, para comparar). */
  async analysis(user: AuthUser, q: AnalysisQuery, now = Date.now()) {
    return this.analyze(user.tenantId, q, now)
  }

  async analyze(tenantId: string, q: AnalysisQuery, now = Date.now()) {
    const p = periods(q.from, q.to, now)
    const g: Granularity = GRANULARITIES.includes(q.visao as Granularity) ? (q.visao as Granularity) : p.days > 120 ? 'mes' : p.days > 45 ? 'semana' : 'dia'
    const filters = cleanFilters(q.filters)
    const [cfg, n, costSync, script, adsCfg] = await Promise.all([
      this.config(tenantId),
      this.names(tenantId),
      this.settings.get<{ syncedAt?: string }>(tenantId, 'google_ads_custos', {}),
      this.settings.get<ScriptState>(tenantId, SCRIPT_KEY, {}),
      this.settings.get<GoogleAdsSettings>(tenantId, 'google_ads', DEFAULT_GOOGLE_ADS),
    ])
    const rules: Rules = { qualified: cfg.qualified, marginPct: cfg.marginPct, fixedMonthly: cfg.fixedMonthly, marketingOriginIds: cfg.marketingOriginIds }
    const [rowsAll, prevAll, costsAll, prevCostsAll] = await Promise.all([
      this.loadRecords(tenantId, p.start, p.end, cfg, n.campaigns),
      this.loadRecords(tenantId, p.prevStart, p.prevEnd, cfg, n.campaigns),
      this.loadCosts(tenantId, p.from, p.to, n.campaigns),
      this.loadCosts(tenantId, p.prevFrom, p.prevTo, n.campaigns),
    ])
    const crmOnly = CRM_ONLY_FILTERS.filter((k) => filters[k] !== undefined)
    const rows = applyFilters(rowsAll, filters)
    const prev = applyFilters(prevAll, filters)
    // Com filtro só do CRM (marca, estado, vendedor...), o investimento não tem esse recorte: fica fora das contas de custo.
    const costs = crmOnly.length ? [] : applyCostFilters(costsAll, filters)
    const prevCosts = crmOnly.length ? [] : applyCostFilters(prevCostsAll, filters)
    const nowI = indicators(rows, costs, crmOnly.length ? { ...rules, fixedMonthly: 0 } : rules, p.days)
    const beforeI = indicators(prev, prevCosts, crmOnly.length ? { ...rules, fixedMonthly: 0 } : rules, p.days)
    const name = (key: string) => {
      if (key === 'novo') return 'Cliente novo'
      if (key === 'recorrente') return 'Cliente recorrente'
      const pl = PLATFORMS.find((x) => x.key === key)
      if (pl) return pl.label
      if (REGIONS[key]) return key
      return n.map.get(key) ?? key
    }
    const by = (d: Dimension) => breakdown(rows, costs, d, rules, p.days, name)
    const deltas = Object.fromEntries(Object.keys(nowI).map((k) => [k, delta(nowI[k as keyof typeof nowI] as number | null, beforeI[k as keyof typeof beforeI] as number | null)]))
    const f = funnel(nowI, rows)
    const byCampaign = by('campaign')
    const byState = by('state')
    const bySeller = by('seller')
    const googleRows = rows.filter((r) => r.platform === 'google')
    const extra: Awaited<ReturnType<MarketingService['recommendationExtras']>> | Record<string, undefined> = crmOnly.length ? {} : await this.recommendationExtras(tenantId, p.from, p.to, cfg, filters)
    const costStaleHours = costSync.syncedAt ? (now - Date.parse(costSync.syncedAt)) / 3_600_000 : null
    return {
      period: { from: p.from, to: p.to, days: p.days, prevFrom: p.prevFrom, prevTo: p.prevTo },
      granularity: g,
      filters,
      crmOnlyFilters: crmOnly,
      rules: { ...rules, attribution: cfg.attribution },
      updatedAt: { crm: new Date(now).toISOString(), googleAdsCost: costSync.syncedAt ?? null, googleAdsScript: script.lastCallAt ?? null, googleAdsCampaigns: adsCfg.campaignsSyncedAt ?? null },
      now: nowI,
      before: beforeI,
      deltas,
      series: series(rows, costs, p.from, p.to, g, crmOnly.length ? { ...rules, fixedMonthly: 0 } : rules),
      byPlatform: by('platform'),
      byCampaign,
      bySeller,
      byState,
      byRegion: by('region'),
      byUnit: by('unit'),
      byOrigin: by('origin'),
      byBrand: by('brand'),
      byPartType: by('partType'),
      byCustomerType: by('customerType'),
      byCliente: by('cliente'),
      funnel: f,
      recommendations: recommendations({
        period: p,
        now: nowI,
        before: beforeI,
        campaigns: byCampaign,
        states: byState,
        sellers: bySeller,
        googleWithoutCampaign: { without: googleRows.filter((r) => !r.campaignId).length, total: googleRows.length },
        forwardMedianHours: f.times.toForwardMedianHours,
        forwardSample: rows.filter((r) => r.forwardedAt).length,
        costStaleHours: crmOnly.length ? null : costStaleHours,
        negativeTerms: extra.negativeTerms,
        fatigued: extra.fatigued,
      }),
      quality: {
        records: rows.length,
        withOrigin: rows.filter((r) => r.originId).length,
        withState: rows.filter((r) => r.state).length,
        withSeller: rows.filter((r) => r.sellerId).length,
        withBrand: rows.filter((r) => r.brandIds.length).length,
        withPartType: rows.filter((r) => r.partTypeIds.length).length,
        googleLeads: googleRows.length,
        googleWithCampaign: googleRows.filter((r) => r.campaignId).length,
        duplicates: rows.length - new Set(rows.map((r) => `${r.dedupeKey}|${localDay(r.leadAt)}`)).size,
        regionsKnown: rows.filter((r) => regionOf(r.state, r.country) !== 'Sem estado').length,
      },
    }
  }

  /** Dados das plataformas para as recomendações: termos de pesquisa para negativar e anúncios cansados. */
  private async recommendationExtras(tenantId: string, from: string, to: string, cfg: MarketingConfig, filters: Filters) {
    const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }
    const camp = filters.campaignId && filters.campaignId !== '-' ? { campaignId: filters.campaignId } : {}
    const wantGoogle = !filters.platform || filters.platform === 'google'
    const wantPaid = !filters.platform || filters.platform === 'meta' || filters.platform === 'tiktok'
    const [terms, ads] = await Promise.all([
      wantGoogle
        ? this.prisma.googleAdsSearchTermDay.groupBy({ by: ['term'], where: { tenantId, date: range, ...camp }, _sum: { cost: true, clicks: true, impressions: true, conversions: true }, orderBy: { _sum: { cost: 'desc' } }, take: 2000 })
        : Promise.resolve([]),
      wantPaid
        ? this.prisma.mktAdDay.findMany({ where: { tenantId, level: 'ad', ...(filters.platform ? { platform: filters.platform } : {}), date: { gte: new Date(Date.parse(`${to}T00:00:00Z`) - 14 * 86_400_000), lte: range.lte }, ...camp } })
        : Promise.resolve([]),
    ])
    const summary = terms.map((t) => ({ term: t.term, campaignIds: [], cost: Number(t._sum.cost ?? 0), clicks: Number(t._sum.clicks ?? 0), impressions: Number(t._sum.impressions ?? 0), conversions: Number(t._sum.conversions ?? 0) }))
    const total = summary.reduce((a, t) => a + t.cost, 0)
    const sug = negativeSuggestions(summary, cfg.negativeWords ?? DEFAULT_ALERT_WORDS, { minCost: Math.max(20, total * 0.01), minClicks: 5 })
    const tired = fatigue(
      ads.map((r) => ({ entityId: r.entityId, name: r.name, campaignId: r.campaignId, campaignName: r.campaignName, parentId: r.parentId, objective: r.objective, date: r.date.toISOString().slice(0, 10), spend: Number(r.spend), impressions: r.impressions, reach: r.reach, clicks: r.clicks, leads: r.leads, conversations: r.conversations, conversions: Number(r.conversions), videoViews: r.videoViews })),
      to,
    )
    return {
      negativeTerms: sug.length ? { count: sug.length, cost: Math.round(sug.reduce((a, t) => a + t.cost, 0) * 100) / 100, examples: sug.map((t) => t.term) } : undefined,
      fatigued: tired,
    }
  }

  /**
   * Loja virtual (pedidos da Magazord): vendas pagas, ticket, pendentes e cancelados, valor por canal de venda e
   * produtos mais vendidos. Compara com o período anterior do mesmo tamanho.
   */
  async store(tenantId: string, q: { from?: string; to?: string }) {
    const p = periods(q.from, q.to)
    const T = tenantId
    const totals = async (start: Date, end: Date) => {
      const rows = await this.prisma.ecommerceOrder.groupBy({ by: ['statusGroup'], where: { tenantId: T, orderedAt: { gte: start, lt: end } }, _count: { _all: true }, _sum: { total: true } })
      const g = (k: string) => rows.find((r) => r.statusGroup === k)
      const orders = g('pago')?._count._all ?? 0
      const revenue = Math.round(Number(g('pago')?._sum.total ?? 0) * 100) / 100
      return { orders, revenue, ticket: orders ? Math.round((revenue / orders) * 100) / 100 : null, pending: g('pendente')?._count._all ?? 0, canceled: g('cancelado')?._count._all ?? 0 }
    }
    const [now, before, channels, products, coverage] = await Promise.all([
      totals(p.start, p.end),
      totals(p.prevStart, p.prevEnd),
      this.prisma.ecommerceOrder.groupBy({ by: ['channel'], where: { tenantId: T, statusGroup: 'pago', orderedAt: { gte: p.start, lt: p.end } }, _count: { _all: true }, _sum: { total: true } }),
      this.prisma.$queryRaw<{ name: string; sku: string | null; quantity: bigint; revenue: Prisma.Decimal; orders: bigint }[]>`
        SELECT max(i.name) AS name, i.sku, sum(i.quantity) AS quantity, sum(i.total) AS revenue, count(DISTINCT i."orderId") AS orders
        FROM ecommerce_order_items i JOIN ecommerce_orders o ON o.id = i."orderId"
        WHERE o."tenantId" = ${T}::uuid AND o."statusGroup" = 'pago' AND o."orderedAt" >= ${p.start} AND o."orderedAt" < ${p.end}
        GROUP BY COALESCE(i.sku, i.name), i.sku
        ORDER BY sum(i.total) DESC LIMIT 15`,
      this.prisma.ecommerceOrder.count({ where: { tenantId: T, orderedAt: { gte: p.start, lt: p.end }, itemsAt: null } }),
    ])
    const delta = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10)
    return {
      period: { from: p.from, to: p.to },
      now,
      before,
      deltas: { orders: delta(now.orders, before.orders), revenue: delta(now.revenue, before.revenue), ticket: delta(now.ticket, before.ticket) },
      channels: channels
        .map((c) => ({ name: c.channel ?? 'Sem canal informado', orders: c._count._all, revenue: Math.round(Number(c._sum.total ?? 0) * 100) / 100 }))
        .map((c) => ({ ...c, share: now.revenue ? Math.round((c.revenue / now.revenue) * 1000) / 10 : null }))
        .sort((a, b) => b.revenue - a.revenue),
      products: products.map((r) => ({ name: r.name, sku: r.sku, quantity: Number(r.quantity), orders: Number(r.orders), revenue: Math.round(Number(r.revenue) * 100) / 100 })),
      /** Pedidos do período ainda sem os itens buscados na Magazord (os mais vendidos ficam incompletos). */
      pendingItems: coverage,
    }
  }

  /** E-mail marketing do período (dados do próprio CRM): envio, abertura registrada, clique e descadastro por campanha. */
  async email(tenantId: string, q: { from?: string; to?: string }) {
    const p = periods(q.from, q.to)
    const T = tenantId
    const camp = await this.prisma.$queryRaw<{ id: string; name: string; subject: string; kind: string; sent: bigint; failed: bigint; opened: bigint; clicked: bigint; unsub: bigint; first: Date | null }[]>`
      SELECT c.id, c.name, c.subject, c.kind,
        count(*) FILTER (WHERE er.status = 'ENVIADO') AS sent,
        count(*) FILTER (WHERE er.status = 'ERRO') AS failed,
        count(er."openedAt") AS opened, count(er."clickedAt") AS clicked, count(er."unsubscribedAt") AS unsub, min(er."sentAt") AS first
      FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId"
      WHERE c."tenantId" = ${T}::uuid AND ((er."sentAt" >= ${p.start} AND er."sentAt" < ${p.end}) OR (er."failedAt" >= ${p.start} AND er."failedAt" < ${p.end}))
      GROUP BY c.id, c.name, c.subject, c.kind ORDER BY first DESC NULLS LAST LIMIT 200`
    // Vendas de quem clicou: pedido da loja ou venda no Pré-Vendas do mesmo lead em até 7 dias depois do clique.
    const sales = await this.prisma.$queryRaw<{ campaignId: string; orders: bigint; revenue: unknown }[]>`
      WITH clicks AS (
        SELECT er."campaignId", er."leadId", min(er."clickedAt") AS at FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId"
        WHERE c."tenantId" = ${T}::uuid AND er."clickedAt" >= ${p.start} AND er."clickedAt" < ${p.end} GROUP BY 1, 2
      )
      SELECT k."campaignId", count(*) AS orders, coalesce(sum(v.value), 0) AS revenue FROM clicks k
      JOIN LATERAL (
        SELECT o.total AS value FROM ecommerce_orders o WHERE o."tenantId" = ${T}::uuid AND o."leadId" = k."leadId" AND o."orderedAt" >= k.at AND o."orderedAt" < k.at + interval '7 days'
        UNION ALL
        SELECT r."saleValue" FROM service_records r WHERE r."tenantId" = ${T}::uuid AND r."leadId" = k."leadId" AND r."deletedAt" IS NULL AND r."saleStatus" = 'SIM' AND r."leadAt" >= k.at AND r."leadAt" < k.at + interval '7 days'
      ) v ON true
      GROUP BY 1`
    const salesBy = new Map(sales.map((s) => [s.campaignId, { orders: Number(s.orders), revenue: Number(s.revenue ?? 0) }]))
    const campaigns = camp.map((c) => {
      const sent = Number(c.sent)
      const s = salesBy.get(c.id) ?? { orders: 0, revenue: 0 }
      const rate = (x: bigint) => (sent > 0 ? Math.round((Number(x) / sent) * 1000) / 10 : null)
      return { id: c.id, name: c.name, subject: c.subject, kind: c.kind, firstSent: c.first, sent, failed: Number(c.failed), opened: Number(c.opened), clicked: Number(c.clicked), unsubscribed: Number(c.unsub), openRate: rate(c.opened), clickRate: rate(c.clicked), unsubRate: rate(c.unsub), ...s }
    })
    const sum = (k: 'sent' | 'failed' | 'opened' | 'clicked' | 'unsubscribed' | 'orders' | 'revenue') => campaigns.reduce((a, c) => a + c[k], 0)
    const sent = sum('sent')
    const r = (x: number) => (sent > 0 ? Math.round((x / sent) * 1000) / 10 : null)
    return {
      period: { from: p.from, to: p.to },
      totals: { sent, failed: sum('failed'), opened: sum('opened'), clicked: sum('clicked'), unsubscribed: sum('unsubscribed'), orders: sum('orders'), revenue: Math.round(sum('revenue') * 100) / 100, openRate: r(sum('opened')), clickRate: r(sum('clicked')), unsubRate: r(sum('unsubscribed')) },
      campaigns,
    }
  }

  /** Saúde das integrações: o que está conectado, quando atualizou e o que falta. */
  async health(tenantId: string) {
    const T = tenantId
    const [costSync, script, ads, ga4, magazord, magState, meta, integ, lastRecord, lastEmail, sync, detail] = await Promise.all([
      this.settings.get<{ syncedAt?: string }>(T, 'google_ads_custos', {}),
      this.settings.get<ScriptState>(T, SCRIPT_KEY, {}),
      this.settings.get<GoogleAdsSettings>(T, 'google_ads', DEFAULT_GOOGLE_ADS),
      this.settings.get<Ga4Settings>(T, 'ga4', DEFAULT_GA4),
      this.settings.get<{ enabled?: boolean }>(T, 'magazord', {}),
      this.settings.get<{ lastOkAt?: string | null; lastError?: string | null }>(T, 'magazord_state', {}),
      this.settings.get<{ enabled?: boolean }>(T, 'meta_lead_ads', {}),
      this.integrations(T),
      this.prisma.serviceRecord.findFirst({ where: { tenantId: T, kind: 'PRE_VENDAS', deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.emailCampaign.findFirst({ where: { tenantId: T, startedAt: { not: null } }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
      this.settings.get<SyncStates>(T, SYNC_KEY, {}),
      this.settings.get<{ syncedAt?: string }>(T, 'google_ads_detalhes', {}),
    ])
    const c = { ...DEFAULT_INTEGRATIONS, ...integ }
    const stale = (iso: string | null | undefined, hours: number) => !iso || Date.now() - Date.parse(iso) > hours * 3_600_000
    type Status = 'ok' | 'atencao' | 'erro' | 'desligado'
    const src = (key: string, name: string, status: Status, lastAt: string | null | undefined, detail: string, metrics: string) => ({ key, name, status, lastAt: lastAt ?? null, detail, metrics })
    const tested = (t: ConnectionTest | null, enabled: boolean): Status => (!enabled ? 'desligado' : t?.ok ? 'ok' : t ? 'erro' : 'atencao')
    /** Integração sincronizada: ok quando a última sincronização deu certo e é recente; erro quando falhou. */
    const synced = (key: IntegrationKey, enabled: boolean, hours: number): { status: Status; at: string | null | undefined; detail: string | null } => {
      const st = sync[key]
      if (!enabled) return { status: 'desligado', at: st?.lastOkAt, detail: null }
      if (st?.lastError) return { status: 'erro', at: st.lastOkAt, detail: `Última sincronização falhou: ${st.lastError}` }
      if (!st?.lastOkAt) return { status: 'atencao', at: null, detail: 'Ligado; a primeira sincronização roda em até 30 minutos (ou clique em Sincronizar agora).' }
      return { status: stale(st.lastOkAt, hours) ? 'atencao' : 'ok', at: st.lastOkAt, detail: `${st.rows ?? 0} linha(s) na última sincronização.` }
    }
    const metaAds = synced('metaAds', c.metaAds.enabled, 12)
    const metaOrg = synced('metaOrganic', c.metaOrganic.enabled, 24)
    const tiktok = synced('tiktok', c.tiktok.enabled, 12)
    const sc = synced('searchConsole', c.searchConsole.enabled, 48)
    return {
      sources: [
        src('crm', 'Pré-Vendas (CRM)', 'ok', lastRecord?.createdAt.toISOString(), 'Fonte da verdade comercial: leads, atendimento, vendas e faturamento (valor da venda do Pré-Vendas).', 'Leads, atendimento, oportunidades, vendas, faturamento'),
        src('google_ads_custo', 'Google Ads: investimento (script)', costSync.syncedAt ? (stale(costSync.syncedAt, 36) ? 'erro' : 'ok') : 'atencao', costSync.syncedAt, script.lastError ? `Último envio recusado: ${script.lastError}` : script.lastCallAt ? `Último contato do script: ${new Date(script.lastCallAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.` : 'Cole o script de Configurações › Google Ads e programe para rodar.', 'Investimento, cliques, impressões e conversões por campanha e palavra-chave'),
        src('google_ads_detalhe', 'Google Ads: detalhes (script ampliado)', detail.syncedAt ? (stale(detail.syncedAt, 36) ? 'atencao' : 'ok') : 'atencao', detail.syncedAt, detail.syncedAt ? 'Termos de pesquisa, dispositivo, rede, região, anúncios e páginas de destino.' : 'Cole o script novo de Configurações › Google Ads para trazer os detalhes.', 'Termos de pesquisa, dispositivo, rede, região, anúncios, grupos, páginas de destino e tipo de campanha'),
        src('google_ads_conv', 'Google Ads: conversões enviadas', ads.enabled ? 'ok' : 'desligado', null, ads.enabled ? 'Vendas, perdas e retornos do Pré-Vendas voltam para o Google a cada 2 horas.' : 'Desligado em Configurações › Google Ads.', 'Conversões offline'),
        src('ga4', 'Google Analytics 4', ga4.enabled ? 'ok' : 'desligado', ga4.updatedAt, ga4.enabled ? 'Relatórios de tráfego do site.' : 'Desligado em Configurações › Google Analytics.', 'Sessões, usuários, origem/mídia, páginas'),
        src('magazord', 'Loja virtual (Magazord)', !magazord.enabled ? 'desligado' : magState.lastError ? 'erro' : stale(magState.lastOkAt, 24) ? 'atencao' : 'ok', magState.lastOkAt, magState.lastError ? `Erro: ${magState.lastError}` : 'Pedidos, carrinhos e catálogo.', 'Pedidos, carrinhos, produtos'),
        src('meta_leads', 'Meta Lead Ads (formulários)', meta.enabled ? 'ok' : 'desligado', null, meta.enabled ? 'Leads dos formulários do Facebook/Instagram entram no CRM.' : 'Desligado em Configurações › Meta Lead Ads.', 'Leads de formulário'),
        src('meta_ads', 'Meta Ads (investimento)', metaAds.status, metaAds.at, metaAds.detail ?? c.metaAds.lastTest?.message ?? 'Conta pronta para configurar em Configurações › Marketing Inteligente.', 'Investimento, alcance, frequência, cliques, leads e conversas por campanha e anúncio'),
        src('meta_organico', 'Instagram e Facebook orgânicos', metaOrg.status, metaOrg.at, metaOrg.detail ?? c.metaOrganic.lastTest?.message ?? 'Pronto para configurar em Configurações › Marketing Inteligente.', 'Seguidores, alcance, engajamento e publicações'),
        src('tiktok', 'TikTok Ads', tiktok.status, tiktok.at, tiktok.detail ?? c.tiktok.lastTest?.message ?? 'Pronto para configurar em Configurações › Marketing Inteligente.', 'Investimento, impressões, cliques, vídeo e conversões'),
        src('search_console', 'Google Search Console', sc.status, sc.at, sc.detail ?? c.searchConsole.lastTest?.message ?? 'Pronto para configurar em Configurações › Marketing Inteligente.', 'Cliques e impressões orgânicas, CTR, posição, consultas e páginas'),
        src('email', 'E-mail marketing (CRM)', 'ok', lastEmail?.startedAt?.toISOString(), 'Envios, aberturas registradas, cliques e descadastros das campanhas do CRM.', 'Envios, aberturas, cliques, descadastros, vendas de quem clicou'),
      ],
    }
  }
}
