import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { CurrentUser, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { ConcorrentesService } from './concorrentes.service'

class AddCompetitorDto {
  @IsString() @MinLength(3) @MaxLength(1000) link!: string
}

/** Marketplaces › Concorrentes: lojas do Mercado Livre e a comparação de preço pelo código de referência. */
@ApiTags('Marketplaces')
@Controller('marketplaces/concorrentes')
export class ConcorrentesController {
  constructor(private readonly svc: ConcorrentesService) {}

  @Get()
  @RequirePermission('marketplaces', 'view')
  view(@CurrentUser() user: AuthUser) {
    return this.svc.view(user.tenantId)
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddCompetitorDto) {
    return this.svc.add(user, dto.link)
  }

  @Post(':id/atualizar')
  @HttpCode(200)
  @RequirePermission('marketplaces', 'edit')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refresh(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.refresh(user.tenantId, id)
  }

  @Delete(':id')
  @RequirePermission('marketplaces', 'edit')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user.tenantId, id)
  }
}
