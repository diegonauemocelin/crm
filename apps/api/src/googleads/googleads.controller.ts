import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator'
import { CurrentUser, Public, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { GoogleAdsService } from './googleads.service'
import { GoogleAdsPanelService } from './painel.service'

class ActionsDto {
  @IsOptional() @IsString() @MaxLength(20) contato?: string
  @IsOptional() @IsString() @MaxLength(20) negociacao?: string
  @IsOptional() @IsString() @MaxLength(20) venda?: string
  @IsOptional() @IsString() @MaxLength(20) perda?: string
  /** Conferido em detalhe no serviço (ids da lista de motivos e IDs numéricos). */
  @IsOptional() @IsObject() perdaPorMotivo?: Record<string, string>
}

class GoogleAdsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty() @IsString() @MaxLength(20) customerId!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) loginCustomerId?: string
  @ApiPropertyOptional({ description: 'Arquivo JSON da conta de serviço. Vazio mantém a chave atual.' }) @IsOptional() @IsString() @MaxLength(20_000) keyFile?: string
  @ApiProperty() @ValidateNested() @Type(() => ActionsDto) actions!: ActionsDto
  @ApiProperty() @IsBoolean() sendUserData!: boolean
  @ApiProperty() @IsBoolean() onlyGoogle!: boolean
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) originIds?: string[]
  /** Nomes das campanhas pelo número (conferidos no serviço). */
  @ApiPropertyOptional() @IsOptional() @IsObject() campaigns?: Record<string, string>
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string | null
}

/** O script do Google Ads (Ferramentas → Scripts) manda para cá, todo dia, o número e o nome das campanhas. */
@ApiTags('Integrações')
@Controller('webhooks/google-ads')
export class GoogleAdsWebhookController {
  constructor(private readonly ads: GoogleAdsService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('campanhas/:token')
  @HttpCode(200)
  async campaigns(@Param('token') token: string, @Body() body: unknown) {
    const r = await this.ads.receiveCampaigns(token, body)
    if (!r) throw new NotFoundException()
    return r
  }
}

@ApiTags('Integrações')
@Controller('integracoes/google-ads')
export class GoogleAdsController {
  constructor(
    private readonly ads: GoogleAdsService,
    private readonly panel: GoogleAdsPanelService,
  ) {}

  /** Painel: investimento x contatos e vendas, por campanha, palavra-chave e origem. */
  @Get('painel')
  @RequirePermission('relatorios', 'view')
  painel(@CurrentUser() user: AuthUser, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.panel.panel(user, { from: de, to: ate })
  }

  @Get()
  @RequirePermission('configuracoes', 'view')
  async get(@CurrentUser() user: AuthUser) {
    return this.ads.view(await this.ads.configWithToken(user.tenantId))
  }

  @Put()
  @RequirePermission('configuracoes', 'edit')
  save(@CurrentUser() user: AuthUser, @Body() dto: GoogleAdsDto, @ReqContext() ctx: RequestCtx) {
    return this.ads.save(user, dto, ctx)
  }

  @Post('testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('configuracoes', 'edit')
  test(@CurrentUser() user: AuthUser) {
    return this.ads.test(user)
  }

  @Post('enviar')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @RequirePermission('configuracoes', 'edit')
  sendNow(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.ads.sendNow(user, ctx)
  }

  @Get('envios')
  @RequirePermission('configuracoes', 'view')
  status(@CurrentUser() user: AuthUser) {
    return this.ads.status(user)
  }
}
