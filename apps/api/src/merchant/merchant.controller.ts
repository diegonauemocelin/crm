import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Allow, IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { MerchantFreteConfig } from './frete-google'
import { MerchantFreteService } from './merchant-frete.service'

class MerchantFreteDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsString() @MaxLength(20) merchantId?: string
  @IsOptional() @IsString() @MaxLength(60) service?: string
  @IsOptional() @IsString() @MaxLength(120) developerEmail?: string
  /** Números conferidos em cleanConfig, que devolve a mensagem certa (o validador daria só "campo inválido"). */
  @Allow() handlingMin?: number
  @Allow() handlingMax?: number
  @Allow() batchSize?: number
  @Allow() magazordPerMinute?: number
  @Allow() refreshDays?: number
  /** 'magazord' ou 'crm' (conferido em cleanConfig). */
  @Allow() source?: string
  @IsOptional() @IsString() @MaxLength(40) unitId?: string | null
  /** Transportadoras (ids); conferidas em cleanConfig. */
  @IsOptional() @IsArray() carrierIds?: string[]
  /** CEPs por estado (UF → lista de CEPs); conferidos em cleanConfig. */
  @IsOptional() @IsObject() ceps?: Record<string, string[]>
}

/** Marketing › Frete no Google Shopping. */
@ApiTags('merchant')
@Controller('marketing/google-shopping/frete')
export class MerchantController {
  constructor(private readonly frete: MerchantFreteService) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.frete.view(user)
  }

  @Put()
  save(@CurrentUser() user: AuthUser, @Body() body: MerchantFreteDto, @ReqContext() ctx: RequestCtx) {
    return this.frete.save(user, body as Partial<MerchantFreteConfig>, ctx)
  }

  @Post('preparar')
  @HttpCode(200)
  prepare(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.frete.prepare(user, ctx)
  }

  @Post('atualizar')
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser) {
    return this.frete.runNow(user)
  }
}
