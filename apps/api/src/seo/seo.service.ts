import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { EmailAiService } from '../email/ia.service'
import { Prisma } from '../generated/prisma/client'
import { DEFAULT_MAGAZORD, MagazordService, type MagazordSettings } from '../integracoes/magazord.service'
import { changedFields, cleanSeoFields, parseSeoAnswer, SEO_FIELDS, type SeoField, type SeoFields, seoPrompt, seoScore, seoSystem } from '../integracoes/seo'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'

type Job = { kind: 'analise' | 'ia' | 'envio'; total: number; done: number; errors: number; startedAt: string; by: string | null; lastError: string | null }

const TICK_MS = 30 * 60_000
/** Produto analisado há mais que isso é lido de novo (os textos podem ter mudado no painel da Magazord). */
const STALE_MS = 7 * 86_400_000
/** Produtos lidos por rodada automática (o botão Analisar catálogo lê todos os pendentes). */
const ANALYZE_PER_RUN = 300
/** Produto que deu erro na leitura só é tentado de novo depois deste tempo, para não travar a fila. */
const RETRY_FAILED_MS = 86_400_000
const MAX_BATCH = 50
/** Pausa entre as chamadas da IA gratuita (Gemini tem limite de pedidos por minuto). */
const AI_GAP_MS = 4_500
const SENDABLE = new Set<string>(SEO_FIELDS.map((f) => f.key))

/** Período usado para "mais vendidos" e "mais vistos". */
const POPULAR_DAYS = 90
const POPULAR_CACHE_MS = 10 * 60_000

type Popularity = { sold: number; views: number }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref())

/**
 * SEO do e-commerce: lê os textos de SEO dos produtos da Magazord, dá uma nota, sugere melhorias com a IA gratuita
 * (Gemini) e, depois da revisão de uma pessoa, grava na loja. Guarda o texto anterior de cada envio para desfazer.
 */
@Injectable()
export class SeoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SeoService.name)
  private timer: NodeJS.Timeout | null = null
  /** Tarefa de IA ou envio em andamento, por empresa (uma por vez). */
  private readonly jobs = new Map<string, Job>()
  /** Análise do catálogo em andamento, por empresa; roda junto com a IA e o envio. */
  private readonly analyses = new Map<string, Job>()
  /** Vendas e visitas dos últimos 90 dias por produto de SEO, guardadas por alguns minutos. */
  private readonly popularCache = new Map<string, { at: number; byId: Map<string, Popularity> }>()
  /** Derivações que deram erro na leitura, por empresa (código → quando falhou). */
  private readonly failed = new Map<string, Map<string, number>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly magazord: MagazordService,
    private readonly ai: EmailAiService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'seo_ecommerce', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  private async store(tenantId: string) {
    return { ...DEFAULT_MAGAZORD, ...(await this.settings.get<Partial<MagazordSettings>>(tenantId, 'magazord', {})) }
  }

  /** A cada 30 minutos: continua a análise do catálogo de quem tem a Magazord ligada (aos poucos). */
  async tick() {
    const rows = await this.prisma.tenantSetting.findMany({ where: { key: 'magazord' }, select: { tenantId: true, value: true } })
    for (const r of rows) {
      const s = { ...DEFAULT_MAGAZORD, ...(r.value as Partial<MagazordSettings>) }
      if (!s.enabled || !s.importProducts || this.analyses.get(r.tenantId)) continue
      await this.analyze(r.tenantId, null).catch((err: unknown) => this.logger.warn(`SEO: análise falhou: ${(err as Error).message}`))
    }
  }

  // ---------- Leitura ----------

  /** Lê (de novo) o produto na Magazord e grava os textos, a nota e os problemas. */
  private async read(tenantId: string, derivationCode: string) {
    const r = await this.magazord.seoRead(tenantId, derivationCode)
    const { score, issues } = seoScore(r.fields)
    const data = {
      derivationCode,
      name: r.name || derivationCode,
      brand: r.brand,
      categories: r.categories,
      attributes: r.attributes as unknown as Prisma.InputJsonValue,
      ean: r.ean,
      image: r.image,
      pageId: r.pageId,
      fields: r.fields as unknown as Prisma.InputJsonValue,
      score,
      issues: issues as unknown as Prisma.InputJsonValue,
      checkedAt: new Date(),
      error: null,
    }
    const prev = await this.prisma.seoProduct.findUnique({ where: { tenantId_productCode: { tenantId, productCode: r.productCode } }, select: { derivations: true } })
    return this.prisma.seoProduct.upsert({
      where: { tenantId_productCode: { tenantId, productCode: r.productCode } },
      create: { tenantId, productCode: r.productCode, derivations: [derivationCode], ...data },
      update: { ...data, derivations: [...new Set([...(prev?.derivations ?? []), derivationCode])].slice(0, 200) },
    })
  }

  /**
   * Análise do catálogo: lê na Magazord os produtos ainda não analisados (ou analisados há mais de 7 dias), um por
   * vez. Cada produto pai entra uma vez, mesmo com várias derivações.
   */
  async analyze(tenantId: string, by: string | null, all = false) {
    if (this.analyses.get(tenantId)) return this.analyses.get(tenantId)!
    const fresh = new Date(Date.now() - STALE_MS)
    const known = await this.prisma.seoProduct.findMany({ where: { tenantId, checkedAt: { gte: fresh } }, select: { derivations: true } })
    const done = new Set(known.flatMap((k) => k.derivations))
    const catalog = await this.catalogByPopularity(tenantId)
    const failed = this.failed.get(tenantId) ?? new Map<string, number>()
    this.failed.set(tenantId, failed)
    const retryBefore = Date.now() - RETRY_FAILED_MS
    const pending = catalog.filter((c) => !done.has(c) && !((failed.get(c) ?? 0) > retryBefore))
    const todo = all ? pending : pending.slice(0, ANALYZE_PER_RUN)
    const job: Job = { kind: 'analise', total: todo.length, done: 0, errors: 0, startedAt: new Date().toISOString(), by, lastError: null }
    if (!todo.length) return job
    this.analyses.set(tenantId, job)
    void (async () => {
      try {
        for (const code of todo) {
          if (done.has(code)) {
            job.done++
            continue
          }
          try {
            const p = await this.read(tenantId, code)
            for (const d of p.derivations) done.add(d)
            failed.delete(code)
          } catch (err) {
            failed.set(code, Date.now())
            job.errors++
            job.lastError = `${code}: ${(err as Error).message}`.slice(0, 300)
          }
          job.done++
        }
      } finally {
        this.analyses.delete(tenantId)
        this.popularCache.delete(tenantId)
      }
    })()
    return job
  }

  /** Códigos do catálogo ativo, os mais vendidos e mais vistos (90 dias) primeiro, depois por nome. */
  private async catalogByPopularity(tenantId: string): Promise<string[]> {
    const since = new Date(Date.now() - POPULAR_DAYS * 86_400_000)
    const rows = await this.prisma.$queryRaw<{ code: string }[]>`
      WITH sold AS (
        SELECT i.sku, sum(i.quantity) AS q FROM ecommerce_order_items i JOIN ecommerce_orders o ON o.id = i."orderId"
        WHERE i."tenantId" = ${tenantId}::uuid AND o."orderedAt" >= ${since} AND o."statusGroup" = 'pago' AND i.sku IS NOT NULL
        GROUP BY i.sku),
      pv AS (
        SELECT path, count(*) AS n FROM site_pageviews
        WHERE "tenantId" = ${tenantId}::uuid AND "occurredAt" >= ${since} AND path IS NOT NULL GROUP BY path)
      SELECT sp.code FROM store_products sp
      LEFT JOIN sold ON sold.sku = sp.code
      LEFT JOIN pv ON pv.path = sp.path
      WHERE sp."tenantId" = ${tenantId}::uuid AND sp.active AND sp.code <> ''
      GROUP BY sp.code
      ORDER BY coalesce(max(sold.q), 0) DESC, coalesce(max(pv.n), 0) DESC, min(sp.name)`
    return rows.map((r) => r.code)
  }

  /** Vendas pagas e visitas à página nos últimos 90 dias de cada produto de SEO (todas as derivações dele). */
  private async popularity(tenantId: string): Promise<Map<string, Popularity>> {
    const hit = this.popularCache.get(tenantId)
    if (hit && Date.now() - hit.at < POPULAR_CACHE_MS) return hit.byId
    const since = new Date(Date.now() - POPULAR_DAYS * 86_400_000)
    const rows = await this.prisma.$queryRaw<{ id: string; sold: bigint | number | null; views: bigint | number | null }[]>`
      WITH sold AS (
        SELECT i.sku, sum(i.quantity) AS q FROM ecommerce_order_items i JOIN ecommerce_orders o ON o.id = i."orderId"
        WHERE i."tenantId" = ${tenantId}::uuid AND o."orderedAt" >= ${since} AND o."statusGroup" = 'pago' AND i.sku IS NOT NULL
        GROUP BY i.sku),
      pv AS (
        SELECT path, count(*) AS n FROM site_pageviews
        WHERE "tenantId" = ${tenantId}::uuid AND "occurredAt" >= ${since} AND path IS NOT NULL GROUP BY path),
      paths AS (SELECT DISTINCT code, path FROM store_products WHERE "tenantId" = ${tenantId}::uuid AND path IS NOT NULL)
      SELECT p.id,
        (SELECT sum(sold.q) FROM sold WHERE sold.sku = ANY(p.derivations) OR sold.sku = p."productCode") AS sold,
        (SELECT sum(pv.n) FROM pv WHERE pv.path IN (SELECT paths.path FROM paths WHERE paths.code = ANY(p.derivations))) AS views
      FROM seo_products p WHERE p."tenantId" = ${tenantId}::uuid`
    const byId = new Map(rows.map((r) => [r.id, { sold: Number(r.sold ?? 0), views: Number(r.views ?? 0) }]))
    this.popularCache.set(tenantId, { at: Date.now(), byId })
    return byId
  }

  async startAnalysis(user: AuthUser) {
    this.assertCan(user, 'view')
    const s = await this.store(user.tenantId)
    if (!s.enabled) throw new BadRequestException('Ligue a integração com a Magazord em Configurações › Loja virtual (Magazord).')
    const job = await this.analyze(user.tenantId, user.name, true)
    return { job, message: job.total ? `Analisando ${job.total} produto(s) da loja. Os resultados aparecem conforme ficam prontos.` : 'Todos os produtos do catálogo já foram analisados nos últimos 7 dias.' }
  }

  // ---------- Telas ----------

  async list(user: AuthUser, q: { search?: string; issue?: string; maxScore?: number; page?: number; order?: string }) {
    this.assertCan(user, 'view')
    const T = user.tenantId
    const where: Prisma.SeoProductWhereInput = { tenantId: T }
    const s = q.search?.trim()
    if (s) where.OR = [{ name: { contains: s, mode: 'insensitive' } }, { productCode: { contains: s, mode: 'insensitive' } }, { derivations: { has: s } }, { brand: { contains: s, mode: 'insensitive' } }]
    if (q.maxScore !== undefined && Number.isFinite(q.maxScore)) where.score = { lte: q.maxScore }
    if (q.issue && SENDABLE.has(q.issue)) where.issues = { array_contains: [{ field: q.issue }] }
    const page = Math.max(1, q.page ?? 1)
    const popular = await this.popularity(T)
    const include = { changes: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { id: true, status: true, createdAt: true } } }
    const byPopularity = q.order === 'vendidos' || q.order === 'vistos'
    const pageRows = async () => {
      if (!byPopularity) {
        return this.prisma.seoProduct.findMany({
          where,
          orderBy: q.order === 'nome' ? { name: 'asc' } : q.order === 'nota_desc' ? { score: 'desc' } : [{ score: 'asc' }, { name: 'asc' }],
          skip: (page - 1) * 50,
          take: 50,
          include,
        })
      }
      // Mais vendidos / mais vistos: ordena todos os que passam no filtro e busca só a página pedida.
      const all = await this.prisma.seoProduct.findMany({ where, select: { id: true, score: true } })
      const key = (id: string) => popular.get(id) ?? { sold: 0, views: 0 }
      const a = q.order === 'vendidos' ? 'sold' : 'views'
      const b = a === 'sold' ? 'views' : 'sold'
      const ids = all.sort((x, y) => key(y.id)[a] - key(x.id)[a] || key(y.id)[b] - key(x.id)[b] || x.score - y.score).slice((page - 1) * 50, page * 50).map((r) => r.id)
      const found = await this.prisma.seoProduct.findMany({ where: { id: { in: ids } }, include })
      return ids.map((id) => found.find((f) => f.id === id)).filter((r) => !!r)
    }
    const [total, rows, stats, catalog, dups, pending] = await Promise.all([
      this.prisma.seoProduct.count({ where }),
      pageRows(),
      this.prisma.seoProduct.aggregate({ where: { tenantId: T }, _count: true, _avg: { score: true } }),
      this.prisma.storeProduct.findMany({ where: { tenantId: T, active: true }, distinct: ['code'], select: { code: true } }).then((r) => r.length),
      this.prisma.$queryRaw<{ title: string }[]>`
        SELECT lower(fields->>'seoTitle') AS title FROM seo_products
        WHERE "tenantId" = ${T}::uuid AND coalesce(fields->>'seoTitle', '') <> '' GROUP BY 1 HAVING count(*) > 1`,
      this.prisma.seoChange.count({ where: { tenantId: T, status: 'SUGERIDA' } }),
    ])
    const dup = new Set(dups.map((d) => d.title))
    const below = await this.prisma.seoProduct.count({ where: { tenantId: T, score: { lt: 60 } } })
    return {
      total,
      page,
      stats: { analyzed: stats._count, catalog, avgScore: stats._avg.score === null ? null : Math.round(stats._avg.score), below60: below, pending },
      job: this.jobs.get(T) ?? null,
      analysis: this.analyses.get(T) ?? null,
      popularDays: POPULAR_DAYS,
      fields: SEO_FIELDS,
      items: rows.map((r) => {
        const f = r.fields as unknown as SeoFields
        const duplicate = !!f.seoTitle && dup.has(f.seoTitle.toLowerCase())
        const { score, issues } = seoScore(f, duplicate)
        return { id: r.id, productCode: r.productCode, derivationCode: r.derivationCode, name: r.name, brand: r.brand, image: r.image, score, issues, seoTitle: f.seoTitle, metaDescription: f.metaDescription, url: f.url, checkedAt: r.checkedAt, error: r.error, lastChange: r.changes[0] ?? null, ...(popular.get(r.id) ?? { sold: 0, views: 0 }) }
      }),
    }
  }

  private async load(user: AuthUser, id: string) {
    const p = await this.prisma.seoProduct.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!p) throw new NotFoundException('Produto não encontrado.')
    return p
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const p = await this.load(user, id)
    const changes = await this.prisma.seoChange.findMany({ where: { seoProductId: id }, orderBy: { createdAt: 'desc' }, take: 20 })
    const s = await this.store(user.tenantId)
    return { ...p, ...seoScore(p.fields as unknown as SeoFields), siteUrl: s.siteUrl || null, aiAvailable: await this.ai.available(user.tenantId), changes }
  }

  /** Lê de novo na Magazord (alguém pode ter mudado no painel). */
  async refresh(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const p = await this.load(user, id)
    try {
      await this.read(user.tenantId, p.derivationCode)
    } catch (err) {
      throw new BadRequestException(`Não foi possível ler o produto na Magazord: ${(err as Error).message}`)
    }
    return this.get(user, id)
  }

  // ---------- Sugestões (IA e manual) ----------

  private async aiSystem(tenantId: string) {
    if (!(await this.ai.available(tenantId))) throw new BadRequestException('Para usar a IA, cadastre a chave do Gemini em Configurações › E-mail marketing (é gratuita no Google AI Studio).')
    const b = await this.settings.branding(tenantId)
    return seoSystem(b.shortName || b.appName, await this.ai.about(tenantId))
  }

  /** Lê o produto atualizado, pede a sugestão à IA e grava como "para revisar". */
  private async suggestOne(user: AuthUser, id: string, system: string, instruction: string) {
    const stored = await this.load(user, id)
    const p = await this.read(user.tenantId, stored.derivationCode).catch(() => stored)
    const current = p.fields as unknown as SeoFields
    const facts = { name: p.name, code: p.derivationCode, brand: p.brand, categories: p.categories, attributes: (p.attributes as { name: string; value: string }[]) ?? [], ean: p.ean }
    const answer = parseSeoAnswer(await this.ai.complete(user.tenantId, system, seoPrompt(facts, current, instruction), 4000))
    if (!answer) throw new Error('a IA não respondeu no formato esperado')
    // URL e palavras de busca só vão se a pessoa marcar (mudar a URL pode perder posição; as palavras atuais não são informadas).
    const send = changedFields(current, answer).filter((k) => k !== 'url' && k !== 'searchKeywords')
    await this.prisma.seoChange.updateMany({ where: { seoProductId: p.id, status: 'SUGERIDA' }, data: { status: 'DESCARTADA' } })
    return this.prisma.seoChange.create({ data: { tenantId: user.tenantId, seoProductId: p.id, before: current as unknown as Prisma.InputJsonValue, proposed: { ...current, ...answer } as unknown as Prisma.InputJsonValue, sendFields: send, source: 'ia', createdById: user.id, createdByName: user.name.slice(0, 120) } })
  }

  /** Um produto: devolve a sugestão na hora. Vários: em segundo plano, um por vez (limite da IA gratuita). */
  async suggest(user: AuthUser, ids: string[], instruction = '') {
    this.assertCan(user, 'create')
    const list = [...new Set(ids)].slice(0, MAX_BATCH)
    if (!list.length) throw new BadRequestException('Escolha ao menos um produto.')
    const system = await this.aiSystem(user.tenantId)
    if (list.length === 1) {
      try {
        return { change: await this.suggestOne(user, list[0]!, system, instruction.slice(0, 300)) }
      } catch (err) {
        throw new BadRequestException(`Não foi possível gerar a sugestão: ${(err as Error).message}`)
      }
    }
    if (this.jobs.get(user.tenantId)) throw new BadRequestException('Já há uma tarefa de SEO rodando (IA ou envio). Aguarde terminar.')
    const job: Job = { kind: 'ia', total: list.length, done: 0, errors: 0, startedAt: new Date().toISOString(), by: user.name, lastError: null }
    this.jobs.set(user.tenantId, job)
    void (async () => {
      try {
        for (const [i, id] of list.entries()) {
          if (i) await sleep(AI_GAP_MS)
          try {
            await this.suggestOne(user, id, system, instruction.slice(0, 300))
          } catch (err) {
            job.errors++
            job.lastError = (err as Error).message.slice(0, 300)
          }
          job.done++
        }
      } finally {
        this.jobs.delete(user.tenantId)
      }
    })()
    return { job, message: `Gerando sugestões para ${list.length} produto(s). Elas aparecem em "Para revisar" conforme ficam prontas.` }
  }

  /** Texto escrito pela pessoa (sem IA), ou ajuste de uma sugestão. */
  async saveDraft(user: AuthUser, productId: string, d: { changeId?: string; proposed?: Record<string, unknown>; sendFields?: string[] }) {
    this.assertCan(user, 'create')
    const p = await this.load(user, productId)
    const current = p.fields as unknown as SeoFields
    const proposed = { ...current, ...cleanSeoFields(d.proposed ?? {}) }
    const sendFields = (d.sendFields ?? changedFields(current, proposed)).filter((k) => SENDABLE.has(k))
    if (d.changeId) {
      const c = await this.prisma.seoChange.findFirst({ where: { id: d.changeId, seoProductId: p.id, status: { in: ['SUGERIDA', 'ERRO'] } } })
      if (!c) throw new NotFoundException('Sugestão não encontrada (talvez já enviada ou descartada).')
      return this.prisma.seoChange.update({ where: { id: c.id }, data: { proposed: proposed as unknown as Prisma.InputJsonValue, sendFields, status: 'SUGERIDA', error: null } })
    }
    await this.prisma.seoChange.updateMany({ where: { seoProductId: p.id, status: 'SUGERIDA' }, data: { status: 'DESCARTADA' } })
    return this.prisma.seoChange.create({ data: { tenantId: user.tenantId, seoProductId: p.id, before: current as unknown as Prisma.InputJsonValue, proposed: proposed as unknown as Prisma.InputJsonValue, sendFields, source: 'manual', createdById: user.id, createdByName: user.name.slice(0, 120) } })
  }

  async discard(user: AuthUser, changeId: string) {
    this.assertCan(user, 'create')
    const r = await this.prisma.seoChange.updateMany({ where: { id: changeId, tenantId: user.tenantId, status: { in: ['SUGERIDA', 'ERRO'] } }, data: { status: 'DESCARTADA' } })
    if (!r.count) throw new NotFoundException('Sugestão não encontrada.')
    return { ok: true }
  }

  /** Sugestões para revisar (e as que deram erro no envio). */
  async review(user: AuthUser, status = 'SUGERIDA') {
    this.assertCan(user, 'view')
    const st = ['SUGERIDA', 'ERRO', 'ENVIADA', 'DESFEITA'].includes(status) ? status : 'SUGERIDA'
    const rows = await this.prisma.seoChange.findMany({
      where: { tenantId: user.tenantId, status: st === 'ENVIADA' ? { in: ['ENVIADA', 'DESFEITA'] } : st },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { product: { select: { id: true, name: true, productCode: true, image: true, score: true } } },
    })
    return rows.map((c) => ({ ...c, scoreAfter: seoScore(c.proposed as unknown as SeoFields).score }))
  }

  // ---------- Envio para a Magazord ----------

  private async sendOne(user: AuthUser, changeId: string, ctx: RequestCtx) {
    const c = await this.prisma.seoChange.findFirst({ where: { id: changeId, tenantId: user.tenantId, status: { in: ['SUGERIDA', 'ERRO'] } }, include: { product: true } })
    if (!c) throw new Error('sugestão não encontrada ou já enviada')
    // Lê de novo antes de gravar: o "antes" guardado é o que estava na loja na hora do envio (para desfazer certo).
    const now = await this.read(user.tenantId, c.product.derivationCode).catch(() => c.product)
    const current = now.fields as unknown as SeoFields
    const proposed = c.proposed as unknown as SeoFields
    const fields = c.sendFields.filter((k): k is SeoField => SENDABLE.has(k)).filter((k) => k === 'searchKeywords' ? !!proposed.searchKeywords : (proposed[k] ?? '') !== (current[k] ?? ''))
    if (!fields.length) {
      await this.prisma.seoChange.update({ where: { id: c.id }, data: { status: 'DESCARTADA', error: 'Nada para enviar: os textos já estão iguais na loja.' } })
      return
    }
    const payload = Object.fromEntries(fields.map((k) => [k, proposed[k]])) as Partial<SeoFields>
    try {
      await this.magazord.seoWrite(user.tenantId, { productCode: now.productCode, pageId: now.pageId, fields: payload })
    } catch (err) {
      const msg = (err as Error).message.slice(0, 400)
      await this.prisma.seoChange.update({ where: { id: c.id }, data: { status: 'ERRO', error: msg } })
      throw err
    }
    await this.prisma.seoChange.update({ where: { id: c.id }, data: { status: 'ENVIADA', sendFields: fields, before: current as unknown as Prisma.InputJsonValue, sentAt: new Date(), sentByName: user.name.slice(0, 120), error: null } })
    // Confere na loja o que ficou gravado (e atualiza a nota).
    await this.read(user.tenantId, c.product.derivationCode).catch(() => undefined)
    await this.audit.byUser(user, ctx, 'seo.enviado', 'seo_product', c.product.id, { produto: c.product.productCode, campos: fields })
  }

  async send(user: AuthUser, ids: string[], ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const list = [...new Set(ids)].slice(0, 200)
    if (!list.length) throw new BadRequestException('Escolha ao menos uma sugestão.')
    if (list.length === 1) {
      try {
        await this.sendOne(user, list[0]!, ctx)
      } catch (err) {
        throw new BadRequestException(`A Magazord não aceitou: ${(err as Error).message}`)
      }
      return { ok: true, message: 'Enviado para a loja.' }
    }
    if (this.jobs.get(user.tenantId)) throw new BadRequestException('Já há uma tarefa de SEO rodando (IA ou envio). Aguarde terminar.')
    const job: Job = { kind: 'envio', total: list.length, done: 0, errors: 0, startedAt: new Date().toISOString(), by: user.name, lastError: null }
    this.jobs.set(user.tenantId, job)
    void (async () => {
      try {
        for (const [i, id] of list.entries()) {
          if (i) await sleep(500)
          try {
            await this.sendOne(user, id, ctx)
          } catch (err) {
            job.errors++
            job.lastError = (err as Error).message.slice(0, 300)
          }
          job.done++
        }
      } finally {
        this.jobs.delete(user.tenantId)
      }
    })()
    return { ok: true, job, message: `Enviando ${list.length} alteração(ões) para a loja, uma por vez.` }
  }

  /** Volta os campos enviados ao texto de antes (as palavras de busca não, porque a Magazord não informa as antigas). */
  async undo(user: AuthUser, changeId: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const c = await this.prisma.seoChange.findFirst({ where: { id: changeId, tenantId: user.tenantId, status: 'ENVIADA' }, include: { product: true } })
    if (!c) throw new NotFoundException('Envio não encontrado (ou já desfeito).')
    const before = c.before as unknown as SeoFields
    const fields = c.sendFields.filter((k): k is SeoField => SENDABLE.has(k) && k !== 'searchKeywords')
    if (!fields.length) throw new BadRequestException('Este envio só mudou as palavras de busca, que não dá para desfazer (a Magazord não informa as antigas).')
    try {
      await this.magazord.seoWrite(user.tenantId, { productCode: c.product.productCode, pageId: c.product.pageId, fields: Object.fromEntries(fields.map((k) => [k, before[k] ?? ''])) })
    } catch (err) {
      throw new BadRequestException(`A Magazord não aceitou: ${(err as Error).message}`)
    }
    await this.prisma.seoChange.update({ where: { id: c.id }, data: { status: 'DESFEITA', undoneAt: new Date() } })
    await this.read(user.tenantId, c.product.derivationCode).catch(() => undefined)
    await this.audit.byUser(user, ctx, 'seo.desfeito', 'seo_product', c.product.id, { produto: c.product.productCode, campos: fields })
    return { ok: true, message: c.sendFields.includes('searchKeywords') ? 'Textos de volta ao que eram. As palavras de busca não voltam (a Magazord não informa as antigas).' : 'Textos de volta ao que eram.' }
  }
}
