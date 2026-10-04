import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import type { Request } from 'express'
import { AuditService } from '../audit/audit.service'
import { encrypt, randomToken } from '../common/crypto'
import { CurrentUser, Public, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { GRAPH_VERSION } from '../integracoes/meta'
import { MetaLeadAdsService, type MetaSettings } from '../integracoes/meta.service'
import { normalizeTags } from '../leads/mapeamento'
import { LeadsService } from '../leads/leads.service'
import { cleanDomain } from './origem'
import { RastreamentoService } from './rastreamento.service'

class TrackingDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(200, { each: true }) domains!: string[]
  @ApiProperty() @IsBoolean() requireConsent!: boolean
  @ApiProperty() @Type(() => Number) @IsInt() @Min(30) @Max(1095) retentionDays!: number
}

class SummaryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) dias = 30
}

class MetaDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiPropertyOptional({ description: 'Vazio mantém o atual' }) @IsOptional() @IsString() @MaxLength(200) appSecret?: string
  @ApiPropertyOptional({ description: 'Vazio mantém o atual' }) @IsOptional() @IsString() @MaxLength(1000) pageToken?: string
  @ApiProperty() @Matches(GRAPH_VERSION, { message: 'Versão da Graph API inválida (ex.: v23.0).' }) graphVersion!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() ownerId?: string | null
  @ApiProperty() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) tags!: string[]
}

class MetaTestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) pageToken?: string
  @ApiProperty() @Matches(GRAPH_VERSION) graphVersion!: string
}

function metaView(s: MetaSettings, webhookUrl: string) {
  const { appSecretEnc, pageTokenEnc, webhookKey: _k, ...rest } = s
  return { ...rest, webhookUrl, hasAppSecret: !!appSecretEnc, hasPageToken: !!pageTokenEnc }
}

/** Rotas chamadas pelo site (sem login). Nunca devolvem dado algum: só recebem. */
@ApiTags('Público')
@Controller('public/rastreamento')
export class PublicTrackingController {
  constructor(private readonly tracking: RastreamentoService) {}

  @Public()
  @SkipThrottle()
  @Get('script.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=600')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  script(@Query('k') key: string | undefined) {
    return this.tracking.script(typeof key === 'string' ? key : '')
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('coleta')
  @HttpCode(204)
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  async collect(@Req() req: Request, @Headers('origin') origin: string | undefined) {
    await this.tracking.collect(req.body, origin)
  }
}

@ApiTags('Rastreamento do site')
@Controller('rastreamento')
export class TrackingController {
  constructor(
    private readonly tracking: RastreamentoService,
    private readonly leads: LeadsService,
    private readonly audit: AuditService,
  ) {}

  @Get('config')
  @RequirePermission('configuracoes', 'view')
  async config(@CurrentUser() user: AuthUser) {
    const s = await this.tracking.config(user.tenantId)
    return { ...s, snippet: this.tracking.snippet(s) }
  }

  @Put('config')
  @RequirePermission('configuracoes', 'edit')
  async save(@CurrentUser() user: AuthUser, @Body() dto: TrackingDto, @ReqContext() ctx: RequestCtx) {
    const domains: string[] = []
    for (const d of dto.domains.filter((x) => x.trim())) {
      const c = cleanDomain(d)
      if (!c) throw new BadRequestException(`Domínio inválido: ${d}. Use só o endereço, ex.: www.usaparts.com.br`)
      if (!domains.includes(c)) domains.push(c)
    }
    if (dto.enabled && !domains.length) throw new BadRequestException('Informe ao menos um domínio do site para ligar o rastreamento.')
    const current = await this.tracking.config(user.tenantId)
    const next = await this.tracking.save(user.tenantId, { ...current, ...dto, domains })
    await this.audit.byUser(user, ctx, 'settings.tracking_updated', 'settings', 'tracking', { ...dto, domains })
    return { ...next, snippet: this.tracking.snippet(next) }
  }

  /** Troca a chave do site (o código antigo para de funcionar e precisa ser substituído no site). */
  @Post('config/nova-chave')
  @HttpCode(200)
  @RequirePermission('configuracoes', 'edit')
  async rotate(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    const current = await this.tracking.config(user.tenantId)
    const next = await this.tracking.save(user.tenantId, { ...current, siteKey: randomToken(18) })
    await this.audit.byUser(user, ctx, 'settings.tracking_key_rotated', 'settings', 'tracking')
    return { ...next, snippet: this.tracking.snippet(next) }
  }

  @Get('resumo')
  @RequirePermission('leads', 'view')
  summary(@CurrentUser() user: AuthUser, @Query() q: SummaryDto) {
    return this.tracking.summary(user.tenantId, q.dias)
  }

  /** Aba "Site" da ficha. Passa pelo mesmo controle de acesso da ficha (escopo próprio/unidade). */
  @Get('leads/:id')
  async lead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.leads.get(user, id)
    return this.tracking.forLead(id)
  }

  /** Link rastreável de um lead (para testar a identificação ou usar em campanhas manuais). */
  @Get('leads/:id/link')
  @RequirePermission('leads', 'edit')
  async leadLink(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.leads.get(user, id)
    return { param: 'crm_lid', token: this.tracking.leadToken(id) }
  }
}

/** Webhook do Meta Lead Ads. Autenticado pela assinatura (X-Hub-Signature-256), não por sessão. */
@ApiTags('Webhooks')
@Controller('webhooks/meta')
export class MetaWebhookController {
  constructor(private readonly meta: MetaLeadAdsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':key')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async verify(@Param('key') key: string, @Query('hub.mode') mode: unknown, @Query('hub.verify_token') token: unknown, @Query('hub.challenge') challenge: unknown) {
    const ok = await this.meta.verify(key, mode, token, challenge)
    if (!ok) throw new ForbiddenException('Verificação recusada.')
    return ok
  }

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Post(':key')
  @HttpCode(200)
  async receive(@Param('key') key: string, @Req() req: Request, @Headers('x-hub-signature-256') signature: string | undefined) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!(await this.meta.receive(key, raw, signature))) throw new ForbiddenException('Assinatura inválida.')
    return { ok: true }
  }
}

@ApiTags('Integrações')
@Controller('integracoes/meta-lead-ads')
export class MetaAdminController {
  constructor(
    private readonly meta: MetaLeadAdsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('configuracoes', 'view')
  async get(@CurrentUser() user: AuthUser) {
    const s = await this.meta.config(user.tenantId)
    return metaView(s, this.meta.webhookUrl(s))
  }

  @Put()
  @RequirePermission('configuracoes', 'edit')
  async save(@CurrentUser() user: AuthUser, @Body() dto: MetaDto, @ReqContext() ctx: RequestCtx) {
    const current = await this.meta.config(user.tenantId)
    const { appSecret, pageToken, ...rest } = dto
    const next: MetaSettings = {
      ...current,
      ...rest,
      ownerId: dto.ownerId ?? null,
      tags: normalizeTags(dto.tags),
      appSecretEnc: appSecret ? encrypt(appSecret.trim()) : current.appSecretEnc,
      pageTokenEnc: pageToken ? encrypt(pageToken.trim()) : current.pageTokenEnc,
    }
    if (next.enabled && (!next.appSecretEnc || !next.pageTokenEnc)) throw new BadRequestException('Para ligar, informe a chave secreta do app e o token da página.')
    await this.meta.save(user.tenantId, next)
    await this.audit.byUser(user, ctx, 'settings.meta_lead_ads_updated', 'settings', 'meta_lead_ads', {
      ativo: next.enabled,
      versao: next.graphVersion,
      chaveAlterada: !!appSecret,
      tokenAlterado: !!pageToken,
    })
    return metaView(next, this.meta.webhookUrl(next))
  }

  @Post('testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('configuracoes', 'edit')
  async test(@CurrentUser() user: AuthUser, @Body() dto: MetaTestDto) {
    const current = await this.meta.config(user.tenantId)
    return this.meta.test({ ...current, graphVersion: dto.graphVersion }, dto.pageToken?.trim())
  }

  @Get('recebimentos')
  @RequirePermission('configuracoes', 'view')
  receipts(@CurrentUser() user: AuthUser) {
    return this.meta.receipts(user.tenantId)
  }
}
