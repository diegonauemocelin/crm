import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnit } from './acesso'
import { SHIPMENT_STATUS, type ShipmentStatus } from './catalogo'
import { normalizeCep, normalizeUf, validCnpj, validCpf } from './cep'
import type { QuoteResult } from './cotacao.service'
import { parseNumber } from './importacao'
import { addBusinessDays } from './motor'
import { todayUtc } from './tabelas.service'
import { CteService } from './cte.service'
import { compareFreight, type FreightFilter } from './confronto'
import { AUDIT_CAUSES, type AuditCause, type AuditStatus, auditHints, hasDifference, suggestedCause } from './conferencia'

export interface ShipmentInput {
  unitId: string
  orderNumber?: string | null
  invoiceNumber?: string | null
  invoiceKey?: string | null
  customerName?: string | null
  customerDoc?: string | null
  personType?: 'PF' | 'PJ'
  destZip?: string | null
  destCity?: string | null
  destUf?: string | null
  cargoValue?: number | null
  weight?: number | null
  volumesCount?: number | null
  carrierId?: string | null
  trackingCode?: string | null
  notes?: string | null
}

const PAGE = 30
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const n = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d))

/** Referência da conciliação: a opção escolhida na cotação, como foi calculada. */
export function expectedFromResult(r: QuoteResult, quoteCode: number) {
  return {
    quoteCode,
    tableId: r.tableId,
    tableName: r.tableName,
    versionId: r.versionId,
    versionNumber: r.versionNumber,
    carrierName: r.carrierName,
    total: r.total,
    components: r.components,
    icms: r.icms,
    weights: r.weights,
    deadlineDays: r.deadlineDays,
  }
}

/** Pedidos expedidos: do pedido/NF à cotação escolhida, à coleta, à entrega e ao CT-e. */
@Injectable()
export class PedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cteService: CteService,
  ) {}

  private view(s: Prisma.FreightShipmentGetPayload<object>, extra: Record<string, unknown> = {}) {
    return {
      id: s.id,
      code: s.code,
      unitId: s.unitId,
      orderNumber: s.orderNumber,
      invoiceNumber: s.invoiceNumber,
      invoiceKey: s.invoiceKey,
      customerName: s.customerName,
      customerDoc: s.customerDoc,
      personType: s.personType,
      destZip: s.destZip,
      destCity: s.destCity,
      destUf: s.destUf,
      cargoValue: n(s.cargoValue),
      weight: n(s.weight),
      volumesCount: s.volumesCount,
      carrierId: s.carrierId,
      quoteId: s.quoteId,
      expected: s.expected,
      expectedTotal: n(s.expectedTotal),
      status: s.status,
      collectedAt: s.collectedAt,
      shippedAt: s.shippedAt,
      expectedDeliveryAt: iso(s.expectedDeliveryAt),
      deliveredAt: s.deliveredAt,
      trackingCode: s.trackingCode,
      trackingAt: s.trackingAt,
      trackingLast: s.trackingLast,
      trackingCarrier: s.trackingCarrier,
      notes: s.notes,
      createdByName: s.createdByName,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      ...extra,
    }
  }

  async find(user: AuthUser, id: string) {
    const units = allowedUnits(user, 'fretes_pedidos')
    const s = await this.prisma.freightShipment.findFirst({ where: { id, tenantId: user.tenantId, ...(units ? { unitId: { in: units } } : {}) } })
    if (!s) throw new NotFoundException('Pedido não encontrado.')
    return s
  }

  private async validate(user: AuthUser, d: ShipmentInput) {
    assertUnit(user, 'fretes_pedidos', d.unitId)
    if (!(await this.prisma.unit.count({ where: { id: d.unitId, tenantId: user.tenantId } }))) throw new BadRequestException('Filial inválida.')
    const key = d.invoiceKey ? d.invoiceKey.replace(/\D/g, '') : null
    if (key && key.length !== 44) throw new BadRequestException('A chave da NF-e tem 44 dígitos.')
    const doc = d.customerDoc ? d.customerDoc.replace(/\D/g, '') : null
    if (doc && !(doc.length === 11 ? validCpf(doc) : doc.length === 14 ? validCnpj(doc) : false)) throw new BadRequestException('CPF/CNPJ do cliente inválido.')
    const zip = d.destZip ? normalizeCep(d.destZip) : null
    if (d.destZip && !zip) throw new BadRequestException('CEP de destino inválido.')
    const uf = d.destUf ? normalizeUf(d.destUf) : null
    if (d.destUf && !uf) throw new BadRequestException('UF inválida.')
    if (d.carrierId && !(await this.prisma.freightCarrier.count({ where: { id: d.carrierId, tenantId: user.tenantId } }))) throw new BadRequestException('Transportadora inválida.')
    if ((d.cargoValue ?? 0) < 0 || (d.weight ?? 0) < 0) throw new BadRequestException('Valor e peso não podem ser negativos.')
    return {
      unitId: d.unitId,
      orderNumber: cleanText(d.orderNumber, 40) || null,
      // Número da NF: da chave (posições 26 a 34) quando não informado.
      invoiceNumber: cleanText(d.invoiceNumber, 20) || (key ? String(Number(key.slice(25, 34))) : null),
      invoiceKey: key,
      customerName: cleanText(d.customerName, 160) || null,
      customerDoc: doc,
      personType: d.personType ?? (doc?.length === 11 ? 'PF' : 'PJ'),
      destZip: zip,
      destCity: cleanText(d.destCity, 120) || null,
      destUf: uf,
      cargoValue: d.cargoValue ?? null,
      weight: d.weight ?? null,
      volumesCount: d.volumesCount ?? null,
      carrierId: d.carrierId || null,
      trackingCode: cleanText(d.trackingCode, 60) || null,
      notes: cleanText(d.notes, 2000, true) || null,
    }
  }

  async list(user: AuthUser, f: { unitId?: string; status?: string; carrierId?: string; from?: string; to?: string; search?: string; page?: number; late?: boolean; freight?: FreightFilter; seller?: string }) {
    assertCan(user, 'fretes_pedidos', 'view')
    const units = allowedUnits(user, 'fretes_pedidos')
    const and: Prisma.FreightShipmentWhereInput[] = [{ tenantId: user.tenantId }]
    if (units) and.push({ unitId: { in: units } })
    if (f.unitId) and.push({ unitId: f.unitId })
    if (f.status && (SHIPMENT_STATUS as readonly string[]).includes(f.status)) and.push({ status: f.status })
    if (f.carrierId) and.push({ carrierId: f.carrierId })
    // Atrasados: previsão de entrega vencida e ainda não entregue (mesmo critério do alerta).
    if (f.late) and.push({ status: { in: ['DESPACHADO', 'EM_TRANSITO', 'AGUARDANDO_COLETA'] }, expectedDeliveryAt: { lt: todayUtc() } })
    if (f.from) and.push({ createdAt: { gte: new Date(`${f.from}T00:00:00-03:00`) } })
    if (f.to) and.push({ createdAt: { lt: new Date(new Date(`${f.to}T00:00:00-03:00`).getTime() + 86_400_000) } })
    const term = f.search?.trim()
    if (term) {
      const digits = term.replace(/\D/g, '')
      and.push({
        OR: [
          { orderNumber: { contains: term, mode: 'insensitive' } },
          { invoiceNumber: { contains: term, mode: 'insensitive' } },
          { customerName: { contains: term, mode: 'insensitive' } },
          { trackingCode: { contains: term, mode: 'insensitive' } },
          ...(digits.length === 44 ? [{ invoiceKey: digits }] : []),
          ...(/^\d{1,9}$/.test(term) ? [{ code: Number(term) }] : []),
        ],
      })
    }
    const rec = await this.cteService.recSettings(user.tenantId)
    if (f.freight === 'NOTA_MAIOR' || f.freight === 'NOTA_MENOR') {
      // Frete da nota CIF × soma dos CT-es (não cancelados) do pedido, além da folga do confronto (mesma regra de compareFreight).
      const cond = f.freight === 'NOTA_MAIOR' ? Prisma.sql`COALESCE(n."freightValue", 0) - c.total > ${rec.nfeValor}::numeric` : Prisma.sql`COALESCE(n."freightValue", 0) - c.total < ${-rec.nfeValor}::numeric`
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM freight_shipments s
        JOIN freight_nfes n ON n."tenantId" = s."tenantId" AND n.key = s."invoiceKey"
        JOIN (SELECT "shipmentId", sum(total) AS total FROM freight_ctes WHERE "tenantId" = ${user.tenantId}::uuid AND "shipmentId" IS NOT NULL AND "fiscalStatus" <> 'CANCELADO' GROUP BY "shipmentId") c ON c."shipmentId" = s.id
        WHERE s."tenantId" = ${user.tenantId}::uuid AND n."freightMode" = '0' AND ${cond}`
      and.push({ id: { in: ids.map((r) => r.id) } })
    }
    if (f.freight === 'NOTA_MENOR_ESPERADO') {
      // Nota CIF com frete abaixo do CT-e (soma dos não cancelados) ou do cotado, além da folga: o vendedor cobrou menos.
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM freight_shipments s
        JOIN freight_nfes n ON n."tenantId" = s."tenantId" AND n.key = s."invoiceKey"
        LEFT JOIN (SELECT "shipmentId", sum(total) AS total, sum("expectedTotal") AS expected FROM freight_ctes WHERE "tenantId" = ${user.tenantId}::uuid AND "shipmentId" IS NOT NULL AND "fiscalStatus" <> 'CANCELADO' GROUP BY "shipmentId") c ON c."shipmentId" = s.id
        WHERE s."tenantId" = ${user.tenantId}::uuid AND n."freightMode" = '0'
          AND ((c.total > 0 AND COALESCE(n."freightValue", 0) - c.total < ${-rec.nfeValor}::numeric)
            OR (c.expected > 0 AND COALESCE(n."freightValue", 0) - c.expected < ${-rec.nfeValor}::numeric)
            OR (s."expectedTotal" > 0 AND COALESCE(n."freightValue", 0) - s."expectedTotal" < ${-rec.nfeValor}::numeric))`
      and.push({ id: { in: ids.map((r) => r.id) } })
    }
    const seller = f.seller?.trim()
    if (seller) {
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM freight_shipments s
        JOIN freight_nfes n ON n."tenantId" = s."tenantId" AND n.key = s."invoiceKey"
        WHERE s."tenantId" = ${user.tenantId}::uuid AND n.seller = ${seller}`
      and.push({ id: { in: ids.map((r) => r.id) } })
    }
    const page = Math.max(1, f.page ?? 1)
    const where = { AND: and }
    const [total, rows, byStatus] = await Promise.all([
      this.prisma.freightShipment.count({ where }),
      this.prisma.freightShipment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE }),
      this.prisma.freightShipment.groupBy({ by: ['status'], where: { tenantId: user.tenantId, ...(units ? { unitId: { in: units } } : {}), ...(f.unitId ? { unitId: f.unitId } : {}) }, _count: { _all: true } }),
    ])
    const keys = rows.map((r) => r.invoiceKey).filter((x): x is string => !!x)
    const [carriers, ctes, nfes] = await Promise.all([
      this.prisma.freightCarrier.findMany({ where: { id: { in: rows.map((r) => r.carrierId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.prisma.freightCte.findMany({ where: { shipmentId: { in: rows.map((r) => r.id) } }, select: { shipmentId: true, number: true, total: true, recStatus: true, fiscalStatus: true, expectedTotal: true } }),
      keys.length ? this.prisma.freightNfe.findMany({ where: { tenantId: user.tenantId, key: { in: keys } }, select: { key: true, freightValue: true, freightMode: true, seller: true } }) : [],
    ])
    return {
      total,
      page,
      pageSize: PAGE,
      counts: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      ...(await this.lastNfeInfo(user.tenantId, units, f.unitId)),
      items: rows.map((r) => {
        const c = ctes.find((x) => x.shipmentId === r.id)
        return this.view(r, { carrierName: carriers.find((x) => x.id === r.carrierId)?.name ?? null, cte: c ? { number: c.number, total: Number(c.total), recStatus: c.recStatus } : null, seller: (r.invoiceKey && nfes.find((x) => x.key === r.invoiceKey)?.seller) || null, tableExpected: tableExpected(ctes.filter((x) => x.shipmentId === r.id)), freightCheck: this.freightCheck(r.invoiceKey, nfes, ctes.filter((x) => x.shipmentId === r.id), rec.nfeValor) })
      }),
    }
  }

  /**
   * Conferência de frete: por pedido, frete cobrado na nota, cobrado no CT-e (soma dos não cancelados) e esperado pela
   * tabela do CRM; "Só com diferença" traz só os que têm diferença além da folga da conciliação.
   */
  async freightAudit(user: AuthUser, f: { unitId?: string; carrierId?: string; seller?: string; from?: string; to?: string; status?: 'PENDENTE' | 'OK' | 'DIVERGENTE' | 'TODOS'; mode?: 'CIF' | 'FOB' | 'TODOS'; onlyDiff?: boolean; search?: string; page?: number }) {
    assertCan(user, 'fretes_pedidos', 'view')
    const rec = await this.cteService.recSettings(user.tenantId)
    const tol = rec.nfeValor
    const units = allowedUnits(user, 'fretes_pedidos')
    const conds: Prisma.Sql[] = [Prisma.sql`s."tenantId" = ${user.tenantId}::uuid`, Prisma.sql`s.status <> 'CANCELADO'`]
    if (units) conds.push(Prisma.sql`s."unitId" = ANY(${units}::uuid[])`)
    if (f.unitId) conds.push(Prisma.sql`s."unitId" = ${f.unitId}::uuid`)
    if (f.carrierId) conds.push(Prisma.sql`s."carrierId" = ${f.carrierId}::uuid`)
    if (f.seller?.trim()) conds.push(Prisma.sql`n.seller = ${f.seller.trim()}`)
    if (f.from) conds.push(Prisma.sql`COALESCE(n."issuedAt", s."createdAt") >= ${new Date(`${f.from}T00:00:00-03:00`)}`)
    if (f.to) conds.push(Prisma.sql`COALESCE(n."issuedAt", s."createdAt") < ${new Date(new Date(`${f.to}T00:00:00-03:00`).getTime() + 86_400_000)}`)
    // Modalidade do frete na NF-e: CIF (0, a empresa paga a transportadora) é o padrão; FOB e demais, o cliente ou terceiro.
    const mode = f.mode ?? 'CIF'
    if (mode === 'CIF') conds.push(Prisma.sql`n."freightMode" = '0'`)
    else if (mode === 'FOB') conds.push(Prisma.sql`n."freightMode" IS NOT NULL AND n."freightMode" <> '0'`)
    const st = f.status ?? 'PENDENTE'
    if (st === 'PENDENTE') conds.push(Prisma.sql`s."auditStatus" IS NULL`)
    else if (st !== 'TODOS') conds.push(Prisma.sql`s."auditStatus" = ${st}`)
    const term = f.search?.trim()
    if (term) {
      const like = `%${term}%`
      conds.push(Prisma.sql`(s."invoiceNumber" ILIKE ${like} OR s."orderNumber" ILIKE ${like} OR s."customerName" ILIKE ${like} OR c.numbers ILIKE ${like}${/^\d{1,9}$/.test(term) ? Prisma.sql` OR s.code = ${Number(term)}` : Prisma.empty})`)
    }
    if (f.onlyDiff !== false) {
      // Mesmas regras de auditHints (nota CIF abaixo do CT-e ou da tabela; CT-e acima da tabela).
      conds.push(Prisma.sql`(
        (n."freightMode" = '0' AND c.total > 0 AND COALESCE(n."freightValue", 0) - c.total < ${-tol}::numeric)
        OR (n."freightMode" = '0' AND c.expected > 0 AND COALESCE(n."freightValue", 0) - c.expected < ${-tol}::numeric)
        OR (c.expected IS NOT NULL AND c.total - c.expected > ${tol}::numeric))`)
    }
    const from = Prisma.sql`
      FROM freight_shipments s
      LEFT JOIN freight_nfes n ON n."tenantId" = s."tenantId" AND n.key = s."invoiceKey"
      LEFT JOIN (
        SELECT "shipmentId", sum(total) AS total, CASE WHEN count("expectedTotal") > 0 THEN sum("expectedTotal") END AS expected, string_agg(number, ', ') AS numbers
        FROM freight_ctes WHERE "tenantId" = ${user.tenantId}::uuid AND "shipmentId" IS NOT NULL AND "fiscalStatus" <> 'CANCELADO' GROUP BY "shipmentId"
      ) c ON c."shipmentId" = s.id
      WHERE ${Prisma.join(conds, ' AND ')}`
    const page = Math.max(1, f.page ?? 1)
    const PAGE_SIZE = 50
    type Row = {
      id: string; code: number; unitId: string; orderNumber: string | null; invoiceNumber: string | null; customerName: string | null; destCity: string | null; destUf: string | null
      carrierId: string | null; status: string; expectedTotal: Prisma.Decimal | null; createdAt: Date; auditStatus: string | null; auditCause: string | null; auditNote: string | null; auditedByName: string | null; auditedAt: Date | null
      freightMode: string | null; freightValue: Prisma.Decimal | null; seller: string | null; issuedAt: Date | null; total: Prisma.Decimal | null; expected: Prisma.Decimal | null; numbers: string | null
    }
    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT s.id, s.code, s."unitId", s."orderNumber", s."invoiceNumber", s."customerName", s."destCity", s."destUf", s."carrierId", s.status, s."expectedTotal", s."createdAt",
          s."auditStatus", s."auditCause", s."auditNote", s."auditedByName", s."auditedAt",
          n."freightMode", n."freightValue", n.seller, n."issuedAt", c.total, c.expected, c.numbers
        ${from}
        ORDER BY COALESCE(n."issuedAt", s."createdAt") DESC, s.code DESC
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      this.prisma.$queryRaw<{ count: bigint; nota: Prisma.Decimal | null; cte: Prisma.Decimal | null; tabela: Prisma.Decimal | null }[]>`
        SELECT count(*) AS count, sum(CASE WHEN n."freightMode" = '0' THEN COALESCE(n."freightValue", 0) END) AS nota, sum(c.total) AS cte, sum(c.expected) AS tabela
        ${from}`,
    ])
    const carriers = await this.prisma.freightCarrier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.carrierId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })
    const t = totals[0]
    return {
      total: Number(t?.count ?? 0),
      page,
      pageSize: PAGE_SIZE,
      tolerance: tol,
      sums: { nota: n(t?.nota ?? null), cte: n(t?.cte ?? null), tabela: n(t?.tabela ?? null) },
      causes: AUDIT_CAUSES,
      items: rows.map((r) => {
        const values = { freightMode: r.freightMode, nfeFreight: n(r.freightValue), cteTotal: n(r.total), tableExpected: n(r.expected), quoted: n(r.expectedTotal) }
        const hints = auditHints(values, tol)
        return {
          id: r.id,
          code: r.code,
          unitId: r.unitId,
          orderNumber: r.orderNumber,
          invoiceNumber: r.invoiceNumber,
          issuedAt: r.issuedAt,
          customerName: r.customerName,
          destCity: r.destCity,
          destUf: r.destUf,
          carrierName: carriers.find((c) => c.id === r.carrierId)?.name ?? null,
          seller: r.seller,
          status: r.status,
          cteNumbers: r.numbers,
          ...values,
          hints,
          hasDifference: hasDifference(hints),
          suggestedCause: suggestedCause(values, hints),
          audit: r.auditStatus ? { status: r.auditStatus, cause: r.auditCause, note: r.auditNote, byName: r.auditedByName, at: r.auditedAt } : null,
        }
      }),
    }
  }

  /** Registra a conferência do pedido (null desfaz). */
  async setFreightAudit(user: AuthUser, id: string, d: { status: AuditStatus | null; cause?: AuditCause | null; note?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'edit')
    const s = await this.find(user, id)
    if (d.status === 'DIVERGENTE' && !d.cause) throw new BadRequestException('Escolha a causa da diferença.')
    const data = d.status
      ? { auditStatus: d.status, auditCause: d.cause ?? null, auditNote: cleanText(d.note, 1000) || null, auditedByName: user.name.slice(0, 120), auditedAt: new Date() }
      : { auditStatus: null, auditCause: null, auditNote: null, auditedByName: null, auditedAt: null }
    await this.prisma.freightShipment.update({ where: { id: s.id }, data })
    await this.audit.byUser(user, ctx, 'frete.pedido.conferido', 'freight_shipment', id, { pedido: s.code, resultado: d.status, causa: d.cause ?? null })
    return { ok: true }
  }

  /** Última NF-e importada (a de emissão mais recente) e a última importação de XML: quem e quando. */
  private async lastNfeInfo(tenantId: string, units: string[] | null, unitId?: string) {
    const unitWhere = unitId ? { unitId } : units ? { unitId: { in: units } } : {}
    const [nfe, imp] = await Promise.all([
      this.prisma.freightNfe.findFirst({ where: { tenantId, ...unitWhere, issuedAt: { not: null } }, orderBy: { issuedAt: 'desc' }, select: { number: true, issuedAt: true, createdAt: true } }),
      this.prisma.freightNfeImport.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, createdByName: true, fileNames: true } }),
    ])
    return {
      lastNfe: nfe ? { number: nfe.number, issuedAt: nfe.issuedAt, importedAt: nfe.createdAt } : null,
      lastImport: imp ? { at: imp.createdAt, byName: imp.createdByName, files: imp.fileNames.slice(0, 120) } : null,
    }
  }

  /** Vendedores das NF-es importadas (filtro da lista de pedidos). */
  async sellers(user: AuthUser) {
    assertCan(user, 'fretes_pedidos', 'view')
    const rows = await this.prisma.freightNfe.groupBy({ by: ['seller'], where: { tenantId: user.tenantId, seller: { not: null } }, _count: { _all: true }, orderBy: { seller: 'asc' }, take: 500 })
    return rows.map((r) => ({ name: r.seller!, count: r._count._all }))
  }

  /** Frete na nota × soma dos CT-es não cancelados do pedido (coluna "Frete na nota"). */
  private freightCheck(key: string | null, nfes: { key: string; freightValue: Prisma.Decimal | null; freightMode: string | null }[], ctes: { total: Prisma.Decimal; fiscalStatus: string }[], tolerance: number) {
    const nf = key ? nfes.find((x) => x.key === key) : undefined
    const valid = ctes.filter((c) => c.fiscalStatus !== 'CANCELADO')
    const total = valid.length ? Math.round(valid.reduce((s, c) => s + Number(c.total), 0) * 100) / 100 : null
    return compareFreight(nf ? { freightMode: nf.freightMode, freightValue: n(nf.freightValue) } : null, total, tolerance)
  }

  async get(user: AuthUser, id: string) {
    assertCan(user, 'fretes_pedidos', 'view')
    const s = await this.find(user, id)
    const [events, carrier, ctes, unit] = await Promise.all([
      this.prisma.freightShipmentEvent.findMany({ where: { shipmentId: id }, orderBy: { createdAt: 'desc' } }),
      s.carrierId ? this.prisma.freightCarrier.findUnique({ where: { id: s.carrierId }, select: { id: true, name: true } }) : null,
      this.prisma.freightCte.findMany({ where: { shipmentId: id } }),
      this.prisma.unit.findUnique({ where: { id: s.unitId }, select: { name: true } }),
    ])
    // Confronto de cada CT-e com os XMLs das notas importadas.
    const confront = await this.cteService.confrontFor(user.tenantId, ctes)
    const [nfe, rec] = await Promise.all([
      s.invoiceKey ? this.prisma.freightNfe.findUnique({ where: { tenantId_key: { tenantId: user.tenantId, key: s.invoiceKey } }, select: { key: true, number: true, series: true, status: true, freightMode: true, freightValue: true, seller: true, createdAt: true } }) : null,
      this.cteService.recSettings(user.tenantId),
    ])
    return this.view(s, {
      carrierName: carrier?.name ?? null,
      unitName: unit?.name ?? null,
      events,
      nfe: nfe ? { number: nfe.number, series: nfe.series, status: nfe.status, freightMode: nfe.freightMode, freightValue: n(nfe.freightValue), seller: nfe.seller, createdAt: nfe.createdAt } : null,
      freightCheck: this.freightCheck(s.invoiceKey, nfe ? [nfe] : [], ctes, rec.nfeValor),
      tableExpected: tableExpected(ctes),
      ctes: ctes.map((c) => ({ id: c.id, number: c.number, key: c.key, total: Number(c.total), recStatus: c.recStatus, issuedAt: c.issuedAt, nfeConfront: confront.get(c.id) ?? null })),
    })
  }

  private async event(shipmentId: string, status: string, user: AuthUser, note?: string | null) {
    await this.prisma.freightShipmentEvent.create({ data: { shipmentId, status, note: cleanText(note, 500) || null, userName: user.name.slice(0, 120) } })
  }

  async create(user: AuthUser, d: ShipmentInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'create')
    const data = await this.validate(user, d)
    if (data.invoiceKey && (await this.prisma.freightShipment.count({ where: { tenantId: user.tenantId, invoiceKey: data.invoiceKey, status: { not: 'CANCELADO' } } }))) {
      throw new ConflictException('Já existe pedido com esta chave de NF-e.')
    }
    const s = await this.prisma.freightShipment.create({ data: { tenantId: user.tenantId, ...data, status: data.carrierId ? 'AGUARDANDO_COLETA' : 'AGUARDANDO_COTACAO', createdById: user.id, createdByName: user.name } })
    await this.event(s.id, s.status, user, 'Pedido cadastrado')
    await this.audit.byUser(user, ctx, 'frete.pedido.criado', 'freight_shipment', s.id, { pedido: s.code, nf: s.invoiceNumber })
    return this.get(user, s.id)
  }

  /** Pedido a partir da cotação com transportadora escolhida: leva destino, valores, prazo e o cálculo como referência. */
  async fromQuote(user: AuthUser, quoteId: string, d: { orderNumber?: string | null; invoiceNumber?: string | null; invoiceKey?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'create')
    const q = await this.prisma.freightQuote.findFirst({ where: { id: quoteId, tenantId: user.tenantId } })
    if (!q) throw new NotFoundException('Cotação não encontrada.')
    if (q.status !== 'SELECIONADA') throw new BadRequestException('Escolha a transportadora na cotação antes de gerar o pedido.')
    const r = (q.results as unknown as QuoteResult[]).find((x) => x.tableId === q.selectedTableId)
    if (!r) throw new BadRequestException('Opção escolhida não encontrada na cotação.')
    const data = await this.validate(user, {
      unitId: q.unitId,
      orderNumber: d.orderNumber ?? q.reference ?? q.erpDocNumber,
      invoiceNumber: d.invoiceNumber,
      invoiceKey: d.invoiceKey,
      customerName: q.customerName,
      customerDoc: q.customerDoc,
      personType: q.personType as 'PF' | 'PJ',
      destZip: q.destZip,
      destCity: q.destCity,
      destUf: q.destUf,
      cargoValue: Number(q.cargoValue),
      weight: Number(q.realWeight),
      carrierId: r.carrierId,
    })
    const expected = expectedFromResult(r, q.code)
    const s = await this.prisma.freightShipment.create({
      data: {
        tenantId: user.tenantId,
        ...data,
        quoteId: q.id,
        erpDocType: q.erpDocType,
        erpDocNumber: q.erpDocNumber,
        expected: expected as unknown as Prisma.InputJsonValue,
        expectedTotal: r.total,
        expectedDeliveryAt: r.deadlineDays !== null ? addBusinessDays(new Date(), r.deadlineDays) : null,
        status: 'AGUARDANDO_COLETA',
        createdById: user.id,
        createdByName: user.name,
      },
    })
    await this.event(s.id, s.status, user, `Gerado da cotação nº ${q.code} (${r.carrierName}, ${r.total?.toFixed(2)})`)
    await this.audit.byUser(user, ctx, 'frete.pedido.criado', 'freight_shipment', s.id, { pedido: s.code, cotacao: q.code })
    return this.get(user, s.id)
  }

  async update(user: AuthUser, id: string, d: ShipmentInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'edit')
    const cur = await this.find(user, id)
    const data = await this.validate(user, { ...d, unitId: d.unitId ?? cur.unitId })
    const s = await this.prisma.freightShipment.update({ where: { id }, data })
    const changed = Object.keys(data).filter((k) => JSON.stringify((cur as Record<string, unknown>)[k]) !== JSON.stringify((data as Record<string, unknown>)[k]))
    if (changed.length) await this.audit.byUser(user, ctx, 'frete.pedido.alterado', 'freight_shipment', id, { pedido: s.code, campos: changed })
    return this.get(user, id)
  }

  /** Mudança de situação com data (coleta, despacho, entrega) e observação; fica no histórico do pedido. */
  async changeStatus(user: AuthUser, id: string, d: { status: string; note?: string | null; at?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'edit')
    const cur = await this.find(user, id)
    if (!(SHIPMENT_STATUS as readonly string[]).includes(d.status)) throw new BadRequestException('Situação inválida.')
    const status = d.status as ShipmentStatus
    if (cur.status === 'CANCELADO' && status !== 'CANCELADO') throw new BadRequestException('Pedido cancelado não muda de situação.')
    const at = d.at ? new Date(d.at) : new Date()
    if (Number.isNaN(at.getTime())) throw new BadRequestException('Data inválida.')
    const data: Prisma.FreightShipmentUpdateInput = { status }
    if (status === 'DESPACHADO' && !cur.shippedAt) data.shippedAt = at
    if ((status === 'DESPACHADO' || status === 'EM_TRANSITO') && !cur.collectedAt) data.collectedAt = at
    if (status === 'ENTREGUE') data.deliveredAt = at
    if (status === 'CANCELADO' && !cleanText(d.note, 500)) throw new BadRequestException('Informe o motivo do cancelamento.')
    await this.prisma.freightShipment.update({ where: { id }, data })
    await this.event(id, status, user, d.note)
    await this.audit.byUser(user, ctx, 'frete.pedido.situacao', 'freight_shipment', id, { pedido: cur.code, de: cur.status, para: status, nota: d.note ?? null })
    return this.get(user, id)
  }

  /**
   * Importa pedidos de uma planilha (ERP/e-commerce): colunas reconhecidas pelo título (pedido, NF, chave, cliente,
   * CPF/CNPJ, CEP, cidade, UF, valor, peso, volumes). Duplicadas pela chave da NF-e são puladas.
   */
  async importRows(user: AuthUser, unitId: string, rows: unknown[][], ctx: RequestCtx) {
    assertCan(user, 'fretes_pedidos', 'create')
    assertUnit(user, 'fretes_pedidos', unitId)
    const hIdx = rows.slice(0, 15).findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 2)
    if (hIdx < 0) throw new BadRequestException('Não achei o cabeçalho da planilha.')
    const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const h = rows[hIdx]!.map(norm)
    const col = (re: RegExp) => h.findIndex((x) => re.test(x))
    const c = {
      order: col(/^pedido|^n.? ?pedido|numero do pedido|^order/),
      invoice: col(/^(nf|nota|nfe|nf-e|numero da nf|n.? ?nf)$|nota fiscal$/),
      key: col(/chave/),
      name: col(/cliente|destinatario|nome/),
      doc: col(/cpf|cnpj|documento/),
      zip: col(/cep/),
      city: col(/cidade|municipio/),
      uf: col(/^uf$|estado/),
      value: col(/valor/),
      weight: col(/peso/),
      volumes: col(/volume/),
    }
    if (c.zip < 0 && c.key < 0 && c.invoice < 0) throw new BadRequestException('A planilha precisa de ao menos CEP, número da NF ou chave da NF-e.')
    const get = (r: unknown[], i: number) => (i >= 0 ? r[i] : null)
    let created = 0
    let skipped = 0
    const errors: { line: number; message: string }[] = []
    for (const [i, r] of rows.slice(hIdx + 1).entries()) {
      const line = hIdx + 2 + i
      if (!r || r.every((x) => x === null || String(x).trim() === '')) continue
      try {
        const num = (v: unknown) => {
          const x = parseNumber(v)
          return x === null || Number.isNaN(x) ? null : x
        }
        const data = await this.validate(user, {
          unitId,
          orderNumber: get(r, c.order) === null ? null : String(get(r, c.order)),
          invoiceNumber: get(r, c.invoice) === null ? null : String(get(r, c.invoice)),
          invoiceKey: get(r, c.key) === null ? null : String(get(r, c.key)),
          customerName: get(r, c.name) === null ? null : String(get(r, c.name)),
          customerDoc: get(r, c.doc) === null ? null : String(get(r, c.doc)),
          destZip: get(r, c.zip) === null ? null : String(get(r, c.zip)),
          destCity: get(r, c.city) === null ? null : String(get(r, c.city)),
          destUf: get(r, c.uf) === null ? null : String(get(r, c.uf)),
          cargoValue: num(get(r, c.value)),
          weight: num(get(r, c.weight)),
          volumesCount: num(get(r, c.volumes)),
        })
        if (data.invoiceKey && (await this.prisma.freightShipment.count({ where: { tenantId: user.tenantId, invoiceKey: data.invoiceKey } }))) {
          skipped++
          continue
        }
        const s = await this.prisma.freightShipment.create({ data: { tenantId: user.tenantId, ...data, volumesCount: data.volumesCount === null ? null : Math.round(data.volumesCount), status: 'AGUARDANDO_COTACAO', createdById: user.id, createdByName: user.name } })
        await this.event(s.id, s.status, user, 'Importado de planilha')
        created++
      } catch (e) {
        errors.push({ line, message: (e as Error).message })
      }
      if (created + skipped + errors.length >= 5000) break
    }
    await this.audit.byUser(user, ctx, 'frete.pedidos.importados', 'freight_shipment', undefined, { filial: unitId, criados: created, pulados: skipped, erros: errors.length })
    return { created, skipped, errors: errors.slice(0, 200) }
  }
}

/** Valor esperado pela tabela de frete do CRM: soma do esperado dos CT-es não cancelados do pedido (null sem CT-e conferido). */
function tableExpected(ctes: { expectedTotal: Prisma.Decimal | null; fiscalStatus: string }[]) {
  const valid = ctes.filter((c) => c.fiscalStatus !== 'CANCELADO' && c.expectedTotal !== null)
  return valid.length ? Math.round(valid.reduce((t, c) => t + Number(c.expectedTotal), 0) * 100) / 100 : null
}
