import { Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { type CatalogFilters, CatalogoService, type Sort, SORTS } from './catalogo.service'

class FiltersDto implements CatalogFilters {
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @IsString() @MaxLength(120) brand?: string
  @IsOptional() @IsIn(['com', 'sem']) stock?: 'com' | 'sem'
  @IsOptional() @IsIn(['ativos', 'inativos', 'todos']) status?: 'ativos' | 'inativos' | 'todos'
  @IsOptional() @IsIn(['true']) promo?: 'true'
  @IsOptional() @IsIn(SORTS) sort?: Sort
}

class ListDto extends FiltersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(12) @Max(100) pageSize = 48
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const money = (v: number | null) => (v === null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

@ApiTags('Catálogo')
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    const { page, pageSize, ...f } = q
    return this.catalogo.list(user, f, page, pageSize)
  }

  @Get('resumo')
  summary(@CurrentUser() user: AuthUser) {
    return this.catalogo.summary(user)
  }

  @Post('atualizar')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  refresh(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.catalogo.refresh(user, ctx)
  }

  @Get('exportar')
  async export(@CurrentUser() user: AuthUser, @Query() q: FiltersDto, @ReqContext() ctx: RequestCtx, @Res() res: Response) {
    const rows = await this.catalogo.exportRows(user, q, ctx)
    const header = ['Código', 'Produto', 'Marca', 'Preço', 'Preço de (antes do desconto)', 'Desconto (%)', 'Estoque', 'Ativo na loja', 'Carrinhos (90 dias)', 'Abandonados (90 dias)', 'Comprados (90 dias)', 'Link', 'Imagem']
    const lines = rows.map((p) =>
      [p.code, p.name, p.brand, money(p.price), money(p.priceFrom), p.discount ?? '', p.stock ?? '', p.active ? 'Sim' : 'Não', p.carts, p.abandoned, p.bought, p.url, p.image].map(csvCell).join(';'),
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="catalogo-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send('﻿' + [header.join(';'), ...lines].join('\r\n'))
  }
}
