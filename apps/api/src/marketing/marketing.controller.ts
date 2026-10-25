import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { can } from '../common/permissions'
import { DEFAULT_ALERT_WORDS } from '../googleads/detalhes'
import { INTEGRATION_KEYS, type IntegrationKey, integrationsView, type MarketingConfig, REPORT_SECTIONS, type ReportSchedule, type ReportSection } from './config'
import { MarketingManagementService } from './gestao.service'
import { MarketingInstagramService } from './instagram.service'
import { fetchThumb, ThumbError } from './miniaturas'
import type { AlertRule, MonthPlan } from './planejamento'
import { MarketingPlatformsService } from './plataformas.service'
import { MarketingSyncService } from './sync.service'
import { MarketingService } from './marketing.service'
import { MarketingReportsService } from './relatorios.service'

const DATE = /^\d{4}-\d{2}-\d{2}$/

class PeriodDto {
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
}

class MapDto extends PeriodDto {
  @IsOptional() @IsIn(['tudo', 'atendimento', 'ecommerce', 'marketplace']) origem?: string
}

class ThumbDto {
  @IsString() @MaxLength(2000) u!: string
}

class InstagramDto extends PeriodDto {
  @IsOptional() @Matches(/^(todas|\d{5,30})$/) conta?: string
}

class IgAccountsDto {
  @IsArray() @ArrayMaxSize(30) list!: { id?: string; username?: string; label?: string; owner?: string; sellerId?: string | null }[]
}

class CompetitorsDto {
  @IsArray() @ArrayMaxSize(10) list!: { username: string; label?: string }[]
}

class CompetitorNoteDto {
  @IsString() @MaxLength(80) username!: string
  @IsOptional() @Matches(DATE) date?: string
  @IsOptional() @IsInt() @Min(0) @Max(200) storiesSeen?: number | null
  @IsOptional() @IsBoolean() adsActive?: boolean | null
  @IsOptional() @IsString() @MaxLength(500) note?: string
}

class TermDto {
  @IsString() @MaxLength(300) term!: string
  @IsOptional() @IsIn(['negativar', 'manter', null]) status?: 'negativar' | 'manter' | null
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

class ExportDto extends AnalysisDto {
  @IsOptional() @IsIn(['pdf', 'xlsx']) formato?: string
  @IsOptional() @IsString() @MaxLength(300) secoes?: string
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
    private readonly platforms: MarketingPlatformsService,
    private readonly management: MarketingManagementService,
    private readonly sync: MarketingSyncService,
    private readonly instagramSvc: MarketingInstagramService,
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

  @Get('ao-vivo')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  live(@CurrentUser() user: AuthUser, @Query() q: MapDto) {
    this.mkt.assertCan(user, 'relatorios')
    return this.mkt.live(user.tenantId, { origin: q.origem })
  }

  @Get('mapa')
  map(@CurrentUser() user: AuthUser, @Query() q: MapDto) {
    this.mkt.assertCan(user, 'mi_executivo')
    return this.mkt.map(user.tenantId, { from: q.de, to: q.ate, origin: q.origem })
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
    const [config, integrations, sync] = await Promise.all([this.mkt.config(user.tenantId), this.mkt.integrations(user.tenantId), this.sync.states(user.tenantId)])
    return { config, integrations: integrationsView(integrations), sync, defaultNegativeWords: DEFAULT_ALERT_WORDS }
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

  @Post('integracoes/metaOrganic/buscar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  metaAssets(@CurrentUser() user: AuthUser) {
    this.mkt.assertCan(user, 'mi_config', 'edit')
    return this.instagramSvc.metaAssets(user)
  }

  @Post('integracoes/:key/sincronizar')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  syncNow(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    this.mkt.assertCan(user, 'mi_config', 'edit')
    return this.sync.syncNow(user, this.integrationKey(key))
  }

  // ---------- Plataformas ----------

  @Get('google')
  google(@CurrentUser() user: AuthUser, @Query() q: AnalysisDto) {
    this.mkt.assertCan(user, 'mi_midia')
    return this.platforms.google(user.tenantId, { from: q.de, to: q.ate, campaignId: q.campanha })
  }

  @Put('google/termos')
  reviewTerm(@CurrentUser() user: AuthUser, @Body() body: TermDto, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_midia', 'edit')
    return this.platforms.reviewTerm(user, body.term, body.status ?? null, ctx)
  }

  @Get('plataforma/:p')
  ads(@CurrentUser() user: AuthUser, @Param('p') p: string, @Query() q: AnalysisDto) {
    this.mkt.assertCan(user, 'mi_midia')
    if (p !== 'meta' && p !== 'tiktok') throw new NotFoundException()
    return this.platforms.ads(user.tenantId, p, { from: q.de, to: q.ate, campaignId: q.campanha })
  }

  @Get('seo')
  seo(@CurrentUser() user: AuthUser, @Query() q: PeriodDto) {
    this.mkt.assertCan(user, 'mi_seo')
    return this.platforms.seo(user.tenantId, { from: q.de, to: q.ate })
  }

  @Get('social')
  social(@CurrentUser() user: AuthUser, @Query() q: PeriodDto) {
    this.mkt.assertCan(user, 'mi_social')
    return this.platforms.social(user.tenantId, { from: q.de, to: q.ate })
  }

  /** Miniatura de uma publicação (imagem da CDN da Meta entregue pelo CRM). */
  @Get('miniatura')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async thumb(@CurrentUser() user: AuthUser, @Query() q: ThumbDto, @Res() res: Response) {
    this.mkt.assertCan(user, 'mi_social')
    try {
      const t = await fetchThumb(q.u)
      res.set({ 'Content-Type': t.type, 'Cache-Control': 'private, max-age=21600', 'X-Content-Type-Options': 'nosniff' })
      res.send(t.body)
    } catch (err) {
      res.status(err instanceof ThumbError ? err.status : 502).json({ message: (err as Error).message })
    }
  }

  @Get('instagram')
  instagram(@CurrentUser() user: AuthUser, @Query() q: InstagramDto) {
    this.mkt.assertCan(user, 'mi_social')
    return this.instagramSvc.view(user, { from: q.de, to: q.ate, conta: q.conta })
  }

  @Get('instagram/perfis')
  igProfiles(@CurrentUser() user: AuthUser, @Query() q: PeriodDto) {
    this.mkt.assertCan(user, 'mi_social')
    return this.instagramSvc.profiles(user, { from: q.de, to: q.ate })
  }

  @Put('instagram/perfis')
  saveIgProfiles(@CurrentUser() user: AuthUser, @Body() body: IgAccountsDto, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_social', 'edit')
    return this.instagramSvc.saveAccounts(user, body.list, ctx)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('instagram/perfis/buscar')
  @HttpCode(200)
  discoverIgProfiles(@CurrentUser() user: AuthUser) {
    this.mkt.assertCan(user, 'mi_social', 'edit')
    return this.instagramSvc.discover(user)
  }

  @Get('instagram/concorrentes')
  competitors(@CurrentUser() user: AuthUser, @Query() q: PeriodDto) {
    this.mkt.assertCan(user, 'mi_social')
    return this.instagramSvc.competitors(user, { from: q.de, to: q.ate })
  }

  @Put('instagram/concorrentes')
  saveCompetitors(@CurrentUser() user: AuthUser, @Body() body: CompetitorsDto, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_social', 'edit')
    return this.instagramSvc.saveCompetitors(user, body.list, ctx).then(async (r) => ({ ...r, busca: await this.sync.syncCompetitorsNow(user.tenantId) }))
  }

  /** Buscar agora os dados públicos dos concorrentes (sem esperar a sincronização). */
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('instagram/concorrentes/buscar')
  @HttpCode(200)
  fetchCompetitors(@CurrentUser() user: AuthUser) {
    this.mkt.assertCan(user, 'mi_social', 'edit')
    return this.sync.syncCompetitorsNow(user.tenantId)
  }

  @Post('instagram/concorrentes/registros')
  addCompetitorNote(@CurrentUser() user: AuthUser, @Body() body: CompetitorNoteDto) {
    this.mkt.assertCan(user, 'mi_social', 'create')
    return this.instagramSvc.addNote(user, body)
  }

  @Delete('instagram/concorrentes/registros/:id')
  removeCompetitorNote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    this.mkt.assertCan(user, 'mi_social', 'delete')
    return this.instagramSvc.removeNote(user, id)
  }

  @Get('editorial')
  editorial(@CurrentUser() user: AuthUser, @Query() q: PeriodDto) {
    this.mkt.assertCan(user, 'mi_social')
    return this.platforms.editorial(user.tenantId, { from: q.de, to: q.ate })
  }

  @Post('editorial')
  createEditorial(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_social', 'create')
    return this.platforms.saveEditorial(user, null, body ?? {}, ctx)
  }

  @Put('editorial/:id')
  updateEditorial(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_social', 'edit')
    return this.platforms.saveEditorial(user, id, body ?? {}, ctx)
  }

  @Delete('editorial/:id')
  removeEditorial(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_social', 'delete')
    return this.platforms.removeEditorial(user, id, ctx)
  }

  // ---------- Planejamento ----------

  @Get('planejamento/:mes')
  plan(@CurrentUser() user: AuthUser, @Param('mes') month: string) {
    this.mkt.assertCan(user, 'mi_orcamento')
    return this.management.planView(user.tenantId, month)
  }

  @Put('planejamento/:mes')
  savePlan(@CurrentUser() user: AuthUser, @Param('mes') month: string, @Body() body: Partial<MonthPlan>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_orcamento', 'edit')
    return this.management.savePlan(user, month, body ?? {}, ctx)
  }

  // ---------- Alertas ----------

  @Get('alertas')
  alerts(@CurrentUser() user: AuthUser) {
    this.mkt.assertCan(user, 'mi_relatorios')
    return this.management.alertsView(user.tenantId)
  }

  @Post('alertas')
  createAlert(@CurrentUser() user: AuthUser, @Body() body: Partial<AlertRule>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_relatorios', 'create')
    return this.management.saveRule(user, null, body ?? {}, ctx)
  }

  @Post('alertas/testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testAlerts(@CurrentUser() user: AuthUser) {
    this.mkt.assertCan(user, 'mi_relatorios')
    return this.management.evaluateNow(user.tenantId)
  }

  @Put('alertas/:id')
  updateAlert(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Partial<AlertRule>, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_relatorios', 'edit')
    return this.management.saveRule(user, id, body ?? {}, ctx)
  }

  @Delete('alertas/:id')
  removeAlert(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    this.mkt.assertCan(user, 'mi_relatorios', 'delete')
    return this.management.removeRule(user, id, ctx)
  }

  // ---------- IA e arquivos ----------

  @Post('ia/resumo')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  aiSummary(@CurrentUser() user: AuthUser, @Query() q: AnalysisDto) {
    this.mkt.assertCan(user, 'mi_ia')
    return this.management.aiSummary(user.tenantId, { from: q.de, to: q.ate, filters: filtersOf(q) })
  }

  @Get('exportar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async exportFile(@CurrentUser() user: AuthUser, @Query() q: ExportDto, @Res() res: Response) {
    if (!can(user.permissions, user.role.isSystem, 'mi_executivo', 'export') && !can(user.permissions, user.role.isSystem, 'mi_relatorios', 'view')) {
      throw new ForbiddenException('Seu perfil não pode exportar o Marketing Inteligente (Exportar em Dashboard executivo ou acesso aos Relatórios).')
    }
    const sections = (q.secoes ?? 'kpis,plataformas,campanhas,funil,vendedores,regioes,marcas,categorias,origens,recomendacoes').split(',').filter((x) => REPORT_SECTIONS.some((s) => s.key === x)) as ReportSection[]
    const f = await this.management.file(user.tenantId, q.formato === 'xlsx' ? 'xlsx' : 'pdf', { from: q.de, to: q.ate, filters: filtersOf(q), sections: sections.length ? sections : ['kpis'], title: 'Relatório de marketing' })
    res.setHeader('Content-Type', f.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(f.content)
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
