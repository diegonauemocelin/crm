import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { HOLDER_RE } from './brindes'
import { BrindesService } from './brindes.service'

class GiftDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) stock?: number
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) unitCost?: number
  @IsOptional() @IsBoolean() active?: boolean
  @IsOptional() @IsBoolean() hasQuota?: boolean
}

class QuotaDto {
  /** "s:<vendedor>" ou "u:<filial>". */
  @Matches(HOLDER_RE) holderId!: string
  @IsUUID() giftId!: string
  @IsInt() @Min(0) @Max(100_000) monthly!: number
}

class QuotasDto {
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => QuotaDto) list!: QuotaDto[]
}

class DeliveryItemDto {
  @IsUUID() giftId!: string
  @IsInt() @Min(1) @Max(10_000) quantity!: number
}

class DeliveryDto {
  @IsOptional() @IsUUID() giftId?: string
  /** Vários brindes na mesma retirada. */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => DeliveryItemDto) items?: DeliveryItemDto[]
  @Matches(HOLDER_RE) holderId!: string
  @IsString() @MaxLength(40) customerCode!: string
  @IsOptional() @IsString() @MaxLength(160) customerName?: string | null
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string | null
  @IsOptional() @IsInt() @Min(1) @Max(10_000) quantity?: number
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null
}

class MonthQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) mes?: string
  /** Vendedor ou filial ("s:<id>" / "u:<id>"). */
  @IsOptional() @Matches(HOLDER_RE) vendedor?: string
}

class RangeQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) de?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) ate?: string
}

class PurchaseDto {
  @IsUUID() giftId!: string
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string
  @IsOptional() @IsString() @MaxLength(60) document?: string | null
  @IsOptional() @IsString() @MaxLength(120) supplier?: string | null
  @IsInt() @Min(1) @Max(10_000_000) quantity!: number
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) unitCost?: number | null
  @IsOptional() @IsNumber() @Min(0) @Max(100_000_000) total?: number | null
  @IsOptional() @IsBoolean() addToStock?: boolean
  @IsOptional() @IsBoolean() updateCost?: boolean
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null
}

/** Marketing › Controle de brindes: cadastro, cota mensal por vendedor ou filial, retiradas e resumo. */
@ApiTags('brindes')
@Controller('marketing/brindes')
export class BrindesController {
  constructor(private readonly brindes: BrindesService) {}

  @Get()
  gifts(@CurrentUser() user: AuthUser) {
    return this.brindes.gifts(user)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: GiftDto, @ReqContext() ctx: RequestCtx) {
    return this.brindes.saveGift(user, null, body, ctx)
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: GiftDto, @ReqContext() ctx: RequestCtx) {
    return this.brindes.saveGift(user, id, body, ctx)
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.brindes.removeGift(user, id, ctx)
  }

  @Get('meus')
  mine(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return this.brindes.mine(user, q.mes)
  }

  @Get('mes/saldo')
  month(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return this.brindes.month(user, q.mes)
  }

  @Put('mes/cotas')
  quotas(@CurrentUser() user: AuthUser, @Body() body: QuotasDto, @ReqContext() ctx: RequestCtx) {
    return this.brindes.saveQuotas(user, body.list, ctx)
  }

  @Get('mes/relatorio')
  report(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    return this.brindes.report(user, q.de, q.ate)
  }

  @Get('compras')
  purchases(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    return this.brindes.purchases(user, q.de, q.ate)
  }

  @Post('compras')
  addPurchase(@CurrentUser() user: AuthUser, @Body() body: PurchaseDto, @ReqContext() ctx: RequestCtx) {
    return this.brindes.addPurchase(user, body, ctx)
  }

  @Delete('compras/:id')
  removePurchase(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.brindes.removePurchase(user, id, ctx)
  }

  @Get('mes/retiradas')
  deliveries(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return this.brindes.deliveries(user, q.mes, q.vendedor)
  }

  @Post('mes/retiradas')
  deliver(@CurrentUser() user: AuthUser, @Body() body: DeliveryDto, @ReqContext() ctx: RequestCtx) {
    return this.brindes.deliver(user, body, ctx)
  }

  @Delete('mes/retiradas/:id')
  removeDelivery(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.brindes.removeDelivery(user, id, ctx)
  }
}
