import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { CapturaService } from '../captura/captura.service'
import { can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { FilesService } from '../files/files.service'
import type { Prisma, WhatsappNumber } from '../generated/prisma/client'
import { LeadCaptureService } from '../leads/lead-capture.service'
import { PrismaService } from '../prisma/prisma.service'
import type { EvolutionClient } from './evolution'
import { extOf, MEDIA_MAX_BYTES, parseMessage, type ParsedMessage, phoneFromDigits, phoneVariants, previewOf } from './mensagens'

/** Depois de 7 dias sem conversa, a próxima mensagem do cliente abre um novo atendimento no Pré-Vendas. */
const NEW_CONTACT_AFTER_MS = 7 * 86_400_000
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly capture: LeadCaptureService,
    private readonly captura: CapturaService,
  ) {}

  // ---------- Recebimento ----------

  ingest(n: WhatsappNumber, data: unknown, client: EvolutionClient | null) {
    const p = parseMessage(data)
    if (!p) return Promise.resolve()
    const key = `${n.id}:${p.jid}`
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
    let conv = await this.prisma.whatsappConversation.findUnique({ where: { numberId_jid: { numberId: n.id, jid: p.jid } } })
    const idle = !conv?.lastMessageAt || p.at.getTime() - conv.lastMessageAt.getTime() > NEW_CONTACT_AFTER_MS
    conv ??= await this.prisma.whatsappConversation.create({ data: { tenantId: n.tenantId, numberId: n.id, jid: p.jid, phone, name: p.pushName } })

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

    // Lead: pelo telefone (com e sem o 9); contato novo que chamou vira lead e atendimento no Pré-Vendas.
    let leadId = conv.leadId
    let recordId = conv.recordId
    // Telefone como está no lead já cadastrado (com ou sem o 9), para a captura não criar outro lead.
    let leadPhone = phone
    if (phone) {
      const lead = await this.prisma.lead.findFirst({
        where: { tenantId: n.tenantId, deletedAt: null, anonymizedAt: null, ...(leadId ? { id: leadId } : { phone: { in: phoneVariants(phone) } }) },
        orderBy: { createdAt: 'asc' },
        select: { id: true, phone: true },
      })
      if (lead) {
        leadId = lead.id
        leadPhone = lead.phone ?? phone
      }
    }
    if (!p.fromMe && idle && phone && n.createRecords) {
      const ownerId = n.sellerIds.length === 1 ? n.sellerIds[0]! : null
      const originName = `WhatsApp - ${n.name}`.slice(0, 80)
      const channel = `WhatsApp "${n.name}"`
      const r = await this.capture.capture(
        n.tenantId,
        { name: p.pushName, phone: leadPhone },
        { title: `Chamou no WhatsApp (${n.name})`, originName, touch: { source: 'whatsapp', medium: 'mensagem', conversao: channel }, details: { canal: 'whatsapp', numero: n.name, mensagem: previewOf(p) }, ownerId, tags: ['whatsapp'], occurredAt: p.at },
      )
      if (r) {
        leadId = r.leadId
        recordId = await this.captura.preVendas(n.tenantId, r.leadId, { name: p.pushName, email: null, phone: leadPhone, city: null, state: null }, channel, originName, ownerId, p.text, {}, null, [])
      }
    }

    const later = !conv.lastMessageAt || p.at >= conv.lastMessageAt
    await this.prisma.whatsappConversation.update({
      where: { id: conv.id },
      data: {
        leadId,
        recordId,
        ...(phone && !conv.phone ? { phone } : {}),
        ...(p.pushName && !conv.name ? { name: p.pushName } : {}),
        ...(later ? { lastMessageAt: p.at, lastPreview: previewOf(p), lastFromMe: p.fromMe } : {}),
        // Resposta pelo celular zera as não lidas (alguém já está atendendo).
        ...(p.fromMe ? { unread: 0 } : { unread: { increment: 1 }, status: 'ABERTA' }),
      },
    })
    if (p.media && !tooBig && client) void this.downloadMedia(n, saved[0]!.id, p, client)
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
  private async where(user: AuthUser): Promise<Prisma.WhatsappConversationWhereInput> {
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

  async conversations(user: AuthUser, q: { numberId?: string; unread?: boolean; search?: string; page?: number }) {
    this.assertCan(user)
    const scope = await this.where(user)
    const and: Prisma.WhatsappConversationWhereInput[] = [scope, { lastMessageAt: { not: null } }]
    if (q.numberId) and.push({ numberId: q.numberId })
    if (q.unread) and.push({ unread: { gt: 0 } })
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
      this.prisma.whatsappMessage.findMany({ where: { conversationId: id, ...(beforeDate ? { sentAt: { lt: beforeDate } } : {}) }, orderBy: { sentAt: 'desc' }, take: PAGE + 1 }),
      this.prisma.whatsappNumber.findUnique({ where: { id: conv.numberId }, select: { id: true, name: true, phone: true, status: true } }),
      conv.leadId ? this.prisma.lead.findUnique({ where: { id: conv.leadId }, select: { id: true, name: true, email: true, phone: true, adsLastCampaign: true, adsLastCampaignId: true } }) : null,
      conv.recordId ? this.prisma.serviceRecord.findUnique({ where: { id: conv.recordId }, select: { id: true, kind: true, leadAt: true, saleStatus: true, adsVia: true, adsCampaign: true, adsCampaignId: true, entryChannel: true } }) : null,
    ])
    if (conv.unread > 0 && !beforeDate) await this.prisma.whatsappConversation.update({ where: { id }, data: { unread: 0 } })
    const more = rows.length > PAGE
    return {
      conversation: { id: conv.id, name: lead?.name || conv.name, phone: conv.phone, jid: conv.jid, status: conv.status },
      number,
      lead,
      record,
      hasMore: more,
      messages: rows
        .slice(0, PAGE)
        .reverse()
        .map((m) => ({ id: m.id, fromMe: m.fromMe, type: m.type, text: m.text, fileName: m.fileName, mime: m.mime, mediaStatus: m.mediaStatus, hasFile: !!m.fileId, sentAt: m.sentAt })),
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
}
