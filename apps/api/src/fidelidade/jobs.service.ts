import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { nextGapMs } from '../atendimento/regras'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { publicBranding } from '../settings/settings.service'
import { isOpen } from '../whatsapp/envio'
import { emailHtml } from './email'
import { FidelidadeService } from './fidelidade.service'
import { cleanConfig, type FidelidadeConfig, fill, firstName, inviteBlock, inviteDueAt, isBirthday, isDelivered, isReversal, orderQualifies, pointsFor } from './regras'

const TICK_MS = 60_000
const DAY_MS = 86_400_000
const EARN_BATCH = 100
const EMAIL_BATCH = 20
const INVITE_LABEL = 'Fidelidade (convite para avaliar)'
const STATE_KEY = 'fidelidade_estado'

export interface JobResult {
  ganhos: number
  estornos: number
  entregues: number
  clientesComPontosVencidos: number
  codigosVencidos: number
  aniversarios: number
  niveis: number
  convitesEmail: number
  convitesWhatsapp: number
}

/**
 * Rotinas da Fidelidade, a cada minuto e em lotes pequenos: pontos dos pedidos pagos (uma vez por pedido), estorno
 * dos cancelados/devolvidos, entrega, pontos e códigos vencidos, bônus de aniversário e níveis (uma vez por dia) e o
 * convite para avaliar (uma vez por pedido). WhatsApp: só no horário comercial, uma mensagem por vez com intervalo
 * sorteado (padrão 2 a 10 minutos), para não parecer spam.
 */
@Injectable()
export class FidelidadeJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('FidelidadeRotinas')
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly nextWa = new Map<string, number>()
  random = Math.random

  constructor(
    private readonly prisma: PrismaService,
    private readonly fid: FidelidadeService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async tick(now = new Date()) {
    if (this.running) return
    this.running = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: 'fidelidade' }, select: { tenantId: true, value: true } })
      for (const row of rows) {
        const cfg = cleanConfig(row.value)
        if (!cfg.enabled) continue
        await this.runTenant(row.tenantId, cfg, now).catch((err: unknown) => this.logger.warn(`Rotina da Fidelidade falhou: ${(err as Error).message}`))
      }
    } finally {
      this.running = false
    }
  }

  async runTenant(tenantId: string, cfg: FidelidadeConfig, now = new Date()): Promise<JobResult> {
    const r: JobResult = { ganhos: 0, estornos: 0, entregues: 0, clientesComPontosVencidos: 0, codigosVencidos: 0, aniversarios: 0, niveis: 0, convitesEmail: 0, convitesWhatsapp: 0 }
    r.ganhos = await this.earn(tenantId, cfg, now)
    r.estornos = await this.reverse(tenantId, cfg, now)
    r.entregues = await this.delivered(tenantId, cfg, now)
    r.clientesComPontosVencidos = await this.expire(tenantId, now)
    r.codigosVencidos = (await this.prisma.loyaltyRedemption.updateMany({ where: { tenantId, status: 'PENDENTE', expiresAt: { lte: now } }, data: { status: 'EXPIRADO' } })).count
    const day = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
    const state = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: STATE_KEY } } })
    if ((state?.value as { day?: string } | null)?.day !== day) {
      r.aniversarios = await this.birthdays(tenantId, cfg, now)
      r.niveis = await this.levels(tenantId, cfg, now)
      const value = { day } as Prisma.InputJsonValue
      await this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: STATE_KEY } }, create: { tenantId, key: STATE_KEY, value }, update: { value } })
    }
    const inv = await this.invites(tenantId, cfg, now)
    r.convitesEmail = inv.email
    r.convitesWhatsapp = inv.whatsapp
    return r
  }

  // ---------- Pontos dos pedidos pagos ----------

  async earn(tenantId: string, cfg: FidelidadeConfig, now: Date) {
    if (!cfg.since) return 0
    const orders = await this.prisma.ecommerceOrder.findMany({
      where: {
        tenantId,
        statusGroup: 'pago',
        leadId: { not: null },
        orderedAt: { gte: new Date(`${cfg.since}T03:00:00Z`) },
        total: { gte: cfg.minOrderValue },
        loyalty: { is: null },
        ...(cfg.onlySite ? { OR: [{ channel: null }, { channel: { equals: 'Site', mode: 'insensitive' as const } }] } : {}),
      },
      orderBy: { orderedAt: 'asc' },
      take: EARN_BATCH,
      select: { id: true, code: true, total: true, orderedAt: true, channel: true, statusGroup: true, leadId: true },
    })
    let count = 0
    for (const o of orders) {
      try {
        if (await this.earnOrder(tenantId, { ...o, total: Number(o.total), leadId: o.leadId! }, cfg, now)) count++
      } catch (err) {
        this.logger.warn(`Pontos do pedido ${o.code} não lançados: ${(err as Error).message}`)
      }
    }
    return count
  }

  /** Pontos de um pedido pago (uma vez: o pedido ganha a linha em loyalty_orders e o lançamento tem chave única). */
  async earnOrder(tenantId: string, o: { id: string; code: string; total: number; orderedAt: Date; channel: string | null; statusGroup: string; leadId: string }, cfg: FidelidadeConfig, now: Date) {
    const lead = await this.prisma.lead.findUnique({ where: { id: o.leadId }, select: { anonymizedAt: true, deletedAt: true } })
    const qualifies = !!lead && !lead.anonymizedAt && !lead.deletedAt && orderQualifies(o, cfg)
    const points = qualifies ? pointsFor(o.total, cfg) : 0
    const due = inviteDueAt({ orderedAt: o.orderedAt, deliveredAt: null }, cfg.review)
    const earned = await this.prisma.$transaction(async (tx) => {
      if (!qualifies) {
        await tx.loyaltyOrder.create({ data: { tenantId, orderId: o.id, leadId: o.leadId, points: 0, earnedAt: now, inviteStatus: 'PULADO: não conta para o programa' } })
        return false
      }
      const m = await this.fid.lockMember(tx, tenantId, o.leadId)
      if (await tx.loyaltyOrder.findUnique({ where: { orderId: o.id }, select: { id: true } })) return false
      if (m.optOutAt) {
        await tx.loyaltyOrder.create({ data: { tenantId, orderId: o.id, leadId: o.leadId, points: 0, earnedAt: now, inviteStatus: 'PULADO: cliente saiu do programa' } })
        return false
      }
      const first = (await tx.loyaltyOrder.count({ where: { leadId: o.leadId, points: { gt: 0 } } })) === 0
      await tx.loyaltyOrder.create({ data: { tenantId, orderId: o.id, leadId: o.leadId, points, earnedAt: now, inviteDueAt: due } })
      await this.fid.credit(tx, m, { kind: 'GANHO', points, reason: `Compra na loja virtual: pedido ${o.code}`, orderId: o.id, orderCode: o.code, dedupeKey: `ganho:${o.id}` }, cfg, now)
      if (first && cfg.bonusFirstPurchase > 0) await this.fid.credit(tx, m, { kind: 'BONUS', points: cfg.bonusFirstPurchase, reason: 'Bônus da primeira compra', orderId: o.id, orderCode: o.code, dedupeKey: `primeira-compra:${o.leadId}` }, cfg, now)
      return points > 0
    })
    if (earned) {
      await this.prisma.leadEvent.create({ data: { tenantId, leadId: o.leadId, type: 'fidelidade', title: `Fidelidade: ganhou ${points} pontos no pedido ${o.code}` } })
      await this.fid.refreshLevel(tenantId, o.leadId, cfg, now)
    }
    return earned
  }

  // ---------- Estorno ----------

  async reverse(tenantId: string, cfg: FidelidadeConfig, now: Date) {
    const like = (s: string) => ({ statusName: { contains: s, mode: 'insensitive' as const } })
    const rows = await this.prisma.loyaltyOrder.findMany({
      where: { tenantId, reversedAt: null, order: { OR: [{ statusGroup: 'cancelado' }, like('devol'), like('estorn'), like('reembols'), like('chargeback'), like('cancelad')] } },
      take: 100,
      include: { order: { select: { code: true, statusGroup: true, statusName: true } } },
    })
    let count = 0
    for (const lo of rows) {
      if (!isReversal(lo.order)) continue
      const done = await this.prisma.$transaction(async (tx) => {
        const m = await this.fid.lockMember(tx, tenantId, lo.leadId)
        const changed = await tx.loyaltyOrder.updateMany({ where: { id: lo.id, reversedAt: null }, data: { reversedAt: now } })
        if (!changed.count || lo.points <= 0 || !cfg.reverseOnCancel) return false
        const lot = await tx.loyaltyEntry.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: `ganho:${lo.orderId}` } }, select: { id: true } })
        await this.fid.debit(tx, m, { kind: 'ESTORNO', points: lo.points, reason: `Pedido ${lo.order.code} ${lo.order.statusGroup === 'cancelado' ? 'cancelado' : lo.order.statusName.toLowerCase()} na loja`, orderId: lo.orderId, orderCode: lo.order.code, dedupeKey: `estorno:${lo.orderId}`, prefer: lot?.id }, true, now)
        return true
      })
      if (done) {
        count++
        await this.prisma.leadEvent.create({ data: { tenantId, leadId: lo.leadId, type: 'fidelidade', title: `Fidelidade: ${lo.points} pontos estornados (pedido ${lo.order.code} cancelado/devolvido)` } })
        await this.fid.refreshLevel(tenantId, lo.leadId, cfg, now)
      }
    }
    return count
  }

  // ---------- Entrega ----------

  async delivered(tenantId: string, cfg: FidelidadeConfig, now: Date) {
    const rows = await this.prisma.loyaltyOrder.findMany({
      where: { tenantId, deliveredAt: null, reversedAt: null, order: { statusName: { contains: 'entreg', mode: 'insensitive' } } },
      take: 200,
      include: { order: { select: { statusName: true, orderedAt: true } } },
    })
    let count = 0
    for (const lo of rows) {
      if (!isDelivered(lo.order.statusName)) continue
      await this.prisma.loyaltyOrder.update({ where: { id: lo.id }, data: { deliveredAt: now, inviteDueAt: inviteDueAt({ orderedAt: lo.order.orderedAt, deliveredAt: now }, cfg.review) } })
      count++
    }
    return count
  }

  // ---------- Validade ----------

  async expire(tenantId: string, now: Date) {
    const leads = await this.prisma.loyaltyEntry.findMany({ where: { tenantId, remaining: { gt: 0 }, expiresAt: { lte: now } }, distinct: ['leadId'], take: 200, select: { leadId: true } })
    let count = 0
    for (const { leadId } of leads) {
      const total = await this.prisma.$transaction(async (tx) => this.fid.expireLots(tx, await this.fid.lockMember(tx, tenantId, leadId), now))
      if (total) count++
    }
    return count
  }

  // ---------- Diário: aniversário e níveis ----------

  async birthdays(tenantId: string, cfg: FidelidadeConfig, now: Date) {
    if (!cfg.bonusBirthday || !cfg.birthdayField) return 0
    const year = new Date(now.getTime() - 3 * 3_600_000).getUTCFullYear()
    let count = 0
    let cursor: string | undefined
    for (;;) {
      const rows = await this.prisma.loyaltyMember.findMany({ where: { tenantId, optOutAt: null }, orderBy: { id: 'asc' }, take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, leadId: true, lead: { select: { customFields: true, anonymizedAt: true } } } })
      if (!rows.length) break
      cursor = rows[rows.length - 1]!.id
      for (const m of rows) {
        if (m.lead.anonymizedAt || !isBirthday((m.lead.customFields as Record<string, unknown> | null)?.[cfg.birthdayField], now)) continue
        const ok = await this.prisma.$transaction(async (tx) => this.fid.credit(tx, await this.fid.lockMember(tx, tenantId, m.leadId), { kind: 'BONUS', points: cfg.bonusBirthday, reason: 'Bônus de aniversário', dedupeKey: `aniversario:${m.leadId}:${year}` }, cfg, now))
        if (ok) count++
      }
      if (rows.length < 1000) break
    }
    return count
  }

  /** Nível considera os últimos 12 meses: muda com o tempo mesmo sem compra nova. */
  async levels(tenantId: string, cfg: FidelidadeConfig, now: Date) {
    let changed = 0
    let cursor: string | undefined
    for (;;) {
      const rows = await this.prisma.loyaltyMember.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, leadId: true, levelKey: true } })
      if (!rows.length) break
      cursor = rows[rows.length - 1]!.id
      for (const m of rows) {
        const lv = await this.fid.refreshLevel(tenantId, m.leadId, cfg, now)
        if ((lv?.current?.key ?? null) !== m.levelKey) changed++
      }
      if (rows.length < 500) break
    }
    return changed
  }

  // ---------- Convite para avaliar ----------

  async invites(tenantId: string, cfg: FidelidadeConfig, now: Date) {
    const out = { email: 0, whatsapp: 0 }
    if (!cfg.review.enabled || (!cfg.review.email && !cfg.review.whatsapp)) return out
    const rows = await this.prisma.loyaltyOrder.findMany({
      where: { tenantId, inviteStatus: null, points: { gt: 0 }, earnedAt: { gte: new Date(now.getTime() - (cfg.review.maxAgeDays + 30) * DAY_MS) } },
      orderBy: { earnedAt: 'asc' },
      take: 300,
      include: { order: { select: { code: true, orderedAt: true } } },
    })
    if (!rows.length) return out
    const leadIds = [...new Set(rows.map((r) => r.leadId))]
    const [leads, reviewed] = await Promise.all([
      this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, email: true, phone: true, emailOptOutAt: true, emailBouncedAt: true, anonymizedAt: true, loyaltyMember: { select: { tokenEpoch: true, optOutAt: true } } } }),
      this.prisma.loyaltyReview.findMany({ where: { orderId: { in: rows.map((r) => r.orderId) } }, select: { orderId: true } }),
    ])
    const byId = new Map(leads.map((l) => [l.id, l]))
    const done = new Set(reviewed.map((r) => r.orderId))
    let wa = await this.whatsappSlot(tenantId, cfg, now)
    const brand = cfg.review.email ? publicBranding(await this.fid.settings.branding(tenantId)) : null
    for (const lo of rows) {
      const lead = byId.get(lo.leadId)
      const emailOk = !!(cfg.review.email && lead?.email && !lead.emailOptOutAt && !lead.emailBouncedAt)
      const waOk = !!(cfg.review.whatsapp && lead?.phone)
      const block = inviteBlock(
        { orderedAt: lo.order.orderedAt, deliveredAt: lo.deliveredAt, reversedAt: lo.reversedAt, reviewed: done.has(lo.orderId), optedOut: !lead || !!lead.anonymizedAt || !!lead.loyaltyMember?.optOutAt, hasEmail: emailOk, hasPhone: waOk },
        cfg.review,
        now,
      )
      if (block === 'esperar') continue
      if (block) {
        const sent = lo.emailStatus === 'ENVIADO' || lo.whatsappStatus === 'ENVIADO'
        await this.prisma.loyaltyOrder.update({ where: { id: lo.id }, data: { inviteStatus: sent ? 'ENVIADO' : `PULADO: ${block}`.slice(0, 200) } })
        continue
      }
      const link = this.fid.accessLink(tenantId, { leadId: lo.leadId, tokenEpoch: lead!.loyaltyMember?.tokenEpoch ?? 0 }, 30, `&avaliar=${lo.orderId}`)
      const vars = { nome: firstName(lead!.name), pedido: lo.order.code, bonus: cfg.bonusReview, link, empresa: brand?.shortName ?? '' }
      const data: Prisma.LoyaltyOrderUpdateInput = {}
      let emailStatus = lo.emailStatus
      let waStatus = lo.whatsappStatus
      if (emailOk && !emailStatus && out.email < EMAIL_BATCH) {
        try {
          await this.fid.mail.send(tenantId, {
            to: lead!.email!,
            subject: fill(cfg.messages.inviteSubject, vars),
            text: `${fill(cfg.messages.inviteEmail, vars)}\n\n${link}`,
            html: emailHtml(brand!, { title: cfg.page.title, body: fill(cfg.messages.inviteEmail, vars), buttonLabel: 'Avaliar a compra', buttonUrl: link, footnote: 'Você recebeu este e-mail porque comprou na nossa loja virtual e participa do programa de fidelidade. Para sair, abra a página e use “Sair do programa”.' }),
          })
          emailStatus = 'ENVIADO'
          out.email++
        } catch (err) {
          emailStatus = `ERRO: ${((err as Error).message || 'erro').slice(0, 180)}`
        }
        data.emailStatus = emailStatus
      }
      if (waOk && !waStatus && wa) {
        try {
          const sent = await this.fid.chat.sendAutomatic(wa, lead!.phone!, fill(cfg.messages.inviteWhatsapp, vars), INVITE_LABEL, { leadId: lo.leadId, recordId: null, name: lead!.name })
          if (sent) {
            waStatus = 'ENVIADO'
            out.whatsapp++
          }
        } catch (err) {
          waStatus = `ERRO: ${((err as Error).message || 'erro').slice(0, 180)}`
        }
        if (waStatus) data.whatsappStatus = waStatus
        // Uma mensagem por vez: a próxima espera o intervalo sorteado.
        this.nextWa.set(wa.id, now.getTime() + nextGapMs(cfg.review, this.random))
        wa = null
      }
      const emailDone = !emailOk || !!emailStatus
      const waDone = !waOk || !!waStatus
      if (emailDone && waDone) {
        const any = emailStatus === 'ENVIADO' || waStatus === 'ENVIADO'
        data.inviteStatus = any ? 'ENVIADO' : `PULADO: ${[emailStatus, waStatus].filter(Boolean).join(' / ') || 'sem canal'}`.slice(0, 200)
        data.invitedAt = any ? now : null
      }
      if (Object.keys(data).length) await this.prisma.loyaltyOrder.update({ where: { id: lo.id }, data })
      if (data.inviteStatus === 'ENVIADO') await this.prisma.leadEvent.create({ data: { tenantId, leadId: lo.leadId, type: 'fidelidade', title: `Fidelidade: convite para avaliar o pedido ${lo.order.code} enviado` } })
    }
    return out
  }

  /** Número do WhatsApp liberado para a próxima mensagem (horário comercial, conectado e fora do intervalo). */
  private async whatsappSlot(tenantId: string, cfg: FidelidadeConfig, now: Date) {
    if (!cfg.review.whatsapp || !cfg.review.numberId) return null
    if (!isOpen((await this.fid.chat.rules(tenantId)).businessHours, now)) return null
    const number = await this.prisma.whatsappNumber.findFirst({ where: { id: cfg.review.numberId, tenantId, deletedAt: null } })
    if (number?.status !== 'CONECTADO') return null
    let at = this.nextWa.get(number.id)
    if (at === undefined) {
      const last = await this.prisma.whatsappMessage.findFirst({ where: { sentByName: INVITE_LABEL, conversation: { numberId: number.id } }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } })
      at = last ? last.sentAt.getTime() + cfg.review.gapMin * 60_000 : 0
      this.nextWa.set(number.id, at)
    }
    return now.getTime() >= at ? number : null
  }
}
