import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt } from '../common/crypto'
import { Prisma } from '../generated/prisma/client'
import { LeadCaptureService } from '../leads/lead-capture.service'
import { LeadConfigService } from '../leads/lead-config.service'
import { PrismaService } from '../prisma/prisma.service'
import { pagePath } from '../rastreamento/origem'
import { RastreamentoService } from '../rastreamento/rastreamento.service'
import { env } from '../config/env'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import type { SeoFields } from './seo'
import { type CartItem, cartEmailItems, cartItems, cleanBaseUrl, cleanHttpsBase, type CustomerData, customerFrom, DEFAULT_CART_MESSAGE, type MagazordPessoa, type MzSiteProduct, mzDateTime, orderGroup, parseMzDate, PRODUCTS_MAX_ATTEMPTS, orderChannel, orderLines, productFrom, seoFromMagazord, seoToMagazord, type MzPage, type MzProductDetail, productsDue, shrinkError, spDay } from './magazord'

export interface MagazordSettings {
  enabled: boolean
  /** Endereço do painel da loja, ex.: https://usaparts.painel.magazord.com.br */
  baseUrl: string
  tokenEnc: string | null
  passwordEnc: string | null
  importCustomers: boolean
  importOrders: boolean
  importCarts: boolean
  /** Catálogo de produtos (nome, preço, imagem e link) para montar e-mails. */
  importProducts: boolean
  /** Hora do dia (horário de Brasília) em que o catálogo é copiado, uma vez por dia. */
  productsHour: number
  /** Id da loja na Magazord (quase sempre 1). */
  storeId: number
  /** Endereço do site, para completar links relativos dos produtos (vazio = descobre pelos carrinhos). */
  siteUrl: string
  /** Endereço das imagens, para completar caminhos relativos (vazio = descobre pelos carrinhos). */
  imageBaseUrl: string
  /** Responsável pelos leads novos vindos da loja. */
  ownerId: string | null
  tags: string[]
  /** Carrinho aberto sem atividade há mais que isso conta como abandonado (a Magazord demora para marcar). */
  abandonHours: number
  /** Mensagem de WhatsApp para recuperar o carrinho e o cupom oferecido. */
  cartMessage: string
  coupon: string
}

export const DEFAULT_MAGAZORD: MagazordSettings = {
  enabled: false,
  baseUrl: '',
  tokenEnc: null,
  passwordEnc: null,
  importCustomers: true,
  importOrders: true,
  importCarts: true,
  importProducts: true,
  productsHour: 3,
  storeId: 1,
  siteUrl: '',
  imageBaseUrl: '',
  ownerId: null,
  tags: ['ecommerce'],
  abandonHours: 2,
  cartMessage: DEFAULT_CART_MESSAGE,
  coupon: '',
}

/** Andamento da sincronização (separado da configuração, para salvar uma não apagar a outra). */
export interface MagazordState {
  running: boolean
  lastRunAt: string | null
  lastOkAt: string | null
  lastError: string | null
  /** Carga inicial de clientes: página atual e se terminou. */
  customersPage: number
  customersBackfillDone: boolean
  customersCursor: string | null
  ordersCursor: string | null
  cartsCursor: string | null
  productsSyncedAt?: string | null
  productsError?: string | null
  /** Tentativas do dia (para tentar de novo depois de uma falha e avisar se não der). */
  productsAttemptAt?: string | null
  productsAttemptDay?: string | null
  productsAttempts?: number
  /** Dia em que o aviso de falha foi enviado (no máximo um por dia). */
  productsAlertDay?: string | null
  totals: { customers: number; leadsCreated: number; orders: number; carts: number; products?: number }
  /** Itens e canal dos pedidos (detalhe de cada pedido): quantos faltam e o último erro. */
  orderItemsPending?: number
  orderItemsError?: string | null
}

export const DEFAULT_STATE: MagazordState = {
  running: false,
  lastRunAt: null,
  lastOkAt: null,
  lastError: null,
  customersPage: 1,
  customersBackfillDone: false,
  customersCursor: null,
  ordersCursor: null,
  cartsCursor: null,
  totals: { customers: 0, leadsCreated: 0, orders: 0, carts: 0 },
}

const SYNC_INTERVAL_MS = 10 * 60_000
const ORIGIN = 'Ecommerce'
/** Histórico de pedidos trazido na primeira sincronização. */
const ORDERS_BACKFILL_DAYS = 730
const CARTS_BACKFILL_DAYS = 30

interface Page<T> {
  items: T[]
  has_more: boolean
}

interface MzOrder {
  id: number | string
  codigo: string
  dataHora: string
  valorTotal: number | string
  pessoaId: number | string | null
  pedidoSituacao: number
  pedidoSituacaoDescricao?: string | null
  formaPagamentoNome?: string | null
  origem?: number | null
  lojaDoMarketplaceNome?: string | null
}

interface MzCart {
  id: number | string
  status: number
  dataInicio?: string | null
  dataAtualizacao?: string | null
  hash?: string | null
  pedido?: { id?: number | null; codigo?: string | null } | null
  draft?: unknown
}

interface MzCartDetail {
  carrinho?: {
    id: number | string
    status?: number
    data_inicio?: string | null
    ultima_atualizacao?: string | null
    pessoa?: { id?: number | string | null; nome?: string | null; email?: string | null; contato_principal?: string | null } | null
    url_checkout?: string | null
    url_acesso?: string | null
    itens?: { codigo_produto?: string | null; quantidade?: number | null; midia_url?: string | null; url_pagina?: string | null }[]
  }
}

class MagazordError extends Error {}

@Injectable()
export class MagazordService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MagazordService.name)
  private timer: NodeJS.Timeout | null = null
  private readonly running = new Set<string>()
  private readonly productsRunning = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly capture: LeadCaptureService,
    private readonly scoring: LeadConfigService,
    private readonly tracking: RastreamentoService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async onApplicationBootstrap() {
    // Sincronização interrompida por reinício: libera para a próxima rodada.
    for (const row of await this.prisma.tenantSetting.findMany({ where: { key: 'magazord_state' } })) {
      if ((row.value as Partial<MagazordState>).running) await this.saveState(row.tenantId, { running: false })
    }
    this.timer = setInterval(() => void this.syncAll(), SYNC_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  config(tenantId: string) {
    return this.settings.get(tenantId, 'magazord', DEFAULT_MAGAZORD)
  }

  save(tenantId: string, s: MagazordSettings) {
    return this.settings.set(tenantId, 'magazord', s)
  }

  state(tenantId: string) {
    return this.settings.get(tenantId, 'magazord_state', DEFAULT_STATE)
  }

  private async saveState(tenantId: string, patch: Partial<MagazordState>) {
    const current = await this.state(tenantId)
    return this.settings.set(tenantId, 'magazord_state', { ...current, ...patch })
  }

  // ---------- Cliente HTTP ----------

  private async get<T>(s: MagazordSettings, path: string, params: Record<string, string | number> = {}, attempt = 0): Promise<T> {
    const base = cleanBaseUrl(s.baseUrl)
    if (!base || !s.tokenEnc || !s.passwordEnc) throw new MagazordError('Integração sem endereço, token ou senha.')
    const url = new URL(`${base}/api${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    const auth = Buffer.from(`${decrypt(s.tokenEnc)}:${decrypt(s.passwordEnc)}`).toString('base64')
    const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(30_000), redirect: 'error' })
    if (res.status === 429 && attempt < 3) {
      // Limite de requisições da Magazord: espera e tenta de novo.
      await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)))
      return this.get(s, path, params, attempt + 1)
    }
    const body = (await res.json().catch(() => null)) as { status?: string; data?: T; message?: string } | null
    if (res.status === 401 || res.status === 403) throw new MagazordError('A Magazord recusou o token/senha ou o usuário não tem permissão para esta consulta.')
    if (!res.ok || !body || body.status === 'error') throw new MagazordError(`Magazord respondeu ${res.status}${body?.message ? `: ${body.message}` : ''}`)
    // Pausa curta entre chamadas, para não sobrecarregar a loja.
    await new Promise((r) => setTimeout(r, 250))
    // As consultas v2 vêm em { status, data }; as v3 devolvem o objeto direto.
    return ('data' in body ? body.data : body) as T
  }

  /**
   * Simulação de frete da loja (POST /v2/site/transporte/simulacao): usa o peso e as medidas cadastrados na Magazord
   * e as tabelas de frete da loja. Só consulta, não cria pedido. Devolve a resposta da Magazord como veio.
   */
  async simulateFreight(tenantId: string, cep: string, items: { sku: string; quantity: number; price: number }[]) {
    const s = await this.config(tenantId)
    if (!s.enabled) throw new MagazordError('Ligue a integração com a Magazord em Configurações › Loja virtual (Magazord).')
    const base = cleanBaseUrl(s.baseUrl)
    if (!base || !s.tokenEnc || !s.passwordEnc) throw new MagazordError('Integração com a Magazord sem endereço, token ou senha.')
    const auth = Buffer.from(`${decrypt(s.tokenEnc)}:${decrypt(s.passwordEnc)}`).toString('base64')
    const body = { cep: cep.replace(/\D/g, ''), consideraRegraFrete: true, loja: s.storeId || 1, produtos: items.map((i) => ({ sku: i.sku, quantidade: i.quantity, valor: i.price })) }
    const res = await fetch(`${base}/api/v2/site/transporte/simulacao`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    const json = (await res.json().catch(() => null)) as { status?: string; data?: unknown; message?: string } | null
    if (res.status === 401 || res.status === 403) throw new MagazordError('A Magazord recusou o token/senha ou o usuário não tem permissão para simular frete.')
    if (!res.ok || !json || json.status === 'error') throw new MagazordError(`A Magazord não calculou o frete (${res.status}${json?.message ? `: ${json.message}` : ''}).`)
    return json.data ?? json
  }

  /** Alteração na Magazord (PATCH), com a mesma autenticação e o mesmo cuidado com o limite de requisições. */
  private async send<T>(s: MagazordSettings, method: 'PATCH' | 'PUT', path: string, body: unknown, attempt = 0): Promise<T> {
    const base = cleanBaseUrl(s.baseUrl)
    if (!base || !s.tokenEnc || !s.passwordEnc) throw new MagazordError('Integração sem endereço, token ou senha.')
    const auth = Buffer.from(`${decrypt(s.tokenEnc)}:${decrypt(s.passwordEnc)}`).toString('base64')
    const res = await fetch(`${base}/api${path}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${auth}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: 'error' })
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)))
      return this.send(s, method, path, body, attempt + 1)
    }
    const out = (await res.json().catch(() => null)) as { status?: string; data?: T; message?: string; errors?: unknown } | null
    if (res.status === 401 || res.status === 403) throw new MagazordError('A Magazord recusou o token/senha ou o usuário não tem permissão para alterar produtos.')
    if (!res.ok || out?.status === 'error') throw new MagazordError(`Magazord respondeu ${res.status}${out?.message ? `: ${out.message}` : ''}`)
    await new Promise((r) => setTimeout(r, 250))
    return out?.data as T
  }

  // ---------- Carrinho abandonado no e-mail (automação) ----------

  /**
   * Carrinho do lead para o e-mail: o do gatilho (quando a automação começou por um carrinho) ou o mais recente com
   * produtos. Itens com foto, preço e link do catálogo; link de volta para o carrinho (ou o site).
   */
  async cartForEmail(tenantId: string, leadId: string, externalId?: string | null) {
    const cart =
      (externalId ? await this.prisma.ecommerceCart.findFirst({ where: { tenantId, leadId, externalId } }) : null) ??
      (await this.prisma.ecommerceCart.findFirst({ where: { tenantId, leadId, itemCount: { gt: 0 } }, orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }] }))
    if (!cart) return null
    const items = (cart.items as unknown as CartItem[]) ?? []
    const codes = [...new Set(items.map((i) => i.code).filter(Boolean))]
    const products = codes.length ? await this.prisma.storeProduct.findMany({ where: { tenantId, code: { in: codes } }, orderBy: { active: 'asc' }, select: { code: true, name: true, image: true, url: true, price: true, priceFrom: true } }) : []
    // Ativos por último: sobrescrevem os inativos do mesmo código.
    const catalog = new Map(products.map((x) => [x.code, { name: x.name, image: x.image, url: x.url, price: x.price === null ? null : Number(x.price), priceFrom: x.priceFrom === null ? null : Number(x.priceFrom) }]))
    const s = await this.config(tenantId)
    const site = cleanHttpsBase(s.siteUrl) ?? (await this.productContext(tenantId, s)).siteUrl
    return {
      externalId: cart.externalId,
      purchased: cart.status === 3 || !!cart.orderCode,
      customerId: cart.customerId,
      productCodes: codes,
      content: { items: cartEmailItems(items, catalog), url: cart.checkoutUrl ?? site ?? null },
    }
  }

  // ---------- SEO do e-commerce ----------

  /**
   * Textos de SEO de um produto, a partir de uma derivação (SKU): aba Descrição Geral (produto x loja) e aba SEO
   * (a página do produto). Também os dados que a IA pode usar (marca, categorias, características, EAN).
   */
  async seoRead(tenantId: string, derivationCode: string) {
    const s = await this.config(tenantId)
    if (!s.enabled) throw new MagazordError('Integração com a Magazord desligada.')
    const storeId = s.storeId || 1
    let code = derivationCode
    let d = await this.detail(s, code)
    // O catálogo pode trazer o código do produto pai (na Usaparts, o da derivação seguido de "P"): busca as
    // derivações dele e lê a primeira.
    const parents = /p$/i.test(derivationCode) ? [derivationCode] : [`${derivationCode}P`, derivationCode]
    for (const parent of parents) {
      if (d) break
      const ders = await this.get<{ codigo?: string | null; ativo?: boolean | null }[] | { codigo?: string | null }>(s, `/v2/site/produto/${encodeURIComponent(parent)}/derivacao`).catch(() => null)
      const list = (Array.isArray(ders) ? ders : ders ? [ders] : []) as { codigo?: string | null; ativo?: boolean | null }[]
      const first = list.find((x) => x?.codigo && x.ativo !== false) ?? list.find((x) => x?.codigo)
      if (first?.codigo && first.codigo !== code) {
        code = first.codigo
        d = await this.detail(s, code)
      }
    }
    if (!d) throw new MagazordError(`Produto ${derivationCode} não encontrado na consulta detalhada da Magazord (resposta: ${this.lastDetailShape || 'vazia'}).`)
    const pages = this.page<MzPage>(await this.get(s, '/v2/site/paginas', { codigoDerivacao: code, id_loja: storeId, limit: 5 }))
    return { storeId, ...seoFromMagazord(d, pages.items[0] ?? null, storeId) }
  }

  private lastDetailShape = ''

  /** GET /v3/produtos/derivacao/{codigo}/detail; aceita a resposta direta, em { data } ou em lista. */
  private async detail(s: MagazordSettings, code: string): Promise<MzProductDetail | null> {
    let raw: unknown
    try {
      raw = await this.get<unknown>(s, `/v3/produtos/derivacao/${encodeURIComponent(code)}/detail`)
    } catch (err) {
      this.lastDetailShape = (err as Error).message.slice(0, 120)
      return null
    }
    let d = Array.isArray(raw) ? raw[0] : raw
    if (d && typeof d === 'object' && !('codigoProduto' in d) && 'data' in d) d = (d as { data: unknown }).data
    if (Array.isArray(d)) d = d[0]
    if (d && typeof d === 'object' && (d as MzProductDetail).codigoProduto) return d as MzProductDetail
    // Para o aviso de erro: só os nomes dos campos que vieram, sem os valores.
    this.lastDetailShape = d && typeof d === 'object' ? `campos ${Object.keys(d).slice(0, 12).join(', ') || 'nenhum'}` : JSON.stringify(raw ?? null).slice(0, 60)
    return null
  }

  /** Grava os textos: página (aba SEO) e produto x loja (Descrição Geral); só os campos informados. */
  async seoWrite(tenantId: string, w: { productCode: string; pageId: number | null; fields: Partial<SeoFields> }) {
    const s = await this.config(tenantId)
    if (!s.enabled) throw new MagazordError('Integração com a Magazord desligada.')
    const storeId = s.storeId || 1
    const { page, product } = seoToMagazord(w.fields, storeId)
    if (page) {
      if (!w.pageId) throw new MagazordError('Este produto ainda não tem a página de SEO criada na Magazord (abra o produto no painel e salve a aba SEO uma vez).')
      await this.send(s, 'PATCH', `/v2/site/paginas/${w.pageId}`, page)
    }
    if (product) await this.send(s, 'PATCH', `/v2/site/produto/${encodeURIComponent(w.productCode)}`, product)
  }

  private page<T>(data: unknown): Page<T> {
    const d = data as { items?: T[] | T; has_more?: boolean } | null
    const items = Array.isArray(d?.items) ? d.items : d?.items ? [d.items] : []
    return { items, has_more: !!d?.has_more }
  }

  /** Botão "Testar conexão": consulta um cliente, um pedido e um carrinho para conferir as permissões. */
  async test(s: MagazordSettings) {
    const checks: { name: string; ok: boolean; message: string }[] = []
    const run = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
        checks.push({ name, ok: true, message: 'OK' })
      } catch (err) {
        checks.push({ name, ok: false, message: (err as Error).message })
      }
    }
    await run('Clientes', () => this.get(s, '/v2/site/pessoa', { limit: 1 }))
    await run('Pedidos', () => this.get(s, '/v2/site/pedido', { limit: 1 }))
    const now = new Date()
    await run('Carrinhos', () => this.get(s, '/v2/site/carrinho', { limit: 1, dataAtualizacaoInicio: mzDateTime(new Date(now.getTime() - 86_400_000)), dataAtualizacaoFim: mzDateTime(now) }))
    if (s.importProducts) await run('Produtos', () => this.get(s, `/v2/site/frontend/produto/${s.storeId || 1}`, { limit: 1, page: 1 }))
    return { ok: checks.every((c) => c.ok), checks }
  }

  // ---------- Sincronização ----------

  async syncAll() {
    for (const row of await this.prisma.tenantSetting.findMany({ where: { key: 'magazord' } })) {
      const s = { ...DEFAULT_MAGAZORD, ...(row.value as Partial<MagazordSettings>) }
      if (s.enabled) await this.sync(row.tenantId).catch(() => undefined)
    }
  }

  /** Uma rodada: clientes, pedidos e carrinhos. Nunca roda duas ao mesmo tempo para a mesma empresa. */
  async sync(tenantId: string) {
    if (this.running.has(tenantId)) return { started: false }
    const s = await this.config(tenantId)
    if (!s.enabled) return { started: false }
    this.running.add(tenantId)
    await this.saveState(tenantId, { running: true, lastRunAt: new Date().toISOString() })
    try {
      if (s.importCustomers) await this.syncCustomers(tenantId, s)
      if (s.importOrders) await this.syncOrders(tenantId, s)
      if (s.importOrders) await this.syncOrderItems(tenantId, s)
      if (s.importCarts) await this.syncCarts(tenantId, s)
      if (s.importProducts) await this.syncProducts(tenantId, s, false)
      await this.saveState(tenantId, { running: false, lastOkAt: new Date().toISOString(), lastError: null })
      return { started: true }
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500)
      this.logger.warn(`Magazord: sincronização falhou: ${msg}`)
      await this.saveState(tenantId, { running: false, lastError: msg })
      throw err
    } finally {
      this.running.delete(tenantId)
    }
  }

  /**
   * Clientes: na primeira vez traz todos (página a página, retomando de onde parou); depois só os
   * cadastrados ou alterados desde a última rodada.
   */
  private async syncCustomers(tenantId: string, s: MagazordSettings) {
    let st = await this.state(tenantId)
    const contacts = 'telefone_principal,telefone_celular'
    if (!st.customersBackfillDone) {
      const startedAt = new Date()
      let page = st.customersPage
      for (;;) {
        const data = this.page<MagazordPessoa>(await this.get(s, '/v2/site/pessoa', { limit: 100, page, orderDirection: 'asc', listaContatos: contacts, listaEnderecos: 1 }))
        let created = 0
        for (const p of data.items) if ((await this.upsertCustomer(tenantId, s, customerFrom(p))).created) created++
        st = await this.saveState(tenantId, {
          customersPage: page + 1,
          totals: { ...st.totals, customers: st.totals.customers + data.items.length, leadsCreated: st.totals.leadsCreated + created },
        })
        if (!data.has_more || !data.items.length) break
        page++
      }
      await this.saveState(tenantId, { customersBackfillDone: true, customersCursor: startedAt.toISOString().slice(0, 10) })
      return
    }
    // A API filtra por dia: busca desde o dia da última rodada (repetir clientes do dia é inofensivo).
    const since = st.customersCursor ?? new Date().toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    for (let page = 1; ; page++) {
      const data = this.page<MagazordPessoa>(await this.get(s, '/v2/site/pessoa', { limit: 100, page, 'dataHoraAtualizacao[gte]': since, listaContatos: contacts, listaEnderecos: 1 }))
      let created = 0
      for (const p of data.items) if ((await this.upsertCustomer(tenantId, s, customerFrom(p))).created) created++
      st = await this.saveState(tenantId, { totals: { ...st.totals, customers: st.totals.customers + data.items.length, leadsCreated: st.totals.leadsCreated + created } })
      if (!data.has_more || !data.items.length) break
    }
    await this.saveState(tenantId, { customersCursor: today })
  }

  /**
   * Cliente da loja vira lead (origem "Ecommerce"). Já ligado antes: só completa dados em branco.
   * Novo: mesma regra da base (e-mail identifica; sem e-mail, telefone) e entra na linha do tempo.
   */
  async upsertCustomer(tenantId: string, s: MagazordSettings, c: CustomerData): Promise<{ leadId: string | null; created: boolean }> {
    const linked = await this.prisma.lead.findFirst({ where: { tenantId, ecommerceId: c.externalId, deletedAt: null }, orderBy: { createdAt: 'asc' } })
    if (linked) {
      if (linked.anonymizedAt) return { leadId: null, created: false }
      const data: Prisma.LeadUncheckedUpdateInput = {}
      if (!linked.name && c.name) data.name = c.name
      if (!linked.phone && c.phone) data.phone = c.phone
      if (!linked.company && c.company) data.company = c.company
      if (!linked.city && c.city) data.city = c.city
      if (!linked.state && c.state) data.state = c.state
      if (!linked.email && c.email && !(await this.prisma.lead.count({ where: { tenantId, email: c.email } }))) data.email = c.email
      if (Object.keys(data).length) await this.prisma.lead.update({ where: { id: linked.id }, data })
      return { leadId: linked.id, created: false }
    }
    const result = await this.capture.capture(tenantId, c, {
      title: 'Cadastrou-se na loja virtual',
      originName: ORIGIN,
      touch: { source: 'ecommerce', medium: 'cadastro', landing: 'Cadastro na loja virtual' },
      details: { clienteLoja: c.externalId },
      ownerId: s.ownerId,
      tags: s.tags,
      occurredAt: c.registeredAt ?? undefined,
    })
    if (!result) return { leadId: null, created: false }
    await this.prisma.lead.update({ where: { id: result.leadId }, data: { ecommerceId: c.externalId } })
    return result
  }

  /** Lead do cliente da loja: pelo vínculo; se ainda não existir, busca o cliente na API e cria. */
  private async leadForCustomer(tenantId: string, s: MagazordSettings, customerId: string | null) {
    if (!customerId) return null
    const linked = await this.prisma.lead.findFirst({ where: { tenantId, ecommerceId: customerId, deletedAt: null }, select: { id: true } })
    if (linked) return linked.id
    try {
      const p = await this.get<MagazordPessoa>(s, `/v2/site/pessoa/${encodeURIComponent(customerId)}`, { listaContatos: 1, listaEnderecos: 1 })
      return (await this.upsertCustomer(tenantId, s, customerFrom(p))).leadId
    } catch (err) {
      this.logger.warn(`Magazord: cliente ${customerId} não encontrado: ${(err as Error).message}`)
      return null
    }
  }

  /** Pedidos: histórico de 2 anos na primeira vez; depois, os alterados desde a última rodada. */
  private async syncOrders(tenantId: string, s: MagazordSettings) {
    let st = await this.state(tenantId)
    const startedAt = new Date()
    const filter: Record<string, string> = st.ordersCursor
      ? { 'dataHoraUltimaAlteracao[gte]': new Date(new Date(st.ordersCursor).getTime() - 5 * 60_000).toISOString().slice(0, 19) + 'Z' }
      : { 'dataHora[gte]': new Date(Date.now() - ORDERS_BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10) }
    for (let page = 1; ; page++) {
      const data = this.page<MzOrder>(await this.get(s, '/v2/site/pedido', { limit: 100, page, orderDirection: 'asc', ...filter }))
      for (const o of data.items) await this.upsertOrder(tenantId, s, o)
      st = await this.saveState(tenantId, { totals: { ...st.totals, orders: st.totals.orders + data.items.length } })
      if (!data.has_more || !data.items.length) break
    }
    await this.saveState(tenantId, { ordersCursor: startedAt.toISOString() })
  }

  /**
   * Itens e canal de venda de cada pedido (consulta do pedido pelo código). Aos poucos: os mais recentes primeiro,
   * até 300 por rodada, para não pesar na loja; a carga dos 2 anos termina em algumas rodadas.
   */
  private async syncOrderItems(tenantId: string, s: MagazordSettings) {
    const todo = await this.prisma.ecommerceOrder.findMany({ where: { tenantId, itemsAt: null }, orderBy: { orderedAt: 'desc' }, take: 300, select: { id: true, code: true } })
    let error: string | null = null
    for (const o of todo) {
      try {
        const d = await this.get<Record<string, unknown>>(s, `/v2/site/pedido/${encodeURIComponent(o.code)}`)
        const lines = orderLines(d)
        await this.prisma.$transaction([
          this.prisma.ecommerceOrderItem.deleteMany({ where: { orderId: o.id } }),
          this.prisma.ecommerceOrderItem.createMany({ data: lines.map((l) => ({ tenantId, orderId: o.id, ...l })) }),
          this.prisma.ecommerceOrder.update({ where: { id: o.id }, data: { itemsAt: new Date(), channel: orderChannel(d) } }),
        ])
      } catch (err) {
        const msg = (err as Error).message
        // Pedido que a Magazord não acha mais: marca como lido (sem itens) para não tentar para sempre.
        if (/respondeu 404/.test(msg)) await this.prisma.ecommerceOrder.update({ where: { id: o.id }, data: { itemsAt: new Date() } })
        else {
          error = `Pedido ${o.code}: ${msg}`.slice(0, 300)
          break
        }
      }
    }
    const pending = await this.prisma.ecommerceOrder.count({ where: { tenantId, itemsAt: null } })
    await this.saveState(tenantId, { orderItemsPending: pending, orderItemsError: error })
  }

  private async upsertOrder(tenantId: string, s: MagazordSettings, o: MzOrder) {
    const externalId = String(o.id)
    const statusCode = Number(o.pedidoSituacao) || 0
    const group = orderGroup(statusCode)
    const total = Math.round((Number(o.valorTotal) || 0) * 100) / 100
    const orderedAt = parseMzDate(o.dataHora) ?? new Date()
    const customerId = o.pessoaId ? String(o.pessoaId) : null
    const before = await this.prisma.ecommerceOrder.findUnique({ where: { tenantId_externalId: { tenantId, externalId } } })
    const leadId = before?.leadId ?? (await this.leadForCustomer(tenantId, s, customerId))
    const data = {
      code: String(o.codigo ?? externalId).slice(0, 60),
      leadId,
      customerId,
      orderedAt,
      total,
      statusCode,
      statusName: (o.pedidoSituacaoDescricao ?? `Situação ${statusCode}`).slice(0, 80),
      statusGroup: group,
      payment: o.formaPagamentoNome?.slice(0, 80) ?? null,
      // A lista só traz o marketplace; o detalhe (itens) completa com a origem.
      ...(before?.itemsAt ? {} : { channel: orderChannel(o) }),
    }
    await this.prisma.ecommerceOrder.upsert({ where: { tenantId_externalId: { tenantId, externalId } }, create: { tenantId, externalId, ...data }, update: data })
    // Carrinho que virou este pedido: comprado.
    await this.prisma.ecommerceCart.updateMany({ where: { tenantId, orderCode: data.code, status: { not: 3 } }, data: { status: 3 } })

    if (!leadId || group !== 'pago' || before?.statusGroup === 'pago') return
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead || lead.anonymizedAt) return
    const update: Prisma.LeadUncheckedUpdateInput = {
      stage: 'CLIENTE',
      lastActivityAt: !lead.lastActivityAt || lead.lastActivityAt < orderedAt ? orderedAt : lead.lastActivityAt,
      tags: lead.tags.filter((t) => t !== 'checkout-iniciado' && t !== 'carrinho-abandonado'),
      events: {
        create: {
          tenantId,
          type: 'venda',
          title: `Comprou na loja virtual: pedido ${data.code} — ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
          data: { pedido: data.code, valor: total, situacao: data.statusName, pagamento: data.payment } as Prisma.InputJsonValue,
          occurredAt: orderedAt,
        },
      },
    }
    if (!lead.lastSaleAt || lead.lastSaleAt <= orderedAt) {
      update.lastSaleAt = orderedAt
      update.lastSaleValue = total
    }
    await this.prisma.lead.update({ where: { id: leadId }, data: update })
    // Recuperou um carrinho que a equipe tinha contatado.
    await this.prisma.ecommerceCart.updateMany({ where: { tenantId, leadId, contactStatus: 'CONTATADO', lastActivityAt: { lte: orderedAt } }, data: { contactStatus: 'RECUPERADO' } })
    await this.scoring.rescore(tenantId, [leadId])
  }

  /** Carrinhos com cliente identificado, atualizados desde a última rodada (30 dias na primeira vez). */
  private async syncCarts(tenantId: string, s: MagazordSettings) {
    let st = await this.state(tenantId)
    const now = new Date()
    const from = st.cartsCursor ? new Date(new Date(st.cartsCursor).getTime() - 5 * 60_000) : new Date(now.getTime() - CARTS_BACKFILL_DAYS * 86_400_000)
    for (let page = 1; ; page++) {
      const data = this.page<MzCart>(
        await this.get(s, '/v2/site/carrinho', {
          limit: 100,
          page,
          dataAtualizacaoInicio: mzDateTime(from),
          dataAtualizacaoFim: mzDateTime(now),
          pessoaRelacionada: 'S',
          status: '1,2,3',
        }),
      )
      for (const c of data.items) await this.upsertCart(tenantId, s, c)
      st = await this.saveState(tenantId, { totals: { ...st.totals, carts: st.totals.carts + data.items.length } })
      if (!data.has_more || !data.items.length) break
    }
    await this.saveState(tenantId, { cartsCursor: now.toISOString() })
    await this.markAbandoned(tenantId, s)
  }

  private async upsertCart(tenantId: string, s: MagazordSettings, c: MzCart) {
    const externalId = String(c.id)
    const detail = await this.get<MzCartDetail>(s, `/v2/site/carrinho/${encodeURIComponent(externalId)}/itens`).catch(() => null)
    const cart = detail?.carrinho
    const pessoa = cart?.pessoa ?? null
    const items = cartItems(cart?.itens)
    const customerId = pessoa?.id ? String(pessoa.id) : null
    let leadId = await this.leadForCustomer(tenantId, s, customerId)
    // Cliente não encontrado pelo id (ex.: usuário sem permissão de consultar clientes): usa os dados do próprio carrinho.
    if (!leadId && pessoa?.email) {
      const c = customerFrom({ id: customerId ?? '', nome: pessoa.nome, email: pessoa.email, pessoaContato: [{ contato: pessoa.contato_principal }] })
      leadId = customerId
        ? (await this.upsertCustomer(tenantId, s, c)).leadId
        : ((await this.capture.capture(tenantId, c, { title: 'Iniciou um carrinho na loja virtual', originName: ORIGIN, touch: { source: 'ecommerce', medium: 'carrinho' }, ownerId: s.ownerId, tags: s.tags }))?.leadId ?? null)
    }
    const status = Number(c.status ?? cart?.status) || 1
    const lastActivityAt = parseMzDate(c.dataAtualizacao ?? cart?.ultima_atualizacao) ?? new Date()
    const before = await this.prisma.ecommerceCart.findUnique({ where: { tenantId_externalId: { tenantId, externalId } } })
    const data = {
      hash: c.hash?.slice(0, 100) ?? null,
      status,
      leadId,
      customerId,
      customerName: pessoa?.nome?.slice(0, 160) ?? null,
      customerEmail: pessoa?.email?.trim().toLowerCase().slice(0, 200) ?? null,
      customerPhone: customerFrom({ id: 0, pessoaContato: [{ contato: pessoa?.contato_principal }] }).phone,
      startedAt: parseMzDate(c.dataInicio ?? cart?.data_inicio),
      lastActivityAt,
      checkoutStarted: !!c.draft || before?.checkoutStarted === true,
      checkoutUrl: cart?.url_checkout && /^https:\/\//.test(cart.url_checkout) ? cart.url_checkout.slice(0, 500) : null,
      items: items as unknown as Prisma.InputJsonValue,
      itemCount: items.reduce((n, i) => n + i.qty, 0),
      orderCode: c.pedido?.codigo ? String(c.pedido.codigo).slice(0, 60) : null,
      ...(status === 3 && before?.contactStatus === 'CONTATADO' ? { contactStatus: 'RECUPERADO' } : {}),
    }
    await this.prisma.ecommerceCart.upsert({ where: { tenantId_externalId: { tenantId, externalId } }, create: { tenantId, externalId, ...data }, update: data })
    if (leadId && data.checkoutStarted && status !== 3) await this.tracking.tagLead(leadId, ['checkout-iniciado'], [])
  }

  /**
   * Carrinho abandonado: a Magazord marcou (status 2) ou está aberto sem atividade há mais que o prazo.
   * Entra uma vez na linha do tempo do lead e o lead ganha a tag "carrinho-abandonado" (base para campanhas).
   */
  private async markAbandoned(tenantId: string, s: MagazordSettings) {
    const limit = new Date(Date.now() - s.abandonHours * 3_600_000)
    const carts = await this.prisma.ecommerceCart.findMany({
      where: { tenantId, leadId: { not: null }, OR: [{ status: 2 }, { status: 1, lastActivityAt: { lt: limit } }], itemCount: { gt: 0 } },
      select: { id: true, leadId: true, items: true, lastActivityAt: true, externalId: true },
    })
    for (const c of carts) {
      const already = await this.prisma.leadEvent.count({ where: { leadId: c.leadId!, type: 'carrinho_abandonado', data: { path: ['carrinho'], equals: c.externalId } } })
      if (already) continue
      const names = ((c.items as unknown as { name: string }[]) ?? []).map((i) => i.name)
      await this.prisma.leadEvent.create({
        data: {
          tenantId,
          leadId: c.leadId!,
          type: 'carrinho_abandonado',
          title: `Abandonou o carrinho: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` e mais ${names.length - 3}` : ''}`.slice(0, 300),
          data: { carrinho: c.externalId, itens: c.items } as Prisma.InputJsonValue,
          occurredAt: c.lastActivityAt ?? new Date(),
        },
      })
      await this.tracking.tagLead(c.leadId!, ['carrinho-abandonado'], [])
    }
  }

  // ---------- Catálogo de produtos ----------

  /**
   * Site e servidor de imagens para completar links relativos: o que estiver configurado ou, se vazio,
   * o endereço que a própria Magazord usa nos itens dos carrinhos já importados.
   */
  private async productContext(tenantId: string, s: MagazordSettings) {
    let siteUrl = cleanHttpsBase(s.siteUrl)
    let imageBase = cleanHttpsBase(s.imageBaseUrl)
    if (!siteUrl || !imageBase) {
      const carts = await this.prisma.ecommerceCart.findMany({ where: { tenantId, itemCount: { gt: 0 } }, orderBy: { lastActivityAt: 'desc' }, take: 20, select: { items: true } })
      for (const item of carts.flatMap((c) => (c.items as unknown as { image?: string | null; url?: string | null }[]) ?? [])) {
        try {
          if (!siteUrl && item.url) siteUrl = new URL(item.url).origin
          if (!imageBase && item.image) imageBase = new URL(item.image).origin
        } catch {
          /* item sem endereço válido */
        }
      }
    }
    return { siteUrl, imageBase }
  }

  /** Catálogo completo (1 vez por dia, de madrugada, ou quando pedido). Erro aqui não interrompe clientes, pedidos e carrinhos. */
  private async syncProducts(tenantId: string, s: MagazordSettings, force: boolean) {
    // Marca como "atualizando" antes de qualquer espera: a tela consulta logo depois do clique.
    if (this.productsRunning.has(tenantId)) return
    this.productsRunning.add(tenantId)
    const started = new Date()
    try {
      const st = await this.state(tenantId)
      if (!force && !productsDue(started, st, s.productsHour ?? 3)) return
      const today = spDay(started)
      const attempts = st.productsAttemptDay === today ? (st.productsAttempts ?? 0) + 1 : 1
      await this.saveState(tenantId, { productsAttemptAt: started.toISOString(), productsAttemptDay: today, productsAttempts: attempts })
      const activeBefore = await this.prisma.storeProduct.count({ where: { tenantId, active: true } })
      const ctx = await this.productContext(tenantId, s)
      let count = 0
      for (let page = 1; page <= 1000; page++) {
        const { items, has_more } = this.page<MzSiteProduct>(await this.get(s, `/v2/site/frontend/produto/${s.storeId || 1}`, { page, limit: 100 }))
        for (const raw of items) {
          const p = productFrom(raw, ctx)
          if (!p) continue
          const data = { code: p.code, name: p.name, brand: p.brand, price: p.price, priceFrom: p.priceFrom, stock: p.stock, image: p.image, url: p.url, path: pagePath(p.url), active: p.active, syncedAt: started }
          await this.prisma.storeProduct.upsert({ where: { tenantId_externalId: { tenantId, externalId: p.externalId } }, create: { tenantId, externalId: p.externalId, ...data }, update: data })
          count++
        }
        if (!has_more || !items.length) break
      }
      const shrink = shrinkError(count, activeBefore, force)
      if (shrink) throw new Error(shrink)
      // Produto que saiu da loja fica fora da busca (o e-mail que já usou continua com os dados copiados).
      await this.prisma.storeProduct.updateMany({ where: { tenantId, syncedAt: { lt: started } }, data: { active: false } })
      const fresh = await this.state(tenantId)
      await this.saveState(tenantId, { productsSyncedAt: started.toISOString(), productsError: null, productsAttempts: 0, totals: { ...fresh.totals, products: count } })
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500)
      this.logger.warn(`Magazord: catálogo de produtos falhou: ${msg}`)
      await this.saveState(tenantId, { productsError: msg })
      // Última tentativa automática do dia: avisa os administradores, no máximo uma vez por dia (no botão, o erro aparece na tela).
      const st = await this.state(tenantId)
      const today = spDay(started)
      if (!force && st.productsAlertDay !== today && (st.productsAttempts ?? 0) >= PRODUCTS_MAX_ATTEMPTS) {
        await this.saveState(tenantId, { productsAlertDay: today })
        void this.alertProducts(tenantId, msg).catch((e: unknown) => this.logger.warn(`Aviso de falha do catálogo não enviado: ${(e as Error).message}`))
      }
    } finally {
      this.productsRunning.delete(tenantId)
    }
  }

  /** E-mail para os administradores: o catálogo não foi copiado hoje (preços e estoque podem estar desatualizados). */
  private async alertProducts(tenantId: string, error: string) {
    const [admins, branding] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId, active: true, role: { isSystem: true } }, select: { email: true, name: true } }),
      this.settings.branding(tenantId),
    ])
    const link = `${env.appUrl}/catalogo`
    const body = `A cópia diária do catálogo de produtos da Magazord falhou ${PRODUCTS_MAX_ATTEMPTS} vezes hoje. Os preços, o estoque e os produtos dos e-mails continuam como na última cópia. Motivo: ${error}`
    for (const a of admins) {
      await this.mail.send(tenantId, {
        to: a.email,
        subject: `Catálogo da Magazord não atualizado - ${branding.appName}`,
        text: `Olá, ${a.name}.\n\n${body}\n\nConfira a integração em Configurações → Integrações → Magazord ou tente de novo em Catálogo → Atualizar agora.\n\n${link}`,
        html: this.mail.simpleTemplate(branding, {
          title: 'Catálogo da Magazord não atualizado',
          greeting: `Olá, ${a.name}.`,
          body: `${body}. Confira a integração em Configurações → Integrações → Magazord ou tente de novo em Catálogo → Atualizar agora.`,
          buttonLabel: 'Abrir o catálogo',
          buttonUrl: link,
          footnote: 'Aviso automático do CRM, enviado no máximo uma vez por dia.',
        }),
      })
    }
  }

  /** Botão "Atualizar catálogo" do e-mail marketing (em segundo plano). */
  async refreshProducts(tenantId: string) {
    const s = await this.config(tenantId)
    if (!s.enabled || !s.importProducts) return { started: false, reason: 'Ligue a integração com a Magazord e a opção “Catálogo de produtos” em Configurações → Integrações.' }
    if (this.productsRunning.has(tenantId)) return { started: false, reason: 'O catálogo já está sendo atualizado.' }
    void this.syncProducts(tenantId, s, true)
    return { started: true, reason: null }
  }

  productsUpdating(tenantId: string) {
    return this.productsRunning.has(tenantId)
  }

  async logSync(tenantId: string, userId: string, userEmail: string) {
    await this.audit.log({ tenantId, userId, userEmail, action: 'magazord.sync_requested', entity: 'settings', entityId: 'magazord' })
  }
}
