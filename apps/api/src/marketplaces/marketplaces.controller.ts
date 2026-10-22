import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import type { Response } from 'express'
import { AuditService } from '../audit/audit.service'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { BiArchiveService } from './bi.service'
import { MarketplacesService } from './marketplaces.service'
import { mlView, todayBr } from './mercadolivre'
import { MercadoLivreService } from './mercadolivre.service'
import { MlQuestionsService } from './perguntas.service'

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

class BiLeadsDto extends PeriodDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @IsString() @MaxLength(40) fonte?: string
  @IsOptional() @IsIn(['VENDEU', 'NAO_VENDEU', 'SEM_SITUACAO']) situacao?: string
  @IsOptional() @IsIn(['PRE_VENDA', 'POS_VENDA']) atendimento?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100) pageSize = 50
}

class QuestionsListDto {
  @IsOptional() @IsIn(['abertas', 'respondidas', 'todas']) filtro: 'abertas' | 'respondidas' | 'todas' = 'abertas'
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
}

class QuestionsConfigDto {
  @IsBoolean() enabled!: boolean
  @IsIn(['sugerir', 'automatico']) mode!: 'sugerir' | 'automatico'
  @IsBoolean() askCep!: boolean
  @IsString() @MaxLength(300) intro!: string
  @IsString() @MaxLength(500) outro!: string
  @IsString() @MaxLength(800) askCepText!: string
}

class TestQuoteDto {
  @IsOptional() @Matches(/^[A-Za-z]{3}\d{5,15}$/, { message: 'Anúncio no formato MLB1234567890.' }) itemId?: string
  @IsOptional() @IsString() @MaxLength(80) sku?: string
  @IsString() @MaxLength(12) cep!: string
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number
}

class AnswerDto {
  @IsString() @MaxLength(2000) text!: string
}

class RequoteDto {
  @IsOptional() @IsString() @MaxLength(12) cep?: string
}

/** Período padrão: últimos 30 dias até ontem (o Mercado Livre fecha o dia seguinte). */
function period(q: PeriodDto) {
  const to = q.ate ?? todayBr()
  const from = q.de ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)
  if (from > to) throw new BadRequestException('A data inicial precisa ser antes da final.')
  if (Date.parse(to) - Date.parse(from) > 3 * 366 * 86_400_000) throw new BadRequestException('Escolha um período de até 3 anos.')
  return { from, to }
}

@ApiTags('Marketplaces')
@Controller('marketplaces')
export class MarketplacesController {
  constructor(
    private readonly panels: MarketplacesService,
    private readonly ml: MercadoLivreService,
    private readonly bi: BiArchiveService,
    private readonly questionsSvc: MlQuestionsService,
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
    const [c, sync, bi] = await Promise.all([this.ml.config(user.tenantId), this.ml.syncState(user.tenantId), this.bi.meta()])
    return { ...mlView(c), redirectUri: this.ml.redirectUri(), sync, biAvailable: bi?.tenantId === user.tenantId, biImportedAt: bi?.tenantId === user.tenantId ? bi.importedAt : null }
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
    const r = await this.ml.completeAuthorization(user, dto.code, dto.state)
    await this.audit.byUser(user, ctx, 'marketplaces.ml_connected', 'settings', 'marketplace_ml', { conta: r.nickname })
    return r
  }

  @Get('mercado-livre/anunciantes')
  @RequirePermission('marketplaces', 'edit')
  advertisers(@CurrentUser() user: AuthUser) {
    return this.ml.listAdvertisers(user.tenantId)
  }

  @Put('mercado-livre/anunciante')
  @RequirePermission('marketplaces', 'edit')
  async advertiser(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: AdvertiserDto) {
    const c = await this.ml.selectAdvertiser(user.tenantId, dto.advertiserId)
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

  // ---------- Perguntas de frete do Mercado Livre ----------

  @Get('mercado-livre/perguntas')
  @RequirePermission('marketplaces', 'view')
  async questions(@CurrentUser() user: AuthUser, @Query() q: QuestionsListDto) {
    const [list, config] = await Promise.all([this.questionsSvc.list(user.tenantId, q.filtro, q.page), this.questionsSvc.config(user.tenantId)])
    return { ...list, config }
  }

  @Put('mercado-livre/perguntas/config')
  @RequirePermission('marketplaces', 'edit')
  async questionsConfig(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: QuestionsConfigDto) {
    const c = await this.questionsSvc.saveConfig(user.tenantId, dto)
    await this.audit.byUser(user, ctx, 'marketplaces.ml_questions_config', 'settings', 'marketplace_ml_perguntas', { ligado: c.enabled, modo: c.mode, pedirCep: c.askCep })
    return c
  }

  @Post('mercado-livre/perguntas/verificar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('marketplaces', 'edit')
  checkQuestions(@CurrentUser() user: AuthUser) {
    return this.questionsSvc.check(user.tenantId)
  }

  @Post('mercado-livre/perguntas/testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermission('marketplaces', 'edit')
  testQuote(@CurrentUser() user: AuthUser, @Body() dto: TestQuoteDto) {
    return this.questionsSvc.test(user.tenantId, dto)
  }

  @Post('mercado-livre/perguntas/:id/enviar')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  async sendAnswer(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    const r = await this.questionsSvc.send(user, id, dto.text)
    await this.audit.byUser(user, ctx, 'marketplaces.ml_question_answered', 'marketplace_question', id, { pergunta: r.questionId })
    return r
  }

  @Post('mercado-livre/perguntas/:id/recalcular')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  requote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequoteDto) {
    return this.questionsSvc.requote(user.tenantId, id, dto.cep)
  }

  @Post('mercado-livre/perguntas/:id/ignorar')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  ignoreQuestion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.questionsSvc.ignore(user.tenantId, id)
  }

  // ---------- Histórico do sistema anterior ----------

  @Get('bi')
  @RequirePermission('bi_historico', 'view')
  biStatus(@CurrentUser() user: AuthUser) {
    return this.bi.status(user.tenantId)
  }

  @Post('bi/importar-marketplace')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  async biImport(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    const r = await this.bi.importMarketplace(user.tenantId)
    await this.audit.byUser(user, ctx, 'marketplaces.bi_import', 'marketplace', 'mercadolivre', { registros: r.rows })
    return r
  }

  @Get('bi/leads')
  @RequirePermission('bi_historico', 'view')
  biLeads(@CurrentUser() user: AuthUser, @Query() q: BiLeadsDto) {
    return this.bi.leads(user.tenantId, q, q.page, q.pageSize)
  }

  @Get('bi/investimentos')
  @RequirePermission('bi_historico', 'view')
  biSpend(@CurrentUser() user: AuthUser) {
    return this.bi.spend(user.tenantId)
  }

  @Get('bi/google-ads')
  @RequirePermission('bi_historico', 'view')
  biGoogleAds(@CurrentUser() user: AuthUser) {
    return this.bi.googleAds(user.tenantId)
  }

  @Get('bi/exportar/:tabela')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermission('bi_historico', 'export')
  async biExport(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('tabela') table: string, @Res() res: Response) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(table)) throw new BadRequestException('Tabela inválida.')
    const f = await this.bi.exportTable(user.tenantId, table)
    await this.audit.byUser(user, ctx, 'marketplaces.bi_export', 'bi', table)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`)
    res.send(f.csv)
  }
}
