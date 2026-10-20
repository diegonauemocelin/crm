import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { AttributionModel } from './canais'
import { MarketingService, type Query as Q } from './marketing.service'
import type { QualifiedRule } from './motor'

class ConfigDto {
  @ApiProperty({ enum: ['ultimo', 'primeiro'] }) @IsIn(['ultimo', 'primeiro']) model!: AttributionModel
  @ApiProperty({ enum: [7, 14, 30, 60, 90] }) @Type(() => Number) @IsInt() @IsIn([7, 14, 30, 60, 90]) windowDays!: number
  @ApiProperty({ enum: ['estagio_ou_repasse', 'estagio', 'repasse'] }) @IsIn(['estagio_ou_repasse', 'estagio', 'repasse']) qualifiedRule!: QualifiedRule
}

/**
 * Marketing Inteligente. Todas as consultas aceitam: de, ate (aaaa-mm-dd), agrupar (dia|semana|mes|trimestre|ano),
 * canal, campanha, marca, peca, uf, regiao, filial, vendedor, origem, tipoCliente, status (SIM|NAO|NEGOCIACAO), cliente (novo|recorrente).
 */
@ApiTags('Marketing Inteligente')
@Controller('marketing')
export class MarketingController {
  constructor(private readonly mkt: MarketingService) {}

  @Get('opcoes')
  @RequirePermission('mkt_paineis', 'view')
  options(@CurrentUser() user: AuthUser) {
    return this.mkt.options(user)
  }

  @Get('visao-geral')
  @RequirePermission('mkt_paineis', 'view')
  overview(@CurrentUser() user: AuthUser, @Query() q: Q) {
    return this.mkt.overview(user, q)
  }

  @Get('executivo')
  @RequirePermission('mkt_paineis', 'view')
  executive(@CurrentUser() user: AuthUser, @Query() q: Q) {
    return this.mkt.executive(user, q)
  }

  @Get('leads')
  @RequirePermission('mkt_paineis', 'view')
  leads(@CurrentUser() user: AuthUser, @Query() q: Q) {
    return this.mkt.leads(user, q)
  }

  @Get('email')
  @RequirePermission('mkt_paineis', 'view')
  email(@CurrentUser() user: AuthUser, @Query() q: Q) {
    return this.mkt.email(user, q)
  }

  /** Funil; comparar = canal|campanha|vendedor|uf|regiao|filial|marca|peca|origem|tipoCliente. */
  @Get('funil')
  @RequirePermission('mkt_paineis', 'view')
  funnel(@CurrentUser() user: AuthUser, @Query() q: Q) {
    return this.mkt.funnel(user, q)
  }

  @Get('campanhas')
  @RequirePermission('mkt_paineis', 'view')
  campaigns(@CurrentUser() user: AuthUser, @Query() q: Q) {
    return this.mkt.campaigns(user, q)
  }

  /** Comparação de 2 a 6 campanhas no mesmo período: chaves=a,b,c (chaves da lista de campanhas). */
  @Get('campanhas-comparar')
  @RequirePermission('mkt_paineis', 'view')
  compare(@CurrentUser() user: AuthUser, @Query() q: Q) {
    return this.mkt.compare(user, (q.chaves ?? '').split(',').filter(Boolean), q)
  }

  @Get('campanhas/:chave')
  @RequirePermission('mkt_paineis', 'view')
  campaign(@CurrentUser() user: AuthUser, @Param('chave') key: string, @Query() q: Q) {
    return this.mkt.campaign(user, key, q)
  }

  @Get('saude')
  @RequirePermission('mkt_integracoes', 'view')
  health(@CurrentUser() user: AuthUser) {
    return this.mkt.health(user)
  }

  @Get('regras')
  @RequirePermission('mkt_integracoes', 'view')
  config(@CurrentUser() user: AuthUser) {
    return this.mkt.configView(user.tenantId)
  }

  @Put('regras')
  @RequirePermission('mkt_integracoes', 'edit')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: ConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.mkt.saveConfig(user, dto, ctx)
  }
}
