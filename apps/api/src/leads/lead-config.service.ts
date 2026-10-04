import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { CustomFieldType, Prisma, ScoreDimension } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { computeScore, DEFAULT_RULES, DEFAULT_SCORE_SETTINGS, type ScoreSettings } from './scoring'

const RESCORE_INTERVAL_MS = 6 * 60 * 60 * 1000

function slug(label: string) {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
}

@Injectable()
export class LeadConfigService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LeadConfigService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap() {
    for (const t of await this.prisma.tenant.findMany({ select: { id: true } })) await this.ensureDefaultRules(t.id)
    // O interesse "decai" com o tempo: recalcula periodicamente mesmo sem novos eventos.
    this.timer = setInterval(() => void this.rescoreAllTenants(), RESCORE_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async ensureDefaultRules(tenantId: string) {
    if ((await this.prisma.scoreRule.count({ where: { tenantId } })) > 0) return
    await this.prisma.scoreRule.createMany({
      data: DEFAULT_RULES.map((r) => ({ tenantId, dimension: r.dimension, name: r.name, field: r.field, operator: r.operator, value: r.value as Prisma.InputJsonValue, points: r.points })),
    })
  }

  scoreSettings(tenantId: string) {
    return this.settings.get(tenantId, 'lead_scoring', DEFAULT_SCORE_SETTINGS)
  }

  // ---------- Lead scoring ----------

  /** Recalcula a nota dos leads informados (ou de todos do tenant). */
  async rescore(tenantId: string, leadIds?: string[]) {
    const [rules, settings] = await Promise.all([this.prisma.scoreRule.findMany({ where: { tenantId } }), this.scoreSettings(tenantId)])
    const since = new Date(Date.now() - settings.interestWindowDays * 86_400_000)
    const where: Prisma.LeadWhereInput = { tenantId, deletedAt: null, anonymizedAt: null, ...(leadIds ? { id: { in: leadIds } } : {}) }
    let cursor: string | undefined
    let total = 0
    for (;;) {
      const leads = await this.prisma.lead.findMany({
        where,
        take: 1000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, stage: true, state: true, phone: true, email: true, tags: true, customFields: true, scoreProfile: true, scoreInterest: true, scoreGrade: true },
      })
      if (!leads.length) break
      const events = await this.prisma.leadEvent.findMany({
        where: { leadId: { in: leads.map((l) => l.id) }, occurredAt: { gte: since } },
        select: { leadId: true, type: true, occurredAt: true },
      })
      const byLead = new Map<string, { type: string; occurredAt: Date }[]>()
      for (const e of events) byLead.set(e.leadId, [...(byLead.get(e.leadId) ?? []), e])
      const updates: Prisma.LeadUpdateArgs[] = []
      for (const l of leads) {
        const s = computeScore({ ...l, customFields: (l.customFields as Record<string, unknown>) ?? {} }, byLead.get(l.id) ?? [], rules, settings)
        if (s.profile !== l.scoreProfile || s.interest !== l.scoreInterest || s.grade !== l.scoreGrade) {
          updates.push({ where: { id: l.id }, data: { scoreProfile: s.profile, scoreInterest: s.interest, scoreGrade: s.grade, scoreUpdatedAt: new Date() } })
        }
      }
      // Uma consulta por lead dentro da transação: o formato é sempre o mesmo e o Prisma reaproveita o plano
      // (lotes em array geravam um plano novo a cada tamanho de lote).
      for (let i = 0; i < updates.length; i += 200) {
        const slice = updates.slice(i, i + 200)
        await this.prisma.$transaction(async (tx) => {
          for (const u of slice) await tx.lead.update(u)
        })
      }
      total += leads.length
      cursor = leads[leads.length - 1]!.id
    }
    return total
  }

  private async rescoreAllTenants() {
    try {
      for (const t of await this.prisma.tenant.findMany({ select: { id: true } })) await this.rescore(t.id)
    } catch (err) {
      this.logger.error(`Recálculo periódico do lead scoring falhou: ${(err as Error).message}`)
    }
  }

  listRules(tenantId: string) {
    return this.prisma.scoreRule.findMany({ where: { tenantId }, orderBy: [{ dimension: 'asc' }, { points: 'desc' }] })
  }

  async saveRule(
    actor: AuthUser,
    id: string | null,
    d: { dimension: ScoreDimension; name: string; field: string; operator: string; value?: unknown; points: number; active?: boolean },
    ctx: RequestCtx,
  ) {
    const data = { dimension: d.dimension, name: d.name.trim(), field: d.field, operator: d.operator, value: (d.value ?? null) as Prisma.InputJsonValue, points: d.points, active: d.active ?? true }
    const rule = id
      ? await this.prisma.scoreRule.update({ where: { id: (await this.ruleOf(actor.tenantId, id)).id }, data })
      : await this.prisma.scoreRule.create({ data: { tenantId: actor.tenantId, ...data } })
    await this.audit.byUser(actor, ctx, id ? 'lead_scoring.rule_updated' : 'lead_scoring.rule_created', 'score_rule', rule.id, { ...data })
    void this.rescore(actor.tenantId)
    return rule
  }

  async removeRule(actor: AuthUser, id: string, ctx: RequestCtx) {
    await this.ruleOf(actor.tenantId, id)
    await this.prisma.scoreRule.delete({ where: { id } })
    await this.audit.byUser(actor, ctx, 'lead_scoring.rule_deleted', 'score_rule', id)
    void this.rescore(actor.tenantId)
  }

  private async ruleOf(tenantId: string, id: string) {
    const r = await this.prisma.scoreRule.findFirst({ where: { id, tenantId } })
    if (!r) throw new NotFoundException('Regra não encontrada.')
    return r
  }

  async saveScoreSettings(actor: AuthUser, s: ScoreSettings, ctx: RequestCtx) {
    if (!(s.gradeA > s.gradeB && s.gradeB > s.gradeC)) throw new BadRequestException('As faixas precisam ser A > B > C.')
    await this.settings.set(actor.tenantId, 'lead_scoring', s)
    await this.audit.byUser(actor, ctx, 'lead_scoring.settings_updated', 'settings', 'lead_scoring', { ...s })
    void this.rescore(actor.tenantId)
    return s
  }

  // ---------- Campos personalizados ----------

  listFields(tenantId: string) {
    return this.prisma.customFieldDef.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { label: 'asc' }] })
  }

  async saveField(actor: AuthUser, id: string | null, d: { label: string; type: CustomFieldType; options?: string[]; active?: boolean; position?: number }, ctx: RequestCtx) {
    const options = [...new Set((d.options ?? []).map((o) => o.trim()).filter(Boolean))]
    if ((d.type === 'SELECT' || d.type === 'MULTISELECT') && options.length === 0) throw new BadRequestException('Informe as opções da lista.')
    if (id) {
      const current = await this.prisma.customFieldDef.findFirst({ where: { id, tenantId: actor.tenantId } })
      if (!current) throw new NotFoundException('Campo não encontrado.')
      // O tipo não muda depois de criado: os valores já gravados poderiam ficar inválidos.
      const field = await this.prisma.customFieldDef.update({ where: { id }, data: { label: d.label.trim(), options, active: d.active, position: d.position } })
      await this.audit.byUser(actor, ctx, 'lead_field.updated', 'custom_field', id, { label: d.label, options })
      return field
    }
    const key = slug(d.label)
    if (!key) throw new BadRequestException('Nome do campo inválido.')
    if (await this.prisma.customFieldDef.findUnique({ where: { tenantId_key: { tenantId: actor.tenantId, key } } })) {
      throw new ConflictException('Já existe um campo com esse nome.')
    }
    const field = await this.prisma.customFieldDef.create({ data: { tenantId: actor.tenantId, key, label: d.label.trim(), type: d.type, options, position: d.position ?? 0 } })
    await this.audit.byUser(actor, ctx, 'lead_field.created', 'custom_field', field.id, { key, type: d.type })
    return field
  }

  // ---------- Tags ----------

  async listTags(tenantId: string) {
    const rows = await this.prisma.$queryRaw<{ tag: string; total: bigint }[]>`
      SELECT unnest(tags) AS tag, count(*) AS total FROM leads
      WHERE "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC, 1`
    return rows.map((r) => ({ tag: r.tag, total: Number(r.total) }))
  }

  /** Renomeia ou junta tags (renomear para uma existente junta as duas). Sem "to", remove a tag de todos os leads. */
  async renameTag(actor: AuthUser, from: string, to: string | null, ctx: RequestCtx) {
    const src = from.trim().toLowerCase()
    const dst = to?.trim().toLowerCase() || null
    const count = dst
      ? await this.prisma.$executeRaw`
          UPDATE leads SET tags = array(SELECT DISTINCT unnest(array_replace(tags, ${src}, ${dst}))), "updatedAt" = now()
          WHERE "tenantId" = ${actor.tenantId}::uuid AND ${src} = ANY(tags)`
      : await this.prisma.$executeRaw`
          UPDATE leads SET tags = array_remove(tags, ${src}), "updatedAt" = now()
          WHERE "tenantId" = ${actor.tenantId}::uuid AND ${src} = ANY(tags)`
    await this.audit.byUser(actor, ctx, dst ? 'lead_tag.renamed' : 'lead_tag.removed', 'tag', src, { para: dst, leads: count })
    void this.rescore(actor.tenantId)
    return { affected: count }
  }
}
