import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { SUGGESTION_STATUS } from './sugestoes'
import { SugestoesService } from './sugestoes.service'

class CreateDto {
  @ApiProperty() @IsString() @Length(3, 120) title!: string
  @ApiProperty() @IsString() @Length(5, 4000) description!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) area?: string
}

class ListDto {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() todas?: boolean
  @IsOptional() @IsIn(SUGGESTION_STATUS) situacao?: string
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) pagina?: number
}

class AnswerDto {
  @ApiPropertyOptional({ enum: SUGGESTION_STATUS }) @IsOptional() @IsIn(SUGGESTION_STATUS) status?: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(4000) reply?: string | null
}

/** Sugestões de melhoria (todos enviam; a permissão "Sugestões" analisa e responde). */
@ApiTags('Sugestões')
@Controller('sugestoes')
export class SugestoesController {
  constructor(private readonly sugestoes: SugestoesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    return this.sugestoes.list(user, { all: q.todas, status: q.situacao, search: q.busca, page: q.pagina })
  }

  @Get('avisos')
  alerts(@CurrentUser() user: AuthUser) {
    return this.sugestoes.alerts(user)
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('imagem', { limits: { fileSize: 3 * 1024 * 1024 } }))
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto, @UploadedFile() image: Express.Multer.File | undefined, @ReqContext() ctx: RequestCtx) {
    return this.sugestoes.create(user, dto, image, ctx)
  }

  @Post(':id/vista')
  @HttpCode(200)
  seen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sugestoes.markSeen(user, id)
  }

  @Patch(':id')
  answer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto, @ReqContext() ctx: RequestCtx) {
    return this.sugestoes.answer(user, id, dto, ctx)
  }
}
