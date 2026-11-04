import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiTags } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { TvService } from './tv.service'

class TvLinkDto {
  @IsString() @MaxLength(20) kind!: string
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) name?: string | null
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsUUID() unitId?: string | null
  @IsString() @MaxLength(64) pin!: string
}

class TvPinDto {
  @IsString() @MaxLength(64) pin!: string
}

/** Abertura do link na TV (sem login): confere se precisa de senha e troca a senha pela chave do navegador. */
@ApiTags('TV')
@Controller('tv/acesso')
export class TvAccessController {
  constructor(private readonly tv: TvService) {}

  @Public()
  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  status(@Param('token') token: string, @Headers('x-tv-key') key: string | undefined) {
    return this.tv.status(token, key)
  }

  @Public()
  @Post(':token')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  unlock(@Param('token') token: string, @Body() dto: TvPinDto) {
    return this.tv.unlock(token, dto.pin)
  }
}

@ApiTags('TV')
@Controller('tv/links')
export class TvController {
  constructor(private readonly tv: TvService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tipo') tipo: string) {
    return this.tv.list(user, String(tipo ?? ''))
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: TvLinkDto, @ReqContext() ctx: RequestCtx) {
    return this.tv.create(user, dto, ctx)
  }

  @Put(':id/senha')
  setPin(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TvPinDto, @ReqContext() ctx: RequestCtx) {
    return this.tv.setPin(user, id, dto.pin, ctx)
  }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.tv.revoke(user, id, ctx)
  }
}
