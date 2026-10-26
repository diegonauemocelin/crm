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
  IsNumber,
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
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { ICMS_MODES } from './catalogo'
import { checkFormula } from './formula'
import { CotacaoService } from './cotacao.service'
import { IMPORT_MAX_BYTES, ImportacaoService } from './importacao.service'
import { PainelService } from './painel.service'
import { TabelasService } from './tabelas.service'
import { TransportadorasService } from './transportadoras.service'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const nullable = ValidateIf((_, v) => v !== null)

class ContactDto {
  @IsString() @Length(1, 120) name!: string
  @IsOptional() @nullable @IsString() @MaxLength(80) role?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(40) phone?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(160) email?: string | null
}

class CarrierDto {
  @ApiProperty() @IsString() @Length(14, 18) cnpj!: string
  @ApiProperty() @IsString() @Length(2, 160) legalName!: string
  @ApiPropertyOptional() @IsOptional() @nullable @IsString() @MaxLength(120) name?: string | null
  @ApiPropertyOptional() @IsOptional() @nullable @IsString() @MaxLength(120) quoteName?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(10) zip?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(240) address?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(120) city?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(2) state?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(40) phone?: string | null
  @IsOptional() @nullable @IsEmail({}, { message: 'E-mail inválido.' }) @MaxLength(160) email?: string | null
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ContactDto) contacts?: ContactDto[]
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) modes?: string[]
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) unitIds?: string[]
  @IsOptional() @IsBoolean() useReceiverAsRecipient?: boolean
  @IsOptional() @IsObject() externalCodes?: Record<string, string>
  @IsOptional() @nullable @IsString() @MaxLength(4000) notes?: string | null
  @IsOptional() @IsBoolean() active?: boolean
}

class TableDto {
  @ApiProperty() @IsUUID() carrierId!: string
  @ApiProperty() @IsString() @Length(2, 160) name!: string
  @IsOptional() @nullable @IsString() @MaxLength(120) quoteName?: string | null
  @IsOptional() @IsString() kind?: string
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() modal?: string
  @ApiProperty() @Matches(DATE, { message: 'Vigência inicial inválida.' }) validFrom!: string
  @ApiProperty() @Matches(DATE, { message: 'Vigência final inválida.' }) validTo!: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) unitIds?: string[]
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) goodsTypes?: string[]
  @IsOptional() @IsString() personType?: string
  @IsOptional() @IsString() usage?: string
  @IsOptional() @nullable @IsNumber() weightMin?: number | null
  @IsOptional() @nullable @IsNumber() weightMax?: number | null
  @IsOptional() @nullable @IsNumber() valueMin?: number | null
  @IsOptional() @nullable @IsNumber() valueMax?: number | null
  @IsOptional() @IsString() loadType?: string
  @IsOptional() @nullable @IsInt() dispatchDays?: number | null
  @IsOptional() @nullable @IsString() @MaxLength(40) serviceCode?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(80) partner?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(4000) notes?: string | null
}

class ComponentDto {
  @IsString() @Length(1, 30) code!: string
  @IsString() @Length(1, 80) name!: string
  @IsString() @Length(1, 500) formula!: string
  @IsOptional() @nullable @IsString() @MaxLength(500) condition?: string | null
  @IsBoolean() inTax!: boolean
  @IsOptional() @nullable @IsString() @MaxLength(80) cteName?: string | null
  @IsInt() @Min(0) @Max(100_000) order!: number
  @IsBoolean() active!: boolean
  @IsOptional() @nullable @IsString() @MaxLength(300) description?: string | null
}

class SettingsDto {
  @IsOptional() @IsIn(ICMS_MODES) icmsMode?: (typeof ICMS_MODES)[number]
  @IsOptional() @nullable @IsNumber() icmsRate?: number | null
  @IsOptional() @IsNumber() cubageFactor?: number
  @IsOptional() @IsBoolean() useCubage?: boolean
}

class VersionDto {
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ComponentDto) components?: ComponentDto[]
  @IsOptional() @ValidateNested() @Type(() => SettingsDto) settings?: SettingsDto
  @IsOptional() @nullable @IsString() @MaxLength(300) note?: string | null
}

class NewVersionDto {
  @IsOptional() @IsUUID() fromVersionId?: string
  @IsOptional() @IsBoolean() withRules?: boolean
  @IsOptional() @IsString() @MaxLength(300) note?: string
}

class RuleDto {
  @IsOptional() @nullable @IsString() @MaxLength(10) cepStart?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(10) cepEnd?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(2) uf?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(120) city?: string | null
  @IsOptional() @nullable @IsNumber() weightMin?: number | null
  @IsOptional() @nullable @IsNumber() weightMax?: number | null
  @IsOptional() @nullable @IsInt() deadlineDays?: number | null
  @IsOptional() @IsBoolean() restricted?: boolean
  @IsOptional() @IsObject() values?: Record<string, number>
  @IsOptional() @nullable @IsString() @MaxLength(300) note?: string | null
}

class TableListDto {
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @IsUUID() transportadora?: string
  @IsOptional() @IsString() situacao?: string
  @IsOptional() @IsIn(['VIGENTE', 'VENCIDA', 'A_VENCER']) vigencia?: string
  @IsOptional() @IsUUID() filial?: string
}

class PageDto {
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) pagina?: number
}

class MapDto {
  @IsInt() @Min(0) column!: number
  @IsString() @MaxLength(60) field!: string
  @IsOptional() @nullable @IsNumber() weightMin?: number | null
  @IsOptional() @nullable @IsNumber() weightMax?: number | null
}

class ImportDto {
  @IsInt() @Min(0) @Max(200) sheet!: number
  @IsInt() @Min(1) headerRow!: number
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => MapDto) mapping!: MapDto[]
  @IsOptional() @nullable @IsString() @MaxLength(300) note?: string | null
}

class SuggestDto {
  @IsInt() @Min(0) @Max(200) sheet!: number
  @IsInt() @Min(0) headerRow!: number
}

class VolumeDto {
  @IsInt() @Min(0) @Max(10_000) quantity!: number
  @IsNumber() @Min(0) weight!: number
  @IsNumber() @Min(0) length!: number
  @IsNumber() @Min(0) width!: number
  @IsNumber() @Min(0) height!: number
}

class QuoteDto {
  @ApiProperty() @IsUUID() unitId!: string
  @IsOptional() @nullable @IsString() @MaxLength(10) originZip?: string | null
  @ApiProperty() @IsString() @Length(5, 10) destZip!: string
  @IsOptional() @nullable @IsString() @MaxLength(120) destCity?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(2) destUf?: string | null
  @ApiProperty({ enum: ['PF', 'PJ'] }) @IsIn(['PF', 'PJ']) personType!: 'PF' | 'PJ'
  @IsOptional() @nullable @IsString() @MaxLength(160) customerName?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(20) customerDoc?: string | null
  @ApiProperty() @IsNumber() @Min(0) cargoValue!: number
  @IsOptional() @nullable @IsNumber() @Min(0) totalValue?: number | null
  @IsOptional() @nullable @IsNumber() @Min(0) weight?: number | null
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => VolumeDto) volumes?: VolumeDto[]
  @IsOptional() @nullable @IsString() @MaxLength(60) goodsType?: string | null
  @IsOptional() @nullable @Matches(DATE) quoteDate?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(80) reference?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(2000) notes?: string | null
  @IsOptional() @IsBoolean() allowExpired?: boolean
  @IsOptional() @nullable @IsString() @MaxLength(500) expiredReason?: string | null
}

class SimulateDto extends QuoteDto {
  @IsUUID() tableId!: string
  @IsUUID() versionId!: string
  @IsOptional() @IsUUID() declare unitId: string
}

class QuoteListDto extends PageDto {
  @IsOptional() @IsUUID() filial?: string
  @IsOptional() @IsUUID() transportadora?: string
  @IsOptional() @IsIn(['CALCULADA', 'SELECIONADA', 'CANCELADA']) situacao?: string
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
}

class SelectDto {
  @IsUUID() tableId!: string
  @IsOptional() @nullable @IsString() @MaxLength(500) note?: string | null
}

class FormulaDto {
  @IsString() @MaxLength(600) formula!: string
}

class UnitDto {
  @IsOptional() @nullable @IsString() @MaxLength(18) cnpj?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(160) legalName?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(10) zip?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(240) address?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(120) city?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(2) state?: string | null
}

class DashboardDto {
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
  @IsOptional() @IsUUID() filial?: string
}

function sendFile(res: Response, fileName: string, mime: string, content: Buffer | string) {
  const safe = fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'arquivo'
  res.setHeader('Content-Type', mime)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  res.send(content)
}

/** Módulo de fretes: contexto, filiais, painel, transportadoras, tabelas, importação e cotações. Permissões em cada serviço. */
@ApiTags('Fretes')
@Controller('fretes')
export class FretesController {
  constructor(
    private readonly painel: PainelService,
    private readonly carriers: TransportadorasService,
    private readonly tables: TabelasService,
    private readonly imports: ImportacaoService,
    private readonly quotes: CotacaoService,
  ) {}

  @Get('contexto')
  context(@CurrentUser() user: AuthUser) {
    return this.painel.context(user)
  }

  @Get('painel')
  dashboard(@CurrentUser() user: AuthUser, @Query() q: DashboardDto) {
    return this.painel.dashboard(user, { from: q.de, to: q.ate, unitId: q.filial })
  }

  @Patch('filiais/:id')
  updateUnit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnitDto, @ReqContext() ctx: RequestCtx) {
    return this.painel.updateUnit(user, id, dto, ctx)
  }

  @Post('filiais/padrao')
  @HttpCode(200)
  seedUnits(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.painel.seedUsaparts(user, ctx)
  }

  @Get('cep/:cep')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  cep(@Param('cep') cep: string) {
    return this.quotes.cep(cep)
  }

  @Post('formula/validar')
  @HttpCode(200)
  checkFormula(@Body() dto: FormulaDto) {
    return checkFormula(dto.formula)
  }

  // ─────────── Transportadoras ───────────

  @Get('transportadoras')
  listCarriers(@CurrentUser() user: AuthUser, @Query('busca') search?: string, @Query('situacao') status?: string) {
    return this.carriers.list(user, { search: search?.slice(0, 100), status: status === 'active' || status === 'inactive' ? status : undefined })
  }

  @Get('transportadoras/:id')
  getCarrier(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.carriers.get(user, id)
  }

  @Post('transportadoras')
  createCarrier(@CurrentUser() user: AuthUser, @Body() dto: CarrierDto, @ReqContext() ctx: RequestCtx) {
    return this.carriers.create(user, dto, ctx)
  }

  @Put('transportadoras/:id')
  updateCarrier(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CarrierDto, @ReqContext() ctx: RequestCtx) {
    return this.carriers.update(user, id, dto, ctx)
  }

  // ─────────── Tabelas ───────────

  @Get('tabelas')
  listTables(@CurrentUser() user: AuthUser, @Query() q: TableListDto) {
    return this.tables.list(user, { search: q.busca, carrierId: q.transportadora, status: q.situacao, validity: q.vigencia, unitId: q.filial })
  }

  @Get('tabelas/:id')
  getTable(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tables.get(user, id)
  }

  @Post('tabelas')
  createTable(@CurrentUser() user: AuthUser, @Body() dto: TableDto, @ReqContext() ctx: RequestCtx) {
    return this.tables.create(user, dto, ctx)
  }

  @Put('tabelas/:id')
  updateTable(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TableDto, @ReqContext() ctx: RequestCtx) {
    return this.tables.update(user, id, dto, ctx)
  }

  @Get('tabelas/:id/versoes/:vid')
  version(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.tables.version(user, id, vid)
  }

  @Post('tabelas/:id/versoes')
  newVersion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewVersionDto, @ReqContext() ctx: RequestCtx) {
    return this.tables.newVersion(user, id, dto.fromVersionId, ctx, { withRules: dto.withRules, note: dto.note })
  }

  @Patch('tabelas/:id/versoes/:vid')
  updateVersion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Body() dto: VersionDto, @ReqContext() ctx: RequestCtx) {
    return this.tables.updateVersion(user, id, vid, dto, ctx)
  }

  @Post('tabelas/:id/versoes/:vid/publicar')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @ReqContext() ctx: RequestCtx) {
    return this.tables.publish(user, id, vid, ctx)
  }

  @Post('tabelas/:id/versoes/:vid/descartar')
  @HttpCode(200)
  discard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @ReqContext() ctx: RequestCtx) {
    return this.tables.discard(user, id, vid, ctx)
  }

  @Get('tabelas/:id/versoes/:vid/regras')
  rules(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Query() q: PageDto) {
    return this.tables.rules(user, id, vid, { search: q.busca, page: q.pagina })
  }

  @Get('tabelas/:id/versoes/:vid/regras.csv')
  async exportRules(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @ReqContext() ctx: RequestCtx, @Res() res: Response) {
    const f = await this.tables.exportRules(user, id, vid, ctx)
    sendFile(res, f.fileName, 'text/csv; charset=utf-8', f.content)
  }

  @Post('tabelas/:id/versoes/:vid/regras')
  createRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Body() dto: RuleDto, @ReqContext() ctx: RequestCtx) {
    return this.tables.createRule(user, id, vid, dto, ctx)
  }

  @Put('tabelas/:id/versoes/:vid/regras/:rid')
  updateRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() dto: RuleDto, @ReqContext() ctx: RequestCtx) {
    return this.tables.updateRule(user, id, vid, rid, dto, ctx)
  }

  @Delete('tabelas/:id/versoes/:vid/regras/:rid')
  deleteRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string, @Param('rid', ParseUUIDPipe) rid: string, @ReqContext() ctx: RequestCtx) {
    return this.tables.deleteRule(user, id, vid, rid, ctx)
  }

  // ─────────── Importação ───────────

  @Get('tabelas/:id/importacoes')
  listImports(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.list(user, id)
  }

  @Post('tabelas/:id/importacoes')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: IMPORT_MAX_BYTES } }))
  analyze(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @ReqContext() ctx: RequestCtx) {
    return this.imports.analyze(user, id, file, ctx)
  }

  @Post('importacoes/:id/sugerir')
  @HttpCode(200)
  suggest(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuggestDto) {
    return this.imports.suggest(user, id, dto.sheet, dto.headerRow)
  }

  @Post('importacoes/:id/validar')
  @HttpCode(200)
  validate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportDto) {
    return this.imports.validate(user, id, dto)
  }

  @Post('importacoes/:id/confirmar')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportDto, @ReqContext() ctx: RequestCtx) {
    return this.imports.confirm(user, id, dto, ctx)
  }

  @Post('importacoes/:id/cancelar')
  @HttpCode(200)
  cancelImport(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.imports.cancel(user, id, ctx)
  }

  @Get('importacoes/:id')
  importReport(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.report(user, id)
  }

  @Get('importacoes/:id/arquivo')
  async original(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.imports.original(user, id)
    sendFile(res, f.fileName, f.mime, f.content)
  }

  // ─────────── Cotações ───────────

  @Post('cotacoes')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteDto, @ReqContext() ctx: RequestCtx) {
    return this.quotes.quote(user, dto, ctx)
  }

  @Post('simular')
  @HttpCode(200)
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateDto) {
    return this.quotes.simulate(user, dto)
  }

  @Get('cotacoes')
  listQuotes(@CurrentUser() user: AuthUser, @Query() q: QuoteListDto) {
    return this.quotes.list(user, { unitId: q.filial, carrierId: q.transportadora, status: q.situacao, from: q.de, to: q.ate, search: q.busca, page: q.pagina })
  }

  @Get('cotacoes/:id')
  getQuote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(user, id)
  }

  @Get('cotacoes/:id/reproduzir')
  reproduce(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.reproduce(user, id)
  }

  @Post('cotacoes/:id/escolher')
  @HttpCode(200)
  select(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SelectDto, @ReqContext() ctx: RequestCtx) {
    return this.quotes.select(user, id, dto, ctx)
  }

  @Post('cotacoes/:id/cancelar')
  @HttpCode(200)
  cancelQuote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.quotes.cancel(user, id, ctx)
  }
}
