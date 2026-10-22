import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import type { Request, Response } from 'express'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { LandingService } from './landing.service'
import { LP_RUNTIME } from './runtime'

class LandingConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) domain?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) ga4Id?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) pixelId?: string
  @ApiPropertyOptional() @IsOptional() @IsBoolean() useAdsTag?: boolean
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) cookieText?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) homeUrl?: string
}

class CreateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) template?: string
  @ApiPropertyOptional() @IsOptional() @IsArray() blocks?: unknown[]
  @ApiPropertyOptional() @IsOptional() @IsObject() seo?: Record<string, unknown>
  @ApiPropertyOptional() @IsOptional() @IsObject() theme?: Record<string, unknown>
}

class SaveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) slug?: string
  @ApiPropertyOptional() @IsOptional() @IsObject() theme?: Record<string, unknown>
  @ApiPropertyOptional() @IsOptional() @IsArray() blocks?: unknown[]
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: SaveDto) => o.blocksB !== null) @IsArray() blocksB?: unknown[] | null
  @ApiPropertyOptional() @IsOptional() @IsBoolean() abActive?: boolean
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(10) @Max(90) abSplit?: number
  @ApiPropertyOptional() @IsOptional() @IsObject() seo?: Record<string, unknown>
}

class PreviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) id?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) slug?: string
  @ApiPropertyOptional() @IsOptional() @IsObject() theme?: Record<string, unknown>
  @ApiProperty() @IsArray() blocks!: unknown[]
  @ApiPropertyOptional() @IsOptional() @IsObject() seo?: Record<string, unknown>
}

class BriefDto {
  @ApiProperty() @IsString() @MaxLength(600) goal!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) audience?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) offer?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) channel?: string
  @ApiPropertyOptional() @IsOptional() @IsIn(['pt', 'es']) language?: 'pt' | 'es'
}

class BuildDto extends BriefDto {
  @ApiProperty() @IsObject() outline!: { title: string; angle: string; blocks: string[] }
}

class ImproveDto {
  @ApiProperty() @IsObject() block!: Record<string, unknown>
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) instruction?: string
}

class PublishDto {
  @ApiProperty() @IsBoolean() publish!: boolean
}

/** Landing pages (E-mail marketing › Landing pages): editor, modelos, IA, publicação e métricas. */
@ApiTags('Landing pages')
@Controller('landing')
export class LandingController {
  constructor(private readonly lp: LandingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.lp.list(user)
  }

  @Get('opcoes')
  options(@CurrentUser() user: AuthUser) {
    return this.lp.options(user)
  }

  @Put('config')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: LandingConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.lp.saveConfig(user, dto, ctx)
  }

  @Get('produtos')
  products(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.lp.products(user, String(q ?? ''))
  }

  @Post('previa')
  @HttpCode(200)
  preview(@CurrentUser() user: AuthUser, @Body() dto: PreviewDto) {
    return this.lp.preview(user, dto)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ia/estruturas')
  @HttpCode(200)
  aiOutlines(@CurrentUser() user: AuthUser, @Body() dto: BriefDto) {
    return this.lp.aiOutlines(user, dto)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ia/montar')
  @HttpCode(200)
  aiBuild(@CurrentUser() user: AuthUser, @Body() dto: BuildDto) {
    return this.lp.aiBuild(user, dto)
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('ia/melhorar')
  @HttpCode(200)
  aiImprove(@CurrentUser() user: AuthUser, @Body() dto: ImproveDto) {
    return this.lp.aiImprove(user, dto)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto, @ReqContext() ctx: RequestCtx) {
    return this.lp.create(user, dto, ctx)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lp.get(user, id)
  }

  @Put(':id')
  save(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveDto, @ReqContext() ctx: RequestCtx) {
    return this.lp.save(user, id, dto, ctx)
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.lp.remove(user, id, ctx)
  }

  @Post(':id/duplicar')
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.lp.duplicate(user, id, ctx)
  }

  @Post(':id/publicacao')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto, @ReqContext() ctx: RequestCtx) {
    return this.lp.publish(user, id, dto.publish, ctx)
  }

  @Get(':id/metricas')
  metrics(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('de') from?: string, @Query('ate') to?: string) {
    return this.lp.metrics(user, id, { from, to })
  }
}

/**
 * Política de segurança da página publicada: só o próprio endereço, as ferramentas de medição (GA4, Google Ads,
 * Meta Pixel), as fontes do Google, o YouTube e o script de rastreamento do CRM.
 */
function lpCsp() {
  const crm = new URL(env.appUrl).origin
  return [
    "default-src 'self'",
    `script-src 'self' ${crm} https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://connect.facebook.net`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    `connect-src 'self' ${crm} https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.google.com https://googleads.g.doubleclick.net https://www.googleadservices.com https://*.facebook.com https://connect.facebook.net`,
    'frame-src https://www.youtube-nocookie.com https://www.googletagmanager.com https://td.doubleclick.net',
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

const NOT_FOUND = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Página não encontrada</title><style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#0f172a;text-align:center;padding:20px}</style></head><body><main><h1>Página não encontrada</h1><p>Esta página não existe ou não está mais no ar.</p></main></body></html>'

/** Páginas publicadas (subdomínio das landing pages ou /lp/ do CRM) e a coleta das visitas e formulários. Sem login. */
@ApiTags('Público')
@Controller('public/lp')
export class PublicLandingController {
  constructor(private readonly lp: LandingService) {}

  @Public()
  @SkipThrottle()
  @Get('runtime.js')
  runtime(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return LP_RUNTIME
  }

  @Public()
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Post('evento')
  @HttpCode(204)
  async event(@Req() req: Request, @Headers('user-agent') ua: string | undefined) {
    await this.lp.event(req.body, ua?.slice(0, 500)).catch(() => undefined)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('enviar')
  @HttpCode(200)
  submit(@Req() req: Request, @Headers('user-agent') ua: string | undefined) {
    return this.lp.submit(req.body, { ip: req.ip ?? null, userAgent: ua?.slice(0, 500) })
  }

  /** Subdomínio sem o endereço de uma página: vai para o site da empresa (se configurado). */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get()
  async home(@Headers('x-forwarded-host') fwd: string | undefined, @Headers('host') host: string | undefined, @Res() res: Response) {
    const url = await this.lp.homeFor(fwd ?? host)
    if (url) return res.redirect(302, url)
    res.status(404).setHeader('Content-Security-Policy', lpCsp())
    res.type('html').send(NOT_FOUND)
  }

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':slug')
  async page(@Param('slug') slug: string, @Headers('x-forwarded-host') fwd: string | undefined, @Headers('host') host: string | undefined, @Req() req: Request, @Res() res: Response) {
    const name = `_lpab_${String(slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60)}`
    const saved = new RegExp(`(?:^|; )${name}=([AB])`).exec(String(req.headers.cookie ?? ''))?.[1]
    const r = await this.lp.publicPage(fwd ?? host, String(slug ?? ''), saved)
    res.setHeader('Content-Security-Policy', lpCsp())
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    if (!r) {
      res.status(404).type('html').send(NOT_FOUND)
      return
    }
    // Teste A/B: o visitante fica sempre na mesma versão, e o HTML não pode ficar em cache compartilhado.
    if (r.ab) res.setHeader('Set-Cookie', `${name}=${r.variant}; Max-Age=2592000; Path=/; SameSite=Lax${env.appUrl.startsWith('https') ? '; Secure' : ''}`)
    res.setHeader('Cache-Control', r.ab ? 'private, no-store' : 'public, max-age=60')
    res.type('html').send(r.html)
  }
}
