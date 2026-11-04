import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { TvService } from './tv.service'

class TvLinkDto {
  @IsString() @MaxLength(20) kind!: string
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) name?: string | null
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsUUID() unitId?: string | null
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

  @Delete(':id')
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.tv.revoke(user, id, ctx)
  }
}
