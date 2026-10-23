import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import { AuditService } from '../audit/audit.service'
import { normalizePhone } from '../atendimento/br'
import { cleanWeekly, loadWeekly, managerMessage, type SellerWeekly, weeklyGapMs, WEEKLY_SECTIONS, type WeeklySection, weeklyCycle, weeklyFor } from '../atendimento/semanal'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { ChatService } from './chat.service'

const TICK_MS = 60_000
const LABEL = 'Resumo do vendedor (semanal, automático)'
export const WEEKLY_KEY = 'seller_weekly'
export const WEEKLY_LOG_KEY = 'seller_weekly_log'

/** O que já saiu no ciclo: vendedor -> ENVIADA, SEM_TELEFONE ou ERRO: motivo. */
export interface WeeklyLog {
  cycle?: string
  at?: string
  /** Próxima mensagem só a partir daqui (intervalo sorteado entre os envios). */
  nextAt?: string
  sellers?: Record<string, string>
}

/**
 * Resumo do vendedor (semanal): toda sexta, a partir do horário configurado (Marketing › Relatórios e alertas), cada
 * vendedor que recebeu clientes da pré-venda repassados de sexta a quinta recebe no WhatsApp do cadastro dele os leads
 * repassados, as vendas, a conversão e sugestões de melhoria. Uma vez por ciclo.
 */
@Injectable()
export class RelatorioSemanalService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('RelatorioSemanal')
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  /** Quem cuida dos relatórios (Marketing › Relatórios) ou das configurações do atendimento. */
  private assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'mi_relatorios', action) && !can(user.permissions, user.role.isSystem, 'cadastros', action)) throw new ForbiddenException('Seu perfil não pode ver nem alterar o resumo dos vendedores.')
  }

  async config(tenantId: string) {
    return cleanWeekly(await this.settings.get<Partial<SellerWeekly>>(tenantId, WEEKLY_KEY, {}))
  }

  /** Configuração, prévia do ciclo (a mensagem de cada vendedor) e o resultado do último envio. */
  async view(user: AuthUser, ref?: string) {
    this.assertCan(user, 'view')
    const config = await this.config(user.tenantId)
    const cycle = weeklyCycle(config.time, ref ? new Date(`${ref}T12:00:00-03:00`) : new Date())
    const [reports, log, numbers, sellers] = await Promise.all([
      loadWeekly(this.prisma, user.tenantId, cycle, config.sections),
      this.settings.get<WeeklyLog>(user.tenantId, WEEKLY_LOG_KEY, {}),
      this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, status: true } }),
      this.prisma.seller.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, phone: true, active: true } }),
    ])
    return {
      config,
      sections: WEEKLY_SECTIONS,
      cycle: { key: cycle.key, label: cycle.label },
      numbers,
      sellers: sellers.map((s) => ({ id: s.id, name: s.name, hasPhone: !!(s.phone && normalizePhone(s.phone)), active: s.active })),
      lastRun: log.cycle ? { cycle: log.cycle, at: log.at ?? null, sellers: log.sellers ?? {} } : null,
      // Prévia do que o gestor recebe (os vendedores do envio, com ou sem telefone).
      manager: {
        message: managerMessage(cycle.label, this.scope(config, reports).map((r) => ({ seller: r.seller.name, stats: r.stats })), config.sections),
        status: log.cycle === cycle.key ? Object.fromEntries(config.managerPhones.map((ph) => [ph, log.sellers?.[`gestor:${ph}`] ?? null])) : {},
      },
      reports: reports.map((r) => ({
        sellerId: r.seller.id,
        seller: r.seller.name,
        hasPhone: !!(r.seller.phone && normalizePhone(r.seller.phone)),
        forwarded: r.stats.forwarded,
        sales: r.stats.sales,
        conversion: r.stats.conversion,
        message: r.message,
        status: log.cycle === cycle.key ? (log.sellers?.[r.seller.id] ?? null) : null,
        automatic: weeklyFor(config, r.seller.id) && r.seller.active,
      })),
    }
  }

  async save(user: AuthUser, d: Partial<SellerWeekly>, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const next = cleanWeekly(d)
    if (next.numberId && !(await this.prisma.whatsappNumber.count({ where: { id: next.numberId, tenantId: user.tenantId, deletedAt: null } }))) throw new BadRequestException('Número de WhatsApp inválido.')
    if (next.sellerIds.length && (await this.prisma.seller.count({ where: { tenantId: user.tenantId, id: { in: next.sellerIds } } })) !== next.sellerIds.length) throw new BadRequestException('Vendedor inválido.')
    if (!next.allSellers && !next.sellerIds.length) throw new BadRequestException('Escolha ao menos um vendedor.')
    const bad = (d.managerPhones ?? []).find((x) => String(x).trim() && !normalizePhone(String(x)))
    if (bad) throw new BadRequestException(`Número do gestor inválido: ${bad}. Use DDD + número (ex.: 47 99999-8888).`)
    if (!Array.isArray(d.sections) || !d.sections.length) throw new BadRequestException('Escolha ao menos uma informação para o resumo.')
    await this.settings.set(user.tenantId, WEEKLY_KEY, next)
    await this.audit.byUser(user, ctx, 'relatorios.resumo_vendedor', 'settings', WEEKLY_KEY, { ...next })
    return next
  }

  async tick(now = new Date()) {
    if (this.running) return
    this.running = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: WEEKLY_KEY }, select: { tenantId: true, value: true } })
      for (const row of rows) {
        const config = cleanWeekly(row.value as Partial<SellerWeekly> | null)
        if (!config.enabled) continue
        await this.runTenant(row.tenantId, config, now).catch((err: unknown) => this.logger.warn(`Resumo do vendedor não enviado: ${(err as Error).message}`))
      }
    } finally {
      this.running = false
    }
  }

  private async runTenant(tenantId: string, config: SellerWeekly, now: Date) {
    const cycle = weeklyCycle(config.time, now)
    if (!cycle.due) return
    const saved = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: WEEKLY_LOG_KEY } } })
    const log: WeeklyLog = (saved?.value as WeeklyLog | null)?.cycle === cycle.key ? (saved!.value as WeeklyLog) : { cycle: cycle.key, sellers: {} }
    const done = log.sellers ?? {}
    const inScope = this.scope(config, await loadWeekly(this.prisma, tenantId, cycle, config.sections))
    const reports = inScope.filter((r) => !done[r.seller.id])
    const managers = inScope.length ? config.managerPhones.filter((ph) => !done[`gestor:${ph}`]) : []
    if (!reports.length && !managers.length) return
    // Intervalo entre as mensagens (sorteado a cada envio): a próxima só depois do horário marcado.
    if (log.nextAt && now.getTime() < Date.parse(log.nextAt)) return
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { tenantId, deletedAt: null, status: 'CONECTADO' }, orderBy: { createdAt: 'asc' } })
    // Sem número conectado: tenta de novo no próximo minuto (até o fim da sexta).
    if (!numbers.length) return
    const number = numbers.find((n) => n.id === config.numberId) ?? numbers[0]!
    const save = (key: string, status: string, sent: boolean) => {
      done[key] = status
      if (sent) log.nextAt = new Date(Date.now() + weeklyGapMs(config)).toISOString()
      const value = { cycle: cycle.key, at: new Date().toISOString(), nextAt: log.nextAt, sellers: done } as unknown as Prisma.InputJsonValue
      return this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: WEEKLY_LOG_KEY } }, create: { tenantId, key: WEEKLY_LOG_KEY, value }, update: { value } })
    }
    // Fila: os vendedores e depois os gestores. Uma mensagem por vez; quem não tem telefone é pulado sem esperar.
    const queue: { key: string; phone: string | null; message: string; name: string }[] = [
      ...reports.map((r) => ({ key: r.seller.id, phone: r.seller.phone ? normalizePhone(r.seller.phone) : null, message: r.message, name: r.seller.name })),
      ...(managers.length ? (() => {
        const message = managerMessage(cycle.label, inScope.map((r) => ({ seller: r.seller.name, stats: r.stats })), config.sections)
        return managers.map((ph) => ({ key: `gestor:${ph}`, phone: ph, message, name: 'Gestor' }))
      })() : []),
    ]
    for (const item of queue) {
      if (!item.phone) {
        await save(item.key, 'SEM_TELEFONE', false)
        continue
      }
      try {
        const sent = await this.chat.sendAutomatic(number, item.phone, item.message, LABEL, { leadId: null, recordId: null, name: item.name, colleague: true })
        // Ritmo do número: tenta de novo no próximo minuto.
        if (!sent) return
        await save(item.key, 'ENVIADA', true)
      } catch (err) {
        await save(item.key, `ERRO: ${((err as Error).message || 'erro desconhecido').slice(0, 300)}`, true)
      }
      return
    }
  }

  /** Vendedores do envio: ativos, com repasse no ciclo, todos ou os escolhidos. */
  private scope<T extends { seller: { id: string; active: boolean } }>(config: SellerWeekly, reports: T[]) {
    return reports.filter((r) => r.seller.active && (config.allSellers || config.sellerIds.includes(r.seller.id)))
  }
}

class WeeklyDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty({ example: '08:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário inválido (use HH:MM).' }) time!: string
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsUUID() numberId!: string | null
  @ApiProperty({ description: 'true = todos os vendedores com repasse; false = só os de sellerIds' }) @IsBoolean() allSellers!: boolean
  @ApiProperty() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) sellerIds!: string[]
  @ApiPropertyOptional({ minimum: 1, maximum: 60 }) @IsOptional() @IsInt() @Min(1) @Max(60) gapMin?: number
  @ApiPropertyOptional({ minimum: 1, maximum: 60 }) @IsOptional() @IsInt() @Min(1) @Max(60) gapMax?: number
  @ApiPropertyOptional({ description: 'WhatsApp dos gestores (resumo da equipe). Vazio: só os vendedores.' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(30, { each: true }) managerPhones?: string[]
  @ApiProperty({ description: 'Informações que vão na mensagem' }) @IsArray() @ArrayMaxSize(30) @IsIn(WEEKLY_SECTIONS.map((x) => x.key), { each: true }) sections!: WeeklySection[]
}

class WeeklyQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) ref?: string
}

/** Resumo do vendedor (semanal), em Marketing › Relatórios e alertas. */
@ApiTags('Relatórios')
@Controller('relatorios/resumo-vendedor')
export class RelatorioSemanalController {
  constructor(private readonly weekly: RelatorioSemanalService) {}

  @Get()
  view(@CurrentUser() user: AuthUser, @Query() q: WeeklyQueryDto) {
    return this.weekly.view(user, q.ref)
  }

  @Put()
  save(@CurrentUser() user: AuthUser, @Body() dto: WeeklyDto, @ReqContext() ctx: RequestCtx) {
    return this.weekly.save(user, dto, ctx)
  }
}
