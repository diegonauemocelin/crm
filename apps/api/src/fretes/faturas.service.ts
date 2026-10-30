import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnit } from './acesso'
import { money } from './formula'

const n = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d))
const day = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException('Data inválida.')
  return new Date(`${s}T00:00:00Z`)
}

export interface InvoiceInput {
  carrierId: string
  unitId?: string | null
  number: string
  issuedAt?: string | null
  dueAt: string
  total: number
  notes?: string | null
  cteIds?: string[]
}

/**
 * Faturas das transportadoras: agrupam os CT-es cobrados, mostram cobrado × aprovado × contestado e registram o
 * pagamento. Valor pago fica separado do aprovado; diferença identificada não é contada como economia realizada.
 */
@Injectable()
export class FaturasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private scope(user: AuthUser): Prisma.FreightInvoiceWhereInput {
    const units = allowedUnits(user, 'fretes_financeiro')
    return { tenantId: user.tenantId, ...(units ? { unitId: { in: units } } : {}) }
  }

  private async find(user: AuthUser, id: string) {
    const f = await this.prisma.freightInvoice.findFirst({ where: { id, ...this.scope(user) } })
    if (!f) throw new NotFoundException('Fatura não encontrada.')
    return f
  }

  /** Somas dos CT-es da fatura: cobrado, aprovado, contestado em aberto e crédito obtido. */
  private async totals(invoiceIds: string[]) {
    const ctes = await this.prisma.freightCte.findMany({
      where: { invoiceId: { in: invoiceIds } },
      select: { invoiceId: true, total: true, approvedValue: true, expectedTotal: true, decision: true, contestStatus: true, creditValue: true, fiscalStatus: true, recStatus: true },
    })
    const by = new Map<string, { count: number; charged: number; approved: number; pendingDecision: number; contested: number; credit: number; cancelled: number }>()
    for (const c of ctes) {
      const t = by.get(c.invoiceId!) ?? { count: 0, charged: 0, approved: 0, pendingDecision: 0, contested: 0, credit: 0, cancelled: 0 }
      t.count++
      if (c.fiscalStatus === 'CANCELADO') t.cancelled++
      else {
        t.charged += Number(c.total)
        t.approved += n(c.approvedValue) ?? 0
        if (!c.decision) t.pendingDecision++
        if (c.contestStatus === 'ABERTA') t.contested += Number(c.total) - (n(c.approvedValue) ?? 0)
        t.credit += n(c.creditValue) ?? 0
      }
      by.set(c.invoiceId!, t)
    }
    return (id: string) => {
      const t = by.get(id) ?? { count: 0, charged: 0, approved: 0, pendingDecision: 0, contested: 0, credit: 0, cancelled: 0 }
      return { ...t, charged: money(t.charged), approved: money(t.approved), contested: money(t.contested), credit: money(t.credit) }
    }
  }

  private view(f: Prisma.FreightInvoiceGetPayload<object>, totals: ReturnType<Awaited<ReturnType<FaturasService['totals']>>>, extra: Record<string, unknown> = {}) {
    const total = Number(f.total)
    return {
      id: f.id,
      carrierId: f.carrierId,
      unitId: f.unitId,
      number: f.number,
      issuedAt: f.issuedAt?.toISOString().slice(0, 10) ?? null,
      dueAt: f.dueAt.toISOString().slice(0, 10),
      total,
      status: f.status,
      paidAt: f.paidAt?.toISOString().slice(0, 10) ?? null,
      paidValue: n(f.paidValue),
      paymentNote: f.paymentNote,
      notes: f.notes,
      createdByName: f.createdByName,
      createdAt: f.createdAt,
      ctes: totals,
      /** Fatura maior que a soma dos CT-es: cobrança sem CT-e correspondente. */
      unmatched: money(total - totals.charged),
      /** O que pagar: o aprovado nos CT-es (sem o contestado em aberto). */
      toPay: totals.approved,
      ...extra,
    }
  }

  private async validate(user: AuthUser, d: InvoiceInput) {
    const carrier = await this.prisma.freightCarrier.findFirst({ where: { id: d.carrierId, tenantId: user.tenantId } })
    if (!carrier) throw new BadRequestException('Transportadora inválida.')
    if (d.unitId) assertUnit(user, 'fretes_financeiro', d.unitId)
    else if (allowedUnits(user, 'fretes_financeiro')) throw new BadRequestException('Informe a filial da fatura.')
    const number = cleanText(d.number, 40)
    if (!number) throw new BadRequestException('Informe o número da fatura.')
    if (!(d.total > 0)) throw new BadRequestException('Informe o valor da fatura.')
    return { carrierId: carrier.id, unitId: d.unitId || null, number, issuedAt: d.issuedAt ? day(d.issuedAt) : null, dueAt: day(d.dueAt), total: d.total, notes: cleanText(d.notes, 2000, true) || null }
  }

  /** Liga os CT-es (da mesma transportadora, sem outra fatura) à fatura. */
  private async attach(user: AuthUser, invoiceId: string, carrierId: string, cteIds: string[]) {
    if (!cteIds.length) return
    const units = allowedUnits(user, 'fretes_financeiro')
    const ok = await this.prisma.freightCte.findMany({ where: { id: { in: cteIds }, tenantId: user.tenantId, carrierId, OR: [{ invoiceId: null }, { invoiceId }], ...(units ? { unitId: { in: units } } : {}) }, select: { id: true } })
    if (ok.length !== new Set(cteIds).size) throw new BadRequestException('Algum CT-e é de outra transportadora, de filial não liberada ou já está em outra fatura.')
    await this.prisma.freightCte.updateMany({ where: { id: { in: cteIds } }, data: { invoiceId } })
  }

  async list(user: AuthUser, f: { carrierId?: string; status?: string; from?: string; to?: string; unitId?: string }) {
    assertCan(user, 'fretes_financeiro', 'view')
    const and: Prisma.FreightInvoiceWhereInput[] = [this.scope(user)]
    if (f.carrierId) and.push({ carrierId: f.carrierId })
    if (f.unitId) and.push({ unitId: f.unitId })
    if (f.status === 'VENCIDA') and.push({ status: { in: ['ABERTA', 'APROVADA'] }, dueAt: { lt: new Date(new Date().toISOString().slice(0, 10)) } })
    else if (f.status) and.push({ status: f.status })
    if (f.from) and.push({ dueAt: { gte: day(f.from) } })
    if (f.to) and.push({ dueAt: { lte: day(f.to) } })
    const rows = await this.prisma.freightInvoice.findMany({ where: { AND: and }, orderBy: [{ dueAt: 'asc' }], take: 500 })
    const totals = await this.totals(rows.map((r) => r.id))
    const carriers = await this.prisma.freightCarrier.findMany({ where: { id: { in: rows.map((r) => r.carrierId) } }, select: { id: true, name: true } })
    return rows.map((r) => this.view(r, totals(r.id), { carrierName: carriers.find((c) => c.id === r.carrierId)?.name ?? null }))
  }

  async get(user: AuthUser, id: string) {
    assertCan(user, 'fretes_financeiro', 'view')
    const f = await this.find(user, id)
    const [totals, ctes, carrier] = await Promise.all([
      this.totals([id]),
      this.prisma.freightCte.findMany({ where: { invoiceId: id }, orderBy: { issuedAt: 'asc' } }),
      this.prisma.freightCarrier.findUnique({ where: { id: f.carrierId }, select: { name: true } }),
    ])
    return this.view(f, totals(id), {
      carrierName: carrier?.name ?? null,
      cteList: ctes.map((c) => ({ id: c.id, number: c.number, issuedAt: c.issuedAt, cityFim: c.cityFim, ufFim: c.ufFim, total: Number(c.total), expectedTotal: n(c.expectedTotal), approvedValue: n(c.approvedValue), recStatus: c.recStatus, decision: c.decision, contestStatus: c.contestStatus, fiscalStatus: c.fiscalStatus })),
    })
  }

  /** CT-es da transportadora ainda sem fatura (para montar a fatura). Aceita uma lista de números colada. */
  async openCtes(user: AuthUser, carrierId: string, numbers?: string) {
    assertCan(user, 'fretes_financeiro', 'view')
    const units = allowedUnits(user, 'fretes_financeiro')
    const list = (numbers ?? '').split(/[^\d]+/).filter(Boolean).map((x) => String(Number(x)))
    const rows = await this.prisma.freightCte.findMany({
      where: { tenantId: user.tenantId, carrierId, invoiceId: null, fiscalStatus: { not: 'CANCELADO' }, ...(units ? { unitId: { in: units } } : {}), ...(list.length ? { number: { in: list } } : {}) },
      orderBy: { issuedAt: 'asc' },
      take: 1000,
    })
    return rows.map((c) => ({ id: c.id, number: c.number, issuedAt: c.issuedAt, cityFim: c.cityFim, ufFim: c.ufFim, total: Number(c.total), approvedValue: n(c.approvedValue), recStatus: c.recStatus, decision: c.decision }))
  }

  async create(user: AuthUser, d: InvoiceInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_financeiro', 'create')
    const data = await this.validate(user, d)
    if (await this.prisma.freightInvoice.count({ where: { tenantId: user.tenantId, carrierId: data.carrierId, number: data.number } })) throw new ConflictException('Esta fatura já foi lançada para a transportadora.')
    const f = await this.prisma.freightInvoice.create({ data: { tenantId: user.tenantId, ...data, createdByName: user.name.slice(0, 120) } })
    await this.attach(user, f.id, f.carrierId, d.cteIds ?? [])
    await this.audit.byUser(user, ctx, 'frete.fatura.lancada', 'freight_invoice', f.id, { numero: f.number, valor: data.total, ctes: d.cteIds?.length ?? 0 })
    return this.get(user, f.id)
  }

  async update(user: AuthUser, id: string, d: InvoiceInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_financeiro', 'edit')
    const cur = await this.find(user, id)
    if (cur.status === 'PAGA' || cur.status === 'CANCELADA') throw new BadRequestException('Fatura paga ou cancelada não muda.')
    const data = await this.validate(user, { ...d, carrierId: cur.carrierId })
    await this.prisma.freightInvoice.update({ where: { id }, data })
    if (d.cteIds) {
      await this.prisma.freightCte.updateMany({ where: { invoiceId: id, id: { notIn: d.cteIds } }, data: { invoiceId: null } })
      await this.attach(user, id, cur.carrierId, d.cteIds)
    }
    await this.audit.byUser(user, ctx, 'frete.fatura.alterada', 'freight_invoice', id, { numero: data.number, valor: data.total, ctes: d.cteIds?.length })
    return this.get(user, id)
  }

  /** Aprovar (pronta para pagar), pagar, reabrir ou cancelar. */
  async setStatus(user: AuthUser, id: string, d: { status: 'ABERTA' | 'APROVADA' | 'PAGA' | 'CANCELADA'; paidAt?: string | null; paidValue?: number | null; note?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_financeiro', 'edit')
    const cur = await this.find(user, id)
    if (cur.status === 'CANCELADA') throw new BadRequestException('Fatura cancelada.')
    const data: Prisma.FreightInvoiceUpdateInput = { status: d.status }
    if (d.status === 'PAGA') {
      if (!d.paidAt || !(d.paidValue && d.paidValue > 0)) throw new BadRequestException('Informe a data e o valor pago.')
      data.paidAt = day(d.paidAt)
      data.paidValue = d.paidValue
      data.paymentNote = cleanText(d.note, 500) || null
    } else if (d.status === 'APROVADA') {
      const t = (await this.totals([id]))(id)
      if (t.pendingDecision > 0) throw new BadRequestException(`${t.pendingDecision} CT-e(s) desta fatura ainda sem decisão na conciliação.`)
    } else if (d.status === 'CANCELADA') {
      if (!cleanText(d.note, 500)) throw new BadRequestException('Informe o motivo do cancelamento.')
      data.notes = [cur.notes, `Cancelada: ${cleanText(d.note, 500)}`].filter(Boolean).join('\n')
      await this.prisma.freightCte.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } })
    } else {
      data.paidAt = null
      data.paidValue = null
    }
    await this.prisma.freightInvoice.update({ where: { id }, data })
    await this.audit.byUser(user, ctx, 'frete.fatura.situacao', 'freight_invoice', id, { numero: cur.number, de: cur.status, para: d.status, pago: d.paidValue ?? null, data: d.paidAt ?? null })
    return this.get(user, id)
  }
}
