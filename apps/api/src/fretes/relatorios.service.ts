import { BadRequestException, Injectable } from '@nestjs/common'
import type { AuthUser } from '../common/types'
import { can } from '../common/permissions'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { allowedUnits, assertCan, assertUnit } from './acesso'
import { REC_TYPE_LABEL, type RecType } from './conciliacao'
import { CteService } from './cte.service'
import { todayUtc } from './tabelas.service'

type ColType = 'text' | 'money' | 'int' | 'pct' | 'date' | 'num'
interface Report {
  title: string
  description: string
  columns: { key: string; label: string; type: ColType }[]
  rows: Record<string, string | number | null>[]
}

export const REPORTS = {
  transportadoras: 'Gastos e desempenho por transportadora',
  filiais: 'Gastos por filial',
  ufs: 'Gastos por UF de destino',
  mensal: 'Gastos por mês',
  divergencias: 'Divergências por tipo',
  contestacoes: 'Contestações',
  faturas: 'Faturas: a pagar e pagas',
  tabelas: 'Tabelas vigentes e vencidas',
} as const
export type ReportKey = keyof typeof REPORTS

const DAY = 86_400_000
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** Relatórios do módulo (sempre sobre os registros: CT-es, pedidos, faturas e tabelas) e a central de alertas. */
@Injectable()
export class FretesRelatoriosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctes: CteService,
  ) {}

  private period(f: { from?: string; to?: string }) {
    const to = f.to ? new Date(`${f.to}T00:00:00-03:00`) : new Date(todayUtc().getTime() + 3 * 3_600_000)
    const from = f.from ? new Date(`${f.from}T00:00:00-03:00`) : new Date(to.getTime() - 89 * DAY)
    const end = new Date(to.getTime() + DAY)
    if (end.getTime() - from.getTime() > 800 * DAY) throw new BadRequestException('Período máximo de 800 dias.')
    return { from, end }
  }

  /** Filtro de filial em SQL: a escolhida, ou as liberadas para a pessoa. */
  private unitSql(user: AuthUser, unitId: string | undefined, col: string) {
    if (unitId) {
      assertUnit(user, 'fretes_cte', unitId)
      return Prisma.sql`AND ${Prisma.raw(col)} = ${unitId}::uuid`
    }
    const units = allowedUnits(user, 'fretes_cte')
    return units ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${units}::uuid[])` : Prisma.empty
  }

  async run(user: AuthUser, key: string, f: { from?: string; to?: string; unitId?: string }): Promise<Report> {
    if (!(key in REPORTS)) throw new BadRequestException('Relatório desconhecido.')
    assertCan(user, key === 'faturas' ? 'fretes_financeiro' : key === 'tabelas' ? 'fretes_tabelas' : 'fretes_cte', 'view')
    const { from, end } = this.period(f)
    const t = user.tenantId
    const unit = this.unitSql(user, f.unitId, 'c."unitId"')
    const base = Prisma.sql`c."tenantId" = ${t}::uuid AND c."fiscalStatus" <> 'CANCELADO' AND COALESCE(c."issuedAt", c."createdAt") >= ${from} AND COALESCE(c."issuedAt", c."createdAt") < ${end} ${unit}`
    const money = [
      { key: 'ctes', label: 'CT-es', type: 'int' as const },
      { key: 'cobrado', label: 'Cobrado', type: 'money' as const },
      { key: 'esperado', label: 'Cotado/tabela', type: 'money' as const },
      { key: 'aprovado', label: 'Aprovado', type: 'money' as const },
      { key: 'recuperado', label: 'Crédito recuperado', type: 'money' as const },
      { key: 'divergentes', label: 'Divergentes', type: 'int' as const },
      { key: 'kg', label: 'Peso (kg)', type: 'num' as const },
      { key: 'porKg', label: 'R$/kg', type: 'money' as const },
    ]
    const agg = Prisma.sql`count(*)::int AS ctes, sum(c.total) AS cobrado, sum(c."expectedTotal") AS esperado, sum(c."approvedValue") AS aprovado, sum(c."creditValue") AS recuperado,
      count(*) FILTER (WHERE c."recStatus" = 'DIVERGENTE')::int AS divergentes, sum(c.weight) AS kg, CASE WHEN sum(c.weight) > 0 THEN sum(c.total) / sum(c.weight) END AS "porKg"`
    const fix = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Prisma.Decimal || typeof v === 'bigint' ? Number(v) : (v as string | number | null)])))

    if (key === 'transportadoras') {
      const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT COALESCE(fc.name, c."emitName", 'Não cadastrada') AS nome, ${agg},
          (SELECT count(*) FILTER (WHERE s."deliveredAt" IS NOT NULL AND s."expectedDeliveryAt" IS NOT NULL)::int FROM freight_shipments s WHERE s."tenantId" = ${t}::uuid AND s."carrierId" = c."carrierId" AND s."createdAt" >= ${from} AND s."createdAt" < ${end}) AS entregas,
          (SELECT count(*) FILTER (WHERE s."deliveredAt" IS NOT NULL AND s."expectedDeliveryAt" IS NOT NULL AND (s."deliveredAt" AT TIME ZONE 'America/Sao_Paulo')::date <= s."expectedDeliveryAt")::int FROM freight_shipments s WHERE s."tenantId" = ${t}::uuid AND s."carrierId" = c."carrierId" AND s."createdAt" >= ${from} AND s."createdAt" < ${end}) AS "noPrazo"
        FROM freight_ctes c LEFT JOIN freight_carriers fc ON fc.id = c."carrierId"
        WHERE ${base} GROUP BY 1, c."carrierId" ORDER BY sum(c.total) DESC`
      return {
        title: REPORTS.transportadoras,
        description: 'Valores dos CT-es no período (data de emissão). Prazo cumprido: pedidos entregues até a data prevista.',
        columns: [{ key: 'nome', label: 'Transportadora', type: 'text' }, ...money, { key: 'pctDiv', label: '% divergente', type: 'pct' }, { key: 'pctPrazo', label: '% no prazo', type: 'pct' }],
        rows: fix(rows).map((r) => ({ ...r, pctDiv: r.ctes ? ((r.divergentes as number) / (r.ctes as number)) * 100 : null, pctPrazo: r.entregas ? ((r.noPrazo as number) / (r.entregas as number)) * 100 : null })),
      }
    }
    if (key === 'filiais' || key === 'ufs' || key === 'mensal') {
      const group =
        key === 'filiais'
          ? Prisma.sql`COALESCE(u.name, 'Não identificada')`
          : key === 'ufs'
            ? Prisma.sql`COALESCE(c."ufFim", '—')`
            : Prisma.sql`to_char((COALESCE(c."issuedAt", c."createdAt") AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`
      const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT ${group} AS nome, ${agg} FROM freight_ctes c LEFT JOIN units u ON u.id = c."unitId"
        WHERE ${base} GROUP BY 1 ORDER BY ${key === 'mensal' ? Prisma.sql`1` : Prisma.sql`sum(c.total) DESC`}`
      return { title: REPORTS[key], description: 'Valores dos CT-es no período (data de emissão).', columns: [{ key: 'nome', label: key === 'filiais' ? 'Filial' : key === 'ufs' ? 'UF' : 'Mês', type: 'text' }, ...money], rows: fix(rows) }
    }
    if (key === 'divergencias') {
      const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT tipo, count(*)::int AS ctes, sum(c.difference) AS diferenca, sum(c.total) AS cobrado
        FROM freight_ctes c, unnest(c."recTypes") AS tipo WHERE ${base} GROUP BY 1 ORDER BY 2 DESC`
      return {
        title: REPORTS.divergencias,
        description: 'Um CT-e pode ter mais de um tipo de divergência. Diferença = cobrado − cotado/tabela.',
        columns: [{ key: 'tipo', label: 'Tipo', type: 'text' }, { key: 'ctes', label: 'CT-es', type: 'int' }, { key: 'diferenca', label: 'Diferença', type: 'money' }, { key: 'cobrado', label: 'Cobrado', type: 'money' }],
        rows: fix(rows).map((r) => ({ ...r, tipo: REC_TYPE_LABEL[r.tipo as RecType] ?? r.tipo })),
      }
    }
    if (key === 'contestacoes') {
      const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c.number AS cte, to_char(c."issuedAt", 'DD/MM/YYYY') AS emissao, COALESCE(fc.name, c."emitName") AS transportadora, c."cityFim" || '/' || c."ufFim" AS destino,
          c.total AS cobrado, c."expectedTotal" AS esperado, c."approvedValue" AS aprovado, c."creditValue" AS credito, c."contestStatus" AS situacao, c."decisionNote" AS motivo
        FROM freight_ctes c LEFT JOIN freight_carriers fc ON fc.id = c."carrierId"
        WHERE ${base} AND c."contestStatus" IS NOT NULL ORDER BY c."issuedAt" DESC LIMIT 2000`
      return {
        title: REPORTS.contestacoes,
        description: 'Contestação aceita = crédito recuperado; recusada = pago o cobrado.',
        columns: [
          { key: 'cte', label: 'CT-e', type: 'text' },
          { key: 'emissao', label: 'Emissão', type: 'text' },
          { key: 'transportadora', label: 'Transportadora', type: 'text' },
          { key: 'destino', label: 'Destino', type: 'text' },
          { key: 'cobrado', label: 'Cobrado', type: 'money' },
          { key: 'esperado', label: 'Cotado/tabela', type: 'money' },
          { key: 'aprovado', label: 'Aprovado', type: 'money' },
          { key: 'credito', label: 'Crédito', type: 'money' },
          { key: 'situacao', label: 'Situação', type: 'text' },
          { key: 'motivo', label: 'Motivo', type: 'text' },
        ],
        rows: fix(rows).map((r) => ({ ...r, situacao: ({ ABERTA: 'Aberta', ACEITA: 'Aceita', RECUSADA: 'Recusada' } as Record<string, string>)[r.situacao as string] ?? r.situacao ?? null })),
      }
    }
    if (key === 'faturas') {
      const units = allowedUnits(user, 'fretes_financeiro')
      const u = f.unitId ? Prisma.sql`AND i."unitId" = ${f.unitId}::uuid` : units ? Prisma.sql`AND i."unitId" = ANY(${units}::uuid[])` : Prisma.empty
      const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT fc.name AS transportadora, i.number AS fatura, to_char(i."dueAt", 'DD/MM/YYYY') AS vencimento, i.total AS valor,
          (SELECT sum(c."approvedValue") FROM freight_ctes c WHERE c."invoiceId" = i.id AND c."fiscalStatus" <> 'CANCELADO') AS aprovado,
          i."paidValue" AS pago, to_char(i."paidAt", 'DD/MM/YYYY') AS pagamento, i.status AS situacao
        FROM freight_invoices i JOIN freight_carriers fc ON fc.id = i."carrierId"
        WHERE i."tenantId" = ${t}::uuid AND i."dueAt" >= ${from} AND i."dueAt" < ${end} ${u} ORDER BY i."dueAt"`
      return {
        title: REPORTS.faturas,
        description: 'Faturas com vencimento no período. Aprovado = soma aprovada na conciliação dos CT-es da fatura.',
        columns: [
          { key: 'transportadora', label: 'Transportadora', type: 'text' },
          { key: 'fatura', label: 'Fatura', type: 'text' },
          { key: 'vencimento', label: 'Vencimento', type: 'text' },
          { key: 'valor', label: 'Valor', type: 'money' },
          { key: 'aprovado', label: 'Aprovado', type: 'money' },
          { key: 'pago', label: 'Pago', type: 'money' },
          { key: 'pagamento', label: 'Pagamento', type: 'text' },
          { key: 'situacao', label: 'Situação', type: 'text' },
        ],
        rows: fix(rows),
      }
    }
    // tabelas
    const units = allowedUnits(user, 'fretes_tabelas')
    const rows = await this.prisma.freightTable.findMany({
      where: { tenantId: t, ...(units ? { OR: [{ unitIds: { isEmpty: true } }, { unitIds: { hasSome: units } }] } : {}) },
      include: { carrier: { select: { name: true } } },
      orderBy: [{ validTo: 'asc' }],
    })
    const today = todayUtc()
    return {
      title: REPORTS.tabelas,
      description: 'Todas as tabelas, com a vigência e a versão publicada.',
      columns: [
        { key: 'transportadora', label: 'Transportadora', type: 'text' },
        { key: 'tabela', label: 'Tabela', type: 'text' },
        { key: 'situacao', label: 'Situação', type: 'text' },
        { key: 'inicio', label: 'Início', type: 'text' },
        { key: 'fim', label: 'Fim', type: 'text' },
        { key: 'vigencia', label: 'Vigência', type: 'text' },
        { key: 'dias', label: 'Dias para vencer', type: 'int' },
      ],
      rows: rows.map((r) => ({
        transportadora: r.carrier.name,
        tabela: r.name,
        situacao: r.status,
        inicio: r.validFrom.toISOString().slice(0, 10).split('-').reverse().join('/'),
        fim: r.validTo.toISOString().slice(0, 10).split('-').reverse().join('/'),
        vigencia: r.validTo < today ? 'Vencida' : r.validFrom > today ? 'Futura' : 'Vigente',
        dias: Math.round((r.validTo.getTime() - today.getTime()) / DAY),
      })),
    }
  }

  /** CSV (separador ;, decimal com vírgula) do mesmo relatório. */
  async csv(user: AuthUser, key: string, f: { from?: string; to?: string; unitId?: string }) {
    const r = await this.run(user, key, f)
    const cell = (v: unknown, type: ColType) => {
      if (v === null || v === undefined) return ''
      if (type === 'money' || type === 'num' || type === 'pct') return Number(v).toFixed(type === 'num' ? 3 : 2).replace('.', ',')
      const s = String(v)
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [r.columns.map((c) => c.label).join(';'), ...r.rows.map((row) => r.columns.map((c) => cell(row[c.key], c.type)).join(';'))]
    return { fileName: `fretes-${key}-${new Date().toISOString().slice(0, 10)}.csv`, content: `﻿${lines.join('\r\n')}\r\n` }
  }

  /**
   * Central de alertas: só o que a pessoa pode ver. Calculada na hora a partir dos registros (nenhuma rotina em
   * segundo plano para falhar calada).
   */
  async alerts(user: AuthUser) {
    const t = user.tenantId
    const today = todayUtc()
    const settings = await this.ctes.recSettings(t)
    const out: { kind: string; severity: 'alta' | 'media' | 'baixa'; title: string; detail: string; link: string; count: number }[] = []
    const allow = (m: Parameters<typeof allowedUnits>[1]) => can(user.permissions, user.role.isSystem, m, 'view')

    if (allow('fretes_tabelas')) {
      const units = allowedUnits(user, 'fretes_tabelas')
      const scope = units ? { OR: [{ unitIds: { isEmpty: true } }, { unitIds: { hasSome: units } }] } : {}
      const [expired, expiring] = await Promise.all([
        this.prisma.freightTable.count({ where: { tenantId: t, status: 'ATIVA', validTo: { lt: today }, ...scope } }),
        this.prisma.freightTable.count({ where: { tenantId: t, status: 'ATIVA', validTo: { gte: today, lte: new Date(today.getTime() + 30 * DAY) }, ...scope } }),
      ])
      if (expired) out.push({ kind: 'tabela_vencida', severity: 'alta', title: 'Tabelas vencidas', detail: 'Ativas, mas fora da vigência: não entram nas cotações.', link: '/fretes/tabelas?vigencia=VENCIDA', count: expired })
      if (expiring) out.push({ kind: 'tabela_vencendo', severity: 'media', title: 'Tabelas vencendo em 30 dias', detail: 'Peça a tabela nova à transportadora.', link: '/fretes/tabelas?vigencia=A_VENCER', count: expiring })
    }
    if (allow('fretes_pedidos')) {
      const units = allowedUnits(user, 'fretes_pedidos')
      const scope = { tenantId: t, ...(units ? { unitId: { in: units } } : {}) }
      const limit = new Date(Date.now() - settings.diasSemCte * DAY)
      const [noQuote, late, noCte] = await Promise.all([
        this.prisma.freightShipment.count({ where: { ...scope, status: 'AGUARDANDO_COTACAO' } }),
        this.prisma.freightShipment.count({ where: { ...scope, status: { in: ['DESPACHADO', 'EM_TRANSITO', 'AGUARDANDO_COLETA'] }, expectedDeliveryAt: { lt: today } } }),
        this.prisma.freightShipment.count({ where: { ...scope, status: { in: ['DESPACHADO', 'EM_TRANSITO', 'ENTREGUE', 'AGUARDANDO_CTE'] }, shippedAt: { lt: limit } } }).then(async (count) => {
          if (!count) return 0
          const ids = await this.prisma.freightShipment.findMany({ where: { ...scope, status: { in: ['DESPACHADO', 'EM_TRANSITO', 'ENTREGUE', 'AGUARDANDO_CTE'] }, shippedAt: { lt: limit } }, select: { id: true }, take: 5000 })
          const withCte = await this.prisma.freightCte.findMany({ where: { shipmentId: { in: ids.map((i) => i.id) } }, select: { shipmentId: true }, distinct: ['shipmentId'] })
          return ids.length - withCte.length
        }),
      ])
      if (noQuote) out.push({ kind: 'pedido_sem_cotacao', severity: 'media', title: 'Pedidos sem cotação', detail: 'Aguardando cotação de frete.', link: '/fretes/pedidos?situacao=AGUARDANDO_COTACAO', count: noQuote })
      if (late) out.push({ kind: 'entrega_atrasada', severity: 'alta', title: 'Entregas atrasadas', detail: 'Previsão de entrega já passou e o pedido não foi entregue.', link: '/fretes/pedidos?atrasados=1', count: late })
      if (noCte) out.push({ kind: 'pedido_sem_cte', severity: 'media', title: `Despachados há mais de ${settings.diasSemCte} dias sem CT-e`, detail: 'Importe o XML do CT-e ou confira com a transportadora.', link: '/fretes/pedidos?situacao=DESPACHADO', count: noCte })
    }
    if (allow('fretes_cte')) {
      const units = allowedUnits(user, 'fretes_cte')
      const scope = { tenantId: t, fiscalStatus: { not: 'CANCELADO' }, ...(units ? { unitId: { in: units } } : {}) }
      const [divergent, noRef, contest] = await Promise.all([
        this.prisma.freightCte.aggregate({ where: { ...scope, recStatus: 'DIVERGENTE', decision: null }, _count: { _all: true }, _sum: { difference: true } }),
        this.prisma.freightCte.count({ where: { ...scope, recStatus: 'SEM_REFERENCIA', decision: null } }),
        this.prisma.freightCte.count({ where: { ...scope, contestStatus: 'ABERTA', decidedAt: { lt: new Date(Date.now() - 15 * DAY) } } }),
      ])
      if (divergent._count._all) out.push({ kind: 'cte_divergente', severity: 'alta', title: 'CT-es com divergência de cobrança', detail: `Diferença somada de R$ ${(num(divergent._sum.difference) ?? 0).toFixed(2).replace('.', ',')} esperando decisão.`, link: '/fretes/conciliacao', count: divergent._count._all })
      if (noRef) out.push({ kind: 'cte_sem_referencia', severity: 'media', title: 'CT-es sem cotação nem tabela para conferir', detail: 'Cadastre a transportadora/tabela ou ligue o CT-e ao pedido.', link: '/fretes/conciliacao?situacao=SEM_REFERENCIA', count: noRef })
      if (contest) out.push({ kind: 'contestacao_parada', severity: 'media', title: 'Contestações abertas há mais de 15 dias', detail: 'Cobre a resposta da transportadora.', link: '/fretes/conciliacao?decisao=CONTESTACAO_ABERTA', count: contest })
    }
    if (allow('fretes_financeiro')) {
      const units = allowedUnits(user, 'fretes_financeiro')
      const scope = { tenantId: t, status: { in: ['ABERTA', 'APROVADA'] }, ...(units ? { unitId: { in: units } } : {}) }
      const [overdue, dueSoon] = await Promise.all([
        this.prisma.freightInvoice.count({ where: { ...scope, dueAt: { lt: today } } }),
        this.prisma.freightInvoice.count({ where: { ...scope, dueAt: { gte: today, lte: new Date(today.getTime() + settings.diasFatura * DAY) } } }),
      ])
      if (overdue) out.push({ kind: 'fatura_vencida', severity: 'alta', title: 'Faturas vencidas sem pagamento', detail: 'Registre o pagamento ou confira com a transportadora.', link: '/fretes/faturas?situacao=VENCIDA', count: overdue })
      if (dueSoon) out.push({ kind: 'fatura_vencendo', severity: 'media', title: `Faturas vencendo em ${settings.diasFatura} dias`, detail: 'Confira se os CT-es estão conciliados antes de pagar.', link: '/fretes/faturas', count: dueSoon })
    }
    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'alta' ? -1 : b.severity === 'alta' ? 1 : 0))
  }
}
