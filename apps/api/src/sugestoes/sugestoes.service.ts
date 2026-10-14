import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { can, MODULES } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { FilesService } from '../files/files.service'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import { cleanText, STATUS_LABEL, SUGGESTION_STATUS, type SuggestionStatus } from './sugestoes'

const PAGE = 30
const AREAS = new Set<string>(MODULES.map((m) => m.key))

/** Sugestões de melhoria: qualquer usuário envia e acompanha as suas; quem tem a permissão "Sugestões" analisa e responde. */
@Injectable()
export class SugestoesService {
  private readonly logger = new Logger(SugestoesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  canManage(user: AuthUser, action: 'view' | 'edit' = 'view') {
    return can(user.permissions, user.role.isSystem, 'sugestoes', action)
  }

  private view(s: Prisma.SuggestionGetPayload<object>, manager: boolean) {
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      area: s.area,
      imageUrl: s.imageFileId ? `/api/files/${s.imageFileId}` : null,
      status: s.status as SuggestionStatus,
      reply: s.reply,
      repliedByName: s.repliedByName,
      repliedAt: s.repliedAt,
      unread: s.unreadByAuthor,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      ...(manager ? { userName: s.userName, userId: s.userId } : {}),
    }
  }

  async create(user: AuthUser, d: { title: string; description: string; area?: string | null }, image: Express.Multer.File | undefined, ctx: RequestCtx) {
    const title = cleanText(d.title, 120)
    const description = cleanText(d.description, 4000, true)
    if (title.length < 3) throw new BadRequestException('Dê um título curto para a sugestão.')
    if (description.length < 5) throw new BadRequestException('Descreva a sugestão: o que mudar e por quê.')
    const area = d.area && AREAS.has(d.area) ? d.area : null
    // Muitas sugestões seguidas da mesma pessoa: limite simples contra envio repetido.
    const recent = await this.prisma.suggestion.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })
    if (recent >= 20) throw new BadRequestException('Você enviou muitas sugestões na última hora. Tente de novo mais tarde.')
    const asset = image ? await this.files.saveImage(user.tenantId, 'sugestao', image, false, { maxBytes: 3 * 1024 * 1024 }) : null
    const s = await this.prisma.suggestion.create({ data: { tenantId: user.tenantId, userId: user.id, userName: user.name.slice(0, 120), title, description, area, imageFileId: asset?.id ?? null } })
    await this.audit.byUser(user, ctx, 'sugestao.enviada', 'suggestion', s.id, { titulo: title })
    return this.view(s, this.canManage(user))
  }

  /** Minhas sugestões (quem enviou) ou todas (quem analisa). */
  async list(user: AuthUser, q: { all?: boolean; status?: string; search?: string; page?: number }) {
    const manager = !!q.all
    if (manager && !this.canManage(user)) throw new ForbiddenException('Você não tem permissão para ver as sugestões de todos.')
    const and: Prisma.SuggestionWhereInput[] = [{ tenantId: user.tenantId }]
    if (!manager) and.push({ userId: user.id })
    if (q.status && (SUGGESTION_STATUS as readonly string[]).includes(q.status)) and.push({ status: q.status })
    const term = q.search?.trim()
    if (term) and.push({ OR: [{ title: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }, ...(manager ? [{ userName: { contains: term, mode: 'insensitive' as const } }] : [])] })
    const page = Math.max(1, q.page ?? 1)
    const where = { AND: and }
    const [total, rows, byStatus] = await Promise.all([
      this.prisma.suggestion.count({ where }),
      this.prisma.suggestion.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * PAGE, take: PAGE }),
      this.prisma.suggestion.groupBy({ by: ['status'], where: { tenantId: user.tenantId, ...(manager ? {} : { userId: user.id }) }, _count: { _all: true } }),
    ])
    return {
      total,
      page,
      pageSize: PAGE,
      counts: Object.fromEntries(SUGGESTION_STATUS.map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])),
      items: rows.map((r) => this.view(r, manager)),
    }
  }

  /** Quem enviou abriu a sugestão: a resposta deixa de ser novidade. */
  async markSeen(user: AuthUser, id: string) {
    await this.prisma.suggestion.updateMany({ where: { id, userId: user.id, tenantId: user.tenantId, unreadByAuthor: true }, data: { unreadByAuthor: false } })
    return { ok: true }
  }

  /** Análise: muda a situação e/ou responde. Quem enviou é avisado no menu e por e-mail. */
  async answer(user: AuthUser, id: string, d: { status?: string; reply?: string | null }, ctx: RequestCtx) {
    if (!this.canManage(user, 'edit')) throw new ForbiddenException('Você não tem permissão para responder sugestões.')
    const cur = await this.prisma.suggestion.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!cur) throw new NotFoundException('Sugestão não encontrada.')
    const status = d.status && (SUGGESTION_STATUS as readonly string[]).includes(d.status) ? d.status : cur.status
    const reply = d.reply === undefined ? cur.reply : cleanText(d.reply, 4000, true) || null
    const replyChanged = reply !== cur.reply
    if (status === cur.status && !replyChanged) return this.view(cur, true)
    const s = await this.prisma.suggestion.update({
      where: { id },
      data: { status, reply, unreadByAuthor: cur.userId !== user.id, ...(replyChanged ? { repliedById: user.id, repliedByName: user.name.slice(0, 120), repliedAt: new Date() } : {}) },
    })
    await this.audit.byUser(user, ctx, 'sugestao.respondida', 'suggestion', id, { situacao: status, respondeu: replyChanged })
    if (cur.userId !== user.id) void this.notify(s).catch((err: unknown) => this.logger.warn(`Aviso de sugestão não enviado: ${(err as Error).message}`))
    return this.view(s, true)
  }

  private async notify(s: Prisma.SuggestionGetPayload<object>) {
    const author = await this.prisma.user.findUnique({ where: { id: s.userId }, select: { email: true, name: true, active: true } })
    if (!author?.active) return
    const branding = await this.settings.branding(s.tenantId)
    const label = STATUS_LABEL[s.status as SuggestionStatus] ?? s.status
    const link = `${env.appUrl}/sugestoes`
    const body = `Sua sugestão “${s.title}” está agora como: ${label}.${s.reply ? ` Resposta: ${s.reply}` : ''}`
    await this.mail.send(s.tenantId, {
      to: author.email,
      subject: `Sua sugestão foi atualizada - ${branding.appName}`,
      text: `Olá, ${author.name}.\n\n${body}\n\n${link}`,
      html: this.mail.simpleTemplate(branding, { title: 'Sua sugestão foi atualizada', greeting: `Olá, ${author.name}.`, body, buttonLabel: 'Ver minhas sugestões', buttonUrl: link, footnote: 'Obrigado por ajudar a melhorar o sistema.' }),
    })
  }

  /** Avisos do menu: respostas novas para mim e, para quem analisa, sugestões novas. */
  async alerts(user: AuthUser) {
    const [mine, fresh] = await Promise.all([
      this.prisma.suggestion.count({ where: { tenantId: user.tenantId, userId: user.id, unreadByAuthor: true } }),
      this.canManage(user) ? this.prisma.suggestion.count({ where: { tenantId: user.tenantId, status: 'NOVA' } }) : Promise.resolve(0),
    ])
    return { unreadReplies: mine, newSuggestions: fresh }
  }
}
