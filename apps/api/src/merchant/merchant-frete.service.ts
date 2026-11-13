import { createHash } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { parseFreightOptions } from '../assistente/frete'
import { AuditService } from '../audit/audit.service'
import { decrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { CotacaoService } from '../fretes/cotacao.service'
import { MagazordRateLimitError, MagazordService } from '../integracoes/magazord.service'
import { PrismaService } from '../prisma/prisma.service'
import { DEFAULT_GA4, GA_TOKEN_URL, type Ga4Settings, signJwt } from '../relatorios/ga4'
import { SettingsService } from '../settings/settings.service'
import {
  cepsOf,
  UF_REF_CEP,
  cleanConfig,
  CONTENT_SCOPE,
  crmOptions,
  DEFAULT_MERCHANT_FRETE,
  estimateRun,
  fingerprint,
  gapOf,
  isDue,
  matchSku,
  MERCHANT_API,
  MERCHANT_KEY,
  type Dims,
  type MerchantFreteConfig,
  Pacer,
  parseRate,
  PAUSE_AFTER_LIMITED,
  regionId,
  RESUME_AFTER_MS,
  retryWait,
  shippingAttribute,
  type StoredQuotes,
  storedUfs,
  SUPPLEMENTAL_NAME,
  productWeight,
  tcarWeightFor,
  UF_CEP_RANGES,
  type Uf,
  type UfQuote,
  UFS,
  ufQuote,
  simulationSku,
  weightIndex,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A Magazord não respondeu por causa do limite, mesmo depois de esperar: o produto fica para a próxima rodada. */
class LimitedError extends Error {}

/** Produtos calculados ao mesmo tempo com as tabelas do CRM (só banco, sem limite externo). */
const CRM_PARALLEL = 4

@Injectable()
export class MerchantFreteService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('MerchantFrete')
  /** Última chamada à Merchant API (para espaçar os pedidos). */
  private lastCall = 0
  /** Empresas com o Preparar a conta rodando. */
  private readonly preparing = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private readonly running = new Set<string>()
  /** Andamento da rodada de cada empresa (a tela mostra "x de y"). */
  private readonly progress = new Map<string, { done: number; total: number; source: string }>()
  private token: { value: string; until: number; tenantId: string } | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly magazord: MagazordService,
    private readonly audit: AuditService,
    private readonly cotacao: CotacaoService,
  ) {}

  onApplicationBootstrap() {
    // A cada 15 minutos: a rodada da noite começa logo depois da 1h e a pausada continua perto da hora marcada.
    this.timer = setInterval(() => void this.tick(), HOUR / 4)
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
      // Reserva a vez antes de esperar: chamadas em paralelo (fonte CRM) também saem espaçadas.
      const at = Math.max(Date.now(), this.lastCall + MIN_GAP_MS)
      this.lastCall = at
      if (at > Date.now()) await sleep(at - Date.now())
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
    const [units, carriers] = await Promise.all([
      this.prisma.unit.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, zip: true, city: true, state: true } }),
      this.prisma.freightCarrier.findMany({ where: { tenantId: user.tenantId, active: true, kind: 'TRANSPORTADORA' }, orderBy: { name: 'asc' }, select: { id: true, name: true }, take: 200 }),
    ])
    return {
      config: cfg,
      serviceAccount: ga.clientEmail || null,
      running: this.running.has(user.tenantId),
      progress: this.progress.get(user.tenantId) ?? null,
      preparing: this.preparing.has(user.tenantId),
      totals: { products: c?._all ?? 0, withSku: c?.sku ?? 0, sent: c?.sentAt ?? 0, errors: c?.error ?? 0 },
      estimate: estimateRun(cfg, cfg.source === 'crm' ? (c?.sku ?? 0) : Math.min(cfg.batchSize, c?.sku || cfg.batchSize)),
      units,
      carriers,
      recent: recent.map((r) => {
        const q = storedUfs(r.quotes)
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
    if (next.source === 'crm') {
      const unit = await this.prisma.unit.findFirst({ where: { id: next.unitId!, tenantId: user.tenantId }, select: { zip: true, name: true } })
      if (!unit) throw new BadRequestException('Filial de origem inválida.')
      if (!unit.zip) throw new BadRequestException(`Cadastre o CEP de expedição da filial ${unit.name} (Fretes › Filiais) para calcular o frete pelo CRM.`)
    }
    if (next.carrierIds.length) {
      const ok = await this.prisma.freightCarrier.count({ where: { tenantId: user.tenantId, id: { in: next.carrierIds } } })
      if (ok !== next.carrierIds.length) throw new BadRequestException('Transportadoras inválidas.')
    }
    await this.settings.set(user.tenantId, MERCHANT_KEY, next)
    await this.audit.byUser(user, ctx, 'merchant.frete.config', 'settings', MERCHANT_KEY, { ligado: next.enabled, conta: next.merchantId, fonte: next.source })
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
      // Rodada pausada pelo limite da Magazord continua na hora marcada; senão, uma por noite.
      const resume = !!cfg.resumeAt && Date.now() >= Date.parse(cfg.resumeAt)
      if (!resume && cfg.lastRunAt && Date.now() - Date.parse(cfg.lastRunAt) < 20 * HOUR) continue
      await this.run(tenantId).catch((e: unknown) => this.logger.warn(`Rodada (${tenantId}): ${(e as Error).message}`))
    }
  }

  /**
   * Rodada: lê os produtos do Merchant Center, liga cada um ao SKU da Magazord e recalcula os que precisam (nunca
   * enviados, com erro, com preço/peso/CEPs mudados ou passados os dias de refazer), os mais antigos primeiro.
   * Fonte Magazord: até batchSize produtos, no ritmo configurado e respeitando o limite (429) da Magazord; se ela
   * continuar limitando, a rodada pausa e continua mais tarde. Fonte CRM: todos, pelas tabelas de Fretes.
   */
  private async run(tenantId: string) {
    if (this.running.has(tenantId)) return
    this.running.add(tenantId)
    const cfg = await this.config(tenantId)
    const acc = `accounts/${cfg.merchantId}`
    let lastError: string | null = null
    let lastSummary: string | null = null
    let resumeAt: string | null = null
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
      const store = await this.prisma.storeProduct.findMany({ where: { tenantId, active: true }, select: { externalId: true, code: true, path: true, url: true, price: true, stock: true, weightKg: true, heightCm: true, widthCm: true, lengthCm: true } })
      const bySku = new Map(store.map((s) => [s.externalId, s]))
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

      // 2) O que precisa recalcular, os mais antigos primeiro.
      const crm = cfg.source === 'crm'
      if (crm) {
        const unit = cfg.unitId ? await this.prisma.unit.findFirst({ where: { id: cfg.unitId, tenantId }, select: { zip: true, name: true } }) : null
        if (!unit) throw new Error('Escolha a filial de origem do frete calculado pelo CRM.')
        if (!unit.zip) throw new Error(`Cadastre o CEP de expedição da filial ${unit.name} (Fretes › Filiais) para calcular o frete pelo CRM.`)
      }
      const items = await this.prisma.merchantShippingItem.findMany({
        where: { tenantId, sku: { not: null } },
        orderBy: [{ sentAt: { sort: 'asc', nulls: 'first' } }],
        select: { id: true, offerId: true, contentLanguage: true, feedLabel: true, sku: true, sentAt: true, error: true, quotes: true },
      })
      let weights = new Map<string, number | null>()
      if (crm) {
        // Tcar só para os produtos sem peso na Magazord.
        const codes = [...new Set(items.filter((i) => bySku.get(i.sku!)?.weightKg == null).flatMap((i) => [i.sku!, bySku.get(i.sku!)?.code ?? '']).filter(Boolean))]
        const rows: { code: string; grossWeight: Prisma.Decimal | null }[] = []
        for (let i = 0; i < codes.length; i += 2000) rows.push(...(await this.prisma.tcarProduct.findMany({ where: { tenantId, code: { in: codes.slice(i, i + 2000) } }, select: { code: true, grossWeight: true } })))
        // Código com outra caixa (maiúsculas/minúsculas) na Tcar: busca sem diferenciar, só para os que faltaram.
        const found = new Set(rows.map((r) => r.code.toLowerCase()))
        const missing = codes.filter((c) => !found.has(c.toLowerCase())).slice(0, 500)
        if (missing.length) rows.push(...(await this.prisma.tcarProduct.findMany({ where: { tenantId, OR: missing.map((code) => ({ code: { equals: code, mode: 'insensitive' as const } })) }, select: { code: true, grossWeight: true } })))
        weights = weightIndex(rows.map((r) => ({ code: r.code, grossWeight: r.grossWeight === null ? null : Number(r.grossWeight) })))
      }
      const tables = crm ? createHash('sha1').update(await this.cotacao.tablesKey(tenantId, cfg.unitId!, cfg.carrierIds)).digest('hex').slice(0, 16) : ''
      const now = Date.now()
      const due = items
        .map((it) => {
          const sp = bySku.get(it.sku!)
          const price = sp?.price === null || sp?.price === undefined ? 0 : Number(sp.price)
          const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d))
          const pw = crm ? productWeight(sp ? { weightKg: num(sp.weightKg), heightCm: num(sp.heightCm), widthCm: num(sp.widthCm), lengthCm: num(sp.lengthCm) } : null, tcarWeightFor({ code: sp?.code ?? null, externalId: it.sku! }, weights)) : null
          const weight = pw && 'weight' in pw ? pw.weight : null
          const dims = pw && 'weight' in pw ? pw.dims : null
          const fp = fingerprint({ source: cfg.source, price, weight, dims, ceps: cfg.ceps, unitId: cfg.unitId, carrierIds: cfg.carrierIds, tables })
          return { it, price, weight, dims, weightError: pw && 'error' in pw ? pw.error : null, fp }
        })
        // Só produtos com estoque (sem estoque a Magazord não simula o frete e o Google não vende).
        .filter((x) => (bySku.get(x.it.sku!)?.stock ?? 1) > 0)
        .filter((x) => isDue(x.it, x.fp, cfg.refreshDays, now))
      const batch = crm ? due : due.slice(0, cfg.batchSize)
      const skipped = items.length - due.length

      // 3) Frete de cada produto e envio ao Merchant Center.
      const prog = { done: 0, total: batch.length, source: cfg.source }
      this.progress.set(tenantId, prog)
      let sent = 0
      let failed = 0
      let limitedRow = 0
      const cache = new Map<string, Promise<{ price: number; days: number | null }[]>>()
      const pacer = new Pacer(gapOf(cfg.magazordPerMinute))
      const one = async (x: (typeof batch)[number]) => {
        const item = x.it
        try {
          if (crm && x.weight === null) throw new Error(x.weightError ?? 'Sem peso na Magazord.')
          const quotes = crm ? await this.crmQuotes(tenantId, cfg, x.price, x.weight!, x.dims, cache) : await this.magazordQuotes(tenantId, cfg, await this.workingSku(tenantId, cfg, [simulationSku(item.sku!, bySku), item.offerId, item.sku!], x.price, pacer, cache), x.price, pacer, cache)
          const shipping = shippingAttribute(quotes, cfg)
          if (!shipping.length) throw new Error(crm ? 'As tabelas do CRM não calcularam frete para nenhum estado.' : 'A Magazord não calculou frete para nenhum estado.')
          await this.must(tenantId, 'POST', `/products/v1/${acc}/productInputs:insert?dataSource=${encodeURIComponent(cfg.dataSource!)}`, { offerId: item.offerId, contentLanguage: item.contentLanguage, feedLabel: item.feedLabel, productAttributes: { shipping } })
          const stored: StoredQuotes = { ufs: quotes, fp: x.fp }
          await this.prisma.merchantShippingItem.update({ where: { id: item.id }, data: { quotes: stored as unknown as Prisma.InputJsonValue, sentAt: new Date(), error: null } })
          sent++
          limitedRow = 0
        } catch (e) {
          const msg = (e as Error).message.slice(0, 300)
          // Sem acesso ao Merchant Center: para a rodada (os outros dariam o mesmo erro).
          if (/Sem acesso ao Merchant Center/.test(msg)) throw e
          failed++
          if (e instanceof LimitedError) {
            // Limite da Magazord: não mexe no sentAt, para o produto ser o primeiro da próxima rodada.
            limitedRow++
            await this.prisma.merchantShippingItem.update({ where: { id: item.id }, data: { error: msg } })
          } else {
            limitedRow = 0
            await this.prisma.merchantShippingItem.update({ where: { id: item.id }, data: { error: msg, sentAt: new Date() } })
          }
        } finally {
          prog.done++
        }
      }
      if (crm) {
        for (let i = 0; i < batch.length; i += CRM_PARALLEL) await Promise.all(batch.slice(i, i + CRM_PARALLEL).map(one))
      } else {
        for (const x of batch) {
          await one(x)
          if (limitedRow >= PAUSE_AFTER_LIMITED) {
            resumeAt = new Date(Date.now() + RESUME_AFTER_MS).toISOString()
            lastError = `A Magazord limitou as consultas de frete (429) em ${limitedRow} produtos seguidos: a rodada parou em ${prog.done} de ${batch.length} e continua sozinha em 30 minutos (de madrugada) ou na próxima noite. Se repetir, diminua as consultas por minuto.`
            break
          }
        }
      }
      lastSummary = `${prog.done} produto(s) calculado(s) ${crm ? 'pelas tabelas do CRM' : 'na Magazord'}: ${sent} enviado(s), ${failed} com erro${skipped ? `; ${skipped} sem mudança (refeitos a cada ${cfg.refreshDays} dia(s))` : ''}${!crm && due.length > batch.length ? `; ${due.length - batch.length} ficam para as próximas noites` : ''}.`
      this.logger.log(`Frete no Google: ${lastSummary} ${products.length} na conta.`)
    } catch (e) {
      lastError = (e as Error).message.slice(0, 400)
      this.logger.warn(`Frete no Google: ${lastError}`)
    } finally {
      this.running.delete(tenantId)
      this.progress.delete(tenantId)
      const cur = await this.config(tenantId)
      await this.settings.set(tenantId, MERCHANT_KEY, { ...cur, lastRunAt: new Date().toISOString(), lastError, lastSummary: lastSummary ?? cur.lastSummary, resumeAt })
    }
  }

  /** Frete por estado simulado na Magazord, no ritmo do Pacer; 429 espera e tenta de novo (5, 15, 30 e 60 s). */
  private async magazordQuotes(tenantId: string, cfg: MerchantFreteConfig, sku: string, price: number, pacer: Pacer, cache: Map<string, Promise<{ price: number; days: number | null }[]>>) {
    const quotes: UfQuote[] = []
    const errors: string[] = []
    for (const uf of UFS) {
      const perCep: { price: number; days: number | null }[][] = []
      for (const cep of cepsOf(cfg, uf)) {
        // A mesma oferta em outro idioma/país (mesmo SKU e preço) usa a simulação já feita nesta rodada.
        const key = `${sku}|${price}|${cep}`
        let p = cache.get(key)
        if (!p) {
          p = this.simulate(tenantId, sku, price, cep, pacer)
          cache.set(key, p)
          p.catch(() => cache.delete(key))
        }
        try {
          perCep.push(await p)
        } catch (e) {
          // Limite da Magazord (429) adia o produto; erro de um CEP (ex.: "CEP inválido") só tira esse CEP da conta.
          if (e instanceof LimitedError) throw e
          errors.push(`${uf} ${cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}: ${(e as Error).message}`)
        }
      }
      quotes.push(perCep.length ? ufQuote(uf, perCep) : { uf, price: null, days: null })
    }
    if (errors.length) this.logger.warn(`Frete Google (SKU ${sku}): ${errors.length} CEP(s) sem cálculo na Magazord. ${errors.slice(0, 3).join(' | ')}`)
    if (!quotes.some((q) => q.price !== null) && errors.length) throw new Error(errors[0]!.slice(0, 300))
    return quotes
  }

  /**
   * Código que a Magazord aceita na simulação deste produto: tenta o código do produto/derivação, depois o id da
   * oferta e o id interno. A Magazord responde 400 "verifique os parâmetros" quando o código não é o que ela espera.
   */
  private async workingSku(tenantId: string, cfg: MerchantFreteConfig, candidates: (string | null | undefined)[], price: number, pacer: Pacer, cache: Map<string, Promise<{ price: number; days: number | null }[]>>) {
    const list = [...new Set(candidates.map((c) => (c ?? '').trim()).filter(Boolean))]
    const cep = cepsOf(cfg, 'SP')[0] ?? UF_REF_CEP.SP
    const tried: string[] = []
    for (const sku of list) {
      const key = `${sku}|${price}|${cep}`
      let p = cache.get(key)
      if (!p) {
        p = this.simulate(tenantId, sku, price, cep, pacer)
        cache.set(key, p)
        p.catch(() => cache.delete(key))
      }
      try {
        await p
        return sku
      } catch (e) {
        if (e instanceof LimitedError || !/verifique os par[aâ]metros/i.test((e as Error).message)) return sku
        tried.push(sku)
      }
    }
    throw new Error(`A Magazord não simulou o frete com nenhum código do produto (tentados: ${tried.join(', ')}). Confira na Magazord se o produto está ativo, com estoque, peso e medidas.`)
  }

  private async simulate(tenantId: string, sku: string, price: number, cep: string, pacer: Pacer) {
    for (let attempt = 0; ; attempt++) {
      const wait = pacer.take(Date.now())
      if (wait > 0) await sleep(wait)
      try {
        const raw = await this.magazord.simulateFreight(tenantId, cep, [{ sku, quantity: 1, price }], { onRate: (h) => pacer.ok(parseRate(h), Date.now()) })
        return parseFreightOptions(raw).map((o) => ({ price: o.price, days: o.days }))
      } catch (e) {
        if (!(e instanceof MagazordRateLimitError)) throw e
        pacer.limited()
        const ms = retryWait(attempt, parseRate(e.rate))
        if (ms === null) throw new LimitedError('A Magazord limitou as consultas de frete (429) mesmo depois de esperar: este produto fica para a próxima rodada.')
        this.logger.warn(`Magazord 429 na simulação de frete (SKU ${sku}, CEP ${cep}): nova tentativa em ${Math.round(ms / 1000)} s; intervalo agora ${pacer.gap} ms`)
        await sleep(ms)
      }
    }
  }

  /** Frete por estado pelas tabelas de Fretes: em cada CEP a opção mais barata das transportadoras, sem cotação online. */
  private async crmQuotes(tenantId: string, cfg: MerchantFreteConfig, price: number, weight: number, dims: Dims | null, cache: Map<string, Promise<{ price: number; days: number | null }[]>>) {
    const quoteUf = async (uf: Uf) => {
      const perCep = await Promise.all(
        cepsOf(cfg, uf).map((cep) => {
          // Produtos com o mesmo peso, medidas e preço dão o mesmo frete: calcula uma vez por rodada.
          const key = `crm|${cep}|${weight}|${dims ? `${dims.length}x${dims.width}x${dims.height}` : ''}|${price}`
          let p = cache.get(key)
          if (!p) {
            p = this.cotacao.tableResults(tenantId, { unitId: cfg.unitId!, destZip: cep, cargoValue: price, weight, dims }, cfg.carrierIds).then((r) => crmOptions(r, cfg.carrierIds))
            cache.set(key, p)
            p.catch(() => cache.delete(key))
          }
          return p
        }),
      )
      return ufQuote(uf, perCep)
    }
    const quotes: UfQuote[] = []
    for (let i = 0; i < UFS.length; i += 9) quotes.push(...(await Promise.all(UFS.slice(i, i + 9).map(quoteUf))))
    return quotes
  }
}

interface DataSource {
  name: string
  displayName?: string
  primaryProductDataSource?: { defaultRule?: { takeFromDataSources?: { self?: boolean; supplementalDataSourceName?: string; primaryDataSourceName?: string }[] } } & Record<string, unknown>
  supplementalProductDataSource?: Record<string, unknown>
}
