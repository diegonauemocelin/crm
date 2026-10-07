import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import type { Request, Response } from 'express'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { CapturaAdminService } from './captura-admin.service'
import { CapturaService, type PublicSubmit } from './captura.service'
import { HEX_COLOR } from './regras'

class FormDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiProperty() @IsArray() @ArrayMaxSize(20) fields!: unknown[]
  @ApiProperty() @IsString() @MaxLength(40) submitLabel!: string
  @ApiProperty() @IsString() @MaxLength(300) successMessage!: string
  @ApiProperty() @IsIn(['mensagem', 'whatsapp', 'redirect']) afterSubmit!: 'mensagem' | 'whatsapp' | 'redirect'
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) redirectUrl?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) consentText?: string | null
  @ApiProperty() @IsString() @MaxLength(80) originName!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() ownerId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() customerTypeId?: string | null
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) brandIds?: string[]
  @ApiProperty() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) tags!: string[]
  @ApiProperty() @IsBoolean() createRecord!: boolean
  @ApiProperty() @IsBoolean() active!: boolean
}

class PopupDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiProperty() @IsUUID() formId!: string
  @ApiProperty() @IsString() @Length(1, 120) title!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) text?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) imageUrl?: string | null
  @ApiProperty() @IsIn(['delay', 'exit', 'scroll']) trigger!: 'delay' | 'exit' | 'scroll'
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(300) delaySec!: number
  @ApiProperty() @Type(() => Number) @IsInt() @Min(10) @Max(100) scrollPct!: number
  @ApiProperty() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) include!: string[]
  @ApiProperty() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) exclude!: string[]
  @ApiProperty() @IsIn(['todos', 'celular', 'computador']) device!: 'todos' | 'celular' | 'computador'
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(365) frequencyDays!: number
  @ApiProperty() @Matches(HEX_COLOR) color!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() ownerId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() customerTypeId?: string | null
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) brandIds?: string[]
  @ApiProperty() @IsBoolean() active!: boolean
}

class WhatsappDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiProperty() @IsString() @Length(8, 40) phone!: string
  @ApiProperty() @IsBoolean() active!: boolean
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(999) sortOrder!: number
  @ApiProperty() @IsString() @Length(1, 40) buttonText!: string
  @ApiProperty() @IsString() @Length(1, 80) title!: string
  @ApiProperty() @IsString() @MaxLength(200) subtitle!: string
  @ApiProperty() @IsBoolean() askEmail!: boolean
  @ApiProperty() @IsString() @Length(1, 500) message!: string
  @ApiProperty() @IsIn(['direita', 'esquerda']) position!: 'direita' | 'esquerda'
  @ApiProperty() @Matches(HEX_COLOR) color!: string
  @ApiProperty() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) include!: string[]
  @ApiProperty() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) exclude!: string[]
  @ApiProperty() @IsIn(['todos', 'celular', 'computador']) device!: 'todos' | 'celular' | 'computador'
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() ownerId!: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() customerTypeId!: string | null
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) brandIds?: string[]
  @ApiProperty() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) tags!: string[]
  @ApiProperty() @IsBoolean() createRecord!: boolean
}

class SettingsDto {
  @ApiProperty() @IsString() @MaxLength(500) privacyUrl!: string
}

class SubmissionsDto {
  @IsOptional() @IsIn(['formulario', 'popup', 'whatsapp', 'landing']) channel?: string
  @IsOptional() @IsUUID() formId?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100) pageSize = 50
}

/** Origem do navegador: cabeçalho Origin ou, em pedidos do mesmo endereço (que não o enviam), o Referer. */
function originFrom(origin: string | undefined, referer: string | undefined) {
  if (origin && origin !== 'null') return origin
  try {
    return referer ? new URL(referer).origin : undefined
  } catch {
    return undefined
  }
}

/** O corpo chega como texto (envio simples, sem pré-verificação de CORS). */
function parseBody(raw: unknown): PublicSubmit | null {
  try {
    const p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as PublicSubmit
    if (!p || typeof p !== 'object' || typeof p.k !== 'string' || !['form', 'popup', 'whatsapp', 'landing', 'popup_view'].includes(p.kind)) return null
    if (p.d && (typeof p.d !== 'object' || Array.isArray(p.d) || Object.keys(p.d).length > 30)) return null
    return p
  } catch {
    return null
  }
}

/** Rotas do site e das landing pages (sem login). Respondem só para os domínios do site cadastrados. */
@ApiTags('Público')
@Controller('public/captura')
export class PublicCapturaController {
  constructor(private readonly captura: CapturaService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('config')
  async config(@Query('k') key: string, @Headers('origin') rawOrigin: string | undefined, @Headers('referer') referer: string | undefined, @Res({ passthrough: true }) res: Response) {
    const origin = originFrom(rawOrigin, referer)
    const site = await this.captura.allowedOrigin(String(key ?? ''), origin)
    res.setHeader('Vary', 'Origin, Referer')
    // Resposta recusada não pode ficar em cache (senão o site continua sem captura depois de configurado).
    if (!site) {
      res.setHeader('Cache-Control', 'no-store')
      return { forms: {}, popups: [], whatsapp: null, privacyUrl: null }
    }
    res.setHeader('Cache-Control', 'public, max-age=60')
    res.setHeader('Access-Control-Allow-Origin', origin!)
    return this.captura.publicConfig(site.tenantId)
  }

  /** Código com script do formulário (alternativa ao <div> marcador). */
  @Public()
  @SkipThrottle()
  @Get('form.js')
  async formJs(@Query('k') key: string, @Query('f') formId: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    return this.captura.formScript(String(key ?? ''), String(formId ?? ''))
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('enviar')
  @HttpCode(200)
  async submit(@Req() req: Request, @Headers('origin') rawOrigin: string | undefined, @Headers('referer') referer: string | undefined, @Headers('user-agent') ua: string | undefined, @Res({ passthrough: true }) res: Response) {
    const origin = originFrom(rawOrigin, referer)
    const p = parseBody(req.body)
    if (!p) return { ok: false, message: 'Envio inválido.' }
    const site = await this.captura.allowedOrigin(p.k, origin)
    if (!site) return { ok: false, message: 'Envio não autorizado.' }
    res.setHeader('Access-Control-Allow-Origin', origin!)
    res.setHeader('Vary', 'Origin')
    return this.captura.submit(site.tenantId, p, { ip: req.ip ?? null, userAgent: ua?.slice(0, 500) })
  }
}

@ApiTags('Captura')
@Controller('captura')
export class CapturaController {
  constructor(private readonly admin: CapturaAdminService) {}

  @Get('campos')
  catalog(@CurrentUser() user: AuthUser) {
    return this.admin.catalog(user)
  }

  @Get('formularios')
  forms(@CurrentUser() user: AuthUser) {
    return this.admin.listForms(user)
  }

  @Post('formularios')
  createForm(@CurrentUser() user: AuthUser, @Body() dto: FormDto, @ReqContext() ctx: RequestCtx) {
    return this.admin.saveForm(user, null, dto, ctx)
  }

  @Put('formularios/:id')
  updateForm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FormDto, @ReqContext() ctx: RequestCtx) {
    return this.admin.saveForm(user, id, dto, ctx)
  }

  @Get('popups')
  popups(@CurrentUser() user: AuthUser) {
    return this.admin.listPopups(user)
  }

  @Post('popups')
  createPopup(@CurrentUser() user: AuthUser, @Body() dto: PopupDto, @ReqContext() ctx: RequestCtx) {
    return this.admin.savePopup(user, null, dto, ctx)
  }

  @Put('popups/:id')
  updatePopup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PopupDto, @ReqContext() ctx: RequestCtx) {
    return this.admin.savePopup(user, id, dto, ctx)
  }

  @Delete('popups/:id')
  @HttpCode(200)
  async removePopup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.admin.removePopup(user, id, ctx)
    return { ok: true }
  }

  @Get('configuracoes')
  settings(@CurrentUser() user: AuthUser) {
    return this.admin.getSettings(user)
  }

  @Put('configuracoes')
  saveSettings(@CurrentUser() user: AuthUser, @Body() dto: SettingsDto, @ReqContext() ctx: RequestCtx) {
    return this.admin.saveSettings(user, dto, ctx)
  }

  @Get('whatsapps')
  whatsapps(@CurrentUser() user: AuthUser) {
    return this.admin.listWhatsapps(user)
  }

  @Post('whatsapps')
  createWhatsapp(@CurrentUser() user: AuthUser, @Body() dto: WhatsappDto, @ReqContext() ctx: RequestCtx) {
    return this.admin.saveWhatsapp(user, null, dto, ctx)
  }

  @Put('whatsapps/:id')
  updateWhatsapp(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WhatsappDto, @ReqContext() ctx: RequestCtx) {
    return this.admin.saveWhatsapp(user, id, dto, ctx)
  }

  @Delete('whatsapps/:id')
  @HttpCode(200)
  async removeWhatsapp(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.admin.removeWhatsapp(user, id, ctx)
    return { ok: true }
  }

  @Get('envios')
  submissions(@CurrentUser() user: AuthUser, @Query() q: SubmissionsDto) {
    const { page, pageSize, ...f } = q
    return this.admin.submissions(user, f, page, pageSize)
  }
}
