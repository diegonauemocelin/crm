import { Injectable } from '@nestjs/common'
import type { AuthUser } from '../common/types'
import { Prisma } from '../generated/prisma/client'
import { panelPeriod } from '../googleads/painel'
import { PrismaService } from '../prisma/prisma.service'
import { EmailService } from './email.service'
import { ATTRIBUTION_WINDOWS, type AttributionWindow, attributeSales, bestSlot, BOUNCE_SQL, type Click, type Funnel, insights, rates, ratio, type Sale, sumSales } from './painel'

const DAY = 86_400_000
const TZ = 'America/Sao_Paulo'
/** Envio pulado porque o lead descadastrou depois que a campanha começou: não é falha de entrega. */
const SKIPPED = 'Sem consentimento no momento do envio.'
export type Source = 'todos' | 'campanhas' | 'automacoes'

type FunnelRow = { sent: bigint; failed: bigint; bounced: bigint; opened: bigint; clicked: bigint; unsubscribed: bigint }
const funnelOf = (r: FunnelRow | undefined): Funnel => ({
  sent: Number(r?.sent ?? 0),
  failed: Number(r?.failed ?? 0),
  bounced: Number(r?.bounced ?? 0),
  opened: Number(r?.opened ?? 0),
  clicked: Number(r?.clicked ?? 0),
  unsubscribed: Number(r?.unsubscribed ?? 0),
})
const FUNNEL = Prisma.sql`
  count(*) FILTER (WHERE er.status = 'ENVIADO') AS sent,
  count(*) FILTER (WHERE er.status = 'ERRO') AS failed,
  count(*) FILTER (WHERE er.status = 'ERRO' AND er.error ~* ${BOUNCE_SQL}) AS bounced,
  count(er."openedAt") FILTER (WHERE er.status = 'ENVIADO') AS opened,
  count(er."clickedAt") FILTER (WHERE er.status = 'ENVIADO') AS clicked,
  count(er."unsubscribedAt") FILTER (WHERE er.status = 'ENVIADO') AS unsubscribed`
const local = (col: Prisma.Sql) => Prisma.sql`((${col}) AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}`

/** Dashboard do e-mail marketing: funil (enviados → abertos → clicados), vendas de quem clicou, campanhas, fluxos e saúde da base. */
@Injectable()
export class EmailDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async dashboard(user: AuthUser, q: { from?: string; to?: string; source?: Source; window?: number }) {
    this.email.assertCan(user, 'view')
    const { from, to } = panelPeriod(q.from, q.to)
    const windowDays: AttributionWindow = (ATTRIBUTION_WINDOWS as readonly number[]).includes(q.window ?? 0) ? (q.window as AttributionWindow) : 7
    const source: Source = q.source === 'campanhas' || q.source === 'automacoes' ? q.source : 'todos'
    const start = new Date(`${from}T00:00:00-03:00`)
    const end = new Date(Date.parse(`${to}T00:00:00-03:00`) + DAY)
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()))
    const T = user.tenantId
    const base = Prisma.sql`c."tenantId" = ${T}::uuid${source === 'campanhas' ? Prisma.sql` AND c.kind = 'CAMPANHA'` : source === 'automacoes' ? Prisma.sql` AND c.kind = 'MODELO'` : Prisma.empty}`
    const inRange = (s: Date, e: Date) => Prisma.sql`((er.status = 'ENVIADO' AND er."sentAt" >= ${s} AND er."sentAt" < ${e}) OR (er.status = 'ERRO' AND er."failedAt" >= ${s} AND er."failedAt" < ${e} AND er.error IS DISTINCT FROM ${SKIPPED}))`
    const funnel = (s: Date, e: Date) => this.prisma.$queryRaw<FunnelRow[]>`
      SELECT ${FUNNEL} FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId" WHERE ${base} AND ${inRange(s, e)}`

    const [now, before, byCampaign, byFlow, runs, days, heat, links, sales, prevSales, health] = await Promise.all([
      funnel(start, end),
      funnel(prevStart, start),
      this.prisma.$queryRaw<(FunnelRow & { id: string; name: string; kind: string; subject: string; first: Date | null })[]>`
        SELECT c.id, c.name, c.kind, c.subject, min(er."sentAt") AS first, ${FUNNEL}
        FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId"
        WHERE ${base} AND ${inRange(start, end)}
        GROUP BY c.id, c.name, c.kind, c.subject ORDER BY first DESC NULLS LAST LIMIT 100`,
      source === 'campanhas'
        ? Promise.resolve([] as (FunnelRow & { automationId: string })[])
        : this.prisma.$queryRaw<(FunnelRow & { automationId: string })[]>`
          SELECT r."automationId", ${FUNNEL}
          FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId" JOIN automation_runs r ON r.id = er."runId"
          WHERE ${base} AND ${inRange(start, end)} GROUP BY r."automationId"`,
      source === 'campanhas'
        ? Promise.resolve([] as { automationId: string; entered: bigint; completed: bigint; purchased: bigint }[])
        : this.prisma.$queryRaw<{ automationId: string; entered: bigint; completed: bigint; purchased: bigint }[]>`
          SELECT r."automationId",
            count(*) FILTER (WHERE r."startedAt" >= ${start} AND r."startedAt" < ${end}) AS entered,
            count(*) FILTER (WHERE r.status = 'CONCLUIDO' AND r."finishedAt" >= ${start} AND r."finishedAt" < ${end}) AS completed,
            count(*) FILTER (WHERE r.status = 'SAIU' AND r."exitReason" LIKE 'Comprou%' AND r."finishedAt" >= ${start} AND r."finishedAt" < ${end}) AS purchased
          FROM automation_runs r WHERE r."tenantId" = ${T}::uuid AND (r."startedAt" >= ${start} OR r."finishedAt" >= ${start}) AND r."startedAt" < ${end}
          GROUP BY r."automationId"`,
      this.prisma.$queryRaw<{ day: string; sent: bigint; opened: bigint; clicked: bigint }[]>`
        SELECT to_char(${local(Prisma.sql`er."sentAt"`)}, 'YYYY-MM-DD') AS day, count(*) AS sent, count(er."openedAt") AS opened, count(er."clickedAt") AS clicked
        FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId"
        WHERE ${base} AND er.status = 'ENVIADO' AND er."sentAt" >= ${start} AND er."sentAt" < ${end} GROUP BY 1`,
      this.prisma.$queryRaw<{ w: number; h: number; n: bigint }[]>`
        SELECT extract(dow FROM ${local(Prisma.sql`er."openedAt"`)})::int AS w, extract(hour FROM ${local(Prisma.sql`er."openedAt"`)})::int AS h, count(*) AS n
        FROM email_recipients er JOIN email_campaigns c ON c.id = er."campaignId"
        WHERE ${base} AND er."openedAt" >= ${start} AND er."openedAt" < ${end} GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ campaignId: string; linkIndex: number; name: string; links: string[]; clicks: bigint; people: bigint }[]>`
        SELECT ec."campaignId", ec."linkIndex", c.name, c.links, count(*) AS clicks, count(DISTINCT ec."recipientId") AS people
        FROM email_clicks ec JOIN email_campaigns c ON c.id = ec."campaignId"
        WHERE ${base} AND ec."createdAt" >= ${start} AND ec."createdAt" < ${end}
        GROUP BY ec."campaignId", ec."linkIndex", c.name, c.links ORDER BY clicks DESC LIMIT 10`,
      this.sales(T, base, start, end, windowDays),
      this.sales(T, base, prevStart, start, windowDays),
      this.prisma.$queryRaw<{ withEmail: bigint; contactable: bigint; optOut: bigint; bounced: bigint }[]>`
        SELECT count(*) AS "withEmail",
          count(*) FILTER (WHERE l."emailOptIn" AND l."emailBouncedAt" IS NULL) AS contactable,
          count(*) FILTER (WHERE NOT l."emailOptIn") AS "optOut",
          count(*) FILTER (WHERE l."emailBouncedAt" IS NOT NULL) AS bounced
        FROM leads l WHERE l."tenantId" = ${T}::uuid AND l."deletedAt" IS NULL AND l."anonymizedAt" IS NULL AND l.email IS NOT NULL`,
    ])

    const total = funnelOf(now[0])
    const prev = funnelOf(before[0])
    const salesBy = (key: 'campaignId' | 'automationId', id: string) => sumSales(sales.filter((s) => s[key] === id))

    const campaigns = byCampaign.map((c) => {
      const f = funnelOf(c)
      const r = rates(f)
      return { id: c.id, name: c.name, kind: c.kind, subject: c.subject, firstSent: c.first, ...f, open: r.open, click: r.click, unsubscribe: r.unsubscribe, ...salesBy('campaignId', c.id) }
    })

    const flowIds = [...new Set([...byFlow.map((f) => f.automationId), ...runs.map((r) => r.automationId)])]
    const flowNames = new Map((await this.prisma.automation.findMany({ where: { tenantId: T, id: { in: flowIds } }, select: { id: true, name: true, active: true } })).map((a) => [a.id, a]))
    const automations = flowIds
      .filter((id) => flowNames.has(id))
      .map((id) => {
        const f = funnelOf(byFlow.find((x) => x.automationId === id))
        const r = rates(f)
        const run = runs.find((x) => x.automationId === id)
        const a = flowNames.get(id)!
        return { id, name: a.name, active: a.active, entered: Number(run?.entered ?? 0), completed: Number(run?.completed ?? 0), purchased: Number(run?.purchased ?? 0), ...f, open: r.open, click: r.click, ...salesBy('automationId', id) }
      })
      .sort((a, b) => b.sent - a.sent || b.entered - a.entered)

    const dayMap = new Map(days.map((d) => [d.day, d]))
    const dayList: { day: string; sent: number; opened: number; clicked: number }[] = []
    for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += DAY) {
      const day = new Date(t).toISOString().slice(0, 10)
      const d = dayMap.get(day)
      dayList.push({ day, sent: Number(d?.sent ?? 0), opened: Number(d?.opened ?? 0), clicked: Number(d?.clicked ?? 0) })
    }
    const heatGrid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
    for (const h of heat) {
      const row = heatGrid[h.w]
      if (row && h.h >= 0 && h.h < 24) row[h.h] = Number(h.n)
    }
    const slot = bestSlot(heatGrid)

    const totalSales = sumSales(sales)
    const r = rates(total)
    const hb = health[0]
    return {
      from,
      to,
      source,
      windowDays,
      funnel: total,
      rates: r,
      previous: { funnel: prev, rates: rates(prev), sales: sumSales(prevSales) },
      sales: { ...totalSales, store: sumSales(sales.filter((s) => s.source === 'loja')), service: sumSales(sales.filter((s) => s.source === 'atendimento')), perSent: ratio(totalSales.revenue, total.sent) },
      days: dayList,
      heat: heatGrid,
      bestSlot: slot,
      campaigns,
      automations,
      links: links.map((l) => ({ campaignId: l.campaignId, campaign: l.name, url: l.links[l.linkIndex] ?? '(link removido)', clicks: Number(l.clicks), people: Number(l.people) })),
      base: { withEmail: Number(hb?.withEmail ?? 0), contactable: Number(hb?.contactable ?? 0), optOut: Number(hb?.optOut ?? 0), bounced: Number(hb?.bounced ?? 0) },
      insights: insights({ funnel: total, previousOpen: rates(prev).open, campaigns: campaigns.map((c) => ({ name: c.name, sent: c.sent, click: c.click })), slot, revenue: totalSales.revenue, sales: totalSales.count, windowDays }),
    }
  }

  /** Vendas no período de leads que clicaram em um e-mail nos N dias antes (pedidos pagos na loja e vendas da pré-venda). */
  private async sales(tenantId: string, base: Prisma.Sql, start: Date, end: Date, windowDays: number) {
    const rows = await this.prisma.$queryRaw<{ leadId: string; campaignId: string; automationId: string | null; at: Date }[]>`
      SELECT er."leadId", ec."campaignId", r."automationId", ec."createdAt" AS at
      FROM email_clicks ec JOIN email_recipients er ON er.id = ec."recipientId" JOIN email_campaigns c ON c.id = ec."campaignId"
      LEFT JOIN automation_runs r ON r.id = er."runId"
      WHERE ${base} AND ec."createdAt" >= ${new Date(start.getTime() - windowDays * DAY)} AND ec."createdAt" < ${end}`
    if (!rows.length) return []
    const clicks: Click[] = rows.map((x) => ({ leadId: x.leadId, campaignId: x.campaignId, automationId: x.automationId, at: new Date(x.at) }))
    const leadIds = [...new Set(clicks.map((c) => c.leadId))]
    const [orders, records] = await Promise.all([
      this.prisma.ecommerceOrder.findMany({ where: { tenantId, statusGroup: 'pago', orderedAt: { gte: start, lt: end }, leadId: { in: leadIds } }, select: { id: true, leadId: true, orderedAt: true, total: true } }),
      this.prisma.serviceRecord.findMany({ where: { tenantId, deletedAt: null, saleStatus: 'SIM', leadAt: { gte: start, lt: end }, leadId: { in: leadIds } }, select: { id: true, leadId: true, leadAt: true, saleValue: true } }),
    ])
    const store: Sale[] = orders.map((o) => ({ id: o.id, leadId: o.leadId!, at: o.orderedAt, value: Number(o.total), source: 'loja' }))
    // A mesma compra pode estar na loja e na pré-venda: com pedido do lead em até 3 dias, conta só o pedido.
    const service: Sale[] = records
      .filter((r) => !store.some((o) => o.leadId === r.leadId && Math.abs(o.at.getTime() - r.leadAt.getTime()) <= 3 * DAY))
      .map((r) => ({ id: r.id, leadId: r.leadId!, at: r.leadAt, value: Number(r.saleValue ?? 0), source: 'atendimento' }))
    return attributeSales(clicks, [...store, ...service], windowDays)
  }
}
