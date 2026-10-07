import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsArray, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { UF_LIST } from '../atendimento/br'
import type { LeadFilters } from '../leads/leads.service'
import { EMAIL_IMAGE_LIMIT, IMAGE_UPLOAD_LIMIT } from '../files/files.service'
import { EmailService, PIXEL } from './email.service'

const STAGES = ['LEAD', 'QUALIFICADO', 'OPORTUNIDADE', 'CLIENTE'] as const
const UUID_OR_NONE = /^([0-9a-f-]{36}|none)$/

/** Mesmos filtros da base de leads (validados do mesmo jeito). */
class SegmentFiltersDto implements LeadFilters {
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @IsIn(STAGES) stage?: (typeof STAGES)[number]
  @IsOptional() @IsIn(['A', 'B', 'C', 'D', 'none']) grade?: string
  @IsOptional() @IsString() @MaxLength(60) tag?: string
  @IsOptional() @IsIn(UF_LIST) state?: string
  @IsOptional() @IsString() @Length(36, 36) ownerId?: string
  @IsOptional() @IsString() @Length(36, 36) unitId?: string
  @IsOptional() @IsString() @Length(36, 36) originId?: string
  @IsOptional() @IsIn(['true', 'false']) hasPhone?: 'true' | 'false'
  @IsOptional() @IsString() @MaxLength(10) from?: string
  @IsOptional() @IsString() @MaxLength(10) to?: string
}

class SegmentDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiProperty() @ValidateNested() @Type(() => SegmentFiltersDto) filters!: SegmentFiltersDto
}

class CampaignDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
  @ApiProperty() @IsString() @MaxLength(200) subject!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) preheader?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) fromName?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() replyTo?: string | null
  @ApiProperty() @IsArray() blocks!: unknown[]
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() segmentId?: string | null
}

class PreviewDto {
  @ApiProperty() @IsString() @MaxLength(200) subject!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) preheader?: string | null
  @ApiProperty() @IsArray() blocks!: unknown[]
}

class TestDto {
  @ApiProperty() @IsEmail({}, { message: 'E-mail inválido.' }) to!: string
}

class StartDto {
  @ApiPropertyOptional({ description: 'Vazio = enviar agora' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() scheduledAt?: string | null
}

class StatusDto {
  @ApiProperty() @IsIn(['pausar', 'retomar', 'cancelar']) action!: 'pausar' | 'retomar' | 'cancelar'
}

class SettingsDto {
  @ApiProperty() @IsString() @MaxLength(80) fromName!: string
  @ApiProperty() @ValidateIf((_, v) => v !== '') @IsEmail() replyTo!: string
  @ApiProperty() @IsString() @MaxLength(500) footerText!: string
  @ApiProperty() @Type(() => Number) @IsInt() @Min(5) @Max(1000) ratePerMinute!: number
}

class ProductQueryDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) page = 1
}

class CountDto {
  @ApiProperty() @IsObject() @ValidateNested() @Type(() => SegmentFiltersDto) filters!: SegmentFiltersDto
}

@ApiTags('E-mail marketing')
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get('configuracoes')
  async config(@CurrentUser() user: AuthUser) {
    this.email.assertCan(user, 'view')
    return this.email.configView(user.tenantId)
  }

  @Post('configuracoes/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_UPLOAD_LIMIT } }))
  uploadLogo(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @ReqContext() ctx: RequestCtx) {
    return this.email.uploadLogo(user, file, ctx)
  }

  @Post('configuracoes/logo/remover')
  @HttpCode(200)
  removeLogo(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.email.removeLogo(user, ctx)
  }

  @Get('imagens')
  images(@CurrentUser() user: AuthUser) {
    return this.email.listImages(user)
  }

  @Post('imagens')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EMAIL_IMAGE_LIMIT } }))
  uploadImage(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @ReqContext() ctx: RequestCtx) {
    return this.email.uploadImage(user, file, ctx)
  }

  @Delete('imagens/:id')
  @HttpCode(200)
  async removeImage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.email.removeImage(user, id, ctx)
    return { ok: true }
  }

  @Get('produtos')
  products(@CurrentUser() user: AuthUser, @Query() q: ProductQueryDto) {
    return this.email.searchProducts(user, q.q ?? '', q.page)
  }

  @Post('produtos/atualizar')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  refreshProducts(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.email.refreshProducts(user, ctx)
  }

  @Get('whatsapp')
  whatsapp(@CurrentUser() user: AuthUser) {
    return this.email.whatsappNumbers(user)
  }

  @Put('configuracoes')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: SettingsDto, @ReqContext() ctx: RequestCtx) {
    return this.email.saveConfig(user, dto, ctx)
  }

  @Post('publico/contar')
  @HttpCode(200)
  count(@CurrentUser() user: AuthUser, @Body() dto: CountDto) {
    return this.email.audienceCount(user, dto.filters)
  }

  @Get('segmentos')
  segments(@CurrentUser() user: AuthUser) {
    return this.email.listSegments(user)
  }

  @Post('segmentos')
  createSegment(@CurrentUser() user: AuthUser, @Body() dto: SegmentDto, @ReqContext() ctx: RequestCtx) {
    return this.email.saveSegment(user, null, dto, ctx)
  }

  @Put('segmentos/:id')
  updateSegment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SegmentDto, @ReqContext() ctx: RequestCtx) {
    return this.email.saveSegment(user, id, dto, ctx)
  }

  @Delete('segmentos/:id')
  @HttpCode(200)
  async removeSegment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.email.removeSegment(user, id, ctx)
    return { ok: true }
  }

  @Get('campanhas')
  campaigns(@CurrentUser() user: AuthUser) {
    return this.email.listCampaigns(user)
  }

  @Post('campanhas')
  create(@CurrentUser() user: AuthUser, @Body() dto: CampaignDto, @ReqContext() ctx: RequestCtx) {
    return this.email.save(user, null, dto, ctx)
  }

  @Post('previa')
  @HttpCode(200)
  preview(@CurrentUser() user: AuthUser, @Body() dto: PreviewDto) {
    return this.email.preview(user, dto)
  }

  @Get('campanhas/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.email.get(user, id)
  }

  @Put('campanhas/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CampaignDto, @ReqContext() ctx: RequestCtx) {
    return this.email.save(user, id, dto, ctx)
  }

  @Delete('campanhas/:id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.email.remove(user, id, ctx)
    return { ok: true }
  }

  @Post('campanhas/:id/duplicar')
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.email.duplicate(user, id, ctx)
  }

  @Post('campanhas/:id/teste')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  test(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TestDto, @ReqContext() ctx: RequestCtx) {
    return this.email.sendTest(user, id, dto.to, ctx)
  }

  @Post('campanhas/:id/enviar')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartDto, @ReqContext() ctx: RequestCtx) {
    return this.email.start(user, id, dto.scheduledAt ? new Date(dto.scheduledAt) : null, ctx)
  }

  @Post('campanhas/:id/situacao')
  @HttpCode(200)
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @ReqContext() ctx: RequestCtx) {
    return this.email.setStatus(user, id, dto.action, ctx)
  }

  @Get('campanhas/:id/relatorio')
  report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.email.report(user, id)
  }
}

/** Abertura (pixel) e clique dos e-mails enviados. Sem login: o token assinado identifica o destinatário. */
@ApiTags('Público')
@Controller('public/e')
export class EmailTrackingController {
  constructor(private readonly email: EmailService) {}

  @Public()
  @SkipThrottle()
  @Get('a/:token')
  async open(@Param('token') token: string, @Res() res: Response) {
    await this.email.open(token).catch(() => undefined)
    res.setHeader('Content-Type', 'image/gif')
    res.setHeader('Cache-Control', 'no-store, private')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.end(PIXEL)
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('l/:token/:i')
  async click(@Param('token') token: string, @Param('i') i: string, @Res() res: Response, @Query() _q: Record<string, string>) {
    const url = await this.email.click(token, Number(i)).catch(() => null)
    if (!url) {
      res.status(404).type('text/plain').send('Link inválido ou expirado.')
      return
    }
    res.redirect(302, url)
  }
}
