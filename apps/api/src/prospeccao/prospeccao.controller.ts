import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { ProspeccaoEnvioService } from './envio.service'
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

class ChatDto {
  @ApiProperty() @IsUUID() numberId!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string
}

class MensagemDto {
  @ApiProperty({ description: 'O que a empresa oferece (a IA escreve a abordagem a partir disto)' }) @IsString() @MaxLength(600) offer!: string
}

class EnvioDto {
  @ApiProperty() @IsUUID() numberId!: string
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) prospectIds!: string[]
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(1500, { each: true }) messages!: string[]
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) gapMin?: number
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) gapMax?: number
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) dailyMax?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() optOut?: boolean
}

/** Busca de leads, em Atendimento Comercial. */
@ApiTags('Busca de leads')
@Controller('prospeccao')
export class ProspeccaoController {
  constructor(
    private readonly svc: ProspeccaoService,
    private readonly envio: ProspeccaoEnvioService,
  ) {}

  @Get('numeros')
  numbers(@CurrentUser() user: AuthUser) {
    return this.envio.numbers(user)
  }

  @Post('empresas/:id/chat')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  openChat(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChatDto, @ReqContext() ctx: RequestCtx) {
    return this.envio.openChat(user, id, dto, ctx)
  }

  @Post('buscas/:id/mensagem')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  writeMessage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MensagemDto) {
    return this.envio.writeMessage(user, id, dto.offer)
  }

  @Get('buscas/:id/envios')
  campaigns(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.envio.list(user, id)
  }

  @Post('buscas/:id/envios')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createCampaign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnvioDto, @ReqContext() ctx: RequestCtx) {
    return this.envio.createCampaign(user, id, { ...dto }, ctx)
  }

  @Post('envios/:id/:acao')
  @HttpCode(200)
  setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('acao') acao: string, @ReqContext() ctx: RequestCtx) {
    if (acao !== 'pausar' && acao !== 'retomar' && acao !== 'cancelar') throw new BadRequestException('Ação inválida.')
    return this.envio.setStatus(user, id, acao, ctx)
  }

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
