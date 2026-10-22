/**
 * Traz o painel antigo (painel.usaparts.com.br, banco SQLite) para dentro do CRM, sem alterar o painel.
 * Roda dentro do container da API (o deploy/importar-painel.sh faz tudo):
 *   node dist/assistente/importar-painel.js /tmp/painel.db [id-da-empresa] < segredos.json
 * segredos.json (pela entrada padrão, nunca em arquivo): chave de criptografia e credenciais do .env do painel.
 *
 * Substitui os dados do assistente da empresa pelos do painel (pode rodar de novo durante a conferência). Depois que o
 * CRM assume o atendimento, recusa rodar, para não apagar o que o CRM já respondeu.
 */
import { createDecipheriv, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { PrismaPg } from '@prisma/adapter-pg'
import { encrypt } from '../common/crypto'
import { env } from '../config/env'
import { type Prisma, PrismaClient } from '../generated/prisma/client'
import { AI_DEFAULTS, AI_KEY, INTEGRATION_DEFAULTS, INTEGRATION_KEY, PAINEL_KEY, SECRET_KEY, STATE_KEY, STORE_KEY } from './constantes'
import { mask } from './assist.service'

interface Secrets {
  /** APP_ENCRYPTION_KEY do .env do painel (texto; o painel usa o SHA-256 dele como chave AES). */
  encryptionKey?: string
  mlClientId?: string
  mlClientSecret?: string
  anthropicKey?: string
  geminiKey?: string
  version?: string
}

type R = Record<string, unknown>
const d = (v: unknown) => (v ? new Date(String(v)) : null)
const dn = (v: unknown) => d(v) ?? new Date()
const b = (v: unknown) => v === 1 || v === true || v === '1'
const s = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
const j = (v: unknown): Prisma.InputJsonValue | undefined => {
  if (!v) return undefined
  try {
    return JSON.parse(String(v)) as Prisma.InputJsonValue
  } catch {
    return undefined
  }
}

/** Descriptografia do painel: AES-256-GCM, chave = SHA-256 do APP_ENCRYPTION_KEY, "iv.tag.dados" em base64. */
function painelDecrypt(payload: string, key: string): unknown {
  const [iv, tag, data] = String(payload).split('.').map((p) => Buffer.from(p, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(key).digest(), iv!)
  decipher.setAuthTag(tag!)
  return JSON.parse(Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8'))
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const [dbPath, tenantArg] = process.argv.slice(2)
  if (!dbPath) throw new Error('Informe o arquivo do banco do painel. Ex.: node dist/assistente/importar-painel.js /tmp/painel.db')
  const raw = (await readStdin()).trim()
  const secrets = (raw ? JSON.parse(raw) : {}) as Secrets
  const sq = new DatabaseSync(dbPath, { readOnly: true })
  const all = (sql: string) => sq.prepare(sql).all() as R[]
  const has = (t: string) => !!sq.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
  const cols = (t: string) => new Set((sq.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name))
  if (!has('questions') || !has('knowledge')) throw new Error('Este arquivo não é o banco do painel (faltam as tabelas questions e knowledge).')

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) })
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } })
    const tenant = tenantArg ? tenants.find((t) => t.id === tenantArg) : tenants.length === 1 ? tenants[0] : null
    if (!tenant) throw new Error(tenantArg ? `Empresa ${tenantArg} não encontrada.` : `O CRM tem ${tenants.length} empresas: informe qual recebe o painel (id).`)
    const T = tenant.id
    const integ = await prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId: T, key: INTEGRATION_KEY } } })
    if ((integ?.value as { active?: boolean } | null)?.active) throw new Error('O CRM já assumiu o atendimento do Mercado Livre: importar de novo apagaria o que o CRM respondeu. Nada foi alterado.')
    const others = await prisma.assistQuestion.count({ where: { NOT: { tenantId: T } } })
    if (others) throw new Error('Outra empresa já usa o assistente neste CRM: a importação com os números do painel não é possível. Nada foi alterado.')

    // Pessoas do painel → usuários do CRM pelo e-mail (o nome fica sempre registrado).
    const painelUsers = new Map(all('SELECT id, name, email FROM users').map((u) => [Number(u.id), { name: String(u.name), email: String(u.email ?? '').toLowerCase() }]))
    const crmUsers = new Map((await prisma.user.findMany({ where: { tenantId: T }, select: { id: true, email: true } })).map((u) => [u.email.toLowerCase(), u.id]))
    const who = (id: unknown) => {
      const u = id === null || id === undefined ? null : painelUsers.get(Number(id))
      return { id: u ? (crmUsers.get(u.email) ?? null) : null, name: u?.name ?? null }
    }

    const qCols = cols('questions')
    const questions = all('SELECT * FROM questions').map((q) => ({
      id: Number(q.id),
      tenantId: T,
      marketplace: s(q.marketplace) ?? 'mercadolivre',
      mlQuestionId: String(q.ml_question_id),
      mlItemId: s(q.ml_item_id),
      mlStatus: s(q.ml_status),
      customerId: s(q.customer_id),
      customerNickname: s(q.customer_nickname),
      customerName: qCols.has('customer_name') ? s(q.customer_name) : null,
      customerLookupAt: qCols.has('customer_lookup_at') ? d(q.customer_lookup_at) : null,
      text: String(q.text ?? ''),
      receivedAt: dn(q.received_at),
      firstSeenAt: dn(q.first_seen_at),
      status: String(q.status),
      processingState: 'ocioso',
      pendingReason: s(q.pending_reason),
      pendingSince: d(q.pending_since),
      brand: s(q.brand),
      model: s(q.model),
      partCode: s(q.part_code),
      purchaseIntent: b(q.purchase_intent),
      relevance: Number(q.relevance ?? 0),
      assignedToId: who(q.assigned_to).id,
      assignedToName: who(q.assigned_to).name,
      confidence: q.confidence === null || q.confidence === undefined ? null : Number(q.confidence),
      answeredAt: d(q.answered_at),
      resolvedAt: d(q.resolved_at),
      externalAnsweredAt: qCols.has('external_answered_at') ? d(q.external_answered_at) : null,
      updatedAt: dn(q.updated_at),
    }))
    const attempts = all('SELECT * FROM answer_attempts').map((a) => ({
      id: Number(a.id),
      tenantId: T,
      questionId: Number(a.question_id),
      origin: String(a.origin),
      kind: String(a.kind ?? 'resposta'),
      authorId: who(a.author_id).id,
      authorName: who(a.author_id).name,
      basedOnId: a.based_on_attempt_id ? Number(a.based_on_attempt_id) : null,
      text: String(a.text ?? ''),
      ai: j(a.ai_json),
      confidence: a.confidence === null || a.confidence === undefined ? null : Number(a.confidence),
      sendStatus: String(a.send_status),
      createdAt: dn(a.created_at),
      sendRequestedAt: d(a.send_requested_at),
      sentAt: d(a.sent_at),
      confirmedAt: d(a.confirmed_at),
      mlResponse: j(a.ml_response_json),
      mlAnswerRef: s(a.ml_answer_ref),
      error: s(a.error),
      sendAttempts: Number(a.send_attempts ?? 0),
      reviewed: b(a.reviewed),
      reviewedById: who(a.reviewed_by).id,
      reviewedByName: who(a.reviewed_by).name,
      flaggedForReview: b(a.flagged_for_review),
    }))
    const attemptKnowledge = all('SELECT * FROM attempt_knowledge').map((x) => ({ attemptId: Number(x.attempt_id), knowledgeId: Number(x.knowledge_id), knowledgeVersion: Number(x.knowledge_version) }))
    const notes = all('SELECT * FROM internal_notes').map((n) => ({ id: Number(n.id), tenantId: T, entity: String(n.entity), entityId: Number(n.entity_id), userId: who(n.user_id).id, userName: who(n.user_id).name ?? 'Painel', note: String(n.note), createdAt: dn(n.created_at) }))
    const events = all('SELECT * FROM question_events').map((e) => ({ id: Number(e.id), tenantId: T, questionId: Number(e.question_id), type: String(e.type), fromStatus: s(e.from_status), toStatus: s(e.to_status), userId: who(e.user_id).id, userName: who(e.user_id).name, note: s(e.note), data: j(e.data_json), createdAt: dn(e.created_at) }))
    const kCols = cols('knowledge')
    const knowledge = all('SELECT * FROM knowledge').map((k) => ({
      id: Number(k.id),
      tenantId: T,
      title: String(k.title),
      category: String(k.category),
      brand: s(k.brand),
      model: s(k.model),
      partCode: s(k.part_code),
      product: s(k.product),
      application: s(k.application),
      question: s(k.question),
      answer: String(k.answer ?? ''),
      source: s(k.source),
      status: String(k.status),
      version: Number(k.version ?? 1),
      originQuestionId: k.origin_question_id ? Number(k.origin_question_id) : null,
      originImportId: k.origin_import_id ? Number(k.origin_import_id) : null,
      createdById: who(k.created_by).id,
      createdByName: who(k.created_by).name,
      updatedById: who(k.updated_by).id,
      updatedByName: who(k.updated_by).name,
      approvedById: who(k.approved_by).id,
      approvedByName: who(k.approved_by).name,
      approvedAt: d(k.approved_at),
      createdAt: dn(k.created_at),
      updatedAt: dn(k.updated_at),
      deletedAt: d(k.deleted_at),
      deletedByName: who(k.deleted_by).name,
      matchKey: s(k.match_key),
      autoLearned: kCols.has('auto_learned') ? b(k.auto_learned) : false,
      mlItemId: kCols.has('ml_item_id') ? s(k.ml_item_id) : null,
      learnedFrom: kCols.has('learned_from') ? s(k.learned_from) : null,
    }))
    const versions = all('SELECT * FROM knowledge_versions').map((v) => ({ id: Number(v.id), tenantId: T, knowledgeId: Number(v.knowledge_id), version: Number(v.version), snapshot: j(v.snapshot_json) ?? {}, changeType: String(v.change_type), changedById: who(v.changed_by).id, changedByName: who(v.changed_by).name, changedAt: dn(v.changed_at) }))
    const imports = all('SELECT * FROM imports').map((i) => ({ id: Number(i.id), tenantId: T, filename: String(i.filename), userId: who(i.user_id).id, userName: who(i.user_id).name, createdAt: dn(i.created_at), finishedAt: d(i.finished_at), status: String(i.status), totalRows: Number(i.total_rows ?? 0), imported: Number(i.imported ?? 0), updated: Number(i.updated ?? 0), ignored: Number(i.ignored ?? 0), errors: Number(i.errors ?? 0), headerErrors: j(i.header_errors_json), report: j(i.report_json) }))
    const importRows = all('SELECT * FROM import_rows').map((r) => ({ id: Number(r.id), importId: Number(r.import_id), rowNumber: Number(r.row_number), data: j(r.data_json) ?? {}, action: String(r.action), existingId: r.existing_id ? Number(r.existing_id) : null, existing: j(r.existing_json), errors: j(r.errors_json), warnings: j(r.warnings_json), decision: String(r.decision ?? 'pendente'), result: s(r.result) }))
    const iCols = cols('ml_items')
    const items = all('SELECT * FROM ml_items').map((i) => ({
      tenantId: T,
      id: String(i.id),
      sellerId: iCols.has('seller_id') ? s(i.seller_id) : null,
      officialStoreId: iCols.has('official_store_id') ? s(i.official_store_id) : null,
      title: s(i.title),
      permalink: s(i.permalink),
      price: i.price === null || i.price === undefined ? null : Number(i.price),
      currency: s(i.currency),
      availableQuantity: i.available_quantity === null || i.available_quantity === undefined ? null : Number(i.available_quantity),
      status: s(i.status),
      sellerSku: s(i.seller_sku),
      partNumber: s(i.part_number),
      brand: s(i.brand),
      description: s(i.description),
      attributes: j(i.attributes_json),
      mlLastUpdated: iCols.has('ml_last_updated') ? s(i.ml_last_updated) : null,
      syncedAt: dn(i.synced_at),
    }))
    const apps = all('SELECT * FROM applications').map((a) => ({
      id: Number(a.id),
      tenantId: T,
      partCode: String(a.part_code),
      productName: s(a.product_name),
      partBrand: s(a.part_brand),
      machineBrand: s(a.machine_brand),
      machineModel: s(a.machine_model),
      system: s(a.system),
      application: s(a.application),
      mlItemId: s(a.ml_item_id),
      validationStatus: String(a.validation_status ?? 'pendente'),
      knowledgeId: a.knowledge_id ? Number(a.knowledge_id) : null,
      source: s(a.source),
      validatedById: who(a.validated_by).id,
      validatedByName: who(a.validated_by).name,
      validatedAt: d(a.validated_at),
      createdById: who(a.created_by).id,
      createdByName: who(a.created_by).name,
      createdAt: dn(a.created_at),
      updatedAt: dn(a.updated_at),
      matchKey: String(a.match_key ?? `${a.part_code}|${a.machine_brand}|${a.machine_model}`),
    }))
    const saleCols = has('sales') ? cols('sales') : new Set<string>()
    const sales = has('sales')
      ? all('SELECT * FROM sales').map((x) => ({
          id: Number(x.id),
          tenantId: T,
          mlOrderId: String(x.ml_order_id),
          mlItemId: String(x.ml_item_id),
          itemTitle: s(x.item_title),
          questionId: Number(x.question_id),
          buyerId: String(x.buyer_id),
          orderStatus: s(x.order_status),
          orderDate: dn(x.order_date),
          quantity: Number(x.quantity ?? 1),
          unitPrice: x.unit_price === null || x.unit_price === undefined ? null : Number(x.unit_price),
          total: x.total === null || x.total === undefined ? null : Number(x.total),
          currency: s(x.currency),
          matchType: String(x.match_type),
          hoursAfterQuestion: x.hours_after_question === null || x.hours_after_question === undefined ? null : Number(x.hours_after_question),
          linkedAt: dn(x.linked_at),
          updatedAt: dn(x.updated_at),
          paidBefore: saleCols.has('paid_before') ? b(x.paid_before) : false,
          paymentStatus: saleCols.has('payment_status') ? s(x.payment_status) : null,
        }))
      : []

    // Configurações, chaves de IA e acesso ao Mercado Livre (recriptografados com a chave do CRM).
    const settings = new Map(all('SELECT key, value_json FROM settings').map((r) => [String(r.key), j(r.value_json) as R | undefined]))
    const ai = { ...AI_DEFAULTS, ...((settings.get('ai') as Partial<typeof AI_DEFAULTS>) ?? {}) }
    const store = (settings.get('store') as R | undefined) ?? { seller_id: null }
    const painelInteg = (settings.get('integration') as R | undefined) ?? {}
    const decryptPainel = (enc: unknown) => {
      if (!enc || !secrets.encryptionKey) return null
      try {
        return painelDecrypt(String(enc), secrets.encryptionKey)
      } catch {
        return null
      }
    }
    const keyOf = (p: 'claude' | 'gemini') => {
      const fromPanel = decryptPainel((settings.get(`secret:${p}`) as R | undefined)?.enc) as { key?: string } | null
      return fromPanel?.key ?? (p === 'claude' ? secrets.anthropicKey : secrets.geminiKey) ?? null
    }
    const conn = has('ml_connection') ? (sq.prepare('SELECT * FROM ml_connection WHERE id = 1').get() as R | undefined) : undefined
    const tok = decryptPainel(conn?.token_enc) as { access_token?: string; refresh_token?: string; user_id?: number } | null

    await prisma.$transaction(
      async (tx) => {
        // substitui os dados do assistente desta empresa pelos do painel
        const qIds = (await tx.assistQuestion.findMany({ where: { tenantId: T }, select: { id: true } })).map((q) => q.id)
        const aIds = (await tx.assistAttempt.findMany({ where: { tenantId: T }, select: { id: true } })).map((a) => a.id)
        const impIds = (await tx.assistImport.findMany({ where: { tenantId: T }, select: { id: true } })).map((i) => i.id)
        await tx.assistAttemptKnowledge.deleteMany({ where: { attemptId: { in: aIds } } })
        await tx.assistImportRow.deleteMany({ where: { importId: { in: impIds } } })
        await tx.assistEvent.deleteMany({ where: { OR: [{ tenantId: T }, { questionId: { in: qIds } }] } })
        for (const m of ['assistNote', 'assistAttempt', 'assistQuestion', 'assistKnowledgeVersion', 'assistKnowledge', 'assistImport', 'assistApplication', 'assistSale', 'assistItem'] as const) {
          await (tx[m] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { tenantId: T } })
        }
        const chunk = async <X>(rows: X[], fn: (part: X[]) => Promise<unknown>) => {
          for (let i = 0; i < rows.length; i += 1000) await fn(rows.slice(i, i + 1000))
        }
        await chunk(items, (p) => tx.assistItem.createMany({ data: p }))
        await chunk(questions, (p) => tx.assistQuestion.createMany({ data: p }))
        await chunk(attempts, (p) => tx.assistAttempt.createMany({ data: p }))
        await chunk(knowledge, (p) => tx.assistKnowledge.createMany({ data: p }))
        await chunk(attemptKnowledge, (p) => tx.assistAttemptKnowledge.createMany({ data: p, skipDuplicates: true }))
        await chunk(versions, (p) => tx.assistKnowledgeVersion.createMany({ data: p }))
        await chunk(notes, (p) => tx.assistNote.createMany({ data: p }))
        await chunk(events, (p) => tx.assistEvent.createMany({ data: p }))
        await chunk(imports, (p) => tx.assistImport.createMany({ data: p }))
        await chunk(importRows, (p) => tx.assistImportRow.createMany({ data: p }))
        await chunk(apps, (p) => tx.assistApplication.createMany({ data: p, skipDuplicates: true }))
        await chunk(sales, (p) => tx.assistSale.createMany({ data: p, skipDuplicates: true }))
        // os próximos números continuam depois dos do painel
        for (const t of ['assist_questions', 'assist_attempts', 'assist_notes', 'assist_events', 'assist_knowledge', 'assist_knowledge_versions', 'assist_imports', 'assist_import_rows', 'assist_applications', 'assist_sales']) {
          await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1))`)
        }
        const set = (key: string, value: unknown) =>
          tx.tenantSetting.upsert({ where: { tenantId_key: { tenantId: T, key } }, create: { tenantId: T, key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } })
        await set(AI_KEY, ai)
        await set(STORE_KEY, store)
        await set(INTEGRATION_KEY, { ...INTEGRATION_DEFAULTS, ...painelInteg, active: false })
        await set(STATE_KEY, {
          lastItemsSyncAt: s(conn?.last_items_sync_at),
          lastQuestionsSyncAt: s(conn?.last_questions_sync_at),
          lastWebhookAt: s(conn?.last_webhook_at),
          lastOrdersSyncAt: s(conn?.last_orders_sync_at),
          logs: [{ level: 'info', message: `Dados trazidos do painel antigo (versão ${secrets.version ?? '?'}).`, at: new Date().toISOString() }],
        })
        for (const p of ['claude', 'gemini'] as const) {
          const k = keyOf(p)
          if (k) await set(SECRET_KEY(p), { enc: encrypt(k), masked: mask(k), updated_at: new Date().toISOString(), updated_by: 'Importação do painel' })
        }
        await set(PAINEL_KEY, {
          importedAt: new Date().toISOString(),
          version: secrets.version ?? null,
          clientId: secrets.mlClientId ?? null,
          clientSecretEnc: secrets.mlClientSecret ? encrypt(secrets.mlClientSecret) : null,
          accessTokenEnc: tok?.access_token ? encrypt(tok.access_token) : null,
          refreshTokenEnc: tok?.refresh_token ? encrypt(tok.refresh_token) : null,
          tokenExpiresAt: s(conn?.token_expires_at),
          sellerId: s(conn?.seller_id) ?? (tok?.user_id ? String(tok.user_id) : null),
          nickname: s(conn?.nickname),
          counts: { perguntas: questions.length, respostas: attempts.length, conhecimentos: knowledge.length, aplicacoes: apps.length, anuncios: items.length, vendas: sales.length, eventos: events.length },
        })
      },
      { timeout: 10 * 60_000, maxWait: 60_000 },
    )
    const out = {
      empresa: tenant.name,
      perguntas: questions.length,
      respostas: attempts.length,
      conhecimentos: knowledge.length,
      versoesDeConhecimento: versions.length,
      aplicacoes: apps.length,
      anuncios: items.length,
      vendas: sales.length,
      eventos: events.length,
      observacoes: notes.length,
      importacoes: imports.length,
      chaveClaude: !!keyOf('claude'),
      chaveGemini: !!keyOf('gemini'),
      acessoMercadoLivre: !!tok?.refresh_token,
      aplicativoMercadoLivre: !!secrets.mlClientId,
      pessoasSemUsuarioNoCrm: [...painelUsers.values()].filter((u) => !crmUsers.has(u.email)).map((u) => u.name),
    }
    console.log(JSON.stringify(out, null, 2))
  } finally {
    await prisma.$disconnect()
    sq.close()
  }
}

main().catch((e: unknown) => {
  console.error(`ERRO: ${(e as Error).message}`)
  process.exit(1)
})
