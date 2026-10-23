import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsUUID, Matches, ValidateIf } from 'class-validator'
import { AuditService } from '../audit/audit.service'
import { normalizePhone } from '../atendimento/br'
import { cleanWeekly, loadWeekly, type SellerWeekly, WEEKLY_SECTIONS, type WeeklySection, weeklyCycle, weeklyFor } from '../atendimento/semanal'
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
    const reports = (await loadWeekly(this.prisma, tenantId, cycle, config.sections)).filter((r) => r.seller.active && !done[r.seller.id] && weeklyFor(config, r.seller.id))
    if (!reports.length) return
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { tenantId, deletedAt: null, status: 'CONECTADO' }, orderBy: { createdAt: 'asc' } })
    // Sem número conectado: tenta de novo no próximo minuto (até o fim da sexta).
    if (!numbers.length) return
    const number = numbers.find((n) => n.id === config.numberId) ?? numbers[0]!
    const save = (sellerId: string, status: string) => {
      done[sellerId] = status
      const value = { cycle: cycle.key, at: new Date().toISOString(), sellers: done } as unknown as Prisma.InputJsonValue
      return this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: WEEKLY_LOG_KEY } }, create: { tenantId, key: WEEKLY_LOG_KEY, value }, update: { value } })
    }
    for (const r of reports) {
      const phone = r.seller.phone ? normalizePhone(r.seller.phone) : null
      if (!phone) {
        await save(r.seller.id, 'SEM_TELEFONE')
        continue
      }
      try {
        const sent = await this.chat.sendAutomatic(number, phone, r.message, LABEL, { leadId: null, recordId: null, name: r.seller.name, colleague: true })
        // Ritmo de envio do número: continua no próximo minuto.
        if (!sent) return
        await save(r.seller.id, 'ENVIADA')
      } catch (err) {
        await save(r.seller.id, `ERRO: ${((err as Error).message || 'erro desconhecido').slice(0, 300)}`)
      }
    }
  }
}

class WeeklyDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty({ example: '08:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário inválido (use HH:MM).' }) time!: string
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsUUID() numberId!: string | null
  @ApiProperty({ description: 'true = todos os vendedores com repasse; false = só os de sellerIds' }) @IsBoolean() allSellers!: boolean
  @ApiProperty() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) sellerIds!: string[]
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
