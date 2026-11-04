import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnitList, unitListWhere } from './acesso'
import { MODALS } from './catalogo'
import { normalizeCep, normalizeUf, validCnpj } from './cep'
import { FEE_CODES, feeCodeFromName, parseFeeSheet, type ParsedFee } from './taxas'
import { cleanPickups, type Pickup } from './coletas'
import { htmlTableRows, parseIbgeSheet, parseRegionsSheet, type ParsedRegion } from './regioes'
import { downloadPublic } from './download'
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
  pickups?: unknown
}

const opt = (v: string | null | undefined, max: number) => (v === undefined ? undefined : cleanText(v, max) || null)

/** Transportadoras parceiras: cadastro, contatos, filiais atendidas e indicadores. */
@Injectable()
export class TransportadorasService implements OnApplicationBootstrap, OnModuleDestroy {
  private sitesTimer: NodeJS.Timeout | null = null
  private sitesRunning = false

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
      pickups: c.pickups,
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
    // Coletas: filial precisa ser da empresa (vazio = todas).
    let pickups
    try {
      pickups = cleanPickups(d.pickups ?? [], new Set((await this.prisma.unit.findMany({ where: { tenantId: user.tenantId }, select: { id: true } })).map((u) => u.id)))
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
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
      pickups: pickups as unknown as Prisma.InputJsonValue,
      active: d.active ?? true,
    }
  }

  /**
   * Painel de TV das coletas: transportadoras ativas com horários (filtrados pela filial, quando escolhida). A situação
   * (carregando, chegando, ponto de corte) é calculada na tela, pelo relógio do computador.
   */
  async pickupBoard(user: AuthUser, unitId: string | null) {
    assertCan(user, 'fretes_painel', 'view')
    const allowed = allowedUnits(user, 'fretes_painel')
    if (unitId && allowed && !allowed.includes(unitId)) throw new NotFoundException('Filial não encontrada.')
    const carriers = await this.prisma.freightCarrier.findMany({ where: { tenantId: user.tenantId, active: true }, select: { id: true, name: true, quoteName: true, pickups: true }, orderBy: { name: 'asc' } })
    const units = await this.prisma.unit.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } })
    const unitName = new Map(units.map((u) => [u.id, u.name]))
    const rows = carriers.flatMap((c) =>
      ((c.pickups ?? []) as unknown as Pickup[])
        .filter((p) => (unitId ? !p.unitId || p.unitId === unitId : !allowed || !p.unitId || allowed.includes(p.unitId)))
        .map((p) => ({ carrierId: c.id, carrier: c.quoteName || c.name, unit: p.unitId ? (unitName.get(p.unitId) ?? null) : null, ...p })),
    )
    return { unit: unitId ? (unitName.get(unitId) ?? null) : null, rows }
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
  async importFees(user: AuthUser, id: string, input: Express.Multer.File | Express.Multer.File[] | undefined, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    const carrier = await this.carrierFor(user, id)
    assertUnitList(user, 'fretes_transportadoras', carrier.unitIds)
    const files = (Array.isArray(input) ? input : input ? [input] : []).filter((f) => f?.buffer?.length)
    if (!files.length) throw new BadRequestException('Envie a planilha com as listas de taxas.')
    if (files.some((f) => f.size > IMPORT_MAX_BYTES)) throw new BadRequestException('Arquivo maior que 20 MB.')
    const all: ParsedFee[] = []
    let invalid = 0
    const used: string[] = []
    for (const file of files) {
      const sheets = await readSheets(file.buffer, file.originalname)
      for (const s of sheets) {
        // Formato "Planilha Restrições" (um arquivo por taxa): a taxa vem do nome da aba ou do arquivo.
        const r = parseFeeSheet(s.rows, feeCodeFromName(s.name) ?? feeCodeFromName(file.originalname))
        if (!r || !r.fees.length) continue
        all.push(...r.fees)
        invalid += r.invalid
        used.push(files.length > 1 ? `${file.originalname} › ${s.name}` : s.name)
      }
    }
    if (!all.length) throw new BadRequestException('Nenhuma lista de taxas encontrada: a aba precisa das colunas CNPJ (ou CPF) e TAXA ("TAXA TDE 222/20%"), ou CNPJ, CPF, TIPO VALOR e VALOR com a taxa (TDA, TDE, TDC ou TVD) no nome do arquivo.')
    // Mesmo documento e mesma taxa repetidos: fica a última linha.
    const unique = new Map(all.map((f) => [`${f.doc}|${f.code}`, f]))
    await this.prisma.$transaction(
      async (tx) => {
        // Só as listas que vieram agora são trocadas (ex.: o arquivo da TDE não apaga a TDA já importada).
        await tx.freightRecipientFee.deleteMany({ where: { carrierId: id, code: { in: [...new Set(all.map((f) => f.code))] } } })
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
    await this.audit.byUser(user, ctx, 'frete.taxas_destinatario.importadas', 'freight_carrier', id, { arquivo: files.map((f) => f.originalname).join(', ').slice(0, 400), abas: used, quantidades: counts, linhasInvalidas: invalid })
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

  // ─────────── Regiões (planilha "Regiões": código, cidades pelo IBGE, prazo e dias de entrega) ───────────

  /** Resumo: quantas regiões e cidades, e as regiões com as cidades (para conferir). */
  async regions(user: AuthUser, id: string) {
    assertCan(user, 'fretes_transportadoras', 'view')
    await this.carrierFor(user, id)
    const rows = await this.prisma.freightCarrierRegion.findMany({ where: { carrierId: id }, orderBy: [{ code: 'asc' }, { city: 'asc' }], select: { code: true, city: true, uf: true, deadlineDays: true, businessDays: true, weekdays: true, createdAt: true } })
    const byCode = new Map<string, typeof rows>()
    for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r])
    const site = await this.prisma.freightCarrier.findUnique({ where: { id }, select: { citiesUrl: true, citiesSyncedAt: true, citiesSyncError: true } })
    return {
      site,
      total: rows.length,
      importedAt: rows.reduce<Date | null>((m, r) => (!m || r.createdAt > m ? r.createdAt : m), null),
      regions: [...byCode.entries()].map(([code, list]) => ({
        code,
        cities: list.length,
        ufs: [...new Set(list.map((c) => c.uf))],
        deadlines: [...new Set(list.map((c) => c.deadlineDays).filter((d): d is number => d !== null))].sort((a, b) => a - b),
        sample: list.slice(0, 6).map((c) => `${c.city}/${c.uf}`),
      })),
    }
  }

  /** Cidades atendidas (das regiões), com busca por cidade, UF ou código da base. 100 por página. */
  async regionCities(user: AuthUser, id: string, q: { search?: string; page?: number }) {
    assertCan(user, 'fretes_transportadoras', 'view')
    await this.carrierFor(user, id)
    const s = cleanText(q.search, 80)
    const key = s ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : ''
    const where: Prisma.FreightCarrierRegionWhereInput = {
      carrierId: id,
      ...(s ? { OR: [{ cityKey: { contains: key } }, { code: { equals: s.toUpperCase() } }, ...(s.length === 2 ? [{ uf: s.toUpperCase() }] : []), ...(/^\d{7}$/.test(s) ? [{ ibge: s }] : [])] } : {}),
    }
    const page = Math.max(1, Math.min(1000, q.page ?? 1))
    const [total, rows] = await Promise.all([
      this.prisma.freightCarrierRegion.count({ where }),
      this.prisma.freightCarrierRegion.findMany({ where, orderBy: [{ uf: 'asc' }, { city: 'asc' }], skip: (page - 1) * 100, take: 100, select: { code: true, ibge: true, city: true, uf: true, deadlineDays: true, businessDays: true, weekdays: true, pickup: true, contact: true, note: true } }),
    ])
    return { total, page, rows }
  }

  /** Importa a planilha de regiões e substitui as regiões anteriores dessa transportadora. */
  /** Planilha (xlsx/csv) ou tabela HTML (o ".xls" que o site da transportadora baixa) → cidades. */
  private async regionsFromBuffer(buf: Buffer, fileName: string) {
    const head = buf.subarray(0, 4096).toString('latin1')
    let sheets: { name: string; rows: unknown[][] }[]
    if (/<(html|table|tr|style|body)\b/i.test(head)) {
      // HTML: UTF-8 quando é válido, senão latin1 (o padrão dos sites em ASP).
      const utf8 = buf.toString('utf8')
      const text = utf8.includes('\ufffd') ? buf.toString('latin1') : utf8
      sheets = [{ name: 'HTML', rows: htmlTableRows(text) }]
    } else sheets = await readSheets(buf, fileName)
    const ibge = sheets.map((s) => parseIbgeSheet(s.rows)).find(Boolean) ?? null
    const all: ParsedRegion[] = []
    let invalid = 0
    for (const s of sheets) {
      const r = parseRegionsSheet(s.rows, ibge)
      if (!r) continue
      all.push(...r.regions)
      invalid += r.invalid
    }
    if (!all.length) throw new BadRequestException('Nenhuma cidade encontrada: a planilha precisa das colunas Código, Cidades (código do IBGE) e Dias Prazo, ou das colunas Cidade, Estado e Base responsável.')
    return { regions: [...new Map(all.map((r) => [`${r.code}|${r.ibge ?? `${r.uf}:${r.cityKey}`}`, r])).values()], invalid }
  }

  private async replaceRegions(tenantId: string, carrierId: string, regions: ParsedRegion[]) {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.freightCarrierRegion.deleteMany({ where: { carrierId } })
        for (let i = 0; i < regions.length; i += 2000) {
          await tx.freightCarrierRegion.createMany({ data: regions.slice(i, i + 2000).map((r) => ({ tenantId, carrierId, ...r })) })
        }
      },
      { timeout: 120_000 },
    )
    return { regions: new Set(regions.map((r) => r.code)).size, cities: regions.length, withIbge: regions.filter((r) => r.ibge).length }
  }

  /** Importa a planilha de regiões (ou a lista de cidades atendidas) e substitui as anteriores dessa transportadora. */
  async importRegions(user: AuthUser, id: string, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    const carrier = await this.carrierFor(user, id)
    assertUnitList(user, 'fretes_transportadoras', carrier.unitIds)
    if (!file?.buffer?.length) throw new BadRequestException('Envie a planilha de regiões.')
    if (file.size > IMPORT_MAX_BYTES) throw new BadRequestException('Arquivo maior que 20 MB.')
    const { regions, invalid } = await this.regionsFromBuffer(file.buffer, file.originalname)
    const r = await this.replaceRegions(user.tenantId, id, regions)
    await this.audit.byUser(user, ctx, 'frete.regioes.importadas', 'freight_carrier', id, { arquivo: file.originalname.slice(0, 200), regioes: r.regions, cidades: r.cities, linhasInvalidas: invalid })
    return { ...r, invalid }
  }

  // ─────────── Cidades atendidas pelo site da transportadora (relidas todo dia) ───────────

  onApplicationBootstrap() {
    this.sitesTimer = setInterval(() => void this.refreshSites(), 3 * 3_600_000)
    this.sitesTimer.unref()
  }

  onModuleDestroy() {
    if (this.sitesTimer) clearInterval(this.sitesTimer)
  }

  /** Relê as listas dos sites com mais de 24 h (uma transportadora por vez). */
  async refreshSites() {
    if (this.sitesRunning) return
    this.sitesRunning = true
    try {
      const due = await this.prisma.freightCarrier.findMany({ where: { citiesUrl: { not: null }, active: true, OR: [{ citiesSyncedAt: null }, { citiesSyncedAt: { lt: new Date(Date.now() - 86_400_000) } }] }, select: { id: true }, take: 20 })
      for (const c of due) await this.syncSite(c.id).catch(() => undefined)
    } finally {
      this.sitesRunning = false
    }
  }

  /** Baixa a lista do site e troca as cidades da transportadora. Erro fica guardado (as cidades anteriores continuam). */
  async syncSite(carrierId: string) {
    const c = await this.prisma.freightCarrier.findUnique({ where: { id: carrierId }, select: { id: true, tenantId: true, citiesUrl: true } })
    if (!c?.citiesUrl) throw new BadRequestException('Informe o endereço da lista de cidades no site da transportadora.')
    try {
      const buf = await downloadPublic(c.citiesUrl, IMPORT_MAX_BYTES)
      const { regions } = await this.regionsFromBuffer(buf, c.citiesUrl.split('?')[0]!.split('/').pop() || 'lista')
      const r = await this.replaceRegions(c.tenantId, c.id, regions)
      await this.prisma.freightCarrier.update({ where: { id: c.id }, data: { citiesSyncedAt: new Date(), citiesSyncError: null } })
      return r
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300)
      await this.prisma.freightCarrier.update({ where: { id: c.id }, data: { citiesSyncedAt: new Date(), citiesSyncError: msg } })
      throw new BadRequestException(`Não deu para ler a lista do site: ${msg}`)
    }
  }

  /** Guarda o endereço da lista no site (vazio = parar de buscar) e já busca uma vez. */
  async setSite(user: AuthUser, id: string, url: string | null, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    const carrier = await this.carrierFor(user, id)
    assertUnitList(user, 'fretes_transportadoras', carrier.unitIds)
    const clean = url?.trim() || null
    if (clean) {
      let u: URL
      try {
        u = new URL(clean)
      } catch {
        throw new BadRequestException('Endereço inválido.')
      }
      if (u.protocol !== 'https:') throw new BadRequestException('Use um endereço https://.')
    }
    await this.prisma.freightCarrier.update({ where: { id }, data: { citiesUrl: clean, citiesSyncError: null, ...(clean ? {} : { citiesSyncedAt: null }) } })
    await this.audit.byUser(user, ctx, 'frete.regioes.site', 'freight_carrier', id, { endereco: clean })
    return clean ? { ok: true, ...(await this.syncSite(id)) } : { ok: true }
  }

  async syncSiteNow(user: AuthUser, id: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    await this.carrierFor(user, id)
    const r = await this.syncSite(id)
    await this.audit.byUser(user, ctx, 'frete.regioes.site_atualizado', 'freight_carrier', id, { cidades: r.cities })
    return r
  }

  async clearRegions(user: AuthUser, id: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    const carrier = await this.carrierFor(user, id)
    assertUnitList(user, 'fretes_transportadoras', carrier.unitIds)
    const r = await this.prisma.freightCarrierRegion.deleteMany({ where: { carrierId: id } })
    await this.audit.byUser(user, ctx, 'frete.regioes.apagadas', 'freight_carrier', id, { quantidade: r.count })
    return { ok: true, removed: r.count }
  }
}
