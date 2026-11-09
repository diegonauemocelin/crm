import { Body, Controller, Delete, Get, Header, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import type { Request, Response } from 'express'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { BUTTON_MAX, MESSAGE_MAX, NAME_MAX, SW_FILE, TITLE_MAX, URL_MAX } from './webpush'
import { WebPushService } from './webpush.service'

class PromptDto {
  @ApiProperty() @IsString() @MaxLength(80) title!: string
  @ApiProperty() @IsString() @MaxLength(220) text!: string
  @ApiProperty() @IsString() @MaxLength(25) allowLabel!: string
  @ApiProperty() @IsString() @MaxLength(25) denyLabel!: string
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(300) delaySec!: number
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(365) askAgainDays!: number
  @ApiProperty() @Matches(/^#[0-9a-fA-F]{6}$/) color!: string
}

class ConfigDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty() @IsString() @MaxLength(200) siteUrl!: string
  @ApiProperty({ type: PromptDto }) @ValidateNested() @Type(() => PromptDto) prompt!: PromptDto
}

/** Rascunho aceita campos vazios; enviar e agendar conferem tudo (src/webpush/webpush.ts, campaignError). */
class CampaignDto {
  @ApiProperty() @IsString() @MaxLength(NAME_MAX) name!: string
  @ApiProperty() @IsString() @MaxLength(TITLE_MAX) title!: string
  @ApiProperty() @IsString() @MaxLength(MESSAGE_MAX) message!: string
  @ApiProperty() @IsString() @MaxLength(URL_MAX) url!: string
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(BUTTON_MAX) buttonLabel?: string | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() iconFileId?: string | null
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() imageFileId?: string | null
}

class ScheduleDto {
  @ApiProperty({ example: '2026-11-20' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string
  @ApiProperty({ example: '10:30' }) @Matches(/^\d{2}:\d{2}$/) time!: string
}

/** Origem do navegador: cabeçalho Origin ou, sem ele, o Referer. */
function originFrom(origin: string | undefined, referer: string | undefined) {
  if (origin && origin !== 'null') return origin
  try {
    return referer ? new URL(referer).origin : undefined
  } catch {
    return undefined
  }
}

/**
 * Rotas chamadas pela loja e pelo service worker (sem login). Inscrição só dos domínios do site cadastrados; entrega e
 * clique só com o link assinado do envio; o clique só leva ao link da própria campanha.
 */
@ApiTags('Público')
@Controller('public/webpush')
export class PublicWebPushController {
  constructor(private readonly push: WebPushService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('config')
  async config(@Query('k') key: unknown, @Headers('origin') rawOrigin: string | undefined, @Headers('referer') referer: string | undefined, @Res({ passthrough: true }) res: Response) {
    const origin = originFrom(rawOrigin, referer)
    res.setHeader('Vary', 'Origin, Referer')
    const r = typeof key === 'string' ? await this.push.publicConfig(key, origin) : null
    if (!r) {
      res.setHeader('Cache-Control', 'no-store')
      return { enabled: false }
    }
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.setHeader('Access-Control-Allow-Origin', origin!)
    return r.body
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('inscrever')
  @HttpCode(204)
  async subscribe(@Req() req: Request, @Headers('origin') rawOrigin: string | undefined, @Headers('referer') referer: string | undefined, @Headers('user-agent') ua: string | undefined, @Res({ passthrough: true }) res: Response) {
    const origin = originFrom(rawOrigin, referer)
    if (await this.push.subscribe(req.body, origin, ua)) {
      res.setHeader('Access-Control-Allow-Origin', origin!)
      res.setHeader('Vary', 'Origin')
    }
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('cancelar')
  @HttpCode(204)
  async unsubscribe(@Req() req: Request, @Headers('origin') rawOrigin: string | undefined, @Headers('referer') referer: string | undefined) {
    await this.push.unsubscribe(req.body, originFrom(rawOrigin, referer))
  }

  /** Aviso do service worker: a notificação apareceu (Entregas). */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Post('e/:id')
  @HttpCode(204)
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  async shown(@Param('id', ParseUUIDPipe) id: string, @Query('u') u: unknown) {
    await this.push.shown(id, u)
  }

  /** Clique na notificação: conta e leva ao link da campanha (nunca a um endereço vindo do pedido). */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('c/:id')
  async click(@Param('id', ParseUUIDPipe) id: string, @Query('u') u: unknown, @Res() res: Response) {
    const url = await this.push.click(id, u)
    if (!url) throw new NotFoundException('Link não encontrado.')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.redirect(302, url)
  }
}

@ApiTags('Web Push')
@Controller('marketing/web-push')
export class WebPushController {
  constructor(private readonly push: WebPushService) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.push.view(user)
  }

  @Put('config')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: ConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.push.saveConfig(user, dto, ctx)
  }

  /** Arquivo para publicar na raiz da loja. */
  @Get('service-worker')
  async swFile(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const body = await this.push.swFile(user)
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${SW_FILE}"`)
    res.setHeader('Cache-Control', 'no-store')
    return body
  }

  @Get('verificar')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  check(@CurrentUser() user: AuthUser) {
    return this.push.checkSw(user)
  }

  @Get('campanhas')
  list(@CurrentUser() user: AuthUser) {
    return this.push.list(user)
  }

  @Get('campanhas/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.push.get(user, id)
  }

  @Post('campanhas')
  create(@CurrentUser() user: AuthUser, @Body() dto: CampaignDto, @ReqContext() ctx: RequestCtx) {
    return this.push.create(user, dto, ctx)
  }

  @Put('campanhas/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CampaignDto, @ReqContext() ctx: RequestCtx) {
    return this.push.update(user, id, dto, ctx)
  }

  @Post('campanhas/:id/enviar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.push.sendNow(user, id, ctx)
  }

  @Post('campanhas/:id/agendar')
  @HttpCode(200)
  schedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto, @ReqContext() ctx: RequestCtx) {
    return this.push.schedule(user, id, dto.date, dto.time, ctx)
  }

  @Post('campanhas/:id/cancelar')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.push.cancel(user, id, ctx)
  }

  @Post('campanhas/:id/duplicar')
  @HttpCode(200)
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.push.duplicate(user, id, ctx)
  }

  @Delete('campanhas/:id')
  @HttpCode(200)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.push.remove(user, id, ctx)
  }

  @Post('imagens')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @ReqContext() ctx: RequestCtx) {
    return this.push.uploadImage(user, file, ctx)
  }
}
