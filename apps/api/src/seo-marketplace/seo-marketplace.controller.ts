import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { SeoMarketplaceService } from './seo-marketplace.service'

const ITEM_ID = /^ML[A-Z]\d{5,15}$/

class ListQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) busca?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) problema?: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) notaAte?: number
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pagina?: number
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) ordem?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) situacao?: string
}

class SuggestDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Matches(ITEM_ID, { each: true, message: 'Anúncio inválido.' }) ids!: string[]
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) instrucao?: string
}

class DraftDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() changeId?: string
  @ApiProperty() @IsObject() proposed!: Record<string, unknown>
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) sendFields?: string[]
}

class SendDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids!: string[]
}

class ItemParam {
  @Matches(ITEM_ID, { message: 'Anúncio inválido.' }) id!: string
}

/** SEO Marketplace: nota dos anúncios do Mercado Livre, sugestões da IA, revisão, envio e desfazer. */
@ApiTags('SEO Marketplace')
@Controller('seo-marketplace')
export class SeoMarketplaceController {
  constructor(private readonly seo: SeoMarketplaceService) {}

  @Get('anuncios')
  @RequirePermission('seo_marketplace', 'view')
  list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    return this.seo.list(user, { search: q.busca, issue: q.problema, maxScore: q.notaAte, page: q.pagina, order: q.ordem, status: q.situacao })
  }

  @Get('anuncios/:id')
  @RequirePermission('seo_marketplace', 'view')
  get(@CurrentUser() user: AuthUser, @Param() p: ItemParam) {
    return this.seo.get(user, p.id)
  }

  @Put('anuncios/:id/rascunho')
  @RequirePermission('seo_marketplace', 'create')
  draft(@CurrentUser() user: AuthUser, @Param() p: ItemParam, @Body() dto: DraftDto) {
    return this.seo.saveDraft(user, p.id, dto)
  }

  @Get('revisao')
  @RequirePermission('seo_marketplace', 'view')
  review(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.seo.review(user, status)
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('sugerir')
  @HttpCode(200)
  @RequirePermission('seo_marketplace', 'create')
  suggest(@CurrentUser() user: AuthUser, @Body() dto: SuggestDto) {
    return this.seo.suggest(user, dto.ids, dto.instrucao)
  }

  @Post('enviar')
  @HttpCode(200)
  @RequirePermission('seo_marketplace', 'edit')
  send(@CurrentUser() user: AuthUser, @Body() dto: SendDto, @ReqContext() ctx: RequestCtx) {
    return this.seo.send(user, dto.ids, ctx)
  }

  @Post('alteracoes/:id/descartar')
  @HttpCode(200)
  @RequirePermission('seo_marketplace', 'create')
  discard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.seo.discard(user, id)
  }

  @Post('alteracoes/:id/desfazer')
  @HttpCode(200)
  @RequirePermission('seo_marketplace', 'edit')
  undo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.seo.undo(user, id, ctx)
  }
}
