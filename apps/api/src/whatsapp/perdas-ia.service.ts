import Anthropic from '@anthropic-ai/sdk'
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { IsIn, IsOptional, Matches } from 'class-validator'
import { SECRET_KEY } from '../assistente/constantes'
import { AuditService } from '../audit/audit.service'
import { buildLossPayload, LOSS_AI_MAX, LOSS_AI_MODEL_LABEL, LOSS_AI_MODELS, LOSS_AI_SCHEMA, LOSS_AI_SYSTEM, lossAiCost, lossAiWhatsapp, type LossAiModel, type LossInput, type LossReportResult, restoreLossReport } from '../atendimento/perdas-ia'
import { decrypt } from '../common/crypto'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'

const CONFIG_KEY = 'perdas_ia'
/** Relatório parado em "gerando" por mais que isso (ex.: o servidor reiniciou no meio): vira erro. */
const STALE_MS = 20 * 60_000
const KEEP = 30

interface LossAiConfig {
  model: LossAiModel
}

const day = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

/**
 * Análise das perdas com IA. Usa o Claude (a mesma chave da Anthropic do Assistente ML) só para isto; o resto do CRM
 * continua no Gemini gratuito. Lê o motivo e as observações das pré-vendas perdidas no período e guarda o relatório.
 */
@Injectable()
export class PerdasIaService {
  private readonly logger = new Logger('PerdasIa')

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Só gestores: quem cuida dos relatórios (Marketing › Relatórios) ou das configurações do atendimento. */
  private assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'mi_relatorios', action) && !can(user.permissions, user.role.isSystem, 'cadastros', action)) throw new ForbiddenException('Seu perfil não pode ver a análise das perdas.')
  }

  async config(tenantId: string): Promise<LossAiConfig> {
    const c = await this.settings.get<Partial<LossAiConfig>>(tenantId, CONFIG_KEY, {})
    return { model: (LOSS_AI_MODELS as readonly string[]).includes(c.model ?? '') ? c.model! : 'claude-opus-5-5' }
  }

  private async apiKey(tenantId: string) {
    const r = await this.settings.get<{ enc?: string }>(tenantId, SECRET_KEY('claude'), {})
    if (!r.enc) return null
    try {
      return decrypt(r.enc)
    } catch {
      return null
    }
  }

  async view(user: AuthUser) {
    this.assertCan(user, 'view')
    const [config, key, rows] = await Promise.all([
      this.config(user.tenantId),
      this.apiKey(user.tenantId),
      this.prisma.lossAiReport.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: KEEP, select: { id: true, label: true, from: true, to: true, cycleKey: true, status: true, error: true, model: true, total: true, omitted: true, inputTokens: true, outputTokens: true, createdBy: true, createdAt: true, finishedAt: true } }),
    ])
    return {
      config,
      keyConfigured: !!key,
      models: LOSS_AI_MODELS.map((m) => ({ id: m, label: LOSS_AI_MODEL_LABEL[m] })),
      max: LOSS_AI_MAX,
      reports: rows.map((r) => ({ ...this.fixStale(r), cost: lossAiCost(r.model, r.inputTokens, r.outputTokens) })),
    }
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const r = await this.prisma.lossAiReport.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!r) throw new NotFoundException('Relatório não encontrado.')
    return { ...this.fixStale(r), cost: lossAiCost(r.model, r.inputTokens, r.outputTokens), result: r.result as LossReportResult | null }
  }

  private fixStale<T extends { status: string; error: string | null; createdAt: Date }>(r: T): T {
    return r.status === 'GERANDO' && Date.now() - r.createdAt.getTime() > STALE_MS ? { ...r, status: 'ERRO', error: 'A geração foi interrompida. Gere de novo.' } : r
  }

  async saveConfig(user: AuthUser, d: { model?: string }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    if (!(LOSS_AI_MODELS as readonly string[]).includes(d.model ?? '')) throw new BadRequestException('Modelo inválido.')
    await this.settings.set(user.tenantId, CONFIG_KEY, { model: d.model })
    await this.audit.byUser(user, ctx, 'relatorios.perdas_ia_config', 'settings', CONFIG_KEY, { modelo: d.model })
    return this.config(user.tenantId)
  }

  /** Gera à mão (período de/até). Roda em segundo plano; a tela acompanha pelo status. */
  async start(user: AuthUser, d: { from: string; to: string }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const from = new Date(`${d.from}T00:00:00-03:00`)
    const to = new Date(`${d.to}T00:00:00-03:00`)
    to.setUTCDate(to.getUTCDate() + 1)
    if (!(from < to)) throw new BadRequestException('Período inválido.')
    if (to.getTime() - from.getTime() > 92 * 86_400_000) throw new BadRequestException('Escolha um período de até 3 meses.')
    if (!(await this.apiKey(user.tenantId))) throw new BadRequestException('Falta a chave da Anthropic (Claude). Cadastre em Assistente ML › Configurações › Chaves de IA.')
    const busy = await this.prisma.lossAiReport.findFirst({ where: { tenantId: user.tenantId, status: 'GERANDO', createdAt: { gt: new Date(Date.now() - STALE_MS) } } })
    if (busy) throw new BadRequestException('Já tem uma análise sendo gerada. Aguarde terminar.')
    const label = `${day(from)} a ${day(new Date(to.getTime() - 1))}`
    const row = await this.create(user.tenantId, { from, to, label, cycleKey: null }, { id: user.id, name: user.name })
    await this.audit.byUser(user, ctx, 'relatorios.perdas_ia_gerar', 'loss_ai_report', row.id, { periodo: label, modelo: row.model })
    void this.run(row.id)
    return row
  }

  private async create(tenantId: string, p: { from: Date; to: Date; label: string; cycleKey: string | null }, by: { id: string | null; name: string }) {
    const { model } = await this.config(tenantId)
    return this.prisma.lossAiReport.create({ data: { tenantId, from: p.from, to: p.to, label: p.label, cycleKey: p.cycleKey, model, createdById: by.id, createdBy: by.name } })
  }

  /**
   * Resumo semanal dos gestores: a análise do ciclo. 'wait' enquanto gera (a mensagem sai no minuto seguinte em que
   * ficar pronta); o texto pronto (ou o aviso de erro) quando acabou. Gera uma vez por ciclo.
   */
  async forCycle(tenantId: string, cycle: { key: string; from: Date; to: Date; label: string }): Promise<string | 'wait'> {
    let row = await this.prisma.lossAiReport.findFirst({ where: { tenantId, cycleKey: cycle.key }, orderBy: { createdAt: 'desc' } })
    if (!row) {
      if (!(await this.apiKey(tenantId))) return '🤖 Análise das perdas com IA: falta a chave da Anthropic (Claude) em Assistente ML › Configurações.'
      row = await this.create(tenantId, { from: cycle.from, to: cycle.to, label: cycle.label, cycleKey: cycle.key }, { id: null, name: 'Resumo semanal' })
      void this.run(row.id)
      return 'wait'
    }
    const r = this.fixStale(row)
    if (r.status === 'GERANDO') return 'wait'
    if (r.status === 'ERRO') return `🤖 Análise das perdas com IA não saiu: ${r.error ?? 'erro'}. Gere de novo em Marketing › Relatórios e alertas › Análise das perdas.`
    if (!r.total) return '🤖 Análise das perdas com IA: nenhuma perda registrada no período.'
    return lossAiWhatsapp(r.result as unknown as LossReportResult, r.total, r.omitted)
  }

  /** Perdas do período: pré-vendas marcadas como "não vendeu" (pela data do resultado), as mais recentes primeiro. */
  private async losses(tenantId: string, from: Date, to: Date) {
    const where = { tenantId, kind: 'PRE_VENDAS' as const, saleStatus: 'NAO' as const, deletedAt: null, resultAt: { gte: from, lt: to } }
    const [total, rows] = await Promise.all([
      this.prisma.serviceRecord.count({ where }),
      this.prisma.serviceRecord.findMany({
        where,
        orderBy: { resultAt: 'desc' },
        take: LOSS_AI_MAX,
        select: { id: true, name: true, forwarded: true, notes: true, brandIds: true, partTypeIds: true, resultAt: true, leadAt: true, createdById: true, seller: { select: { name: true } }, lostReason: { select: { name: true } }, origin: { select: { name: true } } },
      }),
    ])
    const lookupIds = [...new Set(rows.flatMap((r) => [...r.brandIds, ...r.partTypeIds]))]
    const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))]
    const [lookups, users] = await Promise.all([
      lookupIds.length ? this.prisma.lookupItem.findMany({ where: { id: { in: lookupIds } }, select: { id: true, name: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    ])
    const look = new Map(lookups.map((l) => [l.id, l.name]))
    const who = new Map(users.map((u) => [u.id, u.name]))
    const items: LossInput[] = rows.map((r) => ({
      id: r.id,
      client: r.name,
      person: r.forwarded && r.seller ? r.seller.name : r.createdById ? (who.get(r.createdById) ?? null) : null,
      stage: r.forwarded ? 'vendedor' : 'pre_venda',
      reason: r.lostReason?.name ?? null,
      notes: r.notes,
      brands: r.brandIds.map((x) => look.get(x)).filter((x): x is string => !!x),
      partTypes: r.partTypeIds.map((x) => look.get(x)).filter((x): x is string => !!x),
      origin: r.origin?.name ?? null,
      date: iso(r.resultAt ?? r.leadAt),
    }))
    return { total, items }
  }

  private async run(id: string) {
    const row = await this.prisma.lossAiReport.findUnique({ where: { id } })
    if (!row) return
    const fail = (error: string) => this.prisma.lossAiReport.update({ where: { id }, data: { status: 'ERRO', error: error.slice(0, 500), finishedAt: new Date() } })
    try {
      const { total, items } = await this.losses(row.tenantId, row.from, row.to)
      if (!items.length) {
        const empty: LossReportResult = { summary: 'Nenhuma perda registrada no período.', causes: [], codes: [], decisions: [], people: [], records: '', items: [] }
        await this.prisma.lossAiReport.update({ where: { id }, data: { status: 'PRONTO', total: 0, result: empty as unknown as Prisma.InputJsonValue, finishedAt: new Date() } })
        return
      }
      const apiKey = await this.apiKey(row.tenantId)
      if (!apiKey) return void (await fail('Falta a chave da Anthropic (Claude) em Assistente ML › Configurações.'))
      const payload = buildLossPayload(items)
      const { raw, input, output } = await this.callClaude(apiKey, row.model, payload.content)
      const result = restoreLossReport(raw, payload)
      await this.prisma.lossAiReport.update({ where: { id }, data: { status: 'PRONTO', error: null, total, omitted: Math.max(0, total - items.length), inputTokens: input, outputTokens: output, result: result as unknown as Prisma.InputJsonValue, finishedAt: new Date() } })
    } catch (err) {
      this.logger.warn(`Análise das perdas ${id}: ${(err as Error).message}`)
      await fail(this.errorText(err)).catch(() => undefined)
    }
  }

  private errorText(e: unknown) {
    if (e instanceof Anthropic.AuthenticationError) return 'Chave da Anthropic inválida ou revogada.'
    if (e instanceof Anthropic.PermissionDeniedError) return 'A chave da Anthropic não tem permissão.'
    if (e instanceof Anthropic.RateLimitError) return 'Limite de uso da Anthropic atingido (ou saldo esgotado). Tente mais tarde.'
    if (e instanceof Anthropic.BadRequestError) return `A Anthropic recusou o pedido: ${e.message}`
    if (e instanceof Anthropic.APIConnectionError) return 'Sem conexão com a Anthropic.'
    if (e instanceof Anthropic.APIError) return `Erro na Anthropic (${e.status ?? 'rede'}).`
    return (e as Error).message || 'Erro desconhecido.'
  }

  /** Uma chamada ao Claude com saída em JSON (formato fixo). Opus e Sonnet com o fallback do servidor em caso de recusa. */
  private async callClaude(apiKey: string, model: string, content: string) {
    const client = new Anthropic({ apiKey, timeout: 15 * 60_000 })
    const base = {
      model,
      max_tokens: 64000,
      system: LOSS_AI_SYSTEM,
      messages: [{ role: 'user' as const, content: `Perdas do período (JSON):\n${content}` }],
      output_config: { effort: 'medium' as const, format: { type: 'json_schema' as const, schema: LOSS_AI_SCHEMA as unknown as Record<string, unknown> } },
    }
    const msg = model.startsWith('claude-haiku')
      ? await client.messages.stream(base).finalMessage()
      : await client.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
    if (msg.stop_reason === 'refusal') throw new Error('A IA recusou-se a analisar estes dados.')
    if (msg.stop_reason === 'max_tokens') throw new Error('A resposta da IA passou do tamanho máximo. Escolha um período menor.')
    const blocks = msg.content as { type: string; text?: string }[]
    const text = blocks.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('')
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('A IA devolveu um formato inválido. Gere de novo.')
    }
    return { raw, input: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0), output: msg.usage.output_tokens }
  }
}

class LossAiStartDto {
  @ApiProperty({ example: '2026-11-06' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string
  @ApiProperty({ example: '2026-11-12' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string
}

class LossAiConfigDto {
  @ApiPropertyOptional({ enum: LOSS_AI_MODELS }) @IsOptional() @IsIn(LOSS_AI_MODELS) model?: string
}

/** Análise das perdas com IA, em Marketing › Relatórios e alertas (só gestores). */
@ApiTags('Relatórios')
@Controller('relatorios/perdas-ia')
export class PerdasIaController {
  constructor(private readonly svc: PerdasIaService) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.svc.view(user)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id)
  }

  @Post()
  start(@CurrentUser() user: AuthUser, @Body() dto: LossAiStartDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.start(user, dto, ctx)
  }

  @Put('config')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: LossAiConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.saveConfig(user, dto, ctx)
  }
}
