import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../../common/decorators'
import type { AuthUser } from '../../common/types'
import type { CouponInput } from './margem'
import { type ListQuery, type PriceAction, PrecosService } from './precos.service'

const ITEM_ID = /^ML[A-Z]\d{5,15}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1'

class PrecosListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) busca?: string
  @ApiPropertyOptional() @IsOptional() @IsIn(['ativos', 'active', 'paused', 'closed', 'todos']) situacao?: string
  @ApiPropertyOptional() @IsOptional() @IsIn(['sim', 'nao', 'todos']) full?: string
  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() semCusto?: boolean
  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() margemBaixa?: boolean
  @ApiPropertyOptional({ enum: ['menos', 'igual', 'mais'] }) @IsOptional() @IsIn(['menos', 'igual', 'mais']) deposito?: 'menos' | 'igual' | 'mais'
  @ApiPropertyOptional() @IsOptional() @IsIn(['margem', 'margem_desc', 'titulo', 'preco']) ordem?: string
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pagina?: number
}

class PrecosConfigDto {
  @ApiPropertyOptional({ enum: ['CUSTO', 'CUSTO_IMPOSTO', 'PRECO'] }) @IsOptional() @IsIn(['CUSTO', 'CUSTO_IMPOSTO', 'PRECO']) marginMode?: 'CUSTO' | 'CUSTO_IMPOSTO' | 'PRECO'
  @ApiPropertyOptional({ nullable: true }) @IsOptional() taxPct?: number | null
  @ApiPropertyOptional() @IsOptional() @IsNumber() minMarginPct?: number
  @ApiPropertyOptional({ nullable: true }) @IsOptional() targetMarginPct?: number | null
  @ApiPropertyOptional() @IsOptional() @IsNumber() fixedCostPerSale?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() extraFeePct?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() useNfeTaxes?: boolean
  @ApiPropertyOptional({ enum: ['LUCRO', 'DEPOSITO'] }) @IsOptional() @IsIn(['LUCRO', 'DEPOSITO']) suggestBase?: 'LUCRO' | 'DEPOSITO'
}

class PrecosCostDto {
  @ApiProperty() @IsString() @MaxLength(60) sku!: string
  @ApiProperty({ nullable: true }) @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) cost!: number | null
}

class PrecosProfitDto {
  @ApiProperty() @IsString() @MaxLength(60) sku!: string
  @ApiPropertyOptional({ nullable: true, description: 'Lucro desejado em R$' }) @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) profitValue?: number | null
  @ApiPropertyOptional({ nullable: true, description: 'Lucro desejado em % do custo' }) @IsOptional() @IsNumber() @Min(0) @Max(1000) profitPct?: number | null
  @ApiPropertyOptional({ nullable: true, description: 'Lucro desejado em % do preço de venda' }) @IsOptional() @IsNumber() @Min(0) @Max(90) profitSalePct?: number | null
}

class PrecosFilterDto {
  @IsOptional() @IsString() @MaxLength(120) busca?: string
  @IsOptional() @IsIn(['ativos', 'active', 'paused', 'closed', 'todos']) situacao?: string
  @IsOptional() @IsIn(['sim', 'nao', 'todos']) full?: string
  @IsOptional() @IsBoolean() semCusto?: boolean
  @IsOptional() @IsBoolean() margemBaixa?: boolean
  @IsOptional() @IsIn(['menos', 'igual', 'mais']) deposito?: 'menos' | 'igual' | 'mais'
}

class PrecosSelectionDto {
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsString({ each: true }) @Matches(ITEM_ID, { each: true, message: 'Anúncio inválido.' }) ids?: string[]
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => PrecosFilterDto) filtro?: PrecosFilterDto
  @ApiPropertyOptional() @IsOptional() @IsBoolean() todos?: boolean
}

class PrecosBulkCostDto {
  @ApiProperty() @ValidateNested() @Type(() => PrecosSelectionDto) selecao!: PrecosSelectionDto
  @ApiProperty() @IsIn(['valor', 'percentual']) modo!: 'valor' | 'percentual'
  @ApiProperty() @IsNumber() @Min(0) @Max(10_000_000) valor!: number
}

class PrecosActionDto {
  @ApiProperty() @IsIn(['preco', 'promocao', 'encerrar_promocao']) tipo!: PriceAction['tipo']
  @ApiPropertyOptional() @IsOptional() @IsIn(['valor', 'percentual', 'margem', 'sugerido', 'preco']) modo?: string
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-99) @Max(10_000_000) valor?: number
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) inicio?: string
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) fim?: string
}

class PrecosPreviewDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Matches(ITEM_ID, { each: true, message: 'Anúncio inválido.' }) ids!: string[]
  @ApiProperty() @IsObject() @ValidateNested() @Type(() => PrecosActionDto) acao!: PrecosActionDto
}

class PrecosSendDto extends PrecosPreviewDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() ciente?: boolean
  @ApiPropertyOptional() @IsOptional() @IsDateString() agendarPara?: string
}

class PrecosCouponDto {
  @ApiProperty() @IsString() @MaxLength(60) name!: string
  @ApiProperty() @IsIn(['FIXED_AMOUNT', 'FIXED_PERCENTAGE']) subType!: 'FIXED_AMOUNT' | 'FIXED_PERCENTAGE'
  @ApiPropertyOptional() @IsOptional() @IsNumber() fixedAmount?: number | null
  @ApiPropertyOptional() @IsOptional() @IsNumber() fixedPercentage?: number | null
  @ApiProperty() @IsNumber() minPurchaseAmount!: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() maxPurchaseAmount?: number | null
  @ApiProperty() @IsNumber() budget!: number
  @ApiProperty() @Matches(DAY) start!: string
  @ApiProperty() @Matches(DAY) finish!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) code?: string | null
}

class PrecosCouponPreviewDto {
  @ApiProperty() @ValidateNested() @Type(() => PrecosCouponDto) cupom!: PrecosCouponDto
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Matches(ITEM_ID, { each: true, message: 'Anúncio inválido.' }) ids!: string[]
}

class PrecosCouponCreateDto extends PrecosCouponPreviewDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() ciente?: boolean
}

class PrecosHistoryQuery {
  @IsOptional() @IsIn(['preco', 'promocao', 'encerrar_promocao', 'cupom', 'cupom_item', 'encerrar_cupom']) tipo?: string
  @IsOptional() @IsIn(['AGENDADA', 'PENDENTE', 'ENVIANDO', 'ENVIADA', 'ERRO', 'CANCELADA', 'DESFEITA']) status?: string
  @IsOptional() @Matches(ITEM_ID) anuncio?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pagina?: number
}

class PrecosRefreshDto {
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Matches(ITEM_ID, { each: true, message: 'Anúncio inválido.' }) ids?: string[]
}

class PrecosItemParam {
  @Matches(ITEM_ID, { message: 'Anúncio inválido.' }) id!: string
}

class PrecosCouponParam {
  @Matches(/^C-[A-Z]{3}\d{1,20}$/, { message: 'Cupom inválido.' }) id!: string
}

const toQuery = (q: { busca?: string; situacao?: string; full?: string; semCusto?: boolean; margemBaixa?: boolean; deposito?: 'menos' | 'igual' | 'mais'; ordem?: string; pagina?: number }): ListQuery => ({ search: q.busca, status: q.situacao, full: q.full, noCost: q.semCusto, lowMargin: q.margemBaixa, deposit: q.deposito, order: q.ordem, page: q.pagina })

function toAction(a: PrecosActionDto): PriceAction {
  if (a.tipo === 'preco') {
    if (!['valor', 'percentual', 'margem', 'sugerido'].includes(a.modo ?? '')) throw new BadRequestException('Escolha como mudar o preço.')
    if (a.modo !== 'sugerido' && typeof a.valor !== 'number') throw new BadRequestException('Informe o valor.')
    return { tipo: 'preco', modo: a.modo as 'valor', valor: a.valor }
  }
  if (a.tipo === 'promocao') {
    if (!['preco', 'percentual'].includes(a.modo ?? '') || typeof a.valor !== 'number' || !a.inicio || !a.fim) throw new BadRequestException('Informe o preço ou o % de desconto, o início e o fim da promoção.')
    return { tipo: 'promocao', modo: a.modo as 'preco', valor: a.valor, inicio: a.inicio, fim: a.fim }
  }
  return { tipo: 'encerrar_promocao' }
}

const toCoupon = (c: PrecosCouponDto): CouponInput => ({ ...c, code: c.code ? c.code.trim().toUpperCase() : null })

/** Marketplaces › Preços e promoções (Mercado Livre). Ver: lista, margem, prévia e histórico. Editar: enviar ao Mercado Livre. */
@ApiTags('Marketplaces: preços e promoções')
@Controller('marketplace-precos')
export class PrecosController {
  constructor(private readonly precos: PrecosService) {}

  @Get('anuncios')
  @RequirePermission('marketplace_precos', 'view')
  list(@CurrentUser() user: AuthUser, @Query() q: PrecosListQueryDto) {
    return this.precos.list(user, toQuery(q))
  }

  @Get('anuncios/:id')
  @RequirePermission('marketplace_precos', 'view')
  get(@CurrentUser() user: AuthUser, @Param() p: PrecosItemParam) {
    return this.precos.get(user, p.id)
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('anuncios/:id/dica-ia')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'view')
  aiTip(@CurrentUser() user: AuthUser, @Param() p: PrecosItemParam) {
    return this.precos.aiTip(user, p.id)
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('ler')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'view')
  refresh(@CurrentUser() user: AuthUser, @Body() dto: PrecosRefreshDto) {
    return this.precos.refresh(user, dto.ids?.length ? dto.ids : undefined)
  }

  @Get('configuracao')
  @RequirePermission('marketplace_precos', 'view')
  config(@CurrentUser() user: AuthUser) {
    return this.precos.config(user.tenantId)
  }

  @Put('configuracao')
  @RequirePermission('marketplace_precos', 'edit')
  saveConfig(@CurrentUser() user: AuthUser, @Body() dto: PrecosConfigDto, @ReqContext() ctx: RequestCtx) {
    return this.precos.saveConfig(user, dto, ctx)
  }

  @Put('lucro')
  @RequirePermission('marketplace_precos', 'edit')
  setProfit(@CurrentUser() user: AuthUser, @Body() dto: PrecosProfitDto, @ReqContext() ctx: RequestCtx) {
    return this.precos.setProfit(user, dto.sku, { profitValue: dto.profitValue ?? null, profitPct: dto.profitPct ?? null, profitSalePct: dto.profitSalePct ?? null }, ctx)
  }

  @Put('custos')
  @RequirePermission('marketplace_precos', 'edit')
  setCost(@CurrentUser() user: AuthUser, @Body() dto: PrecosCostDto, @ReqContext() ctx: RequestCtx) {
    return this.precos.setCost(user, dto.sku, dto.cost ?? null, ctx)
  }

  @Post('custos/massa')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'edit')
  bulkCost(@CurrentUser() user: AuthUser, @Body() dto: PrecosBulkCostDto, @ReqContext() ctx: RequestCtx) {
    const s = dto.selecao
    return this.precos.bulkCost(user, { ids: s.ids, todos: s.todos, filtro: s.filtro ? toQuery(s.filtro) : undefined }, dto.modo, dto.valor, ctx)
  }

  @Post('custos/planilha')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'edit')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importCosts(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @ReqContext() ctx: RequestCtx) {
    return this.precos.importCosts(user, file, ctx)
  }

  @Get('impostos')
  @RequirePermission('marketplace_precos', 'view')
  taxes(@CurrentUser() user: AuthUser) {
    return this.precos.taxesView(user)
  }

  @Post('impostos/recalcular')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'edit')
  recomputeTaxes(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.precos.recomputeTaxes(user, ctx)
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('previa')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'view')
  preview(@CurrentUser() user: AuthUser, @Body() dto: PrecosPreviewDto) {
    return this.precos.preview(user, dto.ids, toAction(dto.acao))
  }

  @Post('enviar')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'edit')
  send(@CurrentUser() user: AuthUser, @Body() dto: PrecosSendDto, @ReqContext() ctx: RequestCtx) {
    return this.precos.send(user, dto.ids, toAction(dto.acao), { ack: !!dto.ciente, scheduledAt: dto.agendarPara ?? null }, ctx)
  }

  @Get('historico')
  @RequirePermission('marketplace_precos', 'view')
  history(@CurrentUser() user: AuthUser, @Query() q: PrecosHistoryQuery) {
    return this.precos.history(user, { kind: q.tipo, status: q.status, itemId: q.anuncio, page: q.pagina })
  }

  @Post('alteracoes/:id/desfazer')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'edit')
  undo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.precos.undo(user, id, ctx)
  }

  @Post('alteracoes/:id/cancelar')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'edit')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.precos.cancel(user, id, ctx)
  }

  @Get('cupons')
  @RequirePermission('marketplace_precos', 'view')
  coupons(@CurrentUser() user: AuthUser) {
    return this.precos.coupons(user)
  }

  @Get('cupons/:id/itens')
  @RequirePermission('marketplace_precos', 'view')
  couponItems(@CurrentUser() user: AuthUser, @Param() p: PrecosCouponParam) {
    return this.precos.couponItems(user, p.id)
  }

  @Post('cupons/previa')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'view')
  couponPreview(@CurrentUser() user: AuthUser, @Body() dto: PrecosCouponPreviewDto) {
    return this.precos.couponPreview(user, toCoupon(dto.cupom), dto.ids)
  }

  @Post('cupons')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'edit')
  createCoupon(@CurrentUser() user: AuthUser, @Body() dto: PrecosCouponCreateDto, @ReqContext() ctx: RequestCtx) {
    return this.precos.createCoupon(user, toCoupon(dto.cupom), dto.ids, !!dto.ciente, ctx)
  }

  @Post('cupons/:id/encerrar')
  @HttpCode(200)
  @RequirePermission('marketplace_precos', 'edit')
  endCoupon(@CurrentUser() user: AuthUser, @Param() p: PrecosCouponParam, @ReqContext() ctx: RequestCtx) {
    return this.precos.endCoupon(user, p.id, ctx)
  }
}
