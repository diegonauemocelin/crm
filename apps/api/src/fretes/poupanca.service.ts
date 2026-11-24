import { randomUUID } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { can } from '../common/permissions'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan } from './acesso'
import { campaignOn, cleanWalletCampaigns, pctFor, surchargeBase, WALLET_KEY, walletBalances, walletEntry, type WalletCampaign } from './poupanca'

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d))

/** Poupança de frete dos vendedores: campanhas, saldo por vendedor, extrato e usos (ver poupanca.ts). */
@Injectable()
export class PoupancaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async campaigns(tenantId: string): Promise<WalletCampaign[]> {
    // O settings.get mistura com o padrão como objeto: a lista volta com as posições como chaves.
    const raw = await this.settings.get<Record<string, unknown>>(tenantId, WALLET_KEY, {})
    return cleanWalletCampaigns(Array.isArray(raw) ? raw : Object.values(raw), () => randomUUID())
  }

  async list(user: AuthUser) {
    assertCan(user, 'fretes_pedidos', 'view')
    return this.campaigns(user.tenantId)
  }

  async saveCampaigns(user: AuthUser, raw: unknown, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'edit')
    const list = cleanWalletCampaigns(raw, () => randomUUID())
    await this.settings.set(user.tenantId, WALLET_KEY, list)
    await this.audit.byUser(user, ctx, 'frete.poupanca.campanhas', 'settings', WALLET_KEY, { campanhas: list.map((c) => `${c.name} ${c.pct}%${c.sellerPcts.length ? ` (${c.sellerPcts.map((s) => `${s.seller} ${s.pct}%`).join(', ')})` : ''} ${c.start}..${c.end}${c.active ? '' : ' (inativa)'}`) })
    return list
  }

  /** Campanha que vale hoje (para a cotação mostrar quanto cobrar do cliente): quem cota ou quem vê os pedidos. */
  async currentFor(user: AuthUser) {
    if (!(['fretes_cotacao', 'fretes_pedidos'] as const).some((m) => can(user.permissions, user.role.isSystem, m, 'view'))) throw new ForbiddenException('Você não tem permissão para esta ação.')
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const c = campaignOn(await this.campaigns(user.tenantId), today)
    if (!c) return null
    // % de quem está cotando: o vendedor ligado ao login (ou o nome da pessoa), se tiver % próprio na campanha.
    const seller = (await this.prisma.seller.findFirst({ where: { tenantId: user.tenantId, userId: user.id }, select: { name: true } }))?.name ?? user.name
    const pct = pctFor(c, seller)
    return { id: c.id, name: c.name, pct, end: c.end, seller: pct !== c.pct ? seller : null }
  }

  private async campaign(user: AuthUser, id: string) {
    const c = (await this.campaigns(user.tenantId)).find((x) => x.id === id)
    if (!c) throw new NotFoundException('Campanha não encontrada.')
    return c
  }

  /** Notas CIF com vendedor emitidas no período da campanha, com a cotação do pedido e o CT-e (soma dos não cancelados). */
  private async notes(user: AuthUser, c: WalletCampaign, seller?: string) {
    const units = allowedUnits(user, 'fretes_pedidos')
    const start = new Date(`${c.start}T00:00:00-03:00`)
    const end = new Date(new Date(`${c.end}T00:00:00-03:00`).getTime() + 86_400_000)
    const rows = await this.prisma.$queryRaw<
      { key: string; number: number; issuedAt: Date | null; seller: string; nota: Prisma.Decimal | null; code: number; customerName: string | null; quote: Prisma.Decimal | null; cte: Prisma.Decimal | null; tabela: Prisma.Decimal | null; numbers: string | null; quoteId: string | null }[]
    >`
      SELECT n.key, n.number, n."issuedAt", n.seller, n."freightValue" AS nota, s.code, s."customerName", s."expectedTotal" AS quote, s."quoteId", c.total AS cte, c.expected AS tabela, c.numbers
      FROM freight_nfes n
      JOIN freight_shipments s ON s."tenantId" = n."tenantId" AND s."invoiceKey" = n.key AND s.status <> 'CANCELADO'
      LEFT JOIN (
        SELECT "shipmentId", sum(total) AS total, CASE WHEN count("expectedTotal") > 0 THEN sum("expectedTotal") END AS expected, string_agg(number, ', ') AS numbers
        FROM freight_ctes WHERE "tenantId" = ${user.tenantId}::uuid AND "shipmentId" IS NOT NULL AND "fiscalStatus" <> 'CANCELADO' GROUP BY "shipmentId"
      ) c ON c."shipmentId" = s.id
      WHERE n."tenantId" = ${user.tenantId}::uuid AND n."freightMode" = '0' AND n.status <> 'CANCELADA' AND n.seller IS NOT NULL
        AND n."issuedAt" >= ${start} AND n."issuedAt" < ${end}
        ${units ? Prisma.sql`AND s."unitId" = ANY(${units}::uuid[])` : Prisma.empty}
        ${seller ? Prisma.sql`AND n.seller = ${seller}` : Prisma.empty}
      ORDER BY n."issuedAt" DESC
      LIMIT 50000`
    // Transportadora escolhida com reajuste de tabela: a base é o frete + reajuste (o que vai para o cliente antes do %).
    const quoteIds = [...new Set(rows.map((r) => r.quoteId).filter((x): x is string => !!x))]
    const surcharged = new Map<string, number>()
    for (let i = 0; i < quoteIds.length; i += 1000) {
      for (const q of await this.prisma.freightQuote.findMany({ where: { id: { in: quoteIds.slice(i, i + 1000) }, tenantId: user.tenantId }, select: { id: true, results: true, selectedTableId: true } })) {
        const b = surchargeBase(q.results, q.selectedTableId)
        if (b !== null) surcharged.set(q.id, b)
      }
    }
    return rows.map((r) => {
      const cte = num(r.cte)
      const quote = (r.quoteId ? surcharged.get(r.quoteId) : undefined) ?? num(r.quote)
      const base = { key: r.key, number: r.number, issuedAt: r.issuedAt, seller: r.seller, code: r.code, customerName: r.customerName, cteNumbers: r.numbers, nota: num(r.nota) ?? 0, cte, quote, table: num(r.tabela) }
      return { ...base, pct: pctFor(c, r.seller), entry: walletEntry({ nota: base.nota, cte, quote: base.quote, table: base.table }, pctFor(c, r.seller)) }
    })
  }

  /** Saldo de cada vendedor na campanha. */
  async balances(user: AuthUser, campaignId: string) {
    assertCan(user, 'fretes_pedidos', 'view')
    const c = await this.campaign(user, campaignId)
    const [notes, moves] = await Promise.all([this.notes(user, c), this.prisma.freightWalletMove.groupBy({ by: ['seller'], where: { tenantId: user.tenantId, campaignId }, _sum: { value: true } })])
    const done = notes.filter((x) => x.entry)
    const pending = new Map<string, number>()
    for (const x of notes) if (!x.entry) pending.set(x.seller, (pending.get(x.seller) ?? 0) + 1)
    const sellers = walletBalances(
      done.map((x) => ({ seller: x.seller, nota: x.nota, cte: x.cte ?? 0, markup: x.entry!.markup, saldo: x.entry!.saldo })),
      moves.map((m) => ({ seller: m.seller, value: num(m._sum.value) ?? 0 })),
      [...pending].map(([seller, count]) => ({ seller, count })),
    )
    const sum = (k: 'saldo' | 'credito' | 'debito' | 'movimentos' | 'markup') => Math.round(sellers.reduce((s, x) => s + x[k], 0) * 100) / 100
    return { campaign: c, sellers, totals: { saldo: sum('saldo'), credito: sum('credito'), debito: sum('debito'), usado: sum('movimentos'), acrescimo: sum('markup') } }
  }

  /** Extrato do vendedor na campanha: cada nota e os usos/ajustes. */
  async statement(user: AuthUser, campaignId: string, seller: string) {
    assertCan(user, 'fretes_pedidos', 'view')
    const c = await this.campaign(user, campaignId)
    const [notes, moves] = await Promise.all([this.notes(user, c, seller), this.prisma.freightWalletMove.findMany({ where: { tenantId: user.tenantId, campaignId, seller }, orderBy: { createdAt: 'desc' } })])
    return { campaign: c, seller, notes, moves: moves.map((m) => ({ ...m, value: Number(m.value) })) }
  }

  /** Uso do saldo em outra negociação (tira do saldo) ou ajuste (+/-). */
  async addMove(user: AuthUser, campaignId: string, d: { seller: string; kind: 'USO' | 'AJUSTE'; value: number; note?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'edit')
    await this.campaign(user, campaignId)
    const seller = d.seller.trim().slice(0, 120)
    if (!seller) throw new BadRequestException('Informe o vendedor.')
    if (!(Math.abs(d.value) > 0)) throw new BadRequestException('Informe o valor.')
    const value = Math.round((d.kind === 'USO' ? -Math.abs(d.value) : d.value) * 100) / 100
    const note = cleanText(d.note, 500) || null
    if (d.kind === 'USO' && !note) throw new BadRequestException('Diga em qual negociação o saldo foi usado (pedido, NF ou cliente).')
    const m = await this.prisma.freightWalletMove.create({ data: { tenantId: user.tenantId, campaignId, seller, kind: d.kind, value, note, createdByName: user.name.slice(0, 120) } })
    await this.audit.byUser(user, ctx, 'frete.poupanca.movimento', 'freight_wallet_move', m.id, { vendedor: seller, tipo: d.kind, valor: value })
    return { ...m, value: Number(m.value) }
  }

  async deleteMove(user: AuthUser, id: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'edit')
    const m = await this.prisma.freightWalletMove.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!m) throw new NotFoundException('Movimento não encontrado.')
    await this.prisma.freightWalletMove.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'frete.poupanca.movimento_excluido', 'freight_wallet_move', id, { vendedor: m.seller, tipo: m.kind, valor: Number(m.value) })
    return { ok: true }
  }
}
