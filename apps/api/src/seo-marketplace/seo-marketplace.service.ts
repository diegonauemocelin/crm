import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { EmailAiService } from '../email/ia.service'
import { Prisma } from '../generated/prisma/client'
import { MercadoLivreService } from '../marketplaces/mercadolivre.service'
import {
  cleanMlSeoFields,
  forbiddenContent,
  isMlItemId,
  type MlAttribute,
  mlChangedFields,
  type MlSeoField,
  type MlSeoFields,
  mlSeoPrompt,
  mlSeoScore,
  mlSeoSystem,
  ML_SEO_FIELDS,
  ML_TITLE_MAX,
  mlTitleAllowed,
  parseMlSeoAnswer,
} from '../marketplaces/seo-ml'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'

type Job = { kind: 'ia' | 'envio'; total: number; done: number; errors: number; startedAt: string; by: string | null; lastError: string | null }

const MAX_BATCH = 50
/** Pausa entre as chamadas da IA gratuita (Gemini tem limite de pedidos por minuto). */
const AI_GAP_MS = 4_500
const PAGE = 50
const SENDABLE = new Set<string>(ML_SEO_FIELDS.map((f) => f.key))

interface MlItemLive {
  id: string
  seller_id?: number | string | null
  title?: string
  status?: string
  permalink?: string
  thumbnail?: string
  secure_thumbnail?: string
  sold_quantity?: number | null
  catalog_listing?: boolean | null
  last_updated?: string
  attributes?: { id?: string; name?: string; value_name?: string | null }[]
}

/** Anúncio como está agora no Mercado Livre (lido na hora). */
interface Live {
  id: string
  sellerId: string | null
  fields: MlSeoFields
  hasDescription: boolean
  soldQuantity: number
  titleAllowed: boolean
  status: string | null
  permalink: string | null
  thumbnail: string | null
  attributes: MlAttribute[]
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref())

/**
 * SEO Marketplace: dá nota aos anúncios do Mercado Livre (cópia sincronizada pelo Assistente ML), sugere uma descrição
 * melhor (e o título, quando o anúncio ainda não tem vendas) com a IA gratuita e, depois da revisão de uma pessoa,
 * grava no Mercado Livre. Guarda o texto anterior para desfazer. Preço, estoque e o resto do anúncio nunca mudam.
 */
@Injectable()
export class SeoMarketplaceService {
  /** Tarefa de IA ou envio em andamento, por empresa (uma por vez). */
  private readonly jobs = new Map<string, Job>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly ml: MercadoLivreService,
    private readonly ai: EmailAiService,
  ) {}

  /** Conta do Mercado Livre conectada (só os anúncios dela podem ser alterados). */
  private async seller(tenantId: string) {
    const c = await this.ml.config(tenantId)
    if (c.status === 'DESCONECTADO' || !c.refreshTokenEnc || !c.userId) throw new BadRequestException('Conecte o Mercado Livre em Configurações › Marketplaces › Conexões dos marketplaces.')
    return c.userId
  }

  // ---------- Leitura ----------

  /** Lê o anúncio e a descrição no Mercado Livre e atualiza a cópia local (a mesma do Assistente ML). */
  private async live(tenantId: string, itemId: string): Promise<Live> {
    if (!isMlItemId(itemId)) throw new BadRequestException('Anúncio inválido.')
    const it = await this.ml.apiGet<MlItemLive>(tenantId, `/items/${itemId}`)
    let hasDescription = true
    const description = await this.ml
      .apiGet<{ plain_text?: string }>(tenantId, `/items/${itemId}/description`)
      .then((d) => d.plain_text ?? '')
      .catch((err: { status?: number }) => {
        if (err.status === 404) {
          hasDescription = false
          return ''
        }
        throw err
      })
    const attributes = (it.attributes ?? []).map((a) => ({ id: a.id ?? null, name: a.name ?? null, value: a.value_name ?? null }))
    await this.prisma.assistItem.updateMany({
      where: { tenantId, id: itemId },
      data: { title: it.title ?? null, description, status: it.status ?? null, permalink: it.permalink ?? null, attributes: attributes as unknown as Prisma.InputJsonValue, mlLastUpdated: it.last_updated ?? null, syncedAt: new Date() },
    })
    return {
      id: itemId,
      sellerId: it.seller_id == null ? null : String(it.seller_id),
      fields: { title: it.title ?? '', description },
      hasDescription,
      soldQuantity: it.sold_quantity ?? 0,
      titleAllowed: mlTitleAllowed(it),
      status: it.status ?? null,
      permalink: it.permalink ?? null,
      thumbnail: it.secure_thumbnail ?? it.thumbnail ?? null,
      attributes,
    }
  }

  private async cached(tenantId: string, itemId: string) {
    const seller = await this.seller(tenantId)
    const it = await this.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId, id: itemId } } })
    if (!it || it.sellerId !== seller) throw new NotFoundException('Anúncio não encontrado na conta conectada do Mercado Livre.')
    return it
  }

  // ---------- Telas ----------

  async list(user: AuthUser, q: { search?: string; issue?: string; maxScore?: number; page?: number; order?: string; status?: string }) {
    const T = user.tenantId
    const seller = await this.seller(T)
    const rows = await this.prisma.assistItem.findMany({
      where: { tenantId: T, sellerId: seller, ...(q.status === 'todos' ? {} : { status: q.status === 'paused' ? 'paused' : q.status === 'closed' ? 'closed' : { in: ['active', 'paused'] } }) },
      select: { id: true, title: true, description: true, attributes: true, brand: true, partNumber: true, sellerSku: true, status: true, permalink: true, price: true, availableQuantity: true, syncedAt: true },
    })
    const scored = rows.map((r) => {
      const { score, issues } = mlSeoScore({ title: r.title ?? '', description: r.description ?? '', brand: r.brand, partNumber: r.partNumber, attributes: (r.attributes as MlAttribute[] | null) ?? [] })
      return { r, score, issues }
    })
    const s = q.search?.trim().toLowerCase()
    let list = scored
    if (s) list = list.filter(({ r }) => [r.id, r.title, r.brand, r.partNumber, r.sellerSku].some((v) => (v ?? '').toLowerCase().includes(s)))
    if (q.maxScore !== undefined && Number.isFinite(q.maxScore)) list = list.filter((x) => x.score <= q.maxScore!)
    if (q.issue && ['title', 'description', 'attributes'].includes(q.issue)) list = list.filter((x) => x.issues.some((i) => i.field === q.issue))
    list.sort((a, b) =>
      q.order === 'nome' ? (a.r.title ?? '').localeCompare(b.r.title ?? '', 'pt-BR') : q.order === 'nota_desc' ? b.score - a.score : a.score - b.score || (a.r.title ?? '').localeCompare(b.r.title ?? '', 'pt-BR'),
    )
    const page = Math.max(1, q.page ?? 1)
    const slice = list.slice((page - 1) * PAGE, page * PAGE)
    const ids = slice.map((x) => x.r.id)
    const [last, pending] = await Promise.all([
      this.prisma.mlSeoChange.findMany({ where: { tenantId: T, itemId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { id: true, itemId: true, status: true, createdAt: true } }),
      this.prisma.mlSeoChange.count({ where: { tenantId: T, status: 'SUGERIDA' } }),
    ])
    const lastBy = new Map<string, (typeof last)[number]>()
    for (const l of last) if (!lastBy.has(l.itemId)) lastBy.set(l.itemId, l)
    const all = scored.length
    return {
      total: list.length,
      page,
      stats: { analyzed: all, avgScore: all ? Math.round(scored.reduce((a, x) => a + x.score, 0) / all) : null, below60: scored.filter((x) => x.score < 60).length, pending },
      job: this.jobs.get(T) ?? null,
      fields: ML_SEO_FIELDS,
      items: slice.map(({ r, score, issues }) => ({
        id: r.id,
        title: r.title ?? r.id,
        brand: r.brand,
        partNumber: r.partNumber,
        sellerSku: r.sellerSku,
        status: r.status,
        permalink: r.permalink,
        price: r.price === null ? null : Number(r.price),
        availableQuantity: r.availableQuantity,
        descriptionLength: (r.description ?? '').length,
        syncedAt: r.syncedAt,
        score,
        issues,
        lastChange: lastBy.get(r.id) ?? null,
      })),
    }
  }

  /** Anúncio lido na hora no Mercado Livre (se falhar, mostra a cópia local e avisa). */
  async get(user: AuthUser, itemId: string) {
    const it = await this.cached(user.tenantId, itemId)
    let live: Live | null = null
    let liveError: string | null = null
    try {
      live = await this.live(user.tenantId, itemId)
    } catch (err) {
      liveError = (err as Error).message
    }
    const fields: MlSeoFields = live?.fields ?? { title: it.title ?? '', description: it.description ?? '' }
    const attributes = live?.attributes ?? ((it.attributes as MlAttribute[] | null) ?? [])
    const changes = await this.prisma.mlSeoChange.findMany({ where: { tenantId: user.tenantId, itemId }, orderBy: { createdAt: 'desc' }, take: 20 })
    return {
      id: it.id,
      title: fields.title || it.id,
      brand: it.brand,
      partNumber: it.partNumber,
      sellerSku: it.sellerSku,
      status: live?.status ?? it.status,
      permalink: live?.permalink ?? it.permalink,
      thumbnail: live?.thumbnail ?? null,
      attributes: attributes.filter((a) => (a.value ?? '').trim()),
      fields,
      soldQuantity: live?.soldQuantity ?? null,
      /** null: não deu para ler no Mercado Livre agora. */
      titleAllowed: live ? live.titleAllowed : null,
      liveError,
      syncedAt: live ? new Date() : it.syncedAt,
      ...mlSeoScore({ title: fields.title, description: fields.description, brand: it.brand, partNumber: it.partNumber, attributes }),
      aiAvailable: await this.ai.available(user.tenantId),
      changes,
    }
  }

  // ---------- Sugestões (IA e manual) ----------

  private async aiSystem(tenantId: string) {
    if (!(await this.ai.available(tenantId))) throw new BadRequestException('Para usar a IA, cadastre a chave do Gemini em Configurações › E-mail marketing (é gratuita no Google AI Studio).')
    const b = await this.settings.branding(tenantId)
    return mlSeoSystem(b.shortName || b.appName, await this.ai.about(tenantId))
  }

  /** Lê o anúncio atualizado no Mercado Livre, pede a sugestão à IA e grava como "para revisar". */
  private async suggestOne(user: AuthUser, itemId: string, system: string, instruction: string) {
    const it = await this.cached(user.tenantId, itemId)
    const live = await this.live(user.tenantId, itemId)
    const facts = { id: itemId, title: live.fields.title, description: live.fields.description, brand: it.brand, partNumber: it.partNumber, sellerSku: it.sellerSku, attributes: live.attributes }
    const answer = parseMlSeoAnswer(await this.ai.complete(user.tenantId, system, mlSeoPrompt(facts, { titleAllowed: live.titleAllowed, instruction }), 4000))
    if (!answer) throw new Error('a IA não respondeu no formato esperado')
    if (!live.titleAllowed) delete answer.title
    const proposed = { ...live.fields, ...answer }
    // O título só vai se a pessoa marcar (muda como o anúncio aparece na busca).
    const send = mlChangedFields(live.fields, proposed).filter((k) => k !== 'title')
    await this.prisma.mlSeoChange.updateMany({ where: { tenantId: user.tenantId, itemId, status: 'SUGERIDA' }, data: { status: 'DESCARTADA' } })
    return this.prisma.mlSeoChange.create({
      data: { tenantId: user.tenantId, itemId, itemTitle: live.fields.title.slice(0, 200) || null, before: live.fields as unknown as Prisma.InputJsonValue, proposed: proposed as unknown as Prisma.InputJsonValue, sendFields: send, source: 'ia', createdById: user.id, createdByName: user.name.slice(0, 120) },
    })
  }

  /** Um anúncio: devolve a sugestão na hora. Vários: em segundo plano, um por vez (limite da IA gratuita). */
  async suggest(user: AuthUser, ids: string[], instruction = '') {
    const list = [...new Set(ids)].filter(isMlItemId).slice(0, MAX_BATCH)
    if (!list.length) throw new BadRequestException('Escolha ao menos um anúncio.')
    await this.seller(user.tenantId)
    const system = await this.aiSystem(user.tenantId)
    const instr = instruction.slice(0, 300)
    if (list.length === 1) {
      try {
        return { change: await this.suggestOne(user, list[0]!, system, instr) }
      } catch (err) {
        throw new BadRequestException(`Não foi possível gerar a sugestão: ${(err as Error).message}`)
      }
    }
    if (this.jobs.get(user.tenantId)) throw new BadRequestException('Já há uma tarefa de SEO Marketplace rodando (IA ou envio). Aguarde terminar.')
    const job: Job = { kind: 'ia', total: list.length, done: 0, errors: 0, startedAt: new Date().toISOString(), by: user.name, lastError: null }
    this.jobs.set(user.tenantId, job)
    void (async () => {
      try {
        for (const [i, id] of list.entries()) {
          if (i) await sleep(AI_GAP_MS)
          try {
            await this.suggestOne(user, id, system, instr)
          } catch (err) {
            job.errors++
            job.lastError = `${id}: ${(err as Error).message}`.slice(0, 300)
          }
          job.done++
        }
      } finally {
        this.jobs.delete(user.tenantId)
      }
    })()
    return { job, message: `Gerando sugestões para ${list.length} anúncio(s). Elas aparecem em "Para revisar" conforme ficam prontas.` }
  }

  /** Texto escrito pela pessoa (sem IA), ou ajuste de uma sugestão. */
  async saveDraft(user: AuthUser, itemId: string, d: { changeId?: string; proposed?: Record<string, unknown>; sendFields?: string[] }) {
    const it = await this.cached(user.tenantId, itemId)
    const current: MlSeoFields = { title: it.title ?? '', description: it.description ?? '' }
    const proposed = { ...current, ...cleanMlSeoFields(d.proposed ?? {}) }
    const sendFields = (d.sendFields ?? mlChangedFields(current, proposed)).filter((k) => SENDABLE.has(k))
    if (d.changeId) {
      const c = await this.prisma.mlSeoChange.findFirst({ where: { id: d.changeId, tenantId: user.tenantId, itemId, status: { in: ['SUGERIDA', 'ERRO'] } } })
      if (!c) throw new NotFoundException('Sugestão não encontrada (talvez já enviada ou descartada).')
      return this.prisma.mlSeoChange.update({ where: { id: c.id }, data: { proposed: proposed as unknown as Prisma.InputJsonValue, sendFields, status: 'SUGERIDA', error: null } })
    }
    await this.prisma.mlSeoChange.updateMany({ where: { tenantId: user.tenantId, itemId, status: 'SUGERIDA' }, data: { status: 'DESCARTADA' } })
    return this.prisma.mlSeoChange.create({
      data: { tenantId: user.tenantId, itemId, itemTitle: current.title.slice(0, 200) || null, before: current as unknown as Prisma.InputJsonValue, proposed: proposed as unknown as Prisma.InputJsonValue, sendFields, source: 'manual', createdById: user.id, createdByName: user.name.slice(0, 120) },
    })
  }

  async discard(user: AuthUser, changeId: string) {
    const r = await this.prisma.mlSeoChange.updateMany({ where: { id: changeId, tenantId: user.tenantId, status: { in: ['SUGERIDA', 'ERRO'] } }, data: { status: 'DESCARTADA' } })
    if (!r.count) throw new NotFoundException('Sugestão não encontrada.')
    return { ok: true }
  }

  /** Sugestões para revisar (e as que deram erro no envio), ou as enviadas. */
  async review(user: AuthUser, status = 'SUGERIDA') {
    const st = ['SUGERIDA', 'ERRO', 'ENVIADA', 'DESFEITA'].includes(status) ? status : 'SUGERIDA'
    const rows = await this.prisma.mlSeoChange.findMany({
      where: { tenantId: user.tenantId, status: st === 'ENVIADA' ? { in: ['ENVIADA', 'DESFEITA'] } : st === 'SUGERIDA' ? { in: ['SUGERIDA', 'ERRO'] } : st },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    const items = await this.prisma.assistItem.findMany({ where: { tenantId: user.tenantId, id: { in: [...new Set(rows.map((r) => r.itemId))] } }, select: { id: true, brand: true, partNumber: true, attributes: true, permalink: true } })
    const byId = new Map(items.map((i) => [i.id, i]))
    const scoreOf = (f: MlSeoFields, itemId: string) => {
      const i = byId.get(itemId)
      return mlSeoScore({ ...f, brand: i?.brand ?? null, partNumber: i?.partNumber ?? null, attributes: (i?.attributes as MlAttribute[] | null) ?? [] }).score
    }
    return rows.map((c) => ({ ...c, permalink: byId.get(c.itemId)?.permalink ?? null, scoreBefore: scoreOf(c.before as unknown as MlSeoFields, c.itemId), scoreAfter: scoreOf(c.proposed as unknown as MlSeoFields, c.itemId) }))
  }

  // ---------- Envio para o Mercado Livre ----------

  /** Grava os campos no anúncio: a descrição primeiro (PUT, ou POST se o anúncio ainda não tem), depois o título. */
  private async write(tenantId: string, live: Live, fields: MlSeoField[], values: Partial<MlSeoFields>) {
    const done: MlSeoField[] = []
    if (fields.includes('description')) {
      const body = { plain_text: values.description ?? '' }
      if (live.hasDescription) await this.ml.apiWrite(tenantId, 'PUT', `/items/${live.id}/description`, body, { api_version: 2 })
      else await this.ml.apiWrite(tenantId, 'POST', `/items/${live.id}/description`, body)
      done.push('description')
    }
    if (fields.includes('title')) {
      try {
        await this.ml.apiWrite(tenantId, 'PUT', `/items/${live.id}`, { title: values.title ?? '' })
        done.push('title')
      } catch (err) {
        if (!done.length) throw err
        return { done, titleError: (err as Error).message }
      }
    }
    return { done, titleError: null as string | null }
  }

  /** Confere o que não pode ir para o Mercado Livre antes de enviar. */
  private check(live: Live, fields: MlSeoField[], values: Partial<MlSeoFields>) {
    if (fields.includes('title')) {
      if (!live.titleAllowed) throw new Error(`o anúncio já tem ${live.soldQuantity} venda(s) (ou é de catálogo) e o Mercado Livre não deixa mudar o título. Desmarque o título e envie só a descrição.`)
      const t = (values.title ?? '').trim()
      if (!t) throw new Error('o título não pode ficar vazio.')
      if (t.length > ML_TITLE_MAX) throw new Error(`o título tem ${t.length} caracteres; o Mercado Livre aceita até ${ML_TITLE_MAX}.`)
    }
    for (const k of fields) {
      const bad = forbiddenContent(values[k] ?? '')
      if (bad.length) throw new Error(`${k === 'title' ? 'o título' : 'a descrição'} tem ${bad.join(', ')}; o Mercado Livre não aceita. Tire antes de enviar.`)
    }
  }

  private async sendOne(user: AuthUser, changeId: string, ctx: RequestCtx) {
    const c = await this.prisma.mlSeoChange.findFirst({ where: { id: changeId, tenantId: user.tenantId, status: { in: ['SUGERIDA', 'ERRO'] } } })
    if (!c) throw new Error('sugestão não encontrada ou já enviada')
    const seller = await this.seller(user.tenantId)
    const fail = async (msg: string) => {
      await this.prisma.mlSeoChange.update({ where: { id: c.id }, data: { status: 'ERRO', error: msg.slice(0, 400) } })
      return new Error(msg)
    }
    // Lê de novo antes de gravar: o "antes" guardado é o que estava no anúncio na hora do envio (para desfazer certo).
    let live: Live
    try {
      live = await this.live(user.tenantId, c.itemId)
    } catch (err) {
      throw await fail((err as Error).message)
    }
    if (live.sellerId !== seller) throw await fail('o anúncio não é da conta conectada do Mercado Livre')
    const proposed = c.proposed as unknown as MlSeoFields
    const fields = c.sendFields.filter((k): k is MlSeoField => SENDABLE.has(k)).filter((k) => (proposed[k] ?? '').trim() !== (live.fields[k] ?? '').trim())
    if (!fields.length) {
      await this.prisma.mlSeoChange.update({ where: { id: c.id }, data: { status: 'DESCARTADA', error: 'Nada para enviar: os textos já estão iguais no Mercado Livre.' } })
      return { titleError: null }
    }
    let r: { done: MlSeoField[]; titleError: string | null }
    try {
      this.check(live, fields, proposed)
      r = await this.write(user.tenantId, live, fields, proposed)
    } catch (err) {
      throw await fail((err as Error).message)
    }
    await this.prisma.mlSeoChange.update({
      where: { id: c.id },
      data: { status: 'ENVIADA', sendFields: r.done, before: live.fields as unknown as Prisma.InputJsonValue, sentAt: new Date(), sentByName: user.name.slice(0, 120), error: r.titleError ? `Título não aceito: ${r.titleError}`.slice(0, 400) : null },
    })
    // Confere no Mercado Livre o que ficou gravado (e atualiza a cópia local).
    await this.live(user.tenantId, c.itemId).catch(() => undefined)
    await this.audit.byUser(user, ctx, 'seo_marketplace.enviado', 'ml_item', c.itemId, { anuncio: c.itemId, campos: r.done })
    return { titleError: r.titleError }
  }

  async send(user: AuthUser, ids: string[], ctx: RequestCtx) {
    const list = [...new Set(ids)].slice(0, 200)
    if (!list.length) throw new BadRequestException('Escolha ao menos uma sugestão.')
    if (list.length === 1) {
      let r: { titleError: string | null }
      try {
        r = await this.sendOne(user, list[0]!, ctx)
      } catch (err) {
        throw new BadRequestException(`O Mercado Livre não aceitou: ${(err as Error).message}`)
      }
      return { ok: true, message: r.titleError ? `Descrição enviada. O título não foi aceito: ${r.titleError}` : 'Enviado para o Mercado Livre.' }
    }
    if (this.jobs.get(user.tenantId)) throw new BadRequestException('Já há uma tarefa de SEO Marketplace rodando (IA ou envio). Aguarde terminar.')
    const job: Job = { kind: 'envio', total: list.length, done: 0, errors: 0, startedAt: new Date().toISOString(), by: user.name, lastError: null }
    this.jobs.set(user.tenantId, job)
    void (async () => {
      try {
        for (const [i, id] of list.entries()) {
          if (i) await sleep(500)
          try {
            const r = await this.sendOne(user, id, ctx)
            if (r.titleError) {
              job.errors++
              job.lastError = `título: ${r.titleError}`.slice(0, 300)
            }
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
    return { ok: true, job, message: `Enviando ${list.length} alteração(ões) para o Mercado Livre, uma por vez.` }
  }

  /** Volta os campos enviados ao texto de antes. */
  async undo(user: AuthUser, changeId: string, ctx: RequestCtx) {
    const c = await this.prisma.mlSeoChange.findFirst({ where: { id: changeId, tenantId: user.tenantId, status: 'ENVIADA' } })
    if (!c) throw new NotFoundException('Envio não encontrado (ou já desfeito).')
    const seller = await this.seller(user.tenantId)
    const before = c.before as unknown as MlSeoFields
    const fields = c.sendFields.filter((k): k is MlSeoField => SENDABLE.has(k))
    if (!fields.length) throw new BadRequestException('Este envio não mudou nenhum campo.')
    let r: { done: MlSeoField[]; titleError: string | null }
    try {
      const live = await this.live(user.tenantId, c.itemId)
      if (live.sellerId !== seller) throw new Error('o anúncio não é da conta conectada do Mercado Livre')
      if (fields.includes('title') && !live.titleAllowed) throw new Error('o anúncio já tem vendas e o Mercado Livre não deixa mais mudar o título. Volte a descrição à mão, se precisar.')
      r = await this.write(user.tenantId, live, fields, before)
    } catch (err) {
      throw new BadRequestException(`O Mercado Livre não aceitou: ${(err as Error).message}`)
    }
    await this.prisma.mlSeoChange.update({ where: { id: c.id }, data: { status: 'DESFEITA', undoneAt: new Date() } })
    await this.live(user.tenantId, c.itemId).catch(() => undefined)
    await this.audit.byUser(user, ctx, 'seo_marketplace.desfeito', 'ml_item', c.itemId, { anuncio: c.itemId, campos: r.done })
    return { ok: true, message: r.titleError ? `Descrição de volta ao que era. O título não voltou: ${r.titleError}` : 'Textos de volta ao que eram no Mercado Livre.' }
  }
}
