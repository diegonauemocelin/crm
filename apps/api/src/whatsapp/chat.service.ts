import { createHash, randomUUID } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy, Optional } from '@nestjs/common'
import { PushService } from '../app-movel/push.service'
import { AuditService } from '../audit/audit.service'
import { CapturaService } from '../captura/captura.service'
import type { RequestCtx } from '../common/decorators'
import { can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { EmailAiService } from '../email/ia.service'
import { detectImage, FilesService } from '../files/files.service'
import { Prisma, type WhatsappNumber } from '../generated/prisma/client'
import { LeadCaptureService } from '../leads/lead-capture.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { normalizePhone } from '../atendimento/br'
import { callHoursOf, DEFAULT_ATENDIMENTO } from '../atendimento/service-records.service'
import { type EvolutionClient, EvolutionError } from './evolution'
import { type Sector, servesNumber, splitWhere, teamOf, teamWhere } from './atendentes'
import { type AgendaCategory, answersClient, applyVariables, cleanRules, contactCard, type CompanyCategory, contactsFromWhatsapp, decide, DEFAULT_RULES, detectOutgoing, isClosingMessage, isOpen, LABEL_COLORS, type LabelColor, parseContactList, parseGoogleContacts, parseReceipts, receiptUpgrades, retentionCutoffs, toCallVia, parseVcf, safeFileName, SendRate, sentActions, signed, uploadName, type WaRules } from './envio'
import { parseCsv } from '../atendimento/planilha'
import { answersNote, type BotOutcome, botStateOf, chooseFlow, continueFlow, flowOf, startFlow } from './fluxo'
import { HISTORY_NAME, historyFrom, historyName, historyNote, historyPatch, type HistoryPick, pickHistory } from './historico'
import { extOf, INLINE_MEDIA_MAX_BYTES, MEDIA_MAX_BYTES, openSecretEdit, parseCalls, parseMessage, parseReaction, parseRevision, parseSecretEdit, type ParsedSecretEdit, parseRevisionEvent, type ParsedMessage, UNKNOWN_TEXT, unknownKeys, type ParsedRevision, phoneFromDigits, phoneLabel, phoneVariants, previewOf, whatsappOf, withReaction } from './mensagens'

const PAGE = 60
/** Nome que aparece nas mensagens e notas do chatbot. */
const BOT_NAME = 'Robô de atendimento'

/**
 * Conversas do WhatsApp: grava o que chega pela Evolution (ligando ao lead e ao Pré-Vendas) e entrega para a tela,
 * respeitando quem pode ver o quê (permissão "Chat WhatsApp": próprios, unidade ou todos).
 */
/** Figurinhas salvas por pessoa e o tamanho máximo de cada uma. */
const STICKER_MAX = 300
const STICKER_MAX_BYTES = 1024 * 1024

@Injectable()
export class ChatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WhatsAppChat')
  /** Uma mensagem por vez em cada conversa (duas chegando juntas não criam dois leads). */
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly rate = new SendRate()
  /** O WhatsappService informa o cliente da Evolution (evita dependência circular entre os dois). */
  clientOf: () => EvolutionClient | null = () => null

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly capture: LeadCaptureService,
    private readonly captura: CapturaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly ai?: EmailAiService,
    @Optional() private readonly push?: PushService,
  ) {}

  /** Última leitura em monitoramento registrada na auditoria (usuário + conversa), para não registrar a cada atualização da tela. */
  private readonly monitored = new Map<string, number>()

  // ---------- Prazo de guarda das conversas (LGPD) ----------

  private retentionTimer: NodeJS.Timeout | null = null

  onApplicationBootstrap() {
    this.retentionTimer = setInterval(() => void this.applyRetention(), 24 * 3_600_000)
    this.retentionTimer.unref()
    setTimeout(() => void this.applyRetention(), 5 * 60_000).unref()
    setTimeout(() => void this.stopAnsweredWaits().catch((err: unknown) => this.logger.warn(`Revisão do tempo de espera: ${(err as Error).message}`)), 60_000).unref()
  }

  /**
   * Conversas paradas com "aguardando retorno" depois de a empresa já ter respondido (regra anterior, em que a resposta
   * não parava o tempo): para o tempo quando a última mensagem da empresa é uma resposta, não uma promessa de retorno.
   */
  private async stopAnsweredWaits() {
    const convs = await this.prisma.whatsappConversation.findMany({ where: { status: 'ABERTA', noReplyNeeded: false, lastFromMe: true, lastInboundAt: { not: null }, botFlowId: null }, select: { id: true, lastInboundAt: true }, take: 5000 })
    let stopped = 0
    for (const c of convs) {
      const last = await this.prisma.whatsappMessage.findFirst({ where: { conversationId: c.id, fromMe: true, internal: false }, orderBy: { sentAt: 'desc' }, select: { type: true, text: true, sentAt: true, sentById: true, sentByName: true } })
      // Só resposta de pessoa: pelo CRM (tem quem enviou) ou pelo celular (sem nome). Robô, ausência e automação têm nome sem pessoa.
      const byPerson = !!last?.sentById || !last?.sentByName
      if (!last || last.sentAt < c.lastInboundAt! || !byPerson || !answersClient(last)) continue
      const r = await this.prisma.whatsappConversation.updateMany({ where: { id: c.id, lastInboundAt: c.lastInboundAt, noReplyNeeded: false }, data: { noReplyNeeded: true } })
      stopped += r.count
    }
    if (stopped) this.logger.log(`Tempo de espera parado em ${stopped} conversa(s) já respondida(s).`)
  }

  onModuleDestroy() {
    if (this.retentionTimer) clearInterval(this.retentionTimer)
  }

  /**
   * Apaga o que passou do prazo de guarda (uma vez por dia): primeiro os arquivos (fotos, áudios, documentos) e
   * depois as mensagens (cliente e demais contatos têm prazos próprios); conversa sem mensagem some junto.
   * Fica registrado na auditoria quanto foi apagado.
   */
  async applyRetention(now = Date.now()) {
    const tenants = await this.prisma.whatsappNumber.findMany({ distinct: ['tenantId'], select: { tenantId: true } })
    const out: { tenantId: string; files: number; messages: number; conversations: number }[] = []
    for (const { tenantId } of tenants) {
      try {
        const rules = await this.rules(tenantId)
        if (!rules.retention.enabled) continue
        const cut = retentionCutoffs(rules.retention, now)
        let files = 0
        for (;;) {
          const old = await this.prisma.whatsappMessage.findMany({ where: { tenantId, fileId: { not: null }, sentAt: { lt: cut.media } }, select: { id: true, fileId: true }, take: 200 })
          if (!old.length) break
          for (const m of old) await this.files.remove(m.fileId!).catch(() => undefined)
          await this.prisma.whatsappMessage.updateMany({ where: { id: { in: old.map((m) => m.id) } }, data: { fileId: null, mediaStatus: 'APAGADA' } })
          files += old.length
        }
        const messages = await this.prisma.$executeRaw`
          DELETE FROM whatsapp_messages m USING whatsapp_conversations c
          WHERE m."conversationId" = c.id AND c."tenantId" = ${tenantId}::uuid AND m."fileId" IS NULL
            AND ((c.category = 'CLIENTE' AND m."sentAt" < ${cut.client}) OR (c.category <> 'CLIENTE' AND m."sentAt" < ${cut.other}))`
        const conversations = await this.prisma.whatsappConversation.deleteMany({
          where: { tenantId, messages: { none: {} }, OR: [{ category: 'CLIENTE', lastMessageAt: { lt: cut.client } }, { category: { not: 'CLIENTE' }, lastMessageAt: { lt: cut.other } }] },
        })
        if (files || messages || conversations.count) {
          this.logger.log(`Prazo de guarda (LGPD): ${files} arquivo(s), ${messages} mensagem(ns) e ${conversations.count} conversa(s) apagados.`)
          await this.audit.log({ tenantId, action: 'whatsapp.prazo_de_guarda', entity: 'whatsapp', data: { arquivos: files, mensagens: messages, conversas: conversations.count, prazos: rules.retention } })
        }
        out.push({ tenantId, files, messages, conversations: conversations.count })
      } catch (err) {
        this.logger.error(`Prazo de guarda do WhatsApp falhou: ${(err as Error).message}`)
      }
    }
    return out
  }

  // ---------- Recebimento ----------

  ingest(n: WhatsappNumber, data: unknown, client: EvolutionClient | null) {
    const p = parseMessage(data)
    if (!p) {
      const r = parseReaction(data)
      if (r) return this.applyReaction(n, r).catch((err: unknown) => this.logger.warn(`Reação não gravada (${n.name}): ${(err as Error).message}`))
      const v = parseRevision(data)
      if (v) return this.applyRevision(n, v).catch((err: unknown) => this.logger.warn(`Edição de mensagem não gravada (${n.name}): ${(err as Error).message}`))
      const e = parseSecretEdit(data)
      return e ? this.applySecretEdit(n, e).catch((err: unknown) => this.logger.warn(`Edição de mensagem não gravada (${n.name}): ${(err as Error).message}`)) : Promise.resolve()
    }
    // Tipo novo do WhatsApp: fica o aviso na conversa e o formato no registro do servidor (para o CRM aprender a ler).
    if (p.type === 'outro' && p.text === UNKNOWN_TEXT) this.logger.warn(`Mensagem de tipo desconhecido (${n.name}): ${unknownKeys(data)}`)
    // Mesma fila para as duas formas do celular (com e sem o 9).
    return this.enqueue(`${n.id}:${phoneFromDigits(p.phoneDigits) ?? p.jid}`, () => this.store(n, p, client), `Mensagem não gravada (${n.name})`)
  }

  /** Uma mensagem por vez em cada conversa: a que chega ao vivo e a que vem do histórico entram na mesma fila. */
  private enqueue<T>(key: string, job: () => Promise<T>, failure: string): Promise<T | void> {
    const run: Promise<T | void> = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => job())
      .catch((err: unknown) => this.logger.error(`${failure}: ${(err as Error).message}`))
      .finally(() => {
        if (this.queues.get(key) === run) this.queues.delete(key)
      })
    this.queues.set(key, run)
    return run
  }

  /**
   * Mensagem de grupo: a conversa é o grupo (categoria GRUPO), com o nome de quem escreveu em cada mensagem.
   * Não liga lead, não abre pré-venda, não manda mensagem de ausência e não entra nos avisos de "sem resposta".
   */
  /** Reação recebida (ou feita pelo celular da empresa): fica na mensagem, uma por pessoa. */
  private async applyReaction(n: WhatsappNumber, r: { targetWaId: string; emoji: string; fromMe: boolean; reactor: string; name: string | null }) {
    const m = await this.prisma.whatsappMessage.findFirst({ where: { tenantId: n.tenantId, waId: r.targetWaId, conversation: { numberId: n.id } }, select: { id: true, reactions: true } })
    if (!m) return
    const reactions = withReaction(m.reactions, { emoji: r.emoji, by: r.fromMe ? 'me' : 'them', key: r.reactor, name: r.name })
    await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { reactions: reactions as unknown as Prisma.InputJsonValue } })
  }

  /** Edição e "apagar para todos" nos eventos próprios da Evolution 2.3 (messages.edited, messages.delete, messages.update). */
  async ingestRevisions(n: WhatsappNumber, event: string, data: unknown) {
    for (const v of parseRevisionEvent(event, data)) await this.applyRevision(n, v)
  }

  /** Mensagem apagada para todos ou editada no WhatsApp (pelo cliente, pelo celular da empresa ou a volta do envio do CRM). */
  private async applyRevision(n: WhatsappNumber, v: ParsedRevision) {
    const m = await this.prisma.whatsappMessage.findFirst({ where: { tenantId: n.tenantId, waId: v.targetWaId, conversation: { numberId: n.id } }, select: { id: true, conversationId: true, sentAt: true, type: true, deletedAt: true } })
    if (!m || m.deletedAt) return
    const at = new Date()
    if (v.kind === 'apagada') {
      await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { deletedAt: at, text: null } })
      await this.prisma.whatsappConversation.updateMany({ where: { id: m.conversationId, lastMessageAt: m.sentAt }, data: { lastPreview: 'Mensagem apagada' } })
      return
    }
    // Edição que não deu para abrir (sem a chave da original): fica marcada como editada, com o texto que tinha.
    if (v.text === null) {
      await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { editedAt: at } })
      return
    }
    // Chegou como tipo desconhecido e depois foi editada: o texto novo é o que vale.
    const type = (m.type === 'outro' ? 'texto' : m.type) as ParsedMessage['type']
    await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { editedAt: at, text: v.text, type } })
    await this.prisma.whatsappConversation.updateMany({ where: { id: m.conversationId, lastMessageAt: m.sentAt }, data: { lastPreview: previewOf({ type, text: v.text }) } })
  }

  /**
   * Edição criptografada (WhatsApp novo): abre com a chave guardada da mensagem original. Mensagem de antes de o CRM
   * guardar as chaves fica só marcada como editada.
   */
  private async applySecretEdit(n: WhatsappNumber, e: ParsedSecretEdit) {
    const m = await this.prisma.whatsappMessage.findFirst({ where: { tenantId: n.tenantId, waId: e.targetWaId, conversation: { numberId: n.id } }, select: { secret: true, conversation: { select: { jid: true, phone: true } } } })
    if (!m) return
    const own = n.phone ? `${n.phone.replace(/\D/g, '')}@s.whatsapp.net` : null
    const contactPhone = m.conversation.phone ? `${m.conversation.phone.replace(/\D/g, '')}@s.whatsapp.net` : null
    // Quem escreveu a original e quem editou: as formas do contato (telefone e @lid) e, por garantia, o próprio número.
    const senders = (e.fromMe ? [own, ...e.senders] : [...e.senders, m.conversation.jid, contactPhone]).filter((x): x is string => !!x)
    const r = m.secret ? openSecretEdit(m.secret, e.targetWaId, senders, e.encPayload, e.encIv) : null
    if (!r?.text) this.logger.warn(`Edição criptografada não aberta (${n.name}): ${r ? r.reason : 'mensagem original sem a chave'}`)
    await this.applyRevision(n, { targetWaId: e.targetWaId, kind: 'editada', text: r?.text ?? null })
  }

  /**
   * Conversa aberta pelo número escondido (@lid, ex.: ligação sem o telefone): quando chega uma mensagem com o
   * telefone, ela vira a conversa do telefone (ou se junta à que já existe), em vez de ficar um "Contato" sem nome.
   */
  private async adoptHidden(n: WhatsappNumber, lid: string, jid: string, phone: string | null, conv: Prisma.WhatsappConversationGetPayload<object> | null) {
    const hidden = await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid: lid } } })
    if (!hidden || hidden.id === conv?.id) return conv
    if (!conv) return this.prisma.whatsappConversation.update({ where: { id: hidden.id }, data: { jid, ...(phone ? { phone } : {}) } })
    await this.prisma.whatsappMessage.updateMany({ where: { conversationId: hidden.id }, data: { conversationId: conv.id } })
    await this.prisma.whatsappReminder.updateMany({ where: { conversationId: hidden.id }, data: { conversationId: conv.id } })
    const later = hidden.lastMessageAt && (!conv.lastMessageAt || hidden.lastMessageAt > conv.lastMessageAt)
    await this.prisma.whatsappConversation.delete({ where: { id: hidden.id } })
    return this.prisma.whatsappConversation.update({
      where: { id: conv.id },
      data: { unread: { increment: hidden.unread }, ...(hidden.lastInboundAt && (!conv.lastInboundAt || hidden.lastInboundAt > conv.lastInboundAt) ? { lastInboundAt: hidden.lastInboundAt } : {}), ...(later ? { lastMessageAt: hidden.lastMessageAt, lastPreview: hidden.lastPreview, lastFromMe: hidden.lastFromMe, status: hidden.status === 'ABERTA' ? 'ABERTA' : conv.status } : {}) },
    })
  }

  private async storeGroup(n: WhatsappNumber, p: ParsedMessage, client: EvolutionClient | null) {
    let conv = await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid: p.jid } } })
    if (!conv || !conv.name) {
      const subject = client ? await client.groupSubject(n.instanceName, p.jid).catch(() => null) : null
      conv ??= await this.prisma.whatsappConversation.create({ data: { tenantId: n.tenantId, numberId: n.id, jid: p.jid, name: subject, category: 'GRUPO' } })
      if (subject && !conv.name) conv = await this.prisma.whatsappConversation.update({ where: { id: conv.id }, data: { name: subject } })
    }
    const tooBig = !!p.media?.size && p.media.size > MEDIA_MAX_BYTES
    const saved = await this.prisma.whatsappMessage.createManyAndReturn({
      data: [
        {
          tenantId: n.tenantId,
          conversationId: conv.id,
          waId: p.waId,
          fromMe: p.fromMe,
          type: p.type,
          text: p.text,
          fileName: p.media?.fileName ?? null,
          mime: p.media?.mime ?? null,
          mediaStatus: p.media ? (tooBig ? 'GRANDE' : 'PENDENTE') : null,
          quotedWaId: p.quoted?.waId ?? null,
          quotedText: p.quoted?.text ?? null,
          secret: p.secret ?? null,
          // Quem escreveu no grupo (o celular da empresa, quando é ela).
          sentByName: p.fromMe ? null : (p.pushName ?? 'Participante'),
          sentAt: p.at,
        },
      ],
      skipDuplicates: true,
    })
    if (!saved.length) return
    const later = !conv.lastMessageAt || p.at >= conv.lastMessageAt
    const preview = previewOf(p)
    await this.prisma.whatsappConversation.update({
      where: { id: conv.id },
      data: {
        category: 'GRUPO',
        ...(later ? { lastMessageAt: p.at, lastPreview: (p.fromMe || !p.pushName ? preview : `${p.pushName}: ${preview}`).slice(0, 140), lastFromMe: p.fromMe } : {}),
        ...(p.fromMe ? { unread: 0 } : { unread: { increment: 1 }, status: 'ABERTA' }),
      },
    })
    if (p.media && !tooBig && client) void this.downloadMedia(n, saved[0]!.id, p, client)
  }

  private async store(n: WhatsappNumber, p: ParsedMessage, client: EvolutionClient | null) {
    if (p.group) return this.storeGroup(n, p, client)
    const phone = phoneFromDigits(p.phoneDigits)
    // O WhatsApp pode registrar o celular sem o 9: a conversa é a mesma se o telefone (já com o 9) bate.
    let conv =
      (await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid: p.jid } } })) ??
      (phone ? await this.prisma.whatsappConversation.findFirst({ where: { numberId: n.id, phone } }) : null)
    if (p.lid) conv = await this.adoptHidden(n, p.lid, p.jid, phone, conv)
    const rules = await this.rules(n.tenantId)
    // "Muito obrigada!", "ok 👍" depois da última fala da empresa (só para não reabrir um atendimento recém-finalizado).
    const goodbye = !p.fromMe && !!conv && (conv.lastFromMe || conv.noReplyNeeded) && isClosingMessage(p)
    // Agradeceu logo depois de finalizado: o atendimento continua finalizado (não abre outro nem volta para a fila).
    const staysClosed = goodbye && !!conv?.closedAt && p.at.getTime() - conv.closedAt.getTime() < 2 * 86_400_000
    // Atendimento finalizado conta como conversa nova: a próxima mensagem do cliente abre outro atendimento.
    const idle = !staysClosed && (!conv?.lastMessageAt || !!conv.closedAt || p.at.getTime() - conv.lastMessageAt.getTime() > rules.reopenDays * 86_400_000)
    // Contato da empresa (lista do administrador) ou marcado no chat: vale para todos os números.
    const contact = await this.agendaContact(n.tenantId, n.id, phone ?? p.jid)
    conv ??= await this.prisma.whatsappConversation.create({ data: { tenantId: n.tenantId, numberId: n.id, jid: p.jid, phone, name: p.pushName, category: contact?.category ?? 'CLIENTE' } })

    const tooBig = !!p.media?.size && p.media.size > MEDIA_MAX_BYTES
    const saved = await this.prisma.whatsappMessage.createManyAndReturn({
      data: [
        {
          tenantId: n.tenantId,
          conversationId: conv.id,
          waId: p.waId,
          fromMe: p.fromMe,
          type: p.type,
          text: p.text,
          fileName: p.media?.fileName ?? null,
          mime: p.media?.mime ?? null,
          mediaStatus: p.media ? (tooBig ? 'GRANDE' : 'PENDENTE') : null,
          quotedWaId: p.quoted?.waId ?? null,
          quotedText: p.quoted?.text ?? null,
          secret: p.secret ?? null,
          sentAt: p.at,
        },
      ],
      skipDuplicates: true,
    })
    // A Evolution pode mandar o mesmo evento de novo: grava uma vez só. A volta do envio do CRM (já gravado) só traz a chave.
    if (!saved.length) {
      if (p.secret) await this.prisma.whatsappMessage.updateMany({ where: { conversationId: conv.id, waId: p.waId, secret: null }, data: { secret: p.secret } })
      return
    }
    // A própria mensagem de ausência voltando como evento: não conta como resposta (o cliente continua esperando).
    if (p.fromMe && conv.awaySentAt && Math.abs(p.at.getTime() - conv.awaySentAt.getTime()) < 5 * 60_000 && (p.text ?? '').trim() === rules.away.text.trim()) {
      await this.prisma.whatsappMessage.update({ where: { id: saved[0]!.id }, data: { sentByName: 'Mensagem automática (fora do horário)', status: 'ENVIADA' } })
      return
    }

    // Lead pelo telefone (com e sem o 9); o resto segue as regras do administrador, sem o operador fazer nada.
    let leadId: string | null = conv.leadId
    let recordId = conv.recordId
    let leadPhone = phone
    const lead = !contact || contact.category === 'CLIENTE'
      ? await this.prisma.lead.findFirst({
          where: { tenantId: n.tenantId, deletedAt: null, anonymizedAt: null, ...(leadId ? { id: leadId } : phone ? { phone: { in: phoneVariants(phone) } } : { id: { in: [] } }) },
          orderBy: { createdAt: 'asc' },
          select: { id: true, phone: true },
        })
      : null
    if (lead) {
      leadId = lead.id
      // Telefone como está no lead (com ou sem o 9), para a captura não criar outro lead.
      leadPhone = lead.phone ?? phone
    }
    const plan = decide(rules, { marked: contact?.category ?? null, hasLead: !!lead, idle, fromMe: p.fromMe, hasPhone: !!phone, numberOpensRecords: n.createRecords })
    const category = plan.category
    if (!plan.linkLead) leadId = null
    if (plan.createLead || plan.openRecord) {
      const r = await this.openRecord(n, { name: p.pushName, phone: leadPhone ?? phone! }, p.text, previewOf(p), p.at, plan.openRecord)
      if (r) {
        leadId = r.leadId
        recordId = r.recordId ?? recordId
      }
    }

    const later = !conv.lastMessageAt || p.at >= conv.lastMessageAt
    // Atendimento dividido com atendente padrão: todo cliente sem atendente vai para ele (sem passar pela fila).
    const toDefault = n.splitAttendance && n.defaultUserId && !conv.assignedUserId && !p.fromMe && category === 'CLIENTE' && n.userIds.includes(n.defaultUserId)
    await this.prisma.whatsappConversation.update({
      where: { id: conv.id },
      data: {
        leadId,
        recordId,
        category,
        ...(toDefault ? { assignedUserId: n.defaultUserId } : {}),
        ...(phone && !conv.phone ? { phone } : {}),
        ...(p.pushName && !conv.name ? { name: p.pushName } : {}),
        // Resposta da empresa pelo celular para o tempo de "aguardando retorno"; promessa de retorno ("vou verificar e
        // lhe retorno") e figurinha não param (nem mensagem com o robô atendendo). Mensagem do cliente (inclusive
        // "obrigado") volta a contar o tempo: só o atendente decide quando não precisa responder.
        ...(later ? { lastMessageAt: p.at, lastPreview: previewOf(p), lastFromMe: p.fromMe, ...(p.fromMe ? (!conv.botFlowId && answersClient(p) ? { noReplyNeeded: true } : {}) : { noReplyNeeded: false, lastInboundAt: p.at }) } : {}),
        // Resposta pelo celular zera as não lidas (alguém já está atendendo).
        ...(p.fromMe ? { unread: 0 } : staysClosed ? {} : { unread: { increment: 1 }, status: 'ABERTA', closedAt: null, closedByName: null }),
      },
    })
    if (p.media && !tooBig && client) void this.downloadMedia(n, saved[0]!.id, p, client)
    // Resposta de uma pessoa da empresa pelo celular: o robô sai da conversa.
    if (p.fromMe && conv.botFlowId) await this.prisma.whatsappConversation.update({ where: { id: conv.id }, data: { botFlowId: null, botState: Prisma.DbNull } })
    // Chatbot: continua o fluxo ou começa um (cliente sem atendente). Com o robô atendendo, não vai a mensagem de ausência.
    const botHandled =
      !p.fromMe && !goodbye && category === 'CLIENTE' && client && n.status === 'CONECTADO' && Date.now() - p.at.getTime() < 10 * 60_000
        ? await this.runBot(n, { ...conv, assignedUserId: toDefault ? n.defaultUserId : conv.assignedUserId }, p, rules, idle, client).catch((err: unknown) => (this.logger.warn(`Chatbot (${n.name}): ${(err as Error).message}`), false))
        : false
    if (!botHandled && !p.fromMe && !goodbye && category === 'CLIENTE' && client) void this.sendAway(n, conv, p, rules, client).catch((err: unknown) => this.logger.warn(`Mensagem de ausência não enviada (${n.name}): ${(err as Error).message}`))
    // Notificação no celular: mensagem nova do contato (não a do robô nem um agradecimento de atendimento já finalizado).
    if (!p.fromMe && !botHandled && !staysClosed && Date.now() - p.at.getTime() < 10 * 60_000) {
      void this.notifyNew(n, { ...conv, assignedUserId: toDefault ? n.defaultUserId : conv.assignedUserId }, p, phone)
    }
  }

  /** Quem recebe a notificação: quem atende e os participantes; sem atendente, toda a equipe do número. */
  private async notifyNew(n: WhatsappNumber, conv: { id: string; name: string | null; assignedUserId: string | null; helperUserIds: string[] }, p: ParsedMessage, phone: string | null) {
    if (!this.push) return
    try {
      const to = conv.assignedUserId ? [conv.assignedUserId, ...conv.helperUserIds] : [...(await this.numberTeam(n.tenantId, n.id)).ids]
      await this.push.notify(n.tenantId, to, { title: conv.name || p.pushName || (phone ? `+${phone.replace(/\D/g, '')}` : 'Nova mensagem'), body: previewOf(p), url: `/app/conversa/${conv.id}`, tag: conv.id })
    } catch (err) {
      this.logger.warn(`Notificação da conversa não saiu: ${(err as Error).message}`)
    }
  }

  // ---------- Histórico (número conectado de novo pelo QR Code) ----------

  /**
   * Histórico que o WhatsApp manda ao conectar um aparelho novo (evento messages.set): grava as mensagens das últimas
   * horas que não chegaram ao CRM (ex.: com a sessão caída), com a data original. Não dispara nada: sem robô, mensagem
   * de ausência, lead novo, pré-venda, dia seguinte nem atendente padrão. Lê o pedido na hora (o corpo pode ser grande).
   */
  importHistory(n: WhatsappNumber, data: unknown, client: EvolutionClient | null) {
    return this.saveHistory(n, pickHistory(data, historyFrom(new Date(), [n.createdAt])), client)
  }

  private async saveHistory(n: WhatsappNumber, picked: HistoryPick, client: EvolutionClient | null) {
    const { items, ...counts } = picked
    if (!items.length) return null
    // Número que nunca teve conversa no CRM (primeira conexão): o histórico do celular não entra.
    if (!(await this.prisma.whatsappConversation.findFirst({ where: { numberId: n.id }, select: { id: true } }))) {
      this.logger.log(`Histórico do WhatsApp (${n.name}): primeira conexão do número, nada recuperado.`)
      return null
    }
    // Lead apagado a pedido do titular (LGPD) não volta pelo histórico: só entra o que veio depois da exclusão.
    const erased = await this.prisma.auditLog.findFirst({ where: { tenantId: n.tenantId, action: 'lead.anonymized', createdAt: { gt: items[0]!.at } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
    const wanted = erased ? items.filter((p) => p.at > erased.createdAt) : items
    // Já gravadas neste número (ao vivo ou num pedaço anterior do histórico): ficam como estão.
    const known = new Set<string>()
    for (let i = 0; i < wanted.length; i += 500) {
      const rows = await this.prisma.whatsappMessage.findMany({ where: { tenantId: n.tenantId, waId: { in: wanted.slice(i, i + 500).map((p) => p.waId) }, conversation: { numberId: n.id } }, select: { waId: true } })
      for (const r of rows) known.add(r.waId)
    }
    const rules = await this.rules(n.tenantId)
    const perConv = new Map<string, number>()
    const media: { id: string; p: ParsedMessage }[] = []
    let conversasNovas = 0
    let semTelefone = 0
    for (const p of wanted) {
      if (known.has(p.waId)) continue
      const r = await this.enqueue(`${n.id}:${phoneFromDigits(p.phoneDigits) ?? p.jid}`, () => this.storeHistory(n, p, rules), `Mensagem do histórico não gravada (${n.name})`)
      if (!r) continue
      perConv.set(r.conversationId, (perConv.get(r.conversationId) ?? 0) + 1)
      if (r.created) conversasNovas++
      if (!p.phoneDigits) semTelefone++
      if (r.mediaId) media.push({ id: r.mediaId, p })
    }
    // Nota em cada conversa que recebeu mensagens: quem atende entende por que apareceram mensagens antigas.
    for (const [conversationId, count] of perConv) {
      await this.prisma.whatsappMessage.create({ data: { tenantId: n.tenantId, conversationId, waId: `nota:${randomUUID()}`, fromMe: true, type: 'nota', text: historyNote(count), internal: true, sentByName: HISTORY_NAME, status: 'NOTA', sentAt: new Date() } })
    }
    const gravadas = [...perConv.values()].reduce((a, b) => a + b, 0)
    const result = { ...counts, foraDaJanela: counts.foraDaJanela + items.length - wanted.length, jaNoCrm: known.size, gravadas, conversas: perConv.size, conversasNovas, semTelefone, midias: media.length }
    this.logger.log(`Histórico do WhatsApp (${n.name}): ${gravadas} mensagem(ns) recuperada(s) em ${perConv.size} conversa(s), ${known.size} já estavam no CRM.`)
    await this.audit.log({ tenantId: n.tenantId, action: 'whatsapp.historico_importado', entity: 'whatsapp_number', entityId: n.id, data: { numero: n.name, ...result } }).catch((err: unknown) => this.logger.warn(`Auditoria do histórico não gravada (${n.name}): ${(err as Error).message}`))
    // Mídias uma por vez, depois de tudo gravado (sem encher o serviço de WhatsApp de pedidos).
    if (client) for (const m of media) await this.downloadMedia(n, m.id, m.p, client)
    return result
  }

  /** Uma mensagem do histórico: acha (ou cria) a conversa e grava, sem nenhuma ação automática. */
  private async storeHistory(n: WhatsappNumber, p: ParsedMessage, rules: WaRules) {
    const phone = phoneFromDigits(p.phoneDigits)
    let conv =
      (await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid: p.jid } } })) ??
      (phone ? await this.prisma.whatsappConversation.findFirst({ where: { numberId: n.id, phone } }) : null)
    const created = !conv
    const name = historyName(p.pushName)
    if (!conv) {
      // Conversa só com o histórico: fica na fila (sem atendente), ligada ao lead que já existe, sem criar lead nem pré-venda.
      // Sem o telefone (@lid), fica como contato escondido e junta com a do telefone quando o cliente escrever de novo.
      const contact = await this.agendaContact(n.tenantId, n.id, phone ?? p.jid)
      const lead =
        phone && (!contact || contact.category === 'CLIENTE')
          ? await this.prisma.lead.findFirst({ where: { tenantId: n.tenantId, deletedAt: null, anonymizedAt: null, phone: { in: phoneVariants(phone) } }, orderBy: { createdAt: 'asc' }, select: { id: true } })
          : null
      const plan = decide(rules, { marked: contact?.category ?? null, hasLead: !!lead, idle: true, fromMe: p.fromMe, hasPhone: !!phone, numberOpensRecords: n.createRecords })
      conv = await this.prisma.whatsappConversation.create({ data: { tenantId: n.tenantId, numberId: n.id, jid: p.jid, phone, name, category: plan.category, leadId: lead && plan.linkLead ? lead.id : null } })
    }
    const tooBig = !!p.media?.size && p.media.size > MEDIA_MAX_BYTES
    const saved = await this.prisma.whatsappMessage.createManyAndReturn({
      data: [
        {
          tenantId: n.tenantId,
          conversationId: conv.id,
          waId: p.waId,
          fromMe: p.fromMe,
          type: p.type,
          text: p.text,
          fileName: p.media?.fileName ?? null,
          mime: p.media?.mime ?? null,
          mediaStatus: p.media ? (tooBig ? 'GRANDE' : 'PENDENTE') : null,
          quotedWaId: p.quoted?.waId ?? null,
          quotedText: p.quoted?.text ?? null,
          secret: p.secret ?? null,
          sentAt: p.at,
        },
      ],
      skipDuplicates: true,
    })
    if (!saved.length) return null
    await this.prisma.whatsappConversation.update({ where: { id: conv.id }, data: historyPatch(conv, p, { phone, name }) })
    return { conversationId: conv.id, created, mediaId: p.media && !tooBig ? saved[0]!.id : null }
  }

  // ---------- Chatbot de atendimento ----------

  /**
   * Robô de atendimento: com a conversa num fluxo, interpreta a resposta do cliente; sem fluxo e sem atendente,
   * começa o fluxo que se aplica (palavra-chave, conversa nova ou parada, fora do horário). Devolve se o robô atendeu.
   */
  private async runBot(n: WhatsappNumber, conv: Prisma.WhatsappConversationGetPayload<object>, p: ParsedMessage, rules: WaRules, idle: boolean, client: EvolutionClient) {
    const name = conv.name ?? p.pushName ?? null
    if (conv.botFlowId) {
      const flow = await this.prisma.whatsappFlow.findFirst({ where: { id: conv.botFlowId, tenantId: n.tenantId, active: true } })
      const expired = !flow || !conv.botAt || Date.now() - conv.botAt.getTime() > flow.timeoutMinutes * 60_000
      if (flow && !expired && !conv.assignedUserId) {
        await this.applyBot(n, conv, flow, continueFlow(flowOf(flow), botStateOf(conv.botState), p.text ?? '', name), client)
        return true
      }
      // Cliente sumiu (passou do tempo) ou alguém assumiu: o robô sai sem avisar.
      await this.prisma.whatsappConversation.update({ where: { id: conv.id }, data: { botFlowId: null, botState: Prisma.DbNull } })
      if (conv.assignedUserId) return false
    } else if (conv.assignedUserId) return false
    const flows = await this.prisma.whatsappFlow.findMany({ where: { tenantId: n.tenantId, active: true }, orderBy: { createdAt: 'asc' } })
    const flow = chooseFlow(flows, { numberId: n.id, text: p.text ?? '', idle, afterHours: rules.businessHours.enabled && !isOpen(rules.businessHours, p.at) })
    if (!flow) return false
    await this.applyBot(n, conv, flow, startFlow(flowOf(flow), name), client)
    return true
  }

  /** Envia as mensagens do robô e grava onde a conversa ficou (ou para quem foi transferida). */
  private async applyBot(n: WhatsappNumber, conv: { id: string; jid: string; numberId: string }, flow: { id: string; name: string }, out: BotOutcome, client: EvolutionClient) {
    const target = conv.jid.endsWith('@s.whatsapp.net') ? conv.jid.split('@')[0]! : conv.jid
    for (const text of out.messages) {
      if (this.rate.check(n.id)) break
      const r = await client.sendText(n.instanceName, target, text)
      const data = { sentByName: BOT_NAME, status: 'ENVIADA' }
      await this.prisma.whatsappMessage.upsert({
        where: { conversationId_waId: { conversationId: conv.id, waId: r.waId } },
        create: { tenantId: n.tenantId, conversationId: conv.id, waId: r.waId, fromMe: true, type: 'texto', text, sentAt: r.at, ...data },
        update: data,
      })
      await this.prisma.whatsappConversation.update({ where: { id: conv.id }, data: { lastMessageAt: r.at, lastPreview: previewOf({ type: 'texto', text }), lastFromMe: true } })
    }
    if (out.state) {
      await this.prisma.whatsappConversation.update({ where: { id: conv.id }, data: { botFlowId: flow.id, botState: out.state as unknown as Prisma.InputJsonValue, botAt: new Date() } })
      return
    }
    // Saiu: transfere (setor válido no número, pessoa ativa) e deixa as respostas como nota para quem atender.
    const sectors = (await this.sectors(n.tenantId)).filter((x) => servesNumber(x, n.id))
    const sectorId = out.transfer?.sectorId && sectors.some((x) => x.id === out.transfer!.sectorId) ? out.transfer.sectorId : null
    const userId = out.transfer?.userId && (await this.prisma.user.count({ where: { id: out.transfer.userId, tenantId: n.tenantId, active: true } })) ? out.transfer.userId : null
    const note = answersNote(out.answers ?? [])
    await this.prisma.whatsappConversation.update({
      where: { id: conv.id },
      data: { botFlowId: null, botState: Prisma.DbNull, botAt: new Date(), ...(sectorId ? { sectorId } : {}), ...(userId ? { assignedUserId: userId } : {}), ...(note ? { noteUnread: true } : {}) },
    })
    const where = userId ? 'para a pessoa escolhida' : sectorId ? `para o setor ${sectors.find((x) => x.id === sectorId)?.name ?? ''}` : 'para a fila'
    const lines = [`${BOT_NAME} (${flow.name}): conversa ${out.ended === 'sem_resposta_valida' ? 'sem resposta válida, passada' : 'passada'} ${where}.`, ...(note ? ['', note] : [])]
    await this.prisma.whatsappMessage.create({
      data: { tenantId: n.tenantId, conversationId: conv.id, waId: `nota:${randomUUID()}`, fromMe: true, type: 'nota', text: lines.join('\n'), internal: true, sentByName: BOT_NAME, status: 'NOTA', sentAt: new Date() },
    })
  }

  /**
   * Fora do horário comercial: responde sozinho com a mensagem de ausência, uma vez a cada X horas por contato.
   * Só para mensagem nova (não o histórico que o WhatsApp sincroniza) e com o número conectado.
   */
  private async sendAway(n: WhatsappNumber, conv: { id: string; jid: string }, p: ParsedMessage, rules: WaRules, client: EvolutionClient) {
    if (!rules.away.enabled || !rules.businessHours.enabled || isOpen(rules.businessHours, p.at)) return
    if (Date.now() - p.at.getTime() > 10 * 60_000 || n.status !== 'CONECTADO') return
    const since = new Date(Date.now() - rules.away.cooldownHours * 3_600_000)
    // Marca antes de enviar: duas mensagens seguidas do cliente não geram duas respostas.
    const claimed = await this.prisma.whatsappConversation.updateMany({ where: { id: conv.id, OR: [{ awaySentAt: null }, { awaySentAt: { lt: since } }] }, data: { awaySentAt: new Date() } })
    if (!claimed.count || this.rate.check(n.id)) return
    const target = conv.jid.endsWith('@s.whatsapp.net') ? conv.jid.split('@')[0]! : conv.jid
    await client.sendText(n.instanceName, target, rules.away.text)
  }

  /** Confirmações de entrega e leitura das mensagens enviadas (evento messages.update). */
  async applyReceipts(n: WhatsappNumber, data: unknown) {
    const list = parseReceipts(data)
    if (!list.length) return
    const rows = await this.prisma.whatsappMessage.findMany({ where: { tenantId: n.tenantId, waId: { in: list.map((r) => r.waId) }, fromMe: true, conversation: { numberId: n.id } }, select: { id: true, waId: true, status: true } })
    for (const r of list) {
      const m = rows.find((x) => x.waId === r.waId)
      if (!m || !receiptUpgrades(m.status, r.status)) continue
      await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { status: r.status } })
      m.status = r.status
    }
  }

  /** Ligação recebida: vira um aviso na conversa (atender pelo celular). Não cria lead nem pré-venda. */
  async ingestCalls(n: WhatsappNumber, data: unknown) {
    for (const c of parseCalls(data)) {
      const phone = phoneFromDigits(c.phoneDigits)
      let conv =
        (await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid: c.jid } } })) ??
        (phone ? await this.prisma.whatsappConversation.findFirst({ where: { numberId: n.id, phone } }) : null)
      if (!conv) {
        const contact = await this.agendaContact(n.tenantId, n.id, phone ?? c.jid)
        const lead = phone && (!contact || contact.category === 'CLIENTE') ? await this.prisma.lead.findFirst({ where: { tenantId: n.tenantId, deletedAt: null, anonymizedAt: null, phone: { in: phoneVariants(phone) } }, select: { id: true } }) : null
        conv = await this.prisma.whatsappConversation.create({ data: { tenantId: n.tenantId, numberId: n.id, jid: c.jid, phone, category: contact?.category ?? 'CLIENTE', leadId: lead?.id ?? null } })
      }
      const text = c.isVideo ? 'Ligação de vídeo recebida. Atenda pelo celular deste número.' : 'Ligação de voz recebida. Atenda pelo celular deste número.'
      const saved = await this.prisma.whatsappMessage.createMany({ data: [{ tenantId: n.tenantId, conversationId: conv.id, waId: `call-${c.callId}`, fromMe: false, type: 'chamada', text, sentAt: c.at }], skipDuplicates: true })
      if (!saved.count) continue
      await this.prisma.whatsappConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: c.at, lastPreview: c.isVideo ? 'Ligação de vídeo recebida' : 'Ligação de voz recebida', lastFromMe: false, noReplyNeeded: false, lastInboundAt: c.at, unread: { increment: 1 }, status: 'ABERTA' },
      })
    }
  }

  /** Regras do WhatsApp definidas pelo administrador (Números de WhatsApp → Regras). */
  async rules(tenantId: string) {
    return cleanRules(await this.settings.get<Partial<WaRules>>(tenantId, 'whatsapp_regras', DEFAULT_RULES))
  }

  /** Lead (novo ou o já cadastrado com o telefone, com o histórico) e, se pedido, atendimento no Pré-Vendas. */
  private async openRecord(n: WhatsappNumber, c: { name: string | null; phone: string }, text: string | null, preview: string, at: Date, withRecord = true) {
    const ownerId = n.sellerIds.length === 1 ? n.sellerIds[0]! : null
    const originName = `WhatsApp - ${n.name}`.slice(0, 80)
    const channel = `WhatsApp "${n.name}"`
    const r = await this.capture.capture(
      n.tenantId,
      { name: c.name, phone: c.phone },
      { title: `Chamou no WhatsApp (${n.name})`, originName, touch: { source: 'whatsapp', medium: 'mensagem', conversao: channel }, details: { canal: 'whatsapp', numero: n.name, mensagem: preview }, ownerId, tags: ['whatsapp'], occurredAt: at },
    )
    if (!r) return null
    if (!withRecord) return { leadId: r.leadId, recordId: null }
    const recordId = await this.captura.preVendas(n.tenantId, r.leadId, { name: c.name, email: null, phone: c.phone, city: null, state: null }, channel, originName, ownerId, text, {}, null, [])
    return { leadId: r.leadId, recordId }
  }

  private async downloadMedia(n: WhatsappNumber, messageId: string, p: ParsedMessage, client: EvolutionClient) {
    try {
      const r = await client.media(n.instanceName, p.raw)
      if (!r) throw new Error('sem conteúdo')
      const buf = Buffer.from(r.base64, 'base64')
      if (!buf.length) throw new Error('vazio')
      if (buf.length > MEDIA_MAX_BYTES) {
        await this.prisma.whatsappMessage.update({ where: { id: messageId }, data: { mediaStatus: 'GRANDE' } })
        return
      }
      const mime = p.media?.mime || r.mime?.split(';')[0]?.trim() || 'application/octet-stream'
      const asset = await this.files.saveBuffer(n.tenantId, 'whatsapp', buf, mime, extOf(mime))
      await this.prisma.whatsappMessage.update({ where: { id: messageId }, data: { fileId: asset.id, mime, mediaStatus: 'OK' } })
    } catch (err) {
      this.logger.warn(`Mídia não baixada (${n.name}): ${(err as Error).message}`)
      await this.prisma.whatsappMessage.update({ where: { id: messageId }, data: { mediaStatus: 'ERRO' } }).catch(() => undefined)
    }
  }

  // ---------- Tela ----------

  private assertCan(user: AuthUser) {
    if (!can(user.permissions, user.role.isSystem, 'chat', 'view')) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  /** Monitorar conversas: ler todas as conversas da empresa, sem responder e sem marcar como lidas. */
  canMonitor(user: AuthUser) {
    return can(user.permissions, user.role.isSystem, 'monitoramento', 'view')
  }

  /** Setores de atendimento da empresa (ativos). */
  async sectors(tenantId: string): Promise<Sector[]> {
    const rows = await this.prisma.whatsappSector.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' } })
    return rows.map((r) => ({ id: r.id, name: r.name, numberIds: r.numberIds, userIds: r.userIds, managerIds: r.managerIds, visibility: r.visibility === 'SETOR' ? 'SETOR' : 'PROPRIAS' }))
  }

  /**
   * O que a pessoa pode acompanhar no monitoramento: tudo (permissão "Monitorar conversas") ou só a equipe dela
   * (quem a tem como gestora e os setores que ela gerencia). null = nada.
   */
  async monitorScope(user: AuthUser): Promise<Prisma.WhatsappConversationWhereInput | null> {
    if (this.canMonitor(user)) return { tenantId: user.tenantId }
    const [users, sectors] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId: user.tenantId, active: true, managerIds: { has: user.id } }, select: { id: true, managerIds: true } }),
      this.sectors(user.tenantId),
    ])
    const team = teamWhere(teamOf(user.id, users, sectors))
    return team ? { tenantId: user.tenantId, ...team } : null
  }

  /** Para a tela: pode monitorar tudo, só a equipe, ou nada. */
  async monitorAccess(user: AuthUser) {
    if (this.canMonitor(user)) return { scope: 'TODOS' as const }
    return { scope: (await this.monitorScope(user)) ? ('EQUIPE' as const) : null }
  }

  private async assertMonitor(user: AuthUser) {
    const scope = await this.monitorScope(user)
    if (!scope) throw new ForbiddenException('Você não tem permissão para monitorar as conversas.')
    return scope
  }

  /** Conversas de um vendedor: as passadas para ele e as dos números em que ele atende. */
  private async sellerWhere(tenantId: string, sellerId: string): Promise<Prisma.WhatsappConversationWhereInput> {
    const nums = await this.prisma.whatsappNumber.findMany({ where: { tenantId, sellerIds: { has: sellerId } }, select: { id: true } })
    return { OR: [{ assignedSellerId: sellerId }, { assignedSellerId: null, numberId: { in: nums.map((x) => x.id) } }] }
  }

  private scopeOf(user: AuthUser): Scope {
    return user.role.isSystem ? 'ALL' : (user.permissions.chat?.scope ?? 'ALL')
  }

  /** Próprios: números em que o vendedor do usuário atende (ou conversas passadas para ele). Unidade: números da unidade. */
  /** Também usado pelo dashboard do WhatsApp. */
  async where(user: AuthUser): Promise<Prisma.WhatsappConversationWhereInput> {
    const s = this.scopeOf(user)
    const base = { tenantId: user.tenantId }
    if (s === 'ALL') return base
    if (s === 'UNIT') {
      if (!user.unitId) return { id: { in: [] } }
      const nums = await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, unitId: user.unitId }, select: { id: true } })
      return { ...base, numberId: { in: nums.map((x) => x.id) } }
    }
    const { numbers, sellerId } = await this.ownNumbers(user)
    const normal = numbers.filter((n) => !n.splitAttendance).map((n) => n.id)
    const split = numbers.filter((n) => n.splitAttendance)
    const sectors = split.length ? await this.sectors(user.tenantId) : []
    return {
      ...base,
      OR: [
        ...(normal.length ? [{ numberId: { in: normal } }] : []),
        // Atendimento dividido: as minhas, a fila do meu setor e os contatos da empresa.
        ...splitWhere(user.id, split, sectors),
        // Passadas para mim (mesmo de outro número) ou para o vendedor ligado ao meu login.
        { assignedUserId: user.id },
        ...(sellerId ? [{ assignedSellerId: sellerId }] : []),
      ],
    }
  }

  /** Números do usuário: ligados ao login dele ou ao vendedor dele (cadastro do número em Números de WhatsApp). */
  private async ownNumbers(user: AuthUser) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } })
    // Atendente de um setor atende nos números do setor (setor sem número escolhido: todos com atendimento dividido).
    const mySectors = await this.prisma.whatsappSector.findMany({ where: { tenantId: user.tenantId, active: true, userIds: { has: user.id } }, select: { numberIds: true } })
    const sectorNumbers = [...new Set(mySectors.flatMap((x) => x.numberIds))]
    const anyNumber = mySectors.some((x) => !x.numberIds.length)
    const nums = await this.prisma.whatsappNumber.findMany({
      where: {
        tenantId: user.tenantId,
        deletedAt: null,
        OR: [{ userIds: { has: user.id } }, ...(seller ? [{ sellerIds: { has: seller.id } }] : []), ...(sectorNumbers.length ? [{ id: { in: sectorNumbers }, splitAttendance: true }] : []), ...(anyNumber ? [{ splitAttendance: true }] : [])],
      },
      select: { id: true, splitAttendance: true },
    })
    return { numberIds: nums.map((n) => n.id), numbers: nums, sellerId: seller?.id ?? null }
  }

  /**
   * Conversas aguardando o vendedor: a pré-venda do contato foi repassada ao vendedor e ele ainda não retornou
   * (retorno "Pendente", venda em negociação). Saem da aba quando o vendedor retorna ou a venda fecha.
   */
  private async waitingSellerIds(tenantId: string): Promise<string[]> {
    const recs = await this.prisma.serviceRecord.findMany({
      where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, forwarded: true, returnStatus: 'PENDENTE', saleStatus: 'NEGOCIACAO' },
      select: { id: true, leadId: true, phone: true },
      take: 10_000,
    })
    const leadIds = [...new Set(recs.map((r) => r.leadId).filter((x): x is string => !!x))]
    // Pré-venda aberta à mão (ex.: origem Ligação) não fica ligada à conversa: acha também pelo telefone.
    const phones = [...new Set(recs.flatMap((r) => phoneVariants(r.phone)))]
    // Pelos ids das conversas: "NOT (recordId IN … OR leadId IN …)" com campo vazio daria NULL no banco e
    // esconderia as conversas sem pré-venda ligada.
    const convs = recs.length
      ? await this.prisma.whatsappConversation.findMany({ where: { tenantId, category: 'CLIENTE', OR: [{ recordId: { in: recs.map((r) => r.id) } }, ...(leadIds.length ? [{ leadId: { in: leadIds } }] : []), ...(phones.length ? [{ phone: { in: phones } }] : [])] }, select: { id: true }, take: 10_000 })
      : []
    return convs.map((c) => c.id)
  }

  async conversations(user: AuthUser, q: { numberId?: string; unread?: boolean; archived?: boolean; search?: string; page?: number; category?: string; leadId?: string; reminders?: boolean; monitor?: boolean; sellerId?: string; awaiting?: boolean; queue?: boolean; labelId?: string; waitingSeller?: boolean }) {
    if (!q.monitor) this.assertCan(user)
    // Monitorar: tudo (permissão de monitoramento) ou só a equipe do gestor.
    const scope: Prisma.WhatsappConversationWhereInput = q.monitor ? await this.assertMonitor(user) : await this.where(user)
    // Na ficha do lead aparecem todas as conversas dele (abertas e arquivadas).
    const and: Prisma.WhatsappConversationWhereInput[] = q.leadId ? [scope, { leadId: q.leadId }] : [scope, { lastMessageAt: { not: null } }, { status: q.archived ? 'ARQUIVADA' : 'ABERTA' }]
    if (q.numberId) and.push({ numberId: q.numberId })
    if (q.unread) and.push({ unread: { gt: 0 } })
    if (q.category) and.push({ category: q.category })
    else if (!q.leadId) and.push({ category: { not: 'GRUPO' } })
    // Aba "Aguardando vendedor": separada das conversas (fora do monitoramento e da ficha do lead).
    const separate = !q.monitor && !q.leadId
    const waitingIds = separate ? await this.waitingSellerIds(user.tenantId) : null
    if (waitingIds && q.waitingSeller) and.push({ id: { in: waitingIds } })
    else if (waitingIds?.length && !q.category) and.push({ id: { notIn: waitingIds } })
    if (q.reminders) and.push({ reminders: { some: { userId: user.id, doneAt: null } } })
    if (q.labelId) and.push({ labels: { some: { labelId: q.labelId, label: this.ownedWhere(user) } } })
    if (q.monitor && q.sellerId) and.push(await this.sellerWhere(user.tenantId, q.sellerId))
    // Aguardando resposta: o contato escreveu e ninguém marcou "Não precisa responder" (resposta da empresa não tira).
    if (q.awaiting) and.push({ lastInboundAt: { not: null }, noReplyNeeded: false })
    // Fila do atendimento dividido: clientes ainda sem atendente.
    if (q.queue) {
      const split = await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, splitAttendance: true }, select: { id: true } })
      and.push({ assignedUserId: null, category: 'CLIENTE', numberId: { in: split.map((n) => n.id) } })
    }
    const s = q.search?.trim()
    if (s) {
      const digits = s.replace(/\D/g, '')
      and.push({ OR: [{ name: { contains: s, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []), { lastPreview: { contains: s, mode: 'insensitive' } }] })
    }
    const page = Math.max(1, q.page ?? 1)
    const where = { AND: and }
    const groupsTab = q.category === 'GRUPO'
    const [total, rows, unread, numbers, unreadGroups] = await Promise.all([
      this.prisma.whatsappConversation.count({ where }),
      this.prisma.whatsappConversation.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip: (page - 1) * 50, take: 50 }),
      this.prisma.whatsappConversation.aggregate({ where: { AND: [scope, { unread: { gt: 0 } }, groupsTab ? { category: 'GRUPO' } : { category: { not: 'GRUPO' } }] }, _count: { _all: true } }),
      q.monitor ? this.allNumbers(user.tenantId) : this.visibleNumbers(user, scope),
      this.prisma.whatsappConversation.count({ where: { AND: [scope, { unread: { gt: 0 }, status: 'ABERTA', category: 'GRUPO' }] } }),
    ])
    const waitingSellerCount = waitingIds?.length ? await this.prisma.whatsappConversation.count({ where: { AND: [scope, { id: { in: waitingIds } }, { status: 'ABERTA', lastMessageAt: { not: null } }] } }) : 0
    const leads = new Map((await this.prisma.lead.findMany({ where: { id: { in: rows.map((r) => r.leadId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]))
    const reminders = new Map(
      (await this.prisma.whatsappReminder.groupBy({ by: ['conversationId'], where: { userId: user.id, doneAt: null, conversationId: { in: rows.map((r) => r.id) } }, _min: { dueAt: true } })).map((r) => [r.conversationId, r._min.dueAt]),
    )
    const labels = await this.labelsOf(user, rows.map((r) => r.id))
    // Fase do atendimento de cada contato: o atendimento mais recente do lead (pré ou pós-venda).
    const stageRows = await this.prisma.serviceRecord.findMany({
      where: { tenantId: user.tenantId, deletedAt: null, leadId: { in: [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))] } },
      orderBy: { leadAt: 'desc' },
      select: { leadId: true, kind: true, saleStatus: true, followStatus: true, firstActionAt: true },
    })
    const stage = new Map<string, { kind: string; saleStatus: string; followStatus: string | null; waiting: boolean }>()
    for (const s of stageRows) if (s.leadId && !stage.has(s.leadId)) stage.set(s.leadId, { kind: s.kind, saleStatus: s.saleStatus, followStatus: s.followStatus, waiting: !s.firstActionAt })
    const userNames = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assignedUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    // No monitoramento, quem atende cada conversa (vendedor da conversa ou os do número).
    const sellerName = q.monitor ? await this.sellerNames(user.tenantId) : null
    const numberSellers = q.monitor ? new Map((await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId }, select: { id: true, sellerIds: true } })).map((n) => [n.id, n.sellerIds])) : null
    const attendant = (r: { assignedSellerId: string | null; assignedUserId: string | null; numberId: string }) => {
      if (!sellerName) return undefined
      if (r.assignedUserId) return userNames.get(r.assignedUserId) ?? null
      const ids = r.assignedSellerId ? [r.assignedSellerId] : (numberSellers?.get(r.numberId) ?? [])
      return ids.map((id) => sellerName.get(id)).filter(Boolean).join(', ') || null
    }
    return {
      total,
      page,
      unreadConversations: unread._count._all,
      /** Grupos com mensagem não lida (selo da aba Grupos). */
      unreadGroups,
      /** Conversas aguardando o vendedor retornar (selo da aba). */
      waitingSeller: waitingSellerCount,
      // Prazos das cores de atraso de resposta (verde, amarelo, vermelho).
      responseColors: await this.rules(user.tenantId).then((r) => ({ yellowMinutes: r.yellowMinutes, redMinutes: r.redMinutes })),
      numbers,
      ...(q.monitor ? { sellers: [...(sellerName ?? new Map()).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) } : {}),
      items: rows.map((r) => ({
        attendant: attendant(r),
        id: r.id,
        numberId: r.numberId,
        name: (r.leadId && leads.get(r.leadId)) || r.name,
        phone: r.phone,
        leadId: r.leadId,
        recordId: r.recordId,
        unread: r.unread,
        lastMessageAt: r.lastMessageAt,
        lastPreview: r.lastPreview,
        lastFromMe: r.lastFromMe,
        noReplyNeeded: r.noReplyNeeded,
        lastInboundAt: r.lastInboundAt,
        category: r.category,
        status: r.status,
        reminderAt: reminders.get(r.id) ?? null,
        noteUnread: r.noteUnread,
        assignedUserId: r.assignedUserId,
        assignedUserName: r.assignedUserId ? (userNames.get(r.assignedUserId) ?? null) : null,
        sectorId: r.sectorId,
        labels: labels.get(r.id) ?? [],
        stage: r.leadId ? (stage.get(r.leadId) ?? null) : null,
      })),
    }
  }

  private allNumbers(tenantId: string) {
    return this.prisma.whatsappNumber.findMany({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, phone: true, status: true, splitAttendance: true } })
  }

  private async sellerNames(tenantId: string) {
    return new Map((await this.prisma.seller.findMany({ where: { tenantId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]))
  }

  private async visibleNumbers(user: AuthUser, scope: Prisma.WhatsappConversationWhereInput) {
    const all = await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, phone: true, status: true, splitAttendance: true } })
    // attends: números em que a pessoa atende (o app no celular abre só neles).
    const mine = (await this.ownNumbers(user)).numberIds
    const marked = all.map((n) => ({ ...n, attends: mine.includes(n.id) }))
    if (this.scopeOf(user) === 'ALL') return marked
    const ids = new Set((await this.prisma.whatsappConversation.findMany({ where: scope, select: { numberId: true }, distinct: ['numberId'] })).map((c) => c.numberId))
    return marked.filter((n) => ids.has(n.id) || n.attends)
  }

  private async load(user: AuthUser, id: string) {
    this.assertCan(user)
    const conv = await this.prisma.whatsappConversation.findFirst({ where: { AND: [{ id }, await this.where(user)] } })
    if (!conv) throw new NotFoundException('Conversa não encontrada.')
    return conv
  }

  /** Monitoramento: qualquer conversa da empresa, só para ler (registra na auditoria quem leu). */
  private async loadMonitor(user: AuthUser, id: string, ctx?: RequestCtx) {
    const scope = await this.assertMonitor(user)
    const conv = await this.prisma.whatsappConversation.findFirst({ where: { AND: [scope, { id }] } })
    if (!conv) throw new NotFoundException('Conversa não encontrada.')
    const key = `${user.id}:${id}`
    const last = this.monitored.get(key) ?? 0
    if (ctx && Date.now() - last > 30 * 60_000) {
      this.monitored.set(key, Date.now())
      if (this.monitored.size > 5000) this.monitored.clear()
      await this.audit.byUser(user, ctx, 'chat.monitorada', 'whatsapp_conversation', id, { contato: conv.name ?? conv.phone ?? null })
    }
    return conv
  }

  /** Conversa com as mensagens (as mais recentes; "antes" pagina para trás). Abrir marca como lida (no monitoramento, não). */
  async conversation(user: AuthUser, id: string, before?: string, monitor?: { ctx: RequestCtx }) {
    const conv = monitor ? await this.loadMonitor(user, id, monitor.ctx) : await this.load(user, id)
    const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null
    const [rows, number, lead, record] = await Promise.all([
      this.prisma.whatsappMessage.findMany({ where: { conversationId: id, ...(beforeDate ? { sentAt: { lt: beforeDate } } : {}) }, orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }], take: PAGE + 1 }),
      this.prisma.whatsappNumber.findUnique({ where: { id: conv.numberId }, select: { id: true, name: true, phone: true, status: true, splitAttendance: true, sectors: true, userIds: true } }),
      conv.leadId ? this.prisma.lead.findUnique({ where: { id: conv.leadId }, select: { id: true, name: true, email: true, phone: true, adsLastCampaign: true, adsLastCampaignId: true } }) : null,
      conv.recordId ? this.prisma.serviceRecord.findUnique({ where: { id: conv.recordId }, select: { id: true, kind: true, leadAt: true, saleStatus: true, adsVia: true, adsCampaign: true, adsCampaignId: true, entryChannel: true } }) : null,
    ])
    // Quem atende abriu: mensagens e nota interna vistas (no monitoramento, nada muda).
    if (!monitor && !beforeDate && (conv.unread > 0 || conv.noteUnread)) await this.prisma.whatsappConversation.update({ where: { id }, data: { unread: 0, noteUnread: false } })
    const more = rows.length > PAGE
    // Equipe do número (para transferir e adicionar participantes) e os nomes de quem atende e participa.
    const team = number ? await this.numberTeam(user.tenantId, number.id) : null
    const numberSectors = team?.sectors ?? []
    const attendants = number ? await this.prisma.user.findMany({ where: { id: { in: [...new Set([...(team?.ids ?? []), ...(conv.assignedUserId ? [conv.assignedUserId] : []), ...conv.helperUserIds])] }, tenantId: user.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, active: true } }) : []
    const quotedIds = [...new Set(rows.map((r) => r.quotedWaId).filter((x): x is string => !!x))]
    // Mensagem respondida que está no CRM: se era da empresa e o id dela (para ir até ela na conversa).
    const quotedRows = new Map((quotedIds.length ? await this.prisma.whatsappMessage.findMany({ where: { conversationId: conv.id, waId: { in: quotedIds } }, select: { id: true, waId: true, fromMe: true } }) : []).map((q) => [q.waId, { id: q.id, fromMe: q.fromMe }]))
    return {
      conversation: { id: conv.id, name: lead?.name || conv.name, phone: conv.phone, jid: conv.jid, status: conv.status, assignedSellerId: conv.assignedSellerId, assignedUserId: conv.assignedUserId, assignedUserName: attendants.find((a) => a.id === conv.assignedUserId)?.name ?? null, helpers: attendants.filter((a) => conv.helperUserIds.includes(a.id)).map((a) => ({ id: a.id, name: a.name })), sectorId: conv.sectorId, category: conv.category, unread: conv.unread, noReplyNeeded: conv.noReplyNeeded, lastInboundAt: conv.lastInboundAt, labels: (await this.labelsOf(user, [conv.id])).get(conv.id) ?? [] },
      /** Contato na agenda do número (ou na geral): nome e tipo salvos. */
      agenda: conv.category !== 'GRUPO' ? await this.agendaContact(user.tenantId, conv.numberId, conv.phone ?? conv.jid).then((c) => (c ? { name: c.name, category: c.category, general: c.scope === '' } : null)) : null,
      attendance: number ? { split: number.splitAttendance, sectors: numberSectors.map((x) => ({ id: x.id, name: x.name })), attendants: attendants.filter((a) => a.active && team?.ids.has(a.id)).map((a) => ({ id: a.id, name: a.name })) } : null,
      monitor: !!monitor,
      /** Finalizar atendimento: texto da mensagem de encerramento (null = desligada em Regras e horário). */
      closeText: await this.rules(user.tenantId).then((r) => (r.close.enabled ? r.close.text : null)),
      closedAt: conv.closedAt,
      closedByName: conv.closedByName,
      number: number ? { id: number.id, name: number.name, phone: number.phone, status: number.status } : null,
      lead,
      record,
      service: await this.serviceOf(user.tenantId, conv.leadId, conv.phone),
      hasMore: more,
      messages: rows
        .slice(0, PAGE)
        .reverse()
        .map((m) => (monitor ? { ...this.messageView(m, user, m.quotedWaId ? (quotedRows.get(m.quotedWaId) ?? null) : null), canEdit: false, canDelete: false } : this.messageView(m, user, m.quotedWaId ? (quotedRows.get(m.quotedWaId) ?? null) : null))),
    }
  }

  /**
   * Leads para chamar: têm telefone, converteram no período (formulário, pop-up, botão de WhatsApp, loja virtual) e
   * nunca tiveram conversa no WhatsApp (nem pelo lead nem pelo telefone). Colegas, fornecedores e outros da agenda ficam de fora.
   */
  async toCall(user: AuthUser, q: { search?: string; page?: number; days?: number; from?: string; to?: string }) {
    this.assertAction(user, 'chat', 'create')
    if (!can(user.permissions, user.role.isSystem, 'leads', 'view')) throw new ForbiddenException('Você não tem permissão para ver os leads.')
    const days = q.days && q.days > 0 ? Math.min(q.days, 365) : 30
    // Período escolhido no calendário (dias inteiros no horário de Brasília) ou os últimos N dias.
    const range = toCallRange(q.from, q.to)
    const since = range?.from ?? new Date(Date.now() - days * 86_400_000)
    const until = range?.to ?? null
    const page = Math.max(1, q.page ?? 1)
    const s = q.search?.trim() ?? ''
    const digits = s.replace(/\D/g, '')
    const searchSql = s
      ? Prisma.sql`AND (l.name ILIKE ${`%${s}%`} ${digits.length >= 4 ? Prisma.sql`OR l.phone LIKE ${`%${digits}%`}` : Prisma.empty})`
      : Prisma.empty
    const base = Prisma.sql`
      FROM leads l
      WHERE l."tenantId" = ${user.tenantId}::uuid AND l."deletedAt" IS NULL AND l."anonymizedAt" IS NULL AND l.phone IS NOT NULL
        AND l."lastConversionAt" >= ${since}
        ${until ? Prisma.sql`AND l."lastConversionAt" < ${until}` : Prisma.empty}
        AND NOT EXISTS (
          SELECT 1 FROM whatsapp_conversations c
          WHERE c."tenantId" = l."tenantId"
            AND (c."leadId" = l.id OR c.phone = l.phone OR c.phone = regexp_replace(l.phone, '^\\+55(\\d{2})9(\\d{8})$', '+55\\1\\2'))
        )
        AND NOT EXISTS (SELECT 1 FROM whatsapp_contacts k WHERE k."tenantId" = l."tenantId" AND k."contactKey" = l.phone AND k.category <> 'CLIENTE')
        ${searchSql}`
    const [countRow, idRows] = await Promise.all([
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n ${base}`,
      this.prisma.$queryRaw<{ id: string }[]>`SELECT l.id ${base} ORDER BY l."lastConversionAt" DESC LIMIT 50 OFFSET ${(page - 1) * 50}`,
    ])
    const ids = idRows.map((r) => r.id)
    const [leads, subs] = await Promise.all([
      this.prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true, email: true, city: true, state: true, ownerId: true, originId: true, ecommerceId: true, lastConversion: true, lastConversionAt: true } }),
      this.prisma.captureSubmission.findMany({ where: { leadId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { leadId: true, channel: true, createdAt: true, form: { select: { name: true } } } }),
    ])
    const [sellers, origins] = await Promise.all([
      this.prisma.seller.findMany({ where: { id: { in: [...new Set(leads.map((l) => l.ownerId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
      this.prisma.lookupItem.findMany({ where: { id: { in: [...new Set(leads.map((l) => l.originId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
    ])
    const sellerName = new Map(sellers.map((x) => [x.id, x.name]))
    const originName = new Map(origins.map((x) => [x.id, x.name]))
    const lastSub = new Map<string, (typeof subs)[number]>()
    for (const sub of subs) if (sub.leadId && !lastSub.has(sub.leadId)) lastSub.set(sub.leadId, sub)
    const byId = new Map(leads.map((l) => [l.id, l]))
    return {
      total: Number(countRow[0]?.n ?? 0),
      page,
      days,
      latest: await this.latestLeads(user.tenantId),
      items: ids.map((id) => {
        const l = byId.get(id)!
        const sub = lastSub.get(id)
        const conv = (l.lastConversion as { conversao?: string; source?: string } | null) ?? null
        return {
          id: l.id,
          name: l.name,
          phone: l.phone,
          email: l.email,
          place: [l.city, l.state].filter(Boolean).join('/') || null,
          seller: l.ownerId ? (sellerName.get(l.ownerId) ?? null) : null,
          at: l.lastConversionAt,
          via: toCallVia(sub ? { channel: sub.channel, formName: sub.form?.name ?? null } : null, conv, !!l.ecommerceId, l.originId ? (originName.get(l.originId) ?? null) : null),
        }
      }),
    }
  }

  /**
   * Atendimento do contato para o chat: a pré-venda e o pós-venda mais recentes (com a fase) e o último vendedor
   * que atendeu (do histórico de atendimentos ou do vendedor da conversa).
   */
  private async serviceOf(tenantId: string, leadId: string | null, phone: string | null) {
    const or: Prisma.ServiceRecordWhereInput[] = [...(leadId ? [{ leadId }] : []), ...(phone ? [{ phone: { in: phoneVariants(phone) } }] : [])]
    if (!or.length) return { pre: null, pos: null, lastSeller: null }
    const rows = await this.prisma.serviceRecord.findMany({
      where: { tenantId, deletedAt: null, OR: or },
      orderBy: { leadAt: 'desc' },
      take: 30,
      select: { id: true, kind: true, leadAt: true, saleStatus: true, forwarded: true, returnStatus: true, firstActionAt: true, followStatus: true, dueAt: true, sellerId: true },
    })
    const sellerIds = [...new Set(rows.map((r) => r.sellerId).filter((x): x is string => !!x))]
    const names = new Map((await this.prisma.seller.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]))
    const pick = (kind: string) => {
      const r = rows.find((x) => x.kind === kind)
      return r ? { id: r.id, leadAt: r.leadAt, saleStatus: r.saleStatus, forwarded: r.forwarded, returnStatus: r.returnStatus, waiting: !r.firstActionAt, followStatus: r.followStatus, dueAt: r.dueAt, sellerName: r.sellerId ? (names.get(r.sellerId) ?? null) : null } : null
    }
    const withSeller = rows.find((r) => r.sellerId && names.has(r.sellerId))
    return {
      pre: pick('PRE_VENDAS'),
      pos: pick('POS_VENDAS'),
      lastSeller: withSeller ? { name: names.get(withSeller.sellerId!)!, at: withSeller.leadAt, kind: withSeller.kind } : null,
    }
  }

  /**
   * Nota interna na conversa (permissão "Monitorar conversas", ação Criar): orientação, liberação de desconto, advertência.
   * Fica só no CRM: não vai para o WhatsApp, não muda a prévia nem o "aguardando resposta", e avisa quem atende.
   */
  async addNote(user: AuthUser, id: string, text: string, ctx: RequestCtx) {
    if (!can(user.permissions, user.role.isSystem, 'monitoramento', 'create')) throw new ForbiddenException('Você não tem permissão para escrever nota interna.')
    const conv = await this.prisma.whatsappConversation.findFirst({ where: { id, tenantId: user.tenantId }, select: { id: true, name: true, phone: true } })
    if (!conv) throw new NotFoundException('Conversa não encontrada.')
    const body = text.trim().slice(0, 4000)
    if (!body) throw new BadRequestException('Escreva a nota.')
    const now = new Date()
    const msg = await this.prisma.whatsappMessage.create({
      data: { tenantId: user.tenantId, conversationId: id, waId: `nota:${randomUUID()}`, fromMe: true, type: 'nota', text: body, internal: true, sentById: user.id, sentByName: user.name.slice(0, 120), status: 'NOTA', sentAt: now },
    })
    await this.prisma.whatsappConversation.update({ where: { id }, data: { noteUnread: true } })
    await this.audit.byUser(user, ctx, 'chat.nota_interna', 'whatsapp_conversation', id, { contato: conv.name ?? conv.phone ?? null })
    return { id: msg.id, fromMe: true, type: msg.type, text: msg.text, fileName: null, mime: null, mediaStatus: null, hasFile: false, sentAt: msg.sentAt, sentByName: msg.sentByName, status: msg.status, internal: true }
  }

  /** Mídia de uma mensagem, só para quem pode ver a conversa. */
  async media(user: AuthUser, messageId: string, monitor = false) {
    if (monitor) await this.assertMonitor(user)
    const m = await this.prisma.whatsappMessage.findFirst({ where: { id: messageId, tenantId: user.tenantId } })
    if (!m?.fileId) throw new NotFoundException()
    if (monitor) await this.loadMonitor(user, m.conversationId)
    else await this.load(user, m.conversationId)
    const { asset, content } = await this.files.read(m.fileId)
    return { mime: asset.mime, content, fileName: m.fileName, sentAt: m.sentAt }
  }

  /**
   * Transcreve um áudio da conversa (de quem pode ver a conversa). Fica guardado na mensagem: a segunda pessoa que
   * pedir vê na hora, sem mandar o áudio de novo ao Google.
   */
  async transcribe(user: AuthUser, messageId: string, monitor = false) {
    if (monitor) await this.assertMonitor(user)
    const m = await this.prisma.whatsappMessage.findFirst({ where: { id: messageId, tenantId: user.tenantId } })
    if (!m) throw new NotFoundException('Mensagem não encontrada.')
    if (monitor) await this.loadMonitor(user, m.conversationId)
    else await this.load(user, m.conversationId)
    if (m.transcript) return { transcript: m.transcript }
    if (m.type !== 'audio' || m.deletedAt) throw new BadRequestException('Só áudios podem ser transcritos.')
    if (!m.fileId) throw new BadRequestException('O áudio ainda não foi baixado (ou passou do prazo de guarda): ouça no celular.')
    if (!this.ai) throw new BadRequestException('Transcrição indisponível.')
    const { content } = await this.files.read(m.fileId)
    // O Gemini aceita áudio de até ~20 MB por pedido; mensagem de voz fica muito abaixo disso.
    if (content.length > 15 * 1024 * 1024) throw new BadRequestException('Áudio grande demais para transcrever.')
    const transcript = await this.ai.transcribe(user.tenantId, content, (m.mime ?? 'audio/ogg').split(';')[0]!.trim())
    await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { transcript } })
    return { transcript }
  }

  // ---------- Envio pelo CRM ----------

  private assertAction(user: AuthUser, module: 'chat' | 'whatsapp', action: 'create' | 'edit') {
    if (!can(user.permissions, user.role.isSystem, module, action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  private async sendContext(user: AuthUser, id: string) {
    this.assertAction(user, 'chat', 'create')
    const conv = await this.load(user, id)
    const number = await this.prisma.whatsappNumber.findUnique({ where: { id: conv.numberId } })
    if (!number || number.deletedAt) throw new NotFoundException('Número não encontrado.')
    if (number.status !== 'CONECTADO') throw new BadRequestException(`O número ${number.name} está desconectado. Peça para conectar de novo em Números de WhatsApp.`)
    const client = this.clientOf()
    if (!client) throw new BadRequestException('O WhatsApp não está ativo no servidor.')
    const wait = this.rate.check(number.id)
    if (wait) throw new BadRequestException(`Muitas mensagens em pouco tempo por este número (proteção contra bloqueio do WhatsApp). Tente de novo em ${wait} s.`)
    // Telefone (só dígitos) ou, quando o WhatsApp esconde o número, o identificador @lid.
    const target = conv.jid.endsWith('@s.whatsapp.net') ? conv.jid.split('@')[0]! : conv.jid
    return { conv, number, client, target }
  }

  private async recordSent(
    user: AuthUser,
    c: { conv: { id: string; jid: string; numberId: string; tenantId: string; assignedUserId?: string | null }; number: WhatsappNumber },
    r: { waId: string; remoteJid: string | null; at: Date },
    m: { type: string; text: string | null; fileId?: string; fileName?: string; mime?: string; quotedWaId?: string; quotedText?: string | null },
  ) {
    const data = { sentById: user.id, sentByName: user.name.slice(0, 120), status: 'ENVIADA', ...(m.fileId ? { fileId: m.fileId, fileName: m.fileName ?? null, mime: m.mime ?? null, mediaStatus: 'OK' } : {}), ...(m.quotedWaId ? { quotedWaId: m.quotedWaId, quotedText: m.quotedText ?? null } : {}) }
    // O evento da Evolution pode chegar antes desta resposta: aí a mensagem já existe e só ganha quem enviou.
    const msg = await this.prisma.whatsappMessage.upsert({
      where: { conversationId_waId: { conversationId: c.conv.id, waId: r.waId } },
      create: { tenantId: c.conv.tenantId, conversationId: c.conv.id, waId: r.waId, fromMe: true, type: m.type, text: m.text, sentAt: r.at, ...data },
      update: data,
    })
    await this.prisma.whatsappConversation.update({
      where: { id: c.conv.id },
      data: { lastMessageAt: r.at, lastPreview: previewOf({ type: m.type as ParsedMessage['type'], text: m.text }), lastFromMe: true, unread: 0, status: 'ABERTA', ...(answersClient(m) ? { noReplyNeeded: true } : {}), ...(c.number.splitAttendance && !c.conv.assignedUserId ? { assignedUserId: user.id } : {}) },
    })
    // Uma pessoa respondeu: o robô de atendimento sai da conversa.
    await this.prisma.whatsappConversation.updateMany({ where: { id: c.conv.id, botFlowId: { not: null } }, data: { botFlowId: null, botState: Prisma.DbNull } })
    // Responder pelo CRM atende a pré-venda ligada à conversa (tira o aviso de pré-venda aguardando).
    const recordId = (await this.prisma.whatsappConversation.findUnique({ where: { id: c.conv.id }, select: { recordId: true } }))?.recordId
    if (recordId) {
      await this.prisma.serviceRecord.updateMany({ where: { id: recordId, kind: 'PRE_VENDAS', firstActionAt: null }, data: { firstActionAt: r.at } })
      // Em negociação: falar com o cliente pelo CRM conta como "chamei o cliente" (o prazo recomeça).
      const s = await this.settings.get(c.conv.tenantId, 'atendimento', DEFAULT_ATENDIMENTO)
      await this.prisma.serviceRecord.updateMany({
        where: { id: recordId, kind: 'PRE_VENDAS', forwarded: true, saleStatus: 'NEGOCIACAO', deletedAt: null },
        data: { calledAt: r.at, callDueAt: new Date(r.at.getTime() + callHoursOf(s) * 3_600_000) },
      })
    }
    // O WhatsApp registrou o contato com outro identificador (ex.: celular sem o 9): a conversa passa a usar o dele.
    if (r.remoteJid?.endsWith('@s.whatsapp.net') && r.remoteJid !== c.conv.jid) {
      const taken = await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: c.conv.numberId, jid: r.remoteJid } } })
      if (!taken) await this.prisma.whatsappConversation.update({ where: { id: c.conv.id }, data: { jid: r.remoteJid } })
    }
    return this.messageView(msg, user)
  }

  /**
   * Mensagem enviada pelo próprio CRM, sem usuário (ex.: a do dia seguinte da pré-venda): usa a conversa do cliente
   * neste número ou abre uma, e fica registrada nela como mensagem automática. Não conta como atendimento.
   * Devolve null quando o número está no limite de envio (tentar no próximo minuto). Com arquivo (doc), vai um
   * documento com o texto na legenda.
   */
  async sendAutomatic(n: WhatsappNumber, phone: string, text: string, label: string, link: { leadId: string | null; recordId: string | null; name: string | null; colleague?: boolean }, doc?: { content: Buffer; fileName: string; mime: string }) {
    const client = this.clientOf()
    if (!client) throw new Error('O WhatsApp não está ativo no servidor.')
    if (n.status !== 'CONECTADO') throw new Error(`O número ${n.name} está desconectado.`)
    if (this.rate.check(n.id)) return null
    const jid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`
    // Colega (ex.: o vendedor recebendo o resumo do dia): entra na agenda geral, e a resposta dele não vira lead nem pré-venda.
    if (link.colleague && !(await this.prisma.whatsappContact.count({ where: { tenantId: n.tenantId, contactKey: { in: this.keysOf(phone) } } }))) {
      await this.prisma.whatsappContact.create({ data: { tenantId: n.tenantId, scope: '', contactKey: phone, name: link.name, category: 'COLEGA' } })
    }
    const conv =
      (await this.prisma.whatsappConversation.findFirst({ where: { numberId: n.id, ...(link.recordId ? { recordId: link.recordId } : { id: { in: [] } }) } })) ??
      (await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid } } })) ??
      (await this.prisma.whatsappConversation.findFirst({ where: { numberId: n.id, phone: { in: phoneVariants(phone) } } })) ??
      (await this.prisma.whatsappConversation.create({ data: { tenantId: n.tenantId, numberId: n.id, jid, phone, name: link.name, leadId: link.leadId, recordId: link.recordId, ...(link.colleague ? { category: 'COLEGA' } : {}) } }))
    const target = conv.jid.endsWith('@s.whatsapp.net') ? conv.jid.split('@')[0]! : conv.jid
    const r = doc
      ? await client.sendMedia(n.instanceName, target, { mediatype: 'document', mimetype: doc.mime, base64: doc.content.toString('base64'), fileName: doc.fileName, caption: text })
      : await client.sendText(n.instanceName, target, text)
    const type = doc ? 'documento' : 'texto'
    const file = doc ? await this.files.saveBuffer(n.tenantId, 'whatsapp', doc.content, doc.mime, extOf(doc.mime)) : null
    const data = { sentByName: label, status: 'ENVIADA', ...(file && doc ? { fileId: file.id, fileName: doc.fileName, mime: doc.mime, mediaStatus: 'OK' } : {}) }
    await this.prisma.whatsappMessage.upsert({
      where: { conversationId_waId: { conversationId: conv.id, waId: r.waId } },
      create: { tenantId: n.tenantId, conversationId: conv.id, waId: r.waId, fromMe: true, type, text, sentAt: r.at, ...data },
      update: data,
    })
    await this.prisma.whatsappConversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: r.at, lastPreview: previewOf({ type, text }), lastFromMe: true, ...(link.recordId && !conv.recordId ? { recordId: link.recordId } : {}), ...(link.leadId && !conv.leadId ? { leadId: link.leadId } : {}) },
    })
    return { conversationId: conv.id }
  }

  private fail(err: unknown, prefix = 'Não foi enviada'): never {
    if (err instanceof EvolutionError) throw new BadRequestException(`${prefix}: ${err.message}`)
    throw err
  }

  /** Nome escolhido pelo usuário para as mensagens (Meu perfil). */
  private async signatureOf(user: AuthUser) {
    return (await this.prisma.user.findUnique({ where: { id: user.id }, select: { chatSignature: true } }))?.chatSignature ?? null
  }

  async sendText(user: AuthUser, id: string, raw: string, quotedId?: string) {
    const text = raw.replace(/\r\n/g, '\n').trim()
    if (!text) throw new BadRequestException('Escreva a mensagem.')
    if (text.length > 4000) throw new BadRequestException('Mensagem muito longa (máximo 4.000 caracteres).')
    const c = await this.sendContext(user, id)
    // Responder uma mensagem desta conversa (citação no WhatsApp).
    const q = quotedId ? await this.prisma.whatsappMessage.findFirst({ where: { id: quotedId, conversationId: id, internal: false } }) : null
    if (quotedId && !q) throw new BadRequestException('A mensagem que você está respondendo não está nesta conversa.')
    const quotedText = q ? (q.text?.trim() || previewOf({ type: q.type as ParsedMessage['type'], text: q.text })).slice(0, 300) : null
    const body = c.number.signMessages ? signed(text, user.name, await this.signatureOf(user)) : text
    const r = await c.client.sendText(c.number.instanceName, c.target, body, q ? { waId: q.waId, fromMe: q.fromMe, remoteJid: c.conv.jid, text: quotedText! } : undefined).catch((e: unknown) => this.fail(e))
    return this.recordSent(user, c, r, { type: 'texto', text: body, ...(q ? { quotedWaId: q.waId, quotedText } : {}) })
  }

  /**
   * Mensagem enviada pela empresa que a pessoa pode corrigir ou apagar: a dela com "Criar" no chat; a de outra pessoa
   * (ou enviada pelo celular) só com "Editar". E dentro do prazo do WhatsApp.
   */
  private async changeable(user: AuthUser, messageId: string, action: 'edit' | 'delete') {
    const m = await this.prisma.whatsappMessage.findFirst({ where: { id: messageId, tenantId: user.tenantId } })
    if (!m) throw new NotFoundException('Mensagem não encontrada.')
    if (!m.fromMe || m.internal) throw new BadRequestException('Só dá para corrigir ou apagar mensagens enviadas pela empresa.')
    if (m.sentById !== user.id) this.assertAction(user, 'chat', 'edit')
    const allowed = sentActions(m)
    if (action === 'edit' && m.type !== 'texto') throw new BadRequestException('Só mensagens de texto podem ser corrigidas.')
    if (action === 'edit' && !allowed.edit) throw new BadRequestException('O WhatsApp só deixa corrigir a mensagem até 15 minutos depois do envio.')
    if (action === 'delete' && !allowed.delete) throw new BadRequestException('O WhatsApp só deixa apagar para todos até 2 dias depois do envio.')
    const c = await this.sendContext(user, m.conversationId)
    return { m, c }
  }

  /** Corrige o texto de uma mensagem enviada (aparece como "Editada" no WhatsApp do cliente e no CRM). */
  async editMessage(user: AuthUser, messageId: string, raw: string, ctx: RequestCtx) {
    const text = raw.replace(/\r\n/g, '\n').trim()
    if (!text) throw new BadRequestException('Escreva a mensagem.')
    if (text.length > 4000) throw new BadRequestException('Mensagem muito longa (máximo 4.000 caracteres).')
    const { m, c } = await this.changeable(user, messageId, 'edit')
    // A assinatura ("*Nome:*") que o número coloca nas mensagens continua na mensagem corrigida.
    const sign = /^\*[^*\n]{1,40}:\*\n/.exec(m.text ?? '')?.[0] ?? ''
    const body = sign && !text.startsWith(sign) ? `${sign}${text}` : text
    if (body === m.text) return this.messageView(m, user)
    await c.client.editText(c.number.instanceName, { id: m.waId, remoteJid: c.conv.jid }, body).catch((e: unknown) => this.fail(e, 'Não foi corrigida'))
    const saved = await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { text: body, editedAt: new Date() } })
    await this.prisma.whatsappConversation.updateMany({ where: { id: m.conversationId, lastMessageAt: m.sentAt }, data: { lastPreview: previewOf({ type: 'texto', text: body }) } })
    await this.audit.byUser(user, ctx, 'chat.message_edited', 'whatsapp_message', m.id, { conversa: m.conversationId, antes: m.text, depois: body })
    return this.messageView(saved, user)
  }

  /** Apaga para todos uma mensagem enviada: some do WhatsApp do cliente e, no CRM, fica "Mensagem apagada". */
  async deleteMessage(user: AuthUser, messageId: string, ctx: RequestCtx) {
    const { m, c } = await this.changeable(user, messageId, 'delete')
    await c.client.deleteForEveryone(c.number.instanceName, { id: m.waId, remoteJid: c.conv.jid }).catch((e: unknown) => this.fail(e, 'Não foi apagada'))
    const saved = await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { deletedAt: new Date(), text: null } })
    await this.prisma.whatsappConversation.updateMany({ where: { id: m.conversationId, lastMessageAt: m.sentAt }, data: { lastPreview: 'Mensagem apagada' } })
    // O que foi apagado fica só na auditoria (para o administrador), não na conversa.
    await this.audit.byUser(user, ctx, 'chat.message_deleted', 'whatsapp_message', m.id, { conversa: m.conversationId, tipo: m.type, texto: m.text, arquivo: m.fileName })
    return this.messageView(saved, user)
  }

  /** Mensagem como a tela recebe (a apagada perde o texto e o arquivo). */
  private messageView(m: Prisma.WhatsappMessageGetPayload<object>, user: AuthUser, quoted: { id: string; fromMe: boolean } | null = null) {
    const gone = !!m.deletedAt
    const actions = sentActions(m)
    return {
      id: m.id, fromMe: m.fromMe, type: m.type, text: gone ? null : m.text, fileName: gone ? null : m.fileName, mime: gone ? null : m.mime, mediaStatus: gone ? null : m.mediaStatus, hasFile: !gone && !!m.fileId,
      sentAt: m.sentAt, sentByName: m.sentByName, status: m.status, internal: m.internal, quotedText: m.quotedText, quotedFromMe: quoted?.fromMe ?? null, quotedId: quoted?.id ?? null, reactions: Array.isArray(m.reactions) ? m.reactions : [],
      editedAt: m.editedAt, deleted: gone, transcript: gone ? null : m.transcript,
      // Só a própria mensagem com "Criar"; a dos outros com "Editar" no chat.
      canEdit: actions.edit && (m.sentById === user.id || can(user.permissions, user.role.isSystem, 'chat', 'edit')),
      canDelete: actions.delete && (m.sentById === user.id || can(user.permissions, user.role.isSystem, 'chat', 'edit')),
    }
  }

  /** Reagir a uma mensagem da conversa (emoji vazio tira a reação). */
  async react(user: AuthUser, messageId: string, emoji: string) {
    const m = await this.prisma.whatsappMessage.findFirst({ where: { id: messageId, tenantId: user.tenantId, internal: false } })
    if (!m) throw new NotFoundException('Mensagem não encontrada.')
    const c = await this.sendContext(user, m.conversationId)
    await c.client.sendReaction(c.number.instanceName, { id: m.waId, fromMe: m.fromMe, remoteJid: c.conv.jid }, emoji).catch((e: unknown) => this.fail(e))
    const reactions = withReaction(m.reactions, { emoji, by: 'me', key: 'me', name: user.name })
    await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { reactions: reactions as unknown as Prisma.InputJsonValue } })
    return { reactions }
  }

  /**
   * Encaminha mensagens (texto, foto, vídeo, áudio, documento, figurinha, localização ou contato) para outras
   * conversas ou para telefones da agenda, na ordem em que foram escritas. Telefone sem conversa: abre a conversa
   * pelo mesmo número das mensagens. O arquivo é o mesmo guardado no CRM (não baixa de novo).
   * Até 20 mensagens e 10 destinos; cada destino responde quantas foram e o que falhou.
   */
  async forward(user: AuthUser, messageIds: string[], targets: { conversationId?: string; phone?: string; label?: string }[]) {
    this.assertAction(user, 'chat', 'create')
    const ids = [...new Set(messageIds)].slice(0, 20)
    if (!ids.length) throw new BadRequestException('Escolha as mensagens para encaminhar.')
    const rows = await this.prisma.whatsappMessage.findMany({ where: { id: { in: ids }, tenantId: user.tenantId, internal: false }, orderBy: { sentAt: 'asc' } })
    if (!rows.length) throw new NotFoundException('Mensagem não encontrada.')
    // Todas precisam estar em conversas que a pessoa vê; o número de saída é o da primeira.
    const sources = new Map<string, Awaited<ReturnType<ChatService['load']>>>()
    for (const cid of new Set(rows.map((r) => r.conversationId))) sources.set(cid, await this.load(user, cid))
    const src = sources.get(rows[0]!.conversationId)!
    const MEDIA = ['imagem', 'video', 'audio', 'documento', 'figurinha']
    const problem = (m: (typeof rows)[number]) => {
      const media = MEDIA.includes(m.type)
      if (!media && !['texto', 'localizacao', 'contato'].includes(m.type)) return 'tipo de mensagem que o CRM não encaminha'
      if (media && !m.fileId) return m.mediaStatus === 'GRANDE' ? 'arquivo grande demais (mais de 16 MB)' : 'arquivo não está no CRM'
      if (!media && !m.text?.trim()) return 'mensagem vazia'
      return null
    }
    const skipped = rows.filter((m) => problem(m)).map((m) => problem(m)!)
    const list = rows.filter((m) => !problem(m))
    if (!list.length) throw new BadRequestException(`Nada para encaminhar: ${[...new Set(skipped)].join('; ')}. Encaminhe pelo celular.`)
    const files = new Map<string, Awaited<ReturnType<FilesService['read']>>>()
    for (const m of list) if (m.fileId && !files.has(m.fileId)) files.set(m.fileId, await this.files.read(m.fileId))

    const results: { label: string; conversationId: string | null; ok: boolean; sent: number; error?: string }[] = []
    for (const t of targets.slice(0, 10)) {
      const label = (t.label ?? t.phone ?? 'Conversa').slice(0, 120)
      let sent = 0
      try {
        const convId = t.conversationId ?? (await this.start(user, { numberId: src.numberId, phone: t.phone })).id
        if (sources.has(convId)) throw new BadRequestException('É a própria conversa das mensagens.')
        const c = await this.sendContext(user, convId)
        for (const m of list) {
          if (m.type === 'contato') {
            for (const line of m.text!.split('\n').slice(0, 10)) {
              const [name = '', tel = ''] = line.split(' · ')
              const card = contactCard(name, tel)
              if ('error' in card) throw new BadRequestException('Um contato das mensagens não tem telefone para encaminhar.')
              const r = await c.client.sendContact(c.number.instanceName, c.target, card).catch((e: unknown) => this.fail(e))
              await this.recordSent(user, c, r, { type: 'contato', text: card.text })
            }
          } else if (!MEDIA.includes(m.type)) {
            const r = await c.client.sendText(c.number.instanceName, c.target, m.text!).catch((e: unknown) => this.fail(e))
            await this.recordSent(user, c, r, { type: 'texto', text: m.text })
          } else {
            const file = files.get(m.fileId!)!
            const base64 = file.content.toString('base64')
            const mime = m.mime ?? file.asset.mime
            const fileName = m.fileName ?? `arquivo.${extOf(mime)}`
            const r =
              m.type === 'audio'
                ? await c.client.sendAudio(c.number.instanceName, c.target, base64).catch((e: unknown) => this.fail(e))
                : await c.client
                    .sendMedia(c.number.instanceName, c.target, { mediatype: m.type === 'video' ? 'video' : m.type === 'documento' ? 'document' : 'image', mimetype: mime, base64, fileName, caption: m.text ?? undefined })
                    .catch((e: unknown) => this.fail(e))
            await this.recordSent(user, c, r, { type: m.type, text: m.type === 'audio' ? null : m.text, fileId: m.fileId!, fileName, mime })
          }
          sent++
        }
        results.push({ label, conversationId: convId, ok: true, sent })
      } catch (err) {
        results.push({ label, conversationId: t.conversationId ?? null, ok: false, sent, error: (err as Error).message })
      }
    }
    return { sent: results.filter((r) => r.ok).length, messages: list.length, skipped, results }
  }

  /** Compartilha um contato (cartão) na conversa. */
  async sendContact(user: AuthUser, id: string, d: { name: string; phone: string }) {
    const card = contactCard(d.name, d.phone)
    if ('error' in card) throw new BadRequestException(card.error)
    const c = await this.sendContext(user, id)
    const r = await c.client.sendContact(c.number.instanceName, c.target, card).catch((e: unknown) => this.fail(e))
    return this.recordSent(user, c, r, { type: 'contato', text: card.text })
  }

  /**
   * Contatos para compartilhar: vendedores e colegas da agenda (com telefone) e, para quem vê a base, os leads.
   * Só nome e telefone, no máximo 20 por busca.
   */
  async shareOptions(user: AuthUser, search: string, numberId?: string) {
    this.assertAction(user, 'chat', 'create')
    const s = search.trim().slice(0, 80)
    const digits = s.replace(/\D/g, '')
    const text = (field: string) => (s ? { [field]: { contains: s, mode: 'insensitive' as const } } : {})
    const [sellers, agenda, leads] = await Promise.all([
      this.prisma.seller.findMany({ where: { tenantId: user.tenantId, active: true, phone: { not: null }, ...(s ? { OR: [text('name'), ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] } : {}) }, orderBy: { name: 'asc' }, take: 10, select: { id: true, name: true, phone: true } }),
      // Com o número escolhido (nova conversa): a agenda dele e a geral; sem número, todas as agendas.
      this.prisma.whatsappContact.findMany({ where: { tenantId: user.tenantId, contactKey: { startsWith: '+' }, ...(numberId ? { scope: { in: [numberId, ''] } } : {}), ...(s ? { OR: [text('name'), ...(digits.length >= 3 ? [{ contactKey: { contains: digits } }] : [])] } : {}) }, orderBy: { name: 'asc' }, take: 10, select: { id: true, name: true, contactKey: true, category: true } }),
      can(user.permissions, user.role.isSystem, 'leads', 'view') && s.length >= 2
        ? this.prisma.lead.findMany({ where: { tenantId: user.tenantId, deletedAt: null, anonymizedAt: null, phone: { not: null }, OR: [text('name'), ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, name: true, phone: true } })
        : [],
    ])
    const CAT: Record<string, string> = { CLIENTE: 'Cliente', COLEGA: 'Colega', FORNECEDOR: 'Fornecedor', OUTRO: 'Agenda' }
    const out = [
      ...sellers.map((x) => ({ key: `s-${x.id}`, name: x.name, phone: x.phone!, source: 'Vendedor' })),
      ...agenda.map((x) => ({ key: `a-${x.id}`, name: x.name ?? x.contactKey, phone: x.contactKey, source: CAT[x.category] ?? 'Agenda' })),
      ...leads.map((x) => ({ key: `l-${x.id}`, name: x.name ?? x.phone!, phone: x.phone!, source: 'Lead' })),
    ]
    const seen = new Set<string>()
    return out.filter((x) => !seen.has(x.phone) && seen.add(x.phone)).slice(0, 20)
  }

  // ---------- Figurinhas (de cada atendente) ----------

  /** Figurinhas salvas pela pessoa, as mais novas primeiro. */
  async stickers(user: AuthUser) {
    this.assertAction(user, 'chat', 'create')
    return this.prisma.whatsappSticker.findMany({ where: { tenantId: user.tenantId, userId: user.id }, orderBy: { createdAt: 'desc' }, take: STICKER_MAX, select: { id: true } })
  }

  /** Imagem de uma figurinha da própria pessoa. */
  async stickerImage(user: AuthUser, id: string) {
    const st = await this.prisma.whatsappSticker.findFirst({ where: { id, tenantId: user.tenantId, userId: user.id } })
    if (!st) throw new NotFoundException()
    const { content } = await this.files.read(st.fileId)
    return { mime: st.mime, content }
  }

  /** Guarda uma imagem (já conferida) como figurinha da pessoa; a mesma imagem não entra duas vezes. */
  private async keepSticker(user: AuthUser, buffer: Buffer) {
    const type = detectImage(buffer)
    if (!type || !['png', 'jpg', 'webp', 'gif'].includes(type.ext)) throw new BadRequestException('Formato não suportado. Use PNG, JPG, WEBP ou GIF.')
    if (buffer.length > STICKER_MAX_BYTES) throw new BadRequestException('Imagem maior que 1 MB. Diminua a imagem e tente de novo.')
    const hash = createHash('sha256').update(buffer).digest('hex')
    const found = await this.prisma.whatsappSticker.findUnique({ where: { userId_hash: { userId: user.id, hash } }, select: { id: true } })
    if (found) return { id: found.id, message: 'Esta figurinha já está salva.' }
    if ((await this.prisma.whatsappSticker.count({ where: { userId: user.id } })) >= STICKER_MAX) throw new BadRequestException(`Você já tem ${STICKER_MAX} figurinhas salvas. Apague algumas para salvar outras.`)
    const asset = await this.files.saveBuffer(user.tenantId, 'figurinha', buffer, type.mime, type.ext)
    const st = await this.prisma.whatsappSticker.create({ data: { tenantId: user.tenantId, userId: user.id, fileId: asset.id, hash, mime: type.mime } })
    return { id: st.id, message: 'Figurinha salva. Ela aparece no botão de emojis e figurinhas da conversa.' }
  }

  /** "Salvar figurinha" numa figurinha recebida ou enviada na conversa. */
  async saveSticker(user: AuthUser, messageId: string) {
    this.assertAction(user, 'chat', 'create')
    const m = await this.prisma.whatsappMessage.findFirst({ where: { id: messageId, tenantId: user.tenantId } })
    if (!m) throw new NotFoundException('Mensagem não encontrada.')
    await this.load(user, m.conversationId)
    if (m.type !== 'figurinha' || m.deletedAt) throw new BadRequestException('Só figurinhas podem ser salvas.')
    if (!m.fileId) throw new BadRequestException('A figurinha ainda não foi baixada (ou passou do prazo de guarda).')
    const { content } = await this.files.read(m.fileId)
    return this.keepSticker(user, content)
  }

  /** Figurinha nova a partir de uma imagem do computador. */
  async addSticker(user: AuthUser, file: Express.Multer.File | undefined) {
    this.assertAction(user, 'chat', 'create')
    if (!file?.buffer?.length) throw new BadRequestException('Escolha uma imagem.')
    return this.keepSticker(user, file.buffer)
  }

  async removeSticker(user: AuthUser, id: string) {
    const st = await this.prisma.whatsappSticker.findFirst({ where: { id, tenantId: user.tenantId, userId: user.id } })
    if (!st) throw new NotFoundException('Figurinha não encontrada.')
    await this.prisma.whatsappSticker.delete({ where: { id: st.id } })
    await this.files.remove(st.fileId)
    return { ok: true }
  }

  /** Manda uma figurinha salva na conversa. A mensagem guarda uma cópia (a figurinha pode ser apagada depois). */
  async sendSticker(user: AuthUser, conversationId: string, stickerId: string) {
    const st = await this.prisma.whatsappSticker.findFirst({ where: { id: stickerId, tenantId: user.tenantId, userId: user.id } })
    if (!st) throw new NotFoundException('Figurinha não encontrada.')
    const c = await this.sendContext(user, conversationId)
    const { content } = await this.files.read(st.fileId)
    const r = await c.client.sendSticker(c.number.instanceName, c.target, content.toString('base64')).catch((e: unknown) => this.fail(e))
    const ext = st.mime.split('/')[1] === 'jpeg' ? 'jpg' : (st.mime.split('/')[1] ?? 'webp')
    const asset = await this.files.saveBuffer(c.conv.tenantId, 'whatsapp', content, st.mime, ext)
    return this.recordSent(user, c, r, { type: 'figurinha', text: null, fileId: asset.id, fileName: `figurinha.${ext}`, mime: st.mime })
  }

  async sendFile(user: AuthUser, id: string, file: Express.Multer.File | undefined, caption?: string, voice = false) {
    if (!file?.buffer?.length) throw new BadRequestException('Escolha um arquivo.')
    return this.sendBuffer(user, id, { buffer: file.buffer, size: file.size, originalname: file.originalname ?? '' }, caption, voice)
  }

  /** Envia um arquivo (do computador ou guardado, como o de uma resposta rápida) na conversa. */
  private async sendBuffer(user: AuthUser, id: string, file: { buffer: Buffer; size: number; originalname: string }, caption?: string, voice = false) {
    if (file.size > MEDIA_MAX_BYTES) throw new BadRequestException('Arquivo maior que 64 MB. Para arquivos maiores, envie um link (ex.: Google Drive).')
    const detected = detectOutgoing(file.buffer, file.originalname, voice)
    // Foto ou vídeo grande vai como documento (o cliente recebe o arquivo original, sem a compressão do WhatsApp).
    const kind = detected && (detected.kind === 'image' || detected.kind === 'video') && file.size > INLINE_MEDIA_MAX_BYTES ? { ...detected, kind: 'document' as const } : detected
    if (!kind) throw new BadRequestException(voice ? 'Não foi possível ler o áudio gravado. Tente gravar de novo.' : 'Tipo de arquivo não aceito. Envie foto (JPG, PNG, WEBP), vídeo MP4, áudio (OGG, MP3, M4A), PDF, Word, Excel, CSV ou TXT.')
    const c = await this.sendContext(user, id)
    const fileName = safeFileName(uploadName(file.originalname), kind.ext)
    const cap = caption?.trim().slice(0, 1000) || null
    const text = cap ? (c.number.signMessages ? signed(cap, user.name, await this.signatureOf(user)) : cap) : null
    const base64 = file.buffer.toString('base64')
    const r =
      kind.kind === 'audio'
        ? await c.client.sendAudio(c.number.instanceName, c.target, base64).catch((e: unknown) => {
            // Registro para o suporte: formato gravado pelo navegador e a resposta do serviço de WhatsApp.
            this.logger.warn(`Áudio não enviado (${c.number.name}, ${kind.mime}, ${Math.round(file.size / 1024)} KB, ${user.role.name}): ${(e as Error).message}`)
            return this.fail(e)
          })
        : await c.client.sendMedia(c.number.instanceName, c.target, { mediatype: kind.kind, mimetype: kind.mime, base64, fileName, caption: text ?? undefined }).catch((e: unknown) => this.fail(e))
    const asset = await this.files.saveBuffer(c.conv.tenantId, 'whatsapp', file.buffer, kind.mime, kind.ext)
    const type = ({ image: 'imagem', video: 'video', audio: 'audio', document: 'documento' } as const)[kind.kind]
    return this.recordSent(user, c, r, { type, text: kind.kind === 'audio' ? null : text, fileId: asset.id, fileName, mime: kind.mime })
  }

  /**
   * Último lead que chegou por canal (formulário/pop-up, loja virtual, qualquer um), com ou sem conversa: mostra na
   * tela "Leads para chamar" se algum canal parou de mandar leads (ex.: LP ainda mandando para outro sistema).
   */
  private async latestLeads(tenantId: string) {
    const [form, store, any] = await Promise.all([
      this.prisma.captureSubmission.findFirst({ where: { tenantId, leadId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, channel: true, form: { select: { name: true } } } }),
      this.prisma.lead.findFirst({ where: { tenantId, deletedAt: null, ecommerceId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.lead.findFirst({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, origin: { select: { name: true } } } }),
    ])
    return {
      form: form ? { at: form.createdAt, name: form.form?.name ?? form.channel } : null,
      store: store ? { at: store.createdAt } : null,
      any: any ? { at: any.createdAt, origin: any.origin?.name ?? null } : null,
    }
  }

  /** Números em que o usuário pode iniciar conversa (próprios: os ligados a ele ou ao vendedor dele; unidade: da unidade). */
  private async numbersForStart(user: AuthUser) {
    const s = this.scopeOf(user)
    const where: Prisma.WhatsappNumberWhereInput = { tenantId: user.tenantId, deletedAt: null }
    if (s === 'UNIT') where.unitId = user.unitId ?? '00000000-0000-0000-0000-000000000000'
    if (s === 'OWN') where.id = { in: (await this.ownNumbers(user)).numberIds }
    return this.prisma.whatsappNumber.findMany({ where, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, phone: true, status: true } })
  }

  startOptions(user: AuthUser) {
    this.assertAction(user, 'chat', 'create')
    return this.numbersForStart(user)
  }

  /** Abre (ou reaproveita) a conversa de um número com um telefone, ex.: a partir da ficha do lead. */
  async start(user: AuthUser, d: { numberId: string; phone?: string | null; leadId?: string | null }) {
    this.assertAction(user, 'chat', 'create')
    const number = (await this.numbersForStart(user)).find((n) => n.id === d.numberId)
    if (!number) throw new BadRequestException('Número inválido.')
    const lead = d.leadId ? await this.prisma.lead.findFirst({ where: { id: d.leadId, tenantId: user.tenantId, deletedAt: null, anonymizedAt: null }, select: { id: true, name: true, phone: true } }) : null
    if (d.leadId && !lead) throw new BadRequestException('Lead não encontrado.')
    const raw = (d.phone ?? lead?.phone ?? '').trim()
    const intl = raw.replace(/[^\d+]/g, '')
    // Com + e outro código de país é número estrangeiro: não passa pela regra do DDD brasileiro.
    const phone = (/^\+(?!55)\d{10,15}$/.test(intl) ? intl : null) ?? normalizePhone(raw) ?? (/^\+\d{10,15}$/.test(intl) ? intl : null)
    if (!phone) throw new BadRequestException('Telefone inválido. Use DDD + número.')
    const jid = `${phone.slice(1)}@s.whatsapp.net`
    const existing =
      (await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: number.id, jid } } })) ??
      (await this.prisma.whatsappConversation.findFirst({ where: { numberId: number.id, phone: { in: phoneVariants(phone) } } }))
    const full = await this.prisma.whatsappNumber.findUnique({ where: { id: number.id }, select: { splitAttendance: true, instanceName: true, status: true } })
    const split = full?.splitAttendance ?? false
    const reuse = async (c: { id: string; leadId: string | null; assignedUserId: string | null; category: string }) => {
      // Atendimento dividido: cliente de outro atendente não muda de dono; da fila, passa para quem iniciou.
      if (split && c.assignedUserId && c.assignedUserId !== user.id && c.category === 'CLIENTE' && this.scopeOf(user) === 'OWN') {
        const owner = await this.prisma.user.findUnique({ where: { id: c.assignedUserId }, select: { name: true } })
        throw new BadRequestException(`Este cliente já é atendido por ${owner?.name ?? 'outro atendente'} neste número. Peça a transferência para você.`)
      }
      const patch = { ...(lead && !c.leadId ? { leadId: lead.id } : {}), ...(split && !c.assignedUserId ? { assignedUserId: user.id } : {}) }
      if (Object.keys(patch).length) await this.prisma.whatsappConversation.update({ where: { id: c.id }, data: patch })
      return { id: c.id }
    }
    if (existing) return reuse(existing)
    // Conversa nova: confere se o telefone tem WhatsApp (e o identificador que o WhatsApp usa, ex.: celular antigo sem o 9).
    const check = full ? await this.checkWhatsapp(full, phone) : null
    if (check && !check.exists) throw new BadRequestException(`O telefone ${phoneLabel(phone)} não tem WhatsApp. Confira o DDD e o número.`)
    const realJid = check?.jid ?? jid
    if (realJid !== jid) {
      const taken = await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: number.id, jid: realJid } } })
      if (taken) return reuse(taken)
    }
    try {
      const conv = await this.prisma.whatsappConversation.create({
        data: { tenantId: user.tenantId, numberId: number.id, jid: realJid, phone, name: lead?.name ?? null, leadId: lead?.id ?? null, lastMessageAt: new Date(), lastPreview: 'Conversa iniciada pelo CRM', lastFromMe: true, ...(split ? { assignedUserId: user.id } : {}) },
      })
      return { id: conv.id }
    } catch (e) {
      // Aberta ao mesmo tempo (outro clique, outro atendente ou o cliente escreveu enquanto conferia): usa a que ficou.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
      const now = await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: number.id, jid: realJid } } })
      if (!now) throw e
      return reuse(now)
    }
  }

  /**
   * O telefone tem WhatsApp? Pergunta ao WhatsApp pelo número da empresa (o celular nas duas formas, com e sem o 9).
   * null quando não dá para conferir (número desconectado, serviço fora do ar): a conversa abre sem conferir.
   */
  private async checkWhatsapp(n: { instanceName: string; status: string }, phone: string) {
    const client = this.clientOf()
    if (!client || n.status !== 'CONECTADO') return null
    try {
      return whatsappOf(await client.checkNumbers(n.instanceName, phoneVariants(phone).map((p) => p.slice(1))))
    } catch (e) {
      this.logger.warn(`Não deu para conferir se ${phone} tem WhatsApp: ${(e as Error).message}`)
      return null
    }
  }

  /** Passar a conversa para um vendedor (ele passa a ver mesmo com "somente os próprios") e arquivar/reabrir. */
  async update(user: AuthUser, id: string, d: { assignedSellerId?: string | null; status?: 'ABERTA' | 'ARQUIVADA' }) {
    this.assertAction(user, 'chat', 'edit')
    await this.load(user, id)
    if (d.assignedSellerId && !(await this.prisma.seller.count({ where: { id: d.assignedSellerId, tenantId: user.tenantId } }))) throw new BadRequestException('Vendedor inválido.')
    const r = await this.prisma.whatsappConversation.update({
      where: { id },
      data: { ...(d.assignedSellerId !== undefined ? { assignedSellerId: d.assignedSellerId } : {}), ...(d.status ? { status: d.status } : {}) },
    })
    return { id: r.id, assignedSellerId: r.assignedSellerId, status: r.status }
  }

  /**
   * Finalizar atendimento: (opcional) manda a mensagem de encerramento, tira a conversa do atendente e da fila e
   * arquiva. Se o cliente chamar de novo, é um atendimento novo (fila ou robô de atendimento).
   */
  async finish(user: AuthUser, id: string, sendMessage: boolean, ctx: RequestCtx) {
    this.assertAction(user, 'chat', 'create')
    const conv = await this.load(user, id)
    if (conv.assignedUserId && conv.assignedUserId !== user.id && !can(user.permissions, user.role.isSystem, 'chat', 'edit')) throw new ForbiddenException('Esta conversa é de outro atendente.')
    const rules = await this.rules(user.tenantId)
    let sent = false
    if (sendMessage && rules.close.enabled && conv.category === 'CLIENTE') {
      const c = await this.sendContext(user, id)
      const r = await c.client.sendText(c.number.instanceName, c.target, rules.close.text).catch((e: unknown) => this.fail(e))
      await this.recordSent(user, c, r, { type: 'texto', text: rules.close.text })
      sent = true
    }
    const now = new Date()
    await this.prisma.whatsappConversation.update({
      where: { id },
      data: { status: 'ARQUIVADA', assignedUserId: null, sectorId: null, helperUserIds: [], botFlowId: null, botState: Prisma.DbNull, unread: 0, noReplyNeeded: true, closedAt: now, closedByName: user.name.slice(0, 120) },
    })
    await this.prisma.whatsappMessage.create({
      data: { tenantId: user.tenantId, conversationId: id, waId: `nota:${randomUUID()}`, fromMe: true, type: 'nota', text: `Atendimento finalizado por ${user.name}${sent ? ' (mensagem de encerramento enviada)' : ''}.`, internal: true, sentById: user.id, sentByName: user.name.slice(0, 120), status: 'NOTA', sentAt: now },
    })
    await this.audit.byUser(user, ctx, 'chat.finalizada', 'whatsapp_conversation', id, { contato: conv.name ?? conv.phone ?? null, mensagem: sent })
    return { id, status: 'ARQUIVADA', closedAt: now }
  }

  /** Finaliza várias conversas sem mensagem de encerramento (cada uma com as mesmas regras de uma só). */
  async finishMany(user: AuthUser, ids: string[], ctx: RequestCtx) {
    this.assertAction(user, 'chat', 'create')
    const failed: { id: string; error: string }[] = []
    let done = 0
    for (const id of [...new Set(ids)]) {
      try {
        await this.finish(user, id, false, ctx)
        done++
      } catch (e) {
        failed.push({ id, error: (e as Error).message })
      }
    }
    return { done, failed }
  }

  /**
   * "Não precisa responder": a conversa já terminou (ex.: o cliente mandou um áudio de despedida). Sai dos avisos de
   * cliente esperando até ele mandar outra mensagem.
   */
  async noReply(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertAction(user, 'chat', 'create')
    const conv = await this.load(user, id)
    if (conv.noReplyNeeded) return { id, noReplyNeeded: true }
    // Só se o cliente não escreveu de novo nesse meio tempo.
    await this.prisma.whatsappConversation.updateMany({ where: { id, lastInboundAt: conv.lastInboundAt }, data: { noReplyNeeded: true } })
    await this.audit.byUser(user, ctx, 'chat.sem_resposta', 'whatsapp_conversation', id, { contato: conv.name ?? conv.phone ?? null })
    return { id, noReplyNeeded: true }
  }

  /**
   * Quem atende num número: os usuários ligados a ele, os usuários dos vendedores dele e os atendentes dos setores
   * que escolheram este número. Transferir e adicionar participantes só entre eles: quem está no número Y não
   * recebe conversa do número X. As filas de setor que atendem no número continuam disponíveis.
   */
  private async numberTeam(tenantId: string, numberId: string) {
    const number = await this.prisma.whatsappNumber.findUnique({ where: { id: numberId }, select: { userIds: true, sellerIds: true } })
    if (!number) throw new NotFoundException('Número não encontrado.')
    const all = await this.sectors(tenantId)
    const sellers = number.sellerIds.length ? await this.prisma.seller.findMany({ where: { tenantId, id: { in: number.sellerIds } }, select: { userId: true } }) : []
    const ids = new Set([...number.userIds, ...sellers.flatMap((s) => (s.userId ? [s.userId] : [])), ...all.filter((s) => s.numberIds.includes(numberId)).flatMap((s) => s.userIds)])
    return { ids, sectors: all.filter((s) => servesNumber(s, numberId)) }
  }

  /**
   * Atendimento dividido: assumir da fila ou transferir para outro atendente ou para a fila de um setor.
   * Quem atende pode passar a própria conversa (ou uma da fila); com a ação Editar do chat, qualquer uma.
   */
  async assign(user: AuthUser, id: string, d: { userId?: string | null; sectorId?: string | null }, ctx: RequestCtx) {
    this.assertAction(user, 'chat', 'create')
    const conv = await this.load(user, id)
    const canEdit = can(user.permissions, user.role.isSystem, 'chat', 'edit')
    if (!canEdit && conv.assignedUserId && conv.assignedUserId !== user.id) throw new ForbiddenException('Esta conversa é de outro atendente.')
    const { ids, sectors } = await this.numberTeam(user.tenantId, conv.numberId)
    const userId = d.userId === undefined ? conv.assignedUserId : d.userId
    // Transferir só para quem está ligado a este número: um número não mistura com outro. Assumir vale para quem vê a conversa.
    if (userId && userId !== user.id && userId !== conv.assignedUserId && !ids.has(userId)) throw new BadRequestException('Só dá para passar a conversa para quem atende neste mesmo número de WhatsApp.')
    if (userId && !(await this.prisma.user.count({ where: { id: userId, tenantId: user.tenantId, active: true } }))) throw new BadRequestException('Atendente inválido.')
    const sectorId = d.sectorId === undefined ? conv.sectorId : d.sectorId
    if (sectorId && !sectors.some((s) => s.id === sectorId)) throw new BadRequestException('Setor inválido.')
    const r = await this.prisma.whatsappConversation.update({ where: { id }, data: { assignedUserId: userId ?? null, sectorId: sectorId ?? null, helperUserIds: conv.helperUserIds.filter((h) => h !== userId), botFlowId: null, botState: Prisma.DbNull } })
    await this.audit.byUser(user, ctx, userId === user.id && conv.assignedUserId !== user.id ? 'chat.assumida' : 'chat.transferida', 'whatsapp_conversation', id, {
      atendente: userId ?? null,
      setor: sectors.find((s) => s.id === sectorId)?.name ?? null,
    })
    return { id: r.id, assignedUserId: r.assignedUserId, sectorId: r.sectorId }
  }

  /**
   * Salva o número da conversa na agenda do número de WhatsApp dela, com nome e tipo (cliente, colega, fornecedor,
   * outro). Telefone já na agenda: atualiza (não duplica). O nome passa a aparecer na conversa.
   */
  async saveAsContact(user: AuthUser, id: string, d: { name: string; category: 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO' }) {
    this.assertAction(user, 'chat', 'create')
    const conv = await this.load(user, id)
    if (conv.category === 'GRUPO') throw new BadRequestException('Grupo não entra na agenda de contatos.')
    if (!conv.phone) throw new BadRequestException('O WhatsApp não mostra o telefone deste contato: não dá para salvar na agenda.')
    // Mudar o tipo do contato é de quem pode editar o chat; quem só atende salva como está (ou como cliente).
    const canEdit = can(user.permissions, user.role.isSystem, 'chat', 'edit')
    const current = await this.agendaContact(user.tenantId, conv.numberId, conv.phone)
    const keep = current?.category ?? (conv.category === 'NOVO' ? 'CLIENTE' : conv.category)
    const category = canEdit ? d.category : keep
    const name = d.name.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!name) throw new BadRequestException('Informe o nome do contato.')
    await this.saveAgenda(user, conv.numberId, conv.phone, { name, category })
    await this.prisma.whatsappConversation.update({ where: { id }, data: { name, category } })
    return { name, category }
  }

  /**
   * Participantes da conversa: outros atendentes do mesmo número que também veem e respondem (o cliente continua
   * de quem atende). Quem atende ou quem pode editar o chat escolhe; a lista enviada substitui a anterior.
   */
  async setHelpers(user: AuthUser, id: string, userIds: string[], ctx: RequestCtx) {
    this.assertAction(user, 'chat', 'create')
    const conv = await this.load(user, id)
    const canEdit = can(user.permissions, user.role.isSystem, 'chat', 'edit')
    if (!canEdit && conv.assignedUserId && conv.assignedUserId !== user.id) throw new ForbiddenException('Só quem atende a conversa pode adicionar participantes.')
    const { ids } = await this.numberTeam(user.tenantId, conv.numberId)
    const wanted = [...new Set(userIds)].filter((u) => u !== conv.assignedUserId)
    // Quem já era participante continua podendo ficar; novos, só do mesmo número.
    if (wanted.some((u) => !ids.has(u) && !conv.helperUserIds.includes(u))) throw new BadRequestException('Só dá para adicionar atendentes deste mesmo número de WhatsApp.')
    const active = await this.prisma.user.findMany({ where: { id: { in: wanted }, tenantId: user.tenantId, active: true }, select: { id: true, name: true } })
    const helperUserIds = active.map((u) => u.id).slice(0, 20)
    await this.prisma.whatsappConversation.update({ where: { id }, data: { helperUserIds } })
    await this.audit.byUser(user, ctx, 'chat.participantes', 'whatsapp_conversation', id, { participantes: active.map((u) => u.name) })
    return { helperUserIds }
  }

  // ---------- Respostas rápidas ----------

  /** Padrão da empresa (todos veem) ou pessoal (só o dono). Padrão: só quem administra o WhatsApp cria e altera. */
  private ownedWhere(user: AuthUser) {
    return { tenantId: user.tenantId, OR: [{ userId: null }, { userId: user.id }] }
  }

  private assertOwn(user: AuthUser, row: { userId: string | null }, what: string) {
    if (row.userId === null) this.assertAction(user, 'whatsapp', 'edit')
    else if (row.userId !== user.id) throw new ForbiddenException(`Só quem criou pode alterar esta ${what}.`)
  }

  async quickReplies(user: AuthUser, convId?: string) {
    this.assertCan(user)
    const rows = await this.prisma.whatsappQuickReply.findMany({ where: this.ownedWhere(user), orderBy: [{ userId: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }] })
    // Com a conversa, já devolve o texto com {nome} e {vendedor} trocados.
    let nome: string | null = null
    if (convId) {
      const c = await this.load(user, convId)
      nome = (c.leadId ? (await this.prisma.lead.findUnique({ where: { id: c.leadId }, select: { name: true } }))?.name : null) ?? c.name
    }
    return rows.map((r) => ({ id: r.id, title: r.title, text: r.text, fileName: r.fileId ? r.fileName : null, standard: r.userId === null, mine: r.userId === user.id, preview: applyVariables(r.text, { nome, vendedor: user.name }) }))
  }

  async saveQuickReply(user: AuthUser, id: string | null, d: { title: string; text: string; standard?: boolean }) {
    this.assertCan(user)
    const title = d.title.trim().slice(0, 60)
    const text = d.text.trim().slice(0, 2000)
    if (!title || !text) throw new BadRequestException('Preencha o título e o texto.')
    if (id) {
      const found = await this.prisma.whatsappQuickReply.findFirst({ where: { id, ...this.ownedWhere(user) } })
      if (!found) throw new NotFoundException('Resposta não encontrada.')
      this.assertOwn(user, found, 'resposta')
      return this.prisma.whatsappQuickReply.update({ where: { id }, data: { title, text } })
    }
    if (d.standard) this.assertAction(user, 'whatsapp', 'edit')
    const owner = d.standard ? null : user.id
    if ((await this.prisma.whatsappQuickReply.count({ where: { tenantId: user.tenantId, userId: owner } })) >= 100) throw new BadRequestException('Limite de 100 respostas rápidas.')
    return this.prisma.whatsappQuickReply.create({ data: { tenantId: user.tenantId, userId: owner, title, text } })
  }

  async removeQuickReply(user: AuthUser, id: string) {
    this.assertCan(user)
    const found = await this.prisma.whatsappQuickReply.findFirst({ where: { id, ...this.ownedWhere(user) } })
    if (!found) throw new NotFoundException('Resposta não encontrada.')
    this.assertOwn(user, found, 'resposta')
    await this.prisma.whatsappQuickReply.delete({ where: { id } })
    if (found.fileId) await this.files.remove(found.fileId).catch(() => undefined)
    return { ok: true }
  }

  /** Arquivo da resposta rápida (catálogo em PDF, tabela, foto...): troca o anterior, se houver. */
  async setQuickReplyFile(user: AuthUser, id: string, file: Express.Multer.File | undefined) {
    this.assertCan(user)
    const found = await this.prisma.whatsappQuickReply.findFirst({ where: { id, ...this.ownedWhere(user) } })
    if (!found) throw new NotFoundException('Resposta não encontrada.')
    this.assertOwn(user, found, 'resposta')
    if (!file?.buffer?.length) throw new BadRequestException('Escolha um arquivo.')
    if (file.size > MEDIA_MAX_BYTES) throw new BadRequestException('Arquivo maior que 64 MB.')
    const kind = detectOutgoing(file.buffer, file.originalname ?? '')
    if (!kind) throw new BadRequestException('Tipo de arquivo não aceito. Use PDF, Word, Excel, CSV, TXT, foto (JPG, PNG, WEBP) ou vídeo MP4.')
    const fileName = safeFileName(uploadName(file.originalname), kind.ext)
    const asset = await this.files.saveBuffer(user.tenantId, 'whatsapp', file.buffer, kind.mime, kind.ext)
    await this.prisma.whatsappQuickReply.update({ where: { id }, data: { fileId: asset.id, fileName } })
    if (found.fileId) await this.files.remove(found.fileId).catch(() => undefined)
    return { id, fileName }
  }

  async removeQuickReplyFile(user: AuthUser, id: string) {
    this.assertCan(user)
    const found = await this.prisma.whatsappQuickReply.findFirst({ where: { id, ...this.ownedWhere(user) } })
    if (!found) throw new NotFoundException('Resposta não encontrada.')
    this.assertOwn(user, found, 'resposta')
    await this.prisma.whatsappQuickReply.update({ where: { id }, data: { fileId: null, fileName: null } })
    if (found.fileId) await this.files.remove(found.fileId).catch(() => undefined)
    return { id, fileName: null }
  }

  /** Manda o arquivo da resposta rápida na conversa, com a legenda (o texto da resposta, que dá para mudar antes). */
  async sendQuickReplyFile(user: AuthUser, id: string, replyId: string, caption?: string) {
    const reply = await this.prisma.whatsappQuickReply.findFirst({ where: { id: replyId, ...this.ownedWhere(user) } })
    if (!reply) throw new NotFoundException('Resposta não encontrada.')
    if (!reply.fileId) throw new BadRequestException('Esta resposta não tem arquivo.')
    const { content } = await this.files.read(reply.fileId).catch(() => {
      throw new BadRequestException('O arquivo desta resposta não existe mais. Anexe de novo em Respostas rápidas.')
    })
    return this.sendBuffer(user, id, { buffer: content, size: content.length, originalname: reply.fileName ?? 'arquivo' }, caption)
  }

  // ---------- Etiquetas das conversas ----------

  async labels(user: AuthUser) {
    this.assertCan(user)
    const rows = await this.prisma.whatsappLabel.findMany({ where: this.ownedWhere(user), orderBy: [{ userId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }] })
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, standard: r.userId === null, mine: r.userId === user.id }))
  }

  async saveLabel(user: AuthUser, id: string | null, d: { name: string; color: string; standard?: boolean }) {
    this.assertCan(user)
    const name = d.name.trim().slice(0, 30)
    if (!name) throw new BadRequestException('Dê um nome para a etiqueta.')
    if (!LABEL_COLORS.includes(d.color as LabelColor)) throw new BadRequestException('Cor inválida.')
    if (id) {
      const found = await this.prisma.whatsappLabel.findFirst({ where: { id, ...this.ownedWhere(user) } })
      if (!found) throw new NotFoundException('Etiqueta não encontrada.')
      this.assertOwn(user, found, 'etiqueta')
      return this.prisma.whatsappLabel.update({ where: { id }, data: { name, color: d.color } })
    }
    if (d.standard) this.assertAction(user, 'whatsapp', 'edit')
    const owner = d.standard ? null : user.id
    if ((await this.prisma.whatsappLabel.count({ where: { tenantId: user.tenantId, userId: owner } })) >= 50) throw new BadRequestException('Limite de 50 etiquetas.')
    return this.prisma.whatsappLabel.create({ data: { tenantId: user.tenantId, userId: owner, name, color: d.color } })
  }

  async removeLabel(user: AuthUser, id: string) {
    this.assertCan(user)
    const found = await this.prisma.whatsappLabel.findFirst({ where: { id, ...this.ownedWhere(user) } })
    if (!found) throw new NotFoundException('Etiqueta não encontrada.')
    this.assertOwn(user, found, 'etiqueta')
    await this.prisma.whatsappLabel.delete({ where: { id } })
    return { ok: true }
  }

  /** Etiquetas de uma conversa: troca só as que este usuário vê (as pessoais dos outros ficam como estão). */
  async setConversationLabels(user: AuthUser, convId: string, labelIds: string[]) {
    this.assertAction(user, 'chat', 'edit')
    await this.load(user, convId)
    const visible = (await this.prisma.whatsappLabel.findMany({ where: this.ownedWhere(user), select: { id: true } })).map((l) => l.id)
    const wanted = [...new Set(labelIds)].filter((id) => visible.includes(id))
    await this.prisma.$transaction([
      this.prisma.whatsappConversationLabel.deleteMany({ where: { conversationId: convId, labelId: { in: visible.filter((id) => !wanted.includes(id)) } } }),
      this.prisma.whatsappConversationLabel.createMany({ data: wanted.map((labelId) => ({ conversationId: convId, labelId })), skipDuplicates: true }),
    ])
    return { labels: await this.labelsOf(user, [convId]).then((m) => m.get(convId) ?? []) }
  }

  /** Etiquetas visíveis para o usuário em cada conversa. */
  private async labelsOf(user: AuthUser, convIds: string[]) {
    const rows = convIds.length
      ? await this.prisma.whatsappConversationLabel.findMany({ where: { conversationId: { in: convIds }, label: this.ownedWhere(user) }, include: { label: true }, orderBy: { label: { name: 'asc' } } })
      : []
    const out = new Map<string, { id: string; name: string; color: string }[]>()
    for (const r of rows) out.set(r.conversationId, [...(out.get(r.conversationId) ?? []), { id: r.label.id, name: r.label.name, color: r.label.color }])
    return out
  }

  // ---------- Tipo de contato ----------

  /**
   * Marca o contato como cliente, colega, fornecedor ou outro (vale para todos os números). Para quem não é cliente,
   * pode excluir junto o lead e a pré-venda que a conversa criou sozinha (só os criados automaticamente, sem outros atendimentos).
   */
  async setCategory(user: AuthUser, id: string, d: { category: 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'; removeAuto?: boolean }) {
    this.assertAction(user, 'chat', 'edit')
    const conv = await this.load(user, id)
    if (conv.category === 'GRUPO') throw new BadRequestException('Grupo não muda de tipo: ele fica sempre na aba Grupos, fora das pré-vendas.')
    let created: { leadId: string; recordId: string | null } | null = null
    const key = conv.phone ?? conv.jid
    // Vale para a agenda do número desta conversa (cada número tem a sua).
    await this.saveAgenda(user, conv.numberId, key, { category: d.category })
    await this.prisma.whatsappConversation.update({ where: { id }, data: { category: d.category } })
    let removedRecord = false
    let removedLead = false
    if (d.category !== 'CLIENTE' && d.removeAuto) {
      if (conv.recordId && can(user.permissions, user.role.isSystem, 'pre_vendas', 'delete')) {
        const auto = await this.prisma.serviceRecordHistory.findFirst({ where: { recordId: conv.recordId, action: 'criado automaticamente' } })
        if (auto) {
          await this.prisma.serviceRecord.update({ where: { id: conv.recordId }, data: { deletedAt: new Date() } })
          await this.prisma.serviceRecordHistory.create({ data: { recordId: conv.recordId, userId: user.id, userName: user.name, action: 'excluído (contato não é cliente)', changes: {} } })
          removedRecord = true
        }
      }
      if (conv.leadId && can(user.permissions, user.role.isSystem, 'leads', 'delete')) {
        const lead = await this.prisma.lead.findUnique({ where: { id: conv.leadId }, select: { id: true, tags: true, createdAt: true, deletedAt: true } })
        const others = await this.prisma.serviceRecord.count({ where: { leadId: conv.leadId, deletedAt: null } })
        const otherEvents = await this.prisma.leadEvent.count({ where: { leadId: conv.leadId, NOT: [{ type: 'conversao', title: { startsWith: 'Chamou no WhatsApp' } }, { type: 'atendimento' }] } })
        // Só o lead que nasceu desta conversa: marcado como WhatsApp, sem outros atendimentos nem outras conversões.
        if (lead && !lead.deletedAt && lead.tags.includes('whatsapp') && !others && !otherEvents && lead.createdAt.getTime() >= conv.createdAt.getTime() - 60_000) {
          await this.prisma.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } })
          await this.prisma.whatsappConversation.updateMany({ where: { leadId: lead.id }, data: { leadId: null } })
          removedLead = true
        }
      }
      if (removedRecord) await this.prisma.whatsappConversation.update({ where: { id }, data: { recordId: null } })
    }
    // Cliente / venda: a conversa entra no histórico do lead e abre a pré-venda (se ainda não tem uma).
    if (d.category === 'CLIENTE' && !conv.recordId && conv.phone) {
      const n = await this.prisma.whatsappNumber.findUnique({ where: { id: conv.numberId } })
      if (n) {
        const existing = await this.prisma.lead.findFirst({ where: { tenantId: user.tenantId, deletedAt: null, anonymizedAt: null, phone: { in: phoneVariants(conv.phone) } }, orderBy: { createdAt: 'asc' }, select: { phone: true } })
        const first = await this.prisma.whatsappMessage.findFirst({ where: { conversationId: id, fromMe: false }, orderBy: { sentAt: 'asc' } })
        const rules = await this.rules(user.tenantId)
        const withRecord = n.createRecords && (existing ? rules.knownLead === 'HISTORICO_E_PREVENDA' : rules.newContact !== 'SO_LEAD')
        created = await this.openRecord(n, { name: conv.name, phone: existing?.phone ?? conv.phone }, first?.text ?? null, first ? previewOf({ type: first.type as ParsedMessage['type'], text: first.text }) : 'Conversa no WhatsApp', first?.sentAt ?? new Date(), withRecord)
        if (created) await this.prisma.whatsappConversation.update({ where: { id }, data: { leadId: created.leadId, recordId: created.recordId } })
      }
    }
    return { category: d.category, removedRecord, removedLead, createdRecord: !!created }
  }

  // ---------- Administrador: regras e contatos da empresa ----------

  private assertAdmin(user: AuthUser, action: 'view' | 'edit') {
    if (!can(user.permissions, user.role.isSystem, 'whatsapp', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  async getRules(user: AuthUser) {
    this.assertAdmin(user, 'view')
    return this.rules(user.tenantId)
  }

  /** Os campos vêm do formulário do administrador; cleanRules confere cada um (inclusive horário e ausência). */
  async saveRules(user: AuthUser, d: { [K in keyof WaRules]?: unknown }) {
    this.assertAdmin(user, 'edit')
    // Campos ausentes mantêm o valor salvo (ex.: os prazos das cores).
    const r = cleanRules({ ...(await this.rules(user.tenantId)), ...(Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as Partial<WaRules>) })
    await this.settings.set(user.tenantId, 'whatsapp_regras', r)
    return r
  }

  /** Agenda de contatos: todos os tipos (ou um), com a contagem de cada tipo. */
  async companyContacts(user: AuthUser, q: { search?: string; page?: number; category?: AgendaCategory; scope?: string }) {
    this.assertAdmin(user, 'view')
    const scope = await this.agendaScope(user, q.scope)
    const s = q.search?.trim()
    const digits = s?.replace(/\D/g, '') ?? ''
    const where: Prisma.WhatsappContactWhereInput = {
      tenantId: user.tenantId,
      scope,
      ...(q.category ? { category: q.category } : {}),
      ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ contactKey: { contains: digits } }] : [])] } : {}),
    }
    const page = Math.max(1, q.page ?? 1)
    const [total, rows] = await Promise.all([
      this.prisma.whatsappContact.count({ where }),
      this.prisma.whatsappContact.findMany({ where, orderBy: [{ name: 'asc' }, { contactKey: 'asc' }], skip: (page - 1) * 50, take: 50 }),
    ])
    const [counts, perScope, numbers] = await Promise.all([
      this.prisma.whatsappContact.groupBy({ by: ['category'], where: { tenantId: user.tenantId, scope }, _count: { _all: true } }),
      this.prisma.whatsappContact.groupBy({ by: ['scope'], where: { tenantId: user.tenantId }, _count: { _all: true } }),
      this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, phone: true } }),
    ])
    const totalOf = (sc: string) => perScope.find((p) => p.scope === sc)?._count._all ?? 0
    return {
      total,
      page,
      scope,
      /** Agendas: uma por número e a geral (vale para todos os números). */
      agendas: [...numbers.map((n) => ({ scope: n.id, name: n.name, phone: n.phone, total: totalOf(n.id) })), { scope: '', name: 'Todos os números', phone: null, total: totalOf('') }],
      counts: Object.fromEntries(counts.map((c) => [c.category, c._count._all])),
      items: rows.map((r) => ({ id: r.id, name: r.name, phone: r.contactKey.startsWith('+') ? r.contactKey : null, category: r.category, updatedAt: r.updatedAt })),
    }
  }

  /** Muda o tipo ou o nome de um contato da agenda (as conversas dele passam para o tipo novo). */
  async updateCompanyContact(user: AuthUser, id: string, d: { name?: string | null; category?: AgendaCategory; scope?: string }) {
    this.assertAdmin(user, 'edit')
    const c = await this.prisma.whatsappContact.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!c) throw new NotFoundException('Contato não encontrado.')
    const scope = d.scope === undefined ? c.scope : await this.agendaScope(user, d.scope)
    if (scope !== c.scope && (await this.prisma.whatsappContact.count({ where: { tenantId: user.tenantId, scope, contactKey: { in: this.keysOf(c.contactKey) } } }))) {
      throw new BadRequestException('Este telefone já está na agenda de destino.')
    }
    await this.prisma.whatsappContact.update({
      where: { id },
      data: { scope, ...(d.category ? { category: d.category } : {}), ...(d.name !== undefined ? { name: d.name?.trim().slice(0, 120) || null } : {}), updatedById: user.id },
    })
    if (scope !== c.scope) await this.applyAgendaCategory(user.tenantId, c.scope, c.contactKey, await this.fallbackCategory(user.tenantId, c.scope, c.contactKey))
    if (scope !== c.scope || (d.category && d.category !== c.category)) await this.applyAgendaCategory(user.tenantId, scope, c.contactKey, d.category ?? c.category)
    return { ok: true }
  }

  /**
   * Prévia da importação: telefones normalizados (sem repetidos), o tipo que já está na agenda, se é lead (cliente)
   * e a sugestão de tipo. Nada é gravado aqui.
   */
  private async previewRows(user: AuthUser, rows: { name: string | null; phone: string; category: AgendaCategory | null }[], scope: string) {
    const byPhone = new Map<string, { name: string | null; fileCategory: AgendaCategory | null }>()
    let invalid = 0
    for (const r of rows.slice(0, 5000)) {
      const phone = this.contactPhone(r.phone)
      if (!phone) {
        invalid++
        continue
      }
      const prev = byPhone.get(phone)
      if (!prev) byPhone.set(phone, { name: r.name, fileCategory: r.category })
      else if (!prev.name && r.name) prev.name = r.name
    }
    const phones = [...byPhone.keys()]
    // Leads antigos (importados) podem ter o telefone gravado sem o "+".
    const variantsOf = (p: string) => phoneVariants(p).flatMap((v) => [v, v.replace(/^\+/, '')])
    const variants = phones.flatMap(variantsOf)
    const [contacts, leads] = await Promise.all([
      this.prisma.whatsappContact.findMany({ where: { tenantId: user.tenantId, scope, contactKey: { in: variants } }, select: { contactKey: true, category: true } }),
      this.prisma.lead.findMany({ where: { tenantId: user.tenantId, deletedAt: null, anonymizedAt: null, phone: { in: variants } }, select: { phone: true, name: true } }),
    ])
    const catOf = new Map(contacts.map((c) => [c.contactKey, c.category as AgendaCategory]))
    const leadOf = new Map(leads.filter((l) => l.phone).map((l) => [l.phone!, l.name]))
    const items = phones.map((phone) => {
      const r = byPhone.get(phone)!
      const vs = variantsOf(phone)
      const current = vs.map((v) => catOf.get(v)).find(Boolean) ?? null
      const leadKey = vs.find((v) => leadOf.has(v))
      const leadName = leadKey ? leadOf.get(leadKey) || 'Lead sem nome' : null
      return { name: r.name ?? leadName, phone, current, lead: leadName, suggested: current ?? r.fileCategory ?? (leadKey ? ('CLIENTE' as const) : null) }
    })
    items.sort((a, b) => (a.name ?? '~').localeCompare(b.name ?? '~', 'pt-BR'))
    return { items, invalid }
  }

  /** Prévia de um arquivo do celular (.vcf) ou de uma lista (CSV ou colada). */
  async previewContactsFile(user: AuthUser, text: string, scopeRaw?: string) {
    this.assertAdmin(user, 'edit')
    const scope = await this.agendaScope(user, scopeRaw)
    // vCard do celular, CSV do Google Contatos ou uma lista simples (nome e telefone, colada do Excel).
    const parsed = /BEGIN:VCARD/i.test(text) ? parseVcf(text) : (parseGoogleContacts(parseCsv(text.replace(/^\uFEFF/, ''))) ?? parseContactList(text, null))
    if (!parsed.rows.length) throw new BadRequestException('Nenhum telefone encontrado no arquivo. Use o .vcf dos contatos do celular, o CSV exportado do Google Contatos ou um CSV com nome e telefone.')
    const r = await this.previewRows(user, parsed.rows, scope)
    return { ...r, skipped: parsed.skipped, scope }
  }

  /** Prévia dos contatos do WhatsApp conectado (um clique, sem arquivo). */
  async previewContactsWhatsapp(user: AuthUser, numberId: string) {
    this.assertAdmin(user, 'edit')
    const n = await this.prisma.whatsappNumber.findFirst({ where: { id: numberId, tenantId: user.tenantId } })
    if (!n) throw new NotFoundException('Número não encontrado.')
    const client = this.clientOf()
    if (!client) throw new BadRequestException('O WhatsApp não está ativo no servidor.')
    const list = await client.contacts(n.instanceName).catch((e: unknown) => this.fail(e))
    const fromWa = contactsFromWhatsapp(list)
    // Quem já conversou com este número no CRM: o telefone já foi resolvido na conversa (inclusive quando o WhatsApp esconde o número).
    const convs = await this.prisma.whatsappConversation.findMany({ where: { tenantId: user.tenantId, numberId: n.id, phone: { not: null } }, select: { phone: true, name: true, leadId: true }, take: 5000 })
    const leadNames = new Map((await this.prisma.lead.findMany({ where: { id: { in: convs.map((c) => c.leadId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]))
    const fromChat = convs.map((c) => ({ name: (c.leadId && leadNames.get(c.leadId)) || c.name || null, phone: c.phone!, category: null }))
    const rows = [...fromWa, ...fromChat]
    if (!rows.length) {
      const s = fromWa.stats
      throw new BadRequestException(
        s.total
          ? `O WhatsApp devolveu ${s.total} contato(s), mas nenhum com telefone visível (${s.hidden} com o número escondido pelo WhatsApp, ${s.groups} grupo(s)). Use o arquivo .vcf exportado do celular.`
          : 'O WhatsApp deste número não devolveu contatos e ainda não há conversas dele no CRM. Confira se ele está conectado ou use o arquivo .vcf exportado do celular.',
      )
    }
    // Contatos do WhatsApp de um número vão para a agenda desse número.
    const r = await this.previewRows(user, rows, n.id)
    return { ...r, skipped: 0, hidden: fromWa.stats.hidden, fromWhatsapp: fromWa.length, fromChat: fromChat.length, scope: n.id }
  }

  /** Grava na agenda os contatos escolhidos na prévia, cada um com o seu tipo. */
  async saveContacts(user: AuthUser, rows: { name?: string | null; phone: string; category: AgendaCategory }[], scopeRaw?: string) {
    this.assertAdmin(user, 'edit')
    const scope = await this.agendaScope(user, scopeRaw)
    return this.upsertCompany(user, rows.slice(0, 5000).map((x) => ({ name: x.name?.trim().slice(0, 120) || null, phone: x.phone, category: x.category })), scope)
  }

  /** Telefone da lista: celular/fixo do Brasil (com ou sem 55) ou internacional com +. */
  private contactPhone(raw: string) {
    const intl = raw.replace(/[^\d+]/g, '')
    const br = normalizePhone(raw)
    if (br) return phoneFromDigits(br.slice(1)) ?? br
    return /^\+\d{10,15}$/.test(intl) ? intl : null
  }

  /** As formas do mesmo contato na agenda (celular com e sem o 9; identificador do WhatsApp como está). */
  private keysOf(key: string) {
    return key.startsWith('+') ? phoneVariants(key) : [key]
  }

  /** Agenda pedida pela tela: id de um número da empresa, ou vazio (geral, vale para todos). */
  private async agendaScope(user: AuthUser, scope: string | undefined) {
    if (!scope) return ''
    const n = await this.prisma.whatsappNumber.findFirst({ where: { id: scope, tenantId: user.tenantId }, select: { id: true } })
    if (!n) throw new NotFoundException('Número não encontrado.')
    return n.id
  }

  /** Contato que vale para uma conversa: o da agenda do número; se não tiver, o da agenda geral. */
  private async agendaContact(tenantId: string, numberId: string, key: string) {
    const rows = await this.prisma.whatsappContact.findMany({ where: { tenantId, contactKey: { in: this.keysOf(key) }, scope: { in: [numberId, ''] } } })
    return rows.find((r) => r.scope === numberId) ?? rows.find((r) => r.scope === '') ?? null
  }

  /** Grava na agenda (um telefone só por agenda: a outra forma do celular, se já existir, é atualizada). */
  private async saveAgenda(user: AuthUser, scope: string, key: string, d: { name?: string | null; category: string }) {
    const existing = await this.prisma.whatsappContact.findFirst({ where: { tenantId: user.tenantId, scope, contactKey: { in: this.keysOf(key) } } })
    if (existing) {
      await this.prisma.whatsappContact.update({ where: { id: existing.id }, data: { category: d.category, updatedById: user.id, ...(d.name ? { name: d.name } : {}) } })
    } else {
      await this.prisma.whatsappContact.create({ data: { tenantId: user.tenantId, scope, contactKey: key, name: d.name ?? null, category: d.category, updatedById: user.id } })
    }
    await this.applyAgendaCategory(user.tenantId, scope, key, d.category)
  }

  /**
   * Passa as conversas do contato para o tipo da agenda: na agenda de um número, só as desse número; na geral,
   * as dos números que não têm o contato na agenda própria. Grupos não mudam.
   */
  private async applyAgendaCategory(tenantId: string, scope: string, key: string, category: string) {
    const keys = this.keysOf(key)
    let numbers: Prisma.WhatsappConversationWhereInput = { numberId: scope }
    if (!scope) {
      const own = await this.prisma.whatsappContact.findMany({ where: { tenantId, contactKey: { in: keys }, scope: { not: '' } }, select: { scope: true } })
      numbers = own.length ? { numberId: { notIn: own.map((o) => o.scope) } } : {}
    }
    await this.prisma.whatsappConversation.updateMany({ where: { tenantId, ...numbers, category: { not: 'GRUPO' }, OR: [{ phone: { in: keys } }, { jid: { in: keys } }] }, data: { category } })
  }

  /** Tipo que volta a valer quando o contato sai de uma agenda: o da agenda geral (para um número) ou cliente. */
  private async fallbackCategory(tenantId: string, scope: string, key: string) {
    if (!scope) return 'CLIENTE'
    const general = await this.prisma.whatsappContact.findFirst({ where: { tenantId, scope: '', contactKey: { in: this.keysOf(key) } }, select: { category: true } })
    return general?.category ?? 'CLIENTE'
  }

  /** Grava (ou atualiza) contatos da empresa e passa as conversas deles para o tipo novo. */
  private async upsertCompany(user: AuthUser, rows: { name: string | null; phone: string; category: AgendaCategory }[], scope: string) {
    let saved = 0
    let invalid = 0
    for (const r of rows) {
      const phone = this.contactPhone(r.phone)
      if (!phone) {
        invalid++
        continue
      }
      // As duas formas do celular (com e sem o 9) apontam para o mesmo cadastro, dentro da agenda escolhida.
      await this.saveAgenda(user, scope, phone, { name: r.name, category: r.category })
      saved++
    }
    return { saved, invalid }
  }

  async addCompanyContact(user: AuthUser, d: { name?: string | null; phone: string; category: CompanyCategory; scope?: string }) {
    this.assertAdmin(user, 'edit')
    const scope = await this.agendaScope(user, d.scope)
    if (await this.prisma.whatsappContact.count({ where: { tenantId: user.tenantId, scope, contactKey: { in: this.keysOf(this.contactPhone(d.phone) ?? d.phone) } } })) {
      throw new BadRequestException('Este telefone já está nesta agenda. Edite o contato que já existe.')
    }
    const r = await this.upsertCompany(user, [{ name: d.name?.trim().slice(0, 120) || null, phone: d.phone, category: d.category }], scope)
    if (!r.saved) throw new BadRequestException('Telefone inválido. Use DDD + número (ou + e o código do país).')
    return r
  }

  async importCompanyContacts(user: AuthUser, csv: string, fallback: CompanyCategory, scopeRaw?: string) {
    this.assertAdmin(user, 'edit')
    const scope = await this.agendaScope(user, scopeRaw)
    const parsed = parseContactList(csv, fallback)
    if (!parsed.rows.length) throw new BadRequestException('Nenhum telefone encontrado. Cada linha precisa ter nome e telefone (ex.: João;(47) 99999-9999;colega).')
    const r = await this.upsertCompany(user, parsed.rows.map((x) => ({ ...x, category: x.category ?? fallback })), scope)
    return { saved: r.saved, invalid: r.invalid, skipped: parsed.skipped }
  }

  async removeCompanyContact(user: AuthUser, id: string) {
    this.assertAdmin(user, 'edit')
    const c = await this.prisma.whatsappContact.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!c) throw new NotFoundException('Contato não encontrado.')
    await this.prisma.whatsappContact.delete({ where: { id } })
    // Volta a valer a agenda geral (para um número) ou a regra de contato comum.
    await this.applyAgendaCategory(user.tenantId, c.scope, c.contactKey, await this.fallbackCategory(user.tenantId, c.scope, c.contactKey))
    return { ok: true }
  }

  // ---------- Lembretes de retorno e alertas ----------

  async reminders(user: AuthUser, convId: string) {
    await this.load(user, convId)
    const rows = await this.prisma.whatsappReminder.findMany({ where: { conversationId: convId, doneAt: null }, orderBy: { dueAt: 'asc' } })
    return rows.map((r) => ({ id: r.id, dueAt: r.dueAt, note: r.note, userName: r.userName, mine: r.userId === user.id }))
  }

  async createReminder(user: AuthUser, convId: string, d: { dueAt: string; note?: string }) {
    await this.load(user, convId)
    const due = new Date(d.dueAt)
    if (Number.isNaN(due.getTime())) throw new BadRequestException('Data inválida.')
    if (due.getTime() < Date.now() - 60_000) throw new BadRequestException('Escolha uma data e hora no futuro.')
    if (due.getTime() > Date.now() + 366 * 86_400_000) throw new BadRequestException('No máximo 1 ano à frente.')
    if ((await this.prisma.whatsappReminder.count({ where: { userId: user.id, doneAt: null } })) >= 500) throw new BadRequestException('Você tem lembretes demais em aberto. Conclua alguns antes.')
    const r = await this.prisma.whatsappReminder.create({
      data: { tenantId: user.tenantId, conversationId: convId, userId: user.id, userName: user.name.slice(0, 120), dueAt: due, note: d.note?.trim().slice(0, 500) || null },
    })
    return { id: r.id, dueAt: r.dueAt, note: r.note, userName: r.userName, mine: true }
  }

  /** Concluir/excluir: quem criou, ou quem pode editar o chat. */
  private async loadReminder(user: AuthUser, id: string) {
    const r = await this.prisma.whatsappReminder.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!r) throw new NotFoundException('Lembrete não encontrado.')
    if (r.userId !== user.id && !can(user.permissions, user.role.isSystem, 'chat', 'edit')) throw new ForbiddenException('Você não tem permissão para esta ação.')
    return r
  }

  async completeReminder(user: AuthUser, id: string) {
    await this.loadReminder(user, id)
    await this.prisma.whatsappReminder.update({ where: { id }, data: { doneAt: new Date() } })
    return { ok: true }
  }

  async removeReminder(user: AuthUser, id: string) {
    await this.loadReminder(user, id)
    await this.prisma.whatsappReminder.delete({ where: { id } })
    return { ok: true }
  }

  /** Adiar: novo horário, e o aviso volta a aparecer nele. */
  async snoozeReminder(user: AuthUser, id: string, minutes: number) {
    await this.loadReminder(user, id)
    const m = Math.min(Math.max(Math.round(minutes), 5), 7 * 24 * 60)
    await this.prisma.whatsappReminder.update({ where: { id }, data: { dueAt: new Date(Date.now() + m * 60_000), notifiedAt: null } })
    return { ok: true }
  }

  /**
   * Consultado a cada poucos segundos por todas as telas: conversas não lidas (no escopo do usuário), a mais recente
   * (para o aviso) e os lembretes do usuário que já venceram.
   */
  async alerts(user: AuthUser) {
    this.assertCan(user)
    const scope = await this.where(user)
    const unreadWhere = { AND: [scope, { unread: { gt: 0 } }, { status: 'ABERTA' }, { category: { not: 'GRUPO' } }] }
    const [count, sum, latest, due, upcoming] = await Promise.all([
      this.prisma.whatsappConversation.count({ where: unreadWhere }),
      this.prisma.whatsappConversation.aggregate({ where: unreadWhere, _sum: { unread: true } }),
      this.prisma.whatsappConversation.findFirst({ where: unreadWhere, orderBy: { lastMessageAt: 'desc' }, select: { id: true, name: true, phone: true, lastPreview: true, lastMessageAt: true, leadId: true } }),
      this.prisma.whatsappReminder.findMany({ where: { userId: user.id, doneAt: null, dueAt: { lte: new Date() } }, orderBy: { dueAt: 'asc' }, take: 20, include: { conversation: { select: { id: true, name: true, phone: true, leadId: true } } } }),
      this.prisma.whatsappReminder.count({ where: { userId: user.id, doneAt: null, dueAt: { gt: new Date() } } }),
    ])
    // Clientes esperando resposta além do prazo amarelo (mesmas cores da lista do chat). Só as últimas 24 horas:
    // conversa parada há dias não vira alarme a cada consulta.
    const rules = await this.rules(user.tenantId)
    const now = Date.now()
    const waitWhere = {
      AND: [scope, { status: 'ABERTA', noReplyNeeded: false, category: 'CLIENTE' }, { lastInboundAt: { lte: new Date(now - rules.yellowMinutes * 60_000), gte: new Date(now - 24 * 3_600_000) } }],
    }
    // Fora do horário comercial ninguém é cobrado: o aviso de "sem resposta" volta quando abrir.
    const open = isOpen(rules.businessHours)
    const [waitCount, redCount, waitList] = !open ? [0, 0, []] : await Promise.all([
      this.prisma.whatsappConversation.count({ where: waitWhere }),
      this.prisma.whatsappConversation.count({ where: { AND: [waitWhere, { lastInboundAt: { lte: new Date(now - rules.redMinutes * 60_000) } }] } }),
      this.prisma.whatsappConversation.findMany({ where: waitWhere, orderBy: { lastInboundAt: 'asc' }, take: 10, select: { id: true, name: true, phone: true, lastPreview: true, lastInboundAt: true, leadId: true } }),
    ])
    const leadIds = [latest?.leadId, ...due.map((r) => r.conversation.leadId), ...waitList.map((c) => c.leadId)].filter((x): x is string => !!x)
    const names = new Map((await this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]))
    const nameOf = (c: { name: string | null; phone: string | null; leadId: string | null }) => (c.leadId && names.get(c.leadId)) || c.name || c.phone || 'Contato'
    return {
      unreadConversations: count,
      unreadMessages: sum._sum.unread ?? 0,
      latest: latest ? { conversationId: latest.id, name: nameOf(latest), preview: latest.lastPreview, at: latest.lastMessageAt } : null,
      dueReminders: due.map((r) => ({ id: r.id, conversationId: r.conversationId, name: nameOf(r.conversation), note: r.note, dueAt: r.dueAt, notified: !!r.notifiedAt })),
      upcomingReminders: upcoming,
      waiting: {
        yellowMinutes: rules.yellowMinutes,
        redMinutes: rules.redMinutes,
        closed: !open,
        count: waitCount,
        red: redCount,
        items: waitList.map((c) => ({ conversationId: c.id, name: nameOf(c), preview: c.lastPreview, since: c.lastInboundAt })),
      },
    }
  }

  /** O aviso do lembrete já apareceu (as outras abas não repetem). */
  async markReminderNotified(user: AuthUser, id: string) {
    await this.prisma.whatsappReminder.updateMany({ where: { id, userId: user.id, notifiedAt: null }, data: { notifiedAt: new Date() } })
    return { ok: true }
  }
}

/** Período de/até (AAAA-MM-DD, dias inteiros em Brasília, UTC-3); até antes de de é trocado. */
export function toCallRange(from?: string, to?: string): { from: Date; to: Date } | null {
  if (!from && !to) return null
  const a = from ?? to!
  const b = to ?? from!
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const start = new Date(`${lo}T00:00:00-03:00`)
  const end = new Date(new Date(`${hi}T00:00:00-03:00`).getTime() + 86_400_000)
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { from: start, to: end }
}
