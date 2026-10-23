import { createHmac } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { LEAD_REGION_LABEL, LEAD_REGIONS } from '../atendimento/br'
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
import { EMAIL_IMAGE_LIMIT, FilesService } from '../files/files.service'
import { MagazordService } from '../integracoes/magazord.service'
import { MailService } from '../settings/mail.service'
import { publicBranding, SettingsService } from '../settings/settings.service'
import { type Block, type Brand, type CartContent, type CartVar, cleanBlocks, collectLinks, renderEmail, cleanSocial, SOCIAL_LABEL, SOCIAL_NETWORKS, type SocialLinks, socialUrl, topColors } from './blocos'
import { backoffMinutes, batchSize, isTemporary, isTemporaryText, MAX_TEMP_TRIES } from './limite'

export interface EmailSettings {
  /** Nome do remetente das campanhas (vazio = o do SMTP). */
  fromName: string
  replyTo: string
  /** Endereço/dados da empresa no rodapé de todo e-mail. */
  footerText: string
  /** Envios por minuto (protege a reputação do domínio e o servidor). */
  ratePerMinute: number
  /** Logo próprio dos e-mails (fundo branco); vazio = o logo do sistema. */
  logoFileId: string | null
  /** Redes sociais da empresa (Facebook, Instagram, YouTube, TikTok). */
  social: SocialLinks
  /** Ícones das redes no rodapé de todo e-mail. */
  socialInFooter: boolean
}

export const DEFAULT_EMAIL: EmailSettings = { fromName: '', replyTo: '', footerText: '', ratePerMinute: 60, logoFileId: null, social: {}, socialInFooter: true }

const fileUrl = (id: string) => `${env.appUrl}/api/files/public/${id}`

export interface CampaignInput {
  name: string
  subject: string
  preheader?: string | null
  fromName?: string | null
  replyTo?: string | null
  blocks: unknown
  /** Cupom do e-mail ({cupom} no texto), criado à mão na Magazord. */
  coupon?: string | null
  segmentId?: string | null
  /** Só na criação: CAMPANHA (padrão) ou MODELO (usado pelas automações). */
  kind?: 'CAMPANHA' | 'MODELO'
}

const TICK_MS = 15_000
const EDITABLE: CampaignStatus[] = ['RASCUNHO', 'AGENDADA', 'PAUSADA']
const BOUNCE = /\b(550|551|553|554)\b|user unknown|unknown user|no such user|mailbox (unavailable|not found)|does not exist|inexistente/i
/** GIF transparente de 1x1 (pixel de abertura). */
export const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

/** Pré-visualização e teste: o link de um carrinho de exemplo (no envio da automação vem o do cliente). */
const sampleVars = (coupon: string | null | undefined): Partial<Record<CartVar, string>> => ({ cupom: coupon?.trim().toUpperCase() ?? '', link_carrinho: 'https://www.exemplo.com.br/carrinho' })

@Injectable()
export class EmailService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false
  /** Campanha recusada temporariamente pelo servidor (4xx): espera até "until" e envia mais devagar (nível). */
  private readonly backoff = new Map<string, { until: number; level: number }>()
  /** Recusas temporárias de cada destinatário (depois de MAX_TEMP_TRIES vira "não entregue"). */
  private readonly tempTries = new Map<string, number>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly leads: LeadsService,
    private readonly scoring: LeadConfigService,
    private readonly tracking: RastreamentoService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly magazord: MagazordService,
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

  /** Configurações com o endereço do logo dos e-mails (o próprio ou o do sistema). */
  async configView(tenantId: string) {
    const [cfg, brand] = await Promise.all([this.config(tenantId), this.brand(tenantId)])
    return { ...cfg, logoUrl: brand.logoUrl, ownLogo: !!cfg.logoFileId }
  }

  async saveConfig(user: AuthUser, d: Omit<EmailSettings, 'logoFileId' | 'social' | 'socialInFooter'> & { social?: Record<string, string>; socialInFooter?: boolean }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const current = await this.config(user.tenantId)
    const raw = (d.social ?? {}) as Record<string, unknown>
    for (const n of SOCIAL_NETWORKS) {
      if (typeof raw[n] === 'string' && (raw[n] as string).trim() && !socialUrl(n, raw[n] as string)) throw new BadRequestException(`Endereço do ${SOCIAL_LABEL[n]} inválido. Use o link da página (ex.: https://www.${n}.com/usaparts).`)
    }
    const next = { fromName: d.fromName.trim(), replyTo: d.replyTo.trim(), footerText: d.footerText.trim(), ratePerMinute: d.ratePerMinute, logoFileId: current.logoFileId, social: cleanSocial(raw), socialInFooter: d.socialInFooter ?? current.socialInFooter ?? true }
    await this.settings.set(user.tenantId, 'email_marketing', next)
    await this.audit.byUser(user, ctx, 'email.settings_updated', 'settings', 'email_marketing', next)
    return this.configView(user.tenantId)
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

  /** Segmentos prontos por região (Norte, Nordeste, Centro-Oeste, Sudeste, Sul e Internacional); não duplica os que já existem. */
  async createRegionSegments(user: AuthUser, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const existing = await this.prisma.emailSegment.findMany({ where: { tenantId: user.tenantId }, select: { name: true, filters: true } })
    const has = (r: string) => existing.some((s) => (s.filters as { region?: string } | null)?.region === r && Object.keys(s.filters as object).length === 1)
    const created: string[] = []
    for (const r of LEAD_REGIONS) {
      if (has(r)) continue
      const name = r === 'INTERNACIONAL' ? 'Internacional (fora do Brasil)' : `Região ${LEAD_REGION_LABEL[r]}`
      await this.prisma.emailSegment.create({ data: { tenantId: user.tenantId, name, filters: { region: r } } })
      created.push(name)
    }
    if (created.length) await this.audit.byUser(user, ctx, 'email.segments_regions', 'email_segment', undefined, { criados: created })
    return { created }
  }

  async removeSegment(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const r = await this.prisma.emailSegment.deleteMany({ where: { id, tenantId: user.tenantId } })
    if (!r.count) throw new NotFoundException('Segmento não encontrado.')
    await this.audit.byUser(user, ctx, 'email.segment_deleted', 'email_segment', id)
  }

  // ---------- Campanhas ----------

  async listCampaigns(user: AuthUser, kind: 'CAMPANHA' | 'MODELO' = 'CAMPANHA') {
    this.assertCan(user, 'view')
    const rows = await this.prisma.emailCampaign.findMany({ where: { tenantId: user.tenantId, kind }, orderBy: { createdAt: 'desc' }, take: 200, include: { segment: { select: { name: true } } } })
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
    const current = id ? await this.load(user, id) : null
    if (current && !EDITABLE.includes(current.status)) throw new BadRequestException('Campanha em envio ou já enviada não pode ser alterada. Duplique para criar outra.')
    const kind = current?.kind ?? (d.kind === 'MODELO' ? 'MODELO' : 'CAMPANHA')
    // Modelo: links só são acrescentados (e-mails já enviados apontam para o índice do link).
    const links = kind === 'MODELO' ? [...new Set([...(current?.links ?? []), ...collectLinks(checked.blocks)])] : undefined
    const data = {
      name: d.name.trim(),
      subject: d.subject.trim(),
      preheader: d.preheader?.trim() || null,
      fromName: d.fromName?.trim() || null,
      replyTo: d.replyTo?.trim() || null,
      coupon: d.coupon?.trim().toUpperCase() || null,
      blocks: checked.blocks as unknown as Prisma.InputJsonValue,
      segmentId: kind === 'MODELO' ? null : (d.segmentId ?? null),
      ...(links ? { links } : {}),
    }
    const c = id ? await this.prisma.emailCampaign.update({ where: { id }, data }) : await this.prisma.emailCampaign.create({ data: { ...data, kind, tenantId: user.tenantId, createdById: user.id } })
    await this.audit.byUser(user, ctx, id ? 'email.campaign_updated' : 'email.campaign_created', 'email_campaign', c.id, { nome: data.name })
    const { tenantId: _t, ...rest } = c
    return rest
  }

  /**
   * Duplica o e-mail, escolhendo o destino: campanha (envio para um segmento) ou modelo de fluxo (automações).
   * Serve também para corrigir um e-mail criado no lugar errado, sem refazer.
   */
  async duplicate(user: AuthUser, id: string, ctx: RequestCtx, as?: 'CAMPANHA' | 'MODELO') {
    this.assertCan(user, 'create')
    const c = await this.load(user, id)
    const kind = as ?? c.kind
    // Modelo guarda os links (para contar os cliques de cada envio); campanha não usa segmento de modelo.
    const links = kind === 'MODELO' ? [...new Set([...(c.kind === 'MODELO' ? c.links : []), ...collectLinks(c.blocks as unknown as Block[])])] : []
    const copy = await this.prisma.emailCampaign.create({
      data: { tenantId: user.tenantId, name: `${c.name} (cópia)`.slice(0, 120), subject: c.subject, preheader: c.preheader, fromName: c.fromName, replyTo: c.replyTo, coupon: c.coupon, blocks: c.blocks as Prisma.InputJsonValue, segmentId: kind === 'MODELO' ? null : c.segmentId, kind, links, createdById: user.id },
    })
    await this.audit.byUser(user, ctx, 'email.campaign_duplicated', 'email_campaign', copy.id, { origem: id, como: kind === 'MODELO' ? 'modelo de fluxo' : 'campanha' })
    return { id: copy.id, kind }
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const c = await this.load(user, id)
    if (c.status !== 'RASCUNHO') throw new BadRequestException('Só rascunhos podem ser excluídos. Campanhas enviadas ficam no histórico.')
    if (c.kind === 'MODELO') {
      const used = await this.prisma.$queryRaw<{ name: string }[]>`SELECT name FROM automations WHERE "tenantId" = ${user.tenantId}::uuid AND steps::text LIKE ${`%${id}%`} LIMIT 3`
      if (used.length) throw new BadRequestException(`Este modelo está na automação “${used.map((u) => u.name).join('”, “')}”. Tire ele do fluxo antes de excluir.`)
      if (await this.prisma.emailRecipient.count({ where: { campaignId: id } })) throw new BadRequestException('Este modelo já foi enviado por automações e fica no histórico.')
    }
    await this.prisma.emailCampaign.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'email.campaign_deleted', 'email_campaign', id, { nome: c.name })
  }

  // ---------- Logo, imagens, produtos e WhatsApp do editor ----------

  async uploadLogo(user: AuthUser, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const asset = await this.files.saveImage(user.tenantId, 'email-logo', file, true, { types: ['png', 'jpg', 'gif', 'webp'] })
    const current = await this.config(user.tenantId)
    await this.settings.set(user.tenantId, 'email_marketing', { ...current, logoFileId: asset.id })
    await this.audit.byUser(user, ctx, 'email.logo_updated', 'settings', 'email_marketing', { fileId: asset.id })
    return this.configView(user.tenantId)
  }

  async removeLogo(user: AuthUser, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const current = await this.config(user.tenantId)
    // O arquivo fica: e-mails já enviados continuam mostrando o logo.
    await this.settings.set(user.tenantId, 'email_marketing', { ...current, logoFileId: null })
    await this.audit.byUser(user, ctx, 'email.logo_removed', 'settings', 'email_marketing')
    return this.configView(user.tenantId)
  }

  async listImages(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.fileAsset.findMany({ where: { tenantId: user.tenantId, kind: 'email-image' }, orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, size: true, createdAt: true } })
    return rows.map((r) => ({ ...r, url: fileUrl(r.id) }))
  }

  async uploadImage(user: AuthUser, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const asset = await this.files.saveImage(user.tenantId, 'email-image', file, true, { maxBytes: EMAIL_IMAGE_LIMIT, types: ['png', 'jpg', 'gif', 'webp'] })
    await this.audit.byUser(user, ctx, 'email.image_uploaded', 'file', asset.id, { tamanho: asset.size })
    return { id: asset.id, size: asset.size, createdAt: asset.createdAt, url: fileUrl(asset.id) }
  }

  /** Só apaga imagem que nenhuma campanha usa (e-mails enviados precisam continuar mostrando). */
  async removeImage(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const asset = await this.prisma.fileAsset.findFirst({ where: { id, tenantId: user.tenantId, kind: 'email-image' } })
    if (!asset) throw new NotFoundException('Imagem não encontrada.')
    const used = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM email_campaigns WHERE "tenantId" = ${user.tenantId}::uuid AND blocks::text LIKE ${`%${id}%`}`
    if (Number(used[0]?.n ?? 0) > 0) throw new BadRequestException('Esta imagem está em uma campanha. Tire ela das campanhas antes de apagar (as já enviadas precisam dela).')
    await this.files.remove(id)
    await this.audit.byUser(user, ctx, 'email.image_deleted', 'file', id)
  }

  /** Busca no catálogo da loja (copiado da Magazord). */
  async searchProducts(user: AuthUser, q: string, page: number) {
    this.assertCan(user, 'view')
    const term = q.trim()
    const where: Prisma.StoreProductWhereInput = {
      tenantId: user.tenantId,
      active: true,
      ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { code: { contains: term, mode: 'insensitive' } }, { brand: { contains: term, mode: 'insensitive' } }] } : {}),
    }
    const size = 24
    const [rows, total, mz, state] = await Promise.all([
      this.prisma.storeProduct.findMany({ where, orderBy: [{ stock: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }], skip: (page - 1) * size, take: size }),
      this.prisma.storeProduct.count({ where }),
      this.magazord.config(user.tenantId),
      this.magazord.state(user.tenantId),
    ])
    return {
      items: rows.map((p) => ({ id: p.id, code: p.code, name: p.name, brand: p.brand, price: p.price?.toNumber() ?? null, priceFrom: p.priceFrom?.toNumber() ?? null, stock: p.stock, image: p.image, url: p.url })),
      total,
      page,
      pageSize: size,
      catalog: {
        enabled: mz.enabled && mz.importProducts,
        updating: this.magazord.productsUpdating(user.tenantId),
        syncedAt: state.productsSyncedAt ?? null,
        error: state.productsError ?? null,
      },
    }
  }

  async refreshProducts(user: AuthUser, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const r = await this.magazord.refreshProducts(user.tenantId)
    if (!r.started) throw new BadRequestException(r.reason)
    await this.audit.byUser(user, ctx, 'email.catalog_refresh', 'settings', 'magazord')
    return { ok: true }
  }

  /** Cores mais usadas nas últimas campanhas e modelos (paleta do editor). */
  async usedColors(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.emailCampaign.findMany({ where: { tenantId: user.tenantId }, orderBy: { updatedAt: 'desc' }, take: 200, select: { blocks: true } })
    return topColors(rows.map((r) => r.blocks))
  }

  /** Números de WhatsApp já cadastrados na Captura, para escolher no botão do e-mail. */
  async whatsappNumbers(user: AuthUser) {
    this.assertCan(user, 'view')
    return this.prisma.captureWhatsapp.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }], select: { id: true, name: true, phone: true, message: true } })
  }

  // ---------- Montagem ----------

  private async brand(tenantId: string): Promise<Brand> {
    const [b, cfg] = await Promise.all([this.settings.branding(tenantId), this.config(tenantId)])
    const pub = publicBranding(b)
    const logoUrl = cfg.logoFileId ? fileUrl(cfg.logoFileId) : pub.logoUrl ? `${env.appUrl}${pub.logoUrl}` : null
    return { appName: b.appName, color: b.brandColor || b.primaryColor, logoUrl, footerText: cfg.footerText, social: cfg.social ?? {}, socialInFooter: cfg.socialInFooter ?? true, iconBase: `${env.appUrl}/api/public/e/icones` }
  }

  /** Pré-visualização com os dados de quem está editando (nada é rastreado). */
  async preview(user: AuthUser, d: { subject: string; preheader?: string | null; blocks: unknown; coupon?: string | null }) {
    this.assertCan(user, 'view')
    const checked = cleanBlocks(d.blocks)
    if ('error' in checked) throw new BadRequestException(checked.error)
    const r = renderEmail(checked.blocks, { brand: await this.brand(user.tenantId), subject: d.subject || '(sem assunto)', preheader: d.preheader, person: { name: user.name, email: user.email, vars: sampleVars(d.coupon) }, unsubscribeUrl: `${env.appUrl}/descadastro/exemplo`, cart: 'exemplo' })
    return { html: r.html, subject: r.subject }
  }

  /** Envio de teste para um endereço (assunto com [TESTE], sem rastreamento e sem contar na campanha). */
  async sendTest(user: AuthUser, id: string, to: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const c = await this.load(user, id)
    const [smtp, cfg, brand] = await Promise.all([this.settings.smtp(user.tenantId), this.config(user.tenantId), this.brand(user.tenantId)])
    const r = renderEmail(c.blocks as unknown as Block[], { brand, subject: c.subject, preheader: c.preheader, person: { name: user.name, email: to, vars: sampleVars(c.coupon) }, unsubscribeUrl: `${env.appUrl}/descadastro/exemplo`, cart: 'exemplo' })
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
    if (c.kind === 'MODELO') throw new BadRequestException('Modelos são enviados pelas automações, não para um segmento.')
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
      for (const c of await this.prisma.emailCampaign.findMany({ where: { status: 'ENVIANDO' }, orderBy: { startedAt: 'asc' } })) {
        // Servidor pediu para ir devagar: espera o tempo combinado antes do próximo lote.
        if ((this.backoff.get(c.id)?.until ?? 0) > Date.now()) continue
        await this.sendBatch(c)
      }
    } catch (err) {
      this.logger.error(`E-mail marketing: ${(err as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  private async sendBatch(c: Prisma.EmailCampaignGetPayload<object>) {
    const [cfg, smtpCfg] = await Promise.all([this.config(c.tenantId), this.settings.smtp(c.tenantId)])
    const slow = this.backoff.get(c.id)
    const size = batchSize(cfg.ratePerMinute, smtpCfg.maxPerMinute, slow?.level ?? 0, 60_000 / TICK_MS)
    let refused = false
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
          await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ERRO', failedAt: new Date(), error: 'Sem consentimento no momento do envio.' } })
          continue
        }
        const token = this.token(r.id)
        const unsub = `${env.appUrl}/descadastro/${this.leads.unsubscribeToken(r.leadId)}?c=${c.id}`
        const out = renderEmail(c.blocks as unknown as Block[], {
          brand,
          subject: c.subject,
          preheader: c.preheader,
          person: { name: r.lead.name, email: r.email, vars: { cupom: c.coupon ?? '' } },
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
          await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ENVIADO', sentAt: new Date(), error: null } })
          this.tempTries.delete(r.id)
        } catch (err) {
          const e = err as { message?: string; response?: string; responseCode?: number }
          const msg = `${e.responseCode ?? ''} ${e.response ?? e.message ?? 'erro'}`.trim().slice(0, 300)
          // Falha de conexão: para o lote e tenta de novo no próximo ciclo (o destinatário continua pendente).
          if (!e.responseCode) {
            this.logger.warn(`Campanha ${c.id.slice(0, 8)}: falha no servidor de e-mail, nova tentativa em instantes (${msg}).`)
            break
          }
          // Recusa temporária (4xx: "slow down", fila cheia): o destinatário continua na fila, a campanha espera e vai mais devagar.
          if (isTemporary(e.responseCode)) {
            const tries = (this.tempTries.get(r.id) ?? 0) + 1
            this.tempTries.set(r.id, tries)
            if (tries < MAX_TEMP_TRIES) {
              const level = (slow?.level ?? 0) + 1
              this.backoff.set(c.id, { until: Date.now() + backoffMinutes(level) * 60_000, level })
              await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { error: `Tentando de novo: ${msg}`.slice(0, 300) } })
              this.logger.warn(`Campanha ${c.id.slice(0, 8)}: servidor de e-mail pediu para esperar (${msg}). Nova tentativa em ${backoffMinutes(level)} min, mais devagar.`)
              refused = true
              break
            }
            this.tempTries.delete(r.id)
            await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ERRO', failedAt: new Date(), error: `${msg} (recusado ${MAX_TEMP_TRIES} vezes)`.slice(0, 300) } })
            continue
          }
          await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ERRO', failedAt: new Date(), error: msg } })
          if (BOUNCE.test(msg)) await this.prisma.lead.update({ where: { id: r.leadId }, data: { emailBouncedAt: new Date() } })
        }
      }
      // Lote inteiro aceito: volta um passo para o ritmo normal.
      if (!refused && slow) {
        if (slow.level <= 1) this.backoff.delete(c.id)
        else this.backoff.set(c.id, { until: 0, level: slow.level - 1 })
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

  // ---------- Envio por automação ----------

  /**
   * Envia um modelo para um lead (passo "Enviar e-mail" das automações), com rastreamento de abertura e clique.
   * `tentar_depois`: servidor de e-mail fora do ar; o fluxo tenta de novo no próximo ciclo.
   */
  /** O que o modelo usa do carrinho abandonado: o bloco de produtos do carrinho e as variáveis de cupom e link. */
  async templateUses(tenantId: string, templateId: string) {
    const tpl = await this.prisma.emailCampaign.findFirst({ where: { id: templateId, tenantId, kind: 'MODELO' }, select: { blocks: true, subject: true, preheader: true } })
    const all = JSON.stringify([tpl?.blocks ?? [], tpl?.subject ?? '', tpl?.preheader ?? ''])
    return { cart: all.includes('"type":"carrinho"'), link: all.includes('{link_carrinho}') }
  }

  async sendAutomationEmail(a: { tenantId: string; templateId: string; leadId: string; runId: string; automationId: string; automationName: string; cart?: CartContent | null; vars?: Partial<Record<CartVar, string>> }): Promise<{ status: 'enviado' | 'pulado' | 'erro' | 'tentar_depois'; message: string; recipientId?: string }> {
    const tpl = await this.prisma.emailCampaign.findFirst({ where: { id: a.templateId, tenantId: a.tenantId, kind: 'MODELO' } })
    if (!tpl) return { status: 'erro', message: 'O modelo de e-mail foi excluído.' }
    const lead = await this.prisma.lead.findFirst({ where: { id: a.leadId, tenantId: a.tenantId }, select: { name: true, email: true, emailOptIn: true, emailBouncedAt: true, anonymizedAt: true, deletedAt: true } })
    if (!lead?.email) return { status: 'pulado', message: 'Lead sem e-mail.' }
    if (!lead.emailOptIn) return { status: 'pulado', message: 'Lead sem consentimento para e-mail (LGPD) ou descadastrado.' }
    if (lead.emailBouncedAt) return { status: 'pulado', message: 'E-mail do lead já foi recusado antes.' }
    if (lead.anonymizedAt || lead.deletedAt) return { status: 'pulado', message: 'Lead excluído.' }
    if (await this.prisma.emailRecipient.count({ where: { campaignId: tpl.id, runId: a.runId } })) return { status: 'pulado', message: 'Este e-mail já foi enviado nesta passagem pelo fluxo.' }
    const [smtp, cfg, brand] = await Promise.all([this.settings.smtp(a.tenantId), this.config(a.tenantId), this.brand(a.tenantId)])
    if (!smtp.host || !smtp.fromEmail) return { status: 'tentar_depois', message: 'Servidor de e-mail (SMTP) não configurado.' }

    const r = await this.prisma.emailRecipient.create({ data: { campaignId: tpl.id, leadId: a.leadId, email: lead.email, runId: a.runId } })
    const token = this.token(r.id)
    const unsubToken = this.leads.unsubscribeToken(a.leadId)
    const out = renderEmail(tpl.blocks as unknown as Block[], {
      brand,
      subject: tpl.subject,
      preheader: tpl.preheader,
      person: { name: lead.name, email: lead.email, vars: { cupom: tpl.coupon ?? '', ...a.vars } },
      unsubscribeUrl: `${env.appUrl}/descadastro/${unsubToken}?c=${tpl.id}`,
      trackLink: (_u, i) => `${env.appUrl}/api/public/e/l/${token}/${i}`,
      openPixelUrl: `${env.appUrl}/api/public/e/a/${token}`,
      linkList: tpl.links,
      cart: a.cart ?? null,
    })
    const transport = await this.mail.transport({ ...smtp })
    try {
      await transport.sendMail({
        from: { name: tpl.fromName || cfg.fromName || smtp.fromName || brand.appName, address: smtp.fromEmail },
        replyTo: tpl.replyTo || cfg.replyTo || smtp.replyTo || undefined,
        to: lead.email,
        subject: out.subject,
        html: out.html,
        text: out.text,
        headers: { 'List-Unsubscribe': `<${env.appUrl}/api/public/descadastro/${unsubToken}?c=${tpl.id}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      })
    } catch (err) {
      const e = err as { message?: string; response?: string; responseCode?: number }
      const msg = `${e.responseCode ?? ''} ${e.response ?? e.message ?? 'erro'}`.trim().slice(0, 300)
      if (!e.responseCode || isTemporary(e.responseCode)) {
        await this.prisma.emailRecipient.delete({ where: { id: r.id } })
        return { status: 'tentar_depois', message: e.responseCode ? `Servidor de e-mail pediu para tentar depois (${msg}).` : `Servidor de e-mail indisponível (${msg}).` }
      }
      await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ERRO', failedAt: new Date(), error: msg } })
      await this.prisma.emailCampaign.update({ where: { id: tpl.id }, data: { failed: { increment: 1 } } })
      if (BOUNCE.test(msg)) await this.prisma.lead.update({ where: { id: a.leadId }, data: { emailBouncedAt: new Date() } })
      return { status: 'erro', message: `E-mail recusado: ${msg}` }
    } finally {
      transport.close()
    }
    await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'ENVIADO', sentAt: new Date() } })
    await this.prisma.emailCampaign.update({ where: { id: tpl.id }, data: { sent: { increment: 1 }, total: { increment: 1 } } })
    await this.prisma.leadEvent.create({
      data: { tenantId: a.tenantId, leadId: a.leadId, type: 'email_enviado', title: `Recebeu o e-mail "${tpl.name}" (automação "${a.automationName}")`.slice(0, 300), data: { campanha: tpl.id, automacao: a.automationId } },
    })
    return { status: 'enviado', message: `E-mail "${tpl.name}" enviado para ${lead.email}.`, recipientId: r.id }
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

  /**
   * Volta para a fila os destinatários marcados como "não entregue" por recusa temporária (4xx), como
   * "you are sending too many mails, slow down" ou "queue file write error". A campanha volta a enviar, devagar.
   */
  async retryTemporary(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const c = await this.load(user, id)
    if (c.kind !== 'CAMPANHA') throw new BadRequestException('Só campanhas podem ser reenviadas.')
    if (c.status === 'CANCELADA') throw new BadRequestException('A campanha foi cancelada.')
    const where = { campaignId: id, status: 'ERRO' as const, error: { startsWith: '4' } }
    const ids = (await this.prisma.emailRecipient.findMany({ where, select: { id: true, error: true } })).filter((r) => isTemporaryText(r.error)).map((r) => r.id)
    if (!ids.length) return { requeued: 0 }
    await this.prisma.emailRecipient.updateMany({ where: { id: { in: ids } }, data: { status: 'PENDENTE', failedAt: null, error: null } })
    const failed = await this.prisma.emailRecipient.count({ where: { campaignId: id, status: 'ERRO' } })
    // Recomeça devagar: metade do ritmo até o servidor aceitar um lote inteiro.
    this.backoff.set(id, { until: 0, level: 1 })
    await this.prisma.emailCampaign.update({ where: { id }, data: { failed, ...(c.status === 'ENVIADA' ? { status: 'ENVIANDO', finishedAt: null } : {}) } })
    await this.audit.byUser(user, ctx, 'email.campaign_retry_temporary', 'email_campaign', id, { reenviados: ids.length })
    if (c.status !== 'PAUSADA') void this.tick()
    return { requeued: ids.length }
  }

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
      /** "Não entregues" por recusa temporária do servidor (4xx): dá para tentar de novo. */
      temporaryFailed: (await this.prisma.emailRecipient.findMany({ where: { campaignId: id, status: 'ERRO', error: { startsWith: '4' } }, select: { error: true } })).filter((x) => isTemporaryText(x.error)).length,
      /** Esperando o servidor de e-mail liberar (recusa temporária): minutos até a próxima tentativa. */
      waitingMinutes: (() => {
        const b = this.backoff.get(id)
        return b && b.until > Date.now() ? Math.ceil((b.until - Date.now()) / 60_000) : 0
      })(),
      links: c.links.map((url, i) => ({ url, clicks: byLink.find((b) => b.linkIndex === i)?._count._all ?? 0 })).sort((a, b) => b.clicks - a.clicks),
      recipients: recent,
    }
  }
}
