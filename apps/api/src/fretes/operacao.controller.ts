import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common'
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { SHIPMENT_STATUS } from './catalogo'
import { CteService } from './cte.service'
import { FaturasService } from './faturas.service'
import { IMPORT_MAX_BYTES, readSheets } from './importacao.service'
import { PedidosService } from './pedidos.service'
import { FretesRelatoriosService, REPORTS } from './relatorios.service'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const nullable = ValidateIf((_, v) => v !== null)
const bool = Transform(({ value }) => value === 'true' || value === '1' || value === true)

class ShipmentDto {
  @IsUUID() unitId!: string
  @IsOptional() @nullable @IsString() @MaxLength(40) orderNumber?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(20) invoiceNumber?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(60) invoiceKey?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(160) customerName?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(20) customerDoc?: string | null
  @IsOptional() @IsIn(['PF', 'PJ']) personType?: 'PF' | 'PJ'
  @IsOptional() @nullable @IsString() @MaxLength(10) destZip?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(120) destCity?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(2) destUf?: string | null
  @IsOptional() @nullable @IsNumber() @Min(0) cargoValue?: number | null
  @IsOptional() @nullable @IsNumber() @Min(0) weight?: number | null
  @IsOptional() @nullable @IsInt() @Min(0) volumesCount?: number | null
  @IsOptional() @nullable @IsUUID() carrierId?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(60) trackingCode?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(2000) notes?: string | null
}

class FromQuoteDto {
  @IsOptional() @nullable @IsString() @MaxLength(40) orderNumber?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(20) invoiceNumber?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(60) invoiceKey?: string | null
}

class StatusDto {
  @IsIn(SHIPMENT_STATUS) status!: string
  @IsOptional() @nullable @IsString() @MaxLength(500) note?: string | null
  @IsOptional() @nullable @IsString() @MaxLength(40) at?: string | null
}

class ShipmentListDto {
  @IsOptional() @IsUUID() filial?: string
  @IsOptional() @IsString() @MaxLength(40) situacao?: string
  @IsOptional() @IsUUID() transportadora?: string
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) pagina?: number
  @IsOptional() @bool @IsBoolean() atrasados?: boolean
}

class CteListDto extends ShipmentListDto {
  @IsOptional() @IsString() @MaxLength(40) decisao?: string
  @IsOptional() @bool @IsBoolean() pendentes?: boolean
}

class DecideDto {
  @IsIn(['APROVADO', 'APROVADO_COTADO', 'CONTESTADO']) decision!: 'APROVADO' | 'APROVADO_COTADO' | 'CONTESTADO'
  @IsOptional() @nullable @IsString() @MaxLength(1000) note?: string | null
  @IsOptional() @nullable @IsNumber() @Min(0) approvedValue?: number | null
}

class ContestDto {
  @IsIn(['ACEITA', 'RECUSADA']) result!: 'ACEITA' | 'RECUSADA'
  @IsOptional() @nullable @IsNumber() @Min(0) creditValue?: number | null
  @IsOptional() @nullable @IsString() @MaxLength(1000) note?: string | null
}

class LinkDto {
  @IsOptional() @nullable @IsUUID() shipmentId!: string | null
}

class RecSettingsDto {
  @IsOptional() @IsNumber() @Min(0) valor?: number
  @IsOptional() @IsNumber() @Min(0) percentual?: number
  @IsOptional() @IsObject() porTransportadora?: Record<string, { valor: number; percentual: number }>
  @IsOptional() @IsInt() @Min(1) diasSemCte?: number
  @IsOptional() @IsInt() @Min(0) diasFatura?: number
}

class InvoiceDto {
  @IsUUID() carrierId!: string
  @IsOptional() @nullable @IsUUID() unitId?: string | null
  @IsString() @Length(1, 40) number!: string
  @IsOptional() @nullable @Matches(DATE) issuedAt?: string | null
  @Matches(DATE, { message: 'Vencimento inválido.' }) dueAt!: string
  @IsNumber() @Min(0) total!: number
  @IsOptional() @nullable @IsString() @MaxLength(2000) notes?: string | null
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) cteIds?: string[]
}

class InvoiceStatusDto {
  @IsIn(['ABERTA', 'APROVADA', 'PAGA', 'CANCELADA']) status!: 'ABERTA' | 'APROVADA' | 'PAGA' | 'CANCELADA'
  @IsOptional() @nullable @Matches(DATE) paidAt?: string | null
  @IsOptional() @nullable @IsNumber() @Min(0) paidValue?: number | null
  @IsOptional() @nullable @IsString() @MaxLength(500) note?: string | null
}

class InvoiceListDto {
  @IsOptional() @IsUUID() transportadora?: string
  @IsOptional() @IsString() @MaxLength(20) situacao?: string
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
  @IsOptional() @IsUUID() filial?: string
}

class ReportDto {
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
  @IsOptional() @IsUUID() filial?: string
}

function send(res: Response, fileName: string, mime: string, content: Buffer | string) {
  res.setHeader('Content-Type', mime)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\w.-]+/g, '_')}"`)
  res.send(content)
}

/** Operação do frete depois da cotação: pedidos, CT-e e conciliação, faturas, relatórios e alertas. */
@ApiTags('Fretes')
@Controller('fretes')
export class FretesOperacaoController {
  constructor(
    private readonly shipments: PedidosService,
    private readonly ctes: CteService,
    private readonly invoices: FaturasService,
    private readonly reports: FretesRelatoriosService,
  ) {}

  // ─────────── Pedidos ───────────

  @Get('pedidos')
  listShipments(@CurrentUser() user: AuthUser, @Query() q: ShipmentListDto) {
    return this.shipments.list(user, { unitId: q.filial, status: q.situacao, carrierId: q.transportadora, from: q.de, to: q.ate, search: q.busca, page: q.pagina, late: q.atrasados })
  }

  @Get('pedidos/:id')
  getShipment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shipments.get(user, id)
  }

  @Post('pedidos')
  createShipment(@CurrentUser() user: AuthUser, @Body() dto: ShipmentDto, @ReqContext() ctx: RequestCtx) {
    return this.shipments.create(user, dto, ctx)
  }

  @Post('cotacoes/:id/pedido')
  fromQuote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FromQuoteDto, @ReqContext() ctx: RequestCtx) {
    return this.shipments.fromQuote(user, id, dto, ctx)
  }

  @Put('pedidos/:id')
  updateShipment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipmentDto, @ReqContext() ctx: RequestCtx) {
    return this.shipments.update(user, id, dto, ctx)
  }

  @Post('pedidos/:id/situacao')
  @HttpCode(200)
  shipmentStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @ReqContext() ctx: RequestCtx) {
    return this.shipments.changeStatus(user, id, dto, ctx)
  }

  @Post('pedidos/importar/:unitId')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: IMPORT_MAX_BYTES } }))
  async importShipments(@CurrentUser() user: AuthUser, @Param('unitId', ParseUUIDPipe) unitId: string, @UploadedFile() file: Express.Multer.File | undefined, @ReqContext() ctx: RequestCtx) {
    if (!file?.buffer?.length) return { created: 0, skipped: 0, errors: [{ line: 0, message: 'Envie a planilha de pedidos (.xlsx ou .csv).' }] }
    const sheets = await readSheets(file.buffer, file.originalname)
    return this.shipments.importRows(user, unitId, sheets[0]?.rows ?? [], ctx)
  }

  // ─────────── CT-e e conciliação ───────────

  @Post('ctes/importar')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('arquivos', 500, { limits: { fileSize: 20 * 1024 * 1024 } }))
  importCtes(@CurrentUser() user: AuthUser, @UploadedFiles() files: Express.Multer.File[], @ReqContext() ctx: RequestCtx) {
    return this.ctes.importXml(user, files ?? [], ctx)
  }

  @Get('ctes')
  listCtes(@CurrentUser() user: AuthUser, @Query() q: CteListDto) {
    return this.ctes.list(user, { unitId: q.filial, carrierId: q.transportadora, recStatus: q.situacao, decision: q.decisao, from: q.de, to: q.ate, search: q.busca, page: q.pagina, pending: q.pendentes })
  }

  @Get('ctes/parametros')
  recSettings(@CurrentUser() user: AuthUser) {
    return this.ctes.recSettings(user.tenantId)
  }

  @Put('ctes/parametros')
  saveRecSettings(@CurrentUser() user: AuthUser, @Body() dto: RecSettingsDto, @ReqContext() ctx: RequestCtx) {
    return this.ctes.saveRecSettings(user, dto, ctx)
  }

  @Get('ctes/:id')
  getCte(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ctes.get(user, id)
  }

  @Get('ctes/:id/xml')
  async cteXml(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.ctes.xml(user, id)
    send(res, f.fileName, 'application/xml', f.content)
  }

  @Post('ctes/:id/reconciliar')
  @HttpCode(200)
  reprocess(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.ctes.reprocess(user, id, ctx)
  }

  @Post('ctes/:id/pedido')
  @HttpCode(200)
  link(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto, @ReqContext() ctx: RequestCtx) {
    return this.ctes.link(user, id, dto.shipmentId ?? null, ctx)
  }

  @Post('ctes/:id/decisao')
  @HttpCode(200)
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto, @ReqContext() ctx: RequestCtx) {
    return this.ctes.decide(user, id, dto, ctx)
  }

  @Post('ctes/:id/contestacao')
  @HttpCode(200)
  contest(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContestDto, @ReqContext() ctx: RequestCtx) {
    return this.ctes.contestResult(user, id, dto, ctx)
  }

  // ─────────── Faturas ───────────

  @Get('faturas')
  listInvoices(@CurrentUser() user: AuthUser, @Query() q: InvoiceListDto) {
    return this.invoices.list(user, { carrierId: q.transportadora, status: q.situacao, from: q.de, to: q.ate, unitId: q.filial })
  }

  @Get('faturas/ctes-em-aberto/:carrierId')
  openCtes(@CurrentUser() user: AuthUser, @Param('carrierId', ParseUUIDPipe) carrierId: string, @Query('numeros') numbers?: string) {
    return this.invoices.openCtes(user, carrierId, numbers?.slice(0, 20_000))
  }

  @Get('faturas/:id')
  getInvoice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(user, id)
  }

  @Post('faturas')
  createInvoice(@CurrentUser() user: AuthUser, @Body() dto: InvoiceDto, @ReqContext() ctx: RequestCtx) {
    return this.invoices.create(user, dto, ctx)
  }

  @Put('faturas/:id')
  updateInvoice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InvoiceDto, @ReqContext() ctx: RequestCtx) {
    return this.invoices.update(user, id, dto, ctx)
  }

  @Patch('faturas/:id/situacao')
  invoiceStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InvoiceStatusDto, @ReqContext() ctx: RequestCtx) {
    return this.invoices.setStatus(user, id, dto, ctx)
  }

  // ─────────── Relatórios e alertas ───────────

  @Get('relatorios')
  reportList() {
    return Object.entries(REPORTS).map(([key, title]) => ({ key, title }))
  }

  @Get('relatorios/:key')
  report(@CurrentUser() user: AuthUser, @Param('key') key: string, @Query() q: ReportDto) {
    return this.reports.run(user, key, { from: q.de, to: q.ate, unitId: q.filial })
  }

  @Get('relatorios/:key/csv')
  async reportCsv(@CurrentUser() user: AuthUser, @Param('key') key: string, @Query() q: ReportDto, @Res() res: Response) {
    const f = await this.reports.csv(user, key, { from: q.de, to: q.ate, unitId: q.filial })
    send(res, f.fileName, 'text/csv; charset=utf-8', f.content)
  }

  @Get('alertas')
  alerts(@CurrentUser() user: AuthUser) {
    return this.reports.alerts(user)
  }
}
