import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import { CurrentUser, Public, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { FluxosService } from './fluxos.service'
import { SetoresService } from './setores.service'
import { WhatsappService } from './whatsapp.service'

class NumberDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unitId?: string | null
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) sellerIds?: string[]
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) userIds?: string[]
  @ApiPropertyOptional() @IsOptional() @IsBoolean() splitAttendance?: boolean
  @ApiPropertyOptional({ description: 'Atendente que recebe os clientes novos (um dos usuários do número)' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() defaultUserId?: string | null
  @ApiPropertyOptional({ description: 'Ignorado: os setores agora são da empresa (/whatsapp/setores)' }) @IsOptional() @IsArray() @ArrayMaxSize(20) sectors?: unknown[]
  @ApiPropertyOptional() @IsOptional() @IsBoolean() createRecords?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() signMessages?: boolean
}

/** Eventos da Evolution API (só pela rede interna do Docker; o segredo vai no caminho). */
@ApiTags('WhatsApp')
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly wa: WhatsappService) {}

  @Public()
  @Throttle({ default: { limit: 3000, ttl: 60_000 } })
  @Post(':secret')
  @HttpCode(200)
  async event(@Param('secret') secret: string, @Body() body: unknown) {
    if (!(await this.wa.webhook(secret, body))) throw new NotFoundException()
    return { ok: true }
  }
}

@ApiTags('WhatsApp')
@Controller('whatsapp/numeros')
export class WhatsappController {
  constructor(private readonly wa: WhatsappService) {}

  @Get()
  @RequirePermission('whatsapp', 'view')
  list(@CurrentUser() user: AuthUser) {
    return this.wa.list(user)
  }

  @Post()
  @RequirePermission('whatsapp', 'create')
  create(@CurrentUser() user: AuthUser, @Body() dto: NumberDto, @ReqContext() ctx: RequestCtx) {
    return this.wa.create(user, dto, ctx)
  }

  @Put(':id')
  @RequirePermission('whatsapp', 'edit')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NumberDto, @ReqContext() ctx: RequestCtx) {
    return this.wa.update(user, id, dto, ctx)
  }

  @Delete(':id')
  @RequirePermission('whatsapp', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.wa.remove(user, id, ctx)
  }

  @Post(':id/conectar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('whatsapp', 'edit')
  connect(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx, @Query('novo') novo?: string) {
    // ?novo=1: QR Code novo mesmo com o número aparecendo conectado (sessão caída que a Evolution ainda dá como aberta).
    return this.wa.connect(user, id, ctx, novo === '1')
  }

  @Get(':id/qr')
  @RequirePermission('whatsapp', 'edit')
  qr(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wa.qrStatus(user, id)
  }

  @Post(':id/desconectar')
  @HttpCode(200)
  @RequirePermission('whatsapp', 'edit')
  disconnect(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.wa.disconnect(user, id, ctx)
  }
}

class SectorDto {
  @ApiProperty() @IsString() @Length(2, 40) name!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) description?: string | null
  @ApiProperty({ type: [String], description: 'Números em que atende (vazio = todos)' }) @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) numberIds!: string[]
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) userIds!: string[]
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) managerIds!: string[]
  @ApiProperty({ enum: ['PROPRIAS', 'SETOR'] }) @IsIn(['PROPRIAS', 'SETOR']) visibility!: 'PROPRIAS' | 'SETOR'
}

class ManagersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) managerIds!: string[]
}

/** Setores de atendimento e gestores de cada pessoa (Configurações › Setores e equipes). */
@ApiTags('WhatsApp')
@Controller('whatsapp/setores')
export class SetoresController {
  constructor(private readonly setores: SetoresService) {}

  @Get()
  @RequirePermission('whatsapp', 'view')
  list(@CurrentUser() user: AuthUser) {
    return this.setores.list(user)
  }

  @Post()
  @RequirePermission('whatsapp', 'edit')
  create(@CurrentUser() user: AuthUser, @Body() dto: SectorDto, @ReqContext() ctx: RequestCtx) {
    return this.setores.save(user, null, dto, ctx)
  }

  @Put(':id')
  @RequirePermission('whatsapp', 'edit')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SectorDto, @ReqContext() ctx: RequestCtx) {
    return this.setores.save(user, id, dto, ctx)
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('whatsapp', 'edit')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.setores.remove(user, id, ctx)
    return { ok: true }
  }

  @Put('gestores/:userId')
  @RequirePermission('whatsapp', 'edit')
  managers(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ManagersDto, @ReqContext() ctx: RequestCtx) {
    return this.setores.setManagers(user, userId, dto.managerIds, ctx)
  }
}

class FlowDto {
  @ApiProperty() @IsString() @Length(2, 60) name!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) description?: string | null
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) numberIds!: string[]
  @ApiProperty({ enum: ['NOVA_CONVERSA', 'PALAVRA'] }) @IsIn(['NOVA_CONVERSA', 'PALAVRA']) trigger!: 'NOVA_CONVERSA' | 'PALAVRA'
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) keywords!: string[]
  @ApiProperty() @IsBoolean() onlyAfterHours!: boolean
  @ApiProperty() @Type(() => Number) @IsInt() @Min(5) @Max(1440) timeoutMinutes!: number
  @ApiProperty({ description: 'Etapas [{ id, type, text, options, go, label }]' }) @IsArray() @ArrayMaxSize(60) steps!: unknown[]
  @ApiProperty() @IsString() @MaxLength(40) startStepId!: string
}

class FlowActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean
}

class SimulateDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(60) steps!: unknown[]
  @ApiProperty() @IsString() @MaxLength(40) startStepId!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsObject() state!: { stepId: string; tries: number; answers: { label: string; text: string }[] } | null
  @ApiProperty() @IsString() @MaxLength(1000) text!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string
}

/** Chatbot de atendimento: fluxos sem IA que recebem o cliente e direcionam (Configurações › Chatbot de atendimento). */
@ApiTags('WhatsApp')
@Controller('whatsapp/fluxos')
export class FluxosController {
  constructor(private readonly fluxos: FluxosService) {}

  @Get()
  @RequirePermission('whatsapp', 'view')
  list(@CurrentUser() user: AuthUser) {
    return this.fluxos.list(user)
  }

  @Post('simular')
  @HttpCode(200)
  @RequirePermission('whatsapp', 'view')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  simulate(@Body() dto: SimulateDto) {
    return this.fluxos.simulate(dto)
  }

  @Post()
  @RequirePermission('whatsapp', 'edit')
  create(@CurrentUser() user: AuthUser, @Body() dto: FlowDto, @ReqContext() ctx: RequestCtx) {
    return this.fluxos.save(user, null, dto, ctx)
  }

  @Put(':id')
  @RequirePermission('whatsapp', 'edit')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FlowDto, @ReqContext() ctx: RequestCtx) {
    return this.fluxos.save(user, id, dto, ctx)
  }

  @Post(':id/situacao')
  @HttpCode(200)
  @RequirePermission('whatsapp', 'edit')
  setActive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FlowActiveDto, @ReqContext() ctx: RequestCtx) {
    return this.fluxos.setActive(user, id, dto.active, ctx)
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('whatsapp', 'edit')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.fluxos.remove(user, id, ctx)
    return { ok: true }
  }
}
