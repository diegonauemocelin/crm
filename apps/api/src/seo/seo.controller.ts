import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { SeoService } from './seo.service'

class ListQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) busca?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) problema?: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) notaAte?: number
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pagina?: number
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) ordem?: string
}

class SuggestDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) ids!: string[]
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) instrucao?: string
}

class DraftDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() changeId?: string
  @ApiProperty() @IsObject() proposed!: Record<string, unknown>
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) sendFields?: string[]
}

class SendDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids!: string[]
}

/** SEO do e-commerce: nota dos produtos da Magazord, sugestões da IA, revisão, envio para a loja e desfazer. */
@ApiTags('SEO do e-commerce')
@Controller('seo-ecommerce')
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  @Get('produtos')
  list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    return this.seo.list(user, { search: q.busca, issue: q.problema, maxScore: q.notaAte, page: q.pagina, order: q.ordem })
  }

  @Post('analisar')
  @HttpCode(200)
  analyze(@CurrentUser() user: AuthUser) {
    return this.seo.startAnalysis(user)
  }

  @Get('revisao')
  review(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.seo.review(user, status)
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('sugerir')
  @HttpCode(200)
  suggest(@CurrentUser() user: AuthUser, @Body() dto: SuggestDto) {
    return this.seo.suggest(user, dto.ids, dto.instrucao)
  }

  @Post('enviar')
  @HttpCode(200)
  send(@CurrentUser() user: AuthUser, @Body() dto: SendDto, @ReqContext() ctx: RequestCtx) {
    return this.seo.send(user, dto.ids, ctx)
  }

  @Post('alteracoes/:id/descartar')
  @HttpCode(200)
  discard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.seo.discard(user, id)
  }

  @Post('alteracoes/:id/desfazer')
  @HttpCode(200)
  undo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.seo.undo(user, id, ctx)
  }

  @Get('produtos/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.seo.get(user, id)
  }

  @Post('produtos/:id/atualizar')
  @HttpCode(200)
  refresh(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.seo.refresh(user, id)
  }

  @Put('produtos/:id/rascunho')
  draft(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DraftDto) {
    return this.seo.saveDraft(user, id, dto)
  }
}
