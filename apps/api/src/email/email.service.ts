import { createHmac } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { safeEqual } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import type { CampaignStatus, Prisma } from '../generated/prisma/client'
import { LeadConfigService } from '../leads/lead-config.service'
import { type LeadFilters, LeadsService } from '../leads/leads.service'
import { PrismaService } from '../prisma/prisma.service'
import { domainAllowed } from '../rastreamento/origem'
import { RastreamentoService } from '../rastreamento/rastreamento.service'
import { MailService } from '../settings/mail.service'
import { publicBranding, SettingsService } from '../settings/settings.service'
import { type Block, type Brand, cleanBlocks, collectLinks, renderEmail } from './blocos'

export interface EmailSettings {
  /** Nome do remetente das campanhas (vazio = o do SMTP). */
  fromName: string
  replyTo: string
  /** Endereço/dados da empresa no rodapé de todo e-mail. */
  footerText: string
  /** Envios por minuto (protege a reputação do domínio e o servidor). */
  ratePerMinute: number
}

export const DEFAULT_EMAIL: EmailSettings = { fromName: '', replyTo: '', footerText: '', ratePerMinute: 60 }

export interface CampaignInput {
  name: string
  subject: string
  preheader?: string | null
  fromName?: string | null
  replyTo?: string | null
  blocks: unknown
  segmentId?: string | null
}

const TICK_MS = 15_000
const EDITABLE: CampaignStatus[] = ['RASCUNHO', 'AGENDADA', 'PAUSADA']
const BOUNCE = /\b(550|551|553|554)\b|user unknown|unknown user|no such user|mailbox (unavailable|not found)|does not exist|inexistente/i
/** GIF transparente de 1x1 (pixel de abertura). */
export const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

@Injectable()
export class EmailService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly leads: LeadsService,
    private readonly scoring: LeadConfigService,
    private readonly tracking: RastreamentoService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'email_marketing', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  config(tenantId: string) {
    return this.settings.get(tenantId, 'email_marketing', DEFAULT_EMAIL)
  }

  async saveConfig(user: AuthUser, d: EmailSettings, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const next = { fromName: d.fromName.trim(), replyTo: d.replyTo.trim(), footerText: d.footerText.trim(), ratePerMinute: d.ratePerMinute }
    await this.settings.set(user.tenantId, 'email_marketing', next)
    await this.audit.byUser(user, ctx, 'email.settings_updated', 'settings', 'email_marketing', next)
    return next
  }

  // ---------- Público (segmentos) ----------

  /**
   * Quem pode receber: leads do filtro com e-mail, consentimento (LGPD), sem descadastro, sem e-mail recusado,
   * sem dados apagados. O escopo do perfil de quem envia também vale.
   */
  private audienceWhere(user: AuthUser, filters: LeadFilters): Prisma.LeadWhereInput {
    return { AND: [this.leads.where(user, filters), { email: { not: null }, emailOptIn: true, emailBouncedAt: null, anonymizedAt: null }] }
  }

  async audienceCount(user: AuthUser, filters: LeadFilters) {
    this.assertCan(user, 'view')
    const [eligible, total] = await Promise.all([this.prisma.lead.count({ where: this.audienceWhere(user, filters) }), this.prisma.lead.count({ where: this.leads.where(user, filters) })])
    return { eligible, total }
  }

  async listSegments(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.emailSegment.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' } })
    return Promise.all(rows.map(async ({ tenantId: _t, ...s }) => ({ ...s, eligible: await this.prisma.lead.count({ where: this.audienceWhere(user, s.filters as LeadFilters) }) })))
  }

  async saveSegment(user: AuthUser, id: string | null, d: { name: string; filters: LeadFilters }, ctx: RequestCtx) {
    this.assertCan(user, id ? 'edit' : 'create')
    if (id && !(await this.prisma.emailSegment.count({ where: { id, tenantId: user.tenantId } }))) throw new NotFoundException('Segmento não encontrado.')
    const data = { name: d.name.trim(), filters: d.filters as unknown as Prisma.InputJsonValue }
    const seg = id ? await this.prisma.emailSegment.update({ where: { id }, data }) : await this.prisma.emailSegment.create({ data: { ...data, tenantId: user.tenantId } })
    await this.audit.byUser(user, ctx, id ? 'email.segment_updated' : 'email.segment_created', 'email_segment', seg.id, { nome: data.name })
    const { tenantId: _t, ...rest } = seg
    return rest
  }

  async removeSegment(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const r = await this.prisma.emailSegment.deleteMany({ where: { id, tenantId: user.tenantId } })
    if (!r.count) throw new NotFoundException('Segmento não encontrado.')
    await this.audit.byUser(user, ctx, 'email.segment_deleted', 'email_segment', id)
  }

  // ---------- Campanhas ----------

  async listCampaigns(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.emailCampaign.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 200, include: { segment: { select: { name: true } } } })
    return rows.map(({ tenantId: _t, blocks: _b, ...c }) => c)
  }

  private async load(user: AuthUser, id: string) {
    const c = await this.prisma.emailCampaign.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!c) throw new NotFoundException('Campanha não encontrada.')
    return c
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const { tenantId: _t, ...c } = await this.load(user, id)
    return c
  }

  async save(user: AuthUser, id: string | null, d: CampaignInput, ctx: RequestCtx) {
    this.assertCan(user, id ? 'edit' : 'create')
    const checked = cleanBlocks(d.blocks)
    if ('error' in checked) throw new BadRequestException(checked.error)
    if (d.segmentId && !(await this.prisma.emailSegment.count({ where: { id: d.segmentId, tenantId: user.tenantId } }))) throw new BadRequestException('Segmento inválido.')
    if (id) {
      const current = await this.load(user, id)
      if (!EDITABLE.includes(current.status)) throw new BadRequestException('Campanha em envio ou já enviada não pode ser alterada. Duplique para criar outra.')
    }
    const data = {
      name: d.name.trim(),
      subject: d.subject.trim(),
      preheader: d.preheader?.trim() || null,
      fromName: d.fromName?.trim() || null,
      replyTo: d.replyTo?.trim() || null,
      blocks: checked.blocks as unknown as Prisma.InputJsonValue,
      segmentId: d.segmentId ?? null,
    }
    const c = id ? await this.prisma.emailCampaign.update({ where: { id }, data }) : await this.prisma.emailCampaign.create({ data: { ...data, tenantId: user.tenantId, createdById: user.id } })
    await this.audit.byUser(user, ctx, id ? 'email.campaign_updated' : 'email.campaign_created', 'email_campaign', c.id, { nome: data.name })
    const { tenantId: _t, ...rest } = c
    return rest
  }

  async duplicate(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const c = await this.load(user, id)
    const copy = await this.prisma.emailCampaign.create({
      data: { tenantId: user.tenantId, name: `${c.name} (cópia)`.slice(0, 120), subject: c.subject, preheader: c.preheader, fromName: c.fromName, replyTo: c.replyTo, blocks: c.blocks as Prisma.InputJsonValue, segmentId: c.segmentId, createdById: user.id },
    })
    await this.audit.byUser(user, ctx, 'email.campaign_duplicated', 'email_campaign', copy.id, { origem: id })
    return { id: copy.id }
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const c = await this.load(user, id)
    if (c.status !== 'RASCUNHO') throw new BadRequestException('Só rascunhos podem ser excluídos. Campanhas enviadas ficam no histórico.')
    await this.prisma.emailCampaign.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'email.campaign_deleted', 'email_campaign', id, { nome: c.name })
  }

  // ---------- Montagem ----------

  private async brand(tenantId: string): Promise<Brand> {
    const [b, cfg] = await Promise.all([this.settings.branding(tenantId), this.config(tenantId)])
    const pub = publicBranding(b)
    return { appName: b.appName, color: b.primaryColor, logoUrl: pub.logoUrl ? `${env.appUrl}${pub.logoUrl}` : null, footerText: cfg.footerText }
  }

  /** Pré-visualização com os dados de quem está editando (nada é rastreado). */
  async preview(user: AuthUser, d: { subject: string; preheader?: string | null; blocks: unknown }) {
    this.assertCan(user, 'view')
    const checked = cleanBlocks(d.blocks)
    if ('error' in checked) throw new BadRequestException(checked.error)
    const r = renderEmail(checked.blocks, { brand: await this.brand(user.tenantId), subject: d.subject || '(sem assunto)', preheader: d.preheader, person: { name: user.name, email: user.email }, unsubscribeUrl: `${env.appUrl}/descadastro/exemplo` })
    return { html: r.html, subject: r.subject }
  }

  /** Envio de teste para um endereço (assunto com [TESTE], sem rastreamento e sem contar na campanha). */
  async sendTest(user: AuthUser, id: string, to: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const c = await this.load(user, id)
    const [smtp, cfg, brand] = await Promise.all([this.settings.smtp(user.tenantId), this.config(user.tenantId), this.brand(user.tenantId)])
    const r = renderEmail(c.blocks as unknown as Block[], { brand, subject: c.subject, preheader: c.preheader, person: { name: user.name, email: to }, unsubscribeUrl: `${env.appUrl}/descadastro/exemplo` })
    await this.mail.sendWith(
      { ...smtp, fromName: c.fromName || cfg.fromName || smtp.fromName, replyTo: c.replyTo || cfg.replyTo || smtp.replyTo },
      { to, subject: `[TESTE] ${r.subject}`, html: r.html, text: r.text },
    )
    await this.audit.byUser(user, ctx, 'email.campaign_test_sent', 'email_campaign', id, { para: to })
    return { ok: true }
  }

  // ---------- Envio ----------

  /** Confirma o público e começa (ou agenda) o envio. Os destinatários são fixados agora. */
  async start(user: AuthUser, id: string, scheduledAt: Date | null, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const c = await this.load(user, id)
    if (c.status !== 'RASCUNHO' && c.status !== 'AGENDADA') throw new BadRequestException('Esta campanha já foi enviada ou está em envio.')
    if (!c.segmentId) throw new BadRequestException('Escolha o segmento (público) da campanha.')
    if (!c.subject.trim()) throw new BadRequestException('Informe o assunto.')
    const blocks = c.blocks as unknown as Block[]
    if (!blocks.length) throw new BadRequestException('O e-mail está vazio.')
    const smtp = await this.settings.smtp(user.tenantId)
    if (!smtp.host || !smtp.fromEmail) throw new BadRequestException('Configure o servidor de e-mail em Configurações → E-mail (SMTP) antes de enviar.')
    const seg = await this.prisma.emailSegment.findFirstOrThrow({ where: { id: c.segmentId, tenantId: user.tenantId } })

    const leads = await this.prisma.lead.findMany({ where: this.audienceWhere(user, seg.filters as LeadFilters), select: { id: true, email: true } })
    if (!leads.length) throw new BadRequestException('Nenhum lead do segmento pode receber e-mail (é preciso ter e-mail e consentimento).')
    await this.prisma.emailRecipient.deleteMany({ where: { campaignId: id } })
    for (let i = 0; i < leads.length; i += 1000) {
      await this.prisma.emailRecipient.createMany({ data: leads.slice(i, i + 1000).map((l) => ({ campaignId: id, leadId: l.id, email: l.email! })), skipDuplicates: true })
    }
    const future = scheduledAt && scheduledAt.getTime() > Date.now() + 60_000
    await this.prisma.emailCampaign.update({
      where: { id },
      data: { status: future ? 'AGENDADA' : 'ENVIANDO', scheduledAt: future ? scheduledAt : null, startedAt: future ? null : new Date(), total: leads.length, sent: 0, failed: 0, links: collectLinks(blocks) },
    })
    await this.audit.byUser(user, ctx, future ? 'email.campaign_scheduled' : 'email.campaign_started', 'email_campaign', id, { destinatarios: leads.length, agendadaPara: future ? scheduledAt : null })
    if (!future) void this.tick()
    return { total: leads.length, status: future ? 'AGENDADA' : 'ENVIANDO' }
  }

  async setStatus(user: AuthUser, id: string, action: 'pausar' | 'retomar' | 'cancelar', ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const c = await this.load(user, id)
    const next: Record<typeof action, { from: CampaignStatus[]; to: CampaignStatus }> = {
      pausar: { from: ['ENVIANDO', 'AGENDADA'], to: 'PAUSADA' },
      retomar: { from: ['PAUSADA'], to: 'ENVIANDO' },
      cancelar: { from: ['ENVIANDO', 'AGENDADA', 'PAUSADA'], to: 'CANCELADA' },
    }
    if (!next[action].from.includes(c.status)) throw new BadRequestException('Ação não disponível para a situação atual da campanha.')
    await this.prisma.emailCampaign.update({ where: { id }, data: { status: next[action].to, ...(action === 'cancelar' ? { finishedAt: new Date() } : {}), ...(action === 'retomar' && !c.startedAt ? { startedAt: new Date() } : {}) } })
    await this.audit.byUser(user, ctx, `email.campaign_${action}`, 'email_campaign', id)
    if (action === 'retomar') void this.tick()
    return { ok: true }
  }

  /** A cada 15 s: libera as agendadas que venceram e envia o próximo lote de cada campanha em envio. */
  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      await this.prisma.emailCampaign.updateMany({ where: { status: 'AGENDADA', scheduledAt: { lte: new Date() } }, data: { status: 'ENVIANDO', startedAt: new Date() } })
      for (const c of await this.prisma.emailCampaign.findMany({ where: { status: 'ENVIANDO' }, orderBy: { startedAt: 'asc' } })) await this.sendBatch(c)
    } catch (err) {
      this.logger.error(`E-mail marketing: ${(err as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  private async sendBatch(c: Prisma.EmailCampaignGetPayload<object>) {
    const cfg = await this.config(c.tenantId)
    const size = Math.max(1, Math.ceil((cfg.ratePerMinute || 60) / (60_000 / TICK_MS)))
    const batch = await this.prisma.emailRecipient.findMany({ where: { campaignId: c.id, status: 'PENDENTE' }, take: size, include: { lead: { select: { name: true, emailOptIn: true, anonymizedAt: true, deletedAt: true } } } })
    if (!batch.length) {
      await this.prisma.emailCampaign.update({ where: { id: c.id }, data: { status: 'ENVIADA', finishedAt: new Date() } })
      this.logger.log(`Campanha ${c.id.slice(0, 8)} concluída.`)
      return
    }
    const [smtp, brand] = await Promise.all([this.settings.smtp(c.tenantId), this.brand(c.tenantId)])
    const transport = await this.mail.transport({ ...smtp })
    const from = { name: c.fromName || cfg.fromName || smtp.fromName || brand.appName, address: smtp.fromEmail }
    const replyTo = c.replyTo || cfg.replyTo || smtp.replyTo || undefined
    try {
      for (const r of batch) {
        // Descadastrou ou teve os dados apagados depois que a campanha começou: não envia.
        if (!r.lead.emailOptIn || r.lead.anonymizedAt || r.lead.deletedAt) {
          await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ERRO', error: 'Sem consentimento no momento do envio.' } })
          continue
        }
        const token = this.token(r.id)
        const unsub = `${env.appUrl}/descadastro/${this.leads.unsubscribeToken(r.leadId)}?c=${c.id}`
        const out = renderEmail(c.blocks as unknown as Block[], {
          brand,
          subject: c.subject,
          preheader: c.preheader,
          person: { name: r.lead.name, email: r.email },
          unsubscribeUrl: unsub,
          trackLink: (_u, i) => `${env.appUrl}/api/public/e/l/${token}/${i}`,
          openPixelUrl: `${env.appUrl}/api/public/e/a/${token}`,
        })
        try {
          await transport.sendMail({
            from,
            replyTo,
            to: r.email,
            subject: out.subject,
            html: out.html,
            text: out.text,
            headers: {
              // Descadastro em 1 clique direto no Gmail/Outlook (RFC 8058).
              'List-Unsubscribe': `<${env.appUrl}/api/public/descadastro/${this.leads.unsubscribeToken(r.leadId)}?c=${c.id}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          })
          await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ENVIADO', sentAt: new Date() } })
        } catch (err) {
          const e = err as { message?: string; response?: string; responseCode?: number }
          const msg = `${e.responseCode ?? ''} ${e.response ?? e.message ?? 'erro'}`.trim().slice(0, 300)
          // Falha de conexão: para o lote e tenta de novo no próximo ciclo (o destinatário continua pendente).
          if (!e.responseCode) {
            this.logger.warn(`Campanha ${c.id.slice(0, 8)}: falha no servidor de e-mail, nova tentativa em instantes (${msg}).`)
            break
          }
          await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ERRO', error: msg } })
          if (BOUNCE.test(msg)) await this.prisma.lead.update({ where: { id: r.leadId }, data: { emailBouncedAt: new Date() } })
        }
      }
    } finally {
      transport.close()
      const [sent, failed] = await Promise.all([
        this.prisma.emailRecipient.count({ where: { campaignId: c.id, status: 'ENVIADO' } }),
        this.prisma.emailRecipient.count({ where: { campaignId: c.id, status: 'ERRO' } }),
      ])
      await this.prisma.emailCampaign.update({ where: { id: c.id }, data: { sent, failed } })
    }
  }

  // ---------- Rastreamento (público) ----------

  private key() {
    return createHmac('sha256', env.jwtAccessSecret).update('email-v1').digest()
  }

  token(recipientId: string) {
    const sig = createHmac('sha256', this.key()).update(recipientId).digest('base64url').slice(0, 22)
    return `${Buffer.from(recipientId).toString('base64url')}.${sig}`
  }

  private recipientFrom(token: string) {
    const [enc, sig] = token.split('.')
    if (!enc || !sig || token.length > 120) return null
    const id = Buffer.from(enc, 'base64url').toString('utf8')
    if (!/^[0-9a-f-]{36}$/.test(id)) return null
    return safeEqual(sig, createHmac('sha256', this.key()).update(id).digest('base64url').slice(0, 22)) ? id : null
  }

  /** Abertura: primeira vez entra na linha do tempo do lead e conta no lead scoring. */
  async open(token: string) {
    const id = this.recipientFrom(token)
    if (!id) return
    const r = await this.prisma.emailRecipient.findUnique({ where: { id }, include: { campaign: { select: { id: true, tenantId: true, name: true } } } })
    if (!r) return
    await this.prisma.emailRecipient.update({ where: { id }, data: { opens: { increment: 1 }, openedAt: r.openedAt ?? new Date() } })
    if (r.openedAt) return
    await this.prisma.emailCampaign.update({ where: { id: r.campaign.id }, data: { opens: { increment: 1 } } })
    await this.prisma.leadEvent.create({ data: { tenantId: r.campaign.tenantId, leadId: r.leadId, type: 'email_aberto', title: `Abriu o e-mail "${r.campaign.name}"`, data: { campanha: r.campaign.id } } })
    await this.scoring.rescore(r.campaign.tenantId, [r.leadId])
  }

  /** Clique: registra e devolve o endereço do link (só os links da própria campanha, nunca um endereço livre). */
  async click(token: string, index: number): Promise<string | null> {
    const id = this.recipientFrom(token)
    if (!id || !Number.isInteger(index) || index < 0) return null
    const r = await this.prisma.emailRecipient.findUnique({ where: { id }, include: { campaign: { select: { id: true, tenantId: true, name: true, links: true } } } })
    const target = r?.campaign.links[index]
    if (!r || !target) return null
    await this.prisma.emailClick.create({ data: { recipientId: id, campaignId: r.campaign.id, linkIndex: index } })
    await this.prisma.emailRecipient.update({ where: { id }, data: { clicks: { increment: 1 }, clickedAt: r.clickedAt ?? new Date(), openedAt: r.openedAt ?? new Date() } })
    if (!r.clickedAt) {
      await this.prisma.emailCampaign.update({ where: { id: r.campaign.id }, data: { clicks: { increment: 1 }, ...(r.openedAt ? {} : { opens: { increment: 1 } }) } })
      await this.prisma.leadEvent.create({ data: { tenantId: r.campaign.tenantId, leadId: r.leadId, type: 'email_clique', title: `Clicou no e-mail "${r.campaign.name}"`, data: { campanha: r.campaign.id, link: target } } })
      await this.scoring.rescore(r.campaign.tenantId, [r.leadId])
    }
    // Link para o site: leva o identificador do lead, para o rastreamento ligar a visita a ele.
    try {
      const tr = await this.tracking.config(r.campaign.tenantId)
      const u = new URL(target)
      if (tr.enabled && domainAllowed(u.hostname, tr.domains)) {
        u.searchParams.set('crm_lid', this.tracking.leadToken(r.leadId))
        return u.toString()
      }
    } catch {
      /* link sem URL válida: segue o original */
    }
    return target
  }

  // ---------- Relatório ----------

  async report(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const c = await this.load(user, id)
    const [byLink, recent] = await Promise.all([
      this.prisma.emailClick.groupBy({ by: ['linkIndex'], where: { campaignId: id }, _count: { _all: true } }),
      this.prisma.emailRecipient.findMany({
        where: { campaignId: id, OR: [{ clickedAt: { not: null } }, { status: 'ERRO' }, { unsubscribedAt: { not: null } }] },
        orderBy: { sentAt: 'desc' },
        take: 100,
        select: { id: true, email: true, leadId: true, status: true, error: true, openedAt: true, clickedAt: true, clicks: true, unsubscribedAt: true },
      }),
    ])
    return {
      total: c.total,
      sent: c.sent,
      failed: c.failed,
      opens: c.opens,
      clicks: c.clicks,
      unsubscribes: c.unsubscribes,
      pending: await this.prisma.emailRecipient.count({ where: { campaignId: id, status: 'PENDENTE' } }),
      links: c.links.map((url, i) => ({ url, clicks: byLink.find((b) => b.linkIndex === i)?._count._all ?? 0 })).sort((a, b) => b.clicks - a.clicks),
      recipients: recent,
    }
  }
}
