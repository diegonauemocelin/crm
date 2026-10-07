import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import type { Response } from 'express'
import { UF_LIST, UFS } from '../atendimento/br'
import { CurrentUser, Public, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { LeadStage } from '../generated/prisma/enums'
import { LeadConfigService } from './lead-config.service'
import { LeadImportService } from './lead-import.service'
import { LeadSyncService } from './lead-sync.service'
import { type LeadFilters, LeadsService, STAGE_LABEL } from './leads.service'
import type { ImportOptions, Mapping } from './mapeamento'

const STAGES = ['LEAD', 'QUALIFICADO', 'OPORTUNIDADE', 'CLIENTE'] as const
const UUID_OR_NONE = /^([0-9a-f-]{36}|none)$/

class FiltersDto implements LeadFilters {
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @IsIn(STAGES) stage?: LeadStage
  @IsOptional() @IsIn(['A', 'B', 'C', 'D', 'none']) grade?: string
  @IsOptional() @IsString() @MaxLength(60) tag?: string
  @IsOptional() @IsIn(UF_LIST) state?: string
  @IsOptional() @Matches(UUID_OR_NONE) ownerId?: string
  @IsOptional() @Matches(UUID_OR_NONE) unitId?: string
  @IsOptional() @Matches(UUID_OR_NONE) originId?: string
  @IsOptional() @IsIn(['true', 'false']) emailOptIn?: 'true' | 'false'
  @IsOptional() @IsIn(['true', 'false']) hasPhone?: 'true' | 'false'
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string
}

class ListDto extends FiltersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(200) pageSize = 50
  @IsOptional() @IsIn(['recent', 'name', 'score', 'activity']) sort = 'recent'
}

class LeadDto {
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(160) name?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail({}, { message: 'E-mail inválido.' }) email?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) phone?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(160) company?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) jobTitle?: string | null
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 40) country?: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(UF_LIST) state?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) city?: string | null
  @ApiPropertyOptional({ enum: STAGES }) @IsOptional() @IsIn(STAGES) stage?: LeadStage
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() ownerId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unitId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() originId?: string | null
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(60, { each: true }) tags?: string[]
  @ApiPropertyOptional() @IsOptional() @IsObject() customFields?: Record<string, unknown>
}

class BulkDto {
  @ApiPropertyOptional({ description: 'Leads escolhidos um a um' }) @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID('all', { each: true }) ids?: string[]
  @ApiPropertyOptional({ description: 'Ou: todos os leads deste filtro' }) @IsOptional() @ValidateNested() @Type(() => FiltersDto) filters?: FiltersDto
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) addTags?: string[]
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) removeTags?: string[]
  @ApiPropertyOptional({ enum: STAGES }) @IsOptional() @IsIn(STAGES) stage?: LeadStage
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() ownerId?: string | null
}

class ConsentDto {
  @ApiProperty() @IsBoolean() granted!: boolean
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) text?: string
}

class AnalyzeDto {
  @ApiProperty() @IsObject() mapping!: Mapping
  @ApiProperty() @IsObject() options!: ImportOptions
}

class FieldDto {
  @ApiProperty() @IsString() @Length(2, 60) label!: string
  @ApiProperty() @IsIn(['TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'BOOLEAN']) type!: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTISELECT' | 'BOOLEAN'
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(80, { each: true }) options?: string[]
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) position?: number
}

class RuleDto {
  @ApiProperty() @IsIn(['PERFIL', 'INTERESSE']) dimension!: 'PERFIL' | 'INTERESSE'
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiProperty() @IsString() @Matches(/^(stage|state|tag|has_phone|has_email|custom:[a-z0-9_]+|conversao|atendimento|venda|email_aberto|email_clique|visita|carrinho|checkout|carrinho_abandonado)$/) field!: string
  @ApiProperty() @IsIn(['eq', 'in', 'exists', 'gte', 'each']) operator!: string
  @ApiPropertyOptional() @IsOptional() value?: unknown
  @ApiProperty() @Type(() => Number) @IsInt() @Min(-100) @Max(100) points!: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
}

class ScoreSettingsDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(7) @Max(730) interestWindowDays!: number
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(200) gradeA!: number
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(200) gradeB!: number
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(200) gradeC!: number
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(500) maxProfile!: number
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(500) maxInterest!: number
}

class TagRenameDto {
  @ApiProperty() @IsString() @Length(1, 60) from!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(1, 60) to?: string | null
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

@ApiTags('Leads')
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly imports: LeadImportService,
    private readonly config: LeadConfigService,
    private readonly sync: LeadSyncService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    const { page, pageSize, sort, ...filters } = q
    return this.leads.list(user, filters, page, pageSize, sort)
  }

  @Get('exportar')
  async export(@CurrentUser() user: AuthUser, @Query() q: FiltersDto, @Res() res: Response) {
    const rows = await this.leads.exportRows(user, q)
    const header = ['Nome', 'E-mail', 'Telefone', 'Empresa', 'Cargo', 'Cidade', 'Estado', 'Estágio', 'Nota', 'Pontos perfil', 'Pontos interesse', 'Tags', 'Responsável', 'Unidade', 'Origem', 'Aceita e-mail', 'Última venda', 'Valor última venda', 'Cadastro']
    const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d) : '')
    const lines = rows.map((l) =>
      [
        l.name, l.email, l.phone, l.company, l.jobTitle, l.city, l.state ? (UFS[l.state as keyof typeof UFS]?.name ?? l.state) : '', STAGE_LABEL[l.stage],
        l.scoreGrade, l.scoreProfile, l.scoreInterest, l.tags.join(', '), l.owner?.name, l.unit?.name, l.origin?.name, l.emailOptIn ? 'Sim' : 'Não',
        fmt(l.lastSaleAt), l.lastSaleValue === null ? '' : Number(l.lastSaleValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 }), fmt(l.createdAt),
      ]
        .map(csvCell)
        .join(';'),
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send('﻿' + [header.join(';'), ...lines].join('\r\n'))
  }

  @Post('massa')
  @HttpCode(200)
  bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkDto, @ReqContext() ctx: RequestCtx) {
    const { ids, filters, ...action } = dto
    return this.leads.bulk(user, { ids, filters }, action, ctx)
  }

  @Post('vincular-atendimentos')
  @HttpCode(200)
  @RequirePermission('leads', 'edit')
  linkRecords(@CurrentUser() user: AuthUser) {
    return this.sync.linkAll(user.tenantId)
  }

  // ---------- Importação ----------

  @Get('importacoes')
  importsList(@CurrentUser() user: AuthUser) {
    return this.imports.list(user)
  }

  @Post('importacoes')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 60 * 1024 * 1024 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @ReqContext() ctx: RequestCtx) {
    return this.imports.upload(user, file, ctx)
  }

  @Get('importacoes/:id')
  importStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.status(user, id)
  }

  @Post('importacoes/:id/analisar')
  @HttpCode(200)
  analyze(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnalyzeDto) {
    return this.imports.analyze(user, id, dto.mapping, dto.options)
  }

  @Post('importacoes/:id/executar')
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.imports.start(user, id, ctx)
  }

  // ---------- Configuração (campos, scoring, tags) ----------

  @Get('config/campos')
  @RequirePermission('leads', 'view')
  fields(@CurrentUser() user: AuthUser) {
    return this.config.listFields(user.tenantId)
  }

  @Post('config/campos')
  @RequirePermission('configuracoes', 'edit')
  createField(@CurrentUser() user: AuthUser, @Body() dto: FieldDto, @ReqContext() ctx: RequestCtx) {
    return this.config.saveField(user, null, dto, ctx)
  }

  @Put('config/campos/:id')
  @RequirePermission('configuracoes', 'edit')
  updateField(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FieldDto, @ReqContext() ctx: RequestCtx) {
    return this.config.saveField(user, id, dto, ctx)
  }

  @Get('config/scoring')
  @RequirePermission('leads', 'view')
  async scoring(@CurrentUser() user: AuthUser) {
    const [rules, settings] = await Promise.all([this.config.listRules(user.tenantId), this.config.scoreSettings(user.tenantId)])
    return { rules, settings }
  }

  @Put('config/scoring')
  @RequirePermission('configuracoes', 'edit')
  saveScoring(@CurrentUser() user: AuthUser, @Body() dto: ScoreSettingsDto, @ReqContext() ctx: RequestCtx) {
    return this.config.saveScoreSettings(user, dto, ctx)
  }

  @Post('config/scoring/regras')
  @RequirePermission('configuracoes', 'edit')
  createRule(@CurrentUser() user: AuthUser, @Body() dto: RuleDto, @ReqContext() ctx: RequestCtx) {
    return this.config.saveRule(user, null, dto, ctx)
  }

  @Put('config/scoring/regras/:id')
  @RequirePermission('configuracoes', 'edit')
  updateRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RuleDto, @ReqContext() ctx: RequestCtx) {
    return this.config.saveRule(user, id, dto, ctx)
  }

  @Delete('config/scoring/regras/:id')
  @HttpCode(200)
  @RequirePermission('configuracoes', 'edit')
  async removeRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.config.removeRule(user, id, ctx)
    return { ok: true }
  }

  @Get('config/tags')
  @RequirePermission('leads', 'view')
  tags(@CurrentUser() user: AuthUser) {
    return this.config.listTags(user.tenantId)
  }

  @Post('config/tags/renomear')
  @HttpCode(200)
  @RequirePermission('leads', 'edit')
  renameTag(@CurrentUser() user: AuthUser, @Body() dto: TagRenameDto, @ReqContext() ctx: RequestCtx) {
    return this.config.renameTag(user, dto.from, dto.to ?? null, ctx)
  }

  // ---------- Lead individual ----------

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: LeadDto, @ReqContext() ctx: RequestCtx) {
    return this.leads.create(user, dto, ctx)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(user, id)
  }

  @Get(':id/linha-do-tempo')
  timeline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.timeline(user, id)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LeadDto, @ReqContext() ctx: RequestCtx) {
    return this.leads.update(user, id, dto, ctx)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.leads.remove(user, id, ctx)
    return { ok: true }
  }

  @Post(':id/consentimento')
  @HttpCode(200)
  consent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConsentDto, @ReqContext() ctx: RequestCtx) {
    return this.leads.consent(user, id, dto.granted, dto.text, ctx)
  }

  @Get(':id/lgpd/exportar')
  async exportPersonal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx, @Res() res: Response) {
    const data = await this.leads.exportPersonal(user, id, ctx)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="dados-titular-${id.slice(0, 8)}.json"`)
    res.send(JSON.stringify(data, null, 2))
  }

  @Post(':id/lgpd/anonimizar')
  @HttpCode(200)
  async anonymize(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.leads.anonymize(user, id, ctx)
    return { ok: true }
  }

  @Get(':id/link-descadastro')
  @RequirePermission('leads', 'view')
  async unsubscribeLink(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.leads.get(user, id)
    return { token: this.leads.unsubscribeToken(id) }
  }
}

/** Descadastro em 1 clique, sem login (link dos e-mails de marketing). */
@ApiTags('Público')
@Controller('public/descadastro')
export class UnsubscribeController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  info(@Param('token') token: string) {
    if (token.length > 200) return { email: null, subscribed: false }
    return this.leads.unsubscribeInfo(token)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(200)
  unsubscribe(@Param('token') token: string, @ReqContext() ctx: RequestCtx) {
    return this.leads.unsubscribe(token.slice(0, 200), ctx.ip)
  }
}
