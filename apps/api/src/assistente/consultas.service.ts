/** Consultas das telas do assistente: perguntas, fila de pendentes, respostas enviadas, base, aplicações e painel. */
import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { AssistService } from './assist.service'
import { ABANDON_HOURS, FINAL_STATUSES, KNOWLEDGE_CATEGORIES, KNOWLEDGE_STATUSES, PENDING_STATUSES, QUESTION_STATUSES, REASONS } from './constantes'
import { AssistSalesService } from './vendas.service'
import { computePriority, localDate, normCode, startOfLocalDay, startOfLocalMonth } from './texto'

const list = (arr: string[]) => Prisma.join(arr)
const SOLD = Prisma.sql`s."orderStatus" IN ('paid','partially_paid','partially_refunded')`
const OUTCOME = Prisma.sql`CASE
  WHEN s."orderStatus" IN ('paid','partially_paid','partially_refunded') THEN 'comprou'
  WHEN s."orderStatus" IN ('cancelled','invalid') AND s."paidBefore" THEN 'cancelou_apos_pagar'
  WHEN s."orderStatus" IN ('cancelled','invalid') THEN 'desistiu_checkout'
  WHEN s."orderDate" < now() - interval '${Prisma.raw(String(ABANDON_HOURS))} hours' THEN 'desistiu_checkout'
  ELSE 'aguardando_pagamento' END`
const ABANDON = Prisma.sql`(${OUTCOME}) = 'desistiu_checkout'`
/** Origem da primeira resposta da pergunta: ia | atendente | externa | sem_resposta. */
const ANSWER_ORIGIN = Prisma.sql`COALESCE(
  (SELECT a.origin FROM assist_attempts a WHERE a."questionId" = q.id AND a."sendStatus" = 'enviada' ORDER BY a."sentAt" LIMIT 1),
  CASE WHEN q."externalAnsweredAt" IS NOT NULL OR q."mlStatus" = 'ANSWERED' THEN 'externa' ELSE 'sem_resposta' END)`

const VIEWS: Record<string, Prisma.Sql | null> = {
  todas: null,
  respondidas: Prisma.sql`q.status IN ('respondida','resolvida')`,
  aguardando: Prisma.sql`q.status IN (${list(PENDING_STATUSES)})`,
  encaminhadas: Prisma.sql`q.status IN (${list(PENDING_STATUSES)}) AND (q."assignedToId" IS NOT NULL OR q."assignedToName" IS NOT NULL OR q.status IN ('em_atendimento','aguardando_validacao'))`,
  revisao: Prisma.sql`EXISTS (SELECT 1 FROM assist_attempts r WHERE r."questionId" = q.id AND (r."sendStatus" = 'pendente_aprovacao' OR r."flaggedForReview"))`,
  erro: Prisma.sql`q."pendingReason" = 'F' AND q.status IN (${list(PENDING_STATUSES)})`,
  com_venda: Prisma.sql`EXISTS (SELECT 1 FROM assist_sales s WHERE s."questionId" = q.id AND ${SOLD})`,
  desistiu_checkout: Prisma.sql`EXISTS (SELECT 1 FROM assist_sales s WHERE s."questionId" = q.id AND ${ABANDON}) AND NOT EXISTS (SELECT 1 FROM assist_sales s WHERE s."questionId" = q.id AND ${SOLD})`,
}

const SELECT_ROW = Prisma.sql`
  SELECT q.*, i.title AS "itemTitle", i.permalink AS "itemPermalink",
         a.id AS "attemptId", a.text AS "attemptText", a."sendStatus" AS "attemptStatus", a.origin AS "attemptOrigin", a.reviewed AS "attemptReviewed", a.confidence AS "attemptConfidence", ${ANSWER_ORIGIN} AS "answerOrigin",
         (SELECT COUNT(*)::int FROM assist_sales s WHERE s."questionId" = q.id AND ${SOLD}) AS "salesCount",
         (SELECT SUM(s.total)::float FROM assist_sales s WHERE s."questionId" = q.id AND ${SOLD}) AS "salesTotal",
         (SELECT COUNT(*)::int FROM assist_sales s WHERE s."questionId" = q.id AND ${ABANDON}) AS "abandonCount",
         (SELECT SUM(s.total)::float FROM assist_sales s WHERE s."questionId" = q.id AND ${ABANDON}) AS "abandonTotal",
         (SELECT COUNT(*)::int FROM assist_sales s WHERE s."questionId" = q.id AND (${OUTCOME}) = 'aguardando_pagamento') AS "checkoutPending"
    FROM assist_questions q
    LEFT JOIN assist_items i ON i."tenantId" = q."tenantId" AND i.id = q."mlItemId"
    LEFT JOIN assist_attempts a ON a.id = (SELECT x.id FROM assist_attempts x WHERE x."questionId" = q.id ORDER BY x.id DESC LIMIT 1)`

type Row = Record<string, unknown> & { id: number; receivedAt: Date; text: string; partCode: string | null; pendingReason: string | null; relevance: number; purchaseIntent: boolean }

export interface ListFilters {
  view?: string
  q?: string
  from?: string
  to?: string
  page: number
  pageSize: number
}

export interface PendingFilters extends ListFilters {
  status?: string
  reason?: string
  brand?: string
  model?: string
  code?: string
  product?: string
  assigned?: string
  priority?: string
}

const where = (parts: (Prisma.Sql | null | false | undefined | '')[]) => {
  const p = parts.filter(Boolean) as Prisma.Sql[]
  return p.length ? Prisma.sql`WHERE ${Prisma.join(p, ' AND ')}` : Prisma.empty
}

@Injectable()
export class AssistQueriesService {
  constructor(
    private readonly assist: AssistService,
    private readonly sales: AssistSalesService,
  ) {}

  private get prisma() {
    return this.assist.prisma
  }

  /** Tela "Perguntas e respostas": todas as perguntas com atalhos de filtro e contadores. */
  async questions(tenantId: string, f: ListFilters) {
    const like = f.q ? `%${f.q}%` : null
    const view = f.view ? VIEWS[f.view] : null
    const from = localDate(f.from)
    const to = localDate(f.to, true)
    const w = where([
      Prisma.sql`q."tenantId" = ${tenantId}::uuid`,
      view,
      like && Prisma.sql`(q.text ILIKE ${like} OR i.title ILIKE ${like} OR q."mlItemId" ILIKE ${like} OR q."partCode" ILIKE ${like} OR q."customerName" ILIKE ${like} OR q."customerNickname" ILIKE ${like})`,
      from && Prisma.sql`q."receivedAt" >= ${from}`,
      to && Prisma.sql`q."receivedAt" <= ${to}`,
    ])
    const [total, rows, counts] = await Promise.all([
      this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM assist_questions q LEFT JOIN assist_items i ON i."tenantId" = q."tenantId" AND i.id = q."mlItemId" ${w}`,
      this.prisma.$queryRaw<Row[]>`${SELECT_ROW} ${w} ORDER BY q."receivedAt" DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      Promise.all(Object.entries(VIEWS).map(async ([k, sql]) => [k, (await this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM assist_questions q ${where([Prisma.sql`q."tenantId" = ${tenantId}::uuid`, sql])}`)[0]!.n] as const)),
    ])
    return { rows, total: total[0]!.n, page: f.page, pageSize: f.pageSize, counts: Object.fromEntries(counts) }
  }

  /** Central de perguntas não respondidas: fila com prioridade e indicadores. */
  async pending(tenantId: string, f: PendingFilters) {
    const includeResolved = f.status && FINAL_STATUSES.includes(f.status)
    const like = f.q ? `%${f.q}%` : null
    const w = where([
      Prisma.sql`q."tenantId" = ${tenantId}::uuid`,
      includeResolved ? Prisma.sql`q."pendingSince" IS NOT NULL` : Prisma.sql`q.status IN (${list(PENDING_STATUSES)})`,
      f.status && Prisma.sql`q.status = ${f.status}`,
      f.reason && Prisma.sql`q."pendingReason" = ${f.reason}`,
      f.brand && Prisma.sql`q.brand ILIKE ${`%${f.brand}%`}`,
      f.model && Prisma.sql`q.model ILIKE ${`%${f.model}%`}`,
      f.code && Prisma.sql`q."partCode" ILIKE ${`%${f.code}%`}`,
      f.product && Prisma.sql`(i.title ILIKE ${`%${f.product}%`} OR q."mlItemId" ILIKE ${`%${f.product}%`})`,
      f.assigned === 'none' ? Prisma.sql`q."assignedToId" IS NULL AND q."assignedToName" IS NULL` : f.assigned ? Prisma.sql`q."assignedToId" = ${f.assigned}::uuid` : null,
      localDate(f.from) && Prisma.sql`q."receivedAt" >= ${localDate(f.from)}`,
      localDate(f.to, true) && Prisma.sql`q."receivedAt" <= ${localDate(f.to, true)}`,
      like && Prisma.sql`(q.text ILIKE ${like} OR i.title ILIKE ${like} OR q."customerName" ILIKE ${like} OR q."customerNickname" ILIKE ${like})`,
    ])
    let rows = (await this.prisma.$queryRaw<Row[]>`${SELECT_ROW} ${w}`).map((r) => ({ ...r, priority: computePriority(r) }))
    if (f.priority) rows = rows.filter((r) => r.priority.level === f.priority)
    rows.sort((a, b) => b.priority.score - a.priority.score || a.receivedAt.getTime() - b.receivedAt.getTime())
    const T = Prisma.sql`"tenantId" = ${tenantId}::uuid`
    const pend = Prisma.sql`${T} AND status IN (${list(PENDING_STATUSES)})`
    const n = async (sql: Prisma.Sql) => (await this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM assist_questions WHERE ${sql}`)[0]!.n
    const [semResposta, aguardandoAnalise, conhecimentoTecnico, encaminhadas, resolvidasHoje, mais24h] = await Promise.all([
      n(Prisma.sql`${pend} AND status <> 'aguardando_cliente'`),
      n(Prisma.sql`${T} AND status IN ('nova','aguardando_analise')`),
      n(Prisma.sql`${pend} AND ("pendingReason" IN ('A','C') OR status IN ('aguardando_validacao','conhecimento_aprovacao'))`),
      n(Prisma.sql`${pend} AND ("assignedToId" IS NOT NULL OR "assignedToName" IS NOT NULL)`),
      n(Prisma.sql`${T} AND "pendingSince" IS NOT NULL AND "resolvedAt" >= ${startOfLocalDay()} AND status IN ('resolvida','respondida')`),
      n(Prisma.sql`${pend} AND status <> 'aguardando_cliente' AND "receivedAt" < ${new Date(Date.now() - 86_400_000)}`),
    ])
    return { rows: rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize), total: rows.length, page: f.page, pageSize: f.pageSize, stats: { semResposta, aguardandoAnalise, conhecimentoTecnico, encaminhadas, resolvidasHoje, mais24h }, reasons: REASONS }
  }

  /** Número do menu: perguntas esperando resposta (as que aguardam o cliente não contam). */
  async pendingCount(tenantId: string) {
    const r = await this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM assist_questions WHERE "tenantId" = ${tenantId}::uuid AND status IN (${list(PENDING_STATUSES)}) AND status <> 'aguardando_cliente'`
    return { pending: r[0]!.n }
  }

  async meta(tenantId: string) {
    const users = await this.prisma.user.findMany({ where: { tenantId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    return { statuses: QUESTION_STATUSES, reasons: REASONS, users }
  }

  async question(tenantId: string, id: number) {
    const q = await this.prisma.assistQuestion.findFirst({ where: { id, tenantId } })
    if (!q) throw new NotFoundException('Pergunta não encontrada.')
    const item = q.mlItemId ? await this.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId, id: q.mlItemId } }, select: { id: true, title: true, permalink: true, price: true, currency: true, status: true, partNumber: true, sellerSku: true, availableQuantity: true } }) : null
    const attempts = await this.prisma.assistAttempt.findMany({ where: { questionId: q.id }, orderBy: { id: 'desc' } })
    const links = await this.prisma.assistAttemptKnowledge.findMany({ where: { attemptId: { in: attempts.map((a) => a.id) } } })
    const kRows = await this.prisma.assistKnowledge.findMany({ where: { id: { in: links.map((l) => l.knowledgeId) } }, select: { id: true, title: true, category: true, version: true, status: true } })
    const kById = new Map(kRows.map((k) => [k.id, k]))
    const [events, notes, linkedKnowledge, sales] = await Promise.all([
      this.prisma.assistEvent.findMany({ where: { questionId: q.id }, orderBy: { id: 'desc' } }),
      this.prisma.assistNote.findMany({ where: { tenantId, entity: 'question', entityId: q.id }, orderBy: { id: 'desc' } }),
      this.prisma.assistKnowledge.findMany({ where: { tenantId, originQuestionId: q.id, deletedAt: null }, select: { id: true, title: true, status: true, version: true } }),
      this.sales.forQuestion(tenantId, q.id),
    ])
    const lastAi = attempts.find((a) => a.origin === 'ia')?.ai as Record<string, unknown> | undefined
    return {
      question: { ...q, priority: computePriority(q) },
      item: item ? { ...item, price: item.price === null ? null : Number(item.price) } : null,
      attempts: attempts.map(({ mlResponse: _, ...a }) => ({
        ...a,
        knowledge: links.filter((l) => l.attemptId === a.id).map((l) => ({ id: l.knowledgeId, version: l.knowledgeVersion, title: kById.get(l.knowledgeId)?.title ?? null, category: kById.get(l.knowledgeId)?.category ?? null, currentVersion: kById.get(l.knowledgeId)?.version ?? null, status: kById.get(l.knowledgeId)?.status ?? null })),
      })),
      events,
      notes,
      linkedKnowledge,
      sales,
      analysis: lastAi ? { found: lastAi.found_info, missing: lastAi.missing_info, explanation: lastAi.reason_explanation, routing: lastAi.suggested_routing, decision: lastAi.decision, confidence: lastAi.confidence, detected: lastAi.detected, model: lastAi.model, freight: lastAi.freight } : null,
      reasons: REASONS,
    }
  }

  // ---------- Respostas enviadas ----------

  async answers(tenantId: string, f: ListFilters & { status?: string; origin?: string; reviewed?: string; flagged?: string; brand?: string; model?: string; product?: string }) {
    const status = { enviada: Prisma.sql`a."sendStatus" = 'enviada'`, falha: Prisma.sql`a."sendStatus" = 'falha'`, pendente: Prisma.sql`a."sendStatus" IN ('enviando','pendente_confirmacao')`, preparada: Prisma.sql`a."sendStatus" = 'pendente_aprovacao'` }[f.status ?? ''] ?? Prisma.sql`a."sendStatus" IN ('enviada','falha','enviando','pendente_confirmacao')`
    const like = f.q ? `%${f.q}%` : null
    const w = where([
      Prisma.sql`a."tenantId" = ${tenantId}::uuid`,
      status,
      like && Prisma.sql`(qu.text ILIKE ${like} OR a.text ILIKE ${like} OR qu."partCode" ILIKE ${like} OR qu."customerNickname" ILIKE ${like} OR qu."customerName" ILIKE ${like} OR qu."customerId" ILIKE ${like} OR qu."mlItemId" ILIKE ${like} OR i.title ILIKE ${like} OR i."partNumber" ILIKE ${like})`,
      localDate(f.from) && Prisma.sql`COALESCE(a."sentAt", a."createdAt") >= ${localDate(f.from)}`,
      localDate(f.to, true) && Prisma.sql`COALESCE(a."sentAt", a."createdAt") <= ${localDate(f.to, true)}`,
      f.brand && Prisma.sql`qu.brand ILIKE ${`%${f.brand}%`}`,
      f.model && Prisma.sql`qu.model ILIKE ${`%${f.model}%`}`,
      f.product && Prisma.sql`(qu."mlItemId" ILIKE ${`%${f.product}%`} OR i.title ILIKE ${`%${f.product}%`})`,
      f.origin && Prisma.sql`a.origin = ${f.origin}`,
      f.reviewed === 'sim' ? Prisma.sql`a.reviewed` : f.reviewed === 'nao' ? Prisma.sql`NOT a.reviewed` : null,
      f.flagged === 'sim' && Prisma.sql`a."flaggedForReview"`,
    ])
    const base = Prisma.sql`FROM assist_attempts a JOIN assist_questions qu ON qu.id = a."questionId" LEFT JOIN assist_items i ON i."tenantId" = qu."tenantId" AND i.id = qu."mlItemId" ${w}`
    const today = startOfLocalDay()
    const month = startOfLocalMonth()
    const T = Prisma.sql`"tenantId" = ${tenantId}::uuid`
    const n = async (sql: Prisma.Sql) => (await this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM assist_attempts WHERE ${T} AND ${sql}`)[0]!.n
    const [total, rows, hoje, mes, sucesso, falhas, revisadas, aguardandoAprovacao] = await Promise.all([
      this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n ${base}`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT a.id, a.origin, a.kind, a.text, a."sendStatus", a."sentAt", a."createdAt", a."confirmedAt", a.reviewed, a."flaggedForReview", a.error, a."authorName",
               qu.id AS "questionId", qu.text AS "questionText", qu."customerNickname", qu."customerId", qu."customerName", qu.marketplace, qu."mlItemId", qu."partCode", qu.brand, qu.model,
               i.title AS "itemTitle", i.permalink
        ${base} ORDER BY COALESCE(a."sentAt", a."createdAt") DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      n(Prisma.sql`"sendStatus" = 'enviada' AND "sentAt" >= ${today}`),
      n(Prisma.sql`"sendStatus" = 'enviada' AND "sentAt" >= ${month}`),
      n(Prisma.sql`"sendStatus" = 'enviada'`),
      n(Prisma.sql`"sendStatus" IN ('falha','pendente_confirmacao')`),
      n(Prisma.sql`"sendStatus" = 'enviada' AND reviewed`),
      n(Prisma.sql`"sendStatus" = 'pendente_aprovacao'`),
    ])
    return { rows, total: total[0]!.n, page: f.page, pageSize: f.pageSize, stats: { hoje, mes, sucesso, falhas, revisadas, aguardandoAprovacao } }
  }

  async answer(tenantId: string, id: number) {
    const a = await this.prisma.assistAttempt.findFirst({ where: { id, tenantId } })
    if (!a) throw new NotFoundException('Resposta não encontrada.')
    const q = await this.prisma.assistQuestion.findUniqueOrThrow({ where: { id: a.questionId } })
    const item = q.mlItemId ? await this.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId, id: q.mlItemId } }, select: { id: true, title: true, permalink: true, partNumber: true, sellerSku: true } }) : null
    const links = await this.prisma.assistAttemptKnowledge.findMany({ where: { attemptId: a.id } })
    const knowledge = await this.prisma.assistKnowledge.findMany({ where: { id: { in: links.map((l) => l.knowledgeId) } }, select: { id: true, title: true, category: true, version: true, status: true } })
    const notes = await this.prisma.assistNote.findMany({ where: { tenantId, entity: 'answer', entityId: a.id }, orderBy: { id: 'desc' } })
    const ai = a.ai as Record<string, unknown> | null
    const ml = a.mlResponse as { status?: string; answer?: { status?: string; date_created?: string } } | null
    return {
      answer: { ...a, ai: undefined, mlResponse: undefined },
      question: q,
      item,
      knowledge: knowledge.map((k) => ({ ...k, usedVersion: links.find((l) => l.knowledgeId === k.id)?.knowledgeVersion ?? null })),
      notes,
      ai: ai ? { decision: ai.decision, confidence: ai.confidence, explanation: ai.reason_explanation, detected: ai.detected, model: ai.model } : null,
      complementary: (ai?.complementary_links as unknown[]) ?? [],
      mlConfirmation: ml ? { status: ml.status, answerStatus: ml.answer?.status, answerDate: ml.answer?.date_created } : null,
    }
  }

  // ---------- Painel ----------

  async dashboard(tenantId: string, o: { from?: string; to?: string; status?: string; type?: string }) {
    const from = localDate(o.from) ?? new Date(startOfLocalDay().getTime() - 13 * 86_400_000)
    const to = localDate(o.to, true) ?? new Date()
    const today = startOfLocalDay()
    const T = Prisma.sql`"tenantId" = ${tenantId}::uuid`
    const pend = Prisma.sql`${T} AND status IN (${list(PENDING_STATUSES)})`
    const w = where([
      Prisma.sql`q."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`q."receivedAt" >= ${from}`,
      Prisma.sql`q."receivedAt" <= ${to}`,
      o.status && Prisma.sql`q.status = ${o.status}`,
      o.type === 'ia'
        ? Prisma.sql`EXISTS (SELECT 1 FROM assist_attempts a WHERE a."questionId" = q.id AND a.origin = 'ia' AND a."sendStatus" = 'enviada')`
        : o.type === 'humano'
          ? Prisma.sql`(q."assignedToId" IS NOT NULL OR q."assignedToName" IS NOT NULL OR EXISTS (SELECT 1 FROM assist_attempts a WHERE a."questionId" = q.id AND a.origin = 'atendente'))`
          : null,
    ])
    const n = async (table: Prisma.Sql, sql: Prisma.Sql) => (await this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${sql}`)[0]!.n
    const QT = Prisma.raw('assist_questions')
    const AT = Prisma.raw('assist_attempts')
    const KT = Prisma.raw('assist_knowledge')
    const [recebidasHoje, respondidasIaHoje, aguardando, revisao, conhecimentosAtivos, conhecimentosTotal, ultima, enviadasHoje, falhasEnvio, pendentes24h, conhecimentoEmAprovacao, porMotivo] = await Promise.all([
      n(QT, Prisma.sql`${T} AND "receivedAt" >= ${today}`),
      n(AT, Prisma.sql`${T} AND origin = 'ia' AND "sendStatus" = 'enviada' AND "sentAt" >= ${today}`),
      n(QT, Prisma.sql`${pend} AND status <> 'aguardando_cliente'`),
      n(AT, Prisma.sql`${T} AND ("sendStatus" = 'pendente_aprovacao' OR "flaggedForReview")`),
      n(KT, Prisma.sql`${T} AND status = 'ativo' AND "deletedAt" IS NULL`),
      n(KT, Prisma.sql`${T} AND "deletedAt" IS NULL`),
      this.prisma.assistKnowledge.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
      n(AT, Prisma.sql`${T} AND "sendStatus" = 'enviada' AND "sentAt" >= ${today}`),
      n(AT, Prisma.sql`${T} AND "sendStatus" IN ('falha','pendente_confirmacao')`),
      n(QT, Prisma.sql`${pend} AND status <> 'aguardando_cliente' AND "receivedAt" < ${new Date(Date.now() - 86_400_000)}`),
      n(KT, Prisma.sql`${T} AND status = 'em_revisao' AND "deletedAt" IS NULL`),
      this.prisma.$queryRaw<{ reason: string; n: number }[]>`SELECT "pendingReason" AS reason, COUNT(*)::int AS n FROM assist_questions WHERE ${pend} AND "pendingReason" IS NOT NULL GROUP BY "pendingReason"`,
    ])
    const [perDay, outcome, brands, products, recent] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; n: number }[]>`SELECT to_char(q."receivedAt" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM assist_questions q ${w} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ ia: number; atendente: number; encaminhadas: number }[]>`
        SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM assist_attempts a WHERE a."questionId" = q.id AND a."sendStatus" = 'enviada' AND a.origin = 'ia'))::int AS ia,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM assist_attempts a WHERE a."questionId" = q.id AND a."sendStatus" = 'enviada' AND a.origin = 'atendente'))::int AS atendente,
               COUNT(*) FILTER (WHERE q."pendingSince" IS NOT NULL)::int AS encaminhadas
          FROM assist_questions q ${w}`,
      this.prisma.$queryRaw<{ label: string; n: number }[]>`SELECT q.brand AS label, COUNT(*)::int AS n FROM assist_questions q ${w} AND COALESCE(q.brand,'') <> '' GROUP BY q.brand ORDER BY n DESC LIMIT 8`,
      this.prisma.$queryRaw<{ label: string; n: number }[]>`SELECT COALESCE(MAX(i.title), q."mlItemId") AS label, COUNT(*)::int AS n FROM assist_questions q LEFT JOIN assist_items i ON i."tenantId" = q."tenantId" AND i.id = q."mlItemId" ${w} AND q."mlItemId" IS NOT NULL GROUP BY q."mlItemId" ORDER BY n DESC LIMIT 8`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT q.id, q.text, q."receivedAt", q.status, q."pendingReason", q."mlItemId", i.title AS "itemTitle", q.marketplace, q."customerName", q."customerNickname", q."customerId",
               COALESCE(q."assignedToName", (SELECT a."authorName" FROM assist_attempts a WHERE a."questionId" = q.id AND a."authorName" IS NOT NULL ORDER BY a.id DESC LIMIT 1),
                 CASE WHEN EXISTS (SELECT 1 FROM assist_attempts a WHERE a."questionId" = q.id AND a.origin = 'ia' AND a."sendStatus" = 'enviada') THEN 'IA' END) AS responsible
          FROM assist_questions q LEFT JOIN assist_items i ON i."tenantId" = q."tenantId" AND i.id = q."mlItemId" ${w} ORDER BY q."receivedAt" DESC LIMIT 15`,
    ])
    return {
      cards: { recebidasHoje, respondidasIaHoje, aguardando, revisao, conhecimentosAtivos, conhecimentosTotal, ultimaAtualizacaoBase: ultima._max.updatedAt },
      centrals: { enviadasHoje, falhasEnvio, pendentes24h, conhecimentoEmAprovacao, porMotivo },
      charts: { perDay, outcome: outcome[0], brands, products },
      recent,
      period: { from, to },
      service: await this.serviceStats(tenantId, from, to),
      sales: await this.salesStats(tenantId, from, to),
    }
  }

  /** Atendimentos e tempos de resposta (IA automática, IA aprovada, atendente no CRM e direto no Mercado Livre). */
  private async serviceStats(tenantId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<{ receivedAt: Date; externalAnsweredAt: Date | null; origin: string; firstSent: Date | null; firstReviewed: boolean | null }[]>`
      SELECT q."receivedAt", q."externalAnsweredAt", ${ANSWER_ORIGIN} AS origin,
             (SELECT a."sentAt" FROM assist_attempts a WHERE a."questionId" = q.id AND a."sendStatus" = 'enviada' ORDER BY a."sentAt" LIMIT 1) AS "firstSent",
             (SELECT a.reviewed FROM assist_attempts a WHERE a."questionId" = q.id AND a."sendStatus" = 'enviada' ORDER BY a."sentAt" LIMIT 1) AS "firstReviewed"
        FROM assist_questions q WHERE q."tenantId" = ${tenantId}::uuid AND q."receivedAt" >= ${from} AND q."receivedAt" <= ${to}`
    const secs = (r: (typeof rows)[number]) => ((r.firstSent ?? r.externalAnsweredAt)!.getTime() - r.receivedAt.getTime()) / 1000
    const by = (fn: (r: (typeof rows)[number]) => boolean) => rows.filter((r) => fn(r) && (r.firstSent || r.externalAnsweredAt)).map(secs)
    const [geral] = await this.prisma.$queryRaw<{ recebidas: number; atendidas: number; desde: Date | null }[]>`
      SELECT COUNT(*)::int AS recebidas,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM assist_attempts a WHERE a."questionId" = q.id AND a."sendStatus" = 'enviada') OR q."externalAnsweredAt" IS NOT NULL OR q."mlStatus" = 'ANSWERED')::int AS atendidas,
             MIN(q."receivedAt") AS desde
        FROM assist_questions q WHERE q."tenantId" = ${tenantId}::uuid`
    return {
      periodo: { recebidas: rows.length, atendidas: rows.filter((r) => r.origin !== 'sem_resposta').length },
      geral,
      tempos: {
        ia: timeStats(by((r) => r.origin === 'ia')),
        iaAutomatica: timeStats(by((r) => r.origin === 'ia' && !r.firstReviewed)),
        iaAprovada: timeStats(by((r) => r.origin === 'ia' && !!r.firstReviewed)),
        manual: timeStats(by((r) => r.origin === 'atendente' || (r.origin === 'externa' && !!r.externalAnsweredAt))),
        painel: timeStats(by((r) => r.origin === 'atendente')),
        direto: timeStats(by((r) => r.origin === 'externa' && !!r.externalAnsweredAt)),
      },
    }
  }

  /** Respostas × vendas (perguntas recebidas no período), com as desistências no checkout. */
  private async salesStats(tenantId: string, from: Date, to: Date) {
    const perOrigin = await this.prisma.$queryRaw<{ origin: string; perguntas: number; com_venda: number; vendas: number; receita: number; checkout: number; desistiu: number; perdido: number }[]>`
      SELECT origin, COUNT(*)::int AS perguntas, COUNT(*) FILTER (WHERE n > 0)::int AS com_venda, COALESCE(SUM(n),0)::int AS vendas, COALESCE(SUM(receita),0)::float AS receita,
             COUNT(*) FILTER (WHERE pedidos > 0)::int AS checkout, COUNT(*) FILTER (WHERE n = 0 AND desist > 0)::int AS desistiu, COALESCE(SUM(perdido),0)::float AS perdido
        FROM (SELECT ${ANSWER_ORIGIN} AS origin,
                     (SELECT COUNT(*) FROM assist_sales s WHERE s."questionId" = q.id AND ${SOLD}) AS n,
                     (SELECT COALESCE(SUM(s.total), 0) FROM assist_sales s WHERE s."questionId" = q.id AND ${SOLD}) AS receita,
                     (SELECT COUNT(*) FROM assist_sales s WHERE s."questionId" = q.id) AS pedidos,
                     (SELECT COUNT(*) FROM assist_sales s WHERE s."questionId" = q.id AND ${ABANDON}) AS desist,
                     (SELECT COALESCE(SUM(s.total), 0) FROM assist_sales s WHERE s."questionId" = q.id AND ${ABANDON}) AS perdido
                FROM assist_questions q WHERE q."tenantId" = ${tenantId}::uuid AND q."receivedAt" >= ${from} AND q."receivedAt" <= ${to}) x
       GROUP BY origin`
    const get = (o: string) => perOrigin.find((r) => r.origin === o) ?? { perguntas: 0, com_venda: 0, vendas: 0, receita: 0, checkout: 0, desistiu: 0, perdido: 0 }
    const sum = (l: typeof perOrigin, k: keyof (typeof perOrigin)[number]) => l.reduce((s, r) => s + (Number(r[k]) || 0), 0)
    const answered = perOrigin.filter((r) => r.origin !== 'sem_resposta')
    const [recent, abandoned, pending] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.id, s."mlOrderId", s."mlItemId", s."itemTitle", s.total::float AS total, s.currency, s.quantity, s."orderDate", s."matchType", s."hoursAfterQuestion",
               q.id AS "questionId", q.text AS "questionText", q.marketplace, q."customerName", q."customerNickname", q."customerId", ${ANSWER_ORIGIN} AS origin
          FROM assist_sales s JOIN assist_questions q ON q.id = s."questionId"
         WHERE s."tenantId" = ${tenantId}::uuid AND ${SOLD} AND q."receivedAt" >= ${from} AND q."receivedAt" <= ${to} ORDER BY s."orderDate" DESC LIMIT 10`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.id, s."mlOrderId", s."itemTitle", s."mlItemId", s.total::float AS total, s.currency, s.quantity, s."orderDate", s."paymentStatus", s."orderStatus",
               q.id AS "questionId", q.text AS "questionText", q.marketplace, q."customerName", q."customerNickname", q."customerId", ${ANSWER_ORIGIN} AS origin
          FROM assist_sales s JOIN assist_questions q ON q.id = s."questionId"
         WHERE s."tenantId" = ${tenantId}::uuid AND ${ABANDON} AND q."receivedAt" >= ${from} AND q."receivedAt" <= ${to}
           AND NOT EXISTS (SELECT 1 FROM assist_sales s2 WHERE s2."questionId" = q.id AND s2."orderStatus" IN ('paid','partially_paid','partially_refunded'))
         ORDER BY s."orderDate" DESC LIMIT 10`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM assist_sales s JOIN assist_questions q ON q.id = s."questionId" WHERE s."tenantId" = ${tenantId}::uuid AND (${OUTCOME}) = 'aguardando_pagamento' AND q."receivedAt" >= ${from} AND q."receivedAt" <= ${to}`,
    ])
    const [integ, st] = await Promise.all([this.assist.integration(tenantId), this.assist.state(tenantId)])
    return {
      enabled: integ.sales_enabled,
      windowDays: integ.sales_window_days,
      lastSyncAt: st.lastOrdersSyncAt ?? null,
      error: st.ordersError ?? null,
      total: { vendas: sum(perOrigin, 'vendas'), receita: sum(perOrigin, 'receita'), perguntasComVenda: sum(perOrigin, 'com_venda'), atendidas: sum(answered, 'perguntas'), atendidasComVenda: sum(answered, 'com_venda'), checkout: sum(perOrigin, 'checkout'), desistiu: sum(perOrigin, 'desistiu'), perdido: sum(perOrigin, 'perdido'), aguardandoPagamento: pending[0]!.n },
      porOrigem: { ia: get('ia'), atendente: get('atendente'), externa: get('externa'), sem_resposta: get('sem_resposta') },
      recent,
      abandoned,
    }
  }

  // ---------- Base de conhecimento ----------

  async knowledgeMeta(tenantId: string) {
    const [cats, brands, models] = await Promise.all([
      this.prisma.assistKnowledge.findMany({ where: { tenantId, deletedAt: null }, distinct: ['category'], select: { category: true } }),
      this.prisma.assistKnowledge.findMany({ where: { tenantId, deletedAt: null, brand: { not: null } }, distinct: ['brand'], select: { brand: true }, orderBy: { brand: 'asc' } }),
      this.prisma.assistKnowledge.findMany({ where: { tenantId, deletedAt: null, model: { not: null } }, distinct: ['model'], select: { model: true }, orderBy: { model: 'asc' } }),
    ])
    return { categories: [...new Set([...KNOWLEDGE_CATEGORIES, ...cats.map((c) => c.category)])], brands: brands.map((b) => b.brand), models: models.map((m) => m.model), statuses: KNOWLEDGE_STATUSES }
  }

  async knowledgeList(tenantId: string, f: { q?: string; category?: string; brand?: string; model?: string; code?: string; status?: string; origin?: string; page: number; pageSize: number }) {
    const like = f.q ? { contains: f.q, mode: 'insensitive' as const } : undefined
    const where: Prisma.AssistKnowledgeWhereInput = {
      tenantId,
      deletedAt: null,
      ...(like ? { OR: [{ title: like }, { question: like }, { answer: like }, { product: like }, { partCode: like }, { application: like }] } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(f.brand ? { brand: f.brand } : {}),
      ...(f.model ? { model: { contains: f.model, mode: 'insensitive' } } : {}),
      ...(f.code ? { partCode: { contains: f.code, mode: 'insensitive' } } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.origin === 'aprendido' ? { autoLearned: true } : f.origin === 'cadastrado' ? { autoLearned: false } : {}),
    }
    const [total, rows, learned] = await Promise.all([
      this.prisma.assistKnowledge.count({ where }),
      this.prisma.assistKnowledge.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, select: { id: true, title: true, category: true, brand: true, model: true, partCode: true, product: true, status: true, version: true, source: true, updatedAt: true, createdAt: true, autoLearned: true, mlItemId: true, learnedFrom: true, createdByName: true, updatedByName: true } }),
      this.prisma.assistKnowledge.count({ where: { tenantId, autoLearned: true, deletedAt: null } }),
    ])
    return { rows, total, page: f.page, pageSize: f.pageSize, learned }
  }

  async knowledgeDetail(tenantId: string, id: number) {
    const k = await this.prisma.assistKnowledge.findFirst({ where: { id, tenantId, deletedAt: null } })
    if (!k) throw new NotFoundException('Conhecimento não encontrado.')
    const [versions, usage, originQuestion] = await Promise.all([
      this.prisma.assistKnowledgeVersion.findMany({ where: { knowledgeId: id }, orderBy: { id: 'desc' } }),
      this.prisma.assistAttemptKnowledge.count({ where: { knowledgeId: id } }),
      k.originQuestionId ? this.prisma.assistQuestion.findUnique({ where: { id: k.originQuestionId }, select: { id: true, text: true, receivedAt: true } }) : null,
    ])
    return { knowledge: k, versions, usage, originQuestion }
  }

  // ---------- Aplicações e anúncios ----------

  async applicationsMeta(tenantId: string) {
    const col = async (c: 'machineBrand' | 'machineModel' | 'system' | 'partBrand') => (await this.prisma.assistApplication.findMany({ where: { tenantId, NOT: [{ [c]: null }, { [c]: '' }] }, distinct: [c], select: { [c]: true }, orderBy: { [c]: 'asc' } })).map((r) => (r as Record<string, string>)[c])
    const [machineBrands, models, systems, partBrands] = await Promise.all([col('machineBrand'), col('machineModel'), col('system'), col('partBrand')])
    return { machineBrands, models, systems, partBrands }
  }

  async applications(tenantId: string, f: { q?: string; brand?: string; model?: string; code?: string; system?: string; validation?: string; page: number; pageSize: number }) {
    const like = f.q ? `%${f.q}%` : null
    const w = where([
      Prisma.sql`a."tenantId" = ${tenantId}::uuid`,
      like && Prisma.sql`(a."partCode" ILIKE ${like} OR a."productName" ILIKE ${like} OR a.application ILIKE ${like} OR i.title ILIKE ${like})`,
      f.brand && Prisma.sql`a."machineBrand" = ${f.brand}`,
      f.model && Prisma.sql`a."machineModel" ILIKE ${`%${f.model}%`}`,
      f.code && Prisma.sql`a."partCode" ILIKE ${`%${f.code}%`}`,
      f.system && Prisma.sql`a.system = ${f.system}`,
      f.validation && Prisma.sql`a."validationStatus" = ${f.validation}`,
    ])
    const base = Prisma.sql`FROM assist_applications a LEFT JOIN assist_items i ON i."tenantId" = a."tenantId" AND i.id = a."mlItemId" ${w}`
    const [total, rows, counts] = await Promise.all([
      this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n ${base}`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`SELECT a.*, i.title AS "itemTitle", i.permalink, i.status AS "itemStatus" ${base} ORDER BY a."partCode", a."machineBrand", a."machineModel" LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      this.prisma.assistApplication.groupBy({ by: ['validationStatus'], where: { tenantId }, _count: { _all: true } }),
    ])
    return { rows, total: total[0]!.n, page: f.page, pageSize: f.pageSize, counts: Object.fromEntries(counts.map((c) => [c.validationStatus, c._count._all])) }
  }

  /** Ficha do produto: aplicações por situação, anúncios e conhecimentos do código. */
  async product(tenantId: string, codeParam: string) {
    const code = normCode(codeParam)
    const apps = (await this.prisma.assistApplication.findMany({ where: { tenantId } })).filter((a) => normCode(a.partCode) === code)
    if (!apps.length) throw new NotFoundException('Nenhuma aplicação cadastrada para este código.')
    const itemIds = [...new Set(apps.map((a) => a.mlItemId).filter((x): x is string => !!x))]
    const items = await this.prisma.assistItem.findMany({ where: { tenantId, id: { in: itemIds } }, select: { id: true, title: true, permalink: true, price: true, status: true, availableQuantity: true } })
    const titles = new Map(items.map((i) => [i.id, i]))
    const knowledge = (await this.prisma.assistKnowledge.findMany({ where: { tenantId, deletedAt: null, partCode: { not: null } }, select: { id: true, title: true, category: true, status: true, partCode: true, model: true, updatedAt: true } })).filter((k) => String(k.partCode).split(/[,;]/).some((c) => normCode(c) === code))
    const withItem = apps.map((a) => ({ ...a, itemTitle: a.mlItemId ? (titles.get(a.mlItemId)?.title ?? null) : null, permalink: a.mlItemId ? (titles.get(a.mlItemId)?.permalink ?? null) : null }))
    return {
      code: apps[0]!.partCode,
      product: apps.find((a) => a.productName)?.productName ?? withItem[0]!.itemTitle ?? '',
      confirmed: withItem.filter((a) => a.validationStatus === 'confirmada'),
      pending: withItem.filter((a) => a.validationStatus === 'pendente'),
      notConfirmed: withItem.filter((a) => a.validationStatus === 'nao_confirmada'),
      items: items.map((i) => ({ ...i, price: i.price === null ? null : Number(i.price) })),
      knowledge,
    }
  }

  /** Anúncios sincronizados (lista da loja, busca para ligar aplicações e para o teste do assistente). */
  async items(tenantId: string, f: { q?: string; status?: string; page: number; pageSize: number }) {
    const like = f.q ? { contains: f.q, mode: 'insensitive' as const } : undefined
    const where: Prisma.AssistItemWhereInput = { tenantId, ...(f.status ? { status: f.status } : {}), ...(like ? { OR: [{ id: like }, { title: like }, { partNumber: like }, { sellerSku: like }] } : {}) }
    const [total, rows, counts] = await Promise.all([
      this.prisma.assistItem.count({ where }),
      this.prisma.assistItem.findMany({ where, orderBy: { title: 'asc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, select: { id: true, title: true, permalink: true, price: true, availableQuantity: true, status: true, sellerSku: true, partNumber: true, brand: true, syncedAt: true } }),
      this.prisma.assistItem.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    ])
    return { rows: rows.map((r) => ({ ...r, price: r.price === null ? null : Number(r.price) })), total, page: f.page, pageSize: f.pageSize, counts: Object.fromEntries(counts.map((c) => [c.status ?? 'sem', c._count._all])) }
  }
}

function timeStats(list: number[]) {
  const secs = list.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b)
  if (!secs.length) return { n: 0, avg: null, median: null }
  const avg = secs.reduce((s, v) => s + v, 0) / secs.length
  const mid = Math.floor(secs.length / 2)
  const median = secs.length % 2 ? secs[mid]! : (secs[mid - 1]! + secs[mid]!) / 2
  return { n: secs.length, avg: Math.round(avg), median: Math.round(median) }
}
