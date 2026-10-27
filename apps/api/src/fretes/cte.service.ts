import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan } from './acesso'
import { normalizeCep } from './cep'
import { type ExpectedRef, reconcile, type Tolerance } from './conciliacao'
import { CotacaoService, type QuoteResult } from './cotacao.service'
import { type CteData, internalRateFrom, parseCteCancel, parseCteXml, type RateLearning } from './cte'
import { money } from './formula'

export const REC_KEY = 'fretes.conciliacao'
export interface RecSettings {
  /** Tolerância em reais e em % do esperado (vale a maior). */
  valor: number
  percentual: number
  /** Por transportadora (id): substitui a geral. */
  porTransportadora: Record<string, { valor: number; percentual: number }>
  /** Alerta de pedido despachado sem CT-e depois de N dias. */
  diasSemCte: number
  /** Alerta de fatura vencendo em N dias. */
  diasFatura: number
}
export const DEFAULT_REC: RecSettings = { valor: 1, percentual: 1, porTransportadora: {}, diasSemCte: 5, diasFatura: 5 }

const PAGE = 30
const MAX_FILES = 500
const n = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d))

/** CT-e: importação dos XMLs, vínculo com transportadora, filial e pedido, conciliação e decisão (aprovar ou contestar). */
@Injectable()
export class CteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly quotes: CotacaoService,
  ) {}

  recSettings(tenantId: string) {
    return this.settings.get<RecSettings>(tenantId, REC_KEY, DEFAULT_REC)
  }

  async saveRecSettings(user: AuthUser, d: Partial<RecSettings>, ctx: RequestCtx) {
    assertCan(user, 'fretes_cte', 'edit')
    if (allowedUnits(user, 'fretes_cte')) throw new BadRequestException('Só quem tem acesso a todas as filiais altera as tolerâncias.')
    const cur = await this.recSettings(user.tenantId)
    const next: RecSettings = { ...cur, ...d, porTransportadora: d.porTransportadora ?? cur.porTransportadora }
    for (const t of [next, ...Object.values(next.porTransportadora)]) {
      if (!(t.valor >= 0 && t.valor <= 10_000 && t.percentual >= 0 && t.percentual <= 100)) throw new BadRequestException('Tolerância inválida.')
    }
    if (!(next.diasSemCte >= 1 && next.diasSemCte <= 90 && next.diasFatura >= 0 && next.diasFatura <= 60)) throw new BadRequestException('Prazos de alerta inválidos.')
    await this.settings.set(user.tenantId, REC_KEY, next)
    await this.audit.byUser(user, ctx, 'frete.conciliacao.parametros', 'tenant_setting', REC_KEY, { antes: cur, depois: next })
    return next
  }

  private view(c: Prisma.FreightCteGetPayload<object>, extra: Record<string, unknown> = {}) {
    return {
      id: c.id,
      key: c.key,
      number: c.number,
      series: c.series,
      issuedAt: c.issuedAt,
      emitCnpj: c.emitCnpj,
      emitName: c.emitName,
      carrierId: c.carrierId,
      unitId: c.unitId,
      tomadorDoc: c.tomadorDoc,
      recipientDoc: c.recipientDoc,
      recipientName: c.recipientName,
      ufIni: c.ufIni,
      ufFim: c.ufFim,
      cityIni: c.cityIni,
      cityFim: c.cityFim,
      destZip: c.destZip,
      total: Number(c.total),
      cargoValue: n(c.cargoValue),
      weight: n(c.weight),
      components: c.components,
      icms: c.icms,
      nfeKeys: c.nfeKeys,
      fiscalStatus: c.fiscalStatus,
      protocol: c.protocol,
      protocolStatus: c.protocolStatus,
      shipmentId: c.shipmentId,
      recStatus: c.recStatus,
      recTypes: c.recTypes,
      recSource: c.recSource,
      expectedTotal: n(c.expectedTotal),
      difference: n(c.difference),
      recDetail: c.recDetail,
      recAt: c.recAt,
      decision: c.decision,
      approvedValue: n(c.approvedValue),
      decisionNote: c.decisionNote,
      decidedByName: c.decidedByName,
      decidedAt: c.decidedAt,
      contestStatus: c.contestStatus,
      creditValue: n(c.creditValue),
      contestNote: c.contestNote,
      invoiceId: c.invoiceId,
      importedByName: c.importedByName,
      createdAt: c.createdAt,
      ...extra,
    }
  }

  private scopeWhere(user: AuthUser): Prisma.FreightCteWhereInput {
    const units = allowedUnits(user, 'fretes_cte')
    return { tenantId: user.tenantId, ...(units ? { unitId: { in: units } } : {}) }
  }

  private async find(user: AuthUser, id: string) {
    const c = await this.prisma.freightCte.findFirst({ where: { id, ...this.scopeWhere(user) } })
    if (!c) throw new NotFoundException('CT-e não encontrado.')
    return c
  }

  /** Arquivos enviados: XMLs soltos, ou um .zip com XMLs (até 500). */
  private expand(files: Express.Multer.File[]) {
    const out: { name: string; text: string }[] = []
    for (const f of files) {
      let buf: Buffer = f.buffer
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: 50 * 1024 * 1024 })
      if (buf[0] === 0x50 && buf[1] === 0x4b) {
        let entries: Record<string, Uint8Array>
        try {
          entries = unzipSync(buf, { filter: (e) => /\.xml$/i.test(e.name) && e.originalSize < 5 * 1024 * 1024 })
        } catch {
          throw new BadRequestException(`Não foi possível abrir o arquivo ${f.originalname}.`)
        }
        for (const [name, data] of Object.entries(entries)) out.push({ name: name.split('/').pop()!, text: Buffer.from(data).toString('utf8') })
      } else out.push({ name: f.originalname, text: buf.toString('utf8') })
      if (out.length > MAX_FILES) throw new BadRequestException(`Envie até ${MAX_FILES} XMLs por vez.`)
    }
    return out
  }

  /** Importa os XMLs: novos CT-es, eventos de cancelamento e repetidos (ignorados pela chave). Concilia na hora. */
  async importXml(user: AuthUser, files: Express.Multer.File[], ctx: RequestCtx) {
    assertCan(user, 'fretes_cte', 'create')
    if (!files?.length) throw new BadRequestException('Envie os XMLs dos CT-es (ou um .zip com eles).')
    const docs = this.expand(files)
    const [carriers, units] = await Promise.all([
      this.prisma.freightCarrier.findMany({ where: { tenantId: user.tenantId }, select: { id: true, cnpj: true } }),
      this.prisma.unit.findMany({ where: { tenantId: user.tenantId }, select: { id: true, cnpj: true, city: true, state: true } }),
    ])
    const allowed = allowedUnits(user, 'fretes_cte')
    const result = { imported: 0, duplicated: 0, cancelled: 0, linked: 0, ignored: [] as { file: string; reason: string }[], ids: [] as string[] }
    const learnings: Extract<RateLearning, { ok: true }>[] = []
    for (const d of docs) {
      const cancel = parseCteCancel(d.text)
      if (cancel) {
        const c = await this.prisma.freightCte.findFirst({ where: { tenantId: user.tenantId, key: cancel.key } })
        if (!c) {
          result.ignored.push({ file: d.name, reason: 'Cancelamento de CT-e que ainda não foi importado.' })
          continue
        }
        await this.prisma.freightCte.update({ where: { id: c.id }, data: { fiscalStatus: 'CANCELADO', recStatus: 'CANCELADO' } })
        await this.audit.byUser(user, ctx, 'frete.cte.cancelado', 'freight_cte', c.id, { chave: c.key, protocolo: cancel.protocol })
        result.cancelled++
        continue
      }
      let cte: CteData
      try {
        cte = parseCteXml(d.text)
      } catch (e) {
        result.ignored.push({ file: d.name, reason: (e as Error).message })
        continue
      }
      if (!cte.key || cte.total === null) {
        result.ignored.push({ file: d.name, reason: 'CT-e sem chave ou sem valor da prestação.' })
        continue
      }
      if (await this.prisma.freightCte.count({ where: { tenantId: user.tenantId, key: cte.key } })) {
        result.duplicated++
        continue
      }
      // Transportadora pela raiz do CNPJ (a filial que emitiu pode ter outro CNPJ da mesma empresa).
      const root = cte.emitCnpj?.slice(0, 8)
      const carrier = carriers.find((c) => c.cnpj === cte.emitCnpj) ?? carriers.find((c) => root && c.cnpj.startsWith(root))
      // Filial da Usaparts: quem enviou, quem paga, ou a cidade de origem.
      const unit =
        units.find((u) => u.cnpj && u.cnpj === cte.senderDoc) ??
        units.find((u) => u.cnpj && u.cnpj === cte.tomadorDoc) ??
        units.find((u) => u.city && cte.cityIni && u.city.localeCompare(cte.cityIni, 'pt-BR', { sensitivity: 'base' }) === 0 && (!u.state || u.state === cte.ufIni))
      if (allowed && (!unit || !allowed.includes(unit.id))) {
        result.ignored.push({ file: d.name, reason: 'CT-e de filial que não está liberada para o seu usuário.' })
        continue
      }
      const shipment = cte.nfeKeys.length ? await this.prisma.freightShipment.findFirst({ where: { tenantId: user.tenantId, invoiceKey: { in: cte.nfeKeys }, status: { not: 'CANCELADO' } } }) : null
      const asset = await this.files.saveBuffer(user.tenantId, 'frete-cte', Buffer.from(d.text, 'utf8'), 'application/xml', 'xml')
      const created = await this.prisma.freightCte.create({
        data: {
          tenantId: user.tenantId,
          key: cte.key,
          number: cte.number,
          series: cte.series,
          issuedAt: cte.issuedAt ? new Date(cte.issuedAt) : null,
          emitCnpj: cte.emitCnpj,
          emitName: cleanText(cte.emitName, 160) || null,
          carrierId: carrier?.id ?? null,
          unitId: unit?.id ?? null,
          tomadorDoc: cte.tomadorDoc,
          senderDoc: cte.senderDoc,
          recipientDoc: cte.recipientDoc,
          recipientName: cleanText(cte.recipientName, 160) || null,
          ufIni: cte.ufIni,
          ufFim: cte.ufFim,
          cityIni: cte.cityIni,
          cityFim: cte.cityFim,
          destZip: normalizeCep(cte.destZip),
          cfop: cte.cfop,
          total: cte.total,
          cargoValue: cte.cargoValue,
          weight: cte.weight,
          components: cte.components as unknown as Prisma.InputJsonValue,
          icms: cte.icms as unknown as Prisma.InputJsonValue,
          nfeKeys: cte.nfeKeys,
          protocol: cte.protocol,
          protocolStatus: cte.protocolStatus,
          shipmentId: shipment?.id ?? null,
          fileId: asset.id,
          importedByName: user.name.slice(0, 120),
        },
      })
      if (shipment) {
        result.linked++
        if (!['ENTREGUE', 'CONCILIADO', 'CANCELADO'].includes(shipment.status)) {
          await this.prisma.freightShipment.update({ where: { id: shipment.id }, data: { status: 'AGUARDANDO_CONCILIACAO' } })
          await this.prisma.freightShipmentEvent.create({ data: { shipmentId: shipment.id, status: 'AGUARDANDO_CONCILIACAO', note: `CT-e ${cte.number} recebido`, userName: user.name.slice(0, 120) } })
        }
      }
      const learned = internalRateFrom(cte)
      if (learned.ok) learnings.push(learned)
      await this.reconcileOne(user, created.id)
      result.imported++
      result.ids.push(created.id)
    }
    // Alíquota interna de ICMS aprendida dos CT-es de frete dentro do mesmo estado.
    const icms = learnings.length ? await this.quotes.applyIcmsLearnings(user, learnings, ctx, true) : null
    await this.audit.byUser(user, ctx, 'frete.cte.importados', 'freight_cte', undefined, { arquivos: docs.length, novos: result.imported, repetidos: result.duplicated, cancelados: result.cancelled, ignorados: result.ignored.length })
    return { ...result, ignored: result.ignored.slice(0, 100), icmsUpdated: icms?.updated ?? [] }
  }

  /** Concilia (ou reconcilia) um CT-e: referência = cotação do pedido, senão a tabela vigente na data do CT-e. */
  async reconcileOne(user: AuthUser, id: string) {
    const c = await this.prisma.freightCte.findUniqueOrThrow({ where: { id } })
    if (c.fiscalStatus === 'CANCELADO') return
    const settings = await this.recSettings(user.tenantId)
    const tol: Tolerance = c.carrierId && settings.porTransportadora[c.carrierId] ? { value: settings.porTransportadora[c.carrierId]!.valor, percent: settings.porTransportadora[c.carrierId]!.percentual } : { value: settings.valor, percent: settings.percentual }
    let expected: (ExpectedRef & { label: string }) | null = null
    let source: string | null = null
    const shipment = c.shipmentId ? await this.prisma.freightShipment.findUnique({ where: { id: c.shipmentId } }) : null
    const exp = shipment?.expected as unknown as (Partial<QuoteResult> & { quoteCode?: number }) | null
    if (exp && exp.total !== null && exp.total !== undefined) {
      expected = { total: exp.total, components: exp.components ?? [], icms: exp.icms ?? null, weight: exp.weights?.taxed ?? null, label: `Cotação nº ${exp.quoteCode} (${exp.tableName ?? ''} v${exp.versionNumber ?? ''})` }
      source = 'COTACAO'
    } else if (c.carrierId && c.unitId && c.destZip && c.weight) {
      const r = await this.quotes.expectedByTable(user, {
        unitId: c.unitId,
        carrierId: c.carrierId,
        destZip: c.destZip,
        destCity: c.cityFim,
        destUf: c.ufFim,
        personType: c.recipientDoc?.length === 11 ? 'PF' : 'PJ',
        recipientDoc: c.recipientDoc,
        cargoValue: n(c.cargoValue) ?? 0,
        weight: Number(c.weight),
        date: c.issuedAt ?? c.createdAt,
      })
      if (r?.total !== null && r?.total !== undefined) {
        expected = { total: r.total, components: r.components, icms: r.icms, weight: r.weights?.taxed ?? null, label: `${r.tableName} v${r.versionNumber}, recalculada na data do CT-e` }
        source = 'TABELA'
      }
    }
    if (!expected) {
      const why = !c.carrierId ? 'Transportadora do CT-e não cadastrada (CNPJ do emitente).' : !c.unitId ? 'Filial de origem não identificada (cadastre o CNPJ das filiais).' : !c.weight || !c.destZip ? 'CT-e sem peso ou CEP de destino.' : 'Nenhuma tabela da transportadora calcula este frete na data do CT-e e não há pedido com cotação.'
      await this.prisma.freightCte.update({ where: { id }, data: { recStatus: 'SEM_REFERENCIA', recTypes: [], recSource: null, expectedTotal: null, difference: null, recDetail: { reason: why } as Prisma.InputJsonValue, recAt: new Date() } })
      return
    }
    const comps = (c.components as unknown as { name: string; value: number }[]) ?? []
    const icms = c.icms as unknown as { rate: number | null; value: number | null } | null
    const r = reconcile(expected, { total: Number(c.total), components: comps, icms, weight: n(c.weight) }, tol)
    await this.prisma.freightCte.update({
      where: { id },
      data: {
        recStatus: r.status,
        recTypes: r.types,
        recSource: source,
        expectedTotal: r.expectedTotal,
        difference: r.difference,
        recDetail: { ...r, reference: expected.label } as unknown as Prisma.InputJsonValue,
        recAt: new Date(),
        // Conciliado sem divergência: aprovado automaticamente pelo valor cobrado.
        ...(r.status === 'CONCILIADO' && !c.decision ? { decision: 'APROVADO', approvedValue: Number(c.total), decidedByName: 'Conciliação automática', decidedAt: new Date() } : {}),
      },
    })
    if (shipment && r.status === 'CONCILIADO' && shipment.status === 'AGUARDANDO_CONCILIACAO') {
      await this.prisma.freightShipment.update({ where: { id: shipment.id }, data: { status: 'CONCILIADO' } })
      await this.prisma.freightShipmentEvent.create({ data: { shipmentId: shipment.id, status: 'CONCILIADO', note: `CT-e ${c.number} conciliado`, userName: 'Conciliação automática' } })
    }
  }

  async reprocess(user: AuthUser, id: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_cte', 'edit')
    const c = await this.find(user, id)
    await this.reconcileOne(user, id)
    await this.audit.byUser(user, ctx, 'frete.cte.reconciliado', 'freight_cte', id, { chave: c.key })
    return this.get(user, id)
  }

  /** Liga o CT-e a um pedido escolhido à mão (quando a NF-e não estava no pedido) e reconcilia. */
  async link(user: AuthUser, id: string, shipmentId: string | null, ctx: RequestCtx) {
    assertCan(user, 'fretes_cte', 'edit')
    const c = await this.find(user, id)
    if (shipmentId && !(await this.prisma.freightShipment.count({ where: { id: shipmentId, tenantId: user.tenantId } }))) throw new BadRequestException('Pedido inválido.')
    await this.prisma.freightCte.update({ where: { id }, data: { shipmentId } })
    await this.reconcileOne(user, id)
    await this.audit.byUser(user, ctx, 'frete.cte.vinculado', 'freight_cte', id, { chave: c.key, pedido: shipmentId })
    return this.get(user, id)
  }

  /**
   * Decisão sobre o CT-e: aprovar o cobrado, aprovar só o cotado (contestando a diferença) ou contestar. Valor
   * aprovado e valor pago ficam separados do cobrado e do cotado.
   */
  async decide(user: AuthUser, id: string, d: { decision: 'APROVADO' | 'APROVADO_COTADO' | 'CONTESTADO'; note?: string | null; approvedValue?: number | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_cte', 'edit')
    const c = await this.find(user, id)
    if (c.fiscalStatus === 'CANCELADO') throw new BadRequestException('CT-e cancelado.')
    const note = cleanText(d.note, 1000) || null
    if (d.decision !== 'APROVADO' && (!note || note.length < 5)) throw new BadRequestException('Explique o motivo (ex.: frete peso acima da tabela, TDE sem o cliente estar na lista).')
    let approvedValue: number | null
    if (d.decision === 'APROVADO') approvedValue = d.approvedValue ?? Number(c.total)
    else if (d.decision === 'APROVADO_COTADO') {
      if (c.expectedTotal === null) throw new BadRequestException('CT-e sem valor cotado para aprovar.')
      approvedValue = Number(c.expectedTotal)
    } else approvedValue = null
    if (approvedValue !== null && (approvedValue < 0 || approvedValue > Number(c.total) + 0.004)) throw new BadRequestException('Valor aprovado deve ficar entre zero e o valor cobrado.')
    const contested = d.decision !== 'APROVADO'
    await this.prisma.freightCte.update({
      where: { id },
      data: {
        decision: d.decision,
        approvedValue,
        decisionNote: note,
        decidedByName: user.name.slice(0, 120),
        decidedAt: new Date(),
        contestStatus: contested ? 'ABERTA' : null,
        creditValue: null,
        contestNote: null,
      },
    })
    await this.audit.byUser(user, ctx, 'frete.cte.decisao', 'freight_cte', id, { chave: c.key, decisao: d.decision, aprovado: approvedValue, cobrado: Number(c.total), cotado: n(c.expectedTotal), motivo: note })
    // Com a decisão tomada, o pedido sai da fila de conciliação.
    if (c.shipmentId) {
      const s = await this.prisma.freightShipment.findUnique({ where: { id: c.shipmentId }, select: { status: true } })
      if (s?.status === 'AGUARDANDO_CONCILIACAO') {
        await this.prisma.freightShipment.update({ where: { id: c.shipmentId }, data: { status: 'CONCILIADO' } })
        await this.prisma.freightShipmentEvent.create({ data: { shipmentId: c.shipmentId, status: 'CONCILIADO', note: `CT-e ${c.number}: ${d.decision === 'APROVADO' ? 'aprovado o cobrado' : d.decision === 'APROVADO_COTADO' ? 'aprovado o cotado, diferença contestada' : 'contestado'}`, userName: user.name.slice(0, 120) } })
      }
    }
    return this.get(user, id)
  }

  /** Resultado da contestação: aceita (com o crédito/abatimento obtido) ou recusada (paga o cobrado). */
  async contestResult(user: AuthUser, id: string, d: { result: 'ACEITA' | 'RECUSADA'; creditValue?: number | null; note?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_cte', 'edit')
    const c = await this.find(user, id)
    if (c.contestStatus !== 'ABERTA') throw new BadRequestException('Não há contestação aberta neste CT-e.')
    const total = Number(c.total)
    let credit: number | null = null
    let approved = total
    if (d.result === 'ACEITA') {
      credit = money(d.creditValue ?? total - (n(c.approvedValue) ?? n(c.expectedTotal) ?? total))
      if (!(credit > 0) || credit > total) throw new BadRequestException('Informe o crédito obtido (maior que zero e até o valor cobrado).')
      approved = money(total - credit)
    }
    await this.prisma.freightCte.update({ where: { id }, data: { contestStatus: d.result, creditValue: credit, approvedValue: approved, contestNote: cleanText(d.note, 1000) || null } })
    await this.audit.byUser(user, ctx, 'frete.cte.contestacao', 'freight_cte', id, { chave: c.key, resultado: d.result, credito: credit, aprovado: approved })
    return this.get(user, id)
  }

  async list(user: AuthUser, f: { unitId?: string; carrierId?: string; recStatus?: string; decision?: string; from?: string; to?: string; search?: string; page?: number; pending?: boolean }) {
    assertCan(user, 'fretes_cte', 'view')
    const and: Prisma.FreightCteWhereInput[] = [this.scopeWhere(user)]
    if (f.unitId) and.push({ unitId: f.unitId })
    if (f.carrierId) and.push({ carrierId: f.carrierId })
    if (f.recStatus) and.push({ recStatus: f.recStatus })
    if (f.decision === 'SEM_DECISAO') and.push({ decision: null })
    else if (f.decision === 'CONTESTACAO_ABERTA') and.push({ contestStatus: 'ABERTA' })
    else if (f.decision) and.push({ decision: f.decision })
    if (f.pending) and.push({ OR: [{ recStatus: { in: ['DIVERGENTE', 'SEM_REFERENCIA'] }, decision: null }, { contestStatus: 'ABERTA' }] })
    if (f.from) and.push({ issuedAt: { gte: new Date(`${f.from}T00:00:00-03:00`) } })
    if (f.to) and.push({ issuedAt: { lt: new Date(new Date(`${f.to}T00:00:00-03:00`).getTime() + 86_400_000) } })
    const term = f.search?.trim()
    if (term) {
      const digits = term.replace(/\D/g, '')
      and.push({
        OR: [
          { number: { contains: term } },
          { recipientName: { contains: term, mode: 'insensitive' } },
          { cityFim: { contains: term, mode: 'insensitive' } },
          ...(digits.length === 44 ? [{ key: digits }, { nfeKeys: { has: digits } }] : []),
        ],
      })
    }
    const page = Math.max(1, f.page ?? 1)
    const where = { AND: and }
    const [total, rows, sums, byStatus] = await Promise.all([
      this.prisma.freightCte.count({ where }),
      this.prisma.freightCte.findMany({ where, orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * PAGE, take: PAGE }),
      this.prisma.freightCte.aggregate({ where: { AND: [...and, { fiscalStatus: { not: 'CANCELADO' } }] }, _sum: { total: true, expectedTotal: true, difference: true, approvedValue: true, creditValue: true } }),
      this.prisma.freightCte.groupBy({ by: ['recStatus'], where: this.scopeWhere(user), _count: { _all: true } }),
    ])
    const carriers = await this.prisma.freightCarrier.findMany({ where: { id: { in: rows.map((r) => r.carrierId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })
    return {
      total,
      page,
      pageSize: PAGE,
      counts: Object.fromEntries(byStatus.map((b) => [b.recStatus, b._count._all])),
      sums: { charged: n(sums._sum.total) ?? 0, expected: n(sums._sum.expectedTotal) ?? 0, difference: n(sums._sum.difference) ?? 0, approved: n(sums._sum.approvedValue) ?? 0, credit: n(sums._sum.creditValue) ?? 0 },
      items: rows.map((r) => this.view(r, { carrierName: carriers.find((c) => c.id === r.carrierId)?.name ?? null, components: undefined, recDetail: undefined })),
    }
  }

  async get(user: AuthUser, id: string) {
    assertCan(user, 'fretes_cte', 'view')
    const c = await this.find(user, id)
    const [carrier, unit, shipment, invoice] = await Promise.all([
      c.carrierId ? this.prisma.freightCarrier.findUnique({ where: { id: c.carrierId }, select: { id: true, name: true } }) : null,
      c.unitId ? this.prisma.unit.findUnique({ where: { id: c.unitId }, select: { id: true, name: true } }) : null,
      c.shipmentId ? this.prisma.freightShipment.findUnique({ where: { id: c.shipmentId }, select: { id: true, code: true, orderNumber: true, invoiceNumber: true, status: true } }) : null,
      c.invoiceId ? this.prisma.freightInvoice.findUnique({ where: { id: c.invoiceId }, select: { id: true, number: true, status: true } }) : null,
    ])
    return this.view(c, { carrierName: carrier?.name ?? null, unitName: unit?.name ?? null, shipment, invoice })
  }

  async xml(user: AuthUser, id: string) {
    assertCan(user, 'fretes_cte', 'export')
    const c = await this.find(user, id)
    if (!c.fileId) throw new NotFoundException('XML não guardado.')
    const { content } = await this.files.read(c.fileId)
    return { fileName: `CTe${c.key}.xml`, content }
  }
}
