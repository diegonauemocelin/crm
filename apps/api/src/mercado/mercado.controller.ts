import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { MercadoService } from './mercado.service'

class MarketConfigDto {
  @IsOptional() @IsString() @MaxLength(120) company?: string
  @IsOptional() @IsString() @MaxLength(500) segment?: string
  @IsOptional() @IsString() @MaxLength(200) region?: string
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(120, { each: true }) competitors?: string[]
  @IsOptional() @IsString() @MaxLength(500) focus?: string
}

@ApiTags('Análise de mercado')
@Controller('mercado')
export class MercadoController {
  constructor(private readonly mercado: MercadoService) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.mercado.view(user)
  }

  @Put('config')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: MarketConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.mercado.saveConfig(user, dto, ctx)
  }

  @Post('analises')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  start(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.mercado.start(user, ctx)
  }

  @Get('analises/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mercado.get(user, id)
  }
}
