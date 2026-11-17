import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../../common/decorators'
import type { AuthUser } from '../../common/types'
import { channelOfSlug } from './canais'
import { CanaisService } from './canais.service'
import type { ChannelKey } from './tipos'

class AppDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) appId?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) appSecret?: string
  @ApiPropertyOptional() @IsOptional() @IsObject() extra?: Record<string, string>
}

class FeesDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() feePct?: number | null
  @ApiPropertyOptional() @IsOptional() feeFixed?: number
  @ApiPropertyOptional() @IsOptional() shipping?: number
}

class RetornoDto {
  @ApiProperty({ description: 'Todos os parâmetros que voltaram no endereço de retorno da plataforma' }) @IsObject() params!: Record<string, string>
}

class PriceItemDto {
  @ApiProperty() @IsUUID() id!: string
  @ApiProperty() price!: number
}

class PricesDto {
  @ApiProperty({ type: [PriceItemDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PriceItemDto) items!: PriceItemDto[]
}

class ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) busca?: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pagina?: number
}

const channel = (slug: string): ChannelKey => {
  const c = channelOfSlug(slug)
  if (!c) throw new BadRequestException('Marketplace inválido.')
  return c
}

/** Shopee, Amazon e TikTok Shop (Marketplaces › cada um): conexão, anúncios, margem e preços. */
@ApiTags('Marketplaces (Shopee, Amazon, TikTok Shop)')
@Controller('canais/:canal')
export class CanaisController {
  constructor(private readonly svc: CanaisService) {}

  @Get()
  view(@CurrentUser() user: AuthUser, @Param('canal') canal: string) {
    return this.svc.view(user, channel(canal))
  }

  @Put('aplicativo')
  saveApp(@CurrentUser() user: AuthUser, @Param('canal') canal: string, @Body() dto: AppDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.saveApp(user, channel(canal), dto, ctx)
  }

  @Put('tarifas')
  saveFees(@CurrentUser() user: AuthUser, @Param('canal') canal: string, @Body() dto: FeesDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.saveFees(user, channel(canal), { ...dto }, ctx)
  }

  @Post('conectar')
  @HttpCode(200)
  connect(@CurrentUser() user: AuthUser, @Param('canal') canal: string) {
    return this.svc.connect(user, channel(canal))
  }

  @Post('retorno')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  complete(@CurrentUser() user: AuthUser, @Param('canal') canal: string, @Body() dto: RetornoDto, @ReqContext() ctx: RequestCtx) {
    const params = Object.fromEntries(Object.entries(dto.params ?? {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.slice(0, 60), v.slice(0, 2000)]))
    return this.svc.complete(user, channel(canal), params, ctx)
  }

  /** Amazon: o Log-in URI (antes do retorno com o código). */
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  amazonLogin(@CurrentUser() user: AuthUser, @Param('canal') canal: string, @Body() dto: RetornoDto) {
    if (channel(canal) !== 'amazon') throw new BadRequestException('Só a Amazon usa esta etapa.')
    const params = Object.fromEntries(Object.entries(dto.params ?? {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.slice(0, 60), v.slice(0, 2000)]))
    return this.svc.amazonLogin(user, params)
  }

  @Delete('conexao')
  disconnect(@CurrentUser() user: AuthUser, @Param('canal') canal: string, @ReqContext() ctx: RequestCtx) {
    return this.svc.disconnect(user, channel(canal), ctx)
  }

  @Post('sincronizar')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  sync(@CurrentUser() user: AuthUser, @Param('canal') canal: string) {
    return this.svc.sync(user, channel(canal))
  }

  @Get('anuncios')
  listings(@CurrentUser() user: AuthUser, @Param('canal') canal: string, @Query() q: ListQueryDto) {
    return this.svc.listings(user, channel(canal), { search: q.busca, page: q.pagina })
  }

  @Post('precos')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setPrices(@CurrentUser() user: AuthUser, @Param('canal') canal: string, @Body() dto: PricesDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.setPrices(user, channel(canal), dto.items, ctx)
  }
}
