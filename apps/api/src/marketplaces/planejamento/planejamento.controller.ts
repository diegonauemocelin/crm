import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../../common/decorators'
import type { AuthUser } from '../../common/types'
import { CHANNELS, PlanejamentoService } from './planejamento.service'

const ITEM_ID = /^ML[A-Z]\d{5,15}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const thisMonth = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7)

class PlanAbcQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsIn([60, 90, 180]) dias?: number
}

class PlanQualityDto {
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Matches(ITEM_ID, { each: true, message: 'Anúncio inválido.' }) ids?: string[]
}

class PlanConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(7) @Max(180) coverageDays?: number
  @ApiPropertyOptional() @IsOptional() @IsIn([30, 60]) fullWindowDays?: number
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() fullMinMarginPct?: number | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(0) storageCostPerUnitMonth?: number | null
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(15) @Max(365) stalledDays?: number
}

class PlanGoalQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(MONTH) mes?: string
  @ApiPropertyOptional() @IsOptional() @IsIn(CHANNELS as unknown as string[]) canal?: string
}

class PlanGoalDto {
  @ApiProperty() @Matches(MONTH) mes!: string
  @ApiPropertyOptional() @IsOptional() @IsIn(CHANNELS as unknown as string[]) canal?: string
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(0) @Max(1_000_000_000) revenueTarget?: number | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(-100) @Max(100) marginPctTarget?: number | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(0) @Max(1000) acosTarget?: number | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(1000) notes?: string | null
}

class PlanTaskDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) title!: string
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() assigneeId?: string | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(DAY) dueDate?: string | null
}

class PlanTaskUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() assigneeId?: string | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(DAY) dueDate?: string | null
  @ApiPropertyOptional() @IsOptional() @IsBoolean() done?: boolean
}

class PlanItemParam {
  @Matches(ITEM_ID, { message: 'Anúncio inválido.' }) id!: string
}

class PlanDreQuery {
  @ApiProperty() @Matches(MONTH) de!: string
  @ApiProperty() @Matches(MONTH) ate!: string
  @ApiPropertyOptional() @IsOptional() @IsIn(['mes', 'produto']) por?: 'mes' | 'produto'
}

/** Marketplaces › Planejamento. Ver: curva ABC, auditoria, metas, Full, sazonalidade e DRE. Editar: metas, tarefas, parâmetros e leituras. */
@ApiTags('Marketplaces: planejamento')
@Controller('marketplace-planejamento')
export class PlanejamentoController {
  constructor(private readonly plan: PlanejamentoService) {}

  @Get('abc')
  @RequirePermission('marketplace_planejamento', 'view')
  abc(@CurrentUser() user: AuthUser, @Query() q: PlanAbcQuery) {
    return this.plan.abc(user, q.dias ?? 90)
  }

  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @Post('pedidos/sincronizar')
  @HttpCode(200)
  @RequirePermission('marketplace_planejamento', 'edit')
  syncOrders(@CurrentUser() user: AuthUser) {
    return this.plan.syncNow(user)
  }

  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @Post('qualidade/ler')
  @HttpCode(200)
  @RequirePermission('marketplace_planejamento', 'edit')
  readQuality(@CurrentUser() user: AuthUser, @Body() dto: PlanQualityDto) {
    return this.plan.readQuality(user, dto.ids)
  }

  @Get('configuracao')
  @RequirePermission('marketplace_planejamento', 'view')
  config(@CurrentUser() user: AuthUser) {
    return this.plan.planConfig(user.tenantId)
  }

  @Put('configuracao')
  @RequirePermission('marketplace_planejamento', 'edit')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: PlanConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.plan.savePlanConfig(user, dto, ctx)
  }

  @Get('auditoria')
  @RequirePermission('marketplace_planejamento', 'view')
  audit(@CurrentUser() user: AuthUser) {
    return this.plan.auditView(user)
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auditoria/swot')
  @HttpCode(200)
  @RequirePermission('marketplace_planejamento', 'edit')
  swot(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.plan.generateSwot(user, ctx)
  }

  @Get('metas')
  @RequirePermission('marketplace_planejamento', 'view')
  goals(@CurrentUser() user: AuthUser, @Query() q: PlanGoalQuery) {
    return this.plan.goals(user, q.mes ?? thisMonth(), q.canal ?? 'mercadolivre')
  }

  @Put('metas')
  @RequirePermission('marketplace_planejamento', 'edit')
  saveGoal(@CurrentUser() user: AuthUser, @Body() dto: PlanGoalDto, @ReqContext() ctx: RequestCtx) {
    return this.plan.saveGoal(user, { month: dto.mes, channel: dto.canal ?? 'mercadolivre', revenueTarget: dto.revenueTarget, marginPctTarget: dto.marginPctTarget, acosTarget: dto.acosTarget, notes: dto.notes }, ctx)
  }

  @Post('metas/:id/tarefas')
  @HttpCode(200)
  @RequirePermission('marketplace_planejamento', 'edit')
  addTask(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanTaskDto) {
    return this.plan.addTask(user, id, dto)
  }

  @Put('tarefas/:id')
  @RequirePermission('marketplace_planejamento', 'edit')
  updateTask(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanTaskUpdateDto) {
    return this.plan.updateTask(user, id, dto)
  }

  @Post('tarefas/:id/excluir')
  @HttpCode(200)
  @RequirePermission('marketplace_planejamento', 'edit')
  deleteTask(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.plan.deleteTask(user, id)
  }

  @Get('full')
  @RequirePermission('marketplace_planejamento', 'view')
  full(@CurrentUser() user: AuthUser) {
    return this.plan.full(user)
  }

  @Get('sazonalidade')
  @RequirePermission('marketplace_planejamento', 'view')
  seasonality(@CurrentUser() user: AuthUser) {
    return this.plan.seasonalityView(user)
  }

  @Get('concorrencia')
  @RequirePermission('marketplace_planejamento', 'view')
  competitorMoves(@CurrentUser() user: AuthUser) {
    return this.plan.competitorMoves(user)
  }

  @Get('concorrencia/:id')
  @RequirePermission('marketplace_planejamento', 'view')
  competitorHistory(@CurrentUser() user: AuthUser, @Param() p: PlanItemParam) {
    return this.plan.competitorHistory(user, p.id)
  }

  @Get('dre')
  @RequirePermission('marketplace_planejamento', 'view')
  dre(@CurrentUser() user: AuthUser, @Query() q: PlanDreQuery) {
    return this.plan.dre(user, q.de, q.ate, q.por ?? 'mes')
  }

  @Get('dre/csv')
  @RequirePermission('marketplace_planejamento', 'view')
  async dreCsv(@CurrentUser() user: AuthUser, @Query() q: PlanDreQuery, @Res() res: Response) {
    const f = await this.plan.dreCsv(user, q.de, q.ate, q.por ?? 'mes')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(f.content)
  }
}
