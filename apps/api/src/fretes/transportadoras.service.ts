import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnitList, unitListWhere } from './acesso'
import { MODALS } from './catalogo'
import { normalizeCep, normalizeUf, validCnpj } from './cep'
import { FEE_CODES, parseFeeSheet, type ParsedFee } from './taxas'
import { FilesService } from '../files/files.service'
import { IMPORT_MAX_BYTES, readSheets } from './importacao.service'

export interface CarrierInput {
  cnpj: string
  legalName: string
  name?: string | null
  quoteName?: string | null
  zip?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  phone?: string | null
  email?: string | null
  contacts?: { name: string; role?: string | null; phone?: string | null; email?: string | null }[]
  modes?: string[]
  unitIds?: string[]
  useReceiverAsRecipient?: boolean
  externalCodes?: Record<string, string>
  notes?: string | null
  active?: boolean
}

const opt = (v: string | null | undefined, max: number) => (v === undefined ? undefined : cleanText(v, max) || null)

/** Transportadoras parceiras: cadastro, contatos, filiais atendidas e indicadores. */
@Injectable()
export class TransportadorasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  private view(c: Prisma.FreightCarrierGetPayload<object>, extra: { tables?: number; activeTables?: number } = {}) {
    return {
      id: c.id,
      cnpj: c.cnpj,
      legalName: c.legalName,
      name: c.name,
      quoteName: c.quoteName,
      zip: c.zip,
      address: c.address,
      city: c.city,
      state: c.state,
      phone: c.phone,
      email: c.email,
      contacts: c.contacts,
      modes: c.modes,
      unitIds: c.unitIds,
      useReceiverAsRecipient: c.useReceiverAsRecipient,
      externalCodes: c.externalCodes,
      notes: c.notes,
      active: c.active,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...extra,
    }
  }

  async list(user: AuthUser, q: { search?: string; status?: 'active' | 'inactive' }) {
    assertCan(user, 'fretes_transportadoras', 'view')
    const and: Prisma.FreightCarrierWhereInput[] = [{ tenantId: user.tenantId }, unitListWhere(allowedUnits(user, 'fretes_transportadoras'))]
    if (q.status) and.push({ active: q.status === 'active' })
    const term = q.search?.trim()
    if (term) {
      const digits = term.replace(/\D/g, '')
      and.push({ OR: [{ name: { contains: term, mode: 'insensitive' } }, { legalName: { contains: term, mode: 'insensitive' } }, ...(digits.length >= 3 ? [{ cnpj: { contains: digits } }] : [])] })
    }
    const rows = await this.prisma.freightCarrier.findMany({ where: { AND: and }, orderBy: [{ active: 'desc' }, { name: 'asc' }], take: 500 })
    const today = new Date(new Date().toISOString().slice(0, 10))
    const counts = await this.prisma.freightTable.groupBy({ by: ['carrierId'], where: { tenantId: user.tenantId, carrierId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    const active = await this.prisma.freightTable.groupBy({
      by: ['carrierId'],
      where: { tenantId: user.tenantId, carrierId: { in: rows.map((r) => r.id) }, status: 'ATIVA', validFrom: { lte: today }, validTo: { gte: today }, publishedVersionId: { not: null } },
      _count: { _all: true },
    })
    return rows.map((r) => this.view(r, { tables: counts.find((c) => c.carrierId === r.id)?._count._all ?? 0, activeTables: active.find((c) => c.carrierId === r.id)?._count._all ?? 0 }))
  }

  async get(user: AuthUser, id: string) {
    assertCan(user, 'fretes_transportadoras', 'view')
    const c = await this.prisma.freightCarrier.findFirst({ where: { id, tenantId: user.tenantId, ...unitListWhere(allowedUnits(user, 'fretes_transportadoras')) } })
    if (!c) throw new NotFoundException('Transportadora não encontrada.')
    const [tables, quotes, chosen] = await Promise.all([
      this.prisma.freightTable.findMany({
        where: { tenantId: user.tenantId, carrierId: id },
        orderBy: [{ status: 'asc' }, { validTo: 'desc' }],
        select: { id: true, name: true, status: true, kind: true, modal: true, validFrom: true, validTo: true, unitIds: true, publishedVersionId: true },
      }),
      this.prisma.freightQuote.count({ where: { tenantId: user.tenantId, results: { array_contains: [{ carrierId: id }] } } }),
      this.prisma.freightQuote.aggregate({ where: { tenantId: user.tenantId, selectedCarrierId: id, status: 'SELECIONADA' }, _count: { _all: true }, _sum: { selectedTotal: true }, _avg: { selectedTotal: true } }),
    ])
    return {
      ...this.view(c),
      tables,
      stats: {
        quotes,
        chosen: chosen._count._all,
        chosenTotal: Number(chosen._sum.selectedTotal ?? 0),
        chosenAverage: chosen._avg.selectedTotal === null ? null : Number(chosen._avg.selectedTotal),
      },
    }
  }

  private async validate(user: AuthUser, d: CarrierInput) {
    const cnpj = d.cnpj.replace(/\D/g, '')
    if (!validCnpj(cnpj)) throw new BadRequestException('CNPJ inválido: confira os números.')
    const legalName = cleanText(d.legalName, 160)
    if (legalName.length < 2) throw new BadRequestException('Informe a razão social.')
    const zip = d.zip ? normalizeCep(d.zip) : null
    if (d.zip && !zip) throw new BadRequestException('CEP inválido.')
    const state = d.state ? normalizeUf(d.state) : null
    if (d.state && !state) throw new BadRequestException('UF inválida.')
    const modes = (d.modes ?? []).filter((m) => (MODALS as readonly string[]).includes(m))
    const unitIds = [...new Set(d.unitIds ?? [])]
    if (unitIds.length && (await this.prisma.unit.count({ where: { tenantId: user.tenantId, id: { in: unitIds } } })) !== unitIds.length) throw new BadRequestException('Filial inválida.')
    assertUnitList(user, 'fretes_transportadoras', unitIds)
    const contacts = (d.contacts ?? []).slice(0, 30).map((c) => ({ name: cleanText(c.name, 120), role: cleanText(c.role, 80) || null, phone: cleanText(c.phone, 40) || null, email: cleanText(c.email, 160).toLowerCase() || null })).filter((c) => c.name)
    const externalCodes = Object.fromEntries(
      Object.entries(d.externalCodes ?? {})
        .slice(0, 20)
        .map(([k, v]) => [cleanText(k, 40), cleanText(String(v), 80)])
        .filter(([k, v]) => k && v),
    )
    return {
      cnpj,
      legalName,
      name: cleanText(d.name, 120) || legalName,
      quoteName: opt(d.quoteName, 120) ?? null,
      zip,
      address: opt(d.address, 240) ?? null,
      city: opt(d.city, 120) ?? null,
      state,
      phone: opt(d.phone, 40) ?? null,
      email: opt(d.email, 160)?.toLowerCase() ?? null,
      contacts,
      modes,
      unitIds,
      useReceiverAsRecipient: !!d.useReceiverAsRecipient,
      externalCodes,
      notes: opt(d.notes, 4000) ?? null,
      active: d.active ?? true,
    }
  }

  async create(user: AuthUser, d: CarrierInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'create')
    const data = await this.validate(user, d)
    if (await this.prisma.freightCarrier.findUnique({ where: { tenantId_cnpj: { tenantId: user.tenantId, cnpj: data.cnpj } } })) throw new ConflictException('Já existe uma transportadora com este CNPJ.')
    const c = await this.prisma.freightCarrier.create({ data: { tenantId: user.tenantId, ...data } })
    await this.audit.byUser(user, ctx, 'frete.transportadora.criada', 'freight_carrier', c.id, { cnpj: c.cnpj, nome: c.name })
    return this.view(c)
  }

  async update(user: AuthUser, id: string, d: CarrierInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    const cur = await this.prisma.freightCarrier.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!cur) throw new NotFoundException('Transportadora não encontrada.')
    assertUnitList(user, 'fretes_transportadoras', cur.unitIds)
    const data = await this.validate(user, d)
    if (data.cnpj !== cur.cnpj && (await this.prisma.freightCarrier.findUnique({ where: { tenantId_cnpj: { tenantId: user.tenantId, cnpj: data.cnpj } } }))) {
      throw new ConflictException('Já existe uma transportadora com este CNPJ.')
    }
    const c = await this.prisma.freightCarrier.update({ where: { id }, data })
    const changed = Object.keys(data).filter((k) => JSON.stringify((cur as Record<string, unknown>)[k]) !== JSON.stringify((data as Record<string, unknown>)[k]))
    await this.audit.byUser(user, ctx, 'frete.transportadora.alterada', 'freight_carrier', id, { campos: changed, ...(changed.includes('active') ? { ativa: data.active } : {}) })
    return this.view(c)
  }

  // ─────────── Taxas por destinatário (TDA, TDE, TDC, TVD) ───────────

  private async carrierFor(user: AuthUser, id: string) {
    const c = await this.prisma.freightCarrier.findFirst({ where: { id, tenantId: user.tenantId, ...unitListWhere(allowedUnits(user, 'fretes_transportadoras')) } })
    if (!c) throw new NotFoundException('Transportadora não encontrada.')
    return c
  }

  /** Resumo das listas e, com documento, as taxas daquele destinatário. */
  async fees(user: AuthUser, id: string, doc?: string) {
    assertCan(user, 'fretes_transportadoras', 'view')
    await this.carrierFor(user, id)
    const [byCode, last] = await Promise.all([
      this.prisma.freightRecipientFee.groupBy({ by: ['code'], where: { carrierId: id }, _count: { _all: true } }),
      this.prisma.freightRecipientFee.findFirst({ where: { carrierId: id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ])
    const digits = (doc ?? '').replace(/\D/g, '')
    const matches = digits.length >= 11
      ? await this.prisma.freightRecipientFee.findMany({ where: { carrierId: id, doc: digits.padStart(digits.length > 11 ? 14 : 11, '0') }, orderBy: { code: 'asc' } })
      : []
    return {
      counts: Object.fromEntries(FEE_CODES.map((c) => [c, byCode.find((b) => b.code === c)?._count._all ?? 0])),
      total: byCode.reduce((s, b) => s + b._count._all, 0),
      importedAt: last?.createdAt ?? null,
      matches: matches.map((m) => ({ code: m.code, fixed: Number(m.fixed), percent: m.percent === null ? null : Number(m.percent), city: m.city, uf: m.uf, since: m.since })),
    }
  }

  /**
   * Importa as listas (abas TDA, TDE, TDC e TVD da planilha da transportadora, ou qualquer aba com documento e taxa) e
   * substitui as anteriores dessa transportadora. O nome do destinatário não é guardado.
   */
  async importFees(user: AuthUser, id: string, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    const carrier = await this.carrierFor(user, id)
    assertUnitList(user, 'fretes_transportadoras', carrier.unitIds)
    if (!file?.buffer?.length) throw new BadRequestException('Envie a planilha com as listas de taxas.')
    if (file.size > IMPORT_MAX_BYTES) throw new BadRequestException('Arquivo maior que 20 MB.')
    const sheets = await readSheets(file.buffer, file.originalname)
    const all: ParsedFee[] = []
    let invalid = 0
    const used: string[] = []
    for (const s of sheets) {
      const r = parseFeeSheet(s.rows)
      if (!r || !r.fees.length) continue
      all.push(...r.fees)
      invalid += r.invalid
      used.push(s.name)
    }
    if (!all.length) throw new BadRequestException('Nenhuma lista de taxas encontrada: a aba precisa das colunas CNPJ (ou CPF) e TAXA, com valores como "TAXA TDE 222/20%".')
    // Mesmo documento e mesma taxa repetidos: fica a última linha.
    const unique = new Map(all.map((f) => [`${f.doc}|${f.code}`, f]))
    await this.prisma.$transaction(
      async (tx) => {
        await tx.freightRecipientFee.deleteMany({ where: { carrierId: id } })
        const rows = [...unique.values()]
        for (let i = 0; i < rows.length; i += 2000) {
          await tx.freightRecipientFee.createMany({
            data: rows.slice(i, i + 2000).map((f) => ({ tenantId: user.tenantId, carrierId: id, doc: f.doc, code: f.code, fixed: f.fixed, percent: f.percent, city: f.city, uf: f.uf, since: f.since })),
          })
        }
      },
      { timeout: 120_000 },
    )
    const counts = Object.fromEntries(FEE_CODES.map((c) => [c, [...unique.values()].filter((f) => f.code === c).length]))
    await this.audit.byUser(user, ctx, 'frete.taxas_destinatario.importadas', 'freight_carrier', id, { arquivo: file.originalname.slice(0, 200), abas: used, quantidades: counts, linhasInvalidas: invalid })
    return { counts, total: unique.size, invalid, sheets: used }
  }

  async clearFees(user: AuthUser, id: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    const carrier = await this.carrierFor(user, id)
    assertUnitList(user, 'fretes_transportadoras', carrier.unitIds)
    const r = await this.prisma.freightRecipientFee.deleteMany({ where: { carrierId: id } })
    await this.audit.byUser(user, ctx, 'frete.taxas_destinatario.apagadas', 'freight_carrier', id, { quantidade: r.count })
    return { ok: true, removed: r.count }
  }
}
