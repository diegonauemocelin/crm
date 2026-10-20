import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { INTEGRATION_KEYS, type IntegrationKey, integrationsView, type MarketingConfig, type ReportSchedule } from './config'
import { MarketingService } from './marketing.service'
import { MarketingReportsService } from './relatorios.service'

const DATE = /^\d{4}-\d{2}-\d{2}$/

class PeriodDto {
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
}

class AnalysisDto extends PeriodDto {
  @IsOptional() @IsIn(['dia', 'semana', 'mes', 'trimestre', 'ano']) visao?: string
  @IsOptional() @IsString() @MaxLength(10) plataforma?: string
  @IsOptional() @IsString() @MaxLength(40) campanha?: string
  @IsOptional() @IsString() @MaxLength(40) marca?: string
  @IsOptional() @IsString() @MaxLength(40) tipoPeca?: string
  @IsOptional() @IsString() @MaxLength(2) estado?: string
  @IsOptional() @IsString() @MaxLength(20) regiao?: string
  @IsOptional() @IsString() @MaxLength(40) filial?: string
  @IsOptional() @IsString() @MaxLength(40) vendedor?: string
  @IsOptional() @IsString() @MaxLength(40) origem?: string
  @IsOptional() @IsString() @MaxLength(40) tipoCliente?: string
  @IsOptional() @IsString() @MaxLength(12) status?: string
  @IsOptional() @IsString() @MaxLength(12) cliente?: string
}

/** Filtros da tela (nomes em português na URL) → filtros das contas. Valores inválidos são descartados depois. */
const filtersOf = (q: AnalysisDto) => ({
  platform: q.plataforma,
  campaignId: q.campanha,
  brandId: q.marca,
  partTypeId: q.tipoPeca,
  state: q.estado,
  region: q.regiao,
  unitId: q.filial,
  sellerId: q.vendedor,
  originId: q.origem,
  customerTypeId: q.tipoCliente,
  saleStatus: q.status,
  cliente: q.cliente,
})

/**
 * Marketing Inteligente: cada parte respeita a sua permissão do perfil (Configurações › Perfis de acesso).
 * Só leitura do CRM; as únicas gravações são as configurações do próprio módulo.
 */
@ApiTags('Marketing Inteligente')
@Controller('marketing')
export class MarketingController {
  constructor(
    private readonly mkt: MarketingService,
    private readonly reports: MarketingReportsService,
  ) {}

  /** Módulos do Marketing Inteligente que podem usar os dados de análise (cada tela pede o seu). */
  private static readonly ANALYSIS_MODULES = ['mi_executivo', 'mi_midia', 'mi_comercial', 'mi_ia', 'mi_orcamento', 'mi_seo', 'mi_social', 'mi_config']

  private assertAny(user: AuthUser, modules: string[]) {
    let last: unknown
    for (const m of modules) {
      try {
        this.mkt.assertCan(user, m)
        return
      } catch (err) {
        last = err
      }
    }
    throw last
  }

  @Get('opcoes')
  options(@CurrentUser() user: AuthUser) {
    this.assertAny(user, [...MarketingController.ANALYSIS_MODULES, 'mi_relatorios', 'mi_config'])
    return this.mkt.options(user)
  }

  @Get('analise')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  analysis(@CurrentUser() user: AuthUser, @Query() q: AnalysisDto) {
    this.assertAny(user, MarketingController.ANALYSIS_MODULES)
    return this.mkt.analysis(user, { from: q.de, to: q.ate, visao: q.visao, filters: filtersOf(q) })
  }

  @Get('email')
  email(@CurrentUser() user: AuthUser, @Query() q: PeriodDto) {
    this.mkt.assertCan(user, 'mi_comercial')
    return this.mkt.email(user.tenantId, { from: q.de, to: q.ate })
  }

  @Get('saude')
  health(@CurrentUser() user: AuthUser) {
    this.assertAny(user, ['mi_config', 'mi_executivo'])
    return this.mkt.health(user.tenantId)
  }

  // ---------- Configurações (Configurações › Marketing Inteligente) ----------

  @Get('configuracoes')
  async getConfig(@CurrentUser() user: AuthUser) {
    this.mkt.assertCan(user, 'mi_config')
    const [config, integrations] = await Promise.all([this.mkt.config(user.tenantId), this.mkt.integrations(user.tenantId)])
    return { config, integrations: integrationsView(integrations) }
  }

  @Put('configuracoes')
  saveConfig(@CurrentUser() user: AuthUser, @Body() body: Partial<MarketingConfig>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_config', 'edit')
    return this.mkt.saveConfig(user, body ?? {}, ctx)
  }

  @Put('integracoes/:key')
  saveIntegration(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() body: Record<string, unknown>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_config', 'edit')
    return this.mkt.saveIntegration(user, this.integrationKey(key), body ?? {}, ctx)
  }

  @Post('integracoes/:key/testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testIntegration(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    this.mkt.assertCan(user, 'mi_config', 'edit')
    return this.mkt.testIntegration(user, this.integrationKey(key))
  }

  private integrationKey(key: string): IntegrationKey {
    if (!(INTEGRATION_KEYS as string[]).includes(key)) throw new NotFoundException()
    return key as IntegrationKey
  }

  // ---------- Relatórios automáticos ----------

  @Get('relatorios')
  listReports(@CurrentUser() user: AuthUser) {
    this.mkt.assertCan(user, 'mi_relatorios')
    return this.reports.view(user)
  }

  @Post('relatorios')
  createReport(@CurrentUser() user: AuthUser, @Body() body: Partial<ReportSchedule>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_relatorios', 'create')
    return this.reports.save(user, null, body ?? {}, ctx)
  }

  @Post('relatorios/previa')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  previewReport(@CurrentUser() user: AuthUser, @Body() body: Partial<ReportSchedule>) {
    this.mkt.assertCan(user, 'mi_relatorios')
    return this.reports.preview(user, body ?? {})
  }

  @Put('relatorios/:id')
  updateReport(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Partial<ReportSchedule>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_relatorios', 'edit')
    return this.reports.save(user, id, body ?? {}, ctx)
  }

  @Delete('relatorios/:id')
  removeReport(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_relatorios', 'delete')
    return this.reports.remove(user, id, ctx)
  }

  @Post('relatorios/:id/enviar')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  sendReport(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_relatorios', 'edit')
    return this.reports.sendNow(user, id, ctx)
  }
}
