import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common'
import { assertCan } from './acesso'
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { SHIPMENT_STATUS } from './catalogo'
import { FREIGHT_FILTERS, type FreightFilter } from './confronto'
import { AUDIT_CAUSES, AUDIT_STATUSES, type AuditCause, type AuditStatus } from './conferencia'
import { CteService } from './cte.service'
import { FaturasService } from './faturas.service'
import { IMPORT_MAX_BYTES, readSheets } from './importacao.service'
import { PedidosService } from './pedidos.service'
import { NfeService } from './nfe.service'
import { FretesRelatoriosService, REPORTS } from './relatorios.service'
import { FretesResumoSemanalService } from './resumo-semanal.service'
import { PoupancaService } from './poupanca.service'
import { RastreioService } from './rastreio.service'

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

class PedidosListDto extends ShipmentListDto {
  /** Frete da nota (CIF) × CT-e: NOTA_MAIOR, NOTA_MENOR ou NOTA_MENOR_ESPERADO (abaixo do CT-e ou do cotado). */
  @IsOptional() @IsIn(FREIGHT_FILTERS) freteNota?: FreightFilter
  /** Vendedor da NF-e (dos dados adicionais). */
  @IsOptional() @IsString() @MaxLength(120) vendedor?: string
}

class ConferenciaListDto {
  @IsOptional() @IsUUID() filial?: string
  @IsOptional() @IsUUID() transportadora?: string
  @IsOptional() @IsString() @MaxLength(120) vendedor?: string
  @IsOptional() @Matches(DATE) de?: string
  @IsOptional() @Matches(DATE) ate?: string
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  /** PENDENTE (padrão), OK, DIVERGENTE ou TODOS. */
  @IsOptional() @IsIn(['PENDENTE', 'OK', 'DIVERGENTE', 'TODOS']) situacao?: 'PENDENTE' | 'OK' | 'DIVERGENTE' | 'TODOS'
  /** Modalidade do frete na NF-e: CIF (padrão, a empresa paga), FOB (cliente ou terceiro) ou TODOS. */
  @IsOptional() @IsIn(['CIF', 'FOB', 'TODOS']) frete?: 'CIF' | 'FOB' | 'TODOS'
  /** Só os pedidos com diferença (padrão: sim). */
  @IsOptional() @bool @IsBoolean() diferenca?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) pagina?: number
}

class ConferenciaDto {
  @ValidateIf((_, v) => v !== null) @IsIn(AUDIT_STATUSES) status!: AuditStatus | null
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(Object.keys(AUDIT_CAUSES)) causa?: AuditCause | null
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) observacao?: string | null
}

class CteListDto extends ShipmentListDto {
  @IsOptional() @IsString() @MaxLength(40) decisao?: string
  /** VENDA: a empresa é remetente ou expedidora (a carga sai da filial). COMPRA: só recebe ou paga (entrada). */
  @IsOptional() @IsIn(['VENDA', 'COMPRA']) tipo?: 'VENDA' | 'COMPRA'
  @IsOptional() @bool @IsBoolean() pendentes?: boolean
  /** Estado do cliente (venda: destino) ou do fornecedor (compra: origem). */
  @IsOptional() @Matches(/^[A-Z]{2}$/) uf?: string
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
  @IsOptional() @IsNumber() @Min(0) nfePesoPercentual?: number
  @IsOptional() @IsNumber() @Min(0) nfePesoKg?: number
  @IsOptional() @IsNumber() @Min(0) nfeValor?: number
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

class WeeklyFreightDto {
  @IsBoolean() active!: boolean
  @IsInt() @Min(0) @Max(6) weekday!: number
  @IsInt() @Min(0) @Max(23) hour!: number
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(320, { each: true }) emails!: string[]
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unitId?: string | null
}

class WalletCampaignsDto {
  /** Lista completa das campanhas (validada e limpa no serviço: cleanWalletCampaigns). */
  @IsArray() @ArrayMaxSize(50) list!: unknown[]
}

class WalletMoveDto {
  @IsString() @MaxLength(120) seller!: string
  @IsIn(['USO', 'AJUSTE']) kind!: 'USO' | 'AJUSTE'
  @IsNumber() @Min(-1_000_000) @Max(1_000_000) value!: number
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) note?: string | null
}

class GerencialDto extends ReportDto {
  @IsOptional() @IsUUID() transportadora?: string
  @IsOptional() @Matches(/^[A-Za-z]{2}$/) uf?: string
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
    private readonly nfes: NfeService,
    private readonly weekly: FretesResumoSemanalService,
    private readonly wallet: PoupancaService,
    private readonly tracking: RastreioService,
  ) {}

  // ─────────── NF-e (XML) ───────────

  /** XMLs das NF-e de saída (o .zip do dia baixado do ERP, ou .xml soltos): pedidos de frete e confronto com o CT-e. */
  @Post('nfe/importar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('arquivos', 10, { limits: { fileSize: 60 * 1024 * 1024 } }))
  importNfes(@CurrentUser() user: AuthUser, @UploadedFiles() files: Express.Multer.File[], @ReqContext() ctx: RequestCtx) {
    return this.nfes.importXml(user, files ?? [], ctx)
  }

  @Get('nfe/importacoes')
  nfeImports(@CurrentUser() user: AuthUser) {
    return this.nfes.history(user)
  }

  // ─────────── Pedidos ───────────

  @Get('pedidos')
  listShipments(@CurrentUser() user: AuthUser, @Query() q: PedidosListDto) {
    return this.shipments.list(user, { unitId: q.filial, status: q.situacao, carrierId: q.transportadora, from: q.de, to: q.ate, search: q.busca, page: q.pagina, late: q.atrasados, freight: q.freteNota, seller: q.vendedor })
  }

  @Get('conferencia')
  listAudit(@CurrentUser() user: AuthUser, @Query() q: ConferenciaListDto) {
    return this.shipments.freightAudit(user, { unitId: q.filial, carrierId: q.transportadora, seller: q.vendedor, from: q.de, to: q.ate, search: q.busca, status: q.situacao, mode: q.frete, onlyDiff: q.diferenca, page: q.pagina })
  }

  @Patch('conferencia/:id')
  setAudit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ConferenciaDto, @ReqContext() ctx: RequestCtx) {
    return this.shipments.setFreightAudit(user, id, { status: d.status, cause: d.causa ?? null, note: d.observacao ?? null }, ctx)
  }

  @Get('pedidos/vendedores')
  shipmentSellers(@CurrentUser() user: AuthUser) {
    return this.shipments.sellers(user)
  }

  @Get('pedidos/:id/rastreio')
  trackShipment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.track(user, id)
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
    return this.ctes.list(user, { unitId: q.filial, carrierId: q.transportadora, recStatus: q.situacao, decision: q.decisao, from: q.de, to: q.ate, search: q.busca, page: q.pagina, pending: q.pendentes, kind: q.tipo, uf: q.uf })
  }

  @Get('ctes/parametros')
  recSettings(@CurrentUser() user: AuthUser) {
    assertCan(user, 'fretes_cte', 'view')
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

  @Post('ctes/reconciliar-sem-referencia')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  reprocessPending(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.ctes.reprocessPending(user, ctx)
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

  // ─────────── Poupança de frete dos vendedores ───────────

  @Get('poupanca/campanhas')
  walletCampaigns(@CurrentUser() user: AuthUser) {
    return this.wallet.list(user)
  }

  @Put('poupanca/campanhas')
  saveWalletCampaigns(@CurrentUser() user: AuthUser, @Body() dto: WalletCampaignsDto, @ReqContext() ctx: RequestCtx) {
    return this.wallet.saveCampaigns(user, dto.list, ctx)
  }

  /** Campanha da poupança que vale hoje: a cotação mostra quanto cobrar do cliente (cotação + acréscimo). */
  @Get('poupanca/vigente')
  walletCurrent(@CurrentUser() user: AuthUser) {
    return this.wallet.currentFor(user)
  }

  @Get('poupanca/:campanha')
  walletBalances(@CurrentUser() user: AuthUser, @Param('campanha') campaignId: string) {
    return this.wallet.balances(user, campaignId)
  }

  @Get('poupanca/:campanha/extrato')
  walletStatement(@CurrentUser() user: AuthUser, @Param('campanha') campaignId: string, @Query('vendedor') seller: string) {
    if (typeof seller !== 'string' || !seller.trim()) throw new BadRequestException('Informe o vendedor.')
    return this.wallet.statement(user, campaignId, seller.trim().slice(0, 120))
  }

  @Post('poupanca/:campanha/movimentos')
  addWalletMove(@CurrentUser() user: AuthUser, @Param('campanha') campaignId: string, @Body() dto: WalletMoveDto, @ReqContext() ctx: RequestCtx) {
    return this.wallet.addMove(user, campaignId, dto, ctx)
  }

  @Delete('poupanca/movimentos/:id')
  deleteWalletMove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.wallet.deleteMove(user, id, ctx)
  }

  @Get('resumo-semanal')
  weeklyConfig(@CurrentUser() user: AuthUser) {
    return this.weekly.config(user)
  }

  @Put('resumo-semanal')
  saveWeekly(@CurrentUser() user: AuthUser, @Body() dto: WeeklyFreightDto, @ReqContext() ctx: RequestCtx) {
    return this.weekly.save(user, dto, ctx)
  }

  @Post('resumo-semanal/enviar')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  sendWeekly(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.weekly.sendNow(user, ctx)
  }

  @Get('gerencial')
  gerencial(@CurrentUser() user: AuthUser, @Query() q: GerencialDto) {
    return this.reports.gerencial(user, { from: q.de, to: q.ate, unitId: q.filial, carrierId: q.transportadora, uf: q.uf })
  }

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
