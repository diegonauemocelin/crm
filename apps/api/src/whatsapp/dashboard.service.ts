import { ForbiddenException, Injectable } from '@nestjs/common'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { panelPeriod } from '../googleads/painel'
import { PrismaService } from '../prisma/prisma.service'
import { ChatService } from './chat.service'
import { analyze, inBusiness, insights, localSlot, type Msg, SESSION_GAP_MS, slaBuckets, stats, waitingBuckets } from './metricas'

const DAY = 86_400_000
const toMin = (ms: number | null) => (ms === null ? null : Math.round((ms / 60_000) * 10) / 10)
const minStats = (v: number[]) => {
  const s = stats(v)
  return { count: s.count, avg: toMin(s.avg), median: toMin(s.median), p90: toMin(s.p90) }
}

/** Dashboard de atendimento do WhatsApp: tempos de resposta, volume, situação agora, equipe, números e resultado comercial. */
@Injectable()
export class WhatsappDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  async dashboard(user: AuthUser, q: { from?: string; to?: string; numberId?: string; all?: boolean }) {
    if (!can(user.permissions, user.role.isSystem, 'chat', 'view')) throw new ForbiddenException('Você não tem permissão para esta ação.')
    const { from, to } = panelPeriod(q.from, q.to)
    const start = new Date(`${from}T00:00:00-03:00`)
    const end = new Date(Date.parse(`${to}T00:00:00-03:00`) + DAY)
    const span = end.getTime() - start.getTime()
    const prevStart = new Date(start.getTime() - span)
    const scope = await this.chat.where(user)
    const convWhere: Prisma.WhatsappConversationWhereInput = { AND: [scope, q.all ? { category: { not: 'GRUPO' } } : { category: 'CLIENTE' }, q.numberId ? { numberId: q.numberId } : {}] }
    const [convs, numbers] = await Promise.all([
      this.prisma.whatsappConversation.findMany({ where: convWhere, select: { id: true, numberId: true, name: true, phone: true, leadId: true, status: true, lastMessageAt: true, lastInboundAt: true, noReplyNeeded: true } }),
      this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, select: { id: true, name: true } }),
    ])
    const convIds = convs.map((c) => c.id)
    const convById = new Map(convs.map((c) => [c.id, c]))
    // Um dia antes do início para saber se a primeira mensagem do período continua um atendimento já aberto.
    const msgs: Msg[] = convIds.length
      ? await this.prisma.whatsappMessage.findMany({
          // Notas internas não são mensagens para o cliente: ficam fora dos tempos de resposta.
          where: { conversationId: { in: convIds }, internal: false, sentAt: { gte: new Date(prevStart.getTime() - SESSION_GAP_MS), lt: end } },
          orderBy: [{ conversationId: 'asc' }, { sentAt: 'asc' }, { createdAt: 'asc' }],
          select: { conversationId: true, fromMe: true, sentAt: true, sentById: true, type: true },
        })
      : []
    const { sessions, turns } = analyze(msgs)
    const inP = (d: Date) => d >= start && d < end
    const inPrev = (d: Date) => d >= prevStart && d < start

    // ---------- Volume ----------
    const periodMsgs = msgs.filter((m) => inP(m.sentAt))
    const received = sessions.filter((s) => s.startedBy === 'cliente' && inP(s.startAt))
    const initiated = sessions.filter((s) => s.startedBy === 'empresa' && inP(s.startAt))
    const firstTurns = turns.filter((t) => t.first && inP(t.at))
    const answeredFirst = firstTurns.filter((t) => t.ms !== null)
    const allTurns = turns.filter((t) => inP(t.at) && t.ms !== null)
    const inbound = periodMsgs.filter((m) => !m.fromMe)
    const prevFirst = turns.filter((t) => t.first && inPrev(t.at) && t.ms !== null)

    // ---------- Tempos ----------
    const frt = minStats(answeredFirst.map((t) => t.ms!))
    const frtBusiness = minStats(answeredFirst.map((t) => t.businessMs!))
    const response = minStats(allTurns.map((t) => t.ms!))
    const responseBusiness = minStats(allTurns.map((t) => t.businessMs!))
    const prevFrt = minStats(prevFirst.map((t) => t.businessMs!))

    // ---------- Situação agora ----------
    const now = Date.now()
    const awaiting = convs.filter((c) => c.status === 'ABERTA' && !c.noReplyNeeded && c.lastInboundAt)
    const waitMs = awaiting.map((c) => now - c.lastInboundAt!.getTime())
    const leadNames = new Map(
      (await this.prisma.lead.findMany({ where: { id: { in: awaiting.map((c) => c.leadId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]),
    )
    const oldest = [...awaiting]
      .sort((a, b) => a.lastInboundAt!.getTime() - b.lastInboundAt!.getTime())
      .slice(0, 10)
      .map((c) => ({ conversationId: c.id, name: (c.leadId && leadNames.get(c.leadId)) || c.name || c.phone || 'Contato', number: numbers.find((n) => n.id === c.numberId)?.name ?? null, since: c.lastInboundAt }))

    // ---------- Por dia e mapa de calor ----------
    const dayMap = new Map<string, { received: number; initiated: number; messagesIn: number; frt: number[] }>()
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) dayMap.set(new Date(t).toISOString().slice(0, 10), { received: 0, initiated: 0, messagesIn: 0, frt: [] })
    for (const s of received) dayMap.get(localSlot(s.startAt).day)!.received++
    for (const s of initiated) dayMap.get(localSlot(s.startAt).day)!.initiated++
    for (const m of inbound) dayMap.get(localSlot(m.sentAt).day)!.messagesIn++
    for (const t of answeredFirst) dayMap.get(localSlot(t.at).day)!.frt.push(t.businessMs!)
    const days = [...dayMap].map(([day, v]) => ({ day, received: v.received, initiated: v.initiated, messagesIn: v.messagesIn, frtMedian: minStats(v.frt).median }))
    const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
    for (const m of inbound) {
      const s = localSlot(m.sentAt)
      heat[s.weekday]![s.hour]!++
    }
    // Horário com a primeira resposta mais lenta (para a leitura automática).
    const bySlot = new Map<string, number[]>()
    for (const t of answeredFirst) {
      const s = localSlot(t.at)
      const k = `${s.weekday}:${s.hour}`
      bySlot.set(k, [...(bySlot.get(k) ?? []), t.businessMs!])
    }
    const slow = [...bySlot]
      .map(([k, v]) => ({ weekday: Number(k.split(':')[0]), hour: Number(k.split(':')[1]), median: stats(v).median!, count: v.length }))
      .filter((x) => x.count >= 5)
      .sort((a, b) => b.median - a.median)[0] ?? null

    // ---------- Equipe (quem respondeu) ----------
    const userIds = [...new Set(allTurns.map((t) => t.responder).filter((x): x is string => !!x && x !== 'celular'))]
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    const teamMap = new Map<string, { turns: number[]; first: number[]; sent: number }>()
    const team = (k: string) => teamMap.get(k) ?? (teamMap.set(k, { turns: [], first: [], sent: 0 }), teamMap.get(k)!)
    for (const t of allTurns) {
      team(t.responder!).turns.push(t.businessMs!)
      if (t.first) team(t.responder!).first.push(t.businessMs!)
    }
    for (const m of periodMsgs) if (m.fromMe) team(m.sentById ?? 'celular').sent++
    const sellers = [...teamMap]
      .map(([k, v]) => {
        const s = minStats(v.turns)
        return { id: k, name: k === 'celular' ? 'Pelo celular' : (users.get(k) ?? 'Usuário removido'), answered: v.turns.length, firstResponses: v.first.length, median: s.median, avg: s.avg, p90: s.p90, sent: v.sent }
      })
      .sort((a, b) => b.answered - a.answered)

    // ---------- Por número ----------
    const byNumber = numbers
      .map((n) => {
        const ids = new Set(convs.filter((c) => c.numberId === n.id).map((c) => c.id))
        const f = answeredFirst.filter((t) => ids.has(t.conversationId)).map((t) => t.businessMs!)
        return {
          id: n.id,
          name: n.name,
          received: received.filter((s) => ids.has(s.conversationId)).length,
          initiated: initiated.filter((s) => ids.has(s.conversationId)).length,
          messagesIn: inbound.filter((m) => ids.has(m.conversationId)).length,
          frtMedian: minStats(f).median,
          awaiting: awaiting.filter((c) => c.numberId === n.id).length,
        }
      })
      .filter((n) => !q.numberId || n.id === q.numberId)

    // ---------- Resultado comercial (pré-vendas que vieram do WhatsApp) ----------
    const numberName = q.numberId ? numbers.find((n) => n.id === q.numberId)?.name : null
    const records = await this.prisma.serviceRecord.findMany({
      where: {
        tenantId: user.tenantId,
        kind: 'PRE_VENDAS',
        deletedAt: null,
        leadAt: { gte: start, lt: end },
        // Abertas pelo chat do CRM (o canal guarda o número). O resto com origem WhatsApp (botão do site, planilha) é contado à parte.
        entryChannel: numberName ? `WhatsApp "${numberName}"` : { startsWith: 'WhatsApp "' },
      },
      select: { id: true, sellerId: true, returnStatus: true, saleStatus: true, saleValue: true, adsVia: true },
    })
    const otherOrigin = numberName
      ? 0
      : await this.prisma.serviceRecord.count({
          where: { tenantId: user.tenantId, kind: 'PRE_VENDAS', deletedAt: null, leadAt: { gte: start, lt: end }, origin: { name: { startsWith: 'WhatsApp' } }, OR: [{ entryChannel: null }, { NOT: { entryChannel: { startsWith: 'WhatsApp "' } } }] },
        })
    const sold = records.filter((r) => r.saleStatus === 'SIM')
    const revenue = sold.reduce((a, r) => a + Number(r.saleValue ?? 0), 0)
    const sellerNames = new Map((await this.prisma.seller.findMany({ where: { tenantId: user.tenantId, id: { in: [...new Set(records.map((r) => r.sellerId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]))
    const salesBySeller = [...new Set(records.map((r) => r.sellerId ?? '-'))]
      .map((id) => {
        const rs = records.filter((r) => (r.sellerId ?? '-') === id)
        const ss = rs.filter((r) => r.saleStatus === 'SIM')
        return { name: id === '-' ? 'Sem vendedor' : (sellerNames.get(id) ?? 'Vendedor'), records: rs.length, sales: ss.length, revenue: ss.reduce((a, r) => a + Number(r.saleValue ?? 0), 0), conversion: rs.length ? ss.length / rs.length : null }
      })
      .sort((a, b) => b.records - a.records)

    // ---------- Lembretes e ligações ----------
    const [remCreated, remDone, remOverdue, remPending] = await Promise.all([
      this.prisma.whatsappReminder.count({ where: { conversationId: { in: convIds }, createdAt: { gte: start, lt: end } } }),
      this.prisma.whatsappReminder.count({ where: { conversationId: { in: convIds }, doneAt: { gte: start, lt: end } } }),
      this.prisma.whatsappReminder.count({ where: { conversationId: { in: convIds }, doneAt: null, dueAt: { lt: new Date() } } }),
      this.prisma.whatsappReminder.count({ where: { conversationId: { in: convIds }, doneAt: null, dueAt: { gte: new Date() } } }),
    ])
    const calls = inbound.filter((m) => m.type === 'chamada').length

    const outside = inbound.length ? inbound.filter((m) => !inBusiness(m.sentAt)).length / inbound.length : null
    const conversion = records.length >= 5 ? sold.length / records.length : null
    return {
      from,
      to,
      businessHours: 'seg. a sex. das 8h às 18h e sáb. das 8h às 12h',
      totals: {
        received: received.length,
        initiated: initiated.length,
        activeConversations: new Set(periodMsgs.map((m) => m.conversationId)).size,
        messagesIn: inbound.length,
        messagesOut: periodMsgs.length - inbound.length,
        calls,
        firstTurns: firstTurns.length,
        unansweredFirst: firstTurns.length - answeredFirst.length,
        outsideBusinessShare: outside,
      },
      previous: { received: sessions.filter((s) => s.startedBy === 'cliente' && inPrev(s.startAt)).length, frtBusinessMedian: prevFrt.median },
      times: { frt, frtBusiness, response, responseBusiness, sla: slaBuckets(answeredFirst.map((t) => t.businessMs!)) },
      now: { open: convs.filter((c) => c.status === 'ABERTA' && c.lastMessageAt).length, awaiting: awaiting.length, waiting: waitingBuckets(waitMs), oldest, closedInPeriod: convs.filter((c) => c.status === 'ARQUIVADA' && c.lastMessageAt && inP(c.lastMessageAt)).length },
      days,
      heat,
      sellers,
      numbers: byNumber,
      commercial: { otherOrigin, records: records.length, returned: records.filter((r) => r.returnStatus === 'SIM').length, sales: sold.length, revenue, fromGoogleAds: records.filter((r) => r.adsVia).length, conversion: records.length ? sold.length / records.length : null, bySeller: salesBySeller },
      reminders: { created: remCreated, done: remDone, overdue: remOverdue, pending: remPending },
      insights: insights({
        turns: firstTurns,
        waitingOver24h: waitMs.filter((w) => w > DAY).length,
        sellers: sellers.filter((s) => s.id !== 'celular').map((s) => ({ name: s.name, median: s.median === null ? null : s.median * 60_000, count: s.answered })),
        overallMedian: frtBusiness.median === null ? null : frtBusiness.median * 60_000,
        outsideShare: outside,
        heat,
        frtSlowHour: slow,
        conversion,
        previousMedian: prevFrt.median === null ? null : prevFrt.median * 60_000,
      }),
    }
  }
}
