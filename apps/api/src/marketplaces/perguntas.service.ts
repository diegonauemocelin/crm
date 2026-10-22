import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import type { AuthUser } from '../common/types'
import { MagazordService } from '../integracoes/magazord.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { MARKETPLACE } from './mercadolivre'
import { MercadoLivreService } from './mercadolivre.service'
import { ANSWER_MAX, buildAnswer, classifyQuestion, DEFAULT_QUESTIONS, extractCep, type FreightOption, forbiddenContent, itemSku, parseFreightOptions, type QuestionKind, QUESTIONS_KEY, type QuestionsConfig } from './perguntas'

const TICK_MS = 2 * 60_000
/** Situações em que a pergunta ainda espera alguém do CRM. */
export const OPEN_STATUSES = ['sugerida', 'revisar', 'erro']

interface MlQuestion {
  id: number | string
  item_id: string
  text: string
  status: string
  date_created: string
  from?: { id?: number | string }
}

interface MlItem {
  title?: string
  price?: number
  permalink?: string
  seller_custom_field?: string | null
  attributes?: { id?: string; value_name?: string | null }[]
  variations?: { seller_custom_field?: string | null; attributes?: { id?: string; value_name?: string | null }[] }[]
}

/**
 * Perguntas de frete do Mercado Livre: a cada 2 minutos lê as perguntas sem resposta, calcula o frete na Magazord
 * (peso, medidas e tabelas de frete da loja) e deixa a resposta pronta ou responde sozinho, conforme a configuração.
 * Perguntas que não são de frete não são tocadas.
 */
@Injectable()
export class MlQuestionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MlQuestionsService.name)
  private timer: NodeJS.Timeout | null = null
  private readonly busy = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ml: MercadoLivreService,
    private readonly magazord: MagazordService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async config(tenantId: string): Promise<QuestionsConfig> {
    return { ...DEFAULT_QUESTIONS, ...(await this.settings.get<Partial<QuestionsConfig>>(tenantId, QUESTIONS_KEY, {})) }
  }

  private async patch(tenantId: string, patch: Partial<QuestionsConfig>) {
    const next = { ...(await this.config(tenantId)), ...patch }
    await this.settings.set(tenantId, QUESTIONS_KEY, next)
    return next
  }

  async saveConfig(tenantId: string, c: Pick<QuestionsConfig, 'enabled' | 'mode' | 'askCep' | 'intro' | 'outro' | 'askCepText'>) {
    for (const [label, t] of [['Texto do início', c.intro], ['Texto do fim', c.outro], ['Pedido de CEP', c.askCepText]] as const) {
      const bad = forbiddenContent(t)
      if (bad) throw new BadRequestException(`${label}: o Mercado Livre não aceita ${bad} nas respostas. Tire do texto.`)
    }
    if (!c.intro.includes('{cep}')) throw new BadRequestException('O texto do início precisa ter {cep}, para o cliente ver para qual CEP é o frete.')
    const prev = await this.config(tenantId)
    // Ao ligar a resposta automática, só as perguntas novas são respondidas sozinhas (as antigas ficam para revisar).
    const turnedOn = c.enabled && (!prev.enabled || (c.mode === 'automatico' && prev.mode !== 'automatico'))
    return this.patch(tenantId, { ...c, enabledAt: turnedOn ? new Date().toISOString() : prev.enabledAt })
  }

  async tick() {
    const rows = await this.prisma.tenantSetting.findMany({ where: { key: QUESTIONS_KEY }, select: { tenantId: true, value: true } }).catch(() => [])
    for (const row of rows) {
      if (!(row.value as Partial<QuestionsConfig> | null)?.enabled) continue
      await this.check(row.tenantId).catch((err: unknown) => this.logger.warn(`Perguntas do Mercado Livre: ${(err as Error).message}`))
    }
  }

  /** Lê as perguntas sem resposta e trata as de frete que ainda não foram vistas. */
  async check(tenantId: string) {
    if (this.busy.has(tenantId)) return { ok: true, message: 'A verificação já está rodando.', created: 0 }
    this.busy.add(tenantId)
    try {
      const cfg = await this.config(tenantId)
      const mlc = await this.ml.config(tenantId)
      if (mlc.status !== 'CONECTADO' || !mlc.userId) throw new BadRequestException('Conecte o Mercado Livre em Marketplaces › Conexões.')
      const r = await this.ml.apiGet<{ questions?: MlQuestion[]; total?: number }>(tenantId, '/questions/search', { seller_id: mlc.userId, status: 'UNANSWERED', api_version: 4, sort_fields: 'date_created', sort_types: 'DESC', limit: 50 })
      const list = (r.questions ?? []).filter((q) => String(q.status).toUpperCase() === 'UNANSWERED')
      const ids = list.map((q) => String(q.id))
      const known = new Set((await this.prisma.marketplaceQuestion.findMany({ where: { tenantId, marketplace: MARKETPLACE, questionId: { in: ids } }, select: { questionId: true } })).map((x) => x.questionId))
      let created = 0
      for (const q of list) {
        if (known.has(String(q.id))) continue
        const c = classifyQuestion(q.text ?? '')
        if (!c) continue
        await this.handle(tenantId, cfg, q, c.kind, c.cep)
        created++
      }
      // Respondidas ou apagadas direto no Mercado Livre: saem da fila do CRM.
      const oldest = list.length ? list.map((q) => q.date_created).sort()[0]! : null
      const complete = (r.total ?? list.length) <= list.length
      await this.prisma.marketplaceQuestion.updateMany({
        where: { tenantId, marketplace: MARKETPLACE, status: { in: OPEN_STATUSES }, questionId: { notIn: ids }, ...(complete || !oldest ? {} : { askedAt: { gte: new Date(oldest) } }) },
        data: { status: 'encerrada' },
      })
      await this.patch(tenantId, { lastCheckAt: new Date().toISOString(), lastError: null })
      return { ok: true, message: created ? `${created} pergunta(s) de frete nova(s).` : 'Nenhuma pergunta de frete nova.', created }
    } catch (err) {
      await this.patch(tenantId, { lastCheckAt: new Date().toISOString(), lastError: (err as Error).message.slice(0, 300) })
      throw err
    } finally {
      this.busy.delete(tenantId)
    }
  }

  /** Cotação de um anúncio para um CEP: SKU do anúncio → simulação na Magazord. */
  async quote(tenantId: string, itemId: string, cep: string) {
    const item = await this.ml.apiGet<MlItem>(tenantId, `/items/${encodeURIComponent(itemId)}`, { include_attributes: 'all' })
    const sku = itemSku(item)
    if (!sku) throw new BadRequestException('O anúncio não tem SKU (campo SKU do vendedor) para achar o produto na Magazord.')
    const raw = await this.magazord.simulateFreight(tenantId, cep, [{ sku, quantity: 1, price: item.price ?? 0 }])
    return { sku, title: item.title ?? null, permalink: item.permalink ?? null, price: item.price ?? null, options: parseFreightOptions(raw), raw }
  }

  private async handle(tenantId: string, cfg: QuestionsConfig, q: MlQuestion, kind: QuestionKind, cep: string | null) {
    const base = { tenantId, marketplace: MARKETPLACE, questionId: String(q.id), itemId: q.item_id, buyerId: q.from?.id ? String(q.from.id) : null, text: q.text.slice(0, 2000), cep, kind, askedAt: new Date(q.date_created) }
    let answer: string | null = null
    let options: FreightOption[] | null = null
    let error: string | null = null
    let meta: { sku?: string | null; itemTitle?: string | null; itemPermalink?: string | null } = {}
    if (cep) {
      try {
        const r = await this.quote(tenantId, q.item_id, cep)
        meta = { sku: r.sku, itemTitle: r.title, itemPermalink: r.permalink }
        options = r.options
        if (r.options.length) answer = buildAnswer(cfg, cep, r.options)
        else error = 'A Magazord não devolveu opção de frete para este CEP e produto.'
      } catch (err) {
        error = (err as Error).message.slice(0, 300)
      }
    } else if (kind === 'frete_sem_cep' && cfg.askCep) {
      answer = cfg.askCepText.slice(0, ANSWER_MAX)
    }
    if (!meta.itemTitle) {
      const item = await this.ml.apiGet<MlItem>(tenantId, `/items/${encodeURIComponent(q.item_id)}`, { attributes: 'title,permalink' }).catch(() => null)
      meta = { ...meta, itemTitle: item?.title ?? null, itemPermalink: item?.permalink ?? null }
    }
    const status = kind === 'misto' ? 'revisar' : error ? 'erro' : answer ? 'sugerida' : 'revisar'
    const row = await this.prisma.marketplaceQuestion.create({ data: { ...base, ...meta, status, answer, options: (options ?? undefined) as never, error } })
    // Resposta automática: só frete puro, com resposta pronta e pergunta feita depois de ligar o automático.
    const auto = cfg.mode === 'automatico' && status === 'sugerida' && !!answer && !!cfg.enabledAt && new Date(q.date_created) >= new Date(cfg.enabledAt)
    if (auto) await this.deliver(tenantId, row.id, answer!, 'automático').catch(() => undefined)
  }

  private async deliver(tenantId: string, id: string, text: string, by: string) {
    const row = await this.prisma.marketplaceQuestion.findFirst({ where: { id, tenantId } })
    if (!row) throw new NotFoundException('Pergunta não encontrada.')
    try {
      await this.ml.apiPost(tenantId, '/answers', { question_id: Number(row.questionId), text })
      return this.prisma.marketplaceQuestion.update({ where: { id }, data: { status: 'respondida', answer: text, answeredAt: new Date(), answeredBy: by, error: null } })
    } catch (err) {
      await this.prisma.marketplaceQuestion.update({ where: { id }, data: { status: 'erro', answer: text, error: (err as Error).message.slice(0, 300) } })
      throw err
    }
  }

  /** "Enviar" na tela: a pessoa confere (e pode editar) a resposta antes. */
  async send(user: AuthUser, id: string, text: string) {
    const row = await this.prisma.marketplaceQuestion.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!row) throw new NotFoundException('Pergunta não encontrada.')
    if (!OPEN_STATUSES.includes(row.status)) throw new BadRequestException('Esta pergunta já foi respondida ou encerrada.')
    const t = text.trim()
    if (!t) throw new BadRequestException('Escreva a resposta.')
    if (t.length > ANSWER_MAX) throw new BadRequestException(`A resposta passa de ${ANSWER_MAX} caracteres.`)
    const bad = forbiddenContent(t.replace(/\b\d{5}-?\d{3}\b/g, ''))
    if (bad) throw new BadRequestException(`O Mercado Livre não aceita ${bad} nas respostas. Tire do texto.`)
    return this.deliver(user.tenantId, id, t, user.name)
  }

  async ignore(tenantId: string, id: string) {
    const r = await this.prisma.marketplaceQuestion.updateMany({ where: { id, tenantId, status: { in: OPEN_STATUSES } }, data: { status: 'ignorada' } })
    if (!r.count) throw new NotFoundException('Pergunta não encontrada ou já respondida.')
    return { ok: true }
  }

  /** Recalcula a cotação (ex.: o cliente mandou o CEP em outra pergunta, ou o SKU foi corrigido). */
  async requote(tenantId: string, id: string, cepInput?: string) {
    const row = await this.prisma.marketplaceQuestion.findFirst({ where: { id, tenantId } })
    if (!row) throw new NotFoundException('Pergunta não encontrada.')
    const cep = cepInput ? extractCep(cepInput) : row.cep
    if (!cep) throw new BadRequestException('Informe um CEP válido (8 números).')
    const cfg = await this.config(tenantId)
    try {
      const r = await this.quote(tenantId, row.itemId, cep)
      const answer = r.options.length ? buildAnswer(cfg, cep, r.options) : null
      return this.prisma.marketplaceQuestion.update({
        where: { id },
        data: { cep, sku: r.sku, options: r.options as never, answer: answer ?? row.answer, error: answer ? null : 'A Magazord não devolveu opção de frete para este CEP e produto.', status: OPEN_STATUSES.includes(row.status) ? (answer ? (row.kind === 'misto' ? 'revisar' : 'sugerida') : 'erro') : row.status },
      })
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }
  }

  /** "Testar cotação": por anúncio (MLB…) ou por SKU direto, mostrando o que a Magazord devolveu. */
  async test(tenantId: string, input: { itemId?: string; sku?: string; cep: string; price?: number }) {
    const cep = extractCep(input.cep)
    if (!cep) throw new BadRequestException('Informe um CEP válido (8 números).')
    const cfg = await this.config(tenantId)
    try {
      let sku = input.sku?.trim() || null
      let title: string | null = null
      let raw: unknown
      let options: FreightOption[]
      if (input.itemId) {
        const r = await this.quote(tenantId, input.itemId.trim().toUpperCase(), cep)
        ;({ sku, title, raw, options } = r)
      } else {
        if (!sku) throw new BadRequestException('Informe o anúncio (MLB...) ou o SKU.')
        raw = await this.magazord.simulateFreight(tenantId, cep, [{ sku, quantity: 1, price: input.price ?? 0 }])
        options = parseFreightOptions(raw)
      }
      return { ok: true, sku, title, cep, options, answer: options.length ? buildAnswer(cfg, cep, options) : null, raw: JSON.stringify(raw ?? null).slice(0, 4000) }
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      throw new BadRequestException((err as Error).message)
    }
  }

  async list(tenantId: string, filter: 'abertas' | 'respondidas' | 'todas', page: number) {
    const where = { tenantId, marketplace: MARKETPLACE, ...(filter === 'abertas' ? { status: { in: OPEN_STATUSES } } : filter === 'respondidas' ? { status: 'respondida' } : {}) }
    const [items, total, counts] = await Promise.all([
      this.prisma.marketplaceQuestion.findMany({ where, orderBy: { askedAt: 'desc' }, skip: (page - 1) * 30, take: 30 }),
      this.prisma.marketplaceQuestion.count({ where }),
      this.prisma.marketplaceQuestion.groupBy({ by: ['status'], where: { tenantId, marketplace: MARKETPLACE }, _count: { _all: true } }),
    ])
    return { items, total, page, pageSize: 30, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) }
  }
}
