import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { CapturaService } from '../captura/captura.service'
import { can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { FilesService } from '../files/files.service'
import type { Prisma, WhatsappNumber } from '../generated/prisma/client'
import { LeadCaptureService } from '../leads/lead-capture.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { normalizePhone } from '../atendimento/br'
import { type EvolutionClient, EvolutionError } from './evolution'
import { applyVariables, cleanRules, type CompanyCategory, decide, DEFAULT_RULES, detectOutgoing, parseContactList, safeFileName, SendRate, signed, uploadName, type WaRules } from './envio'
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
  ) {}

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
    const seller = await this.prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } })
    if (!seller) return { id: { in: [] } }
    const nums = await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, sellerIds: { has: seller.id } }, select: { id: true } })
    return { ...base, OR: [{ numberId: { in: nums.map((x) => x.id) } }, { assignedSellerId: seller.id }] }
  }

  async conversations(user: AuthUser, q: { numberId?: string; unread?: boolean; archived?: boolean; search?: string; page?: number; category?: string; leadId?: string; reminders?: boolean }) {
    this.assertCan(user)
    const scope = await this.where(user)
    // Na ficha do lead aparecem todas as conversas dele (abertas e arquivadas).
    const and: Prisma.WhatsappConversationWhereInput[] = q.leadId ? [scope, { leadId: q.leadId }] : [scope, { lastMessageAt: { not: null } }, { status: q.archived ? 'ARQUIVADA' : 'ABERTA' }]
    if (q.numberId) and.push({ numberId: q.numberId })
    if (q.unread) and.push({ unread: { gt: 0 } })
    if (q.category) and.push({ category: q.category })
    if (q.reminders) and.push({ reminders: { some: { userId: user.id, doneAt: null } } })
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
      this.visibleNumbers(user, scope),
    ])
    const leads = new Map((await this.prisma.lead.findMany({ where: { id: { in: rows.map((r) => r.leadId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]))
    const reminders = new Map(
      (await this.prisma.whatsappReminder.groupBy({ by: ['conversationId'], where: { userId: user.id, doneAt: null, conversationId: { in: rows.map((r) => r.id) } }, _min: { dueAt: true } })).map((r) => [r.conversationId, r._min.dueAt]),
    )
    return {
      total,
      page,
      unreadConversations: unread._count._all,
      numbers,
      items: rows.map((r) => ({
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
      })),
    }
  }

  private async visibleNumbers(user: AuthUser, scope: Prisma.WhatsappConversationWhereInput) {
    const all = await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, phone: true, status: true } })
    if (this.scopeOf(user) === 'ALL') return all
    const ids = new Set((await this.prisma.whatsappConversation.findMany({ where: scope, select: { numberId: true }, distinct: ['numberId'] })).map((c) => c.numberId))
    const seller = await this.prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } })
    const mine = seller ? (await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, sellerIds: { has: seller.id } }, select: { id: true } })).map((x) => x.id) : []
    return all.filter((n) => ids.has(n.id) || mine.includes(n.id))
  }

  private async load(user: AuthUser, id: string) {
    this.assertCan(user)
    const conv = await this.prisma.whatsappConversation.findFirst({ where: { AND: [{ id }, await this.where(user)] } })
    if (!conv) throw new NotFoundException('Conversa não encontrada.')
    return conv
  }

  /** Conversa com as mensagens (as mais recentes; "antes" pagina para trás). Abrir marca como lida. */
  async conversation(user: AuthUser, id: string, before?: string) {
    const conv = await this.load(user, id)
    const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null
    const [rows, number, lead, record] = await Promise.all([
      this.prisma.whatsappMessage.findMany({ where: { conversationId: id, ...(beforeDate ? { sentAt: { lt: beforeDate } } : {}) }, orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }], take: PAGE + 1 }),
      this.prisma.whatsappNumber.findUnique({ where: { id: conv.numberId }, select: { id: true, name: true, phone: true, status: true } }),
      conv.leadId ? this.prisma.lead.findUnique({ where: { id: conv.leadId }, select: { id: true, name: true, email: true, phone: true, adsLastCampaign: true, adsLastCampaignId: true } }) : null,
      conv.recordId ? this.prisma.serviceRecord.findUnique({ where: { id: conv.recordId }, select: { id: true, kind: true, leadAt: true, saleStatus: true, adsVia: true, adsCampaign: true, adsCampaignId: true, entryChannel: true } }) : null,
    ])
    if (conv.unread > 0 && !beforeDate) await this.prisma.whatsappConversation.update({ where: { id }, data: { unread: 0 } })
    const more = rows.length > PAGE
    return {
      conversation: { id: conv.id, name: lead?.name || conv.name, phone: conv.phone, jid: conv.jid, status: conv.status, assignedSellerId: conv.assignedSellerId, category: conv.category },
      number,
      lead,
      record,
      hasMore: more,
      messages: rows
        .slice(0, PAGE)
        .reverse()
        .map((m) => ({ id: m.id, fromMe: m.fromMe, type: m.type, text: m.text, fileName: m.fileName, mime: m.mime, mediaStatus: m.mediaStatus, hasFile: !!m.fileId, sentAt: m.sentAt, sentByName: m.sentByName, status: m.status })),
    }
  }

  /** Mídia de uma mensagem, só para quem pode ver a conversa. */
  async media(user: AuthUser, messageId: string) {
    const m = await this.prisma.whatsappMessage.findFirst({ where: { id: messageId, tenantId: user.tenantId } })
    if (!m?.fileId) throw new NotFoundException()
    await this.load(user, m.conversationId)
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
    c: { conv: { id: string; jid: string; numberId: string; tenantId: string }; number: WhatsappNumber },
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
      data: { lastMessageAt: r.at, lastPreview: previewOf({ type: m.type as ParsedMessage['type'], text: m.text }), lastFromMe: true, unread: 0, status: 'ABERTA' },
    })
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

  async sendText(user: AuthUser, id: string, raw: string) {
    const text = raw.replace(/\r\n/g, '\n').trim()
    if (!text) throw new BadRequestException('Escreva a mensagem.')
    if (text.length > 4000) throw new BadRequestException('Mensagem muito longa (máximo 4.000 caracteres).')
    const c = await this.sendContext(user, id)
    const body = c.number.signMessages ? signed(text, user.name) : text
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
    const text = cap ? (c.number.signMessages ? signed(cap, user.name) : cap) : null
    const base64 = file.buffer.toString('base64')
    const r =
      kind.kind === 'audio'
        ? await c.client.sendAudio(c.number.instanceName, c.target, base64).catch((e: unknown) => this.fail(e))
        : await c.client.sendMedia(c.number.instanceName, c.target, { mediatype: kind.kind, mimetype: kind.mime, base64, fileName, caption: text ?? undefined }).catch((e: unknown) => this.fail(e))
    const asset = await this.files.saveBuffer(c.conv.tenantId, 'whatsapp', file.buffer, kind.mime, kind.ext)
    const type = ({ image: 'imagem', video: 'video', audio: 'audio', document: 'documento' } as const)[kind.kind]
    return this.recordSent(user, c, r, { type, text: kind.kind === 'audio' ? null : text, fileId: asset.id, fileName, mime: kind.mime })
  }

  /** Números em que o usuário pode iniciar conversa (próprios: onde o vendedor dele atende; unidade: da unidade). */
  private async numbersForStart(user: AuthUser) {
    const s = this.scopeOf(user)
    const where: Prisma.WhatsappNumberWhereInput = { tenantId: user.tenantId, deletedAt: null }
    if (s === 'UNIT') where.unitId = user.unitId ?? '00000000-0000-0000-0000-000000000000'
    if (s === 'OWN') {
      const seller = await this.prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } })
      where.sellerIds = { has: seller?.id ?? '00000000-0000-0000-0000-000000000000' }
    }
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
    if (existing) {
      if (lead && !existing.leadId) await this.prisma.whatsappConversation.update({ where: { id: existing.id }, data: { leadId: lead.id } })
      return { id: existing.id }
    }
    const conv = await this.prisma.whatsappConversation.create({
      data: { tenantId: user.tenantId, numberId: number.id, jid, phone, name: lead?.name ?? null, leadId: lead?.id ?? null, lastMessageAt: new Date(), lastPreview: 'Conversa iniciada pelo CRM', lastFromMe: true },
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

  // ---------- Respostas rápidas ----------

  async quickReplies(user: AuthUser, convId?: string) {
    this.assertCan(user)
    const rows = await this.prisma.whatsappQuickReply.findMany({ where: { tenantId: user.tenantId }, orderBy: { title: 'asc' } })
    // Com a conversa, já devolve o texto com {nome} e {vendedor} trocados.
    let nome: string | null = null
    if (convId) {
      const c = await this.load(user, convId)
      nome = (c.leadId ? (await this.prisma.lead.findUnique({ where: { id: c.leadId }, select: { name: true } }))?.name : null) ?? c.name
    }
    return rows.map((r) => ({ id: r.id, title: r.title, text: r.text, preview: applyVariables(r.text, { nome, vendedor: user.name }) }))
  }

  async saveQuickReply(user: AuthUser, id: string | null, d: { title: string; text: string }) {
    this.assertAction(user, 'whatsapp', 'edit')
    const title = d.title.trim().slice(0, 60)
    const text = d.text.trim().slice(0, 2000)
    if (!title || !text) throw new BadRequestException('Preencha o título e o texto.')
    if (id) {
      const found = await this.prisma.whatsappQuickReply.findFirst({ where: { id, tenantId: user.tenantId } })
      if (!found) throw new NotFoundException('Resposta não encontrada.')
      return this.prisma.whatsappQuickReply.update({ where: { id }, data: { title, text } })
    }
    if ((await this.prisma.whatsappQuickReply.count({ where: { tenantId: user.tenantId } })) >= 100) throw new BadRequestException('Limite de 100 respostas rápidas.')
    return this.prisma.whatsappQuickReply.create({ data: { tenantId: user.tenantId, title, text } })
  }

  async removeQuickReply(user: AuthUser, id: string) {
    this.assertAction(user, 'whatsapp', 'edit')
    await this.prisma.whatsappQuickReply.deleteMany({ where: { id, tenantId: user.tenantId } })
    return { ok: true }
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
    const r = cleanRules(d)
    await this.settings.set(user.tenantId, 'whatsapp_regras', r)
    return r
  }

  async companyContacts(user: AuthUser, q: { search?: string; page?: number }) {
    this.assertAdmin(user, 'view')
    const s = q.search?.trim()
    const digits = s?.replace(/\D/g, '') ?? ''
    const where: Prisma.WhatsappContactWhereInput = {
      tenantId: user.tenantId,
      category: { not: 'CLIENTE' },
      ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ contactKey: { contains: digits } }] : [])] } : {}),
    }
    const page = Math.max(1, q.page ?? 1)
    const [total, rows] = await Promise.all([
      this.prisma.whatsappContact.count({ where }),
      this.prisma.whatsappContact.findMany({ where, orderBy: [{ name: 'asc' }, { contactKey: 'asc' }], skip: (page - 1) * 50, take: 50 }),
    ])
    return { total, page, items: rows.map((r) => ({ id: r.id, name: r.name, phone: r.contactKey.startsWith('+') ? r.contactKey : null, category: r.category, updatedAt: r.updatedAt })) }
  }

  /** Telefone da lista: celular/fixo do Brasil (com ou sem 55) ou internacional com +. */
  private contactPhone(raw: string) {
    const intl = raw.replace(/[^\d+]/g, '')
    return normalizePhone(raw) ?? (/^\+\d{10,15}$/.test(intl) ? intl : null)
  }

  /** Grava (ou atualiza) contatos da empresa e passa as conversas deles para o tipo novo. */
  private async upsertCompany(user: AuthUser, rows: { name: string | null; phone: string; category: CompanyCategory }[]) {
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
    const r = await this.upsertCompany(user, parsed.rows)
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
    const leadIds = [latest?.leadId, ...due.map((r) => r.conversation.leadId)].filter((x): x is string => !!x)
    const names = new Map((await this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]))
    const nameOf = (c: { name: string | null; phone: string | null; leadId: string | null }) => (c.leadId && names.get(c.leadId)) || c.name || c.phone || 'Contato'
    return {
      unreadConversations: count,
      unreadMessages: sum._sum.unread ?? 0,
      latest: latest ? { conversationId: latest.id, name: nameOf(latest), preview: latest.lastPreview, at: latest.lastMessageAt } : null,
      dueReminders: due.map((r) => ({ id: r.id, conversationId: r.conversationId, name: nameOf(r.conversation), note: r.note, dueAt: r.dueAt, notified: !!r.notifiedAt })),
      upcomingReminders: upcoming,
    }
  }

  /** O aviso do lembrete já apareceu (as outras abas não repetem). */
  async markReminderNotified(user: AuthUser, id: string) {
    await this.prisma.whatsappReminder.updateMany({ where: { id, userId: user.id, notifiedAt: null }, data: { notifiedAt: new Date() } })
    return { ok: true }
  }
}
