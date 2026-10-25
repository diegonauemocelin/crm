import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { FORMATS, NETWORKS, VIDEO_MAX_BYTES } from './postagens'
import { PostagensService } from './postagens.service'

class ListDto {
  @IsOptional() @IsISO8601() de?: string
  @IsOptional() @IsISO8601() ate?: string
  @IsOptional() @IsIn(['RASCUNHO', 'EM_APROVACAO', 'APROVADO', 'PUBLICANDO', 'PUBLICADO', 'ERRO']) situacao?: string
}

class PostDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) title?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2500) caption?: string
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(40, { each: true }) accountIds?: string[]
  @ApiPropertyOptional() @IsOptional() @IsIn(FORMATS) format?: string
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) mediaIds?: string[]
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: PostDto) => o.scheduledAt !== null) @IsISO8601() scheduledAt?: string | null
}

class NoteDto {
  @IsOptional() @IsString() @MaxLength(500) nota?: string
}

class MediaListDto {
  @IsOptional() @IsIn(['imagem', 'video']) tipo?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pagina?: number
}

class MediaUploadDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string
  @IsOptional() @IsIn(['upload', 'arte', 'catalogo', 'ia', 'video']) source?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) width?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) height?: number
}

class CaptionDto {
  @IsOptional() @IsString() @MaxLength(500) topic?: string
  @IsOptional() @IsIn(['instagram', 'facebook', 'ambos']) network?: string
  @IsOptional() @IsIn(FORMATS) format?: string
  @IsOptional() @IsUUID() productId?: string
  @IsOptional() @IsString() @MaxLength(2500) current?: string
  @IsOptional() @IsString() @MaxLength(400) instruction?: string
}

class PlanDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14) perWeek?: number
  @IsOptional() @IsString() @MaxLength(800) themes?: string
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(40, { each: true }) accountIds?: string[]
  @IsOptional() @IsArray() @IsIn(FORMATS, { each: true }) formats?: string[]
  @IsOptional() @IsArray() @ArrayMaxSize(6) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true }) times?: string[]
}

class DraftItemDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time!: string
  @IsIn(FORMATS) format!: string
  @IsString() @MaxLength(120) title!: string
  @IsString() @MaxLength(2500) caption!: string
  @IsOptional() @IsString() @MaxLength(400) imageIdea?: string
}

class DraftsDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => DraftItemDto) items!: DraftItemDto[]
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(40, { each: true }) accountIds!: string[]
}

class AccountDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string
  @IsIn(NETWORKS) network!: string
  @Matches(/^\d{5,25}$/) externalId!: string
  @IsString() @MaxLength(80) name!: string
  @IsOptional() @IsString() @MaxLength(40) group?: string
}

class AccountsDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AccountDto) accounts!: AccountDto[]
}

class ImageDto {
  @IsString() @MaxLength(600) idea!: string
  @IsOptional() @IsIn(FORMATS) format?: string
}

const sendFile = (res: Response, f: { mime: string; content: Buffer }, cache: string) => {
  res.setHeader('Content-Type', f.mime)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Cache-Control', cache)
  res.send(f.content)
}

@ApiTags('Postagens')
@Controller('postagens')
export class PostagensController {
  constructor(private readonly svc: PostagensService) {}

  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.svc.config(user)
  }

  @Post('testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  test(@CurrentUser() user: AuthUser) {
    return this.svc.test(user)
  }

  // Contas de publicação
  @Put('contas')
  saveAccounts(@CurrentUser() user: AuthUser, @Body() dto: AccountsDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.saveAccounts(user, dto.accounts, ctx)
  }

  @Post('contas/buscar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  discover(@CurrentUser() user: AuthUser) {
    return this.svc.discoverAccounts(user)
  }

  @Get('metricas')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  metrics(@CurrentUser() user: AuthUser, @Query('atualizar') atualizar?: string) {
    return this.svc.metrics(user, atualizar === '1')
  }

  // Biblioteca
  @Get('midias')
  media(@CurrentUser() user: AuthUser, @Query() q: MediaListDto) {
    return this.svc.media(user, { kind: q.tipo, page: q.pagina })
  }

  @Post('midias')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VIDEO_MAX_BYTES, files: 1 } }))
  addMedia(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Body() dto: MediaUploadDto) {
    return this.svc.addMedia(user, file, dto)
  }

  @Get('midias/:id/arquivo')
  async mediaFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.svc.mediaFile(user, id), 'private, max-age=86400')
  }

  @Delete('midias/:id')
  removeMedia(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.svc.removeMedia(user, id, ctx)
  }

  @Get('produtos')
  products(@CurrentUser() user: AuthUser, @Query('busca') busca?: string) {
    return this.svc.products(user, busca?.slice(0, 100))
  }

  @Get('produtos/:id/imagem')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async productImage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.svc.productImage(user, id), 'private, max-age=3600')
  }

  // IA
  @Post('ia/legenda')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  aiCaption(@CurrentUser() user: AuthUser, @Body() dto: CaptionDto) {
    return this.svc.aiCaption(user, dto)
  }

  @Post('ia/calendario')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  aiPlan(@CurrentUser() user: AuthUser, @Body() dto: PlanDto) {
    return this.svc.aiPlan(user, dto as never)
  }

  @Post('ia/rascunhos')
  @HttpCode(200)
  createDrafts(@CurrentUser() user: AuthUser, @Body() dto: DraftsDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.createDrafts(user, dto, ctx)
  }

  @Post('ia/imagem')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  aiImage(@CurrentUser() user: AuthUser, @Body() dto: ImageDto) {
    return this.svc.aiImage(user, dto)
  }

  // Postagens
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    return this.svc.list(user, { from: q.de, to: q.ate, status: q.situacao })
  }

  @Post()
  @HttpCode(200)
  create(@CurrentUser() user: AuthUser, @Body() dto: PostDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.create(user, dto, ctx)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id)
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.update(user, id, dto, ctx)
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.svc.remove(user, id, ctx)
  }

  @Post(':id/enviar-aprovacao')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.svc.submit(user, id, ctx)
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.svc.approve(user, id, ctx)
  }

  @Post(':id/devolver')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @ReqContext() ctx: RequestCtx) {
    return this.svc.reject(user, id, dto.nota ?? '', ctx)
  }

  @Post(':id/publicar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  publishNow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.svc.publishNow(user, id, ctx)
  }
}

/** Mídias das postagens para a Meta baixar na hora de publicar (endereço com o código da postagem). */
@Controller('public/postagens')
export class PublicPostagensController {
  constructor(private readonly svc: PostagensService) {}

  @Public()
  @SkipThrottle()
  @Get(':token/:media')
  async file(@Param('token') token: string, @Param('media', ParseUUIDPipe) media: string, @Res() res: Response) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return void res.status(404).end()
    sendFile(res, await this.svc.publicMedia(token, media), 'public, max-age=3600')
  }
}
