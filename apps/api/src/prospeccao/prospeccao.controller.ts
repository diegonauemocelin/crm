import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { ProspeccaoService } from './prospeccao.service'

class BuscaDto {
  @ApiProperty({ example: 'Chapecó, SC' }) @IsString() @MaxLength(120) place!: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(300) radiusKm?: number
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) segment?: string
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(40, { each: true }) keywords?: string[]
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) notes?: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(40) limit?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() onlyWithContact?: boolean
}

class ConfigDto {
  @ApiPropertyOptional({ enum: ['claude', 'gemini'] }) @IsOptional() @IsIn(['claude', 'gemini']) provider?: 'claude' | 'gemini'
  @ApiPropertyOptional() @IsOptional() @IsIn(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) claudeModel?: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) dailyLimit?: number
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(20) maxWebSearches?: number
}

/** Busca de leads, em Atendimento Comercial. */
@ApiTags('Busca de leads')
@Controller('prospeccao')
export class ProspeccaoController {
  constructor(private readonly svc: ProspeccaoService) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.svc.view(user)
  }

  @Put('config')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: ConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.saveConfig(user, dto, ctx)
  }

  @Post('buscar')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  start(@CurrentUser() user: AuthUser, @Body() dto: BuscaDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.start(user, dto, ctx)
  }

  @Get('buscas/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id)
  }

  @Post('buscas/:id/whatsapp')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  checkWhatsapp(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.checkWhatsapp(user, id)
  }

  @Post('empresas/:id/lead')
  @HttpCode(200)
  toLead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.svc.toLead(user, id, ctx)
  }

  @Post('empresas/:id/descartar')
  @HttpCode(200)
  discard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.discard(user, id)
  }

  @Post('empresas/:id/nao-contatar')
  @HttpCode(200)
  doNotContact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.svc.doNotContact(user, id, ctx)
  }
}
