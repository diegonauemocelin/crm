import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { AuditService } from '../../audit/audit.service'
import { env } from '../../config/env'
import { decrypt, encrypt } from '../../common/crypto'
import type { RequestCtx } from '../../common/decorators'
import { type Action, can } from '../../common/permissions'
import type { AuthUser } from '../../common/types'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { SettingsService } from '../../settings/settings.service'
import { cleanPrecosConfig, DEFAULT_PRECOS_CONFIG, PRECOS_CONFIG_KEY, type PrecosConfig } from '../precos/margem'
import { normSku, taxRateFor, type TaxRates } from '../precos/impostos'
import { MarketplaceTaxService } from '../precos/impostos.service'
import { CHANNEL_MODULE, CHANNEL_SLUG, type ChannelFees, channelRow, cleanFees, cleanPrice, DEFAULT_FEES } from './canais'
import { amazonLoginRedirect } from './amazon'
import { ADAPTERS } from './index'
import { type ChannelApp, ChannelError, type ChannelKey, type ChannelTokens } from './tipos'

const appKey = (c: ChannelKey) => `canal_app_${c}`
const tokenKey = (c: ChannelKey) => `canal_token_${c}`
const feesKey = (c: ChannelKey) => `canal_tarifas_${c}`
const stateKey = (c: ChannelKey) => `canal_oauth_${c}`
/** Anúncios lidos por sincronização (proteção; lojas maiores leem em várias vezes). */
const MAX_LISTINGS = 5000
const MAX_PAGES = 200

interface StoredApp {
  appId: string
  secretEnc: string
  extra: Record<string, string>
}

/**
 * Shopee, Amazon e TikTok Shop: aplicativo da empresa (chaves criptografadas), conexão da loja (autorização do lojista,
 * tokens criptografados e renovados sozinhos), leitura dos anúncios, margem com custo/imposto/lucro de Preços e mudança
 * de preço na plataforma (com histórico). Tudo pela API oficial de cada uma.
 */
@Injectable()
export class CanaisService {
  private readonly logger = new Logger('Marketplaces')
  private readonly syncing = new Set<string>()
  fetcher: typeof fetch = fetch

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly taxes: MarketplaceTaxService,
  ) {}

  private assertCan(user: AuthUser, c: ChannelKey, action: Action) {
    if (!can(user.permissions, user.role.isSystem, CHANNEL_MODULE[c], action)) throw new ForbiddenException(`Seu perfil não pode ${action === 'view' ? 'ver' : 'alterar'} a ${ADAPTERS[c].label}.`)
  }

  redirectUri(c: ChannelKey) {
    return `${env.appUrl}/marketplaces/${CHANNEL_SLUG[c]}/retorno`
  }

  private async app(tenantId: string, c: ChannelKey): Promise<ChannelApp | null> {
    const s = await this.settings.get<Partial<StoredApp>>(tenantId, appKey(c), {})
    if (!s.appId || !s.secretEnc) return null
    try {
      return { appId: s.appId, appSecret: decrypt(s.secretEnc), extra: s.extra ?? {} }
    } catch {
      return null
    }
  }

  private async tokens(tenantId: string, c: ChannelKey): Promise<ChannelTokens | null> {
    const s = await this.settings.get<{ enc?: string }>(tenantId, tokenKey(c), {})
    if (!s.enc) return null
    try {
      return JSON.parse(decrypt(s.enc)) as ChannelTokens
    } catch {
      return null
    }
  }

  private saveTokens(tenantId: string, c: ChannelKey, t: ChannelTokens | null) {
    return this.settings.set(tenantId, tokenKey(c), t ? { enc: encrypt(JSON.stringify(t)) } : {})
  }

  async fees(tenantId: string, c: ChannelKey): Promise<ChannelFees> {
    return cleanFees(await this.settings.get<Partial<ChannelFees>>(tenantId, feesKey(c), {}), DEFAULT_FEES)
  }

  /** Tokens válidos (renova sozinho quando faltam menos de 5 minutos). */
  private async session(tenantId: string, c: ChannelKey) {
    const app = await this.app(tenantId, c)
    if (!app) throw new BadRequestException(`Cadastre as chaves do aplicativo da ${ADAPTERS[c].label} antes.`)
    let t = await this.tokens(tenantId, c)
    if (!t) throw new BadRequestException(`A loja da ${ADAPTERS[c].label} não está conectada. Clique em Conectar.`)
    if (t.expiresAt - Date.now() < 5 * 60_000) {
      try {
        t = await ADAPTERS[c].refresh(app, t, this.fetcher)
      } catch (e) {
        throw new BadRequestException(`A conexão com a ${ADAPTERS[c].label} venceu e não renovou (${(e as Error).message}). Conecte de novo.`)
      }
      await this.saveTokens(tenantId, c, t)
    }
    return { app, tokens: t }
  }

  // ---------- Tela ----------

  async view(user: AuthUser, c: ChannelKey) {
    this.assertCan(user, c, 'view')
    const T = user.tenantId
    const [stored, t, fees, count, lastSync, changes] = await Promise.all([
      this.settings.get<Partial<StoredApp>>(T, appKey(c), {}),
      this.tokens(T, c),
      this.fees(T, c),
      this.prisma.channelListing.count({ where: { tenantId: T, channel: c } }),
      this.prisma.channelListing.findFirst({ where: { tenantId: T, channel: c }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
      this.prisma.channelPriceChange.findMany({ where: { tenantId: T, channel: c }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ])
    const a = ADAPTERS[c]
    return {
      channel: c,
      label: a.label,
      appFields: a.appFields,
      app: stored.appId ? { appId: stored.appId, hasSecret: !!stored.secretEnc, extra: stored.extra ?? {} } : null,
      redirectUri: this.redirectUri(c),
      // Amazon: a autorização passa antes pelo "Log-in URI" do aplicativo (cadastrado no app na Seller Central).
      loginUri: c === 'amazon' ? `${env.appUrl}/marketplaces/amazon/login` : null,
      connection: t ? { shopId: t.shopId, shopName: t.shopName, expiresAt: new Date(t.expiresAt).toISOString() } : null,
      fees,
      listings: count,
      lastSync: lastSync?.syncedAt ?? null,
      syncing: this.syncing.has(`${T}:${c}`),
      changes,
      canEdit: can(user.permissions, user.role.isSystem, CHANNEL_MODULE[c], 'edit'),
    }
  }

  async saveApp(user: AuthUser, c: ChannelKey, d: { appId?: string; appSecret?: string; extra?: Record<string, string> }, ctx: RequestCtx) {
    this.assertCan(user, c, 'edit')
    const cur = await this.settings.get<Partial<StoredApp>>(user.tenantId, appKey(c), {})
    const appId = (d.appId ?? cur.appId ?? '').trim()
    if (!appId) throw new BadRequestException('Informe o identificador do aplicativo.')
    const secret = d.appSecret?.trim()
    if (!secret && !cur.secretEnc) throw new BadRequestException('Informe a chave secreta do aplicativo.')
    const allowed = new Set(ADAPTERS[c].appFields.map((f) => f.key))
    const extra: Record<string, string> = { ...(cur.extra ?? {}) }
    for (const [k, v] of Object.entries(d.extra ?? {})) if (allowed.has(k) && typeof v === 'string') extra[k] = v.trim().slice(0, 300)
    await this.settings.set(user.tenantId, appKey(c), { appId: appId.slice(0, 200), secretEnc: secret ? encrypt(secret) : cur.secretEnc, extra })
    await this.audit.byUser(user, ctx, 'marketplaces.canal_app', 'setting', appKey(c), { canal: c, appId })
    return this.view(user, c)
  }

  async saveFees(user: AuthUser, c: ChannelKey, raw: Partial<Record<keyof ChannelFees, unknown>>, ctx: RequestCtx) {
    this.assertCan(user, c, 'edit')
    const fees = cleanFees(raw, await this.fees(user.tenantId, c))
    await this.settings.set(user.tenantId, feesKey(c), fees)
    await this.audit.byUser(user, ctx, 'marketplaces.canal_tarifas', 'setting', feesKey(c), { canal: c, ...fees })
    return fees
  }

  // ---------- Conexão ----------

  async connect(user: AuthUser, c: ChannelKey) {
    this.assertCan(user, c, 'edit')
    const app = await this.app(user.tenantId, c)
    if (!app) throw new BadRequestException(`Cadastre as chaves do aplicativo da ${ADAPTERS[c].label} antes de conectar.`)
    const state = randomBytes(24).toString('base64url')
    await this.settings.set(user.tenantId, stateKey(c), { state, userId: user.id, expiresAt: Date.now() + 15 * 60_000 })
    return { url: ADAPTERS[c].authUrl(app, this.redirectUri(c), state) }
  }

  /** Volta da plataforma: a tela manda todos os parâmetros do endereço de retorno. */
  async complete(user: AuthUser, c: ChannelKey, params: Record<string, string>, ctx: RequestCtx) {
    this.assertCan(user, c, 'edit')
    const pending = await this.settings.get<{ state?: string; userId?: string; expiresAt?: number }>(user.tenantId, stateKey(c), {})
    if (!pending.state || params.state !== pending.state || pending.userId !== user.id || (pending.expiresAt ?? 0) < Date.now()) throw new BadRequestException('Autorização inválida ou expirada. Clique em Conectar de novo.')
    await this.settings.set(user.tenantId, stateKey(c), {})
    const app = await this.app(user.tenantId, c)
    if (!app) throw new BadRequestException('As chaves do aplicativo sumiram. Cadastre de novo.')
    let t: ChannelTokens
    try {
      t = await ADAPTERS[c].exchangeCode(app, params, this.redirectUri(c), this.fetcher)
    } catch (e) {
      throw new BadRequestException(`A ${ADAPTERS[c].label} não confirmou a conexão: ${(e as Error).message}`)
    }
    await this.saveTokens(user.tenantId, c, t)
    await this.audit.byUser(user, ctx, 'marketplaces.canal_conectado', 'setting', tokenKey(c), { canal: c, loja: t.shopName ?? t.shopId })
    void this.sync(user, c).catch(() => undefined)
    return { shopName: t.shopName, shopId: t.shopId }
  }

  /**
   * Amazon: depois do consentimento, a Amazon abre o Log-in URI do aplicativo com amazon_callback_uri e amazon_state. O
   * CRM gera um state novo (guardado para conferir no retorno) e devolve o endereço para voltar à Amazon, que então manda
   * o código para o endereço de retorno.
   */
  async amazonLogin(user: AuthUser, params: Record<string, string>) {
    this.assertCan(user, 'amazon', 'edit')
    const app = await this.app(user.tenantId, 'amazon')
    if (!app) throw new BadRequestException('Cadastre as chaves do aplicativo da Amazon antes de conectar.')
    const state = randomBytes(24).toString('base64url')
    await this.settings.set(user.tenantId, stateKey('amazon'), { state, userId: user.id, expiresAt: Date.now() + 15 * 60_000 })
    try {
      return { url: amazonLoginRedirect(app, params, this.redirectUri('amazon'), state) }
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
  }

  async disconnect(user: AuthUser, c: ChannelKey, ctx: RequestCtx) {
    this.assertCan(user, c, 'edit')
    await this.saveTokens(user.tenantId, c, null)
    await this.audit.byUser(user, ctx, 'marketplaces.canal_desconectado', 'setting', tokenKey(c), { canal: c })
    return { ok: true }
  }

  // ---------- Anúncios ----------

  /** Lê os anúncios da plataforma (em segundo plano) e guarda uma linha por variação. */
  async sync(user: AuthUser, c: ChannelKey) {
    this.assertCan(user, c, 'view')
    const T = user.tenantId
    const k = `${T}:${c}`
    if (this.syncing.has(k)) return { started: false, message: 'A leitura já está em andamento.' }
    const { app, tokens } = await this.session(T, c)
    this.syncing.add(k)
    void (async () => {
      const started = new Date()
      try {
        let cursor: string | null = null
        let total = 0
        for (let page = 0; page < MAX_PAGES && total < MAX_LISTINGS; page++) {
          const r = await ADAPTERS[c].listListings(app, tokens, cursor, this.fetcher)
          for (const it of r.items) {
            const data = { sku: it.sku, title: it.title.slice(0, 300), price: it.price, stock: it.stock, status: it.status.slice(0, 40), url: it.url, image: it.image, syncedAt: new Date() }
            await this.prisma.channelListing.upsert({
              where: { tenantId_channel_listingId_variationId: { tenantId: T, channel: c, listingId: it.id, variationId: it.variationId ?? '' } },
              create: { tenantId: T, channel: c, listingId: it.id, variationId: it.variationId ?? '', ...data },
              update: data,
            })
          }
          total += r.items.length
          if (!r.next) {
            // Leu tudo: o que não veio mais saiu da loja (ou não está mais ativo).
            await this.prisma.channelListing.deleteMany({ where: { tenantId: T, channel: c, syncedAt: { lt: started } } })
            break
          }
          cursor = r.next
        }
      } catch (e) {
        this.logger.warn(`${ADAPTERS[c].label}: leitura dos anúncios falhou: ${(e as Error).message}`)
      } finally {
        this.syncing.delete(k)
      }
    })()
    return { started: true, message: 'Lendo os anúncios. Leva de alguns segundos a poucos minutos.' }
  }

  private async context(tenantId: string) {
    const [cfgRaw, rates, costs, erp] = await Promise.all([
      this.settings.get<Partial<PrecosConfig>>(tenantId, PRECOS_CONFIG_KEY, {}),
      this.taxes.rates(tenantId),
      this.prisma.marketplaceCost.findMany({ where: { tenantId } }),
      this.prisma.tcarProduct.findMany({ where: { tenantId, price: { not: null } }, select: { code: true, price: true } }).catch(() => [] as { code: string; price: unknown }[]),
    ])
    return {
      config: cleanPrecosConfig(cfgRaw as Record<string, unknown>, DEFAULT_PRECOS_CONFIG),
      rates,
      costBy: new Map(costs.map((x) => [x.sku, x])),
      erpBy: new Map(erp.map((e) => [normSku(e.code), Number(e.price)])),
    }
  }

  async listings(user: AuthUser, c: ChannelKey, q: { search?: string; page?: number }) {
    this.assertCan(user, c, 'view')
    const T = user.tenantId
    const search = q.search?.trim()
    const where: Prisma.ChannelListingWhereInput = { tenantId: T, channel: c, ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }, { listingId: search }] } : {}) }
    const page = Math.max(1, Math.min(500, Math.round(q.page ?? 1)))
    const [rows, total, ctx, fees] = await Promise.all([
      this.prisma.channelListing.findMany({ where, orderBy: { title: 'asc' }, skip: (page - 1) * 50, take: 50 }),
      this.prisma.channelListing.count({ where }),
      this.context(T),
      this.fees(T, c),
    ])
    return {
      total,
      page,
      rows: rows.map((r) => {
        const sku = r.sku?.trim() || null
        const cost = sku ? ctx.costBy.get(normSku(sku)) : undefined
        const tax = taxRateFor(sku, null, ctx.rates as TaxRates, ctx.config.taxPct, ctx.config.useNfeTaxes)
        const price = r.price === null ? null : Number(r.price)
        const calc = channelRow({
          price,
          fees,
          taxPct: tax.pct,
          ipiPct: tax.ipiPct,
          cost: cost ? Number(cost.cost) : null,
          profit: cost ? { profitValue: cost.profitValue === null ? null : Number(cost.profitValue), profitPct: cost.profitPct === null ? null : Number(cost.profitPct) } : null,
          erpPrice: sku ? (ctx.erpBy.get(normSku(sku)) ?? null) : null,
          fixedCost: ctx.config.fixedCostPerSale,
          extraPct: ctx.config.extraFeePct,
          marginMode: ctx.config.marginMode,
        })
        return { id: r.id, listingId: r.listingId, variationId: r.variationId || null, sku, title: r.title, price, stock: r.stock, status: r.status, url: r.url, image: r.image, taxLabel: tax.label, cost: cost ? Number(cost.cost) : null, ...calc }
      }),
    }
  }

  /** Muda o preço de anúncios na plataforma (um por vez), guardando o resultado de cada um. */
  async setPrices(user: AuthUser, c: ChannelKey, items: { id: string; price: unknown }[], ctx: RequestCtx) {
    this.assertCan(user, c, 'edit')
    const T = user.tenantId
    if (!items.length || items.length > 100) throw new BadRequestException('Escolha de 1 a 100 anúncios.')
    const { app, tokens } = await this.session(T, c)
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const it of items) {
      const price = cleanPrice(it.price)
      const row = await this.prisma.channelListing.findFirst({ where: { id: it.id, tenantId: T, channel: c } })
      if (!row) throw new NotFoundException('Anúncio não encontrado. Leia os anúncios de novo.')
      if (price === null) {
        results.push({ id: it.id, ok: false, error: 'Preço inválido.' })
        continue
      }
      let error: string | null = null
      try {
        await ADAPTERS[c].updatePrice(app, tokens, { id: row.listingId, variationId: row.variationId || null, sku: row.sku }, price, this.fetcher)
        await this.prisma.channelListing.update({ where: { id: row.id }, data: { price } })
      } catch (e) {
        error = (e instanceof ChannelError ? e.message : (e as Error).message || 'erro desconhecido').slice(0, 500)
      }
      await this.prisma.channelPriceChange.create({ data: { tenantId: T, channel: c, listingId: row.listingId, variationId: row.variationId, sku: row.sku, title: row.title, oldPrice: row.price, newPrice: price, status: error ? 'ERRO' : 'OK', error, userName: user.name } })
      results.push({ id: it.id, ok: !error, ...(error ? { error } : {}) })
    }
    await this.audit.byUser(user, ctx, 'marketplaces.canal_precos', 'channel_listing', c, { canal: c, enviados: results.length, ok: results.filter((r) => r.ok).length })
    return { results }
  }
}
