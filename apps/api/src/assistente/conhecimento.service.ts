import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { AssistKnowledge, Prisma } from '../generated/prisma/client'
import { type Actor, AssistService } from './assist.service'
import { KNOWLEDGE_STATUSES } from './constantes'
import { appKey, classifyForLearning, cleanAnswer, extractCodes, matchKey, norm, normCode, questionSimilarity, str, tokenize } from './texto'

export interface KnowledgeData {
  title: string
  category: string
  brand: string
  model: string
  partCode: string
  product: string
  application: string
  question: string
  answer: string
  source: string
}

const FIELDS: (keyof KnowledgeData)[] = ['title', 'category', 'brand', 'model', 'partCode', 'product', 'application', 'question', 'answer', 'source']

export interface ApplicationInput {
  partCode?: string | null
  productName?: string | null
  partBrand?: string | null
  machineBrand?: string | null
  machineModel?: string | null
  system?: string | null
  application?: string | null
  source?: string | null
  mlItemId?: string | null
  knowledgeId?: number | null
  validationStatus?: string | null
}

/** Base de conhecimento (com versões) e aplicações peça × máquina. */
@Injectable()
export class AssistKnowledgeService {
  constructor(private readonly assist: AssistService) {}

  private get prisma() {
    return this.assist.prisma
  }

  validate(input: Partial<Record<keyof KnowledgeData, unknown>>): KnowledgeData {
    const d = Object.fromEntries(FIELDS.map((f) => [f, str(input[f], f === 'answer' ? 8000 : 1000)])) as unknown as KnowledgeData
    const errors: string[] = []
    if (!d.title) d.title = d.product || d.question.slice(0, 120)
    if (!d.title) errors.push('Informe o título.')
    if (!d.category) errors.push('Informe a categoria.')
    if (!d.answer) errors.push('Informe a resposta aprovada.')
    if (!d.source) errors.push('Informe a fonte da informação (documento, catálogo ou responsável).')
    if (errors.length) throw new BadRequestException(errors.join(' '))
    return d
  }

  private async snapshot(tenantId: string, id: number, changeType: string, actor: Actor) {
    const row = await this.prisma.assistKnowledge.findUniqueOrThrow({ where: { id } })
    await this.prisma.assistKnowledgeVersion.create({ data: { tenantId, knowledgeId: id, version: row.version, snapshot: row as unknown as Prisma.InputJsonValue, changeType, changedById: actor.id, changedByName: actor.name } })
  }

  async create(tenantId: string, d: KnowledgeData, o: { actor: Actor; status: string; originQuestionId?: number | null; originImportId?: number | null; approved?: boolean }) {
    const now = new Date()
    const row = await this.prisma.assistKnowledge.create({
      data: {
        tenantId,
        ...emptyToNull(d),
        title: d.title,
        category: d.category,
        answer: d.answer,
        status: o.status,
        originQuestionId: o.originQuestionId ?? null,
        originImportId: o.originImportId ?? null,
        createdById: o.actor.id,
        createdByName: o.actor.name,
        updatedById: o.actor.id,
        updatedByName: o.actor.name,
        approvedById: o.approved ? o.actor.id : null,
        approvedByName: o.approved ? o.actor.name : null,
        approvedAt: o.approved ? now : null,
        createdAt: now,
        updatedAt: now,
        matchKey: matchKey(d.partCode, d.application, d.model),
      },
    })
    await this.snapshot(tenantId, row.id, 'criacao', o.actor)
    return row.id
  }

  async update(tenantId: string, id: number, d: KnowledgeData, o: { actor: Actor; status?: string | null; changeType?: string; approved?: boolean }) {
    const cur = await this.prisma.assistKnowledge.findFirst({ where: { id, tenantId, deletedAt: null } })
    if (!cur) throw new NotFoundException('Conhecimento não encontrado.')
    const now = new Date()
    await this.prisma.assistKnowledge.update({
      where: { id },
      data: {
        ...emptyToNull(d),
        title: d.title,
        category: d.category,
        answer: d.answer,
        status: o.status ?? cur.status,
        version: { increment: 1 },
        updatedById: o.actor.id,
        updatedByName: o.actor.name,
        updatedAt: now,
        matchKey: matchKey(d.partCode, d.application, d.model),
        ...(o.approved ? { approvedById: o.actor.id, approvedByName: o.actor.name, approvedAt: now } : {}),
      },
    })
    await this.snapshot(tenantId, id, o.changeType ?? 'edicao', o.actor)
    return id
  }

  async setStatus(tenantId: string, id: number, status: string, actor: Actor) {
    if (!KNOWLEDGE_STATUSES.includes(status)) throw new BadRequestException('Situação inválida.')
    const cur = await this.prisma.assistKnowledge.findFirst({ where: { id, tenantId, deletedAt: null } })
    if (!cur) throw new NotFoundException('Conhecimento não encontrado.')
    const now = new Date()
    const approving = status === 'ativo'
    await this.prisma.assistKnowledge.update({
      where: { id },
      data: { status, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name, updatedAt: now, ...(approving ? { approvedById: actor.id, approvedByName: actor.name, approvedAt: now } : {}) },
    })
    await this.snapshot(tenantId, id, approving ? 'aprovacao' : `status:${status}`, actor)
    if (approving && cur.originQuestionId) await this.assist.addEvent(tenantId, cur.originQuestionId, 'conhecimento_aprovado', { actor, note: `Conhecimento #${id} aprovado e disponível para a IA.`, data: { knowledge_id: id } })
    if (approving) {
      // aprovação confirma as aplicações vinculadas a este conhecimento
      await this.prisma.assistApplication.updateMany({ where: { tenantId, knowledgeId: id, validationStatus: 'pendente', NOT: { OR: [{ application: null }, { application: '' }] } }, data: { validationStatus: 'confirmada', validatedById: actor.id, validatedByName: actor.name, validatedAt: now } })
    }
    return cur
  }

  // ---------- Busca em tempo de atendimento ----------

  /** Marcas e modelos conhecidos (cadastrados nas aplicações e na base) citados no texto. */
  async detectKnownEntities(tenantId: string, text: string) {
    const t = ` ${norm(text).replace(/[^a-z0-9]+/g, ' ')} `
    const compact = t.replace(/\s/g, '')
    const brands = new Set<string>()
    const models = new Set<string>()
    const rows = await this.prisma.$queryRaw<{ b: string | null; m: string | null }[]>`
      SELECT DISTINCT "machineBrand" AS b, "machineModel" AS m FROM assist_applications WHERE "tenantId" = ${tenantId}::uuid
      UNION SELECT DISTINCT brand, model FROM assist_knowledge WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL`
    for (const { b, m } of rows) {
      const nb = norm(b).replace(/[^a-z0-9]+/g, ' ').trim()
      if (b && nb.length >= 2 && t.includes(` ${nb} `)) brands.add(b)
      for (const single of String(m ?? '').split(/[,;/]/)) {
        const nm = norm(single).replace(/[^a-z0-9]+/g, '')
        if (nm.length >= 3 && compact.includes(nm)) models.add(single.trim())
      }
    }
    return { brands: [...brands], models: [...models] }
  }

  /** Conhecimentos ativos mais relevantes para a pergunta (só categorias permitidas nas configurações). */
  async retrieve(tenantId: string, o: { text: string; item: { id: string; title: string | null } | null; codes: string[]; brands: string[]; models: string[]; allowedCategories: string[]; limit?: number }) {
    const allowed = new Set(o.allowedCategories ?? [])
    const rows = await this.prisma.assistKnowledge.findMany({ where: { tenantId, status: 'ativo', deletedAt: null } })
    const words = tokenize(`${o.text} ${o.item?.title ?? ''}`)
    const codeSet = new Set(o.codes)
    const brandSet = new Set(o.brands.map(norm))
    const modelSet = new Set(o.models.map((m) => norm(m).replace(/[^a-z0-9]+/g, '')))
    const scored: { k: AssistKnowledge; score: number }[] = []
    for (const k of rows) {
      if (allowed.size && !allowed.has(k.category)) continue
      // conhecimento preso a um anúncio só vale para aquele anúncio
      if (k.mlItemId && k.mlItemId !== o.item?.id) continue
      let score = 0
      if (k.mlItemId && k.mlItemId === o.item?.id) score += 8
      const sim = k.question ? questionSimilarity(o.text, k.question) : 0
      if (sim >= 0.6) score += Math.round(sim * 15)
      const kCodes = String(k.partCode ?? '').split(/[,;]/).map(normCode).filter(Boolean)
      if (kCodes.some((c) => codeSet.has(c))) score += 12
      if (k.model && String(k.model).split(/[,;/]/).some((m) => modelSet.has(norm(m).replace(/[^a-z0-9]+/g, '')))) score += 6
      if (k.brand && brandSet.has(norm(k.brand))) score += 2
      const hay = norm(`${k.title} ${k.product ?? ''} ${k.question ?? ''} ${k.application ?? ''}`)
      for (const w of words) if (hay.includes(w)) score += 1
      if (['Orientações de atendimento', 'Frete e envio', 'Garantia e troca', 'Informações comerciais'].includes(k.category)) score += words.some((w) => hay.includes(w)) ? 1 : 0
      if (score >= 2) scored.push({ k, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, o.limit ?? 12).map(({ k }) => k)
  }

  // ---------- Aprendizado automático ----------

  /**
   * Respostas enviadas por uma pessoa, sugestões aprovadas, respostas dadas direto no Mercado Livre e (se ligado)
   * as da IA viram conhecimento, reaproveitado nas próximas perguntas. how: manual | aprovada | externa | ia.
   */
  async learn(tenantId: string, o: { questionId: number; answerText: string; how: 'manual' | 'aprovada' | 'externa' | 'ia'; actor?: Actor }) {
    const s = await this.assist.ai(tenantId)
    if (s.auto_learn === false) return null
    if (o.how === 'ia' && s.auto_learn_from_ai === false) return null
    const q = await this.prisma.assistQuestion.findFirst({ where: { id: o.questionId, tenantId } })
    if (!q?.text || !o.answerText) return null
    const cls = classifyForLearning(q.text)
    if ('skip' in cls) {
      await this.assist.log(tenantId, 'info', `Pergunta #${q.id} não aprendida: ${cls.skip}.`)
      return null
    }
    const items = await this.prisma.assistItem.findMany({ where: { tenantId, permalink: { not: null } }, select: { id: true, permalink: true } })
    const answer = cleanAnswer(o.answerText, items)
    if (answer.length < 10) return null
    const item = q.mlItemId ? await this.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId, id: q.mlItemId } }, select: { id: true, title: true, partNumber: true, sellerSku: true } }) : null
    const itemScope = cls.scoped && item ? item.id : null
    const label = { manual: 'Resposta manual', aprovada: 'Sugestão da IA aprovada', externa: 'Respondida no Mercado Livre', ia: 'Resposta automática da IA' }[o.how]
    const actor = o.actor ?? { id: null, name: null }
    const d: KnowledgeData = {
      title: `${item?.title ? `${item.title} — ` : ''}${q.text.replace(/\s+/g, ' ').slice(0, 90)}`.slice(0, 200),
      category: cls.category,
      brand: q.brand ?? '',
      model: q.model ?? '',
      partCode: cls.scoped && item ? (item.partNumber ?? item.sellerSku ?? '') : extractCodes(q.text).join(', '),
      product: item?.title ?? '',
      application: '',
      question: q.text,
      answer,
      source: `Aprendido automaticamente: ${label}${actor.name ? ` por ${actor.name}` : ''} em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (pergunta ML ${q.mlQuestionId})`,
    }
    const status = s.auto_learn_status === 'em_revisao' ? 'em_revisao' : 'ativo'
    const candidates = await this.prisma.assistKnowledge.findMany({ where: { tenantId, autoLearned: true, deletedAt: null, mlItemId: itemScope }, select: { id: true, question: true, learnedFrom: true } })
    const same = candidates.find((k) => questionSimilarity(q.text, k.question) >= 0.85)
    // resposta de pessoa tem prioridade: a IA nunca sobrescreve o que uma pessoa respondeu ou aprovou
    if (same && o.how === 'ia' && ['manual', 'aprovada', 'externa'].includes(same.learnedFrom ?? 'manual')) {
      await this.assist.log(tenantId, 'info', `Pergunta #${q.id}: já existe resposta validada por pessoa (#${same.id}); aprendizado da IA ignorado.`)
      return null
    }
    let id: number
    if (same) {
      await this.update(tenantId, same.id, d, { actor, status, changeType: 'aprendizado', approved: status === 'ativo' })
      id = same.id
    } else {
      id = await this.create(tenantId, d, { actor, status, originQuestionId: q.id, approved: status === 'ativo' })
      await this.prisma.assistKnowledge.update({ where: { id }, data: { autoLearned: true, mlItemId: itemScope } })
    }
    await this.prisma.assistKnowledge.update({ where: { id }, data: { learnedFrom: o.how } })
    await this.assist.addEvent(tenantId, q.id, 'conhecimento_aprendido', {
      actor,
      note: `${same ? 'Conhecimento atualizado' : 'Novo conhecimento'} #${id} (${cls.category}${itemScope ? ', vale só para este anúncio' : ''}): ${status === 'ativo' ? 'já disponível para as próximas respostas' : 'aguardando aprovação'}.`,
      data: { knowledge_id: id },
    })
    return { id, updated: !!same, status }
  }

  // ---------- Aplicações peça × máquina ----------

  /** Anúncio da loja cujo código (part number/SKU) ou título contém o código da peça. */
  async findItemForCode(tenantId: string, partCode: string) {
    const code = normCode(partCode)
    if (!code) return null
    const items = await this.prisma.assistItem.findMany({ where: { tenantId }, select: { id: true, title: true, partNumber: true, sellerSku: true } })
    const byAttr = items.find((i) => [i.partNumber, i.sellerSku].some((v) => v && String(v).split(/[,;]/).some((p) => normCode(p) === code)))
    if (byAttr) return byAttr.id
    const byTitle = items.filter((i) => normCode(i.title).includes(code))
    return byTitle.length === 1 ? byTitle[0]!.id : null
  }

  async upsertApplication(tenantId: string, a: ApplicationInput, actor: Actor) {
    const d = {
      partCode: str(a.partCode, 100),
      productName: str(a.productName, 300) || null,
      partBrand: str(a.partBrand, 100) || null,
      machineBrand: str(a.machineBrand, 100) || null,
      machineModel: str(a.machineModel, 200) || null,
      system: str(a.system, 100) || null,
      application: str(a.application, 1000) || null,
      source: str(a.source, 500) || null,
    }
    const key = appKey(d)
    const now = new Date()
    const existing = await this.prisma.assistApplication.findUnique({ where: { tenantId_matchKey: { tenantId, matchKey: key } } })
    const itemId = a.mlItemId || existing?.mlItemId || (await this.findItemForCode(tenantId, d.partCode))
    const status = a.validationStatus && ['confirmada', 'pendente', 'nao_confirmada'].includes(a.validationStatus) ? a.validationStatus : 'pendente'
    const confirm = status === 'confirmada' ? { validatedById: actor.id, validatedByName: actor.name, validatedAt: now } : {}
    if (existing) {
      await this.prisma.assistApplication.update({
        where: { id: existing.id },
        data: { productName: d.productName, partBrand: d.partBrand || existing.partBrand, system: d.system, application: d.application, source: d.source, mlItemId: itemId, knowledgeId: a.knowledgeId ?? existing.knowledgeId, validationStatus: status, updatedAt: now, ...confirm },
      })
      return existing.id
    }
    const row = await this.prisma.assistApplication.create({
      data: { tenantId, ...d, mlItemId: itemId, validationStatus: status, knowledgeId: a.knowledgeId ?? null, createdById: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now, matchKey: key, ...confirm },
    })
    return row.id
  }

  /** Depois de sincronizar os anúncios, liga aplicações sem anúncio pelo código da peça. */
  async relinkApplications(tenantId: string) {
    const rows = await this.prisma.assistApplication.findMany({ where: { tenantId, mlItemId: null }, select: { id: true, partCode: true } })
    let linked = 0
    for (const r of rows) {
      const itemId = await this.findItemForCode(tenantId, r.partCode)
      if (itemId) {
        await this.prisma.assistApplication.update({ where: { id: r.id }, data: { mlItemId: itemId } })
        linked++
      }
    }
    return linked
  }
}

/** Campos opcionais vazios viram null (como no painel, onde '' e null contam igual). */
function emptyToNull(d: KnowledgeData) {
  return { brand: d.brand || null, model: d.model || null, partCode: d.partCode || null, product: d.product || null, application: d.application || null, question: d.question || null, source: d.source || null }
}
