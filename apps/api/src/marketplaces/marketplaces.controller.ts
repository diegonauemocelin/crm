import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { AuditService } from '../audit/audit.service'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { MarketplacesService } from './marketplaces.service'
import { MlError, mlView, todayBr } from './mercadolivre'
import { MercadoLivreService } from './mercadolivre.service'

const DATE = /^\d{4}-\d{2}-\d{2}$/

class PeriodDto {
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
}

class MlPanelDto extends PeriodDto {
  @IsOptional() @Matches(/^\d{1,30}$/) campanha?: string
}

class CredentialsDto {
  @IsString() @MaxLength(40) clientId!: string
  @IsOptional() @IsString() @MaxLength(200) clientSecret?: string
}

class CallbackDto {
  @IsString() @MaxLength(500) code!: string
  @IsString() @MaxLength(200) state!: string
}

class AdvertiserDto {
  @Matches(/^\d{1,30}$/) advertiserId!: string
}

/** Período padrão: últimos 30 dias até ontem (o Mercado Livre fecha o dia seguinte). */
function period(q: PeriodDto) {
  const to = q.ate ?? todayBr()
  const from = q.de ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)
  if (from > to) throw new BadRequestException('A data inicial precisa ser antes da final.')
  if (Date.parse(to) - Date.parse(from) > 3 * 366 * 86_400_000) throw new BadRequestException('Escolha um período de até 3 anos.')
  return { from, to }
}

/** Erro do Mercado Livre vira mensagem para a tela (e não "erro inesperado no servidor"). */
const mlBadRequest = (err: unknown): never => {
  if (err instanceof MlError) throw new BadRequestException(err.message)
  throw err
}

@ApiTags('Marketplaces')
@Controller('marketplaces')
export class MarketplacesController {
  constructor(
    private readonly panels: MarketplacesService,
    private readonly ml: MercadoLivreService,
    private readonly audit: AuditService,
  ) {}

  @Get('visao-geral')
  @RequirePermission('marketplaces', 'view')
  overview(@CurrentUser() user: AuthUser, @Query() q: PeriodDto) {
    const p = period(q)
    return this.panels.overview(user.tenantId, p.from, p.to)
  }

  @Get('mercado-livre')
  @RequirePermission('marketplaces', 'view')
  mercadoLivre(@CurrentUser() user: AuthUser, @Query() q: MlPanelDto) {
    const p = period(q)
    return this.panels.mercadoLivre(user.tenantId, p.from, p.to, q.campanha)
  }

  // ---------- Conexão com o Mercado Livre ----------

  @Get('mercado-livre/config')
  @RequirePermission('marketplaces', 'view')
  async config(@CurrentUser() user: AuthUser) {
    const [c, sync] = await Promise.all([this.ml.config(user.tenantId), this.ml.syncState(user.tenantId)])
    return { ...mlView(c), redirectUri: this.ml.redirectUri(), sync }
  }

  @Put('mercado-livre/credenciais')
  @RequirePermission('marketplaces', 'edit')
  async credentials(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: CredentialsDto) {
    const c = await this.ml.saveCredentials(user.tenantId, dto.clientId, dto.clientSecret)
    await this.audit.byUser(user, ctx, 'marketplaces.ml_credentials', 'settings', 'marketplace_ml', { clientId: c.clientId, segredoTrocado: !!dto.clientSecret })
    return mlView(c)
  }

  @Post('mercado-livre/conectar')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  connect(@CurrentUser() user: AuthUser) {
    return this.ml.startAuthorization(user)
  }

  @Post('mercado-livre/retorno')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('marketplaces', 'edit')
  async callback(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: CallbackDto) {
    const r = await this.ml.completeAuthorization(user, dto.code, dto.state).catch(mlBadRequest)
    await this.audit.byUser(user, ctx, 'marketplaces.ml_connected', 'settings', 'marketplace_ml', { conta: r.nickname })
    return r
  }

  @Get('mercado-livre/anunciantes')
  @RequirePermission('marketplaces', 'edit')
  advertisers(@CurrentUser() user: AuthUser) {
    return this.ml.listAdvertisers(user.tenantId).catch(mlBadRequest)
  }

  @Put('mercado-livre/anunciante')
  @RequirePermission('marketplaces', 'edit')
  async advertiser(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: AdvertiserDto) {
    const c = await this.ml.selectAdvertiser(user.tenantId, dto.advertiserId).catch(mlBadRequest)
    await this.audit.byUser(user, ctx, 'marketplaces.ml_advertiser', 'settings', 'marketplace_ml', { anunciante: c.advertiserName ?? c.advertiserId })
    return mlView(c)
  }

  @Post('mercado-livre/testar')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  test(@CurrentUser() user: AuthUser) {
    return this.ml.test(user.tenantId)
  }

  @Post('mercado-livre/sincronizar')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  sync(@CurrentUser() user: AuthUser) {
    return this.ml.syncNow(user.tenantId)
  }

  @Post('mercado-livre/desconectar')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  async disconnect(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    const c = await this.ml.disconnect(user.tenantId)
    await this.audit.byUser(user, ctx, 'marketplaces.ml_disconnected', 'settings', 'marketplace_ml')
    return mlView(c)
  }
}
