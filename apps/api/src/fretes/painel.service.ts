import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnit, type FreightModule } from './acesso'
import { DEFAULT_COMPONENTS, DEFAULT_SETTINGS, GOODS_TYPES, ICMS_LABEL, INPUT_VARIABLES, LOAD_TYPES, MODAL_LABEL, MODALS, PERSON_TYPES, RULE_VARIABLES, TABLE_KINDS, TABLE_STATUS, USAGES } from './catalogo'
import { FUNCTIONS } from './formula'
import { BASE_FIELDS, FIELD_LABEL } from './importacao'
import type { QuoteResult } from './cotacao.service'
import { normalizeCep, normalizeUf, validCnpj } from './cep'
import { todayUtc } from './tabelas.service'

const FREIGHT_MODULES: FreightModule[] = ['fretes_painel', 'fretes_cotacao', 'fretes_tabelas', 'fretes_transportadoras', 'fretes_filiais']
const DAY = 86_400_000

/** Unidades da Usaparts (endereços das lojas). CNPJ de cada filial fica para o cadastro: não é inventado aqui. */
const USAPARTS_UNITS = [
  { name: 'Matriz - Maravilha/SC', city: 'Maravilha', state: 'SC', zip: '89874000', address: 'Rod. BR 282, km 606, Industrial', isHeadquarters: true },
  { name: 'Filial - Cascavel/PR', city: 'Cascavel', state: 'PR', zip: '85804606', address: 'R. Padre Pedro Canísio Henz, 164', isHeadquarters: false },
  { name: 'Filial - Cachoeirinha/RS', city: 'Cachoeirinha', state: 'RS', zip: '94930625', address: 'R. Nelson Teichmann, 115, Cruzeiro', isHeadquarters: false },
  { name: 'Filial - Itajaí/SC', city: 'Itajaí', state: 'SC', zip: '88316002', address: 'Rod. Dep. Antônio Heil, 4621, Itaipava', isHeadquarters: false },
]

/** Contexto do módulo (filiais liberadas, listas e variáveis), filiais e painel de indicadores. */
@Injectable()
export class PainelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private canAny(user: AuthUser) {
    return FREIGHT_MODULES.some((m) => can(user.permissions, user.role.isSystem, m, 'view'))
  }

  /** Filiais liberadas em qualquer parte do módulo (a tela escolhe a filial ativa entre elas). */
  private unionUnits(user: AuthUser): string[] | null {
    const lists = FREIGHT_MODULES.filter((m) => can(user.permissions, user.role.isSystem, m, 'view')).map((m) => allowedUnits(user, m))
    if (lists.some((l) => l === null)) return null
    return [...new Set(lists.flat() as string[])]
  }

  async context(user: AuthUser) {
    if (!this.canAny(user)) throw new ForbiddenException('Seu perfil não tem acesso ao módulo de fretes.')
    const units = this.unionUnits(user)
    const rows = await this.prisma.unit.findMany({ where: { tenantId: user.tenantId, ...(units ? { id: { in: units } } : {}) }, orderBy: [{ isHeadquarters: 'desc' }, { name: 'asc' }] })
    const carriers = await this.prisma.freightCarrier.findMany({ where: { tenantId: user.tenantId, active: true }, select: { id: true, name: true, unitIds: true }, orderBy: { name: 'asc' } })
    return {
      global: units === null,
      defaultUnitId: user.unitId && rows.some((r) => r.id === user.unitId) ? user.unitId : null,
      units: rows.map((u) => ({ id: u.id, name: u.name, city: u.city, state: u.state, zip: u.zip, cnpj: u.cnpj, legalName: u.legalName, address: u.address, isHeadquarters: u.isHeadquarters, active: u.active })),
      carriers: carriers.filter((c) => !units || !c.unitIds.length || c.unitIds.some((u) => units.includes(u))).map((c) => ({ id: c.id, name: c.name })),
      catalog: {
        inputVariables: INPUT_VARIABLES,
        ruleVariables: RULE_VARIABLES,
        functions: Object.entries(FUNCTIONS).map(([name, f]) => ({ name, help: f.help })),
        defaultComponents: DEFAULT_COMPONENTS,
        defaultSettings: DEFAULT_SETTINGS,
        icmsModes: ICMS_LABEL,
        modals: MODALS.map((m) => ({ value: m, label: MODAL_LABEL[m] })),
        tableKinds: TABLE_KINDS,
        tableStatus: TABLE_STATUS,
        personTypes: PERSON_TYPES,
        usages: USAGES,
        loadTypes: LOAD_TYPES,
        goodsTypes: GOODS_TYPES,
        importFields: BASE_FIELDS.map((f) => ({ field: f, label: FIELD_LABEL[f] })),
      },
    }
  }

  async updateUnit(user: AuthUser, id: string, d: { cnpj?: string | null; legalName?: string | null; zip?: string | null; address?: string | null; city?: string | null; state?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_filiais', 'edit')
    assertUnit(user, 'fretes_filiais', id)
    const cur = await this.prisma.unit.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!cur) throw new NotFoundException('Filial não encontrada.')
    const cnpj = d.cnpj ? d.cnpj.replace(/\D/g, '') : null
    if (cnpj && !validCnpj(cnpj)) throw new BadRequestException('CNPJ inválido.')
    const zip = d.zip ? normalizeCep(d.zip) : null
    if (d.zip && !zip) throw new BadRequestException('CEP inválido.')
    const state = d.state ? normalizeUf(d.state) : null
    if (d.state && !state) throw new BadRequestException('UF inválida.')
    const data = {
      cnpj,
      legalName: cleanText(d.legalName, 160) || null,
      zip,
      address: cleanText(d.address, 240) || null,
      ...(d.city !== undefined ? { city: cleanText(d.city, 120) || null } : {}),
      ...(d.state !== undefined ? { state } : {}),
    }
    const u = await this.prisma.unit.update({ where: { id }, data })
    await this.audit.byUser(user, ctx, 'frete.filial.alterada', 'unit', id, { antes: { cnpj: cur.cnpj, razaoSocial: cur.legalName, cep: cur.zip, endereco: cur.address, cidade: cur.city, uf: cur.state }, depois: data })
    return u
  }

  /** Cria as unidades da Usaparts que faltam (pela cidade) e completa CEP e endereço das existentes que estão vazios. */
  async seedUsaparts(user: AuthUser, ctx: RequestCtx) {
    assertCan(user, 'fretes_filiais', 'edit')
    if (allowedUnits(user, 'fretes_filiais')) throw new ForbiddenException('Só quem tem acesso a todas as filiais cadastra as unidades.')
    const existing = await this.prisma.unit.findMany({ where: { tenantId: user.tenantId } })
    const created: string[] = []
    const completed: string[] = []
    for (const u of USAPARTS_UNITS) {
      const same = existing.find((e) => (e.city ?? '').toLowerCase() === u.city.toLowerCase() && (!e.state || e.state === u.state)) ?? existing.find((e) => e.name === u.name)
      if (!same) {
        await this.prisma.unit.create({ data: { tenantId: user.tenantId, ...u } })
        created.push(u.name)
      } else if (!same.zip || !same.address || !same.city || !same.state) {
        await this.prisma.unit.update({ where: { id: same.id }, data: { zip: same.zip ?? u.zip, address: same.address ?? u.address, city: same.city ?? u.city, state: same.state ?? u.state } })
        completed.push(same.name)
      }
    }
    if (created.length || completed.length) await this.audit.byUser(user, ctx, 'frete.filiais.padrao', 'unit', undefined, { criadas: created, completadas: completed })
    return { created, completed }
  }

  /** Painel: só números calculados dos registros (cotações e tabelas). Cada número aponta para a lista que o forma. */
  async dashboard(user: AuthUser, f: { from?: string; to?: string; unitId?: string }) {
    assertCan(user, 'fretes_painel', 'view')
    const units = allowedUnits(user, 'fretes_painel')
    if (f.unitId) assertUnit(user, 'fretes_painel', f.unitId)
    const scope = f.unitId ? [f.unitId] : units
    const to = f.to ? new Date(`${f.to}T00:00:00-03:00`) : new Date(todayUtc().getTime() + 3 * 3_600_000)
    const from = f.from ? new Date(`${f.from}T00:00:00-03:00`) : new Date(to.getTime() - 29 * DAY)
    const end = new Date(to.getTime() + DAY)
    if (end.getTime() - from.getTime() > 400 * DAY) throw new BadRequestException('Período máximo de 400 dias.')
    const where: Prisma.FreightQuoteWhereInput = { tenantId: user.tenantId, createdAt: { gte: from, lt: end }, status: { not: 'CANCELADA' }, ...(scope ? { unitId: { in: scope } } : {}) }
    const selected = { ...where, status: 'SELECIONADA' }

    const [count, sel, byUnit, byCarrier, byUf, selectedRows, unitsRows] = await Promise.all([
      this.prisma.freightQuote.count({ where }),
      this.prisma.freightQuote.aggregate({ where: selected, _count: { _all: true }, _sum: { selectedTotal: true, realWeight: true, cargoValue: true }, _avg: { selectedTotal: true } }),
      this.prisma.freightQuote.groupBy({ by: ['unitId'], where: selected, _count: { _all: true }, _sum: { selectedTotal: true } }),
      this.prisma.freightQuote.groupBy({ by: ['selectedCarrierId'], where: selected, _count: { _all: true }, _sum: { selectedTotal: true, realWeight: true } }),
      this.prisma.freightQuote.groupBy({ by: ['destUf'], where: selected, _count: { _all: true }, _sum: { selectedTotal: true } }),
      this.prisma.freightQuote.findMany({ where: selected, select: { results: true, selectedTotal: true, selectedTableId: true }, take: 20_000 }),
      this.prisma.unit.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
    ])
    const series = await this.prisma.$queryRaw<{ day: string; quotes: bigint; chosen: bigint; total: Prisma.Decimal | null }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
             count(*) AS quotes,
             count(*) FILTER (WHERE status = 'SELECIONADA') AS chosen,
             sum("selectedTotal") FILTER (WHERE status = 'SELECIONADA') AS total
        FROM freight_quotes
       WHERE "tenantId" = ${user.tenantId}::uuid AND "createdAt" >= ${from} AND "createdAt" < ${end} AND status <> 'CANCELADA'
         ${scope ? Prisma.sql`AND "unitId" = ANY(${scope}::uuid[])` : Prisma.empty}
       GROUP BY 1 ORDER BY 1`

    // Economia estimada: média das opções calculadas menos a escolhida. Estimativa, não economia realizada (essa depende da conciliação).
    let estimated = 0
    let chosenCheapest = 0
    for (const q of selectedRows) {
      const ok = (q.results as unknown as QuoteResult[]).filter((r) => r.status === 'OK' && r.total !== null)
      if (!ok.length || q.selectedTotal === null) continue
      const avg = ok.reduce((s, r) => s + r.total!, 0) / ok.length
      estimated += Math.max(0, avg - Number(q.selectedTotal))
      if (Number(q.selectedTotal) <= Math.min(...ok.map((r) => r.total!)) + 0.004) chosenCheapest++
    }
    const carriers = await this.prisma.freightCarrier.findMany({ where: { id: { in: byCarrier.map((c) => c.selectedCarrierId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })

    const today = todayUtc()
    const tableWhere: Prisma.FreightTableWhereInput = { tenantId: user.tenantId, ...(scope ? { OR: [{ unitIds: { isEmpty: true } }, { unitIds: { hasSome: scope } }] } : {}) }
    const [vigentes, expiring, expired, drafts, activeCarriers] = await Promise.all([
      this.prisma.freightTable.count({ where: { ...tableWhere, status: 'ATIVA', validFrom: { lte: today }, validTo: { gte: today } } }),
      this.prisma.freightTable.findMany({ where: { ...tableWhere, status: 'ATIVA', validTo: { gte: today, lte: new Date(today.getTime() + 30 * DAY) } }, select: { id: true, name: true, validTo: true, carrier: { select: { name: true } } }, orderBy: { validTo: 'asc' }, take: 20 }),
      this.prisma.freightTable.findMany({ where: { ...tableWhere, status: 'ATIVA', validTo: { lt: today } }, select: { id: true, name: true, validTo: true, carrier: { select: { name: true } } }, orderBy: { validTo: 'desc' }, take: 20 }),
      this.prisma.freightTable.count({ where: { ...tableWhere, status: 'RASCUNHO' } }),
      this.prisma.freightCarrier.count({ where: { tenantId: user.tenantId, active: true } }),
    ])
    const n = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? 0 : Number(d))
    const total = n(sel._sum.selectedTotal)
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      quotes: count,
      chosen: sel._count._all,
      chosenTotal: total,
      chosenAverage: sel._avg.selectedTotal === null ? null : Number(sel._avg.selectedTotal),
      perKg: n(sel._sum.realWeight) > 0 ? total / n(sel._sum.realWeight) : null,
      percentOfGoods: n(sel._sum.cargoValue) > 0 ? (total / n(sel._sum.cargoValue)) * 100 : null,
      estimatedSavings: Math.round(estimated * 100) / 100,
      chosenCheapest,
      byUnit: byUnit.map((u) => ({ unitId: u.unitId, name: unitsRows.find((x) => x.id === u.unitId)?.name ?? '—', count: u._count._all, total: n(u._sum.selectedTotal) })).sort((a, b) => b.total - a.total),
      byCarrier: byCarrier.map((c) => ({ carrierId: c.selectedCarrierId, name: carriers.find((x) => x.id === c.selectedCarrierId)?.name ?? '—', count: c._count._all, total: n(c._sum.selectedTotal), perKg: n(c._sum.realWeight) > 0 ? n(c._sum.selectedTotal) / n(c._sum.realWeight) : null })).sort((a, b) => b.total - a.total),
      byUf: byUf.map((u) => ({ uf: u.destUf ?? '—', count: u._count._all, total: n(u._sum.selectedTotal) })).sort((a, b) => b.total - a.total),
      series: series.map((s) => ({ day: s.day, quotes: Number(s.quotes), chosen: Number(s.chosen), total: n(s.total) })),
      tables: {
        vigentes,
        drafts,
        expiring: expiring.map((t) => ({ id: t.id, name: t.name, carrier: t.carrier.name, validTo: t.validTo.toISOString().slice(0, 10) })),
        expired: expired.map((t) => ({ id: t.id, name: t.name, carrier: t.carrier.name, validTo: t.validTo.toISOString().slice(0, 10) })),
      },
      activeCarriers,
    }
  }
}
