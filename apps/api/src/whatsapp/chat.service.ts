import { randomUUID } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { CapturaService } from '../captura/captura.service'
import type { RequestCtx } from '../common/decorators'
import { can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { FilesService } from '../files/files.service'
import type { Prisma, WhatsappNumber } from '../generated/prisma/client'
import { LeadCaptureService } from '../leads/lead-capture.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { normalizePhone } from '../atendimento/br'
import { type EvolutionClient, EvolutionError } from './evolution'
import { sectorsOf, splitWhere } from './atendentes'
import { type AgendaCategory, applyVariables, cleanRules, type CompanyCategory, contactsFromWhatsapp, decide, DEFAULT_RULES, detectOutgoing, LABEL_COLORS, type LabelColor, parseContactList, parseVcf, safeFileName, SendRate, signed, uploadName, type WaRules } from './envio'
import { extOf, MEDIA_MAX_BYTES, parseCalls, parseMessage, type ParsedMessage, phoneFromDigits, phoneVariants, previewOf } from './mensagens'

const PAGE = 60

/**
 * Conversas do WhatsApp: grava o que chega pela Evolution (ligando ao lead e ao Pré-Vendas) e entrega para a tela,
 * respeitando quem pode ver o quê (permissão "Chat WhatsApp": próprios, unidade ou todos).
 */
@Injectable()
export class ChatService {
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
  ) {}

  /** Última leitura em monitoramento registrada na auditoria (usuário + conversa), para não registrar a cada atualização da tela. */
  private readonly monitored = new Map<string, number>()

  // ---------- Recebimento ----------

  ingest(n: WhatsappNumber, data: unknown, client: EvolutionClient | null) {
    const p = parseMessage(data)
    if (!p) return Promise.resolve()
    // Mesma fila para as duas formas do celular (com e sem o 9).
    const key = `${n.id}:${phoneFromDigits(p.phoneDigits) ?? p.jid}`
    const run = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.store(n, p, client))
      .catch((err: unknown) => this.logger.error(`Mensagem não gravada (${n.name}): ${(err as Error).message}`))
      .finally(() => {
        if (this.queues.get(key) === run) this.queues.delete(key)
      })
    this.queues.set(key, run)
    return run
  }

  private async store(n: WhatsappNumber, p: ParsedMessage, client: EvolutionClient | null) {
    const phone = phoneFromDigits(p.phoneDigits)
    // O WhatsApp pode registrar o celular sem o 9: a conversa é a mesma se o telefone (já com o 9) bate.
    let conv =
      (await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid: p.jid } } })) ??
      (phone ? await this.prisma.whatsappConversation.findFirst({ where: { numberId: n.id, phone } }) : null)
    const rules = await this.rules(n.tenantId)
    const idle = !conv?.lastMessageAt || p.at.getTime() - conv.lastMessageAt.getTime() > rules.reopenDays * 86_400_000
    // Contato da empresa (lista do administrador) ou marcado no chat: vale para todos os números.
    const contact = await this.prisma.whatsappContact.findUnique({ where: { tenantId_contactKey: { tenantId: n.tenantId, contactKey: phone ?? p.jid } } })
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
          sentAt: p.at,
        },
      ],
      skipDuplicates: true,
    })
    // A Evolution pode mandar o mesmo evento de novo: grava uma vez só.
    if (!saved.length) return

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
    await this.prisma.whatsappConversation.update({
      where: { id: conv.id },
      data: {
        leadId,
        recordId,
        category,
        ...(phone && !conv.phone ? { phone } : {}),
        ...(p.pushName && !conv.name ? { name: p.pushName } : {}),
        ...(later ? { lastMessageAt: p.at, lastPreview: previewOf(p), lastFromMe: p.fromMe } : {}),
        // Resposta pelo celular zera as não lidas (alguém já está atendendo).
        ...(p.fromMe ? { unread: 0 } : { unread: { increment: 1 }, status: 'ABERTA' }),
      },
    })
    if (p.media && !tooBig && client) void this.downloadMedia(n, saved[0]!.id, p, client)
  }

  /** Ligação recebida: vira um aviso na conversa (atender pelo celular). Não cria lead nem pré-venda. */
  async ingestCalls(n: WhatsappNumber, data: unknown) {
    for (const c of parseCalls(data)) {
      const phone = phoneFromDigits(c.phoneDigits)
      let conv =
        (await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid: c.jid } } })) ??
        (phone ? await this.prisma.whatsappConversation.findFirst({ where: { numberId: n.id, phone } }) : null)
      if (!conv) {
        const contact = await this.prisma.whatsappContact.findUnique({ where: { tenantId_contactKey: { tenantId: n.tenantId, contactKey: phone ?? c.jid } } })
        const lead = phone && (!contact || contact.category === 'CLIENTE') ? await this.prisma.lead.findFirst({ where: { tenantId: n.tenantId, deletedAt: null, anonymizedAt: null, phone: { in: phoneVariants(phone) } }, select: { id: true } }) : null
        conv = await this.prisma.whatsappConversation.create({ data: { tenantId: n.tenantId, numberId: n.id, jid: c.jid, phone, category: contact?.category ?? 'CLIENTE', leadId: lead?.id ?? null } })
      }
      const text = c.isVideo ? 'Ligação de vídeo recebida. Atenda pelo celular deste número.' : 'Ligação de voz recebida. Atenda pelo celular deste número.'
      const saved = await this.prisma.whatsappMessage.createMany({ data: [{ tenantId: n.tenantId, conversationId: conv.id, waId: `call-${c.callId}`, fromMe: false, type: 'chamada', text, sentAt: c.at }], skipDuplicates: true })
      if (!saved.count) continue
      await this.prisma.whatsappConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: c.at, lastPreview: c.isVideo ? 'Ligação de vídeo recebida' : 'Ligação de voz recebida', lastFromMe: false, unread: { increment: 1 }, status: 'ABERTA' },
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

  private assertMonitor(user: AuthUser) {
    if (!this.canMonitor(user)) throw new ForbiddenException('Você não tem permissão para monitorar as conversas.')
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
    return {
      ...base,
      OR: [
        ...(normal.length ? [{ numberId: { in: normal } }] : []),
        // Atendimento dividido: as minhas, a fila do meu setor e os contatos da empresa.
        ...splitWhere(user.id, split),
        // Passadas para mim (mesmo de outro número) ou para o vendedor ligado ao meu login.
        { assignedUserId: user.id },
        ...(sellerId ? [{ assignedSellerId: sellerId }] : []),
      ],
    }
  }

  /** Números do usuário: ligados ao login dele ou ao vendedor dele (cadastro do número em Números de WhatsApp). */
  private async ownNumbers(user: AuthUser) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } })
    const nums = await this.prisma.whatsappNumber.findMany({
      where: { tenantId: user.tenantId, deletedAt: null, OR: [{ userIds: { has: user.id } }, ...(seller ? [{ sellerIds: { has: seller.id } }] : [])] },
      select: { id: true, splitAttendance: true, sectors: true },
    })
    return { numberIds: nums.map((n) => n.id), numbers: nums, sellerId: seller?.id ?? null }
  }

  async conversations(user: AuthUser, q: { numberId?: string; unread?: boolean; archived?: boolean; search?: string; page?: number; category?: string; leadId?: string; reminders?: boolean; monitor?: boolean; sellerId?: string; awaiting?: boolean; queue?: boolean; labelId?: string }) {
    if (q.monitor) this.assertMonitor(user)
    else this.assertCan(user)
    const scope: Prisma.WhatsappConversationWhereInput = q.monitor ? { tenantId: user.tenantId } : await this.where(user)
    // Na ficha do lead aparecem todas as conversas dele (abertas e arquivadas).
    const and: Prisma.WhatsappConversationWhereInput[] = q.leadId ? [scope, { leadId: q.leadId }] : [scope, { lastMessageAt: { not: null } }, { status: q.archived ? 'ARQUIVADA' : 'ABERTA' }]
    if (q.numberId) and.push({ numberId: q.numberId })
    if (q.unread) and.push({ unread: { gt: 0 } })
    if (q.category) and.push({ category: q.category })
    if (q.reminders) and.push({ reminders: { some: { userId: user.id, doneAt: null } } })
    if (q.labelId) and.push({ labels: { some: { labelId: q.labelId, label: this.ownedWhere(user) } } })
    if (q.monitor && q.sellerId) and.push(await this.sellerWhere(user.tenantId, q.sellerId))
    // Aguardando resposta: a última mensagem é do contato.
    if (q.awaiting) and.push({ lastFromMe: false })
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
    const [total, rows, unread, numbers] = await Promise.all([
      this.prisma.whatsappConversation.count({ where }),
      this.prisma.whatsappConversation.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip: (page - 1) * 50, take: 50 }),
      this.prisma.whatsappConversation.aggregate({ where: { AND: [scope, { unread: { gt: 0 } }] }, _count: { _all: true } }),
      q.monitor ? this.allNumbers(user.tenantId) : this.visibleNumbers(user, scope),
    ])
    const leads = new Map((await this.prisma.lead.findMany({ where: { id: { in: rows.map((r) => r.leadId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]))
    const reminders = new Map(
      (await this.prisma.whatsappReminder.groupBy({ by: ['conversationId'], where: { userId: user.id, doneAt: null, conversationId: { in: rows.map((r) => r.id) } }, _min: { dueAt: true } })).map((r) => [r.conversationId, r._min.dueAt]),
    )
    const labels = await this.labelsOf(user, rows.map((r) => r.id))
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
        category: r.category,
        status: r.status,
        reminderAt: reminders.get(r.id) ?? null,
        noteUnread: r.noteUnread,
        assignedUserId: r.assignedUserId,
        assignedUserName: r.assignedUserId ? (userNames.get(r.assignedUserId) ?? null) : null,
        sectorId: r.sectorId,
        labels: labels.get(r.id) ?? [],
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
    if (this.scopeOf(user) === 'ALL') return all
    const ids = new Set((await this.prisma.whatsappConversation.findMany({ where: scope, select: { numberId: true }, distinct: ['numberId'] })).map((c) => c.numberId))
    const mine = (await this.ownNumbers(user)).numberIds
    return all.filter((n) => ids.has(n.id) || mine.includes(n.id))
  }

  private async load(user: AuthUser, id: string) {
    this.assertCan(user)
    const conv = await this.prisma.whatsappConversation.findFirst({ where: { AND: [{ id }, await this.where(user)] } })
    if (!conv) throw new NotFoundException('Conversa não encontrada.')
    return conv
  }

  /** Monitoramento: qualquer conversa da empresa, só para ler (registra na auditoria quem leu). */
  private async loadMonitor(user: AuthUser, id: string, ctx?: RequestCtx) {
    this.assertMonitor(user)
    const conv = await this.prisma.whatsappConversation.findFirst({ where: { id, tenantId: user.tenantId } })
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
    // Atendentes do número (para assumir e transferir) e o nome de quem atende.
    const attendants = number ? await this.prisma.user.findMany({ where: { id: { in: [...new Set([...number.userIds, ...(conv.assignedUserId ? [conv.assignedUserId] : [])])] }, tenantId: user.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, active: true } }) : []
    return {
      conversation: { id: conv.id, name: lead?.name || conv.name, phone: conv.phone, jid: conv.jid, status: conv.status, assignedSellerId: conv.assignedSellerId, assignedUserId: conv.assignedUserId, assignedUserName: attendants.find((a) => a.id === conv.assignedUserId)?.name ?? null, sectorId: conv.sectorId, category: conv.category, unread: conv.unread, labels: (await this.labelsOf(user, [conv.id])).get(conv.id) ?? [] },
      attendance: number ? { split: number.splitAttendance, sectors: sectorsOf(number.sectors).map((s) => ({ id: s.id, name: s.name })), attendants: attendants.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name })) } : null,
      monitor: !!monitor,
      number: number ? { id: number.id, name: number.name, phone: number.phone, status: number.status } : null,
      lead,
      record,
      hasMore: more,
      messages: rows
        .slice(0, PAGE)
        .reverse()
        .map((m) => ({ id: m.id, fromMe: m.fromMe, type: m.type, text: m.text, fileName: m.fileName, mime: m.mime, mediaStatus: m.mediaStatus, hasFile: !!m.fileId, sentAt: m.sentAt, sentByName: m.sentByName, status: m.status, internal: m.internal })),
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
    if (monitor) this.assertMonitor(user)
    const m = await this.prisma.whatsappMessage.findFirst({ where: { id: messageId, tenantId: user.tenantId } })
    if (!m?.fileId) throw new NotFoundException()
    if (monitor) await this.loadMonitor(user, m.conversationId)
    else await this.load(user, m.conversationId)
    const { asset, content } = await this.files.read(m.fileId)
    return { mime: asset.mime, content, fileName: m.fileName }
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
    m: { type: string; text: string | null; fileId?: string; fileName?: string; mime?: string },
  ) {
    const data = { sentById: user.id, sentByName: user.name.slice(0, 120), status: 'ENVIADA', ...(m.fileId ? { fileId: m.fileId, fileName: m.fileName ?? null, mime: m.mime ?? null, mediaStatus: 'OK' } : {}) }
    // O evento da Evolution pode chegar antes desta resposta: aí a mensagem já existe e só ganha quem enviou.
    const msg = await this.prisma.whatsappMessage.upsert({
      where: { conversationId_waId: { conversationId: c.conv.id, waId: r.waId } },
      create: { tenantId: c.conv.tenantId, conversationId: c.conv.id, waId: r.waId, fromMe: true, type: m.type, text: m.text, sentAt: r.at, ...data },
      update: data,
    })
    await this.prisma.whatsappConversation.update({
      where: { id: c.conv.id },
      data: { lastMessageAt: r.at, lastPreview: previewOf({ type: m.type as ParsedMessage['type'], text: m.text }), lastFromMe: true, unread: 0, status: 'ABERTA', ...(c.number.splitAttendance && !c.conv.assignedUserId ? { assignedUserId: user.id } : {}) },
    })
    // Responder pelo CRM atende a pré-venda ligada à conversa (tira o aviso de pré-venda aguardando).
    const recordId = (await this.prisma.whatsappConversation.findUnique({ where: { id: c.conv.id }, select: { recordId: true } }))?.recordId
    if (recordId) await this.prisma.serviceRecord.updateMany({ where: { id: recordId, kind: 'PRE_VENDAS', firstActionAt: null }, data: { firstActionAt: r.at } })
    // O WhatsApp registrou o contato com outro identificador (ex.: celular sem o 9): a conversa passa a usar o dele.
    if (r.remoteJid?.endsWith('@s.whatsapp.net') && r.remoteJid !== c.conv.jid) {
      const taken = await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: c.conv.numberId, jid: r.remoteJid } } })
      if (!taken) await this.prisma.whatsappConversation.update({ where: { id: c.conv.id }, data: { jid: r.remoteJid } })
    }
    return { id: msg.id, fromMe: true, type: msg.type, text: msg.text, fileName: msg.fileName, mime: msg.mime, mediaStatus: msg.mediaStatus, hasFile: !!msg.fileId, sentAt: msg.sentAt, sentByName: msg.sentByName, status: msg.status }
  }

  private fail(err: unknown): never {
    if (err instanceof EvolutionError) throw new BadRequestException(`Não foi enviada: ${err.message}`)
    throw err
  }

  /** Nome escolhido pelo usuário para as mensagens (Meu perfil). */
  private async signatureOf(user: AuthUser) {
    return (await this.prisma.user.findUnique({ where: { id: user.id }, select: { chatSignature: true } }))?.chatSignature ?? null
  }

  async sendText(user: AuthUser, id: string, raw: string) {
    const text = raw.replace(/\r\n/g, '\n').trim()
    if (!text) throw new BadRequestException('Escreva a mensagem.')
    if (text.length > 4000) throw new BadRequestException('Mensagem muito longa (máximo 4.000 caracteres).')
    const c = await this.sendContext(user, id)
    const body = c.number.signMessages ? signed(text, user.name, await this.signatureOf(user)) : text
    const r = await c.client.sendText(c.number.instanceName, c.target, body).catch((e: unknown) => this.fail(e))
    return this.recordSent(user, c, r, { type: 'texto', text: body })
  }

  async sendFile(user: AuthUser, id: string, file: Express.Multer.File | undefined, caption?: string, voice = false) {
    if (!file?.buffer?.length) throw new BadRequestException('Escolha um arquivo.')
    if (file.size > MEDIA_MAX_BYTES) throw new BadRequestException('Arquivo maior que 16 MB.')
    const kind = detectOutgoing(file.buffer, file.originalname ?? '', voice)
    if (!kind) throw new BadRequestException(voice ? 'Não foi possível ler o áudio gravado. Tente gravar de novo.' : 'Tipo de arquivo não aceito. Envie foto (JPG, PNG, WEBP), vídeo MP4, áudio (OGG, MP3, M4A), PDF, Word, Excel, CSV ou TXT.')
    const c = await this.sendContext(user, id)
    const fileName = safeFileName(uploadName(file.originalname), kind.ext)
    const cap = caption?.trim().slice(0, 1000) || null
    const text = cap ? (c.number.signMessages ? signed(cap, user.name, await this.signatureOf(user)) : cap) : null
    const base64 = file.buffer.toString('base64')
    const r =
      kind.kind === 'audio'
        ? await c.client.sendAudio(c.number.instanceName, c.target, base64).catch((e: unknown) => this.fail(e))
        : await c.client.sendMedia(c.number.instanceName, c.target, { mediatype: kind.kind, mimetype: kind.mime, base64, fileName, caption: text ?? undefined }).catch((e: unknown) => this.fail(e))
    const asset = await this.files.saveBuffer(c.conv.tenantId, 'whatsapp', file.buffer, kind.mime, kind.ext)
    const type = ({ image: 'imagem', video: 'video', audio: 'audio', document: 'documento' } as const)[kind.kind]
    return this.recordSent(user, c, r, { type, text: kind.kind === 'audio' ? null : text, fileId: asset.id, fileName, mime: kind.mime })
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
    const phone = normalizePhone(raw) ?? (/^\+\d{10,15}$/.test(intl) ? intl : null)
    if (!phone) throw new BadRequestException('Telefone inválido. Use DDD + número.')
    const jid = `${phone.slice(1)}@s.whatsapp.net`
    const existing =
      (await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: number.id, jid } } })) ??
      (await this.prisma.whatsappConversation.findFirst({ where: { numberId: number.id, phone: { in: phoneVariants(phone) } } }))
    const split = (await this.prisma.whatsappNumber.findUnique({ where: { id: number.id }, select: { splitAttendance: true } }))?.splitAttendance ?? false
    if (existing) {
      // Atendimento dividido: cliente de outro atendente não muda de dono; da fila, passa para quem iniciou.
      if (split && existing.assignedUserId && existing.assignedUserId !== user.id && existing.category === 'CLIENTE' && this.scopeOf(user) === 'OWN') {
        const owner = await this.prisma.user.findUnique({ where: { id: existing.assignedUserId }, select: { name: true } })
        throw new BadRequestException(`Este cliente já é atendido por ${owner?.name ?? 'outro atendente'} neste número. Peça a transferência para você.`)
      }
      const patch = { ...(lead && !existing.leadId ? { leadId: lead.id } : {}), ...(split && !existing.assignedUserId ? { assignedUserId: user.id } : {}) }
      if (Object.keys(patch).length) await this.prisma.whatsappConversation.update({ where: { id: existing.id }, data: patch })
      return { id: existing.id }
    }
    const conv = await this.prisma.whatsappConversation.create({
      data: { tenantId: user.tenantId, numberId: number.id, jid, phone, name: lead?.name ?? null, leadId: lead?.id ?? null, lastMessageAt: new Date(), lastPreview: 'Conversa iniciada pelo CRM', lastFromMe: true, ...(split ? { assignedUserId: user.id } : {}) },
    })
    return { id: conv.id }
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
   * Atendimento dividido: assumir da fila ou transferir para outro atendente ou para a fila de um setor.
   * Quem atende pode passar a própria conversa (ou uma da fila); com a ação Editar do chat, qualquer uma.
   */
  async assign(user: AuthUser, id: string, d: { userId?: string | null; sectorId?: string | null }, ctx: RequestCtx) {
    this.assertAction(user, 'chat', 'create')
    const conv = await this.load(user, id)
    const canEdit = can(user.permissions, user.role.isSystem, 'chat', 'edit')
    if (!canEdit && conv.assignedUserId && conv.assignedUserId !== user.id) throw new ForbiddenException('Esta conversa é de outro atendente.')
    const number = await this.prisma.whatsappNumber.findUnique({ where: { id: conv.numberId }, select: { userIds: true, sectors: true } })
    if (!number) throw new NotFoundException('Número não encontrado.')
    const sectors = sectorsOf(number.sectors)
    const userId = d.userId === undefined ? conv.assignedUserId : d.userId
    if (userId && userId !== user.id && !number.userIds.includes(userId)) throw new BadRequestException('Escolha um atendente deste número.')
    if (userId && !(await this.prisma.user.count({ where: { id: userId, tenantId: user.tenantId, active: true } }))) throw new BadRequestException('Atendente inválido.')
    const sectorId = d.sectorId === undefined ? conv.sectorId : d.sectorId
    if (sectorId && !sectors.some((s) => s.id === sectorId)) throw new BadRequestException('Setor inválido.')
    const r = await this.prisma.whatsappConversation.update({ where: { id }, data: { assignedUserId: userId ?? null, sectorId: sectorId ?? null } })
    await this.audit.byUser(user, ctx, userId === user.id && conv.assignedUserId !== user.id ? 'chat.assumida' : 'chat.transferida', 'whatsapp_conversation', id, {
      atendente: userId ?? null,
      setor: sectors.find((s) => s.id === sectorId)?.name ?? null,
    })
    return { id: r.id, assignedUserId: r.assignedUserId, sectorId: r.sectorId }
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
    return rows.map((r) => ({ id: r.id, title: r.title, text: r.text, standard: r.userId === null, mine: r.userId === user.id, preview: applyVariables(r.text, { nome, vendedor: user.name }) }))
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
    return { ok: true }
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
    let created: { leadId: string; recordId: string | null } | null = null
    const key = conv.phone ?? conv.jid
    await this.prisma.whatsappContact.upsert({
      where: { tenantId_contactKey: { tenantId: user.tenantId, contactKey: key } },
      create: { tenantId: user.tenantId, contactKey: key, category: d.category, updatedById: user.id },
      update: { category: d.category, updatedById: user.id },
    })
    await this.prisma.whatsappConversation.updateMany({ where: { tenantId: user.tenantId, OR: [{ phone: key }, { jid: key }, { id }] }, data: { category: d.category } })
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

  async saveRules(user: AuthUser, d: Partial<WaRules>) {
    this.assertAdmin(user, 'edit')
    // Campos ausentes mantêm o valor salvo (ex.: os prazos das cores).
    const r = cleanRules({ ...(await this.rules(user.tenantId)), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) })
    await this.settings.set(user.tenantId, 'whatsapp_regras', r)
    return r
  }

  /** Agenda de contatos: todos os tipos (ou um), com a contagem de cada tipo. */
  async companyContacts(user: AuthUser, q: { search?: string; page?: number; category?: AgendaCategory }) {
    this.assertAdmin(user, 'view')
    const s = q.search?.trim()
    const digits = s?.replace(/\D/g, '') ?? ''
    const where: Prisma.WhatsappContactWhereInput = {
      tenantId: user.tenantId,
      ...(q.category ? { category: q.category } : {}),
      ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ contactKey: { contains: digits } }] : [])] } : {}),
    }
    const page = Math.max(1, q.page ?? 1)
    const [total, rows] = await Promise.all([
      this.prisma.whatsappContact.count({ where }),
      this.prisma.whatsappContact.findMany({ where, orderBy: [{ name: 'asc' }, { contactKey: 'asc' }], skip: (page - 1) * 50, take: 50 }),
    ])
    const counts = await this.prisma.whatsappContact.groupBy({ by: ['category'], where: { tenantId: user.tenantId }, _count: { _all: true } })
    return {
      total,
      page,
      counts: Object.fromEntries(counts.map((c) => [c.category, c._count._all])),
      items: rows.map((r) => ({ id: r.id, name: r.name, phone: r.contactKey.startsWith('+') ? r.contactKey : null, category: r.category, updatedAt: r.updatedAt })),
    }
  }

  /** Muda o tipo ou o nome de um contato da agenda (as conversas dele passam para o tipo novo). */
  async updateCompanyContact(user: AuthUser, id: string, d: { name?: string | null; category?: AgendaCategory }) {
    this.assertAdmin(user, 'edit')
    const c = await this.prisma.whatsappContact.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!c) throw new NotFoundException('Contato não encontrado.')
    await this.prisma.whatsappContact.update({
      where: { id },
      data: { ...(d.category ? { category: d.category } : {}), ...(d.name !== undefined ? { name: d.name?.trim().slice(0, 120) || null } : {}), updatedById: user.id },
    })
    if (d.category && d.category !== c.category) {
      await this.prisma.whatsappConversation.updateMany({ where: { tenantId: user.tenantId, OR: [{ phone: { in: phoneVariants(c.contactKey) } }, { jid: c.contactKey }] }, data: { category: d.category } })
    }
    return { ok: true }
  }

  /**
   * Prévia da importação: telefones normalizados (sem repetidos), o tipo que já está na agenda, se é lead (cliente)
   * e a sugestão de tipo. Nada é gravado aqui.
   */
  private async previewRows(user: AuthUser, rows: { name: string | null; phone: string; category: AgendaCategory | null }[]) {
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
      this.prisma.whatsappContact.findMany({ where: { tenantId: user.tenantId, contactKey: { in: variants } }, select: { contactKey: true, category: true } }),
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
  async previewContactsFile(user: AuthUser, text: string) {
    this.assertAdmin(user, 'edit')
    const parsed = /BEGIN:VCARD/i.test(text) ? parseVcf(text) : parseContactList(text, null)
    if (!parsed.rows.length) throw new BadRequestException('Nenhum telefone encontrado no arquivo. Use o .vcf exportado dos contatos do celular ou um CSV com nome e telefone.')
    const r = await this.previewRows(user, parsed.rows)
    return { ...r, skipped: parsed.skipped }
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
    const r = await this.previewRows(user, rows)
    return { ...r, skipped: 0, hidden: fromWa.stats.hidden, fromWhatsapp: fromWa.length, fromChat: fromChat.length }
  }

  /** Grava na agenda os contatos escolhidos na prévia, cada um com o seu tipo. */
  async saveContacts(user: AuthUser, rows: { name?: string | null; phone: string; category: AgendaCategory }[]) {
    this.assertAdmin(user, 'edit')
    return this.upsertCompany(user, rows.slice(0, 5000).map((x) => ({ name: x.name?.trim().slice(0, 120) || null, phone: x.phone, category: x.category })))
  }

  /** Telefone da lista: celular/fixo do Brasil (com ou sem 55) ou internacional com +. */
  private contactPhone(raw: string) {
    const intl = raw.replace(/[^\d+]/g, '')
    return normalizePhone(raw) ?? (/^\+\d{10,15}$/.test(intl) ? intl : null)
  }

  /** Grava (ou atualiza) contatos da empresa e passa as conversas deles para o tipo novo. */
  private async upsertCompany(user: AuthUser, rows: { name: string | null; phone: string; category: AgendaCategory }[]) {
    let saved = 0
    let invalid = 0
    for (const r of rows) {
      const phone = this.contactPhone(r.phone)
      if (!phone) {
        invalid++
        continue
      }
      // As duas formas do celular (com e sem o 9) apontam para o mesmo cadastro.
      await this.prisma.whatsappContact.upsert({
        where: { tenantId_contactKey: { tenantId: user.tenantId, contactKey: phone } },
        create: { tenantId: user.tenantId, contactKey: phone, name: r.name, category: r.category, updatedById: user.id },
        update: { category: r.category, updatedById: user.id, ...(r.name ? { name: r.name } : {}) },
      })
      await this.prisma.whatsappConversation.updateMany({ where: { tenantId: user.tenantId, phone: { in: phoneVariants(phone) } }, data: { category: r.category } })
      saved++
    }
    return { saved, invalid }
  }

  async addCompanyContact(user: AuthUser, d: { name?: string | null; phone: string; category: CompanyCategory }) {
    this.assertAdmin(user, 'edit')
    const r = await this.upsertCompany(user, [{ name: d.name?.trim().slice(0, 120) || null, phone: d.phone, category: d.category }])
    if (!r.saved) throw new BadRequestException('Telefone inválido. Use DDD + número (ou + e o código do país).')
    return r
  }

  async importCompanyContacts(user: AuthUser, csv: string, fallback: CompanyCategory) {
    this.assertAdmin(user, 'edit')
    const parsed = parseContactList(csv, fallback)
    if (!parsed.rows.length) throw new BadRequestException('Nenhum telefone encontrado. Cada linha precisa ter nome e telefone (ex.: João;(47) 99999-9999;colega).')
    const r = await this.upsertCompany(user, parsed.rows.map((x) => ({ ...x, category: x.category ?? fallback })))
    return { saved: r.saved, invalid: r.invalid, skipped: parsed.skipped }
  }

  async removeCompanyContact(user: AuthUser, id: string) {
    this.assertAdmin(user, 'edit')
    const c = await this.prisma.whatsappContact.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!c) throw new NotFoundException('Contato não encontrado.')
    await this.prisma.whatsappContact.delete({ where: { id } })
    // Volta a valer a regra de contato comum.
    await this.prisma.whatsappConversation.updateMany({ where: { tenantId: user.tenantId, OR: [{ phone: { in: phoneVariants(c.contactKey) } }, { jid: c.contactKey }] }, data: { category: 'CLIENTE' } })
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
    const unreadWhere = { AND: [scope, { unread: { gt: 0 } }, { status: 'ABERTA' }] }
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
      AND: [scope, { status: 'ABERTA', lastFromMe: false, category: 'CLIENTE' }, { lastMessageAt: { lte: new Date(now - rules.yellowMinutes * 60_000), gte: new Date(now - 24 * 3_600_000) } }],
    }
    const [waitCount, redCount, waitList] = await Promise.all([
      this.prisma.whatsappConversation.count({ where: waitWhere }),
      this.prisma.whatsappConversation.count({ where: { AND: [waitWhere, { lastMessageAt: { lte: new Date(now - rules.redMinutes * 60_000) } }] } }),
      this.prisma.whatsappConversation.findMany({ where: waitWhere, orderBy: { lastMessageAt: 'asc' }, take: 10, select: { id: true, name: true, phone: true, lastPreview: true, lastMessageAt: true, leadId: true } }),
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
        count: waitCount,
        red: redCount,
        items: waitList.map((c) => ({ conversationId: c.id, name: nameOf(c), preview: c.lastPreview, since: c.lastMessageAt })),
      },
    }
  }

  /** O aviso do lembrete já apareceu (as outras abas não repetem). */
  async markReminderNotified(user: AuthUser, id: string) {
    await this.prisma.whatsappReminder.updateMany({ where: { id, userId: user.id, notifiedAt: null }, data: { notifiedAt: new Date() } })
    return { ok: true }
  }
}
