import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnit } from './acesso'
import { SHIPMENT_STATUS, type ShipmentStatus } from './catalogo'
import { normalizeCep, normalizeUf, validCnpj, validCpf } from './cep'
import type { QuoteResult } from './cotacao.service'
import { parseNumber } from './importacao'
import { addBusinessDays } from './motor'

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
      notes: s.notes,
      createdByName: s.createdByName,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      ...extra,
    }
  }

  private async find(user: AuthUser, id: string) {
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

  async list(user: AuthUser, f: { unitId?: string; status?: string; carrierId?: string; from?: string; to?: string; search?: string; page?: number }) {
    assertCan(user, 'fretes_pedidos', 'view')
    const units = allowedUnits(user, 'fretes_pedidos')
    const and: Prisma.FreightShipmentWhereInput[] = [{ tenantId: user.tenantId }]
    if (units) and.push({ unitId: { in: units } })
    if (f.unitId) and.push({ unitId: f.unitId })
    if (f.status && (SHIPMENT_STATUS as readonly string[]).includes(f.status)) and.push({ status: f.status })
    if (f.carrierId) and.push({ carrierId: f.carrierId })
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
    const page = Math.max(1, f.page ?? 1)
    const where = { AND: and }
    const [total, rows, byStatus] = await Promise.all([
      this.prisma.freightShipment.count({ where }),
      this.prisma.freightShipment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE }),
      this.prisma.freightShipment.groupBy({ by: ['status'], where: { tenantId: user.tenantId, ...(units ? { unitId: { in: units } } : {}), ...(f.unitId ? { unitId: f.unitId } : {}) }, _count: { _all: true } }),
    ])
    const [carriers, ctes] = await Promise.all([
      this.prisma.freightCarrier.findMany({ where: { id: { in: rows.map((r) => r.carrierId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.prisma.freightCte.findMany({ where: { shipmentId: { in: rows.map((r) => r.id) } }, select: { shipmentId: true, number: true, total: true, recStatus: true } }),
    ])
    return {
      total,
      page,
      pageSize: PAGE,
      counts: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      items: rows.map((r) => {
        const c = ctes.find((x) => x.shipmentId === r.id)
        return this.view(r, { carrierName: carriers.find((x) => x.id === r.carrierId)?.name ?? null, cte: c ? { number: c.number, total: Number(c.total), recStatus: c.recStatus } : null })
      }),
    }
  }

  async get(user: AuthUser, id: string) {
    assertCan(user, 'fretes_pedidos', 'view')
    const s = await this.find(user, id)
    const [events, carrier, ctes, unit] = await Promise.all([
      this.prisma.freightShipmentEvent.findMany({ where: { shipmentId: id }, orderBy: { createdAt: 'desc' } }),
      s.carrierId ? this.prisma.freightCarrier.findUnique({ where: { id: s.carrierId }, select: { id: true, name: true } }) : null,
      this.prisma.freightCte.findMany({ where: { shipmentId: id }, select: { id: true, number: true, key: true, total: true, recStatus: true, issuedAt: true } }),
      this.prisma.unit.findUnique({ where: { id: s.unitId }, select: { name: true } }),
    ])
    return this.view(s, { carrierName: carrier?.name ?? null, unitName: unit?.name ?? null, events, ctes: ctes.map((c) => ({ ...c, total: Number(c.total) })) })
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
      orderNumber: d.orderNumber ?? q.reference,
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
