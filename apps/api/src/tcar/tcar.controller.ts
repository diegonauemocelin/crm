import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { SEARCH_FIELDS, type SearchField, TcarService } from './tcar.service'

class SearchDto {
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @IsIn(SEARCH_FIELDS) campo?: SearchField
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() estoque?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) pagina?: number
}

class RefreshManyDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) codes!: string[]
}

class StatusQuery {
  @IsString() @MaxLength(2000) ids!: string
}

class ConfigDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsInt({ each: true }) @Min(1, { each: true }) branchIds?: number[]
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) usedInField?: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48) fullEveryHours?: number
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(240) incrementalMinutes?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() resetIdentity?: boolean
}

/**
 * PingAlive da Tcar: o servidor da Tcar (na rede da empresa) chama estes endereços com a chave da integração
 * no x-api-key. Sem login de usuário; a chave e a empresa/filial são conferidas a cada chamada.
 */
@ApiTags('Tcar (ERP)')
@Public()
@Controller('webhooks/tcar')
export class TcarWebhookController {
  constructor(private readonly tcar: TcarService) {}

  @Post('ping')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  ping(@Headers('x-api-key') key: string | undefined, @Body() body: Record<string, unknown>) {
    return this.tcar.ping(key, body ?? {})
  }

  @Post('report')
  @HttpCode(200)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  report(@Headers('x-api-key') key: string | undefined, @Body() body: Record<string, unknown>) {
    return this.tcar.report(key, body ?? {})
  }
}

@ApiTags('Tcar (ERP)')
@Controller('tcar')
export class TcarController {
  constructor(private readonly tcar: TcarService) {}

  /** Consulta de produtos (permissão "Consulta de produtos"). */
  @Get('produtos')
  search(@CurrentUser() user: AuthUser, @Query() q: SearchDto) {
    return this.tcar.search(user, { term: q.busca, field: q.campo, inStock: q.estoque, page: q.pagina })
  }

  /** Estoque na hora das primeiras peças da busca. */
  @Post('produtos/atualizar')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  refreshMany(@CurrentUser() user: AuthUser, @Body() dto: RefreshManyDto) {
    return this.tcar.refreshMany(user, dto.codes)
  }

  @Get('acoes')
  actions(@CurrentUser() user: AuthUser, @Query() q: StatusQuery) {
    return this.tcar.actionsStatus(user, q.ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)))
  }

  @Post('produtos/:codigo/atualizar')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@CurrentUser() user: AuthUser, @Param('codigo') code: string) {
    return this.tcar.refreshOne(user, String(code).slice(0, 60))
  }

  @Get('acoes/:id')
  action(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tcar.actionStatus(user, id)
  }

  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.tcar.view(user)
  }

  @Put('config')
  save(@CurrentUser() user: AuthUser, @Body() dto: ConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.tcar.save(user, dto, ctx)
  }

  @Post('config/chave')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  newKey(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.tcar.newKey(user, ctx)
  }

  @Post('config/copiar-tudo')
  @HttpCode(200)
  fullNow(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.tcar.fullNow(user, ctx)
  }
}
