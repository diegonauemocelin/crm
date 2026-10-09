import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator'
import { CurrentUser, Public, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { WhatsappService } from './whatsapp.service'

class NumberDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unitId?: string | null
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) sellerIds?: string[]
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
  connect(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.wa.connect(user, id, ctx)
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
