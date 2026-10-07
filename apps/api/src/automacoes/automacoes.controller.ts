import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { AutomacoesService } from './automacoes.service'

class CreateDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
}

/** Gatilho e passos são conferidos em detalhe por src/automacoes/fluxo.ts (cleanTrigger/cleanSteps). */
class AutomationDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) description?: string | null
  @ApiProperty() @IsObject() trigger!: Record<string, unknown>
  @ApiProperty() @IsArray() steps!: unknown[]
  @ApiProperty() @IsIn(['nunca', 'apos_terminar']) reentry!: 'nunca' | 'apos_terminar'
  @ApiProperty() @IsBoolean() exitOnPurchase!: boolean
}

class ActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean
}

class EnrollDto {
  @ApiProperty() @IsUUID() segmentId!: string
}

@ApiTags('Automações')
@Controller('automacoes')
export class AutomacoesController {
  constructor(private readonly automacoes: AutomacoesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.automacoes.list(user)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto, @ReqContext() ctx: RequestCtx) {
    return this.automacoes.create(user, dto.name, ctx)
  }

  @Get('opcoes')
  options(@CurrentUser() user: AuthUser) {
    return this.automacoes.options(user)
  }

  @Get('lead/:leadId')
  forLead(@CurrentUser() user: AuthUser, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.automacoes.forLead(user, leadId)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.automacoes.get(user, id)
  }

  @Put(':id')
  save(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AutomationDto, @ReqContext() ctx: RequestCtx) {
    return this.automacoes.save(user, id, dto, ctx)
  }

  @Post(':id/situacao')
  @HttpCode(200)
  active(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActiveDto, @ReqContext() ctx: RequestCtx) {
    return this.automacoes.setActive(user, id, dto.active, ctx)
  }

  @Post(':id/duplicar')
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.automacoes.duplicate(user, id, ctx)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.automacoes.remove(user, id, ctx)
    return { ok: true }
  }

  @Post(':id/inscrever')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  enroll(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnrollDto, @ReqContext() ctx: RequestCtx) {
    return this.automacoes.enrollSegment(user, id, dto.segmentId, ctx)
  }

  @Get(':id/relatorio')
  report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.automacoes.report(user, id)
  }

  @Get(':id/execucoes/:runId')
  logs(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('runId', ParseUUIDPipe) runId: string) {
    return this.automacoes.runLogs(user, id, runId)
  }

  @Post(':id/execucoes/:runId/remover')
  @HttpCode(200)
  removeRun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('runId', ParseUUIDPipe) runId: string, @ReqContext() ctx: RequestCtx) {
    return this.automacoes.removeRun(user, id, runId, ctx)
  }
}
