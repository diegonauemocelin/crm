import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { EmailService } from '../email/email.service'
import type { Automation, AutomationRun, Prisma } from '../generated/prisma/client'
import { LeadConfigService } from '../leads/lead-config.service'
import { type LeadFilters, LeadsService } from '../leads/leads.service'
import { PrismaService } from '../prisma/prisma.service'
import { RastreamentoService } from '../rastreamento/rastreamento.service'
import { MailService } from '../settings/mail.service'
import { SettingsService } from '../settings/settings.service'
import {
  allSteps,
  branchStart,
  cleanSteps,
  cleanTrigger,
  compile,
  EVENT_TRIGGERS,
  eventMatches,
  fillMessage,
  INTERACTION_EVENTS,
  type Node,
  PURCHASE_EVENTS,
  type Rule,
  type Step,
  type Trigger,
  waitMs,
} from './fluxo'

const TICK_MS = 20_000
const DAY = 86_400_000
const INACTIVITY_EVERY_MS = 60 * 60_000
/** Compras até 30 dias depois de entrar no fluxo contam para o fluxo no relatório. */
export const ATTRIBUTION_DAYS = 30
const STAGE_LABEL: Record<string, string> = { LEAD: 'Lead', QUALIFICADO: 'Qualificado', OPORTUNIDADE: 'Oportunidade', CLIENTE: 'Cliente' }

interface Cursor {
  at: string
  id: string
}
interface Cursors {
  events: Cursor
  leads: Cursor
  records: Cursor
  inactivityAt: string | null
}

export interface AutomationInput {
  name: string
  description?: string | null
  trigger: unknown
  steps: unknown
  reentry: 'nunca' | 'apos_terminar'
  exitOnPurchase: boolean
}

type RunCtx = Record<string, unknown> & { waiting?: string; lastEmailRecipientId?: string }

@Injectable()
export class AutomacoesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AutomacoesService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private emailBudget = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    private readonly leads: LeadsService,
    private readonly scoring: LeadConfigService,
    private readonly tracking: RastreamentoService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'automacoes', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  // ---------- Cadastro dos fluxos ----------

  async list(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.automation.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] })
    const counts = await this.prisma.automationRun.groupBy({ by: ['automationId', 'status'], where: { tenantId: user.tenantId }, _count: { _all: true } })
    return rows.map(({ tenantId: _t, steps, ...a }) => {
      const of = (s: string) => counts.find((c) => c.automationId === a.id && c.status === s)?._count._all ?? 0
      return { ...a, stepCount: allSteps(steps as unknown as Step[]).length, running: of('ATIVO'), finished: of('CONCLUIDO') + of('SAIU') + of('ERRO'), entered: of('ATIVO') + of('CONCLUIDO') + of('SAIU') + of('ERRO') }
    })
  }

  private async load(user: AuthUser, id: string) {
    const a = await this.prisma.automation.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!a) throw new NotFoundException('Automação não encontrada.')
    return a
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const { tenantId: _t, ...a } = await this.load(user, id)
    const running = await this.prisma.automationRun.count({ where: { automationId: id, status: 'ATIVO' } })
    return { ...a, running }
  }

  /** Passos que apontam para cadastros (modelo, vendedor, usuários) precisam existir nesta empresa. */
  private async checkRefs(tenantId: string, steps: Step[]) {
    for (const s of allSteps(steps)) {
      if (s.type === 'enviar_email' && !(await this.prisma.emailCampaign.count({ where: { id: s.templateId, tenantId, kind: 'MODELO' } }))) throw new BadRequestException('Um passo "Enviar e-mail" usa um modelo que não existe mais.')
      if ((s.type === 'alterar_vendedor' || (s.type === 'criar_atendimento' && s.ownerId)) && !(await this.prisma.seller.count({ where: { id: (s as { ownerId: string }).ownerId, tenantId } })))
        throw new BadRequestException('Um passo usa um vendedor que não existe mais.')
      if (s.type === 'notificar' && (await this.prisma.user.count({ where: { id: { in: s.userIds }, tenantId } })) !== s.userIds.length) throw new BadRequestException('O passo "Avisar a equipe" tem um usuário que não existe mais.')
    }
  }

  async create(user: AuthUser, name: string, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const a = await this.prisma.automation.create({ data: { tenantId: user.tenantId, name: name.trim(), trigger: { type: 'lead_novo' }, steps: [], createdById: user.id } })
    await this.audit.byUser(user, ctx, 'automation.created', 'automation', a.id, { nome: a.name })
    return { id: a.id }
  }

  async save(user: AuthUser, id: string, d: AutomationInput, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const current = await this.load(user, id)
    const t = cleanTrigger(d.trigger)
    if ('error' in t) throw new BadRequestException(t.error)
    const s = cleanSteps(d.steps)
    if ('error' in s) throw new BadRequestException(s.error)
    await this.checkRefs(user.tenantId, s.steps)
    if (current.active && !s.steps.length) throw new BadRequestException('Um fluxo ligado precisa de pelo menos um passo.')
    const a = await this.prisma.automation.update({
      where: { id },
      data: {
        name: d.name.trim(),
        description: d.description?.trim() || null,
        trigger: t.trigger as unknown as Prisma.InputJsonValue,
        steps: s.steps as unknown as Prisma.InputJsonValue,
        reentry: d.reentry === 'apos_terminar' ? 'apos_terminar' : 'nunca',
        exitOnPurchase: d.exitOnPurchase,
      },
    })
    await this.audit.byUser(user, ctx, 'automation.updated', 'automation', id, { nome: a.name, gatilho: t.trigger.type, passos: allSteps(s.steps).length })
    const { tenantId: _t, ...rest } = a
    return rest
  }

  async setActive(user: AuthUser, id: string, active: boolean, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const a = await this.load(user, id)
    if (active) {
      const steps = a.steps as unknown as Step[]
      if (!steps.length) throw new BadRequestException('Adicione pelo menos um passo antes de ligar o fluxo.')
      await this.checkRefs(user.tenantId, steps)
    }
    await this.prisma.automation.update({ where: { id }, data: { active, ...(active && !a.active ? { activatedAt: new Date() } : {}) } })
    await this.audit.byUser(user, ctx, active ? 'automation.activated' : 'automation.paused', 'automation', id, { nome: a.name })
    if (active) void this.tick()
    return { ok: true }
  }

  async duplicate(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const a = await this.load(user, id)
    const copy = await this.prisma.automation.create({
      data: { tenantId: user.tenantId, name: `${a.name} (cópia)`.slice(0, 120), description: a.description, trigger: a.trigger as Prisma.InputJsonValue, steps: a.steps as Prisma.InputJsonValue, reentry: a.reentry, exitOnPurchase: a.exitOnPurchase, createdById: user.id },
    })
    await this.audit.byUser(user, ctx, 'automation.duplicated', 'automation', copy.id, { origem: id })
    return { id: copy.id }
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const a = await this.load(user, id)
    if (a.active) throw new BadRequestException('Desligue o fluxo antes de excluir.')
    await this.prisma.automation.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'automation.deleted', 'automation', id, { nome: a.name })
  }

  /** Coloca no fluxo, agora, os leads de um segmento (gatilho "Manual" ou para incluir a base atual). */
  async enrollSegment(user: AuthUser, id: string, segmentId: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const a = await this.load(user, id)
    if (!a.active) throw new BadRequestException('Ligue o fluxo antes de colocar leads nele.')
    const seg = await this.prisma.emailSegment.findFirst({ where: { id: segmentId, tenantId: user.tenantId } })
    if (!seg) throw new BadRequestException('Segmento não encontrado.')
    const leads = await this.prisma.lead.findMany({ where: { AND: [this.leads.where(user, seg.filters as LeadFilters), { anonymizedAt: null }] }, select: { id: true }, take: 20_000 })
    let entered = 0
    for (const l of leads) if (await this.enroll(a, l.id, { origem: `segmento "${seg.name}"` })) entered++
    await this.audit.byUser(user, ctx, 'automation.segment_enrolled', 'automation', id, { segmento: seg.name, leads: leads.length, entraram: entered })
    void this.tick()
    return { total: leads.length, entered }
  }

  async removeRun(user: AuthUser, id: string, runId: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const run = await this.prisma.automationRun.findFirst({ where: { id: runId, automationId: id, tenantId: user.tenantId } })
    if (!run) throw new NotFoundException('Passagem não encontrada.')
    if (run.status !== 'ATIVO') throw new BadRequestException('Este lead já saiu do fluxo.')
    await this.finish(run, 'SAIU', `Retirado do fluxo por ${user.name}.`)
    await this.audit.byUser(user, ctx, 'automation.run_removed', 'automation', id, { lead: run.leadId })
    return { ok: true }
  }

  // ---------- Relatório ----------

  async report(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    await this.load(user, id)
    const [byStatus, byStep, emails, sales, runs] = await Promise.all([
      this.prisma.automationRun.groupBy({ by: ['status'], where: { automationId: id }, _count: { _all: true } }),
      this.prisma.automationLog.groupBy({ by: ['stepId', 'kind'], where: { automationId: id, stepId: { not: null } }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ sent: bigint; opened: bigint; clicked: bigint }[]>`
        SELECT count(*) AS sent, count(er."openedAt") AS opened, count(er."clickedAt") AS clicked
        FROM email_recipients er JOIN automation_runs r ON r.id = er."runId"
        WHERE r."automationId" = ${id}::uuid AND er.status = 'ENVIADO'`,
      this.prisma.$queryRaw<{ orders: bigint; revenue: string | null }[]>`
        SELECT count(*) AS orders, sum(t.total)::text AS revenue FROM (
          SELECT DISTINCT o.id, o.total FROM automation_runs r
          JOIN ecommerce_orders o ON o."leadId" = r."leadId" AND o."statusGroup" = 'pago'
            AND o."orderedAt" >= r."startedAt" AND o."orderedAt" <= r."startedAt" + make_interval(days => ${ATTRIBUTION_DAYS})
          WHERE r."automationId" = ${id}::uuid) t`,
      this.prisma.automationRun.findMany({
        where: { automationId: id },
        orderBy: { startedAt: 'desc' },
        take: 100,
        select: { id: true, status: true, stepId: true, nextRunAt: true, startedAt: true, finishedAt: true, exitReason: true, lead: { select: { id: true, name: true, email: true } } },
      }),
    ])
    const of = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0
    const steps: Record<string, Record<string, number>> = {}
    for (const b of byStep) (steps[b.stepId!] ??= {})[b.kind] = b._count._all
    return {
      entered: byStatus.reduce((n, b) => n + b._count._all, 0),
      running: of('ATIVO'),
      completed: of('CONCLUIDO'),
      exited: of('SAIU'),
      errors: of('ERRO'),
      emails: { sent: Number(emails[0]?.sent ?? 0), opened: Number(emails[0]?.opened ?? 0), clicked: Number(emails[0]?.clicked ?? 0) },
      sales: { orders: Number(sales[0]?.orders ?? 0), revenue: Number(sales[0]?.revenue ?? 0), days: ATTRIBUTION_DAYS },
      steps,
      runs,
    }
  }

  async runLogs(user: AuthUser, id: string, runId: string) {
    this.assertCan(user, 'view')
    const run = await this.prisma.automationRun.findFirst({ where: { id: runId, automationId: id, tenantId: user.tenantId }, select: { id: true } })
    if (!run) throw new NotFoundException('Passagem não encontrada.')
    return this.prisma.automationLog.findMany({ where: { runId }, orderBy: { createdAt: 'asc' }, select: { id: true, stepId: true, kind: true, message: true, createdAt: true } })
  }

  /** Fluxos de que o lead participa (tela do lead). */
  async forLead(user: AuthUser, leadId: string) {
    this.assertCan(user, 'view')
    return this.prisma.automationRun.findMany({
      where: { leadId, tenantId: user.tenantId },
      orderBy: { startedAt: 'desc' },
      take: 30,
      select: { id: true, status: true, startedAt: true, finishedAt: true, exitReason: true, automation: { select: { id: true, name: true } } },
    })
  }

  async options(user: AuthUser) {
    this.assertCan(user, 'view')
    const [templates, users, segments] = await Promise.all([
      this.prisma.emailCampaign.findMany({ where: { tenantId: user.tenantId, kind: 'MODELO' }, orderBy: { name: 'asc' }, select: { id: true, name: true, subject: true } }),
      this.prisma.user.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } }),
      this.prisma.emailSegment.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ])
    const campaigns = await this.prisma.emailCampaign.findMany({ where: { tenantId: user.tenantId, kind: 'CAMPANHA', status: { in: ['ENVIANDO', 'ENVIADA', 'PAUSADA'] } }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, name: true } })
    return { templates, users, segments, campaigns }
  }

  // ---------- Motor ----------

  /** A cada 20 s: novos acontecimentos fazem leads entrarem; depois roda os passos que venceram. */
  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      const autos = await this.prisma.automation.findMany({ where: { active: true } })
      const byTenant = new Map<string, Automation[]>()
      for (const a of autos) byTenant.set(a.tenantId, [...(byTenant.get(a.tenantId) ?? []), a])
      const tenants = new Set([...byTenant.keys(), ...(await this.tenantsWithActiveRuns())])
      for (const tenantId of tenants) await this.scan(tenantId, byTenant.get(tenantId) ?? [])
      const rates = new Map<string, number>()
      for (const tenantId of tenants) rates.set(tenantId, (await this.email.config(tenantId)).ratePerMinute || 60)
      this.emailBudget = Math.max(1, Math.ceil(Math.min(...[...rates.values(), 60]) / (60_000 / TICK_MS)))
      await this.runDue()
    } catch (err) {
      this.logger.error(`Automações: ${(err as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  private async tenantsWithActiveRuns() {
    const rows = await this.prisma.automationRun.findMany({ where: { status: 'ATIVO' }, distinct: ['tenantId'], select: { tenantId: true } })
    return rows.map((r) => r.tenantId)
  }

  private async cursors(tenantId: string): Promise<Cursors> {
    const now = { at: new Date().toISOString(), id: '00000000-0000-0000-0000-000000000000' }
    const c = await this.settings.get<Partial<Cursors>>(tenantId, 'automation_cursor', {})
    if (c.events && c.leads && c.records) return c as Cursors
    // Primeira vez: começa de agora (ligar as automações não processa o passado).
    const fresh = { events: now, leads: now, records: now, inactivityAt: null }
    await this.settings.set(tenantId, 'automation_cursor', fresh)
    return fresh
  }

  private after(c: Cursor): Prisma.LeadEventWhereInput {
    const at = new Date(c.at)
    return { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: c.id } }] }
  }

  private async scan(tenantId: string, autos: Automation[]) {
    const cur = await this.cursors(tenantId)
    const trig = (a: Automation) => a.trigger as unknown as Trigger
    const since = (a: Automation, at: Date) => !!a.activatedAt && at >= a.activatedAt

    // Acontecimentos do histórico do lead (formulário, carrinho, compra, e-mail...).
    const types = [...new Set([...Object.keys(EVENT_TRIGGERS), ...PURCHASE_EVENTS])]
    const events = await this.prisma.leadEvent.findMany({ where: { tenantId, type: { in: types }, ...this.after(cur.events) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500 })
    for (const e of events) {
      const data = (e.data ?? null) as Record<string, unknown> | null
      if (PURCHASE_EVENTS.includes(e.type)) await this.exitOnPurchase(e.leadId)
      for (const a of autos) {
        if (!since(a, e.createdAt) || data?.automacao === a.id || !eventMatches(trig(a), { type: e.type, title: e.title, data })) continue
        if (trig(a).type === 'etapa') {
          const lead = await this.prisma.lead.findUnique({ where: { id: e.leadId }, select: { stage: true } })
          if (lead?.stage !== trig(a).stage) continue
        }
        await this.enroll(a, e.leadId, { evento: e.title.slice(0, 200), ...(data?.carrinho ? { carrinho: data.carrinho } : {}) })
      }
    }
    if (events.length) cur.events = { at: events.at(-1)!.createdAt.toISOString(), id: events.at(-1)!.id }

    // Leads novos.
    const newLeadAutos = autos.filter((a) => trig(a).type === 'lead_novo')
    const leads = await this.prisma.lead.findMany({
      where: { tenantId, OR: [{ createdAt: { gt: new Date(cur.leads.at) } }, { createdAt: new Date(cur.leads.at), id: { gt: cur.leads.id } }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      select: { id: true, originId: true, createdAt: true },
    })
    if (newLeadAutos.length && leads.length) {
      const imported = new Set(
        (await this.prisma.leadEvent.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, type: 'importado' }, select: { leadId: true }, distinct: ['leadId'] })).map((x) => x.leadId),
      )
      for (const l of leads)
        for (const a of newLeadAutos) {
          const t = trig(a)
          if (!since(a, l.createdAt) || (t.originId && t.originId !== l.originId) || (!t.includeImported && imported.has(l.id))) continue
          await this.enroll(a, l.id, { evento: 'Lead novo' })
        }
    }
    if (leads.length) cur.leads = { at: leads.at(-1)!.createdAt.toISOString(), id: leads.at(-1)!.id }

    // Atendimentos que foram para o Pós-Vendas.
    const postAutos = autos.filter((a) => trig(a).type === 'pos_venda')
    const records = await this.prisma.serviceRecord.findMany({
      where: { tenantId, kind: 'POS_VENDAS', OR: [{ createdAt: { gt: new Date(cur.records.at) } }, { createdAt: new Date(cur.records.at), id: { gt: cur.records.id } }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      select: { id: true, leadId: true, createdAt: true },
    })
    for (const r of records) for (const a of postAutos) if (r.leadId && since(a, r.createdAt)) await this.enroll(a, r.leadId, { evento: 'Entrou no Pós-Vendas', atendimento: r.id })
    if (records.length) cur.records = { at: records.at(-1)!.createdAt.toISOString(), id: records.at(-1)!.id }

    // Inatividade (uma vez por hora).
    const idle = autos.filter((a) => trig(a).type === 'inatividade')
    if (idle.length && (!cur.inactivityAt || Date.now() - Date.parse(cur.inactivityAt) >= INACTIVITY_EVERY_MS)) {
      for (const a of idle) await this.scanInactivity(tenantId, a)
      cur.inactivityAt = new Date().toISOString()
    }
    await this.settings.set(tenantId, 'automation_cursor', cur)
  }

  /**
   * Leads que ficaram X dias sem acessar o site (ou sem nenhuma interação). Só entra quem passou do prazo
   * depois que o fluxo foi ligado, para não disparar para a base antiga inteira de uma vez.
   */
  private async scanInactivity(tenantId: string, a: Automation) {
    const t = a.trigger as unknown as Trigger
    const days = t.days ?? 30
    const types = t.kind === 'interacao' ? INTERACTION_EVENTS : ['visita']
    const cutoff = new Date(Date.now() - days * DAY)
    const floor = new Date((a.activatedAt ?? new Date()).getTime() - days * DAY)
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM leads l
      JOIN LATERAL (SELECT max(e."occurredAt") AS last FROM lead_events e WHERE e."leadId" = l.id AND e.type = ANY(${types})) x ON true
      WHERE l."tenantId" = ${tenantId}::uuid AND l."deletedAt" IS NULL AND l."anonymizedAt" IS NULL
        AND x.last IS NOT NULL AND x.last < ${cutoff} AND x.last >= ${floor}
        AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r."automationId" = ${a.id}::uuid AND r."leadId" = l.id AND r."startedAt" >= x.last)
      LIMIT 500`
    for (const r of rows) await this.enroll(a, r.id, { evento: t.kind === 'interacao' ? `${days} dias sem interação` : `${days} dias sem acessar o site` })
  }

  /** Lead entra no fluxo (se ainda não está nele e se as regras de reentrada deixam). */
  async enroll(a: Automation, leadId: string, context: Record<string, unknown>) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId: a.tenantId, deletedAt: null, anonymizedAt: null }, select: { id: true } })
    if (!lead) return false
    const last = await this.prisma.automationRun.findFirst({ where: { automationId: a.id, leadId }, orderBy: { startedAt: 'desc' }, select: { status: true, startedAt: true } })
    if (last?.status === 'ATIVO') return false
    // Reentrada: só se permitido e nunca duas vezes no mesmo dia (evita fluxo que dispara a si mesmo).
    if (last && (a.reentry !== 'apos_terminar' || Date.now() - last.startedAt.getTime() < DAY)) return false
    const first = (a.steps as unknown as Step[])[0]?.id ?? null
    const run = await this.prisma.automationRun.create({
      data: { tenantId: a.tenantId, automationId: a.id, leadId, stepId: first, nextRunAt: first ? new Date() : null, status: first ? 'ATIVO' : 'CONCLUIDO', finishedAt: first ? null : new Date(), context: context as Prisma.InputJsonValue },
    })
    await this.log(run, null, 'entrou', `Entrou no fluxo: ${String(context.evento ?? context.origem ?? 'gatilho')}.`)
    return true
  }

  private async exitOnPurchase(leadId: string) {
    const runs = await this.prisma.automationRun.findMany({ where: { leadId, status: 'ATIVO', automation: { exitOnPurchase: true } } })
    for (const r of runs) await this.finish(r, 'SAIU', 'Comprou (objetivo do fluxo atingido).')
  }

  private async finish(run: AutomationRun, status: 'CONCLUIDO' | 'SAIU' | 'ERRO', reason: string) {
    await this.prisma.automationRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), nextRunAt: null, exitReason: reason.slice(0, 300) } })
    await this.log(run, run.stepId, status === 'CONCLUIDO' ? 'concluiu' : status === 'ERRO' ? 'erro' : 'saiu', reason)
  }

  private log(run: Pick<AutomationRun, 'id' | 'automationId' | 'leadId'>, stepId: string | null, kind: string, message: string) {
    return this.prisma.automationLog.create({ data: { runId: run.id, automationId: run.automationId, leadId: run.leadId, stepId, kind, message: message.slice(0, 500) } })
  }

  private async runDue() {
    const runs = await this.prisma.automationRun.findMany({
      where: { status: 'ATIVO', nextRunAt: { lte: new Date() }, automation: { active: true } },
      orderBy: { nextRunAt: 'asc' },
      take: 200,
      include: { automation: true },
    })
    const maps = new Map<string, Map<string, Node>>()
    for (const run of runs) {
      const a = run.automation
      if (!maps.has(a.id)) maps.set(a.id, compile(a.steps as unknown as Step[]))
      try {
        await this.advance(run, a, maps.get(a.id)!)
      } catch (err) {
        this.logger.warn(`Automação ${a.id.slice(0, 8)}: ${(err as Error).message}`)
        await this.finish(run, 'ERRO', `Erro inesperado: ${(err as Error).message}`)
      }
    }
  }

  /** Anda pelo fluxo até uma espera, o fim ou o limite de passos por ciclo. */
  private async advance(run: AutomationRun, a: Automation, map: Map<string, Node>) {
    const ctx = { ...((run.context ?? {}) as RunCtx) }
    let stepId = run.stepId
    for (let guard = 0; stepId && guard < 25; guard++) {
      const node = map.get(stepId)
      if (!node) return this.finish(run, 'SAIU', 'O passo em que o lead estava foi removido do fluxo.')
      const s = node.step
      switch (s.type) {
        case 'esperar': {
          if (ctx.waiting !== s.id) {
            ctx.waiting = s.id
            const at = new Date(Date.now() + waitMs(s))
            await this.prisma.automationRun.update({ where: { id: run.id }, data: { stepId, nextRunAt: at, context: ctx as Prisma.InputJsonValue } })
            await this.log(run, s.id, 'passo', `Esperando ${s.amount} ${s.unit} (até ${at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}).`)
            return
          }
          delete ctx.waiting
          stepId = node.next
          break
        }
        case 'condicao': {
          const ok = await this.evaluate(s.match, s.rules, run, ctx)
          await this.log(run, s.id, ok ? 'sim' : 'nao', ok ? 'Condição atendida: seguiu pelo caminho "Sim".' : 'Condição não atendida: seguiu pelo caminho "Não".')
          stepId = branchStart(node, ok)
          break
        }
        case 'enviar_email': {
          if (this.emailBudget <= 0) {
            // Limite de envios por minuto: continua no próximo ciclo.
            await this.prisma.automationRun.update({ where: { id: run.id }, data: { stepId, nextRunAt: new Date(Date.now() + TICK_MS), context: ctx as Prisma.InputJsonValue } })
            return
          }
          this.emailBudget--
          const r = await this.email.sendAutomationEmail({ tenantId: run.tenantId, templateId: s.templateId, leadId: run.leadId, runId: run.id, automationId: a.id, automationName: a.name })
          if (r.status === 'tentar_depois') {
            await this.prisma.automationRun.update({ where: { id: run.id }, data: { stepId, nextRunAt: new Date(Date.now() + 5 * 60_000), context: ctx as Prisma.InputJsonValue } })
            await this.log(run, s.id, 'aviso', `${r.message} Nova tentativa em 5 minutos.`)
            return
          }
          if (r.recipientId) ctx.lastEmailRecipientId = r.recipientId
          await this.log(run, s.id, r.status === 'enviado' ? 'email' : r.status === 'pulado' ? 'pulado' : 'erro', r.message)
          stepId = node.next
          break
        }
        case 'encerrar':
          await this.saveCtx(run.id, ctx)
          return this.finish(run, 'CONCLUIDO', 'Fluxo encerrado pelo passo "Encerrar".')
        default:
          await this.action(s, run, a)
          stepId = node.next
      }
    }
    if (stepId) {
      await this.prisma.automationRun.update({ where: { id: run.id }, data: { stepId, nextRunAt: new Date(), context: ctx as Prisma.InputJsonValue } })
      return
    }
    await this.saveCtx(run.id, ctx)
    await this.finish(run, 'CONCLUIDO', 'Chegou ao fim do fluxo.')
  }

  private saveCtx(runId: string, ctx: RunCtx) {
    return this.prisma.automationRun.update({ where: { id: runId }, data: { context: ctx as Prisma.InputJsonValue } })
  }

  private async action(s: Step, run: AutomationRun, a: Automation) {
    const tag = { automacao: a.id }
    switch (s.type) {
      case 'adicionar_tag':
      case 'remover_tag': {
        await this.tracking.tagLead(run.leadId, s.type === 'adicionar_tag' ? s.tags : [], s.type === 'remover_tag' ? s.tags : [])
        await this.scoring.rescore(run.tenantId, [run.leadId])
        await this.log(run, s.id, 'passo', `${s.type === 'adicionar_tag' ? 'Tag adicionada' : 'Tag removida'}: ${s.tags.join(', ')}.`)
        return
      }
      case 'alterar_vendedor': {
        const seller = await this.prisma.seller.findFirst({ where: { id: s.ownerId, tenantId: run.tenantId }, select: { id: true, name: true, unitId: true } })
        if (!seller) return void (await this.log(run, s.id, 'erro', 'Vendedor não existe mais: passo ignorado.'))
        await this.prisma.lead.update({ where: { id: run.leadId }, data: { ownerId: seller.id, ...(seller.unitId ? { unitId: seller.unitId } : {}) } })
        await this.prisma.leadEvent.create({ data: { tenantId: run.tenantId, leadId: run.leadId, type: 'automacao', title: `Automação "${a.name}": vendedor trocado para ${seller.name}`.slice(0, 300), data: tag } })
        await this.log(run, s.id, 'passo', `Vendedor trocado para ${seller.name}.`)
        return
      }
      case 'alterar_etapa': {
        const lead = await this.prisma.lead.findUnique({ where: { id: run.leadId }, select: { stage: true } })
        if (lead?.stage === s.stage) return void (await this.log(run, s.id, 'passo', `Já estava na etapa ${STAGE_LABEL[s.stage]}.`))
        await this.prisma.lead.update({ where: { id: run.leadId }, data: { stage: s.stage as never } })
        await this.prisma.leadEvent.create({ data: { tenantId: run.tenantId, leadId: run.leadId, type: 'estagio', title: `Estágio: ${STAGE_LABEL[lead?.stage ?? 'LEAD']} → ${STAGE_LABEL[s.stage]} (automação "${a.name}")`.slice(0, 300), data: tag } })
        await this.log(run, s.id, 'passo', `Etapa alterada para ${STAGE_LABEL[s.stage]}.`)
        return
      }
      case 'criar_atendimento': {
        const id = await this.preVendas(run, a, s.ownerId, s.note)
        await this.log(run, s.id, 'passo', id ? 'Atendimento criado na fila de Pré-Vendas.' : 'Já havia um atendimento de Pré-Vendas aberto nas últimas 24 horas.')
        return
      }
      case 'notificar': {
        const [users, lead, smtp] = await Promise.all([
          this.prisma.user.findMany({ where: { id: { in: s.userIds }, tenantId: run.tenantId, active: true }, select: { email: true } }),
          this.prisma.lead.findUnique({ where: { id: run.leadId }, select: { name: true, email: true, phone: true } }),
          this.settings.smtp(run.tenantId),
        ])
        if (!users.length || !smtp.host) return void (await this.log(run, s.id, 'erro', !smtp.host ? 'Servidor de e-mail não configurado: aviso não enviado.' : 'Nenhum usuário ativo para avisar.'))
        const link = `${env.appUrl}/leads/${run.leadId}`
        const text = fillMessage(s.message, { name: lead?.name ?? null, email: lead?.email ?? null, phone: lead?.phone ?? null, link, automation: a.name })
        const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
        await this.mail.sendWith(smtp, {
          to: users.map((u) => u.email).join(', '),
          subject: `[Automação] ${a.name}: ${lead?.name ?? lead?.email ?? 'lead'}`.slice(0, 200),
          text: `${text}\n\nAbrir o lead: ${link}`,
          html: `<p>${esc(text).replace(/\n/g, '<br>')}</p><p><a href="${esc(link)}">Abrir o lead no CRM</a></p>`,
        })
        await this.log(run, s.id, 'passo', `Aviso enviado para ${users.length} pessoa(s) da equipe.`)
        return
      }
    }
  }

  /** Abre um atendimento de Pré-Vendas para o lead (sem duplicar se já há um aberto nas últimas 24 h). */
  private async preVendas(run: AutomationRun, a: Automation, ownerId: string | null, note: string) {
    const recent = await this.prisma.serviceRecord.findFirst({ where: { tenantId: run.tenantId, leadId: run.leadId, kind: 'PRE_VENDAS', deletedAt: null, createdAt: { gte: new Date(Date.now() - DAY) } }, select: { id: true } })
    if (recent) return null
    const lead = await this.prisma.lead.findUnique({ where: { id: run.leadId }, select: { name: true, email: true, phone: true, state: true, city: true, ownerId: true, unitId: true } })
    if (!lead) return null
    const sellerId = ownerId ?? lead.ownerId
    const seller = sellerId ? await this.prisma.seller.findFirst({ where: { id: sellerId, tenantId: run.tenantId }, select: { id: true, unitId: true } }) : null
    const origin =
      (await this.prisma.lookupItem.findFirst({ where: { tenantId: run.tenantId, type: 'ORIGEM', name: { equals: 'Automação', mode: 'insensitive' } }, select: { id: true } })) ??
      (await this.prisma.lookupItem.create({ data: { tenantId: run.tenantId, type: 'ORIGEM', name: 'Automação' }, select: { id: true } }))
    const record = await this.prisma.serviceRecord.create({
      data: {
        tenantId: run.tenantId,
        kind: 'PRE_VENDAS',
        leadAt: new Date(),
        name: (lead.name ?? lead.email ?? 'Lead da automação').slice(0, 160),
        phone: lead.phone,
        email: lead.email,
        state: lead.state,
        city: lead.city,
        sellerId: seller?.id ?? null,
        unitId: seller?.unitId ?? lead.unitId ?? null,
        originId: origin.id,
        leadId: run.leadId,
        notes: [`Criado pela automação "${a.name}".`, note || null].filter(Boolean).join('\n').slice(0, 5000),
        history: { create: { userName: `Automação "${a.name}"`.slice(0, 120), action: 'criado automaticamente', changes: {} } },
      },
    })
    await this.prisma.leadEvent.create({ data: { tenantId: run.tenantId, leadId: run.leadId, type: 'atendimento', title: `Atendimento de Pré-Vendas (automação "${a.name}")`.slice(0, 300), data: { recordId: record.id, automacao: a.id } } })
    await this.scoring.rescore(run.tenantId, [run.leadId])
    return record.id
  }

  // ---------- Condições ----------

  private async evaluate(match: 'todas' | 'qualquer', rules: Rule[], run: AutomationRun, ctx: RunCtx) {
    for (const r of rules) {
      const ok = (await this.check(r, run, ctx)) !== !!r.negate
      if (match === 'qualquer' && ok) return true
      if (match === 'todas' && !ok) return false
    }
    return match === 'todas'
  }

  private async lastEvent(leadId: string, types: string[], since: Date) {
    return this.prisma.leadEvent.findFirst({ where: { leadId, type: { in: types }, occurredAt: { gte: since } }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } })
  }

  private async check(r: Rule, run: AutomationRun, ctx: RunCtx): Promise<boolean> {
    const since = new Date(Date.now() - (r.days ?? 30) * DAY)
    const leadId = run.leadId
    switch (r.type) {
      case 'carrinho_abandonado':
      case 'checkout_sem_compra': {
        const ev = await this.lastEvent(leadId, [r.type === 'carrinho_abandonado' ? 'carrinho_abandonado' : 'checkout'], since)
        if (!ev) return false
        return !(await this.lastEvent(leadId, PURCHASE_EVENTS, ev.occurredAt))
      }
      case 'comprou':
        return !!(await this.lastEvent(leadId, PURCHASE_EVENTS, since))
      case 'sem_visita':
        return !(await this.lastEvent(leadId, ['visita'], since))
      case 'sem_interacao':
        return !(await this.lastEvent(leadId, INTERACTION_EVENTS, since))
      case 'abriu_email':
      case 'clicou_email': {
        const field = r.type === 'abriu_email' ? 'openedAt' : 'clickedAt'
        if (r.scope !== 'qualquer') {
          if (!ctx.lastEmailRecipientId) return false
          const rec = await this.prisma.emailRecipient.findUnique({ where: { id: ctx.lastEmailRecipientId }, select: { openedAt: true, clickedAt: true } })
          return !!rec?.[field]
        }
        return !!(await this.lastEvent(leadId, r.type === 'abriu_email' ? ['email_aberto', 'email_clique'] : ['email_clique'], since))
      }
    }
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { tags: true, stage: true, scoreGrade: true, originId: true, ownerId: true, phone: true, email: true, emailOptIn: true, emailBouncedAt: true } })
    if (!lead) return false
    switch (r.type) {
      case 'tem_tag':
        return lead.tags.includes(r.tag!)
      case 'etapa':
        return lead.stage === r.stage
      case 'nota':
        return !!lead.scoreGrade && (r.grades ?? []).includes(lead.scoreGrade)
      case 'origem':
        return lead.originId === r.originId
      case 'vendedor':
        return r.ownerId === 'nenhum' ? !lead.ownerId : r.ownerId ? lead.ownerId === r.ownerId : !!lead.ownerId
      case 'tem_telefone':
        return !!lead.phone
      case 'aceita_email':
        return !!lead.email && lead.emailOptIn && !lead.emailBouncedAt
    }
    return false
  }
}
