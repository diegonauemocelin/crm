/**
 * Trajetória de cada pergunta: recebida → análise (IA, regras ou frete da Magazord) → resposta enviada ou pendência →
 * intervenção humana → resolução. Mesma lógica do painel, com o frete calculado na Magazord.
 */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { AssistAttempt, AssistItem, AssistQuestion, Prisma } from '../generated/prisma/client'
import { MagazordService } from '../integracoes/magazord.service'
import { type Actor, AssistService, SYSTEM } from './assist.service'
import { AssistMlService, type MlQuestionApi } from './assist-ml.service'
import { AssistKnowledgeService } from './conhecimento.service'
import { type AiSettings, FINAL_STATUSES, ML_ANSWER_LIMIT, REASONS } from './constantes'
import { buildAnswer, classifyQuestion, type FreightOption, parseFreightOptions } from './frete'
import { AiError, type AiResult, type AssistContext, type CtxIds, generateAnswer } from './ia'
import { codeKey, extractCodes, greetingFor, itemCodes, norm, normCode, questionSimilarity, searchTokens } from './texto'

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

@Injectable()
export class AssistPipelineService {
  private readonly logger = new Logger('Assistente')
  private readonly queue: { tenantId: string; id: number }[] = []
  private running = 0
  private static readonly CONCURRENCY = 2

  constructor(
    private readonly assist: AssistService,
    private readonly ml: AssistMlService,
    private readonly knowledge: AssistKnowledgeService,
    private readonly magazord: MagazordService,
  ) {}

  private get prisma() {
    return this.assist.prisma
  }

  // ---------- Busca nos anúncios da loja ----------

  /**
   * Anúncios ATIVOS da loja oficial que correspondem ao pedido: TÍTULO, CÓDIGO DE REFERÊNCIA e CÓDIGO OEM. Se o cliente
   * citou um modelo (ex.: 3C, 416E), o título precisa mencioná-lo ou o código precisa bater.
   */
  searchStoreItems(text: string, rows: AssistItem[], storeItems: Set<string>, o: { exclude?: string | null; limit?: number } = {}) {
    const hasDigit = (w: string) => /\d/.test(w)
    const chunks = String(text).split(/[\s,;?!]+/).map(codeKey).filter(Boolean)
    const qCodes = new Set([...extractCodes(text).map(codeKey), ...chunks, ...chunks.slice(1).map((c, i) => chunks[i] + c)].filter((c) => c.length >= 4 && hasDigit(c)))
    const active = rows.filter((r) => r.status === 'active' && storeItems.has(r.id))
    if (!active.length) return []
    const titles = new Map(active.map((r) => [r.id, new Set(searchTokens(r.title))]))
    const vocab = new Set([...titles.values()].flatMap((s) => [...s]))
    const q = searchTokens(text).filter((w) => vocab.has(w) || hasDigit(w))
    if (!q.length && !qCodes.size) return []
    const modelish = q.filter(hasDigit)
    const out: { r: AssistItem; score: number; matched: string[]; allTerms: boolean; encontrado: string[]; ref: string | null; oem: string | null }[] = []
    for (const r of active) {
      if (r.id === o.exclude) continue
      const { ref, oem } = itemCodes(r)
      const refHit = [...qCodes].filter((c) => ref.has(c))
      const oemHit = [...qCodes].filter((c) => oem.has(c))
      const title = titles.get(r.id)!
      const titleHit = q.filter((w) => title.has(w))
      const modelHit = modelish.some((w) => title.has(w))
      const score = titleHit.reduce((s, w) => s + (hasDigit(w) ? 4 : 2), 0) + refHit.length * 12 + oemHit.length * 12
      const codeHit = refHit.length + oemHit.length > 0
      if (!codeHit) {
        if (modelish.length && !modelHit) continue
        if (titleHit.length < Math.min(2, q.length)) continue
      }
      const encontrado = [titleHit.length ? 'título' : null, refHit.length ? 'código de referência' : null, oemHit.length ? 'código OEM' : null].filter(Boolean) as string[]
      out.push({ r, score, matched: titleHit, allTerms: codeHit || titleHit.length === q.length, encontrado, ref: [...ref].join(', ') || null, oem: [...oem].join(', ') || null })
    }
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, o.limit ?? 8)
  }

  async buildContext(tenantId: string, text: string, item: AssistItem | null, settings: AiSettings, freight?: AssistContext['frete_calculado']) {
    const codes = extractCodes(text)
    for (const c of [item?.partNumber, item?.sellerSku]) for (const p of String(c ?? '').split(/[,;]/)) if (normCode(p)) codes.push(normCode(p))
    const entities = await this.knowledge.detectKnownEntities(tenantId, `${text} ${item?.title ?? ''}`)
    const qEntities = await this.knowledge.detectKnownEntities(tenantId, text)
    const codeSet = new Set(codes)
    const knowledge = await this.knowledge.retrieve(tenantId, { text, item: item ? { id: item.id, title: item.title } : null, codes, brands: entities.brands, models: entities.models, allowedCategories: settings.allowed_categories })

    const [allApps, items] = await Promise.all([this.prisma.assistApplication.findMany({ where: { tenantId } }), this.prisma.assistItem.findMany({ where: { tenantId } })])
    const itemById = new Map(items.map((i) => [i.id, i]))
    const modelKey = (m: unknown) => norm(m).replace(/[^a-z0-9]+/g, '')
    const qModels = new Set(qEntities.models.map(modelKey))
    const apps = allApps.filter((a) => codeSet.has(normCode(a.partCode)) || (item && a.mlItemId === item.id) || qModels.has(modelKey(a.machineModel))).slice(0, 40)

    // modelos-alvo da venda adicional: citados pelo cliente, ou o único modelo confirmado do anúncio
    let targetModels = [...qModels]
    if (!targetModels.length && item) {
      const confirmed = new Set(apps.filter((a) => a.mlItemId === item.id && a.validationStatus === 'confirmada').map((a) => modelKey(a.machineModel)))
      if (confirmed.size === 1) targetModels = [...confirmed]
    }
    const storeItems = await this.ml.allowedLinkItemIds(tenantId)
    const complementary: typeof allApps = []
    if (settings.upsell_enabled && targetModels.length) {
      const seen = new Set([item?.id])
      for (const a of allApps) {
        if (a.validationStatus !== 'confirmada' || !a.mlItemId || seen.has(a.mlItemId)) continue
        if (!storeItems.has(a.mlItemId)) continue
        const st = itemById.get(a.mlItemId)?.status
        if (st && st !== 'active') continue
        if (!targetModels.includes(modelKey(a.machineModel))) continue
        seen.add(a.mlItemId)
        complementary.push(a)
        if (complementary.length >= 8) break
      }
    }
    const related: AssistItem[] = []
    if (codes.length) {
      for (const i of items) {
        if (i.id === item?.id || !storeItems.has(i.id)) continue
        const iCodes = [i.partNumber, i.sellerSku].flatMap((v) => String(v ?? '').split(/[,;]/)).map(normCode)
        if (iCodes.some((c) => c && codeSet.has(c))) related.push(i)
        if (related.length >= 5) break
      }
    }
    const already = new Set([...related.map((i) => i.id), ...complementary.map((a) => a.mlItemId)])
    const found = this.searchStoreItems(text, items, storeItems, { exclude: item?.id }).filter((f) => !already.has(f.r.id))

    const context: AssistContext = {
      anuncios_da_loja_encontrados: found.map((f) => ({
        id: f.r.id,
        titulo: f.r.title,
        codigo_referencia: f.ref,
        codigo_oem: f.oem,
        preco: num(f.r.price),
        estoque: f.r.availableQuantity,
        encontrado_por: f.encontrado.join(' e '),
        termos_do_titulo: f.matched,
        corresponde_a_todos_os_termos: f.allTerms,
      })),
      anuncio_da_pergunta: item
        ? {
            id: item.id,
            titulo: item.title,
            preco: num(item.price),
            moeda: item.currency,
            quantidade_disponivel: item.availableQuantity,
            status: item.status,
            codigo_peca: item.partNumber,
            sku: item.sellerSku,
            marca_peca: item.brand,
            descricao: String(item.description ?? '').slice(0, 3000),
            atributos: (Array.isArray(item.attributes) ? item.attributes : []).slice(0, 40),
          }
        : null,
      conhecimentos_aprovados: knowledge.map((k) => ({
        id: k.id,
        categoria: k.category,
        titulo: k.title,
        marca_maquina: k.brand,
        modelo: k.model,
        codigo: k.partCode,
        produto: k.product,
        aplicacao: k.application,
        pergunta: k.question,
        resposta_aprovada: k.answer,
        fonte: k.source,
        anuncio_id: k.mlItemId ?? undefined,
        semelhanca_com_a_pergunta: k.question ? Math.round(questionSimilarity(text, k.question) * 100) / 100 : undefined,
      })),
      aplicacoes: apps.map((a) => ({ codigo: a.partCode, produto: a.productName, marca_peca: a.partBrand, marca_maquina: a.machineBrand, modelo: a.machineModel, sistema: a.system, aplicacao: a.application, status_validacao: a.validationStatus, anuncio_id: a.mlItemId })),
      anuncios_relacionados_ao_codigo: related.map((i) => ({ id: i.id, titulo: i.title, codigo: i.partNumber ?? i.sellerSku, status: i.status })),
      anuncios_complementares: complementary.map((a) => ({ id: a.mlItemId!, titulo: itemById.get(a.mlItemId!)?.title ?? a.productName, codigo: a.partCode, sistema: a.system, aplicacao_confirmada: `${a.machineBrand ?? ''} ${a.machineModel ?? ''}`.trim() })),
      dados_detectados: { codigos: [...codeSet], marcas: entities.brands, modelos: entities.models },
      anuncios_com_link_permitido: [],
      frete_calculado: freight ?? null,
    }
    const linkIds = new Set(
      [
        item?.id,
        ...related.map((i) => i.id),
        ...complementary.map((a) => a.mlItemId),
        ...apps.map((a) => a.mlItemId),
        ...found.map((f) => f.r.id),
        ...knowledge.flatMap((k) => [...String(k.answer ?? '').matchAll(/\{\{LINK:([A-Z]{3}\d+)\}\}/g)].map((m) => m[1])),
      ].filter((id): id is string => !!id && storeItems.has(id)),
    )
    context.anuncios_com_link_permitido = [...linkIds]
    const ctxIds: CtxIds = { knowledge: new Set(knowledge.map((k) => k.id)), complementary: new Set(complementary.map((a) => a.mlItemId!)), links: linkIds }
    return { context, knowledge, ctxIds }
  }

  /** Troca {{LINK:ID}} pelo link real do anúncio e remove qualquer outra URL (só anúncios ativos da loja oficial). */
  async renderAnswer(tenantId: string, text: string, linkIds: Set<string>) {
    const store = await this.ml.allowedLinkItemIds(tenantId)
    const rows = await this.prisma.assistItem.findMany({ where: { tenantId, id: { in: [...linkIds] } }, select: { id: true, permalink: true } })
    const permalinks = new Map(rows.filter((r) => store.has(r.id) && r.permalink).map((r) => [r.id, r.permalink!]))
    let out = String(text ?? '').replace(/\{\{LINK:([A-Z]{3}\d+)\}\}/g, (_, id: string) => permalinks.get(id) ?? '')
    const allowed = new Set(permalinks.values())
    out = out.replace(/https?:\/\/\S+/g, (u) => (allowed.has(u.replace(/[).,;]+$/, '')) ? u : ''))
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  // ---------- Frete (Magazord) ----------

  /** Cotação para o anúncio e o CEP: SKU do anúncio → simulação de frete da Magazord. */
  async quoteFreight(tenantId: string, item: AssistItem | null, cep: string) {
    if (!item?.sellerSku) throw new Error('O anúncio não tem SKU do vendedor para achar o produto na Magazord.')
    const raw = await this.magazord.simulateFreight(tenantId, cep, [{ sku: item.sellerSku, quantity: 1, price: num(item.price) ?? 0 }])
    return { options: parseFreightOptions(raw), raw }
  }

  // ---------- Entrada de perguntas (webhook e leitura periódica) ----------

  async ingest(tenantId: string, mlQ: MlQuestionApi, source: string) {
    const mlId = String(mlQ.id)
    const existing = await this.prisma.assistQuestion.findUnique({ where: { tenantId_mlQuestionId: { tenantId, mlQuestionId: mlId } } })
    if (existing) {
      await this.prisma.assistQuestion.update({ where: { id: existing.id }, data: { mlStatus: mlQ.status } })
      const sent = await this.prisma.assistAttempt.findFirst({ where: { questionId: existing.id, sendStatus: 'enviada' }, select: { id: true } })
      if (mlQ.status === 'ANSWERED' && !sent && !FINAL_STATUSES.includes(existing.status)) {
        await this.assist.setStatus(tenantId, existing.id, 'respondida', { note: 'Respondida diretamente no Mercado Livre (fora do sistema).', type: 'respondida_externamente' })
        await this.markExternalAnswer(existing.id, mlQ.answer)
        if (mlQ.answer?.text) await this.safeLearn(tenantId, existing.id, mlQ.answer.text, 'externa')
      }
      return existing.id
    }
    const status = mlQ.status === 'UNANSWERED' ? 'nova' : mlQ.status === 'ANSWERED' ? 'respondida' : 'nao_aplicavel'
    const now = new Date()
    let row: AssistQuestion
    try {
      row = await this.prisma.assistQuestion.create({
        data: { tenantId, mlQuestionId: mlId, mlItemId: mlQ.item_id, mlStatus: mlQ.status, customerId: mlQ.from?.id ? String(mlQ.from.id) : null, text: String(mlQ.text ?? ''), receivedAt: mlQ.date_created ? new Date(mlQ.date_created) : now, firstSeenAt: now, status },
      })
    } catch {
      // chegou ao mesmo tempo pelo webhook e pela leitura periódica
      return (await this.prisma.assistQuestion.findUniqueOrThrow({ where: { tenantId_mlQuestionId: { tenantId, mlQuestionId: mlId } } })).id
    }
    if (mlQ.status === 'ANSWERED') await this.markExternalAnswer(row.id, mlQ.answer)
    await this.assist.addEvent(tenantId, row.id, 'recebida', { to: status, note: `Pergunta recebida via ${source}.`, data: { ml_status: mlQ.status } })
    if (mlQ.from?.id) {
      void this.ml.publicUser(mlQ.from.id).then((u) => (u?.nickname ? this.prisma.assistQuestion.update({ where: { id: row.id }, data: { customerNickname: u.nickname } }) : null)).catch(() => null)
    }
    if (status === 'nova') this.enqueue(tenantId, row.id)
    return row.id
  }

  /** Completa o apelido do cliente nas perguntas em que a consulta falhou (até 20 clientes por rodada). */
  async fillCustomerNicknames(tenantId: string) {
    const rows = await this.prisma.assistQuestion.findMany({
      where: { tenantId, customerId: { not: null }, customerNickname: null, OR: [{ customerLookupAt: null }, { customerLookupAt: { lt: new Date(Date.now() - 86_400_000) } }] },
      distinct: ['customerId'],
      select: { customerId: true },
      take: 20,
    })
    for (const { customerId } of rows) {
      const u = await this.ml.publicUser(customerId!)
      await this.prisma.assistQuestion.updateMany({ where: { tenantId, customerId }, data: { customerLookupAt: new Date() } })
      if (u?.nickname) await this.prisma.assistQuestion.updateMany({ where: { tenantId, customerId, customerNickname: null }, data: { customerNickname: u.nickname } })
    }
    return rows.length
  }

  async syncQuestions(tenantId: string) {
    if (!(await this.ml.active(tenantId))) return { skipped: true, found: 0, created: 0 }
    const seller = await this.ml.sellerId(tenantId)
    const list = await this.ml.listUnanswered(tenantId, seller!)
    let created = 0
    for (const q of list) {
      const before = await this.prisma.assistQuestion.findUnique({ where: { tenantId_mlQuestionId: { tenantId, mlQuestionId: String(q.id) } }, select: { id: true } })
      await this.ingest(tenantId, q, 'sincronização')
      if (!before) created++
    }
    await this.assist.patchState(tenantId, { lastQuestionsSyncAt: new Date().toISOString() })
    return { skipped: false, found: list.length, created }
  }

  // ---------- Fila de processamento ----------

  enqueue(tenantId: string, id: number) {
    if (!this.queue.some((x) => x.tenantId === tenantId && x.id === id)) this.queue.push({ tenantId, id })
    this.pump()
  }

  private pump() {
    while (this.running < AssistPipelineService.CONCURRENCY && this.queue.length) {
      const { tenantId, id } = this.queue.shift()!
      this.running++
      this.process(tenantId, id)
        .catch((e: unknown) => this.logger.error(`Falha ao processar a pergunta #${id}: ${(e as Error).message}`))
        .finally(() => {
          this.running--
          this.pump()
        })
    }
  }

  /** Recoloca na fila as perguntas novas que ficaram sem processamento (ex.: o sistema reiniciou). */
  async recoverQueue(tenantId: string) {
    await this.prisma.assistQuestion.updateMany({ where: { tenantId, processingState: 'processando', processingStartedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { processingState: 'ocioso' } })
    for (const q of await this.prisma.assistQuestion.findMany({ where: { tenantId, status: 'nova', processingState: 'ocioso' }, select: { id: true } })) this.enqueue(tenantId, q.id)
  }

  /** Perguntas que ficaram na fila porque a IA estava indisponível voltam a ser analisadas após 10 min (até 3 vezes). */
  async retryAiFailures(tenantId: string) {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT q.id FROM assist_questions q
       WHERE q."tenantId" = ${tenantId}::uuid AND q.status = 'aguardando_analise' AND q."pendingReason" = 'F' AND q."updatedAt" < ${new Date(Date.now() - 10 * 60_000)}
         AND (SELECT COUNT(*) FROM assist_events e WHERE e."questionId" = q.id AND e.type = 'reanalise_automatica') < 3
         AND (SELECT e.note FROM assist_events e WHERE e."questionId" = q.id AND e.type = 'tentativa_consulta' ORDER BY e.id DESC LIMIT 1) LIKE 'Falha na IA%'
         AND NOT EXISTS (SELECT 1 FROM assist_attempts a WHERE a."questionId" = q.id AND a."sendStatus" IN ('enviada','enviando','pendente_confirmacao'))`
    for (const { id } of rows) {
      await this.assist.addEvent(tenantId, id, 'reanalise_automatica', { note: 'Nova análise automática após indisponibilidade temporária da IA.' })
      this.enqueue(tenantId, id)
    }
    return rows.length
  }

  private async markPending(tenantId: string, q: { id: number }, reason: string, note: string, actor?: Actor) {
    await this.assist.setStatus(tenantId, q.id, 'aguardando_analise', { reason, note, actor, type: 'pendencia' })
  }

  async process(tenantId: string, questionId: number, actor: Actor = SYSTEM) {
    const lock = await this.prisma.assistQuestion.updateMany({ where: { id: questionId, tenantId, processingState: { not: 'processando' } }, data: { processingState: 'processando', processingStartedAt: new Date() } })
    if (!lock.count) return { skipped: 'em processamento' }
    try {
      const q = await this.prisma.assistQuestion.findFirst({ where: { id: questionId, tenantId } })
      if (!q || FINAL_STATUSES.includes(q.status)) return { skipped: 'finalizada' }
      if (await this.prisma.assistAttempt.findFirst({ where: { questionId: q.id, sendStatus: { in: ['enviada', 'enviando', 'pendente_confirmacao'] } }, select: { id: true } })) return { skipped: 'já possui resposta enviada ou em envio' }
      const settings = await this.assist.ai(tenantId)

      let item: AssistItem | null = null
      try {
        item = await this.ml.getItemCached(tenantId, q.mlItemId)
      } catch (e) {
        await this.assist.log(tenantId, 'error', (e as Error).message)
        await this.assist.addEvent(tenantId, q.id, 'tentativa_consulta', { note: `Falha ao consultar o anúncio ${q.mlItemId}: ${(e as Error).message}` })
        await this.markPending(tenantId, q, 'F', 'Não foi possível consultar o anúncio na API do Mercado Livre.', actor)
        return { pending: 'F' }
      }

      // Frete: calculado na Magazord para o CEP citado (ou pedido do CEP, sem calcular nada).
      const freight = settings.frete_enabled ? classifyQuestion(q.text) : null
      let freightCtx: AssistContext['frete_calculado'] = null
      let freightResult: AiResult | null = null
      let freightOptions: FreightOption[] | null = null
      const greeting = settings.greeting_by_time ? greetingFor() : 'Olá!'
      if (freight?.cep) {
        try {
          const r = await this.quoteFreight(tenantId, item, freight.cep)
          freightOptions = r.options
          if (r.options.length) freightCtx = { cep: freight.cep, opcoes: r.options.map((o) => ({ nome: o.name, valor: o.price, prazo_dias_uteis: o.days })) }
          await this.assist.addEvent(tenantId, q.id, 'frete_calculado', { note: r.options.length ? `Frete da Magazord para o CEP ${freight.cep}: ${r.options.length} opção(ões).` : `A Magazord não devolveu opção de frete para o CEP ${freight.cep}.`, data: { cep: freight.cep, options: r.options } })
        } catch (e) {
          await this.assist.addEvent(tenantId, q.id, 'frete_calculado', { note: `Frete não calculado: ${(e as Error).message}` })
        }
        if (freight.kind === 'frete') {
          freightResult = freightCtx
            ? baseResult({ decision: 'responder', confidence: 0.95, answer: `${greeting}\n${buildAnswer({ intro: settings.frete_intro, outro: settings.frete_outro }, freight.cep, freightOptions!)}`, reason_explanation: `Frete calculado pela Magazord para o CEP ${freight.cep}.`, found_info: freightOptions!.map((o) => `${o.name}: R$ ${o.price}`) })
            : baseResult({ decision: 'encaminhar', pending_reason: 'G', reason_explanation: 'Pergunta de frete, mas a Magazord não calculou o frete para este CEP e produto.', missing_info: ['Frete para o CEP'], suggested_routing: 'Atendente informar o frete.' })
        }
      } else if (freight?.kind === 'frete_sem_cep' && settings.frete_ask_cep) {
        freightResult = baseResult({ decision: 'solicitar_info', pending_reason: 'B', confidence: 0.95, answer: `${greeting}\n${settings.frete_ask_cep_text}`, reason_explanation: 'Pergunta de frete sem CEP: pedido o CEP ao cliente.', missing_info: ['CEP de entrega'] })
      }

      const { context, knowledge, ctxIds } = await this.buildContext(tenantId, q.text, item, settings, freightCtx)
      await this.assist.addEvent(tenantId, q.id, 'analise_ia', { actor, note: `Consulta: ${knowledge.length} conhecimento(s), ${context.aplicacoes.length} aplicação(ões), ${context.anuncios_complementares.length} complementar(es).` })

      let gen: { result: AiResult; model: string }
      if (freightResult) gen = { result: freightResult, model: 'frete-magazord' }
      else {
        try {
          gen = await generateAnswer({ settings, context, question: q.text, greeting, ctxIds, keys: { claude: await this.assist.apiKey(tenantId, 'claude'), gemini: await this.assist.apiKey(tenantId, 'gemini') } })
        } catch (e) {
          const reason = e instanceof AiError && !e.retryable ? 'G' : 'F'
          await this.assist.log(tenantId, 'error', `Pergunta #${q.id}: ${(e as Error).message}`)
          await this.assist.addEvent(tenantId, q.id, 'tentativa_consulta', { note: `Falha na IA: ${(e as Error).message}` })
          await this.markPending(tenantId, q, reason, (e as Error).message, actor)
          return { pending: reason }
        }
      }
      const r = gen.result
      const text = await this.renderAnswer(tenantId, r.answer, ctxIds.links)
      const kind = r.decision === 'solicitar_info' ? 'solicitar_info' : 'resposta'
      const complementaryLinks = r.complementary_item_ids.length ? await this.prisma.assistItem.findMany({ where: { tenantId, id: { in: r.complementary_item_ids } }, select: { id: true, title: true, permalink: true } }) : []

      const attempt = await this.prisma.assistAttempt.create({
        data: {
          tenantId,
          questionId: q.id,
          origin: 'ia',
          kind,
          text,
          confidence: r.confidence,
          sendStatus: 'preparada',
          ai: {
            ...r,
            model: gen.model,
            raw_answer: r.answer,
            complementary_links: complementaryLinks,
            item_snapshot: item ? { id: item.id, title: item.title, permalink: item.permalink, part_number: item.partNumber } : null,
            context_counts: { conhecimentos: knowledge.length, aplicacoes: context.aplicacoes.length, complementares: context.anuncios_complementares.length },
            detected: context.dados_detectados,
            freight: freightOptions,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      for (const k of knowledge.filter((k) => r.knowledge_ids_used.includes(k.id))) {
        await this.prisma.assistAttemptKnowledge.upsert({ where: { attemptId_knowledgeId: { attemptId: attempt.id, knowledgeId: k.id } }, create: { attemptId: attempt.id, knowledgeId: k.id, knowledgeVersion: k.version }, update: {} })
      }
      await this.prisma.assistQuestion.update({
        where: { id: q.id },
        data: { brand: r.detected_brand || q.brand, model: r.detected_model || q.model, partCode: r.detected_part_code || q.partCode, purchaseIntent: r.purchase_intent, confidence: r.confidence },
      })
      await this.assist.addEvent(tenantId, q.id, 'resposta_preparada', { actor, note: `${gen.model === 'frete-magazord' ? 'Frete' : 'IA'}: ${r.decision} (confiança ${Math.round(r.confidence * 100)}%). ${r.reason_explanation}`, data: { attempt_id: attempt.id } })

      const active = await this.ml.active(tenantId)
      const autoOn = settings.auto_reply && active
      const sendable = text.length > 0 && text.length <= ML_ANSWER_LIMIT && text.length <= Number(settings.max_answer_chars) + 100
      const shouldSend = autoOn && sendable && ((r.decision === 'responder' && r.confidence >= Number(settings.min_confidence)) || (r.decision === 'solicitar_info' && settings.request_info_mode === 'enviar'))
      if (shouldSend) {
        await this.sendAttempt(tenantId, attempt.id, null)
        return { sent: true, attemptId: attempt.id }
      }
      let reason = r.pending_reason ?? 'G'
      let note = r.reason_explanation
      if (r.decision === 'responder') {
        reason = 'G'
        if (!settings.auto_reply) note = 'Resposta automática desativada: sugestão aguardando aprovação humana.'
        else if (!active) note = 'O CRM ainda não assumiu o atendimento do Mercado Livre (ou a integração está inativa): sugestão aguardando envio.'
        else if (!sendable) note = 'Resposta excede o limite de caracteres: revisar antes de enviar.'
        else note = `Confiança abaixo do mínimo configurado (${Math.round(settings.min_confidence * 100)}%).`
      }
      await this.prisma.assistAttempt.update({ where: { id: attempt.id }, data: { sendStatus: text ? 'pendente_aprovacao' : 'descartada' } })
      await this.markPending(tenantId, q, reason, `${REASONS[reason] ?? reason}: ${note}`, actor)
      return { pending: reason, attemptId: attempt.id }
    } finally {
      await this.prisma.assistQuestion.updateMany({ where: { id: questionId, tenantId }, data: { processingState: 'ocioso' } })
    }
  }

  // ---------- Envio ao Mercado Livre (sem respostas duplicadas) ----------

  async sendAttempt(tenantId: string, attemptId: number, actor: Actor | null) {
    const a = await this.prisma.assistAttempt.findFirst({ where: { id: attemptId, tenantId } })
    if (!a) throw new NotFoundException('Resposta não encontrada.')
    const q = await this.prisma.assistQuestion.findUniqueOrThrow({ where: { id: a.questionId } })
    if (!(await this.ml.active(tenantId))) throw new ConflictException('O CRM ainda não assumiu o atendimento do Mercado Livre (ou a conexão não foi testada). Veja Assistente › Integração.')
    if (!a.text || a.text.length > ML_ANSWER_LIMIT) throw new BadRequestException(`A resposta deve ter entre 1 e ${ML_ANSWER_LIMIT} caracteres.`)
    await this.prisma.$transaction(async (tx) => {
      const busy = await tx.assistAttempt.findFirst({ where: { questionId: q.id, id: { not: a.id }, sendStatus: { in: ['enviando', 'enviada', 'pendente_confirmacao'] } }, select: { id: true } })
      if (busy) throw new ConflictException('Esta pergunta já tem uma resposta enviada ou em envio.')
      const upd = await tx.assistAttempt.updateMany({
        where: { id: a.id, sendStatus: { in: ['preparada', 'pendente_aprovacao', 'falha'] } },
        data: { sendStatus: 'enviando', sendRequestedAt: new Date(), sendAttempts: { increment: 1 }, error: null, ...(actor ? { reviewed: true, reviewedById: actor.id, reviewedByName: actor.name } : {}) },
      })
      if (!upd.count) throw new ConflictException('Esta resposta não pode ser enviada no estado atual.')
    })
    await this.assist.addEvent(tenantId, q.id, 'envio_solicitado', { actor: actor ?? undefined, data: { attempt_id: a.id } })

    let current: MlQuestionApi
    try {
      current = await this.ml.getQuestion(tenantId, q.mlQuestionId)
    } catch (e) {
      return this.failSend(tenantId, a, q, e as Error & { status?: number }, false)
    }
    if (current.status !== 'UNANSWERED') {
      await this.prisma.assistAttempt.update({ where: { id: a.id }, data: { sendStatus: 'descartada', error: `Pergunta não está mais aberta no Mercado Livre (situação ${current.status}).` } })
      await this.prisma.assistQuestion.update({ where: { id: q.id }, data: { mlStatus: current.status } })
      await this.assist.setStatus(tenantId, q.id, current.status === 'ANSWERED' ? 'respondida' : 'nao_aplicavel', { actor: actor ?? undefined, note: `Envio cancelado: a pergunta já está com situação ${current.status} no Mercado Livre.`, type: 'respondida_externamente' })
      if (current.status === 'ANSWERED') {
        await this.markExternalAnswer(q.id, current.answer)
        if (current.answer?.text) await this.safeLearn(tenantId, q.id, current.answer.text, 'externa')
      }
      return { sent: false, reason: current.status }
    }
    let res: Awaited<ReturnType<AssistMlService['postAnswer']>>
    try {
      res = await this.ml.postAnswer(tenantId, q.mlQuestionId, a.text)
    } catch (e) {
      // erro de rede depois do POST: o envio pode ter ocorrido → confirmar depois, nunca reenviar às cegas
      const status = (e as { status?: number }).status
      return this.failSend(tenantId, a, q, e as Error, status === undefined || status === 0)
    }
    const confirmed = res?.status === 'ANSWERED' || !!res?.answer?.text || !!res?.id
    if (!confirmed) {
      await this.prisma.assistAttempt.update({ where: { id: a.id }, data: { sendStatus: 'pendente_confirmacao', mlResponse: res as unknown as Prisma.InputJsonValue } })
      await this.assist.addEvent(tenantId, q.id, 'envio_sem_confirmacao', { note: 'O Mercado Livre não confirmou o envio; verificação automática agendada.' })
      return { sent: false, pendingConfirmation: true }
    }
    await this.confirmSent(tenantId, a, q, res, actor)
    return { sent: true }
  }

  private async confirmSent(tenantId: string, a: AssistAttempt, q: AssistQuestion, res: unknown, actor: Actor | null) {
    const now = new Date()
    const ref = (res as { id?: number | string } | null)?.id
    await this.prisma.assistAttempt.update({ where: { id: a.id }, data: { sendStatus: 'enviada', sentAt: a.sendRequestedAt ?? now, confirmedAt: now, mlResponse: res as Prisma.InputJsonValue, mlAnswerRef: String(ref ?? q.mlQuestionId) } })
    await this.prisma.assistQuestion.update({ where: { id: q.id }, data: { mlStatus: 'ANSWERED' } })
    await this.assist.setStatus(tenantId, q.id, a.kind === 'solicitar_info' ? 'aguardando_cliente' : 'respondida', {
      actor: actor ?? undefined,
      note: a.kind === 'solicitar_info' ? 'Pedido de informações enviado ao cliente.' : `Resposta enviada (${a.origin === 'ia' ? 'automática' : 'atendente'}) e confirmada pelo Mercado Livre.`,
      type: 'resposta_enviada',
    })
    // aprendizado: resposta escrita por uma pessoa ou sugestão aprovada por uma pessoa
    const humanValidated = a.origin === 'atendente' || a.reviewed || !!actor
    const model = String((a.ai as { model?: string } | null)?.model ?? '')
    if (a.kind !== 'solicitar_info' && humanValidated) {
      const who = actor ?? { id: a.authorId ?? a.reviewedById, name: a.authorName ?? a.reviewedByName }
      await this.safeLearn(tenantId, q.id, a.text, a.origin === 'atendente' ? 'manual' : 'aprovada', who)
    } else if (a.kind !== 'solicitar_info' && a.origin === 'ia' && !model.startsWith('sem-ia') && model !== 'frete-magazord') {
      await this.safeLearn(tenantId, q.id, a.text, 'ia')
    }
  }

  private async markExternalAnswer(questionId: number, answer: MlQuestionApi['answer']) {
    if (!answer?.date_created) return
    const q = await this.prisma.assistQuestion.findUnique({ where: { id: questionId }, select: { externalAnsweredAt: true } })
    if (!q?.externalAnsweredAt) await this.prisma.assistQuestion.update({ where: { id: questionId }, data: { externalAnsweredAt: new Date(answer.date_created) } })
  }

  private async safeLearn(tenantId: string, questionId: number, answerText: string, how: 'manual' | 'aprovada' | 'externa' | 'ia', actor?: Actor) {
    try {
      return await this.knowledge.learn(tenantId, { questionId, answerText, how, actor })
    } catch (e) {
      await this.assist.log(tenantId, 'error', `Falha ao aprender da pergunta #${questionId}: ${(e as Error).message}`)
      return null
    }
  }

  private async failSend(tenantId: string, a: AssistAttempt, q: AssistQuestion, err: Error, ambiguous: boolean) {
    await this.prisma.assistAttempt.update({ where: { id: a.id }, data: { sendStatus: ambiguous ? 'pendente_confirmacao' : 'falha', error: String(err.message).slice(0, 1000) } })
    await this.assist.log(tenantId, 'error', `Envio da resposta #${a.id} (pergunta ${q.mlQuestionId}) falhou: ${err.message}`)
    if (!ambiguous) await this.markPending(tenantId, q, 'F', `Falha no envio: ${err.message}`)
    else await this.assist.addEvent(tenantId, q.id, 'envio_sem_confirmacao', { note: `Sem confirmação do envio (${err.message}); será verificado automaticamente.` })
    return { sent: false, error: err.message }
  }

  /** Confere respostas sem confirmação consultando a situação real da pergunta. */
  async verifyPendingConfirmations(tenantId: string) {
    const rows = await this.prisma.assistAttempt.findMany({ where: { tenantId, sendStatus: { in: ['pendente_confirmacao', 'enviando'] }, sendRequestedAt: { lt: new Date(Date.now() - 60_000) } } })
    for (const a of rows) {
      const q = await this.prisma.assistQuestion.findUniqueOrThrow({ where: { id: a.questionId } })
      try {
        const cur = await this.ml.getQuestion(tenantId, q.mlQuestionId)
        if (cur.status === 'ANSWERED') {
          if (norm(cur.answer?.text) === norm(a.text)) await this.confirmSent(tenantId, a, q, cur, null)
          else {
            await this.prisma.assistAttempt.update({ where: { id: a.id }, data: { sendStatus: 'descartada', error: 'Pergunta respondida por outra via.' } })
            await this.assist.setStatus(tenantId, q.id, 'respondida', { note: 'Respondida fora do sistema.', type: 'respondida_externamente' })
            await this.markExternalAnswer(q.id, cur.answer)
            if (cur.answer?.text) await this.safeLearn(tenantId, q.id, cur.answer.text, 'externa')
          }
        } else if (cur.status === 'UNANSWERED' && a.sendRequestedAt && Date.now() - a.sendRequestedAt.getTime() > 10 * 60_000) {
          await this.prisma.assistAttempt.update({ where: { id: a.id }, data: { sendStatus: 'falha', error: 'Envio não confirmado pelo Mercado Livre. Nova tentativa liberada.' } })
          await this.markPending(tenantId, q, 'F', 'Envio não confirmado pelo Mercado Livre.')
        }
      } catch (e) {
        await this.assist.log(tenantId, 'warn', `Verificação da resposta #${a.id}: ${(e as Error).message}`)
      }
    }
  }

  // ---------- Ações humanas ----------

  async manualAnswer(tenantId: string, questionId: number, text: string, actor: Actor, o: { kind?: 'resposta' | 'solicitar_info'; basedOn?: number | null } = {}) {
    const q = await this.prisma.assistQuestion.findFirst({ where: { id: questionId, tenantId } })
    if (!q) throw new NotFoundException('Pergunta não encontrada.')
    if (FINAL_STATUSES.includes(q.status)) throw new ConflictException('Esta pergunta já foi finalizada.')
    const clean = String(text ?? '').trim()
    if (!clean) throw new BadRequestException('Escreva a resposta.')
    if (clean.length > ML_ANSWER_LIMIT) throw new BadRequestException(`O Mercado Livre aceita no máximo ${ML_ANSWER_LIMIT} caracteres.`)
    if (!(await this.ml.active(tenantId))) throw new ConflictException('O CRM ainda não assumiu o atendimento do Mercado Livre (ou a conexão não foi testada). Veja Assistente › Integração.')
    const att = await this.prisma.assistAttempt.create({
      data: { tenantId, questionId: q.id, origin: 'atendente', kind: o.kind ?? 'resposta', authorId: actor.id, authorName: actor.name, basedOnId: o.basedOn ?? null, text: clean, sendStatus: 'preparada', reviewed: true, reviewedById: actor.id, reviewedByName: actor.name },
    })
    if (o.basedOn) {
      // a sugestão original fica guardada, marcada como substituída
      await this.prisma.assistAttempt.updateMany({ where: { id: o.basedOn, sendStatus: { in: ['pendente_aprovacao', 'preparada', 'falha'] } }, data: { sendStatus: 'descartada', error: 'Substituída por versão revisada pelo atendente.' } })
      for (const k of await this.prisma.assistAttemptKnowledge.findMany({ where: { attemptId: o.basedOn } })) {
        await this.prisma.assistAttemptKnowledge.upsert({ where: { attemptId_knowledgeId: { attemptId: att.id, knowledgeId: k.knowledgeId } }, create: { attemptId: att.id, knowledgeId: k.knowledgeId, knowledgeVersion: k.knowledgeVersion }, update: {} })
      }
    }
    return { attemptId: att.id, ...(await this.sendAttempt(tenantId, att.id, actor)) }
  }

  /** Pergunta objetiva ao cliente com base no que faltou na análise. */
  async draftRequestInfo(tenantId: string, questionId: number) {
    const q = await this.prisma.assistQuestion.findFirst({ where: { id: questionId, tenantId } })
    if (!q) throw new NotFoundException('Pergunta não encontrada.')
    const last = await this.prisma.assistAttempt.findFirst({ where: { questionId: q.id, origin: 'ia' }, orderBy: { id: 'desc' }, select: { ai: true } })
    const missing = ((last?.ai as { missing_info?: string[] } | null)?.missing_info ?? []).filter(Boolean)
    const items = missing.length ? missing.slice(0, 3).join(', ').toLowerCase() : 'o modelo completo da máquina, o ano e, se possível, o código da peça original'
    return `${greetingFor()}\nPara confirmarmos a compatibilidade com segurança, poderia nos informar ${items}?\nAssim verificamos a aplicação correta e evitamos que você adquira um item incompatível.`
  }

  /** "Testar assistente": gera a resposta como numa pergunta real, sem enviar nada. */
  async test(tenantId: string, question: string, itemId: string | null) {
    const settings = await this.assist.ai(tenantId)
    let item: AssistItem | null = null
    if (itemId) {
      item = await this.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId, id: itemId } } })
      if (!item) item = await this.ml.getItemCached(tenantId, itemId).catch(() => null)
      if (!item) throw new BadRequestException('Anúncio não encontrado entre os anúncios sincronizados.')
    }
    const greeting = settings.greeting_by_time ? greetingFor() : 'Olá!'
    const freight = settings.frete_enabled ? classifyQuestion(question) : null
    let freightCtx: AssistContext['frete_calculado'] = null
    let freightNote: string | null = null
    if (freight?.cep) {
      try {
        const r = await this.quoteFreight(tenantId, item, freight.cep)
        if (r.options.length) freightCtx = { cep: freight.cep, opcoes: r.options.map((o) => ({ nome: o.name, valor: o.price, prazo_dias_uteis: o.days })) }
        freightNote = r.options.length ? null : 'A Magazord não devolveu opção de frete para este CEP e produto.'
      } catch (e) {
        freightNote = (e as Error).message
      }
    }
    const { context, knowledge, ctxIds } = await this.buildContext(tenantId, question, item, settings, freightCtx)
    let gen: { result: AiResult; model: string }
    if (freight?.kind === 'frete' && freightCtx) {
      gen = { result: baseResult({ decision: 'responder', confidence: 0.95, answer: `${greeting}\n${buildAnswer({ intro: settings.frete_intro, outro: settings.frete_outro }, freight.cep!, freightCtx.opcoes.map((o) => ({ name: o.nome, price: o.valor, days: o.prazo_dias_uteis })))}`, reason_explanation: 'Frete calculado pela Magazord.' }), model: 'frete-magazord' }
    } else if (freight?.kind === 'frete_sem_cep' && settings.frete_ask_cep) {
      gen = { result: baseResult({ decision: 'solicitar_info', pending_reason: 'B', confidence: 0.95, answer: `${greeting}\n${settings.frete_ask_cep_text}`, reason_explanation: 'Pergunta de frete sem CEP: pedido o CEP ao cliente.' }), model: 'frete-magazord' }
    } else {
      try {
        gen = await generateAnswer({ settings, context, question, greeting, ctxIds, keys: { claude: await this.assist.apiKey(tenantId, 'claude'), gemini: await this.assist.apiKey(tenantId, 'gemini') } })
      } catch (e) {
        if (e instanceof AiError) throw new BadRequestException(e.message)
        throw e
      }
    }
    const text = await this.renderAnswer(tenantId, gen.result.answer, ctxIds.links)
    const used = knowledge.filter((k) => gen.result.knowledge_ids_used.includes(k.id))
    return {
      answer: text,
      storeConfigured: !!(await this.assist.store(tenantId)).seller_id,
      result: gen.result,
      model: gen.model,
      freight: freightCtx,
      freightNote,
      wouldAutoSend: settings.auto_reply && gen.result.decision === 'responder' && gen.result.confidence >= settings.min_confidence,
      knowledgeUsed: used.map((k) => ({ id: k.id, title: k.title, category: k.category, version: k.version })),
      knowledgeConsidered: knowledge.map((k) => ({ id: k.id, title: k.title, category: k.category })),
      context: { item: item ? { id: item.id, title: item.title } : null, applications: context.aplicacoes.length, complementary: context.anuncios_complementares, detected: context.dados_detectados },
    }
  }
}

function baseResult(o: Partial<AiResult>): AiResult {
  return {
    decision: 'encaminhar',
    answer: '',
    confidence: 0,
    pending_reason: null,
    reason_explanation: '',
    found_info: [],
    missing_info: [],
    knowledge_ids_used: [],
    complementary_item_ids: [],
    detected_brand: '',
    detected_model: '',
    detected_part_code: '',
    purchase_intent: false,
    suggested_routing: '',
    ...o,
  }
}
