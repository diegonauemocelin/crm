import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnitList, unitListWhere } from './acesso'
import {
  type CalcSettings,
  COMPONENT_CODE,
  type ComponentDef,
  DEFAULT_COMPONENTS,
  DEFAULT_SETTINGS,
  ICMS_MODES,
  LOAD_TYPES,
  MODALS,
  PERSON_TYPES,
  RULE_VARIABLES,
  TABLE_KINDS,
  TABLE_STATUS,
  USAGES,
} from './catalogo'
import { cityKey, formatCep, normalizeCep, normalizeUf } from './cep'
import { checkFormula } from './formula'
import type { RuleLike } from './motor'

export interface TableInput {
  carrierId: string
  name: string
  quoteName?: string | null
  kind?: string
  status?: string
  modal?: string
  validFrom: string
  validTo: string
  unitIds?: string[]
  goodsTypes?: string[]
  personType?: string
  usage?: string
  weightMin?: number | null
  weightMax?: number | null
  valueMin?: number | null
  valueMax?: number | null
  loadType?: string
  dispatchDays?: number | null
  serviceCode?: string | null
  partner?: string | null
  notes?: string | null
}

export interface RuleInput {
  cepStart?: string | null
  cepEnd?: string | null
  uf?: string | null
  city?: string | null
  weightMin?: number | null
  weightMax?: number | null
  deadlineDays?: number | null
  restricted?: boolean
  values?: Record<string, number>
  note?: string | null
}

const RULES_PAGE = 50
const DAY = 86_400_000
const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d))
const dateOnly = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException('Data inválida (use AAAA-MM-DD).')
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Data inválida.')
  return d
}
export const todayUtc = () => new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}T00:00:00Z`)

/** Regra do banco no formato do motor. */
export function ruleFromRow(r: { id: string; cepStart: number | null; cepEnd: number | null; uf: string | null; city: string | null; weightMin: Prisma.Decimal; weightMax: Prisma.Decimal | null; deadlineDays: number | null; restricted: boolean; values: Prisma.JsonValue }): RuleLike {
  const values: Record<string, number> = {}
  for (const [k, v] of Object.entries((r.values ?? {}) as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) values[k] = v
  return { id: r.id, cepStart: r.cepStart, cepEnd: r.cepEnd, uf: r.uf, city: r.city, weightMin: Number(r.weightMin), weightMax: num(r.weightMax), deadlineDays: r.deadlineDays, restricted: r.restricted, values }
}

/** Componentes guardados (JSON) → lista conferida. */
export function componentsOf(json: Prisma.JsonValue): ComponentDef[] {
  return Array.isArray(json) ? (json as unknown as ComponentDef[]) : []
}
export function settingsOf(json: Prisma.JsonValue): CalcSettings {
  return { ...DEFAULT_SETTINGS, ...((json ?? {}) as Partial<CalcSettings>) }
}

/** Situação da vigência para a tela (a cotação confere a data da própria cotação). */
export function validity(validFrom: Date, validTo: Date, today = todayUtc()) {
  if (validTo.getTime() < today.getTime()) return { state: 'VENCIDA' as const, days: Math.round((today.getTime() - validTo.getTime()) / DAY) }
  if (validFrom.getTime() > today.getTime()) return { state: 'FUTURA' as const, days: Math.round((validFrom.getTime() - today.getTime()) / DAY) }
  return { state: 'VIGENTE' as const, days: Math.round((validTo.getTime() - today.getTime()) / DAY) }
}

/** Confere componentes (códigos únicos, fórmulas e condições válidas) antes de gravar. */
export function validateComponents(list: ComponentDef[]): ComponentDef[] {
  if (!Array.isArray(list) || list.length > 60) throw new BadRequestException('Lista de componentes inválida (até 60).')
  const seen = new Set<string>()
  return list.map((c, i) => {
    const code = String(c.code ?? '').trim().toUpperCase()
    if (!COMPONENT_CODE.test(code)) throw new BadRequestException(`Componente ${i + 1}: código inválido (letras maiúsculas, números, _ e -).`)
    if (seen.has(code)) throw new BadRequestException(`Código de componente repetido: ${code}.`)
    seen.add(code)
    const name = cleanText(c.name, 80)
    if (!name) throw new BadRequestException(`Componente ${code}: informe o nome.`)
    const f = checkFormula(c.formula)
    if (!f.ok) throw new BadRequestException(`Fórmula de ${name}: ${f.error}`)
    const condition = c.condition?.trim() || null
    if (condition) {
      const cf = checkFormula(condition)
      if (!cf.ok) throw new BadRequestException(`Condição de ${name}: ${cf.error}`)
    }
    const order = Number.isFinite(c.order) ? Math.trunc(c.order) : (i + 1) * 10
    return { code, name, formula: c.formula.trim(), condition, inTax: !!c.inTax, cteName: cleanText(c.cteName, 80) || null, order, active: c.active !== false, description: cleanText(c.description, 300) || null }
  })
}

export function validateSettings(s: Partial<CalcSettings>): CalcSettings {
  const out = { ...DEFAULT_SETTINGS, ...s }
  if (!(ICMS_MODES as readonly string[]).includes(out.icmsMode)) throw new BadRequestException('Cobrança do ICMS inválida.')
  if (out.icmsRate !== null && (typeof out.icmsRate !== 'number' || out.icmsRate < 0 || out.icmsRate >= 100)) throw new BadRequestException('Alíquota de ICMS deve ficar entre 0 e 99,99%.')
  if (typeof out.cubageFactor !== 'number' || out.cubageFactor < 0 || out.cubageFactor > 10_000) throw new BadRequestException('Fator de cubagem inválido (kg/m³ entre 0 e 10.000).')
  return { icmsMode: out.icmsMode, icmsRate: out.icmsRate ?? null, cubageFactor: out.cubageFactor, useCubage: out.useCubage !== false }
}

const RULE_CODE_SET = new Set(RULE_VARIABLES.map((v) => v.code))

/** Tabelas de frete com versões: rascunho editável, publicada imutável, anteriores guardadas para reproduzir cotações. */
@Injectable()
export class TabelasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private tableView(t: Prisma.FreightTableGetPayload<{ include: { carrier: { select: { id: true; name: true; cnpj: true; active: true } } } }>) {
    return {
      id: t.id,
      carrier: t.carrier,
      name: t.name,
      quoteName: t.quoteName,
      kind: t.kind,
      status: t.status,
      modal: t.modal,
      validFrom: t.validFrom.toISOString().slice(0, 10),
      validTo: t.validTo.toISOString().slice(0, 10),
      validity: validity(t.validFrom, t.validTo),
      unitIds: t.unitIds,
      goodsTypes: t.goodsTypes,
      personType: t.personType,
      usage: t.usage,
      weightMin: num(t.weightMin),
      weightMax: num(t.weightMax),
      valueMin: num(t.valueMin),
      valueMax: num(t.valueMax),
      loadType: t.loadType,
      dispatchDays: t.dispatchDays,
      serviceCode: t.serviceCode,
      partner: t.partner,
      notes: t.notes,
      publishedVersionId: t.publishedVersionId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }
  }

  private async findTable(user: AuthUser, id: string) {
    const t = await this.prisma.freightTable.findFirst({
      where: { id, tenantId: user.tenantId, ...unitListWhere(allowedUnits(user, 'fretes_tabelas')) },
      include: { carrier: { select: { id: true, name: true, cnpj: true, active: true } } },
    })
    if (!t) throw new NotFoundException('Tabela de frete não encontrada.')
    return t
  }

  private async findVersion(user: AuthUser, tableId: string, versionId: string) {
    const v = await this.prisma.freightTableVersion.findFirst({ where: { id: versionId, tableId, tenantId: user.tenantId } })
    if (!v) throw new NotFoundException('Versão não encontrada.')
    return v
  }

  private async editableVersion(user: AuthUser, tableId: string, versionId: string) {
    const t = await this.findTable(user, tableId)
    assertUnitList(user, 'fretes_tabelas', t.unitIds)
    const v = await this.findVersion(user, tableId, versionId)
    if (v.status !== 'RASCUNHO') throw new BadRequestException(`A versão ${v.number} está ${v.status === 'PUBLICADA' ? 'publicada' : 'fechada'} e não muda mais. Crie uma nova versão para alterar.`)
    return { t, v }
  }

  async list(user: AuthUser, q: { search?: string; carrierId?: string; status?: string; validity?: string; unitId?: string }) {
    assertCan(user, 'fretes_tabelas', 'view')
    const and: Prisma.FreightTableWhereInput[] = [{ tenantId: user.tenantId }, unitListWhere(allowedUnits(user, 'fretes_tabelas'))]
    if (q.carrierId) and.push({ carrierId: q.carrierId })
    if (q.status && (TABLE_STATUS as readonly string[]).includes(q.status)) and.push({ status: q.status })
    if (q.unitId) and.push({ OR: [{ unitIds: { isEmpty: true } }, { unitIds: { has: q.unitId } }] })
    const today = todayUtc()
    if (q.validity === 'VIGENTE') and.push({ validFrom: { lte: today }, validTo: { gte: today } })
    if (q.validity === 'VENCIDA') and.push({ validTo: { lt: today } })
    if (q.validity === 'A_VENCER') and.push({ validTo: { gte: today, lte: new Date(today.getTime() + 30 * DAY) } })
    const term = q.search?.trim()
    if (term) and.push({ OR: [{ name: { contains: term, mode: 'insensitive' } }, { carrier: { name: { contains: term, mode: 'insensitive' } } }, { serviceCode: { contains: term, mode: 'insensitive' } }] })
    const rows = await this.prisma.freightTable.findMany({
      where: { AND: and },
      include: { carrier: { select: { id: true, name: true, cnpj: true, active: true } } },
      orderBy: [{ status: 'asc' }, { validTo: 'desc' }],
      take: 500,
    })
    const published = await this.prisma.freightTableVersion.findMany({
      where: { id: { in: rows.map((r) => r.publishedVersionId).filter((x): x is string => !!x) } },
      select: { id: true, number: true, rulesCount: true },
    })
    const drafts = await this.prisma.freightTableVersion.findMany({ where: { tableId: { in: rows.map((r) => r.id) }, status: 'RASCUNHO' }, select: { tableId: true, number: true } })
    return rows.map((r) => ({
      ...this.tableView(r),
      published: published.find((p) => p.id === r.publishedVersionId) ?? null,
      draft: drafts.find((d) => d.tableId === r.id) ?? null,
    }))
  }

  async get(user: AuthUser, id: string) {
    assertCan(user, 'fretes_tabelas', 'view')
    const t = await this.findTable(user, id)
    const versions = await this.prisma.freightTableVersion.findMany({
      where: { tableId: id },
      orderBy: { number: 'desc' },
      select: { id: true, number: true, status: true, source: true, note: true, rulesCount: true, createdByName: true, createdAt: true, publishedAt: true, publishedByName: true },
    })
    return { ...this.tableView(t), versions }
  }

  private async validateTable(user: AuthUser, d: TableInput, current?: { publishedVersionId: string | null }) {
    const carrier = await this.prisma.freightCarrier.findFirst({ where: { id: d.carrierId, tenantId: user.tenantId } })
    if (!carrier) throw new BadRequestException('Transportadora inválida.')
    const name = cleanText(d.name, 160)
    if (name.length < 2) throw new BadRequestException('Informe o nome da tabela.')
    const pick = <T extends readonly string[]>(v: string | undefined, list: T, def: T[number], label: string) => {
      if (v === undefined) return def
      if (!(list as readonly string[]).includes(v)) throw new BadRequestException(`${label} inválido.`)
      return v as T[number]
    }
    const validFrom = dateOnly(d.validFrom)
    const validTo = dateOnly(d.validTo)
    if (validTo < validFrom) throw new BadRequestException('A vigência final é anterior à inicial.')
    const unitIds = [...new Set(d.unitIds ?? [])]
    if (unitIds.length && (await this.prisma.unit.count({ where: { tenantId: user.tenantId, id: { in: unitIds } } })) !== unitIds.length) throw new BadRequestException('Filial inválida.')
    assertUnitList(user, 'fretes_tabelas', unitIds)
    const range = (a: number | null | undefined, b: number | null | undefined, label: string) => {
      if ((a ?? 0) < 0 || (b ?? 0) < 0) throw new BadRequestException(`${label}: valores negativos.`)
      if (a !== null && a !== undefined && b !== null && b !== undefined && b < a) throw new BadRequestException(`${label}: o final é menor que o inicial.`)
    }
    range(d.weightMin, d.weightMax, 'Peso inicial e final')
    range(d.valueMin, d.valueMax, 'Valor inicial e final')
    const status = pick(d.status, TABLE_STATUS, 'RASCUNHO', 'Situação')
    if (status === 'ATIVA' && !current?.publishedVersionId) throw new BadRequestException('Publique uma versão (com regras) antes de ativar a tabela.')
    if (d.dispatchDays !== undefined && d.dispatchDays !== null && (d.dispatchDays < 0 || d.dispatchDays > 60)) throw new BadRequestException('Expedição: entre 0 e 60 dias úteis.')
    return {
      carrierId: carrier.id,
      name,
      quoteName: cleanText(d.quoteName, 120) || null,
      kind: pick(d.kind, TABLE_KINDS, 'COMPRA_VENDA', 'Tipo'),
      status,
      modal: pick(d.modal, MODALS, 'RODOVIARIO', 'Modal'),
      validFrom,
      validTo,
      unitIds,
      goodsTypes: [...new Set((d.goodsTypes ?? []).map((g) => cleanText(g, 60)).filter(Boolean))].slice(0, 20),
      personType: pick(d.personType, PERSON_TYPES, 'AMBOS', 'Tipo de pessoa'),
      usage: pick(d.usage, USAGES, 'COTACAO_CONCILIACAO', 'Utilizada em'),
      weightMin: d.weightMin ?? null,
      weightMax: d.weightMax ?? null,
      valueMin: d.valueMin ?? null,
      valueMax: d.valueMax ?? null,
      loadType: pick(d.loadType, LOAD_TYPES, 'FRACIONADA', 'Tabela de carga'),
      dispatchDays: d.dispatchDays ?? null,
      serviceCode: cleanText(d.serviceCode, 40) || null,
      partner: cleanText(d.partner, 80) || null,
      notes: cleanText(d.notes, 4000, true) || null,
    }
  }

  async create(user: AuthUser, d: TableInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'create')
    const data = await this.validateTable(user, { ...d, status: d.status === 'ATIVA' ? 'RASCUNHO' : d.status })
    const t = await this.prisma.$transaction(async (tx) => {
      const t = await tx.freightTable.create({ data: { tenantId: user.tenantId, ...data } })
      await tx.freightTableVersion.create({
        data: {
          tenantId: user.tenantId,
          tableId: t.id,
          number: 1,
          components: DEFAULT_COMPONENTS as unknown as Prisma.InputJsonValue,
          settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
          createdById: user.id,
          createdByName: user.name,
          note: 'Versão inicial',
        },
      })
      return t
    })
    await this.audit.byUser(user, ctx, 'frete.tabela.criada', 'freight_table', t.id, { nome: t.name, transportadora: t.carrierId, vigencia: [d.validFrom, d.validTo] })
    return this.get(user, t.id)
  }

  async update(user: AuthUser, id: string, d: TableInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'edit')
    const cur = await this.findTable(user, id)
    assertUnitList(user, 'fretes_tabelas', cur.unitIds)
    const data = await this.validateTable(user, d, cur)
    await this.prisma.freightTable.update({ where: { id }, data })
    // Toda alteração da tabela fica na auditoria com o antes e o depois dos campos que mudaram.
    const before: Record<string, unknown> = { ...this.tableView(cur), weightMin: num(cur.weightMin), weightMax: num(cur.weightMax), valueMin: num(cur.valueMin), valueMax: num(cur.valueMax) }
    const after: Record<string, unknown> = { ...data, validFrom: d.validFrom, validTo: d.validTo }
    const diff = Object.fromEntries(Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => [k, { de: before[k] ?? null, para: after[k] ?? null }]))
    if (Object.keys(diff).length) await this.audit.byUser(user, ctx, 'frete.tabela.alterada', 'freight_table', id, { alteracoes: diff })
    return this.get(user, id)
  }

  async version(user: AuthUser, tableId: string, versionId: string) {
    assertCan(user, 'fretes_tabelas', 'view')
    await this.findTable(user, tableId)
    const v = await this.findVersion(user, tableId, versionId)
    // Variáveis que aparecem nas regras desta versão (para o editor de fórmulas avisar as que não existem).
    const used = await this.prisma.$queryRaw<{ k: string }[]>`SELECT DISTINCT jsonb_object_keys("values") AS k FROM freight_rules WHERE "versionId" = ${versionId}::uuid`
    return {
      id: v.id,
      tableId: v.tableId,
      number: v.number,
      status: v.status,
      source: v.source,
      note: v.note,
      rulesCount: v.rulesCount,
      components: componentsOf(v.components),
      settings: settingsOf(v.settings),
      ruleVariables: used.map((u) => u.k).sort(),
      createdByName: v.createdByName,
      createdAt: v.createdAt,
      publishedAt: v.publishedAt,
      publishedByName: v.publishedByName,
    }
  }

  /** Nova versão (rascunho) a partir da publicada ou de outra: copia componentes, parâmetros e regras. */
  async newVersion(user: AuthUser, tableId: string, fromVersionId: string | undefined, ctx: RequestCtx, opts: { withRules?: boolean; source?: string; note?: string } = {}) {
    assertCan(user, 'fretes_tabelas', 'edit')
    const t = await this.findTable(user, tableId)
    assertUnitList(user, 'fretes_tabelas', t.unitIds)
    const draft = await this.prisma.freightTableVersion.findFirst({ where: { tableId, status: 'RASCUNHO' } })
    if (draft) throw new ConflictException(`Já existe o rascunho da versão ${draft.number}. Publique ou descarte antes de abrir outro.`)
    const fromId = fromVersionId ?? t.publishedVersionId
    const from = fromId ? await this.findVersion(user, tableId, fromId) : null
    const withRules = opts.withRules !== false && !!from
    const v = await this.prisma.$transaction(async (tx) => {
      const last = await tx.freightTableVersion.aggregate({ where: { tableId }, _max: { number: true } })
      const v = await tx.freightTableVersion.create({
        data: {
          tenantId: user.tenantId,
          tableId,
          number: (last._max.number ?? 0) + 1,
          components: (from?.components ?? DEFAULT_COMPONENTS) as Prisma.InputJsonValue,
          settings: (from?.settings ?? DEFAULT_SETTINGS) as Prisma.InputJsonValue,
          source: opts.source ?? (from ? 'COPIA' : 'MANUAL'),
          note: cleanText(opts.note, 300) || (from ? `Cópia da versão ${from.number}` : null),
          rulesCount: withRules ? from!.rulesCount : 0,
          createdById: user.id,
          createdByName: user.name,
        },
      })
      if (withRules) {
        await tx.$executeRaw`INSERT INTO freight_rules (id, "versionId", line, "cepStart", "cepEnd", uf, city, "cityKey", "weightMin", "weightMax", "deadlineDays", restricted, "values", note)
          SELECT gen_random_uuid(), ${v.id}::uuid, line, "cepStart", "cepEnd", uf, city, "cityKey", "weightMin", "weightMax", "deadlineDays", restricted, "values", note FROM freight_rules WHERE "versionId" = ${from!.id}::uuid`
      }
      return v
    })
    await this.audit.byUser(user, ctx, 'frete.versao.criada', 'freight_table', tableId, { versao: v.number, origem: from?.number ?? null, copiouRegras: withRules })
    return this.version(user, tableId, v.id)
  }

  async updateVersion(user: AuthUser, tableId: string, versionId: string, d: { components?: ComponentDef[]; settings?: Partial<CalcSettings>; note?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'edit')
    const { v } = await this.editableVersion(user, tableId, versionId)
    const components = d.components ? validateComponents(d.components) : undefined
    const settings = d.settings ? validateSettings({ ...settingsOf(v.settings), ...d.settings }) : undefined
    await this.prisma.freightTableVersion.update({
      where: { id: versionId },
      data: {
        ...(components ? { components: components as unknown as Prisma.InputJsonValue } : {}),
        ...(settings ? { settings: settings as unknown as Prisma.InputJsonValue } : {}),
        ...(d.note !== undefined ? { note: cleanText(d.note, 300) || null } : {}),
      },
    })
    await this.audit.byUser(user, ctx, 'frete.versao.alterada', 'freight_table', tableId, {
      versao: v.number,
      ...(components ? { componentes: components.map((c) => ({ codigo: c.code, formula: c.formula, condicao: c.condition, ativo: c.active, imposto: c.inTax })) } : {}),
      ...(settings ? { parametros: settings } : {}),
    })
    return this.version(user, tableId, versionId)
  }

  /** Publica o rascunho: a publicada anterior fica como substituída (guardada para auditoria e para reproduzir cotações). */
  async publish(user: AuthUser, tableId: string, versionId: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'edit')
    const { t, v } = await this.editableVersion(user, tableId, versionId)
    if (!v.rulesCount) throw new BadRequestException('A versão não tem regras. Importe a planilha ou cadastre as regras antes de publicar.')
    validateComponents(componentsOf(v.components))
    validateSettings(settingsOf(v.settings))
    await this.prisma.$transaction(async (tx) => {
      // Trava a tabela: duas publicações ao mesmo tempo não deixam duas versões publicadas.
      await tx.$executeRaw`SELECT id FROM freight_tables WHERE id = ${tableId}::uuid FOR UPDATE`
      const still = await tx.freightTableVersion.findUnique({ where: { id: versionId }, select: { status: true } })
      if (still?.status !== 'RASCUNHO') throw new ConflictException('A versão mudou enquanto você publicava. Recarregue a tela.')
      await tx.freightTableVersion.updateMany({ where: { tableId, status: 'PUBLICADA' }, data: { status: 'SUBSTITUIDA' } })
      await tx.freightTableVersion.update({ where: { id: versionId }, data: { status: 'PUBLICADA', publishedAt: new Date(), publishedById: user.id, publishedByName: user.name } })
      await tx.freightTable.update({ where: { id: tableId }, data: { publishedVersionId: versionId, ...(t.status === 'RASCUNHO' ? { status: 'ATIVA' } : {}) } })
    })
    await this.audit.byUser(user, ctx, 'frete.versao.publicada', 'freight_table', tableId, { versao: v.number, anterior: t.publishedVersionId, regras: v.rulesCount })
    return this.get(user, tableId)
  }

  async discard(user: AuthUser, tableId: string, versionId: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'delete')
    const { v } = await this.editableVersion(user, tableId, versionId)
    await this.prisma.$transaction([
      this.prisma.freightRule.deleteMany({ where: { versionId } }),
      this.prisma.freightTableVersion.update({ where: { id: versionId }, data: { status: 'DESCARTADA', rulesCount: 0 } }),
    ])
    await this.audit.byUser(user, ctx, 'frete.versao.descartada', 'freight_table', tableId, { versao: v.number, regras: v.rulesCount })
    return this.get(user, tableId)
  }

  // ─────────── Regras ───────────

  private ruleView(r: Prisma.FreightRuleGetPayload<object>) {
    return { ...ruleFromRow(r), line: r.line, note: r.note, cepStartLabel: r.cepStart === null ? null : formatCep(r.cepStart), cepEndLabel: r.cepEnd === null ? null : formatCep(r.cepEnd) }
  }

  private ruleSearch(versionId: string, search?: string): Prisma.FreightRuleWhereInput {
    const and: Prisma.FreightRuleWhereInput[] = [{ versionId }]
    const term = search?.trim()
    if (term) {
      const cep = normalizeCep(term.replace(/\D/g, '').length >= 5 ? term.replace(/\D/g, '').padEnd(8, '0') : null)
      const uf = normalizeUf(term)
      const or: Prisma.FreightRuleWhereInput[] = [{ cityKey: { contains: cityKey(term) ?? term } }]
      if (cep) or.push({ cepStart: { lte: Number(cep) }, cepEnd: { gte: Number(cep) } })
      if (uf) or.push({ uf })
      and.push({ OR: or })
    }
    return { AND: and }
  }

  async rules(user: AuthUser, tableId: string, versionId: string, q: { search?: string; page?: number }) {
    assertCan(user, 'fretes_tabelas', 'view')
    await this.findTable(user, tableId)
    await this.findVersion(user, tableId, versionId)
    const where = this.ruleSearch(versionId, q.search)
    const page = Math.max(1, q.page ?? 1)
    const [total, rows] = await Promise.all([
      this.prisma.freightRule.count({ where }),
      this.prisma.freightRule.findMany({ where, orderBy: [{ uf: 'asc' }, { cepStart: 'asc' }, { cityKey: 'asc' }, { weightMin: 'asc' }], skip: (page - 1) * RULES_PAGE, take: RULES_PAGE }),
    ])
    return { total, page, pageSize: RULES_PAGE, items: rows.map((r) => this.ruleView(r)) }
  }

  private validateRule(d: RuleInput) {
    const a = d.cepStart ? normalizeCep(d.cepStart) : null
    const b = d.cepEnd ? normalizeCep(d.cepEnd) : null
    if ((d.cepStart && !a) || (d.cepEnd && !b)) throw new BadRequestException('CEP inválido.')
    if (!!a !== !!b) throw new BadRequestException('Informe o CEP inicial e o final.')
    if (a && b && Number(a) > Number(b)) throw new BadRequestException('CEP inicial maior que o final.')
    const uf = d.uf ? normalizeUf(d.uf) : null
    if (d.uf && !uf) throw new BadRequestException('UF inválida.')
    const city = cleanText(d.city, 120) || null
    if (!a && !uf && !city) throw new BadRequestException('Informe o destino: faixa de CEP, cidade ou UF.')
    const wMin = d.weightMin ?? 0
    if (wMin < 0 || (d.weightMax !== null && d.weightMax !== undefined && d.weightMax < wMin)) throw new BadRequestException('Faixa de peso inválida.')
    if (d.deadlineDays !== null && d.deadlineDays !== undefined && (d.deadlineDays < 0 || d.deadlineDays > 365)) throw new BadRequestException('Prazo inválido.')
    const values: Record<string, number> = {}
    for (const [k, v] of Object.entries(d.values ?? {})) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) throw new BadRequestException(`Variável inválida: ${k}.`)
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new BadRequestException(`Valor inválido em ${k}.`)
      values[k] = v
    }
    if (Object.keys(values).length > 80) throw new BadRequestException('Variáveis demais na regra.')
    return {
      cepStart: a ? Number(a) : null,
      cepEnd: b ? Number(b) : null,
      uf,
      city,
      cityKey: cityKey(city),
      weightMin: wMin,
      weightMax: d.weightMax ?? null,
      deadlineDays: d.deadlineDays ?? null,
      restricted: !!d.restricted,
      values,
      note: cleanText(d.note, 300) || null,
    }
  }

  async createRule(user: AuthUser, tableId: string, versionId: string, d: RuleInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'edit')
    const { v } = await this.editableVersion(user, tableId, versionId)
    const data = this.validateRule(d)
    const [r] = await this.prisma.$transaction([
      this.prisma.freightRule.create({ data: { versionId, ...data } }),
      this.prisma.freightTableVersion.update({ where: { id: versionId }, data: { rulesCount: { increment: 1 } } }),
    ])
    await this.audit.byUser(user, ctx, 'frete.regra.criada', 'freight_table', tableId, { versao: v.number, regra: r.id })
    return this.ruleView(r)
  }

  async updateRule(user: AuthUser, tableId: string, versionId: string, ruleId: string, d: RuleInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'edit')
    const { v } = await this.editableVersion(user, tableId, versionId)
    const cur = await this.prisma.freightRule.findFirst({ where: { id: ruleId, versionId } })
    if (!cur) throw new NotFoundException('Regra não encontrada.')
    const r = await this.prisma.freightRule.update({ where: { id: ruleId }, data: this.validateRule(d) })
    await this.audit.byUser(user, ctx, 'frete.regra.alterada', 'freight_table', tableId, { versao: v.number, regra: ruleId, antes: this.ruleView(cur), depois: this.ruleView(r) })
    return this.ruleView(r)
  }

  async deleteRule(user: AuthUser, tableId: string, versionId: string, ruleId: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'edit')
    const { v } = await this.editableVersion(user, tableId, versionId)
    const cur = await this.prisma.freightRule.findFirst({ where: { id: ruleId, versionId } })
    if (!cur) throw new NotFoundException('Regra não encontrada.')
    await this.prisma.$transaction([
      this.prisma.freightRule.delete({ where: { id: ruleId } }),
      this.prisma.freightTableVersion.update({ where: { id: versionId }, data: { rulesCount: { decrement: 1 } } }),
    ])
    await this.audit.byUser(user, ctx, 'frete.regra.excluida', 'freight_table', tableId, { versao: v.number, regra: this.ruleView(cur) })
    return { ok: true }
  }

  /** Regras da versão em CSV (separador ;, decimal com vírgula), para conferir no Excel. */
  async exportRules(user: AuthUser, tableId: string, versionId: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'export')
    const t = await this.findTable(user, tableId)
    const v = await this.findVersion(user, tableId, versionId)
    const rows = await this.prisma.freightRule.findMany({ where: { versionId }, orderBy: [{ uf: 'asc' }, { cepStart: 'asc' }, { cityKey: 'asc' }, { weightMin: 'asc' }] })
    const keys = new Set<string>()
    for (const r of rows) for (const k of Object.keys((r.values ?? {}) as object)) keys.add(k)
    const vars = [...keys].sort((a, b) => Number(RULE_CODE_SET.has(b)) - Number(RULE_CODE_SET.has(a)) || a.localeCompare(b))
    const n = (x: number | null) => (x === null ? '' : String(x).replace('.', ','))
    const esc = (s: string | null) => (s === null ? '' : /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const lines = [['CEP inicial', 'CEP final', 'UF', 'Cidade', 'Peso inicial', 'Peso final', 'Prazo', 'Restrição', ...vars, 'Observação'].join(';')]
    for (const r of rows) {
      const rr = ruleFromRow(r)
      lines.push(
        [
          r.cepStart === null ? '' : formatCep(r.cepStart),
          r.cepEnd === null ? '' : formatCep(r.cepEnd),
          r.uf ?? '',
          esc(r.city),
          n(rr.weightMin),
          n(rr.weightMax),
          r.deadlineDays ?? '',
          r.restricted ? 'Sim' : 'Não',
          ...vars.map((k) => n(rr.values[k] ?? null)),
          esc(r.note),
        ].join(';'),
      )
    }
    await this.audit.byUser(user, ctx, 'frete.regras.exportadas', 'freight_table', tableId, { versao: v.number, linhas: rows.length })
    return { fileName: `${t.name.replace(/[^\w.-]+/g, '_').slice(0, 60)}_v${v.number}.csv`, content: `﻿${lines.join('\r\n')}\r\n` }
  }
}
