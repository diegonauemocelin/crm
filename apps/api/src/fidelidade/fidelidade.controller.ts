import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator'
import type { Request, Response } from 'express'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { FidelidadeService } from './fidelidade.service'
import { FidelidadeJobsService } from './jobs.service'
import { FidelidadePublicoService } from './publico.service'

class FidConfigDto {
  @IsObject() config!: Record<string, unknown>
}

class FidRewardDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string
  @IsOptional() @IsString() @MaxLength(500) description?: string | null
  @IsOptional() @IsIn(['BRINDE', 'DESCONTO', 'CASHBACK', 'BENEFICIO']) kind?: string
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) pointsCost?: number
  @IsOptional() @IsUUID() giftId?: string | null
  @IsOptional() @IsIn(['VALOR', 'PERCENTUAL']) discountType?: string | null
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) value?: number | null
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) stock?: number | null
  @IsOptional() @IsInt() @Min(1) @Max(1000) perCustomer?: number | null
  @IsOptional() @IsString() @MaxLength(30) minLevel?: string | null
  @IsOptional() @IsInt() @Min(1) @Max(3650) validityDays?: number | null
  @IsOptional() @IsBoolean() active?: boolean
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sort?: number
}

class FidAdjustDto {
  @IsInt() @Min(-10_000_000) @Max(10_000_000) points!: number
  @IsString() @MinLength(3) @MaxLength(300) reason!: string
}

class FidRedeemDto {
  @IsUUID() rewardId!: string
}

class FidLinkDto {
  @IsIn(['email', 'whatsapp']) channel!: 'email' | 'whatsapp'
}

class FidUseDto {
  @IsOptional() @IsString() @MaxLength(60) orderCode?: string | null
}

class FidReasonDto {
  @IsString() @MinLength(2) @MaxLength(1000) reason!: string
}

class FidNoteDto {
  @IsString() @MinLength(2) @MaxLength(1000) note!: string
}

class FidCustomersQuery {
  @IsOptional() @IsString() @MaxLength(120) busca?: string
  @IsOptional() @IsString() @MaxLength(30) nivel?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) pagina?: number
}

class FidRedemptionsQuery {
  @IsOptional() @IsIn(['PENDENTE', 'USADO', 'ENTREGUE', 'EXPIRADO', 'CANCELADO']) status?: string
  @IsOptional() @IsString() @MaxLength(120) busca?: string
}

class FidReviewsQuery {
  @IsOptional() @IsIn(['todos', 'detratores', 'pendentes', 'promotores', 'neutros']) filtro?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) meses?: number
}

class FidDashboardQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(24) meses?: number
}

/** Marketing › Fidelidade (painel da equipe). Permissão "fidelidade". */
@ApiTags('fidelidade')
@Controller('marketing/fidelidade')
export class FidelidadeController {
  constructor(
    private readonly fid: FidelidadeService,
    private readonly jobs: FidelidadeJobsService,
  ) {}

  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.fid.getConfig(user)
  }

  @Put('config')
  saveConfig(@CurrentUser() user: AuthUser, @Body() body: FidConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.saveConfig(user, body.config, ctx)
  }

  /** Roda as rotinas agora (pontos, estornos, validade, convites), sem esperar o próximo minuto. */
  @Post('rodar')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async run(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    this.fid.assertCan(user, 'edit')
    const cfg = await this.fid.config(user.tenantId)
    if (!cfg.enabled) return { enabled: false }
    void ctx
    return { enabled: true, ...(await this.jobs.runTenant(user.tenantId, cfg)) }
  }

  @Get('painel')
  dashboard(@CurrentUser() user: AuthUser, @Query() q: FidDashboardQuery) {
    return this.fid.dashboard(user, q.meses)
  }

  @Get('clientes')
  customers(@CurrentUser() user: AuthUser, @Query() q: FidCustomersQuery) {
    return this.fid.customers(user, q)
  }

  @Get('clientes/exportar')
  async exportCustomers(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Res() res: Response) {
    const content = await this.fid.exportCustomers(user, ctx)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="fidelidade-clientes.csv"')
    res.send(content)
  }

  @Get('clientes/:leadId')
  customer(@CurrentUser() user: AuthUser, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.fid.customer(user, leadId)
  }

  @Post('clientes/:leadId/ajuste')
  @HttpCode(200)
  adjust(@CurrentUser() user: AuthUser, @Param('leadId', ParseUUIDPipe) leadId: string, @Body() body: FidAdjustDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.adjust(user, leadId, body, ctx)
  }

  @Post('clientes/:leadId/resgatar')
  @HttpCode(200)
  redeem(@CurrentUser() user: AuthUser, @Param('leadId', ParseUUIDPipe) leadId: string, @Body() body: FidRedeemDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.redeemByStaff(user, leadId, body.rewardId, ctx)
  }

  @Post('clientes/:leadId/enviar-link')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendLink(@CurrentUser() user: AuthUser, @Param('leadId', ParseUUIDPipe) leadId: string, @Body() body: FidLinkDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.sendLink(user, leadId, body.channel, ctx)
  }

  /** Resumo para a ficha do lead. */
  @Get('lead/:leadId')
  forLead(@CurrentUser() user: AuthUser, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.fid.forLead(user, leadId)
  }

  @Get('premios')
  rewards(@CurrentUser() user: AuthUser) {
    return this.fid.rewards(user)
  }

  @Post('premios')
  createReward(@CurrentUser() user: AuthUser, @Body() body: FidRewardDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.saveReward(user, null, body, ctx)
  }

  @Put('premios/:id')
  updateReward(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: FidRewardDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.saveReward(user, id, body, ctx)
  }

  @Delete('premios/:id')
  removeReward(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.fid.removeReward(user, id, ctx)
  }

  @Get('resgates')
  redemptions(@CurrentUser() user: AuthUser, @Query() q: FidRedemptionsQuery) {
    return this.fid.redemptions(user, q)
  }

  @Get('resgates/codigo/:code')
  byCode(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.fid.findByCode(user, String(code).slice(0, 40))
  }

  @Post('resgates/:id/usar')
  @HttpCode(200)
  use(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: FidUseDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.useRedemption(user, id, body, ctx)
  }

  @Post('resgates/:id/cancelar')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: FidReasonDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.cancelRedemption(user, id, body.reason, ctx)
  }

  @Get('avaliacoes')
  reviews(@CurrentUser() user: AuthUser, @Query() q: FidReviewsQuery) {
    return this.fid.reviews(user, q)
  }

  @Post('avaliacoes/:id/tratar')
  @HttpCode(200)
  treat(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: FidNoteDto, @ReqContext() ctx: RequestCtx) {
    return this.fid.treatReview(user, id, body.note, ctx)
  }
}

class FidContactDto {
  @IsString() @MinLength(5) @MaxLength(200) contact!: string
}

class FidVerifyDto {
  @IsString() @MinLength(5) @MaxLength(200) contact!: string
  @IsString() @MinLength(6) @MaxLength(12) code!: string
}

class FidTokenDto {
  @IsString() @MinLength(20) @MaxLength(600) token!: string
}

class FidReviewDto {
  @IsInt() @Min(1) @Max(5) stars!: number
  @IsInt() @Min(0) @Max(10) nps!: number
  @IsOptional() @IsString() @MaxLength(2000) comment?: string
  @IsOptional() @IsObject() aspects?: Record<string, number>
}

/**
 * Página do cliente (Meus pontos), sem login do CRM: o cliente se identifica pelo token assinado (cabeçalho
 * Authorization: Bearer) obtido com o link do e-mail/WhatsApp ou com o código de 6 dígitos. Tudo com limite de tentativas.
 */
@ApiTags('Público')
@Controller('public/fidelidade')
export class FidelidadePublicoController {
  constructor(private readonly pub: FidelidadePublicoService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('config')
  config() {
    return this.pub.publicConfig()
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('codigo')
  @HttpCode(200)
  requestCode(@Body() body: FidContactDto, @Req() req: Request) {
    return this.pub.requestCode(body.contact, req.ip ?? null)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('entrar')
  @HttpCode(200)
  verify(@Body() body: FidVerifyDto, @Req() req: Request) {
    return this.pub.verifyCode(body.contact, body.code, req.ip ?? null)
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('link')
  @HttpCode(200)
  exchange(@Body() body: FidTokenDto, @Req() req: Request) {
    return this.pub.exchange(body.token, req.ip ?? null)
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('eu')
  me(@Headers('authorization') auth: string | undefined) {
    return this.pub.me(auth)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('consentimento')
  @HttpCode(200)
  consent(@Headers('authorization') auth: string | undefined, @Req() req: Request) {
    return this.pub.consent(auth, req.ip ?? null)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('resgatar')
  @HttpCode(200)
  redeem(@Headers('authorization') auth: string | undefined, @Body() body: FidRedeemDto) {
    return this.pub.redeem(auth, body.rewardId)
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('avaliacao/:orderId')
  reviewInfo(@Headers('authorization') auth: string | undefined, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.pub.reviewInfo(auth, orderId)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('avaliacao/:orderId')
  @HttpCode(200)
  review(@Headers('authorization') auth: string | undefined, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: FidReviewDto, @Req() req: Request) {
    return this.pub.submitReview(auth, orderId, body, req.ip ?? null)
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sair')
  @HttpCode(200)
  optOut(@Headers('authorization') auth: string | undefined, @Req() req: Request) {
    return this.pub.optOut(auth, req.ip ?? null)
  }
}
