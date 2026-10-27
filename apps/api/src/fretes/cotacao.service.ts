import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnit, unitListWhere } from './acesso'
import { cityKey, formatCep, normalizeCep, normalizeUf, ufByCep, validCnpj, validCpf } from './cep'
import { addBusinessDays, calculate, type CalcResult, matchRule, type Measures, measure, type Volume, weights } from './motor'
import { componentsOf, ruleFromRow, settingsOf, todayUtc } from './tabelas.service'

export interface QuoteInput {
  unitId: string
  originZip?: string | null
  destZip: string
  destCity?: string | null
  destUf?: string | null
  personType: 'PF' | 'PJ'
  customerName?: string | null
  customerDoc?: string | null
  cargoValue: number
  totalValue?: number | null
  weight?: number | null
  volumes?: Volume[]
  goodsType?: string | null
  quoteDate?: string | null
  reference?: string | null
  notes?: string | null
  /** Liberar tabela vencida nesta cotação (exige permissão de editar tabelas e justificativa). */
  allowExpired?: boolean
  expiredReason?: string | null
}

export type ResultStatus = 'OK' | 'SEM_COBERTURA' | 'RESTRITO' | 'FORA_FAIXA' | 'NAO_APLICAVEL' | 'VENCIDA' | 'SEM_VERSAO' | 'ERRO' | 'SEM_TABELA'

export interface QuoteResult {
  tableId: string | null
  tableName: string | null
  quoteName: string
  carrierId: string
  carrierName: string
  versionId: string | null
  versionNumber: number | null
  status: ResultStatus
  reason: string | null
  total: number | null
  subtotal: number | null
  icms: CalcResult['icms'] | null
  components: CalcResult['components']
  weights: CalcResult['weights'] | null
  deadlineDays: number | null
  deliveryDate: string | null
  validUntil: string | null
  rule: { id: string | null; by: string; label: string } | null
  warnings: string[]
  expiredUsed: boolean
}

const QUOTES_PAGE = 30
const CEP_CACHE_DAYS = 90
const iso = (d: Date) => d.toISOString().slice(0, 10)

const STATUS_ORDER: Record<ResultStatus, number> = { OK: 0, FORA_FAIXA: 1, RESTRITO: 2, SEM_COBERTURA: 3, VENCIDA: 4, NAO_APLICAVEL: 5, SEM_VERSAO: 6, ERRO: 7, SEM_TABELA: 8 }

/** Cotação: calcula todas as tabelas que podem atender e guarda tudo o que foi usado para reproduzir depois. */
@Injectable()
export class CotacaoService {
  private readonly logger = new Logger(CotacaoService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Cidade e UF do CEP: cache local; senão ViaCEP (serviço público). Sem resposta, a UF sai da faixa oficial de CEPs. */
  async cep(raw: string) {
    const cep = normalizeCep(raw)
    if (!cep) throw new BadRequestException('CEP inválido.')
    const cached = await this.prisma.freightCep.findUnique({ where: { cep } })
    if (cached && Date.now() - cached.fetchedAt.getTime() < CEP_CACHE_DAYS * 86_400_000) {
      return { cep, city: cached.city, uf: cached.uf ?? ufByCep(cep), district: cached.district, street: cached.street, found: cached.found, source: 'cache' as const }
    }
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = (await res.json()) as { erro?: boolean | string; localidade?: string; uf?: string; bairro?: string; logradouro?: string }
      const found = !j.erro
      const data = {
        city: found ? cleanText(j.localidade, 120) || null : null,
        uf: found ? normalizeUf(j.uf) : null,
        district: found ? cleanText(j.bairro, 120) || null : null,
        street: found ? cleanText(j.logradouro, 200) || null : null,
        found,
        fetchedAt: new Date(),
      }
      await this.prisma.freightCep.upsert({ where: { cep }, create: { cep, ...data }, update: data })
      return { cep, ...data, uf: data.uf ?? ufByCep(cep), source: 'viacep' as const }
    } catch (err) {
      this.logger.warn(`Consulta de CEP ${cep} sem resposta: ${(err as Error).message}`)
      return { cep, city: cached?.city ?? null, uf: cached?.uf ?? ufByCep(cep), district: null, street: null, found: !!cached?.found, source: 'faixa' as const }
    }
  }

  private async prepare(user: AuthUser, d: QuoteInput, simulation = false) {
    const unit = await this.prisma.unit.findFirst({ where: { id: d.unitId, tenantId: user.tenantId } })
    if (!unit) throw new BadRequestException('Filial de origem inválida.')
    const originZip = normalizeCep(d.originZip || unit.zip)
    if (!originZip && !simulation) throw new BadRequestException(`Informe o CEP de origem (ou cadastre o CEP de expedição da filial ${unit.name}).`)
    const destZip = normalizeCep(d.destZip)
    if (!destZip) throw new BadRequestException('CEP de destino inválido.')
    let destCity = cleanText(d.destCity, 120) || null
    let destUf = d.destUf ? normalizeUf(d.destUf) : null
    if (!destCity || !destUf) {
      const info = await this.cep(destZip)
      destCity ??= info.city
      destUf ??= info.uf
    }
    if (!(d.cargoValue >= 0) || d.cargoValue > 100_000_000) throw new BadRequestException('Valor da mercadoria inválido.')
    let m: Measures
    try {
      m = measure((d.volumes ?? []).slice(0, 200), d.weight)
    } catch (e) {
      throw new BadRequestException((e as Error).message)
    }
    if (!(m.realWeight > 0)) throw new BadRequestException('Informe o peso (total ou por volume).')
    const doc = (d.customerDoc ?? '').replace(/\D/g, '') || null
    if (doc && !(doc.length === 11 ? validCpf(doc) : doc.length === 14 ? validCnpj(doc) : false)) throw new BadRequestException('CPF/CNPJ do destinatário inválido.')
    const quoteDate = d.quoteDate ? new Date(`${d.quoteDate}T00:00:00Z`) : todayUtc()
    if (Number.isNaN(quoteDate.getTime())) throw new BadRequestException('Data da cotação inválida.')
    return { unit, originZip, destZip, destCity, destUf, measures: m, doc, quoteDate }
  }

  /**
   * Avalia uma tabela. forceVersionId: reprodução de cotação antiga (usa exatamente aquela versão, mesmo substituída).
   */
  private async evaluate(
    t: Prisma.FreightTableGetPayload<{ include: { carrier: true } }>,
    p: Awaited<ReturnType<CotacaoService['prepare']>>,
    d: QuoteInput,
    opts: { allowExpired: boolean; forceVersionId?: string },
  ): Promise<QuoteResult> {
    const base: QuoteResult = {
      tableId: t.id,
      tableName: t.name,
      quoteName: t.quoteName || t.carrier.quoteName || t.carrier.name,
      carrierId: t.carrierId,
      carrierName: t.carrier.name,
      versionId: null,
      versionNumber: null,
      status: 'OK',
      reason: null,
      total: null,
      subtotal: null,
      icms: null,
      components: [],
      weights: null,
      deadlineDays: null,
      deliveryDate: null,
      validUntil: iso(t.validTo),
      rule: null,
      warnings: [],
      expiredUsed: false,
    }
    const no = (status: ResultStatus, reason: string): QuoteResult => ({ ...base, status, reason })
    const forced = !!opts.forceVersionId
    if (!forced) {
      if (t.validFrom > p.quoteDate) return no('NAO_APLICAVEL', `Vigência começa em ${t.validFrom.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.`)
      if (t.validTo < p.quoteDate) {
        if (!opts.allowExpired) return no('VENCIDA', `Tabela vencida em ${t.validTo.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}. Só entra com liberação justificada.`)
        base.expiredUsed = true
        base.warnings.push(`Tabela vencida em ${t.validTo.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}, usada com liberação.`)
      }
      if (t.personType !== 'AMBOS' && t.personType !== d.personType) return no('NAO_APLICAVEL', `Tabela só para ${t.personType === 'PF' ? 'pessoa física' : 'pessoa jurídica'}.`)
      if (t.goodsTypes.length && d.goodsType && !t.goodsTypes.includes(d.goodsType)) return no('NAO_APLICAVEL', `Tabela não vale para o tipo de mercadoria ${d.goodsType}.`)
      const w = p.measures.realWeight
      if (t.weightMin !== null && w < Number(t.weightMin)) return no('NAO_APLICAVEL', `Peso abaixo do mínimo da tabela (${Number(t.weightMin)} kg).`)
      if (t.weightMax !== null && w > Number(t.weightMax)) return no('NAO_APLICAVEL', `Peso acima do máximo da tabela (${Number(t.weightMax)} kg).`)
      if (t.valueMin !== null && d.cargoValue < Number(t.valueMin)) return no('NAO_APLICAVEL', `Valor abaixo do mínimo da tabela (R$ ${Number(t.valueMin).toFixed(2)}).`)
      if (t.valueMax !== null && d.cargoValue > Number(t.valueMax)) return no('NAO_APLICAVEL', `Valor acima do máximo da tabela (R$ ${Number(t.valueMax).toFixed(2)}).`)
    }
    const versionId = opts.forceVersionId ?? t.publishedVersionId
    if (!versionId) return no('SEM_VERSAO', 'Tabela sem versão publicada.')
    const v = await this.prisma.freightTableVersion.findUnique({ where: { id: versionId } })
    if (!v) return no('SEM_VERSAO', 'Versão da tabela não encontrada.')
    base.versionId = v.id
    base.versionNumber = v.number

    const zip = Number(p.destZip)
    const key = cityKey(p.destCity)
    const rows = await this.prisma.freightRule.findMany({
      where: {
        versionId: v.id,
        OR: [
          { cepStart: { lte: zip }, cepEnd: { gte: zip } },
          ...(p.destUf ? [{ cepStart: null, uf: p.destUf }] : []),
          ...(key ? [{ cepStart: null, cityKey: key }] : []),
        ],
      },
      take: 2000,
    })
    const settings = settingsOf(v.settings)
    const m = p.measures
    const match = matchRule(rows.map(ruleFromRow), { zip, uf: p.destUf, city: p.destCity }, weights(m, settings).taxed)
    if (!match.rule) return no('SEM_COBERTURA', match.reason)
    const r = match.rule
    const label = match.by === 'CEP' ? `CEP ${formatCep(r.cepStart)} a ${formatCep(r.cepEnd)}` : match.by === 'CIDADE' ? `${r.city}${r.uf ? `/${r.uf}` : ''}` : `UF ${r.uf}`
    base.rule = { id: r.id ?? null, by: match.by, label: `${label}, ${r.weightMin} a ${r.weightMax ?? '∞'} kg` }
    // Observação da transportadora para o destino (taxa por volume, dias de entrega): aparece para quem cota.
    const note = rows.find((x) => x.id === r.id)?.note
    if (note) base.warnings.push(`Observação da transportadora: ${note}`)
    if (r.restricted) return no('RESTRITO', `A transportadora marcou restrição de atendimento para este destino.${note ? ` ${note}` : ''}`)
    const res = calculate(componentsOf(v.components), settings, match, { cargoValue: d.cargoValue, totalValue: d.totalValue, personType: d.personType, measures: m })
    base.weights = res.weights
    base.components = res.components
    base.warnings.push(...res.warnings)
    if (!res.ok) return { ...base, status: match.exceeded ? 'FORA_FAIXA' : 'ERRO', reason: res.error }
    const deadline = r.deadlineDays === null ? null : r.deadlineDays + (t.dispatchDays ?? 0)
    return {
      ...base,
      total: res.total,
      subtotal: res.subtotal,
      icms: res.icms,
      deadlineDays: deadline,
      deliveryDate: deadline === null ? null : iso(addBusinessDays(p.quoteDate, deadline)),
    }
  }

  private async compute(user: AuthUser, d: QuoteInput, allowExpired: boolean) {
    const p = await this.prepare(user, d)
    const tables = await this.prisma.freightTable.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'ATIVA',
        usage: { in: ['COTACAO_CONCILIACAO', 'COTACAO'] },
        OR: [{ unitIds: { isEmpty: true } }, { unitIds: { has: p.unit.id } }],
        carrier: { active: true, OR: [{ unitIds: { isEmpty: true } }, { unitIds: { has: p.unit.id } }] },
      },
      include: { carrier: true },
    })
    const results = await Promise.all(tables.map((t) => this.evaluate(t, p, d, { allowExpired })))
    // Transportadoras ativas da filial sem nenhuma tabela ativa: aparecem para ninguém achar que foram esquecidas.
    const withTable = new Set(tables.map((t) => t.carrierId))
    const carriers = await this.prisma.freightCarrier.findMany({
      where: { tenantId: user.tenantId, active: true, id: { notIn: [...withTable] }, OR: [{ unitIds: { isEmpty: true } }, { unitIds: { has: p.unit.id } }] },
      select: { id: true, name: true, quoteName: true },
      take: 100,
    })
    for (const c of carriers) {
      results.push({
        tableId: null, tableName: null, quoteName: c.quoteName || c.name, carrierId: c.id, carrierName: c.name, versionId: null, versionNumber: null,
        status: 'SEM_TABELA', reason: 'Sem tabela de frete ativa para esta filial.', total: null, subtotal: null, icms: null, components: [], weights: null,
        deadlineDays: null, deliveryDate: null, validUntil: null, rule: null, warnings: [], expiredUsed: false,
      })
    }
    results.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.total ?? Infinity) - (b.total ?? Infinity) || (a.deadlineDays ?? 999) - (b.deadlineDays ?? 999))
    return { p, results }
  }

  private inputSnapshot(d: QuoteInput, p: Awaited<ReturnType<CotacaoService['prepare']>>) {
    return {
      unitId: d.unitId,
      originZip: p.originZip,
      destZip: p.destZip,
      destCity: p.destCity,
      destUf: p.destUf,
      personType: d.personType,
      cargoValue: d.cargoValue,
      totalValue: d.totalValue ?? null,
      weight: d.weight ?? null,
      volumes: d.volumes ?? [],
      goodsType: d.goodsType ?? null,
      quoteDate: iso(p.quoteDate),
    }
  }

  /** Calcula e (por padrão) salva no histórico. Toda cotação calculada fica registrada com a versão de cada tabela. */
  async quote(user: AuthUser, d: QuoteInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_cotacao', 'create')
    assertUnit(user, 'fretes_cotacao', d.unitId)
    let reason: string | null = null
    if (d.allowExpired) {
      if (!can(user.permissions, user.role.isSystem, 'fretes_tabelas', 'edit')) throw new ForbiddenException('Só quem pode editar tabelas de frete libera tabela vencida.')
      reason = cleanText(d.expiredReason, 500)
      if (reason.length < 10) throw new BadRequestException('Explique por que a tabela vencida pode ser usada (mínimo 10 caracteres).')
    }
    const { p, results } = await this.compute(user, d, !!d.allowExpired)
    const ok = results.filter((r) => r.status === 'OK')
    const q = await this.prisma.freightQuote.create({
      data: {
        tenantId: user.tenantId,
        unitId: p.unit.id,
        reference: cleanText(d.reference, 80) || null,
        customerName: cleanText(d.customerName, 160) || null,
        customerDoc: p.doc,
        personType: d.personType,
        originZip: p.originZip!,
        destZip: p.destZip,
        destCity: p.destCity,
        destUf: p.destUf,
        cargoValue: d.cargoValue,
        realWeight: p.measures.realWeight,
        cubicMeters: p.measures.cubicMeters,
        volumes: (d.volumes ?? []) as unknown as Prisma.InputJsonValue,
        quoteDate: p.quoteDate,
        input: this.inputSnapshot(d, p) as unknown as Prisma.InputJsonValue,
        results: results as unknown as Prisma.InputJsonValue,
        bestTotal: ok[0]?.total ?? null,
        expiredAllowedReason: reason,
        notes: cleanText(d.notes, 2000, true) || null,
        createdById: user.id,
        createdByName: user.name,
      },
    })
    if (reason) await this.audit.byUser(user, ctx, 'frete.cotacao.tabela_vencida_liberada', 'freight_quote', q.id, { cotacao: q.code, justificativa: reason, tabelas: results.filter((r) => r.expiredUsed).map((r) => r.tableId) })
    return this.view(q)
  }

  private view(q: Prisma.FreightQuoteGetPayload<object>, unitName?: string) {
    return {
      id: q.id,
      code: q.code,
      unitId: q.unitId,
      unitName: unitName ?? null,
      reference: q.reference,
      customerName: q.customerName,
      customerDoc: q.customerDoc,
      personType: q.personType,
      originZip: q.originZip,
      destZip: q.destZip,
      destCity: q.destCity,
      destUf: q.destUf,
      cargoValue: Number(q.cargoValue),
      realWeight: Number(q.realWeight),
      cubicMeters: Number(q.cubicMeters),
      volumes: q.volumes,
      quoteDate: iso(q.quoteDate),
      input: q.input,
      results: q.results as unknown as QuoteResult[],
      bestTotal: q.bestTotal === null ? null : Number(q.bestTotal),
      status: q.status,
      selectedTableId: q.selectedTableId,
      selectedVersionId: q.selectedVersionId,
      selectedCarrierId: q.selectedCarrierId,
      selectedTotal: q.selectedTotal === null ? null : Number(q.selectedTotal),
      selectedAt: q.selectedAt,
      selectedByName: q.selectedByName,
      selectionNote: q.selectionNote,
      expiredAllowedReason: q.expiredAllowedReason,
      notes: q.notes,
      createdByName: q.createdByName,
      createdAt: q.createdAt,
    }
  }

  private async find(user: AuthUser, id: string) {
    const units = allowedUnits(user, 'fretes_cotacao')
    const q = await this.prisma.freightQuote.findFirst({ where: { id, tenantId: user.tenantId, ...(units ? { unitId: { in: units } } : {}) } })
    if (!q) throw new NotFoundException('Cotação não encontrada.')
    return q
  }

  async get(user: AuthUser, id: string) {
    assertCan(user, 'fretes_cotacao', 'view')
    const q = await this.find(user, id)
    const unit = await this.prisma.unit.findUnique({ where: { id: q.unitId }, select: { name: true } })
    return this.view(q, unit?.name)
  }

  async list(user: AuthUser, f: { unitId?: string; carrierId?: string; status?: string; from?: string; to?: string; search?: string; page?: number }) {
    assertCan(user, 'fretes_cotacao', 'view')
    const units = allowedUnits(user, 'fretes_cotacao')
    const and: Prisma.FreightQuoteWhereInput[] = [{ tenantId: user.tenantId }]
    if (units) and.push({ unitId: { in: units } })
    if (f.unitId) and.push({ unitId: f.unitId })
    if (f.carrierId) and.push({ selectedCarrierId: f.carrierId })
    if (f.status && ['CALCULADA', 'SELECIONADA', 'CANCELADA'].includes(f.status)) and.push({ status: f.status })
    if (f.from) and.push({ createdAt: { gte: new Date(`${f.from}T00:00:00-03:00`) } })
    if (f.to) and.push({ createdAt: { lt: new Date(new Date(`${f.to}T00:00:00-03:00`).getTime() + 86_400_000) } })
    const term = f.search?.trim()
    if (term) {
      const digits = term.replace(/\D/g, '')
      and.push({
        OR: [
          { reference: { contains: term, mode: 'insensitive' } },
          { customerName: { contains: term, mode: 'insensitive' } },
          { destCity: { contains: term, mode: 'insensitive' } },
          ...(digits.length >= 5 ? [{ destZip: { startsWith: digits.slice(0, 8) } }] : []),
          ...(/^\d{1,9}$/.test(term) ? [{ code: Number(term) }] : []),
        ],
      })
    }
    const page = Math.max(1, f.page ?? 1)
    const where = { AND: and }
    const [total, rows, unitRows] = await Promise.all([
      this.prisma.freightQuote.count({ where }),
      this.prisma.freightQuote.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * QUOTES_PAGE, take: QUOTES_PAGE }),
      this.prisma.unit.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
    ])
    return {
      total,
      page,
      pageSize: QUOTES_PAGE,
      items: rows.map((q) => {
        const v = this.view(q, unitRows.find((u) => u.id === q.unitId)?.name)
        const sel = v.results.find((r) => r.tableId === q.selectedTableId)
        return {
          ...v,
          results: undefined,
          input: undefined,
          options: v.results.filter((r) => r.status === 'OK').length,
          selectedCarrierName: sel?.carrierName ?? null,
        }
      }),
    }
  }

  /** Escolha da transportadora. Não sendo a mais barata, pede o motivo (prazo, restrição, regra comercial). */
  async select(user: AuthUser, id: string, d: { tableId: string; note?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_cotacao', 'edit')
    const q = await this.find(user, id)
    if (q.status === 'CANCELADA') throw new BadRequestException('Cotação cancelada.')
    const results = q.results as unknown as QuoteResult[]
    const r = results.find((x) => x.tableId === d.tableId)
    if (!r || r.status !== 'OK' || r.total === null) throw new BadRequestException('Escolha uma opção calculada (com valor).')
    const note = cleanText(d.note, 500) || null
    const cheapest = Math.min(...results.filter((x) => x.status === 'OK' && x.total !== null).map((x) => x.total!))
    if (r.total > cheapest + 0.004 && (!note || note.length < 5)) throw new BadRequestException('Esta não é a opção mais barata: informe o motivo da escolha (ex.: prazo, restrição de entrega, pedido do cliente).')
    const updated = await this.prisma.freightQuote.update({
      where: { id },
      data: { status: 'SELECIONADA', selectedTableId: r.tableId, selectedVersionId: r.versionId, selectedCarrierId: r.carrierId, selectedTotal: r.total, selectedAt: new Date(), selectedByName: user.name, selectionNote: note },
    })
    await this.audit.byUser(user, ctx, 'frete.cotacao.transportadora_escolhida', 'freight_quote', id, { cotacao: q.code, transportadora: r.carrierName, tabela: r.tableName, versao: r.versionNumber, valor: r.total, maisBarata: cheapest, motivo: note })
    return this.view(updated)
  }

  async cancel(user: AuthUser, id: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_cotacao', 'edit')
    const q = await this.find(user, id)
    const updated = await this.prisma.freightQuote.update({ where: { id }, data: { status: 'CANCELADA' } })
    await this.audit.byUser(user, ctx, 'frete.cotacao.cancelada', 'freight_quote', id, { cotacao: q.code })
    return this.view(updated)
  }

  /**
   * Refaz o cálculo com as entradas e as mesmas versões de tabela gravadas na cotação, e compara com o resultado original.
   * Diferença aqui indica alteração indevida de dados (versões publicadas não mudam).
   */
  async reproduce(user: AuthUser, id: string) {
    assertCan(user, 'fretes_cotacao', 'view')
    const q = await this.find(user, id)
    const input = q.input as unknown as QuoteInput
    const original = (q.results as unknown as QuoteResult[]).filter((r) => r.status === 'OK' && r.tableId && r.versionId)
    const p = await this.prepare(user, { ...input, destCity: q.destCity, destUf: q.destUf })
    const tables = await this.prisma.freightTable.findMany({ where: { id: { in: original.map((r) => r.tableId!) }, tenantId: user.tenantId }, include: { carrier: true } })
    const out = []
    for (const o of original) {
      const t = tables.find((x) => x.id === o.tableId)
      if (!t) {
        out.push({ tableId: o.tableId, carrierName: o.carrierName, versionNumber: o.versionNumber, original: o.total, recalculated: null, same: false, reason: 'Tabela não encontrada.' })
        continue
      }
      const r = await this.evaluate(t, p, input, { allowExpired: true, forceVersionId: o.versionId! })
      out.push({ tableId: o.tableId, carrierName: o.carrierName, versionNumber: o.versionNumber, original: o.total, recalculated: r.total, same: r.status === 'OK' && r.total === o.total, reason: r.status === 'OK' ? null : r.reason })
    }
    return { code: q.code, quoteDate: iso(q.quoteDate), allSame: out.every((x) => x.same), items: out }
  }

  /** Simulador do editor de componentes: calcula com uma versão específica (inclusive rascunho), sem salvar. */
  async simulate(user: AuthUser, d: QuoteInput & { tableId: string; versionId: string }) {
    assertCan(user, 'fretes_tabelas', 'view')
    const t = await this.prisma.freightTable.findFirst({ where: { id: d.tableId, tenantId: user.tenantId, ...unitListWhere(allowedUnits(user, 'fretes_tabelas')) }, include: { carrier: true } })
    if (!t) throw new NotFoundException('Tabela de frete não encontrada.')
    const v = await this.prisma.freightTableVersion.findFirst({ where: { id: d.versionId, tableId: t.id } })
    if (!v) throw new NotFoundException('Versão não encontrada.')
    const unitId = d.unitId || t.unitIds[0] || (await this.prisma.unit.findFirst({ where: { tenantId: user.tenantId, active: true }, orderBy: { isHeadquarters: 'desc' } }))?.id
    if (!unitId) throw new BadRequestException('Cadastre uma filial antes de simular.')
    const p = await this.prepare(user, { ...d, unitId }, true)
    const r = await this.evaluate(t, p, d, { allowExpired: true, forceVersionId: v.id })
    return { ...r, destCity: p.destCity, destUf: p.destUf, measures: p.measures }
  }
}
