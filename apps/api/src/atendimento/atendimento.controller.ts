import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { ServiceKind } from '../generated/prisma/enums'
import { SettingsService } from '../settings/settings.service'
import { AuditService } from '../audit/audit.service'
import { UFS, UF_LIST } from './br'
import { CadastrosService, LOOKUP_TYPES } from './cadastros.service'
import { ImportService } from './import.service'
import { DEFAULT_ATENDIMENTO, ServiceRecordsService, type RecordFilters } from './service-records.service'

const KINDS = ['PRE_VENDAS', 'POS_VENDAS'] as const
const SALE = ['SIM', 'NAO', 'NEGOCIACAO'] as const
const RETURN = ['SIM', 'NAO', 'PENDENTE'] as const

class FiltersDto implements RecordFilters {
  @IsIn(KINDS) kind!: ServiceKind
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @Matches(/^([0-9a-f-]{36}|none)$/) sellerId?: string
  @IsOptional() @Matches(/^([0-9a-f-]{36}|none)$/) unitId?: string
  @IsOptional() @Matches(/^([0-9a-f-]{36}|none)$/) originId?: string
  @IsOptional() @Matches(/^([0-9a-f-]{36}|none)$/) customerTypeId?: string
  @IsOptional() @IsIn([...UF_LIST, 'EX']) state?: string
  @IsOptional() @IsIn(['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul']) region?: string
  @IsOptional() @IsUUID() brandId?: string
  @IsOptional() @IsUUID() partTypeId?: string
  @IsOptional() @IsUUID() lostReasonId?: string
  @IsOptional() @IsIn(['true', 'false']) forwarded?: 'true' | 'false'
  @IsOptional() @IsIn(RETURN) returnStatus?: (typeof RETURN)[number]
  @IsOptional() @IsIn(SALE) saleStatus?: (typeof SALE)[number]
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string
  @IsOptional() @IsIn(['true']) overdue?: 'true'
}

class ListDto extends FiltersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(200) pageSize = 50
  @IsOptional() @IsIn(['leadAt', 'name', 'saleValue', 'createdAt', 'updatedAt']) sort = 'leadAt'
  @IsOptional() @IsIn(['asc', 'desc']) dir: 'asc' | 'desc' = 'desc'
}

class RecordDto {
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: ServiceKind
  @ApiPropertyOptional() @IsOptional() @IsDateString() leadAt?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 160) name?: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) customerCode?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(40) phone?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail({}, { message: 'E-mail inválido.' }) email?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() sellerId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unitId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() originId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() customerTypeId?: string | null
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 40) country?: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(UF_LIST) state?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) city?: string | null
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) brandIds?: string[]
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) partTypeIds?: string[]
  @ApiPropertyOptional() @IsOptional() @IsBoolean() forwarded?: boolean
  @ApiPropertyOptional({ enum: RETURN }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(RETURN) returnStatus?: (typeof RETURN)[number] | null
  @ApiPropertyOptional({ enum: SALE }) @IsOptional() @IsIn(SALE) saleStatus?: (typeof SALE)[number]
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() lostReasonId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) invoiceNumber?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) saleValue?: number | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) notes?: string | null
}

class CreateRecordDto extends RecordDto {
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) declare kind: ServiceKind
  @ApiProperty() @IsString() @Length(1, 160) declare name: string
}

class MoveDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(5000) @IsUUID('all', { each: true }) ids!: string[]
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: ServiceKind
}

class ImportDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) url?: string
  @ApiPropertyOptional({ description: 'Conteúdo CSV (alternativa ao link)' }) @IsOptional() @IsString() @MaxLength(2 * 1024 * 1024) csv?: string
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: ServiceKind
  @ApiProperty() @IsBoolean() dryRun!: boolean
}

class LookupDto {
  @ApiProperty() @IsString() @Length(1, 80) name!: string
}

class LookupUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
}

class SellerDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unitId?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() email?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) phone?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() userId?: string | null
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
}

class UnitDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) city?: string | null
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(UF_LIST) state?: string | null
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isHeadquarters?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
}

class MergeDto {
  @ApiProperty() @IsUUID() targetId!: string
}

class AlertSettingsDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(720) alertHours!: number
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v)
  // Prefixo contra injeção de fórmula no Excel (=, +, -, @).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const fmtDate = (d: Date | null) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d) : '')
const fmtMoney = (n: unknown) => (n === null || n === undefined ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const LABEL = { SIM: 'Sim', NAO: 'Não', PENDENTE: 'Pendente', NEGOCIACAO: 'Em negociação' } as Record<string, string>

@ApiTags('Atendimentos (Pré/Pós-Vendas)')
@Controller('atendimentos')
export class AtendimentoController {
  constructor(
    private readonly records: ServiceRecordsService,
    private readonly imports: ImportService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    const { page, pageSize, sort, dir, ...filters } = q
    return this.records.list(user, filters, page, pageSize, sort, dir)
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser, @Query() q: FiltersDto) {
    return this.records.dashboard(user, q)
  }

  @Get('alertas')
  alerts(@CurrentUser() user: AuthUser) {
    return this.records.alerts(user)
  }

  @Get('exportar')
  async export(@CurrentUser() user: AuthUser, @Query() q: FiltersDto, @Res() res: Response) {
    const { rows, names } = await this.records.exportRows(user, q)
    const n = (id: string | null) => (id ? (names.get(id) ?? '') : '')
    const header = [
      'Data do lead', 'Nome', 'Código do cliente', 'Telefone', 'E-mail', 'Unidade', 'Vendedor', 'Origem', 'Tipo de cliente', 'País', 'Estado', 'Cidade',
      'Marca da máquina', 'Tipo de peça', 'Repassou ao vendedor', 'Vendedor retornou', 'Venda realizada', 'Motivo da perda', 'Nota fiscal', 'Valor da venda', 'Observações',
    ]
    const lines = rows.map((r) =>
      [
        fmtDate(r.leadAt), r.name, r.customerCode, r.phone, r.email, n(r.unitId), n(r.sellerId), n(r.originId), n(r.customerTypeId), r.country,
        r.state ? UFS[r.state as keyof typeof UFS]?.name ?? r.state : '', r.city, r.brandIds.map(n).join(', '), r.partTypeIds.map(n).join(', '),
        r.forwarded ? 'Sim' : 'Não', r.returnStatus ? LABEL[r.returnStatus] : '', LABEL[r.saleStatus], n(r.lostReasonId), r.invoiceNumber, fmtMoney(r.saleValue), r.notes,
      ]
        .map(csvCell)
        .join(';'),
    )
    const name = `${q.kind === 'PRE_VENDAS' ? 'pre-vendas' : 'pos-vendas'}-${new Date().toISOString().slice(0, 10)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    // BOM: o Excel em português abre com acentos corretos e separa as colunas pelo ";".
    res.send('﻿' + [header.join(';'), ...lines].join('\r\n'))
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.records.get(user, id)
  }

  @Get(':id/historico')
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.records.history(user, id)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRecordDto, @ReqContext() ctx: RequestCtx) {
    return this.records.create(user, dto, ctx)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordDto, @ReqContext() ctx: RequestCtx) {
    return this.records.update(user, id, dto, ctx)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.records.remove(user, id, ctx)
    return { ok: true }
  }

  @Post('mover')
  @HttpCode(200)
  move(@CurrentUser() user: AuthUser, @Body() dto: MoveDto, @ReqContext() ctx: RequestCtx) {
    return this.records.move(user, dto.ids, dto.kind, ctx)
  }

  @Post('importar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  import(@CurrentUser() user: AuthUser, @Body() dto: ImportDto, @ReqContext() ctx: RequestCtx) {
    return this.imports.run(user, { url: dto.url, csv: dto.csv }, dto.kind, dto.dryRun, ctx)
  }
}

@ApiTags('Cadastros de atendimento')
@Controller('cadastros')
export class CadastrosController {
  constructor(
    private readonly cadastros: CadastrosService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Listas para formulários e filtros: liberado para quem usa Pré ou Pós-Vendas (ou gerencia os cadastros). */
  @Get('opcoes')
  options(@CurrentUser() user: AuthUser) {
    const allowed = ['pre_vendas', 'pos_vendas', 'cadastros'].some((m) => can(user.permissions, user.role.isSystem, m, 'view'))
    if (!allowed) throw new ForbiddenException('Você não tem permissão para esta ação.')
    return this.cadastros.options(user.tenantId)
  }

  @Get('unidades')
  @RequirePermission('cadastros', 'view')
  units(@CurrentUser() user: AuthUser) {
    return this.cadastros.listUnits(user.tenantId)
  }

  @Post('unidades')
  @RequirePermission('cadastros', 'create')
  createUnit(@CurrentUser() user: AuthUser, @Body() dto: UnitDto, @ReqContext() ctx: RequestCtx) {
    return this.cadastros.saveUnit(user, null, dto, ctx)
  }

  @Put('unidades/:id')
  @RequirePermission('cadastros', 'edit')
  updateUnit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnitDto, @ReqContext() ctx: RequestCtx) {
    return this.cadastros.saveUnit(user, id, dto, ctx)
  }

  @Get('vendedores')
  @RequirePermission('cadastros', 'view')
  sellers(@CurrentUser() user: AuthUser) {
    return this.cadastros.listSellers(user.tenantId)
  }

  @Post('vendedores')
  @RequirePermission('cadastros', 'create')
  createSeller(@CurrentUser() user: AuthUser, @Body() dto: SellerDto, @ReqContext() ctx: RequestCtx) {
    return this.cadastros.saveSeller(user, null, dto, ctx)
  }

  @Put('vendedores/:id')
  @RequirePermission('cadastros', 'edit')
  updateSeller(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SellerDto, @ReqContext() ctx: RequestCtx) {
    return this.cadastros.saveSeller(user, id, dto, ctx)
  }

  @Post('vendedores/:id/mesclar')
  @HttpCode(200)
  @RequirePermission('cadastros', 'edit')
  merge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MergeDto, @ReqContext() ctx: RequestCtx) {
    return this.cadastros.mergeSellers(user, id, dto.targetId, ctx)
  }

  @Get('alertas')
  @RequirePermission('cadastros', 'view')
  alertSettings(@CurrentUser() user: AuthUser) {
    return this.settings.get(user.tenantId, 'atendimento', DEFAULT_ATENDIMENTO)
  }

  @Put('alertas')
  @RequirePermission('cadastros', 'edit')
  async saveAlertSettings(@CurrentUser() user: AuthUser, @Body() dto: AlertSettingsDto, @ReqContext() ctx: RequestCtx) {
    const saved = await this.settings.set(user.tenantId, 'atendimento', { alertHours: dto.alertHours })
    await this.audit.byUser(user, ctx, 'settings.atendimento_updated', 'settings', 'atendimento', { alertHours: dto.alertHours })
    return saved
  }

  @Get('listas/:tipo')
  @RequirePermission('cadastros', 'view')
  lookups(@CurrentUser() user: AuthUser, @Param('tipo') tipo: string) {
    return this.cadastros.listLookups(user.tenantId, this.type(tipo))
  }

  @Post('listas/:tipo')
  @RequirePermission('cadastros', 'create')
  createLookup(@CurrentUser() user: AuthUser, @Param('tipo') tipo: string, @Body() dto: LookupDto, @ReqContext() ctx: RequestCtx) {
    return this.cadastros.createLookup(user, this.type(tipo), dto.name, ctx)
  }

  @Patch('listas/item/:id')
  @RequirePermission('cadastros', 'edit')
  updateLookup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LookupUpdateDto, @ReqContext() ctx: RequestCtx) {
    return this.cadastros.updateLookup(user, id, dto, ctx)
  }

  private type(tipo: string) {
    const t = tipo.toUpperCase().replace(/-/g, '_')
    if (!LOOKUP_TYPES.includes(t as (typeof LOOKUP_TYPES)[number])) throw new ForbiddenException('Lista inválida.')
    return t as (typeof LOOKUP_TYPES)[number]
  }
}
