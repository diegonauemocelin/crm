import { BadRequestException, ForbiddenException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { parseFreightOptions } from '../assistente/frete'
import { AuditService } from '../audit/audit.service'
import { decrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { MagazordService } from '../integracoes/magazord.service'
import { PrismaService } from '../prisma/prisma.service'
import { DEFAULT_GA4, GA_TOKEN_URL, type Ga4Settings, signJwt } from '../relatorios/ga4'
import { SettingsService } from '../settings/settings.service'
import {
  cepsOf,
  cleanConfig,
  CONTENT_SCOPE,
  DEFAULT_MERCHANT_FRETE,
  matchSku,
  MERCHANT_API,
  MERCHANT_KEY,
  type MerchantFreteConfig,
  regionId,
  shippingAttribute,
  SUPPLEMENTAL_NAME,
  UF_CEP_RANGES,
  type UfQuote,
  UFS,
  ufQuote,
} from './frete-google'

const MODULE = 'mi_config'
const HOUR = 3_600_000

interface McProduct {
  offerId?: string
  contentLanguage?: string
  feedLabel?: string
  productAttributes?: { title?: string; link?: string }
}

/**
 * Frete no Google Shopping (Merchant Center): o frete de cada produto é simulado na Magazord (as mesmas tabelas do
 * carrinho) para os CEPs de cada estado e enviado numa fonte suplementar, por estado. A Magazord continua mandando
 * os produtos; o CRM só acrescenta o frete. Uma rodada por noite, alguns produtos por vez.
 */
/** Projeto do Google Cloud ainda não registrado na conta do Merchant Center (exigência da Merchant API). */
const NOT_REGISTERED = /not registered with the merchant account|register_as_a_developer/i

/** Intervalo mínimo entre chamadas à Merchant API (as regiões têm limite baixo de pedidos por minuto). */
const MIN_GAP_MS = 1_100

@Injectable()
export class MerchantFreteService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('MerchantFrete')
  /** Última chamada à Merchant API (para espaçar os pedidos). */
  private lastCall = 0
  /** Empresas com o Preparar a conta rodando. */
  private readonly preparing = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private readonly running = new Set<string>()
  private token: { value: string; until: number; tenantId: string } | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly magazord: MagazordService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), HOUR)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private assertCan(user: AuthUser, action: 'view' | 'edit') {
    if (!can(user.permissions, user.role.isSystem, MODULE, action)) throw new ForbiddenException('Seu perfil não tem acesso às integrações do Marketing.')
  }

  config(tenantId: string) {
    return this.settings.get<MerchantFreteConfig>(tenantId, MERCHANT_KEY, DEFAULT_MERCHANT_FRETE)
  }

  // ---------- Google ----------

  private async accessToken(tenantId: string) {
    if (this.token && this.token.tenantId === tenantId && this.token.until > Date.now() + 60_000) return this.token.value
    const ga = await this.settings.get<Ga4Settings>(tenantId, 'ga4', DEFAULT_GA4)
    if (!ga.privateKeyEnc || !ga.clientEmail) throw new Error('Envie antes o arquivo da conta de serviço em Configurações › Google Analytics (a mesma conta serve para o Merchant Center).')
    const res = await fetch(GA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(ga.clientEmail, decrypt(ga.privateKeyEnc), Date.now(), CONTENT_SCOPE) }),
      signal: AbortSignal.timeout(15_000),
    })
    const tok = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
    if (!res.ok || !tok?.access_token) throw new Error('O Google recusou a conta de serviço. Confira o arquivo de chave em Configurações › Google Analytics.')
    this.token = { value: tok.access_token, until: Date.now() + (tok.expires_in ?? 3600) * 1000, tenantId }
    return tok.access_token
  }

  /**
   * Chamada à Merchant API. O Google limita os pedidos por minuto (429): espera o tempo pedido (Retry-After) ou 5, 10,
   * 20, 40 e 60 s e tenta de novo; também espera um pouco entre uma chamada e outra para não estourar o limite.
   */
  private async api<T>(tenantId: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: T | null }> {
    const waits = [5_000, 10_000, 20_000, 40_000, 60_000]
    for (let attempt = 0; ; attempt++) {
      const gap = this.lastCall + MIN_GAP_MS - Date.now()
      if (gap > 0) await new Promise((r) => setTimeout(r, gap))
      this.lastCall = Date.now()
      const token = await this.accessToken(tenantId)
      const res = await fetch(`${MERCHANT_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      })
      if ((res.status === 429 || res.status === 503) && attempt < waits.length) {
        const after = Number(res.headers.get('retry-after'))
        const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 120_000) : waits[attempt]!
        this.logger.warn(`Merchant API ${res.status} em ${method} ${path.split('?')[0]}: nova tentativa em ${Math.round(wait / 1000)} s`)
        await res.body?.cancel().catch(() => undefined)
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      return { status: res.status, body: (await res.json().catch(() => null)) as T | null }
    }
  }

  private async must<T>(tenantId: string, method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.api<T & { error?: { message?: string } }>(tenantId, method, path, body)
    const msg = r.body?.error?.message ?? ''
    // API desligada no projeto do Google Cloud da conta de serviço: o problema não é o acesso ao Merchant Center.
    const disabled = /has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg)
    if (r.status === 403 && disabled) {
      const project = /project (\d+)/.exec(msg)?.[1]
      throw new Error(
        `A Merchant API está desligada no projeto do Google Cloud da conta de serviço. Abra https://console.cloud.google.com/apis/library/merchantapi.googleapis.com${project ? `?project=${project}` : ''}, clique em Ativar, espere uns 5 minutos e tente de novo.`,
      )
    }
    if (r.status >= 400 && NOT_REGISTERED.test(msg)) throw new Error('O projeto do Google Cloud da conta de serviço ainda não está registrado nesta conta do Merchant Center. Clique em Preparar a conta: o CRM faz o registro.')
    if (r.status === 401 || r.status === 403) {
      const ga = await this.settings.get<Ga4Settings>(tenantId, 'ga4', DEFAULT_GA4)
      throw new Error(`Sem acesso ao Merchant Center: em Configurações › Pessoas e acesso, adicione ${ga.clientEmail} como Administrador. (${r.body?.error?.message ?? r.status})`)
    }
    if (r.status < 200 || r.status >= 300) throw new Error(`Merchant Center respondeu ${r.status}: ${(r.body?.error?.message ?? '').slice(0, 300)}`)
    return r.body as T
  }

  // ---------- Tela ----------

  async view(user: AuthUser) {
    this.assertCan(user, 'view')
    const [cfg, ga, counts, recent] = await Promise.all([
      this.config(user.tenantId),
      this.settings.get<Ga4Settings>(user.tenantId, 'ga4', DEFAULT_GA4),
      this.prisma.merchantShippingItem.groupBy({ by: ['tenantId'], where: { tenantId: user.tenantId }, _count: { _all: true, sku: true, sentAt: true, error: true } }),
      this.prisma.merchantShippingItem.findMany({ where: { tenantId: user.tenantId, OR: [{ sentAt: { not: null } }, { error: { not: null } }] }, orderBy: { updatedAt: 'desc' }, take: 30 }),
    ])
    const c = counts[0]?._count
    return {
      config: cfg,
      serviceAccount: ga.clientEmail || null,
      running: this.running.has(user.tenantId),
      preparing: this.preparing.has(user.tenantId),
      totals: { products: c?._all ?? 0, withSku: c?.sku ?? 0, sent: c?.sentAt ?? 0, errors: c?.error ?? 0 },
      recent: recent.map((r) => {
        const q = (Array.isArray(r.quotes) ? r.quotes : []) as unknown as UfQuote[]
        const prices = q.filter((x) => x.price !== null).map((x) => x.price!)
        return { offerId: r.offerId, title: r.title, sku: r.sku, states: prices.length, min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null, sentAt: r.sentAt, error: r.error }
      }),
    }
  }

  async save(user: AuthUser, input: Partial<MerchantFreteConfig>, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const cur = await this.config(user.tenantId)
    const next = cleanConfig(input, cur)
    if ('error' in next) throw new BadRequestException(next.error)
    await this.settings.set(user.tenantId, MERCHANT_KEY, next)
    await this.audit.byUser(user, ctx, 'merchant.frete.config', 'settings', MERCHANT_KEY, { ligado: next.enabled, conta: next.merchantId })
    return this.view(user)
  }

  /**
   * Prepara a conta: confere o acesso, cria as regiões (estados pelas faixas de CEP), a fonte suplementar "CRM - Frete
   * por estado" e a liga às fontes principais (a da Magazord), sem tirar nada do que já estava nelas.
   */
  /**
   * A Merchant API exige registrar uma vez o projeto do Google Cloud (o da conta de serviço) na conta do Merchant
   * Center. Só registra quando o Google diz que falta; a conta de serviço precisa ser Administrador lá.
   */
  private async registerProject(tenantId: string, acc: string) {
    const probe = await this.api<{ error?: { message?: string } }>(tenantId, 'GET', `/accounts/v1/${acc}`)
    if (!(probe.status >= 400 && NOT_REGISTERED.test(probe.body?.error?.message ?? ''))) return
    const ga = await this.settings.get<Ga4Settings>(tenantId, 'ga4', DEFAULT_GA4)
    const developerEmail = (await this.config(tenantId)).developerEmail
    if (!developerEmail)
      throw new Error('O Google pede o registro do projeto com o e-mail de uma pessoa: preencha "E-mail Google de quem administra o Merchant Center" (precisa ser Administrador lá em Pessoas e acesso), salve e clique de novo em Preparar a conta.')
    const r = await this.api<{ error?: { message?: string } }>(tenantId, 'POST', `/accounts/v1/${acc}/developerRegistration:registerGcp`, { developerEmail })
    if (r.status >= 200 && r.status < 300) {
      this.logger.log(`Merchant Center ${acc}: projeto do Google Cloud registrado`)
      return
    }
    const msg = r.body?.error?.message ?? String(r.status)
    if (/already/i.test(msg)) return
    if (r.status === 401 || r.status === 403)
      throw new Error(`Não deu para registrar o projeto do Google Cloud no Merchant Center: confira se ${ga.clientEmail} e ${developerEmail} estão como Administrador em Configurações › Pessoas e acesso e clique de novo em Preparar a conta. (${msg.slice(0, 200)})`)
    throw new Error(`Merchant Center recusou o registro do projeto: ${msg.slice(0, 300)}`)
  }

  /**
   * Preparar a conta roda em segundo plano: são umas 60 chamadas ao Google, espaçadas por causa do limite por minuto,
   * e pode levar alguns minutos. A tela acompanha pela situação (preparing) e mostra o erro, se houver.
   */
  async prepare(user: AuthUser, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const cfg = await this.config(user.tenantId)
    if (!cfg.merchantId) throw new BadRequestException('Informe e salve o número da conta do Merchant Center.')
    if (this.preparing.has(user.tenantId)) return { started: false }
    this.preparing.add(user.tenantId)
    await this.settings.set(user.tenantId, MERCHANT_KEY, { ...cfg, lastError: null })
    void this.doPrepare(user, ctx)
      .catch(() => undefined)
      .finally(() => this.preparing.delete(user.tenantId))
    return { started: true }
  }

  private async doPrepare(user: AuthUser, ctx: RequestCtx) {
    const cfg = await this.config(user.tenantId)
    const acc = `accounts/${cfg.merchantId}`
    try {
      await this.registerProject(user.tenantId, acc)
      await this.must(user.tenantId, 'GET', `/accounts/v1/${acc}`)
      for (const uf of UFS) {
        const id = regionId(uf)
        const body = { displayName: `CRM ${uf}`, postalCodeArea: { regionCode: 'BR', postalCodes: UF_CEP_RANGES[uf].map(([begin, end]) => ({ begin, end })) } }
        const got = await this.api(user.tenantId, 'GET', `/accounts/v1/${acc}/regions/${id}`)
        if (got.status === 404) await this.must(user.tenantId, 'POST', `/accounts/v1/${acc}/regions?regionId=${id}`, body)
        else if (got.status === 200) await this.must(user.tenantId, 'PATCH', `/accounts/v1/${acc}/regions/${id}?updateMask=displayName,postalCodeArea`, body)
        else await this.must(user.tenantId, 'GET', `/accounts/v1/${acc}/regions/${id}`)
      }
      const list = await this.dataSources(user.tenantId, acc)
      let supp = list.find((d) => d.supplementalProductDataSource && d.displayName === SUPPLEMENTAL_NAME)
      supp ??= await this.must<DataSource>(user.tenantId, 'POST', `/datasources/v1/${acc}/dataSources`, { displayName: SUPPLEMENTAL_NAME, supplementalProductDataSource: {} })
      const primaries = list.filter((d) => d.primaryProductDataSource)
      if (!primaries.length) throw new Error('A conta não tem fonte principal de produtos (a da Magazord). Confira se a Magazord já envia os produtos para esta conta.')
      let linked = 0
      for (const p of primaries) {
        const rules = p.primaryProductDataSource?.defaultRule?.takeFromDataSources ?? [{ self: true }]
        if (rules.some((r) => r.supplementalDataSourceName === supp.name)) {
          linked++
          continue
        }
        // O frete do CRM vem primeiro; o resto continua como estava (inclusive a própria fonte da Magazord).
        const takeFromDataSources = [{ supplementalDataSourceName: supp.name }, ...rules]
        await this.must(user.tenantId, 'PATCH', `/datasources/v1/${p.name}?updateMask=primaryProductDataSource.defaultRule`, { primaryProductDataSource: { ...p.primaryProductDataSource, defaultRule: { takeFromDataSources } } })
        linked++
      }
      await this.settings.set(user.tenantId, MERCHANT_KEY, { ...cfg, dataSource: supp.name, preparedAt: new Date().toISOString(), lastError: null })
      await this.audit.byUser(user, ctx, 'merchant.frete.preparado', 'settings', MERCHANT_KEY, { conta: cfg.merchantId, fonte: supp.name, principais: linked })
      return { ok: true, regions: UFS.length, dataSource: supp.name, primaries: linked }
    } catch (e) {
      const msg = (e as Error).message.slice(0, 400)
      await this.settings.set(user.tenantId, MERCHANT_KEY, { ...(await this.config(user.tenantId)), lastError: msg })
      throw new BadRequestException(msg)
    }
  }

  private async dataSources(tenantId: string, acc: string) {
    const out: DataSource[] = []
    let page = ''
    for (let i = 0; i < 20; i++) {
      const r = await this.must<{ dataSources?: DataSource[]; nextPageToken?: string }>(tenantId, 'GET', `/datasources/v1/${acc}/dataSources?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`)
      out.push(...(r.dataSources ?? []))
      if (!r.nextPageToken) break
      page = r.nextPageToken
    }
    return out
  }

  /** "Atualizar agora": roda uma rodada em segundo plano (a tela acompanha pelos números). */
  async runNow(user: AuthUser) {
    this.assertCan(user, 'edit')
    const cfg = await this.config(user.tenantId)
    if (!cfg.dataSource) throw new BadRequestException('Clique antes em "Preparar a conta".')
    if (this.running.has(user.tenantId)) return { started: false }
    void this.run(user.tenantId).catch((e: unknown) => this.logger.warn(`Rodada: ${(e as Error).message}`))
    return { started: true }
  }

  /** Uma rodada por noite (entre 1h e 5h), para cada empresa com o frete ligado. */
  private async tick() {
    const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }))
    if (h < 1 || h > 4) return
    const rows = await this.prisma.tenantSetting.findMany({ where: { key: MERCHANT_KEY }, select: { tenantId: true } })
    for (const { tenantId } of rows) {
      const cfg = await this.config(tenantId)
      if (!cfg.enabled || !cfg.dataSource) continue
      if (cfg.lastRunAt && Date.now() - Date.parse(cfg.lastRunAt) < 20 * HOUR) continue
      await this.run(tenantId).catch((e: unknown) => this.logger.warn(`Rodada (${tenantId}): ${(e as Error).message}`))
    }
  }

  /**
   * Rodada: lê os produtos do Merchant Center, liga cada um ao SKU da Magazord e, para os que estão há mais tempo sem
   * atualizar (até batchSize), simula o frete por estado e envia.
   */
  private async run(tenantId: string) {
    if (this.running.has(tenantId)) return
    this.running.add(tenantId)
    const cfg = await this.config(tenantId)
    const acc = `accounts/${cfg.merchantId}`
    let lastError: string | null = null
    try {
      // 1) Produtos da conta.
      const products: McProduct[] = []
      let page = ''
      for (let i = 0; i < 200; i++) {
        const r = await this.must<{ products?: McProduct[]; nextPageToken?: string }>(tenantId, 'GET', `/products/v1/${acc}/products?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`)
        products.push(...(r.products ?? []))
        if (!r.nextPageToken) break
        page = r.nextPageToken
      }
      const store = await this.prisma.storeProduct.findMany({ where: { tenantId, active: true }, select: { externalId: true, code: true, path: true, url: true, price: true } })
      const priceOf = new Map(store.map((s) => [s.externalId, s.price === null ? 0 : Number(s.price)]))
      for (const p of products) {
        if (!p.offerId || !p.contentLanguage || !p.feedLabel) continue
        const sku = matchSku({ offerId: p.offerId, link: p.productAttributes?.link }, store)
        const key = { tenantId_offerId_contentLanguage_feedLabel: { tenantId, offerId: p.offerId, contentLanguage: p.contentLanguage, feedLabel: p.feedLabel } }
        await this.prisma.merchantShippingItem.upsert({
          where: key,
          create: { tenantId, offerId: p.offerId, contentLanguage: p.contentLanguage, feedLabel: p.feedLabel, title: p.productAttributes?.title?.slice(0, 300) ?? null, sku, error: sku ? null : 'Produto não encontrado no catálogo da Magazord do CRM (atualize o Catálogo).' },
          update: { title: p.productAttributes?.title?.slice(0, 300) ?? null, sku, ...(sku ? {} : { error: 'Produto não encontrado no catálogo da Magazord do CRM (atualize o Catálogo).' }) },
        })
      }
      // 2) Os mais antigos primeiro.
      const batch = await this.prisma.merchantShippingItem.findMany({ where: { tenantId, sku: { not: null } }, orderBy: [{ sentAt: { sort: 'asc', nulls: 'first' } }], take: cfg.batchSize })
      for (const item of batch) {
        try {
          const quotes: UfQuote[] = []
          for (const uf of UFS) {
            const perCep: { price: number; days: number | null }[][] = []
            for (const cep of cepsOf(cfg, uf)) {
              const raw = await this.magazord.simulateFreight(tenantId, cep, [{ sku: item.sku!, quantity: 1, price: priceOf.get(item.sku!) ?? 0 }])
              perCep.push(parseFreightOptions(raw).map((o) => ({ price: o.price, days: o.days })))
              await new Promise((r) => setTimeout(r, 200))
            }
            quotes.push(ufQuote(uf, perCep))
          }
          const shipping = shippingAttribute(quotes, cfg)
          if (!shipping.length) throw new Error('A Magazord não calculou frete para nenhum estado.')
          await this.must(tenantId, 'POST', `/products/v1/${acc}/productInputs:insert?dataSource=${encodeURIComponent(cfg.dataSource!)}`, { offerId: item.offerId, contentLanguage: item.contentLanguage, feedLabel: item.feedLabel, productAttributes: { shipping } })
          await this.prisma.merchantShippingItem.update({ where: { id: item.id }, data: { quotes: quotes as unknown as Prisma.InputJsonValue, sentAt: new Date(), error: null } })
        } catch (e) {
          const msg = (e as Error).message.slice(0, 300)
          // Sem acesso ao Merchant Center: para a rodada (os outros dariam o mesmo erro).
          if (/Sem acesso ao Merchant Center/.test(msg)) throw e
          await this.prisma.merchantShippingItem.update({ where: { id: item.id }, data: { error: msg, sentAt: new Date() } })
        }
      }
      this.logger.log(`Frete no Google: ${batch.length} produto(s) atualizado(s), ${products.length} na conta.`)
    } catch (e) {
      lastError = (e as Error).message.slice(0, 400)
      this.logger.warn(`Frete no Google: ${lastError}`)
    } finally {
      this.running.delete(tenantId)
      const cur = await this.config(tenantId)
      await this.settings.set(tenantId, MERCHANT_KEY, { ...cur, lastRunAt: new Date().toISOString(), lastError })
    }
  }
}

interface DataSource {
  name: string
  displayName?: string
  primaryProductDataSource?: { defaultRule?: { takeFromDataSources?: { self?: boolean; supplementalDataSourceName?: string; primaryDataSourceName?: string }[] } } & Record<string, unknown>
  supplementalProductDataSource?: Record<string, unknown>
}
