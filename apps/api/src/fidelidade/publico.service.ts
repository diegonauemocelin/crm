import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { createHmac, randomInt } from 'node:crypto'
import { normalizePhone } from '../atendimento/br'
import { AuditService } from '../audit/audit.service'
import { PushService } from '../app-movel/push.service'
import { safeEqual } from '../common/crypto'
import { env } from '../config/env'
import type { Prisma } from '../generated/prisma/client'
import { TenantService } from '../prisma/prisma.module'
import { publicBranding } from '../settings/settings.service'
import { phoneVariants } from '../whatsapp/mensagens'
import { emailHtml } from './email'
import { FidelidadeService } from './fidelidade.service'
import { cleanReview, fill, firstName, isDetractor, levelRank, maskEmail, maskPhone, parseContact, signToken, verifyToken } from './regras'

const SESSION_HOURS = 12
const CODE_MINUTES = 10
const MAX_CODES_PER_WINDOW = 3
const MAX_ATTEMPTS = 5
const DAY_MS = 86_400_000
const GENERIC_SENT = 'Se encontrarmos o seu cadastro no programa, você vai receber um código de acesso em instantes.'
const GENERIC_FAIL = 'Código inválido ou vencido. Peça um novo código.'

interface Session {
  tenantId: string
  leadId: string
}

/**
 * Página do cliente (Meus pontos), sem senha: o cliente entra pelo link assinado (e-mail/WhatsApp) ou pedindo um
 * código de 6 dígitos. As respostas nunca dizem se o e-mail/telefone existe (sem enumeração de clientes), e cada
 * rota pública tem limite de tentativas. Só os dados do próprio cliente aparecem.
 */
@Injectable()
export class FidelidadePublicoService {
  private readonly logger = new Logger('FidelidadePublico')

  constructor(
    private readonly fid: FidelidadeService,
    private readonly tenants: TenantService,
    private readonly audit: AuditService,
    private readonly push: PushService,
  ) {}

  private get prisma() {
    return this.fid.prisma
  }

  async publicConfig() {
    const tenantId = await this.tenants.defaultId()
    const cfg = await this.fid.config(tenantId)
    const brand = publicBranding(await this.fid.settings.branding(tenantId))
    return {
      enabled: cfg.enabled,
      company: brand.shortName,
      logoUrl: brand.logoUrl,
      color: cfg.page.color || brand.brandColor || brand.primaryColor,
      title: cfg.page.title,
      intro: cfg.page.intro,
      rules: cfg.page.rules,
      consent: cfg.page.consent,
      loginEmail: cfg.loginEmail,
      loginWhatsapp: cfg.loginWhatsapp && !!cfg.loginNumberId,
      levels: cfg.levels.map((l) => ({ name: l.name, min: l.min, benefits: l.benefits, color: l.color })),
      levelBasis: cfg.levelBasis,
    }
  }

  // ---------- Acesso ----------

  private sessionToken(tenantId: string, leadId: string, epoch: number) {
    return signToken({ t: tenantId, l: leadId, v: epoch, k: 'sessao', e: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 }, this.fid.key())
  }

  /** Cliente do token (sessão). Token de outra empresa, vencido, de antes da saída do programa: recusado. */
  private async session(auth: string | undefined): Promise<Session & { member: { id: string; tokenEpoch: number; consentAt: Date | null } }> {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    const p = token ? verifyToken(token, this.fid.key()) : null
    const tenantId = await this.tenants.defaultId()
    if (!p || p.k !== 'sessao' || p.t !== tenantId) throw new UnauthorizedException('Sua sessão terminou. Entre de novo.')
    const member = await this.prisma.loyaltyMember.findUnique({ where: { leadId: p.l }, select: { id: true, tenantId: true, tokenEpoch: true, optOutAt: true, consentAt: true, lead: { select: { deletedAt: true, anonymizedAt: true } } } })
    if (!member || member.tenantId !== tenantId || member.tokenEpoch !== p.v || member.optOutAt || member.lead.deletedAt || member.lead.anonymizedAt) throw new UnauthorizedException('Sua sessão terminou. Entre de novo.')
    return { tenantId, leadId: p.l, member }
  }

  /** Link do e-mail/WhatsApp: vira uma sessão de 12 horas (o link em si não fica guardado no navegador). */
  async exchange(token: string, ip: string | null) {
    const p = verifyToken(token, this.fid.key())
    const tenantId = await this.tenants.defaultId()
    if (!p || p.k !== 'link' || p.t !== tenantId) throw new UnauthorizedException('Este link venceu ou não é válido. Peça um código de acesso abaixo.')
    const member = await this.prisma.loyaltyMember.findUnique({ where: { leadId: p.l }, select: { tenantId: true, tokenEpoch: true, optOutAt: true, lead: { select: { deletedAt: true, anonymizedAt: true } } } })
    if (!member || member.tenantId !== tenantId || member.tokenEpoch !== p.v || member.optOutAt || member.lead.deletedAt || member.lead.anonymizedAt) throw new UnauthorizedException('Este link venceu ou não é válido. Peça um código de acesso abaixo.')
    await this.prisma.loyaltyMember.update({ where: { leadId: p.l }, data: { lastAccessAt: new Date() } })
    await this.audit.log({ tenantId, action: 'fidelidade.cliente_entrou', entity: 'lead', entityId: p.l, ip, data: { por: 'link' } })
    return { token: this.sessionToken(tenantId, p.l, member.tokenEpoch) }
  }

  private async leadByContact(tenantId: string, contact: string) {
    const c = parseContact(contact)
    if (!c) return null
    const base = { tenantId, deletedAt: null, anonymizedAt: null, loyaltyMember: { is: { optOutAt: null } } } satisfies Prisma.LeadWhereInput
    if ('email' in c) {
      const lead = await this.prisma.lead.findFirst({ where: { ...base, email: { equals: c.email, mode: 'insensitive' } }, select: { id: true, name: true, email: true, phone: true } })
      return lead ? { lead, channel: 'email' as const } : null
    }
    const phone = normalizePhone(c.phone)
    if (!phone) return null
    const leads = await this.prisma.lead.findMany({ where: { ...base, phone: { in: phoneVariants(phone) } }, take: 5, select: { id: true, name: true, email: true, phone: true, loyaltyMember: { select: { balance: true } } } })
    // Mais de um cadastro com o mesmo telefone: o de maior saldo.
    const lead = leads.sort((a, b) => (b.loyaltyMember?.balance ?? 0) - (a.loyaltyMember?.balance ?? 0))[0]
    return lead ? { lead, channel: 'whatsapp' as const } : null
  }

  private codeHash(leadId: string, code: string) {
    return createHmac('sha256', this.fid.key()).update(`codigo:${leadId}:${code}`).digest('hex')
  }

  /** Pede um código de acesso. A resposta é sempre a mesma, exista ou não o cadastro. */
  async requestCode(contact: string, ip: string | null) {
    const tenantId = await this.tenants.defaultId()
    const cfg = await this.fid.config(tenantId)
    if (!cfg.enabled) throw new BadRequestException('O programa de fidelidade não está ativo.')
    const found = await this.leadByContact(tenantId, contact)
    if (!found) return { ok: true, message: GENERIC_SENT }
    const { lead, channel } = found
    if ((channel === 'email' && !cfg.loginEmail) || (channel === 'whatsapp' && (!cfg.loginWhatsapp || !cfg.loginNumberId))) return { ok: true, message: GENERIC_SENT }
    const recent = await this.prisma.loyaltyAccessCode.count({ where: { leadId: lead.id, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } })
    if (recent >= MAX_CODES_PER_WINDOW) return { ok: true, message: GENERIC_SENT }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await this.prisma.loyaltyAccessCode.create({ data: { tenantId, leadId: lead.id, codeHash: this.codeHash(lead.id, code), channel, expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000), ip } })
    const text = fill(cfg.messages.codeText, { codigo: code, nome: firstName(lead.name) })
    try {
      if (channel === 'email') {
        const brand = publicBranding(await this.fid.settings.branding(tenantId))
        await this.fid.mail.send(tenantId, { to: lead.email!, subject: `Seu código de acesso: ${code}`, text, html: emailHtml(brand, { title: cfg.page.title, body: text }) })
      } else {
        const number = await this.fid.numberFor(tenantId, cfg.loginNumberId)
        await this.fid.chat.sendAutomatic(number, lead.phone!, text, 'Fidelidade (código de acesso)', { leadId: lead.id, recordId: null, name: lead.name })
      }
    } catch (err) {
      // Falha no envio não muda a resposta (não revela que o cadastro existe).
      this.logger.warn(`Código de acesso não enviado: ${(err as Error).message}`)
    }
    await this.audit.log({ tenantId, action: 'fidelidade.codigo_pedido', entity: 'lead', entityId: lead.id, ip, data: { canal: channel } })
    return { ok: true, message: GENERIC_SENT }
  }

  async verifyCode(contact: string, codeIn: string, ip: string | null) {
    const tenantId = await this.tenants.defaultId()
    const code = (codeIn ?? '').replace(/\D/g, '')
    const found = code.length === 6 ? await this.leadByContact(tenantId, contact) : null
    if (!found) throw new BadRequestException(GENERIC_FAIL)
    const row = await this.prisma.loyaltyAccessCode.findFirst({ where: { leadId: found.lead.id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
    if (!row || row.attempts >= MAX_ATTEMPTS) throw new BadRequestException(GENERIC_FAIL)
    await this.prisma.loyaltyAccessCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    if (!safeEqual(row.codeHash, this.codeHash(found.lead.id, code))) throw new BadRequestException(GENERIC_FAIL)
    const used = await this.prisma.loyaltyAccessCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
    if (!used.count) throw new BadRequestException(GENERIC_FAIL)
    const member = await this.prisma.loyaltyMember.update({ where: { leadId: found.lead.id }, data: { lastAccessAt: new Date() }, select: { tokenEpoch: true } })
    await this.audit.log({ tenantId, action: 'fidelidade.cliente_entrou', entity: 'lead', entityId: found.lead.id, ip, data: { por: 'codigo' } })
    return { token: this.sessionToken(tenantId, found.lead.id, member.tokenEpoch) }
  }

  // ---------- Página do cliente ----------

  async me(auth: string | undefined) {
    const s = await this.session(auth)
    const lead = await this.prisma.lead.findUnique({ where: { id: s.leadId }, select: { name: true, email: true, phone: true } })
    const base = { name: firstName(lead?.name), email: maskEmail(lead?.email), phone: maskPhone(lead?.phone) }
    if (!s.member.consentAt) return { ...base, needsConsent: true as const }
    const cfg = await this.fid.config(s.tenantId)
    const sum = await this.fid.summary(s.tenantId, s.leadId, 50)
    const m = sum.member!
    const rank = m.level ? levelRank(m.level.key, cfg.levels) : 0
    const rewards = await this.prisma.loyaltyReward.findMany({ where: { tenantId: s.tenantId, active: true }, orderBy: [{ sort: 'asc' }, { pointsCost: 'asc' }] })
    const used = await this.prisma.loyaltyRedemption.groupBy({ by: ['rewardId'], where: { leadId: s.leadId, status: { not: 'CANCELADO' } }, _count: { _all: true } })
    const usedBy = new Map(used.map((u) => [u.rewardId, u._count._all]))
    const maxAge = Date.now() - cfg.review.maxAgeDays * DAY_MS
    return {
      ...base,
      needsConsent: false as const,
      balance: m.balance,
      level: m.level ? { name: m.level.name, color: m.level.color, benefits: m.level.benefits } : null,
      nextLevel: m.nextLevel ? { name: m.nextLevel.name, min: m.nextLevel.min } : null,
      levelValue: m.levelValue,
      missing: m.missing,
      expiring: m.expiring,
      ledger: sum.ledger.map((e) => ({ kind: e.kind, points: e.points, reason: e.reason, createdAt: e.createdAt, expiresAt: e.expiresAt })),
      rewards: rewards.map((r) => {
        const minRank = levelRank(r.minLevel, cfg.levels)
        const left = r.perCustomer !== null ? r.perCustomer - (usedBy.get(r.id) ?? 0) : null
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          kind: r.kind,
          pointsCost: r.pointsCost,
          discountType: r.discountType,
          value: r.value === null ? null : Number(r.value),
          minLevel: r.minLevel ? (cfg.levels.find((l) => l.key === r.minLevel)?.name ?? null) : null,
          locked: minRank > rank,
          available: r.kind !== 'BENEFICIO' && minRank <= rank && (r.stock === null || r.stock > 0) && (left === null || left > 0) && m.balance >= r.pointsCost,
          soldOut: r.stock !== null && r.stock <= 0,
        }
      }),
      redemptions: sum.redemptions.map((r) => ({ id: r.id, code: r.code, rewardName: r.rewardName, kind: r.kind, points: r.points, status: r.status, expiresAt: r.expiresAt, createdAt: r.createdAt, discountType: r.discountType, value: r.value })),
      toReview: cfg.review.enabled ? sum.orders.filter((o) => o.canReview && new Date(o.orderedAt).getTime() >= maxAge).map((o) => ({ orderId: o.orderId, code: o.code, orderedAt: o.orderedAt })) : [],
      reviewBonus: cfg.bonusReview,
      reviewAspects: cfg.review.aspects,
      levelRank: rank,
    }
  }

  async consent(auth: string | undefined, ip: string | null) {
    const s = await this.session(auth)
    const cfg = await this.fid.config(s.tenantId)
    if (!s.member.consentAt) {
      await this.prisma.$transaction([
        this.prisma.loyaltyMember.update({ where: { id: s.member.id }, data: { consentAt: new Date() } }),
        this.prisma.leadConsent.create({ data: { leadId: s.leadId, purpose: 'fidelidade', granted: true, source: 'página do programa de fidelidade', text: cfg.page.consent, ip } }),
      ])
      await this.audit.log({ tenantId: s.tenantId, action: 'fidelidade.consentimento', entity: 'lead', entityId: s.leadId, ip })
    }
    return { ok: true }
  }

  private async withConsent(auth: string | undefined) {
    const s = await this.session(auth)
    if (!s.member.consentAt) throw new BadRequestException('Aceite os termos do programa para continuar.')
    return s
  }

  async redeem(auth: string | undefined, rewardId: string) {
    const s = await this.withConsent(auth)
    const r = await this.fid.redeem(s.tenantId, s.leadId, rewardId, { source: 'PAGINA' })
    await this.fid.refreshLevel(s.tenantId, s.leadId, await this.fid.config(s.tenantId))
    return { code: r.redemption.code, rewardName: r.redemption.rewardName, kind: r.redemption.kind, expiresAt: r.redemption.expiresAt, balance: r.balance }
  }

  private async reviewable(s: Session, orderId: string) {
    const lo = await this.prisma.loyaltyOrder.findUnique({ where: { orderId }, include: { order: { select: { code: true, orderedAt: true, tenantId: true } } } })
    if (!lo || lo.leadId !== s.leadId || lo.tenantId !== s.tenantId) throw new NotFoundException('Pedido não encontrado.')
    return lo
  }

  async reviewInfo(auth: string | undefined, orderId: string) {
    const s = await this.withConsent(auth)
    const lo = await this.reviewable(s, orderId)
    const done = await this.prisma.loyaltyReview.findUnique({ where: { orderId }, select: { stars: true, nps: true, createdAt: true } })
    const cfg = await this.fid.config(s.tenantId)
    return { orderCode: lo.order.code, orderedAt: lo.order.orderedAt, reversed: !!lo.reversedAt, done, bonus: cfg.bonusReview, aspects: cfg.review.aspects }
  }

  async submitReview(auth: string | undefined, orderId: string, body: { stars?: unknown; nps?: unknown; comment?: unknown; aspects?: unknown }, ip: string | null) {
    const s = await this.withConsent(auth)
    const cfg = await this.fid.config(s.tenantId)
    if (!cfg.review.enabled) throw new BadRequestException('As avaliações estão desligadas no momento.')
    const lo = await this.reviewable(s, orderId)
    if (lo.reversedAt) throw new BadRequestException('Este pedido foi cancelado.')
    const r = cleanReview(body)
    if ('error' in r) throw new BadRequestException(r.error)
    const detractor = isDetractor(r, cfg.review)
    const review = await this.prisma.$transaction(async (tx) => {
      const m = await this.fid.lockMember(tx, s.tenantId, s.leadId)
      if (await tx.loyaltyReview.findUnique({ where: { orderId }, select: { id: true } })) throw new BadRequestException('Este pedido já foi avaliado. Obrigado!')
      const bonus = cfg.bonusReview > 0 ? await this.fid.credit(tx, m, { kind: 'BONUS', points: cfg.bonusReview, reason: `Avaliou o pedido ${lo.order.code}`, orderId, orderCode: lo.order.code, dedupeKey: `avaliacao:${orderId}` }, cfg) : null
      return tx.loyaltyReview.create({
        data: {
          tenantId: s.tenantId,
          leadId: s.leadId,
          orderId,
          orderCode: lo.order.code,
          stars: r.stars,
          nps: r.nps,
          comment: r.comment,
          aspects: (r.aspects ?? undefined) as Prisma.InputJsonValue | undefined,
          detractor,
          followUpStatus: detractor ? 'PENDENTE' : null,
          bonusPoints: bonus?.points ?? 0,
          ip,
        },
      })
    })
    await this.prisma.loyaltyOrder.update({ where: { id: lo.id }, data: { inviteStatus: lo.inviteStatus ?? 'AVALIADO' } })
    await this.fid.refreshLevel(s.tenantId, s.leadId, cfg)
    await this.prisma.leadEvent.create({
      data: { tenantId: s.tenantId, leadId: s.leadId, type: 'fidelidade', title: `Avaliou o pedido ${lo.order.code}: ${r.stars} estrela(s), nota ${r.nps}${detractor ? ' (detrator)' : ''}`.slice(0, 300), data: { avaliacao: review.id } },
    })
    if (detractor) await this.alertDetractor(s.tenantId, s.leadId, review.id, lo.order.code, r, cfg.review.alertUserIds, cfg.review.alertEmails)
    const promoter = r.nps >= 9 && r.stars >= 4 && !!cfg.review.googleReviewUrl
    return { ok: true, bonus: review.bonusPoints, thanks: cfg.messages.thanks, google: promoter ? { url: cfg.review.googleReviewUrl, text: cfg.messages.googleText } : null }
  }

  /** Nota baixa: avisa a equipe escolhida no celular (app) e por e-mail; a avaliação fica em Detratores até ser tratada. */
  private async alertDetractor(tenantId: string, leadId: string, reviewId: string, orderCode: string, r: { stars: number; nps: number; comment: string | null }, userIds: string[], emails: string[]) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { name: true } })
    const who = lead?.name ?? 'Cliente'
    const body = `${who}, pedido ${orderCode}: ${r.stars} estrela(s), nota ${r.nps}.${r.comment ? ` “${r.comment.slice(0, 140)}”` : ''}`
    await this.push.notify(tenantId, userIds, { title: 'Avaliação baixa na Fidelidade', body, url: '/fidelidade?aba=avaliacoes', tag: `fid-${reviewId}` }).catch(() => 0)
    if (emails.length) {
      const brand = publicBranding(await this.fid.settings.branding(tenantId))
      const url = `${env.appUrl}/fidelidade?aba=avaliacoes`
      for (const to of emails) {
        await this.fid.mail
          .send(tenantId, { to, subject: `Avaliação baixa: pedido ${orderCode}`, text: `${body}\n\nTrate em Marketing › Fidelidade › Avaliações: ${url}`, html: emailHtml(brand, { title: 'Avaliação baixa na Fidelidade', body: `${body}\n\nTrate o caso em Marketing › Fidelidade › Avaliações (Detratores).`, buttonLabel: 'Abrir avaliações', buttonUrl: url }) })
          .catch((err: unknown) => this.logger.warn(`Alerta de detrator não enviado: ${(err as Error).message}`))
      }
    }
  }

  /** Sair do programa (LGPD): para de ganhar pontos e de receber mensagens; os links antigos deixam de valer. */
  async optOut(auth: string | undefined, ip: string | null) {
    const s = await this.session(auth)
    await this.prisma.$transaction([
      this.prisma.loyaltyMember.update({ where: { id: s.member.id }, data: { optOutAt: new Date(), tokenEpoch: { increment: 1 } } }),
      this.prisma.leadConsent.create({ data: { leadId: s.leadId, purpose: 'fidelidade', granted: false, source: 'página do programa de fidelidade (sair)', ip } }),
    ])
    await this.prisma.leadEvent.create({ data: { tenantId: s.tenantId, leadId: s.leadId, type: 'fidelidade', title: 'Saiu do programa de fidelidade (pela página do cliente)' } })
    await this.audit.log({ tenantId: s.tenantId, action: 'fidelidade.cliente_saiu', entity: 'lead', entityId: s.leadId, ip })
    return { ok: true }
  }
}
