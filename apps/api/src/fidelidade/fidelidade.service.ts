import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { createHmac } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { deliveryProblem, monthRange, parseHolder } from '../brindes/brindes'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../settings/mail.service'
import { publicBranding, SettingsService } from '../settings/settings.service'
import { ChatService } from '../whatsapp/chat.service'
import {
  cleanConfig,
  consumeLots,
  expiresAtFor,
  type FidelidadeConfig,
  fill,
  firstName,
  generateCode,
  isCode,
  lastMonths,
  levelFor,
  levelRank,
  lotAfterDebt,
  monthlyFlow,
  normalizeCode,
  npsClass,
  npsOf,
  redemptionProblem,
  REWARD_KINDS,
  signToken,
} from './regras'
import { emailHtml } from './email'

export type Tx = Prisma.TransactionClient
const MODULE = 'fidelidade'
const SETTING = 'fidelidade'
const DAY_MS = 86_400_000
const n = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? null : Number(d))

export interface LockedMember {
  id: string
  leadId: string
  tenantId: string
  balance: number
  levelKey: string | null
  optOutAt: Date | null
  tokenEpoch: number
}

export interface EntryInput {
  kind: 'GANHO' | 'BONUS' | 'RESGATE' | 'EXPIRADO' | 'AJUSTE' | 'ESTORNO'
  points: number
  reason: string
  orderId?: string | null
  orderCode?: string | null
  redemptionId?: string | null
  dedupeKey?: string | null
  userId?: string | null
  userName?: string | null
  /** undefined = validade das configurações a partir de agora; null = não vence. */
  expiresAt?: Date | null
}

export interface RewardInput {
  name?: string
  description?: string | null
  kind?: string
  pointsCost?: number
  giftId?: string | null
  discountType?: string | null
  value?: number | null
  stock?: number | null
  perCustomer?: number | null
  minLevel?: string | null
  validityDays?: number | null
  active?: boolean
  sort?: number
}

/**
 * Marketing › Fidelidade: pontos pelos pedidos pagos da loja virtual, níveis, prêmios com código de resgate,
 * avaliação depois da compra e a página do cliente (sem senha). O extrato é a fonte da verdade; o saldo do cliente
 * (loyalty_members.balance) muda sempre na mesma transação, com o cliente travado (FOR UPDATE).
 */
@Injectable()
export class FidelidadeService {
  constructor(
    readonly prisma: PrismaService,
    private readonly audit: AuditService,
    readonly settings: SettingsService,
    readonly mail: MailService,
    readonly chat: ChatService,
  ) {}

  assertCan(user: AuthUser, action: Action = 'view') {
    if (!can(user.permissions, user.role.isSystem, MODULE, action)) throw new ForbiddenException('Seu perfil não tem acesso a esta ação da Fidelidade.')
  }

  async config(tenantId: string) {
    const row = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: SETTING } } })
    return cleanConfig(row?.value)
  }

  /** Chave dos links do cliente (separada das outras assinaturas do sistema). */
  key() {
    return createHmac('sha256', env.jwtAccessSecret).update('fidelidade-v1').digest()
  }

  /** Link de acesso do cliente (página Meus pontos), com validade. */
  accessLink(tenantId: string, m: { leadId: string; tokenEpoch: number }, days: number, extra = '') {
    const token = signToken({ t: tenantId, l: m.leadId, v: m.tokenEpoch, k: 'link', e: Math.floor(Date.now() / 1000) + days * 86_400 }, this.key())
    return `${env.appUrl}/meus-pontos?t=${encodeURIComponent(token)}${extra}`
  }

  // ---------- Extrato (sempre dentro de transação) ----------

  /** Cliente do programa (cria na primeira vez) travado até o fim da transação. */
  async lockMember(tx: Tx, tenantId: string, leadId: string): Promise<LockedMember> {
    await tx.loyaltyMember.upsert({ where: { leadId }, create: { tenantId, leadId }, update: {} })
    const rows = await tx.$queryRaw<LockedMember[]>`SELECT id, "leadId", "tenantId", balance, "levelKey", "optOutAt", "tokenEpoch" FROM loyalty_members WHERE "leadId" = ${leadId}::uuid FOR UPDATE`
    const m = rows[0]
    if (!m || m.tenantId !== tenantId) throw new NotFoundException('Cliente não encontrado.')
    return m
  }

  /** Lança pontos (positivos) como lote. Movimento com a mesma chave não é lançado de novo. */
  async credit(tx: Tx, m: LockedMember, e: EntryInput, cfg: FidelidadeConfig, now = new Date()) {
    if (!(e.points > 0)) return null
    if (e.dedupeKey && (await tx.loyaltyEntry.findUnique({ where: { tenantId_dedupeKey: { tenantId: m.tenantId, dedupeKey: e.dedupeKey } }, select: { id: true } }))) return null
    const row = await tx.loyaltyEntry.create({
      data: {
        tenantId: m.tenantId,
        leadId: m.leadId,
        kind: e.kind,
        points: Math.round(e.points),
        remaining: lotAfterDebt(Math.round(e.points), m.balance),
        expiresAt: e.expiresAt === undefined ? expiresAtFor(now, cfg.expireMonths) : e.expiresAt,
        orderId: e.orderId ?? null,
        orderCode: e.orderCode ?? null,
        redemptionId: e.redemptionId ?? null,
        reason: e.reason.slice(0, 300),
        dedupeKey: e.dedupeKey ?? null,
        userId: e.userId ?? null,
        userName: e.userName ?? null,
      },
    })
    await tx.loyaltyMember.update({ where: { id: m.id }, data: { balance: { increment: row.points } } })
    m.balance += row.points
    return row
  }

  /** Vence os lotes do cliente que já passaram da validade (antes de usar o saldo). */
  async expireLots(tx: Tx, m: LockedMember, now = new Date()) {
    const lots = await tx.loyaltyEntry.findMany({ where: { leadId: m.leadId, remaining: { gt: 0 }, expiresAt: { lte: now } }, select: { id: true, remaining: true, expiresAt: true } })
    let total = 0
    for (const l of lots) {
      if (await tx.loyaltyEntry.findUnique({ where: { tenantId_dedupeKey: { tenantId: m.tenantId, dedupeKey: `expira:${l.id}` } }, select: { id: true } })) {
        await tx.loyaltyEntry.update({ where: { id: l.id }, data: { remaining: 0 } })
        continue
      }
      await tx.loyaltyEntry.update({ where: { id: l.id }, data: { remaining: 0 } })
      await tx.loyaltyEntry.create({
        data: { tenantId: m.tenantId, leadId: m.leadId, kind: 'EXPIRADO', points: -l.remaining, reason: `Pontos vencidos em ${l.expiresAt!.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, dedupeKey: `expira:${l.id}` },
      })
      total += l.remaining
    }
    if (total) {
      await tx.loyaltyMember.update({ where: { id: m.id }, data: { balance: { decrement: total } } })
      m.balance -= total
    }
    return total
  }

  /**
   * Tira pontos (resgate, ajuste negativo, estorno) consumindo os lotes que vencem antes. Sem saldo, recusa — menos
   * no estorno, que pode deixar o saldo negativo (o próximo ganho paga a diferença).
   */
  async debit(tx: Tx, m: LockedMember, e: EntryInput & { prefer?: string }, allowNegative = false, now = new Date()) {
    const amount = Math.round(Math.abs(e.points))
    if (!amount) return null
    if (e.dedupeKey && (await tx.loyaltyEntry.findUnique({ where: { tenantId_dedupeKey: { tenantId: m.tenantId, dedupeKey: e.dedupeKey } }, select: { id: true } }))) return null
    await this.expireLots(tx, m, now)
    const lots = await tx.loyaltyEntry.findMany({ where: { leadId: m.leadId, remaining: { gt: 0 } }, select: { id: true, remaining: true, expiresAt: true } })
    const { takes, shortfall } = consumeLots(lots, amount, e.prefer)
    if (shortfall && !allowNegative) throw new BadRequestException(`Saldo insuficiente: faltam ${shortfall} pontos.`)
    for (const t of takes) await tx.loyaltyEntry.update({ where: { id: t.id }, data: { remaining: { decrement: t.take } } })
    const row = await tx.loyaltyEntry.create({
      data: {
        tenantId: m.tenantId,
        leadId: m.leadId,
        kind: e.kind,
        points: -amount,
        orderId: e.orderId ?? null,
        orderCode: e.orderCode ?? null,
        redemptionId: e.redemptionId ?? null,
        reason: e.reason.slice(0, 300),
        dedupeKey: e.dedupeKey ?? null,
        userId: e.userId ?? null,
        userName: e.userName ?? null,
      },
    })
    await tx.loyaltyMember.update({ where: { id: m.id }, data: { balance: { decrement: amount } } })
    m.balance -= amount
    return row
  }

  // ---------- Nível ----------

  /** Valor que define o nível: pontos ganhos (menos estornos) ou valor comprado nos últimos 12 meses. */
  async levelValue(db: Tx | PrismaService, tenantId: string, leadId: string, cfg: FidelidadeConfig, now = new Date()) {
    const since = new Date(now.getTime() - 365 * DAY_MS)
    if (cfg.levelBasis === 'gasto') {
      const r = await db.ecommerceOrder.aggregate({ where: { tenantId, leadId, orderedAt: { gte: since }, loyalty: { is: { reversedAt: null, points: { gt: 0 } } } }, _sum: { total: true } })
      return Math.round(Number(r._sum.total ?? 0))
    }
    const r = await db.loyaltyEntry.aggregate({ where: { tenantId, leadId, createdAt: { gte: since }, kind: { in: ['GANHO', 'BONUS', 'ESTORNO'] } }, _sum: { points: true } })
    return Math.max(0, r._sum.points ?? 0)
  }

  /** Recalcula o nível do cliente; subiu de nível, fica no histórico do lead. */
  async refreshLevel(tenantId: string, leadId: string, cfg: FidelidadeConfig, now = new Date()) {
    const member = await this.prisma.loyaltyMember.findUnique({ where: { leadId }, select: { id: true, levelKey: true } })
    if (!member) return null
    const value = await this.levelValue(this.prisma, tenantId, leadId, cfg, now)
    const lv = levelFor(value, cfg.levels)
    const key = lv.current?.key ?? null
    if (key !== member.levelKey) {
      await this.prisma.loyaltyMember.update({ where: { id: member.id }, data: { levelKey: key, levelAt: now } })
      if (member.levelKey && levelRank(key, cfg.levels) > levelRank(member.levelKey, cfg.levels)) {
        await this.prisma.leadEvent.create({ data: { tenantId, leadId, type: 'fidelidade', title: `Fidelidade: subiu para o nível ${lv.current?.name}` } })
      }
    }
    return { value, ...lv }
  }

  // ---------- Configurações ----------

  async getConfig(user: AuthUser) {
    this.assertCan(user)
    const [config, gifts, numbers, users, fields, sellers, units] = await Promise.all([
      this.config(user.tenantId),
      this.prisma.gift.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, stock: true } }),
      this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null, purpose: { not: 'MONITORAMENTO' } }, orderBy: { name: 'asc' }, select: { id: true, name: true, status: true } }),
      this.prisma.user.findMany({ where: { tenantId: user.tenantId, active: true, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.customFieldDef.findMany({ where: { tenantId: user.tenantId, active: true, type: 'DATE' }, orderBy: { position: 'asc' }, select: { key: true, label: true } }),
      this.prisma.seller.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.unit.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ])
    return {
      config,
      options: {
        gifts,
        numbers,
        users,
        dateFields: fields,
        holders: [...sellers.map((s) => ({ id: `s:${s.id}`, name: s.name })), ...units.map((u) => ({ id: `u:${u.id}`, name: `Filial ${u.name}` }))],
        publicUrl: `${env.appUrl}/meus-pontos`,
      },
    }
  }

  async saveConfig(user: AuthUser, raw: unknown, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const before = await this.config(user.tenantId)
    const next = cleanConfig(raw)
    // Ligar sem data de início: começa hoje (não distribui pontos dos pedidos antigos).
    if (next.enabled && !next.since) next.since = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
    await this.settings.set(user.tenantId, SETTING, next)
    await this.audit.byUser(user, ctx, 'fidelidade.config', 'tenant_setting', SETTING, {
      ligado: { de: before.enabled, para: next.enabled },
      inicio: next.since,
      pontosPorReal: next.pointsPerReal,
      validadeMeses: next.expireMonths,
      avaliacao: next.review.enabled,
    })
    return next
  }

  // ---------- Painel ----------

  async dashboard(user: AuthUser, monthsIn = 12) {
    this.assertCan(user)
    const tenantId = user.tenantId
    const cfg = await this.config(tenantId)
    const months = lastMonths(Math.min(24, Math.max(3, monthsIn)))
    const start = new Date(`${months[0]}-01T03:00:00Z`)
    const [members, optedOut, balance, byLevel, flowRows, redemptions, reviews, invited, reviewRows] = await Promise.all([
      this.prisma.loyaltyMember.count({ where: { tenantId, optOutAt: null } }),
      this.prisma.loyaltyMember.count({ where: { tenantId, optOutAt: { not: null } } }),
      this.prisma.loyaltyMember.aggregate({ where: { tenantId, optOutAt: null, balance: { gt: 0 } }, _sum: { balance: true } }),
      this.prisma.loyaltyMember.groupBy({ by: ['levelKey'], where: { tenantId, optOutAt: null }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ month: string; kind: string; points: number }[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month, kind, SUM(points)::int AS points
        FROM loyalty_entries WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${start} GROUP BY 1, 2`,
      this.prisma.loyaltyRedemption.groupBy({ by: ['status'], where: { tenantId, createdAt: { gte: start } }, _count: { _all: true } }),
      this.prisma.loyaltyReview.aggregate({ where: { tenantId, createdAt: { gte: start } }, _avg: { stars: true }, _count: { _all: true } }),
      this.prisma.loyaltyOrder.count({ where: { tenantId, invitedAt: { gte: start } } }),
      this.prisma.$queryRaw<{ month: string; nps: number; n: number }[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month, nps, COUNT(*)::int AS n
        FROM loyalty_reviews WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${start} GROUP BY 1, 2`,
    ])
    const flow = monthlyFlow(flowRows, months)
    const scores = reviewRows.flatMap((r) => Array<number>(r.n).fill(r.nps))
    const npsByMonth = months.map((m) => ({ month: m, ...npsOf(reviewRows.filter((r) => r.month === m).flatMap((r) => Array<number>(r.n).fill(r.nps))) }))
    const levelCount = new Map(byLevel.map((b) => [b.levelKey, b._count._all]))
    const sum = (k: 'emitidos' | 'resgatados' | 'expirados' | 'estornados') => flow.reduce((t, f) => t + f[k], 0)
    return {
      enabled: cfg.enabled,
      since: cfg.since,
      months,
      members,
      optedOut,
      openBalance: balance._sum.balance ?? 0,
      issued: sum('emitidos'),
      redeemed: sum('resgatados'),
      expired: sum('expirados'),
      reversed: sum('estornados'),
      redemptions: Object.fromEntries(redemptions.map((r) => [r.status, r._count._all])),
      reviews: reviews._count._all,
      invited,
      stars: reviews._avg.stars ? Math.round(reviews._avg.stars * 10) / 10 : null,
      nps: npsOf(scores),
      levels: cfg.levels.map((l) => ({ key: l.key, name: l.name, color: l.color, count: levelCount.get(l.key) ?? 0 })),
      flow,
      npsByMonth,
    }
  }

  // ---------- Clientes ----------

  async customers(user: AuthUser, q: { busca?: string; nivel?: string; pagina?: number }) {
    this.assertCan(user)
    const tenantId = user.tenantId
    const cfg = await this.config(tenantId)
    const page = Math.max(1, q.pagina ?? 1)
    const s = q.busca?.trim()
    const digits = s?.replace(/\D/g, '') ?? ''
    const where: Prisma.LoyaltyMemberWhereInput = {
      tenantId,
      ...(q.nivel ? { levelKey: q.nivel } : {}),
      ...(s
        ? {
            lead: {
              OR: [
                { name: { contains: s, mode: 'insensitive' } },
                { email: { contains: s, mode: 'insensitive' } },
                { customerCode: { equals: s } },
                ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
              ],
            },
          }
        : {}),
    }
    const [total, rows] = await Promise.all([
      this.prisma.loyaltyMember.count({ where }),
      this.prisma.loyaltyMember.findMany({
        where,
        orderBy: [{ balance: 'desc' }, { joinedAt: 'asc' }],
        skip: (page - 1) * 50,
        take: 50,
        include: { lead: { select: { id: true, name: true, email: true, phone: true, customerCode: true, lastSaleAt: true } } },
      }),
    ])
    const levelName = new Map(cfg.levels.map((l) => [l.key, l]))
    return {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / 50)),
      levels: cfg.levels.map((l) => ({ key: l.key, name: l.name })),
      items: rows.map((r) => ({
        leadId: r.leadId,
        name: r.lead.name,
        email: r.lead.email,
        phone: r.lead.phone,
        customerCode: r.lead.customerCode,
        balance: r.balance,
        level: r.levelKey ? (levelName.get(r.levelKey)?.name ?? r.levelKey) : null,
        levelColor: r.levelKey ? (levelName.get(r.levelKey)?.color ?? null) : null,
        joinedAt: r.joinedAt,
        lastSaleAt: r.lead.lastSaleAt,
        optedOut: !!r.optOutAt,
      })),
    }
  }

  async exportCustomers(user: AuthUser, ctx: RequestCtx) {
    this.assertCan(user, 'export')
    const cfg = await this.config(user.tenantId)
    const rows = await this.prisma.loyaltyMember.findMany({ where: { tenantId: user.tenantId }, orderBy: { balance: 'desc' }, take: 50_000, include: { lead: { select: { name: true, email: true, phone: true, customerCode: true } } } })
    const levelName = new Map(cfg.levels.map((l) => [l.key, l.name]))
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [['Nome', 'E-mail', 'Telefone', 'Código do cliente', 'Saldo', 'Nível', 'No programa desde', 'Saiu do programa'].join(';')]
    for (const r of rows) {
      lines.push(
        [r.lead.name, r.lead.email, r.lead.phone, r.lead.customerCode, r.balance, r.levelKey ? levelName.get(r.levelKey) ?? r.levelKey : '', r.joinedAt.toISOString().slice(0, 10), r.optOutAt ? r.optOutAt.toISOString().slice(0, 10) : '']
          .map(esc)
          .join(';'),
      )
    }
    await this.audit.byUser(user, ctx, 'fidelidade.exportou', 'loyalty_member', undefined, { linhas: rows.length })
    return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8')
  }

  /** Ficha do cliente na Fidelidade: saldo, nível, extrato, resgates, avaliações e pedidos. */
  async customer(user: AuthUser, leadId: string) {
    this.assertCan(user)
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId: user.tenantId }, select: { id: true, name: true, email: true, phone: true, customerCode: true, anonymizedAt: true } })
    if (!lead) throw new NotFoundException('Lead não encontrado.')
    return { lead, ...(await this.summary(user.tenantId, leadId, 200)) }
  }

  /** Resumo usado pela ficha (painel) e pela página do cliente. */
  async summary(tenantId: string, leadId: string, entries = 100) {
    const cfg = await this.config(tenantId)
    const member = await this.prisma.loyaltyMember.findUnique({ where: { leadId } })
    if (!member || member.tenantId !== tenantId) return { member: null, config: { enabled: cfg.enabled, levels: cfg.levels, levelBasis: cfg.levelBasis }, ledger: [], redemptions: [], reviews: [], orders: [] }
    const now = new Date()
    const [value, ledger, redemptions, reviews, orders, expiring] = await Promise.all([
      this.levelValue(this.prisma, tenantId, leadId, cfg, now),
      this.prisma.loyaltyEntry.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: entries }),
      this.prisma.loyaltyRedemption.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.loyaltyReview.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.loyaltyOrder.findMany({ where: { leadId }, orderBy: { earnedAt: 'desc' }, take: 50, include: { order: { select: { code: true, total: true, orderedAt: true, statusName: true } } } }),
      this.prisma.loyaltyEntry.findMany({ where: { leadId, remaining: { gt: 0 }, expiresAt: { not: null, lte: new Date(now.getTime() + 60 * DAY_MS) } }, orderBy: { expiresAt: 'asc' }, take: 5, select: { remaining: true, expiresAt: true } }),
    ])
    const lv = levelFor(value, cfg.levels)
    const reviewed = new Set(reviews.map((r) => r.orderId))
    return {
      config: { enabled: cfg.enabled, levels: cfg.levels, levelBasis: cfg.levelBasis },
      member: {
        balance: member.balance,
        joinedAt: member.joinedAt,
        optedOut: !!member.optOutAt,
        consentAt: member.consentAt,
        lastAccessAt: member.lastAccessAt,
        levelValue: value,
        level: lv.current,
        nextLevel: lv.next,
        missing: lv.missing,
        expiring: expiring.map((e) => ({ points: e.remaining, expiresAt: e.expiresAt })),
      },
      ledger: ledger.map((e) => ({ id: e.id, kind: e.kind, points: e.points, reason: e.reason, orderCode: e.orderCode, expiresAt: e.points > 0 ? e.expiresAt : null, userName: e.userName, createdAt: e.createdAt })),
      redemptions: redemptions.map((r) => this.redemptionView(r)),
      reviews: reviews.map((r) => ({ id: r.id, orderCode: r.orderCode, stars: r.stars, nps: r.nps, comment: r.comment, aspects: r.aspects, detractor: r.detractor, followUpStatus: r.followUpStatus, createdAt: r.createdAt })),
      orders: orders.map((o) => ({ orderId: o.orderId, code: o.order.code, total: Number(o.order.total), orderedAt: o.order.orderedAt, status: o.order.statusName, points: o.points, reversed: !!o.reversedAt, deliveredAt: o.deliveredAt, reviewed: reviewed.has(o.orderId), canReview: !o.reversedAt && !reviewed.has(o.orderId) && o.points >= 0 })),
    }
  }

  redemptionView(r: { id: string; code: string; rewardName: string; kind: string; points: number; discountType: string | null; value: Prisma.Decimal | null; status: string; expiresAt: Date | null; usedAt: Date | null; usedOrderCode: string | null; usedByName: string | null; source: string; createdByName: string | null; createdAt: Date; cancelReason: string | null }) {
    return {
      id: r.id,
      code: r.code,
      rewardName: r.rewardName,
      kind: r.kind,
      points: r.points,
      discountType: r.discountType,
      value: n(r.value),
      status: r.status,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt,
      usedOrderCode: r.usedOrderCode,
      usedByName: r.usedByName,
      source: r.source,
      createdByName: r.createdByName,
      cancelReason: r.cancelReason,
      createdAt: r.createdAt,
    }
  }

  /** Ajuste manual (Editar + motivo), com auditoria. */
  async adjust(user: AuthUser, leadId: string, d: { points: number; reason: string }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const reason = d.reason?.trim()
    if (!reason || reason.length < 3) throw new BadRequestException('Informe o motivo do ajuste.')
    if (!Number.isInteger(d.points) || d.points === 0 || Math.abs(d.points) > 10_000_000) throw new BadRequestException('Informe os pontos (positivo para dar, negativo para tirar).')
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId: user.tenantId, deletedAt: null }, select: { id: true } })
    if (!lead) throw new NotFoundException('Lead não encontrado.')
    const cfg = await this.config(user.tenantId)
    const balance = await this.prisma.$transaction(async (tx) => {
      const m = await this.lockMember(tx, user.tenantId, leadId)
      const e: EntryInput = { kind: 'AJUSTE', points: d.points, reason: `Ajuste: ${reason}`, userId: user.id, userName: user.name }
      if (d.points > 0) await this.credit(tx, m, e, cfg)
      else await this.debit(tx, m, e)
      return m.balance
    })
    await this.refreshLevel(user.tenantId, leadId, cfg)
    await this.audit.byUser(user, ctx, 'fidelidade.ajuste', 'lead', leadId, { pontos: d.points, motivo: reason, saldo: balance })
    return { balance }
  }

  /** Envia ao cliente o link da página dele (e-mail ou WhatsApp), sem senha. */
  async sendLink(user: AuthUser, leadId: string, channel: 'email' | 'whatsapp', ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const cfg = await this.config(user.tenantId)
    const m = await this.prisma.loyaltyMember.findFirst({ where: { leadId, tenantId: user.tenantId }, include: { lead: { select: { name: true, email: true, phone: true, anonymizedAt: true } } } })
    if (!m) throw new NotFoundException('Este cliente ainda não está no programa.')
    if (m.optOutAt) throw new BadRequestException('O cliente saiu do programa: não recebe mais mensagens dele.')
    const r = await this.sendAccessLink(user.tenantId, cfg, { leadId, tokenEpoch: m.tokenEpoch, balance: m.balance, levelKey: m.levelKey, lead: m.lead }, channel)
    await this.audit.byUser(user, ctx, 'fidelidade.link_enviado', 'lead', leadId, { canal: channel })
    return r
  }

  async sendAccessLink(tenantId: string, cfg: FidelidadeConfig, m: { leadId: string; tokenEpoch: number; balance: number; levelKey: string | null; lead: { name: string | null; email: string | null; phone: string | null } }, channel: 'email' | 'whatsapp') {
    const link = this.accessLink(tenantId, m, cfg.linkValidityDays)
    const brand = await this.settings.branding(tenantId)
    const vars = { nome: firstName(m.lead.name), pontos: m.balance.toLocaleString('pt-BR'), nivel: cfg.levels.find((l) => l.key === m.levelKey)?.name ?? cfg.levels[0]?.name ?? '', link, dias: cfg.linkValidityDays, empresa: brand.shortName }
    if (channel === 'email') {
      if (!m.lead.email) throw new BadRequestException('O cliente não tem e-mail.')
      await this.mail.send(tenantId, {
        to: m.lead.email,
        subject: fill(cfg.messages.linkSubject, vars),
        text: `${fill(cfg.messages.linkEmail, vars)}\n\n${link}`,
        html: emailHtml(publicBranding(brand), { title: cfg.page.title, body: fill(cfg.messages.linkEmail, vars), buttonLabel: 'Ver meus pontos', buttonUrl: link, footnote: 'Este link é pessoal: não o encaminhe. Para sair do programa, abra a página e use “Sair do programa”.' }),
      })
      return { ok: true, channel }
    }
    const phone = m.lead.phone
    if (!phone) throw new BadRequestException('O cliente não tem telefone.')
    const number = await this.numberFor(tenantId, cfg.loginNumberId ?? cfg.review.numberId)
    const sent = await this.chat.sendAutomatic(number, phone, fill(cfg.messages.linkWhatsapp, vars), 'Fidelidade (link de acesso)', { leadId: m.leadId, recordId: null, name: m.lead.name })
    if (!sent) throw new BadRequestException('O número atingiu o limite de envios agora. Tente de novo em alguns minutos.')
    return { ok: true, channel }
  }

  async numberFor(tenantId: string, numberId: string | null) {
    if (!numberId) throw new BadRequestException('Escolha o número de WhatsApp da Fidelidade em Configurações.')
    const number = await this.prisma.whatsappNumber.findFirst({ where: { id: numberId, tenantId, deletedAt: null } })
    if (!number) throw new BadRequestException('Número de WhatsApp da Fidelidade não encontrado.')
    if (number.status !== 'CONECTADO') throw new BadRequestException(`O número ${number.name} está desconectado.`)
    return number
  }

  // ---------- Prêmios ----------

  async rewards(user: AuthUser) {
    this.assertCan(user)
    const rows = await this.prisma.loyaltyReward.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ active: 'desc' }, { sort: 'asc' }, { pointsCost: 'asc' }], include: { gift: { select: { name: true, stock: true } }, _count: { select: { redemptions: true } } } })
    return rows.map((r) => this.rewardView(r))
  }

  rewardView(r: { id: string; name: string; description: string | null; kind: string; pointsCost: number; giftId: string | null; discountType: string | null; value: Prisma.Decimal | null; stock: number | null; perCustomer: number | null; minLevel: string | null; validityDays: number | null; active: boolean; sort: number; gift?: { name: string; stock: number } | null; _count?: { redemptions: number } }) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind,
      pointsCost: r.pointsCost,
      giftId: r.giftId,
      giftName: r.gift?.name ?? null,
      giftStock: r.gift?.stock ?? null,
      discountType: r.discountType,
      value: n(r.value),
      stock: r.stock,
      perCustomer: r.perCustomer,
      minLevel: r.minLevel,
      validityDays: r.validityDays,
      active: r.active,
      sort: r.sort,
      redemptions: r._count?.redemptions ?? 0,
    }
  }

  async saveReward(user: AuthUser, id: string | null, d: RewardInput, ctx: RequestCtx) {
    this.assertCan(user, id ? 'edit' : 'create')
    const cur = id ? await this.prisma.loyaltyReward.findFirst({ where: { id, tenantId: user.tenantId } }) : null
    if (id && !cur) throw new NotFoundException('Prêmio não encontrado.')
    const kind = d.kind ?? cur?.kind
    if (!kind || !(REWARD_KINDS as string[]).includes(kind)) throw new BadRequestException('Escolha o tipo do prêmio.')
    const name = (d.name ?? cur?.name ?? '').trim()
    if (!name) throw new BadRequestException('Informe o nome do prêmio.')
    const pointsCost = d.pointsCost ?? cur?.pointsCost ?? 0
    if (!Number.isInteger(pointsCost) || pointsCost < 0) throw new BadRequestException('Pontos inválidos.')
    if (kind !== 'BENEFICIO' && pointsCost < 1) throw new BadRequestException('Informe quantos pontos o prêmio custa.')
    const giftId = kind === 'BRINDE' ? (d.giftId !== undefined ? d.giftId : cur?.giftId) : null
    if (kind === 'BRINDE') {
      if (!giftId) throw new BadRequestException('Escolha o brinde do Controle de brindes.')
      const g = await this.prisma.gift.findFirst({ where: { id: giftId, tenantId: user.tenantId }, select: { id: true } })
      if (!g) throw new BadRequestException('Brinde não encontrado.')
    }
    const discountType = kind === 'DESCONTO' ? (d.discountType !== undefined ? d.discountType : cur?.discountType) ?? 'VALOR' : kind === 'CASHBACK' ? 'VALOR' : null
    if (discountType && discountType !== 'VALOR' && discountType !== 'PERCENTUAL') throw new BadRequestException('Tipo de desconto inválido.')
    const value = kind === 'DESCONTO' || kind === 'CASHBACK' ? (d.value !== undefined ? d.value : n(cur?.value)) : null
    if ((kind === 'DESCONTO' || kind === 'CASHBACK') && !(typeof value === 'number' && value > 0)) throw new BadRequestException('Informe o valor do desconto ou do cashback.')
    if (discountType === 'PERCENTUAL' && value! > 100) throw new BadRequestException('Desconto percentual: até 100%.')
    const cfg = await this.config(user.tenantId)
    const minLevel = d.minLevel !== undefined ? d.minLevel || null : cur?.minLevel ?? null
    if (minLevel && !cfg.levels.some((l) => l.key === minLevel)) throw new BadRequestException('Nível mínimo inválido.')
    const intOrNull = (v: number | null | undefined, c: number | null | undefined, label: string) => {
      const x = v !== undefined ? v : c
      if (x === null || x === undefined) return null
      if (!Number.isInteger(x) || x < 0) throw new BadRequestException(`${label} inválido.`)
      return x
    }
    const data = {
      name: name.slice(0, 80),
      description: (d.description !== undefined ? d.description : cur?.description)?.trim().slice(0, 500) || null,
      kind,
      pointsCost,
      giftId,
      discountType,
      value: value === null || value === undefined ? null : Math.round(value * 100) / 100,
      stock: intOrNull(d.stock, cur?.stock, 'Estoque'),
      perCustomer: intOrNull(d.perCustomer, cur?.perCustomer, 'Limite por cliente'),
      minLevel,
      validityDays: kind === 'DESCONTO' || kind === 'CASHBACK' ? intOrNull(d.validityDays, cur?.validityDays, 'Validade') : null,
      active: d.active ?? cur?.active ?? true,
      sort: d.sort ?? cur?.sort ?? 0,
    }
    const row = id ? await this.prisma.loyaltyReward.update({ where: { id }, data }) : await this.prisma.loyaltyReward.create({ data: { tenantId: user.tenantId, ...data } })
    await this.audit.byUser(user, ctx, id ? 'fidelidade.premio_alterado' : 'fidelidade.premio_criado', 'loyalty_reward', row.id, { nome: data.name, tipo: kind, pontos: pointsCost, ativo: data.active })
    return { id: row.id }
  }

  async removeReward(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const r = await this.prisma.loyaltyReward.findFirst({ where: { id, tenantId: user.tenantId }, include: { _count: { select: { redemptions: true } } } })
    if (!r) throw new NotFoundException('Prêmio não encontrado.')
    if (r._count.redemptions) throw new BadRequestException('Este prêmio já foi resgatado. Desative em vez de excluir (o histórico fica).')
    await this.prisma.loyaltyReward.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'fidelidade.premio_excluido', 'loyalty_reward', id, { nome: r.name })
    return { ok: true }
  }

  // ---------- Resgates ----------

  /**
   * Resgate (pelo cliente na página ou pela equipe no painel): confere nível, estoque, limite e saldo, tira os pontos
   * e gera o código. Brinde: já lança a retirada no Controle de brindes (baixa o estoque, com as regras de lá).
   */
  async redeem(tenantId: string, leadId: string, rewardId: string, by: { user?: AuthUser; source: 'PAGINA' | 'PAINEL' }) {
    const cfg = await this.config(tenantId)
    if (!cfg.enabled) throw new BadRequestException('O programa de fidelidade está desligado.')
    const now = new Date()
    const result = await this.prisma.$transaction(async (tx) => {
      const m = await this.lockMember(tx, tenantId, leadId)
      await tx.$queryRaw`SELECT id FROM loyalty_rewards WHERE id = ${rewardId}::uuid FOR UPDATE`
      const reward = await tx.loyaltyReward.findFirst({ where: { id: rewardId, tenantId } })
      if (!reward) throw new NotFoundException('Prêmio não encontrado.')
      await this.expireLots(tx, m, now)
      const value = await this.levelValue(tx, tenantId, leadId, cfg, now)
      const used = reward.perCustomer !== null ? await tx.loyaltyRedemption.count({ where: { leadId, rewardId, status: { not: 'CANCELADO' } } }) : 0
      const problem = redemptionProblem({
        active: reward.active,
        kind: reward.kind,
        pointsCost: reward.pointsCost,
        balance: m.balance,
        stock: reward.stock,
        perCustomer: reward.perCustomer,
        usedByCustomer: used,
        minRank: levelRank(reward.minLevel, cfg.levels),
        customerRank: levelFor(value, cfg.levels).rank,
        optedOut: !!m.optOutAt,
      })
      if (problem) throw new BadRequestException(problem)
      let code = generateCode()
      for (let i = 0; i < 5 && (await tx.loyaltyRedemption.findUnique({ where: { code }, select: { id: true } })); i++) code = generateCode()
      const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { name: true, customerCode: true, clientSellerId: true, ownerId: true } })
      const days = reward.validityDays ?? cfg.codeValidityDays
      const red = await tx.loyaltyRedemption.create({
        data: {
          tenantId,
          leadId,
          rewardId,
          code,
          rewardName: reward.name,
          kind: reward.kind,
          points: reward.pointsCost,
          discountType: reward.discountType,
          value: reward.value,
          expiresAt: reward.kind === 'BRINDE' ? null : new Date(now.getTime() + days * DAY_MS),
          source: by.source,
          createdById: by.user?.id ?? null,
          createdByName: by.user?.name ?? null,
        },
      })
      await this.debit(tx, m, { kind: 'RESGATE', points: reward.pointsCost, reason: `Resgate: ${reward.name}`, redemptionId: red.id, dedupeKey: `resgate:${red.id}`, userId: by.user?.id, userName: by.user?.name }, false, now)
      if (reward.stock !== null) await tx.loyaltyReward.update({ where: { id: reward.id }, data: { stock: { decrement: 1 } } })
      if (reward.kind === 'BRINDE') {
        const deliveryId = await this.giftDelivery(tx, tenantId, cfg, reward.giftId, { name: lead?.name ?? null, customerCode: lead?.customerCode ?? null, sellerId: lead?.clientSellerId ?? lead?.ownerId ?? null }, code, by.user)
        await tx.loyaltyRedemption.update({ where: { id: red.id }, data: { giftDeliveryId: deliveryId } })
      }
      return { red, balance: m.balance }
    })
    await this.prisma.leadEvent.create({ data: { tenantId, leadId, type: 'fidelidade', title: `Fidelidade: resgatou ${result.red.rewardName} (${result.red.points} pontos)`, userId: by.user?.id ?? null, userName: by.user?.name ?? null } })
    await this.audit.log({ tenantId, userId: by.user?.id ?? null, userEmail: by.user?.email ?? null, action: 'fidelidade.resgate', entity: 'loyalty_redemption', entityId: result.red.id, data: { lead: leadId, premio: result.red.rewardName, pontos: result.red.points, origem: by.source } })
    return { redemption: this.redemptionView(result.red), balance: result.balance }
  }

  /** Retirada no Controle de brindes para o prêmio brinde (mesmas regras de estoque e cota da tela de brindes). */
  private async giftDelivery(tx: Tx, tenantId: string, cfg: FidelidadeConfig, giftId: string | null, c: { name: string | null; customerCode: string | null; sellerId: string | null }, code: string, user?: AuthUser) {
    if (!giftId) throw new BadRequestException('Prêmio sem brinde vinculado.')
    const holder = cfg.giftHolder === 'vendedor' ? (c.sellerId ? { kind: 'seller' as const, id: c.sellerId } : null) : parseHolder(cfg.giftHolder)
    if (!holder) throw new BadRequestException('Não há vendedor ou filial para entregar o brinde. Ajuste quem entrega em Fidelidade › Configurações.')
    const where = holder.kind === 'unit' ? { unitId: holder.id } : { sellerId: holder.id }
    await tx.$queryRaw`SELECT id FROM gifts WHERE id = ${giftId}::uuid FOR UPDATE`
    const gift = await tx.gift.findFirst({ where: { id: giftId, tenantId } })
    if (!gift || !gift.active) throw new BadRequestException('O brinde deste prêmio não está disponível.')
    const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
    const { start, end } = monthRange(today.slice(0, 7))
    const [quota, used] = await Promise.all([
      tx.giftQuota.findFirst({ where: { ...where, giftId }, select: { monthly: true } }),
      tx.giftDelivery.aggregate({ where: { ...where, giftId, date: { gte: start, lt: end } }, _sum: { quantity: true } }),
    ])
    const problem = deliveryProblem({ quantity: 1, stock: gift.stock, quota: quota?.monthly ?? null, used: used._sum.quantity ?? 0, giftName: gift.name, hasQuota: gift.hasQuota, who: holder.kind === 'unit' ? 'A filial' : 'O vendedor' })
    if (problem) throw new BadRequestException(user ? problem : 'Este brinde está indisponível no momento. Fale com a nossa equipe.')
    await tx.gift.update({ where: { id: gift.id }, data: { stock: { decrement: 1 } } })
    const row = await tx.giftDelivery.create({
      data: {
        tenantId,
        giftId: gift.id,
        ...where,
        customerCode: (c.customerCode || code).slice(0, 40),
        customerName: c.name?.slice(0, 160) ?? null,
        date: new Date(`${today}T00:00:00Z`),
        quantity: 1,
        unitCost: gift.unitCost,
        notes: `Fidelidade: resgate ${code}`,
        createdById: user?.id ?? null,
        createdByName: user?.name ?? 'Fidelidade (cliente)',
      },
    })
    return row.id
  }

  async redeemByStaff(user: AuthUser, leadId: string, rewardId: string, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId: user.tenantId, deletedAt: null }, select: { id: true } })
    if (!lead) throw new NotFoundException('Lead não encontrado.')
    void ctx
    const r = await this.redeem(user.tenantId, leadId, rewardId, { user, source: 'PAINEL' })
    await this.refreshLevel(user.tenantId, leadId, await this.config(user.tenantId))
    return r
  }

  async redemptions(user: AuthUser, q: { status?: string; busca?: string }) {
    this.assertCan(user)
    const s = q.busca?.trim()
    const code = s ? normalizeCode(s) : null
    const rows = await this.prisma.loyaltyRedemption.findMany({
      where: {
        tenantId: user.tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(s ? (code ? { code } : { lead: { OR: [{ name: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }] } }) : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { lead: { select: { id: true, name: true, email: true } } },
    })
    const counts = await this.prisma.loyaltyRedemption.groupBy({ by: ['status'], where: { tenantId: user.tenantId }, _count: { _all: true } })
    return { counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), items: rows.map((r) => ({ ...this.redemptionView(r), lead: r.lead })) }
  }

  /** Marca o código como usado (desconto/cashback, com o número do pedido) ou o brinde como entregue. */
  async useRedemption(user: AuthUser, id: string, d: { orderCode?: string | null }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const r = await this.prisma.loyaltyRedemption.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!r) throw new NotFoundException('Resgate não encontrado.')
    if (r.status !== 'PENDENTE') throw new BadRequestException('Este resgate já foi usado, venceu ou foi cancelado.')
    if (r.expiresAt && r.expiresAt.getTime() < Date.now()) throw new BadRequestException('Este código venceu.')
    const orderCode = d.orderCode?.trim().slice(0, 60) || null
    if (r.kind !== 'BRINDE' && !orderCode) throw new BadRequestException('Informe o número do pedido em que o código foi usado.')
    const status = r.kind === 'BRINDE' ? 'ENTREGUE' : 'USADO'
    const done = await this.prisma.loyaltyRedemption.updateMany({ where: { id, status: 'PENDENTE' }, data: { status, usedAt: new Date(), usedOrderCode: orderCode, usedById: user.id, usedByName: user.name } })
    if (!done.count) throw new BadRequestException('Este resgate acabou de ser alterado por outra pessoa.')
    await this.audit.byUser(user, ctx, 'fidelidade.resgate_usado', 'loyalty_redemption', id, { status, pedido: orderCode })
    return { ok: true, status }
  }

  /** Cancela um resgate pendente: os pontos voltam, o estoque do prêmio também, e a retirada do brinde é desfeita. */
  async cancelRedemption(user: AuthUser, id: string, reasonIn: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const reason = reasonIn?.trim()
    if (!reason) throw new BadRequestException('Informe o motivo do cancelamento.')
    const r = await this.prisma.loyaltyRedemption.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!r) throw new NotFoundException('Resgate não encontrado.')
    if (r.status !== 'PENDENTE' && r.status !== 'EXPIRADO') throw new BadRequestException('Só resgate pendente ou vencido pode ser cancelado.')
    const cfg = await this.config(user.tenantId)
    await this.prisma.$transaction(async (tx) => {
      const m = await this.lockMember(tx, user.tenantId, r.leadId)
      const changed = await tx.loyaltyRedemption.updateMany({ where: { id, status: r.status }, data: { status: 'CANCELADO', cancelReason: reason.slice(0, 300), usedById: user.id, usedByName: user.name } })
      if (!changed.count) throw new BadRequestException('Este resgate acabou de ser alterado por outra pessoa.')
      await this.credit(tx, m, { kind: 'RESGATE', points: r.points, reason: `Resgate cancelado: ${r.rewardName}`, redemptionId: r.id, dedupeKey: `resgate-cancelado:${r.id}`, userId: user.id, userName: user.name }, cfg)
      const reward = await tx.loyaltyReward.findUnique({ where: { id: r.rewardId }, select: { stock: true } })
      if (reward && reward.stock !== null) await tx.loyaltyReward.update({ where: { id: r.rewardId }, data: { stock: { increment: 1 } } })
      if (r.giftDeliveryId) {
        const d = await tx.giftDelivery.findUnique({ where: { id: r.giftDeliveryId } })
        if (d) {
          await tx.giftDelivery.delete({ where: { id: d.id } })
          await tx.gift.update({ where: { id: d.giftId }, data: { stock: { increment: d.quantity } } })
        }
      }
    })
    await this.audit.byUser(user, ctx, 'fidelidade.resgate_cancelado', 'loyalty_redemption', id, { motivo: reason, pontos: r.points })
    return { ok: true }
  }

  async findByCode(user: AuthUser, raw: string) {
    this.assertCan(user)
    const code = normalizeCode(raw)
    if (!code || !isCode(code)) throw new BadRequestException('Código inválido. O formato é FID-XXXXX-XXXXX.')
    const r = await this.prisma.loyaltyRedemption.findFirst({ where: { tenantId: user.tenantId, code }, include: { lead: { select: { id: true, name: true, email: true } } } })
    if (!r) throw new NotFoundException('Código não encontrado.')
    return { ...this.redemptionView(r), lead: r.lead }
  }

  // ---------- Avaliações ----------

  async reviews(user: AuthUser, q: { filtro?: string; meses?: number }) {
    this.assertCan(user)
    const since = new Date(Date.now() - Math.min(24, Math.max(1, q.meses ?? 12)) * 31 * DAY_MS)
    const base: Prisma.LoyaltyReviewWhereInput = { tenantId: user.tenantId, createdAt: { gte: since } }
    const filter: Prisma.LoyaltyReviewWhereInput =
      q.filtro === 'detratores'
        ? { detractor: true }
        : q.filtro === 'pendentes'
          ? { detractor: true, followUpStatus: 'PENDENTE' }
          : q.filtro === 'promotores'
            ? { nps: { gte: 9 } }
            : q.filtro === 'neutros'
              ? { nps: { gte: 7, lte: 8 } }
              : {}
    const [rows, all] = await Promise.all([
      this.prisma.loyaltyReview.findMany({ where: { ...base, ...filter }, orderBy: { createdAt: 'desc' }, take: 500, include: { lead: { select: { id: true, name: true, email: true, phone: true } } } }),
      this.prisma.loyaltyReview.findMany({ where: base, select: { nps: true, stars: true, aspects: true, detractor: true, followUpStatus: true } }),
    ])
    const aspects: Record<string, { sum: number; n: number }> = {}
    for (const r of all) {
      for (const [k, v] of Object.entries((r.aspects as Record<string, number> | null) ?? {})) {
        const a = (aspects[k] ??= { sum: 0, n: 0 })
        a.sum += v
        a.n++
      }
    }
    const stars = [1, 2, 3, 4, 5].map((s) => ({ stars: s, count: all.filter((r) => r.stars === s).length }))
    return {
      nps: npsOf(all.map((r) => r.nps)),
      stars: all.length ? Math.round((all.reduce((t, r) => t + r.stars, 0) / all.length) * 10) / 10 : null,
      starsBreakdown: stars,
      aspects: Object.fromEntries(Object.entries(aspects).map(([k, a]) => [k, Math.round((a.sum / a.n) * 10) / 10])),
      pending: all.filter((r) => r.detractor && r.followUpStatus === 'PENDENTE').length,
      items: rows.map((r) => ({
        id: r.id,
        lead: r.lead,
        orderCode: r.orderCode,
        stars: r.stars,
        nps: r.nps,
        npsClass: npsClass(r.nps),
        comment: r.comment,
        aspects: r.aspects,
        detractor: r.detractor,
        followUpStatus: r.followUpStatus,
        followUpNote: r.followUpNote,
        treatedAt: r.treatedAt,
        treatedByName: r.treatedByName,
        bonusPoints: r.bonusPoints,
        createdAt: r.createdAt,
      })),
    }
  }

  async treatReview(user: AuthUser, id: string, note: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const r = await this.prisma.loyaltyReview.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!r) throw new NotFoundException('Avaliação não encontrada.')
    const text = note?.trim()
    if (!text) throw new BadRequestException('Conte o que foi feito com o cliente.')
    await this.prisma.loyaltyReview.update({ where: { id }, data: { followUpStatus: 'TRATADO', followUpNote: text.slice(0, 1000), treatedAt: new Date(), treatedById: user.id, treatedByName: user.name } })
    await this.prisma.leadEvent.create({ data: { tenantId: user.tenantId, leadId: r.leadId, type: 'fidelidade', title: `Avaliação do pedido ${r.orderCode} tratada: ${text}`.slice(0, 300), userId: user.id, userName: user.name } })
    await this.audit.byUser(user, ctx, 'fidelidade.avaliacao_tratada', 'loyalty_review', id, { pedido: r.orderCode })
    return { ok: true }
  }

  /** Resumo para a ficha do lead (Base de leads). */
  async forLead(user: AuthUser, leadId: string) {
    this.assertCan(user)
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId: user.tenantId }, select: { id: true } })
    if (!lead) throw new NotFoundException('Lead não encontrado.')
    const s = await this.summary(user.tenantId, leadId, 20)
    return { ...s, rewards: s.member ? (await this.rewards(user)).filter((r) => r.active && r.kind !== 'BENEFICIO') : [] }
  }
}
