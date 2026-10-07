import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import type { Response } from 'express'
import { AuditService } from '../audit/audit.service'
import { encrypt } from '../common/crypto'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { LeadsService } from '../leads/leads.service'
import { normalizeTags } from '../leads/mapeamento'
import { type CartFilters, type CartView, CONTACT_STATUSES, type ContactStatus, LojaService } from './loja.service'
import { cleanBaseUrl, cleanHttpsBase } from './magazord'
import { MagazordService, type MagazordSettings } from './magazord.service'

class MagazordDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty() @IsString() @MaxLength(200) baseUrl!: string
  @ApiPropertyOptional({ description: 'Vazio mantém o atual' }) @IsOptional() @IsString() @MaxLength(300) token?: string
  @ApiPropertyOptional({ description: 'Vazio mantém a atual' }) @IsOptional() @IsString() @MaxLength(300) password?: string
  @ApiProperty() @IsBoolean() importCustomers!: boolean
  @ApiProperty() @IsBoolean() importOrders!: boolean
  @ApiProperty() @IsBoolean() importCarts!: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() importProducts?: boolean
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) storeId?: number
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) siteUrl?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) imageBaseUrl?: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() ownerId?: string | null
  @ApiProperty() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) tags!: string[]
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(168) abandonHours!: number
  @ApiProperty() @IsString() @MaxLength(1000) cartMessage!: string
  @ApiProperty() @IsString() @MaxLength(40) coupon!: string
}

class CartQueryDto implements CartFilters {
  @IsIn(['abandonados', 'checkout', 'recuperados', 'todos']) view: CartView = 'abandonados'
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @IsIn(CONTACT_STATUSES) contactStatus?: ContactStatus
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string
}

class CartListDto extends CartQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100) pageSize = 30
}

class ContactDto {
  @ApiProperty({ enum: CONTACT_STATUSES }) @IsIn(CONTACT_STATUSES) contactStatus!: ContactStatus
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) note?: string | null
}

function view(s: MagazordSettings) {
  const { tokenEnc, passwordEnc, ...rest } = s
  return { ...rest, hasToken: !!tokenEnc, hasPassword: !!passwordEnc }
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

@ApiTags('Integrações')
@Controller('integracoes/magazord')
export class MagazordController {
  constructor(
    private readonly magazord: MagazordService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('configuracoes', 'view')
  async get(@CurrentUser() user: AuthUser) {
    const [s, state] = await Promise.all([this.magazord.config(user.tenantId), this.magazord.state(user.tenantId)])
    return { ...view(s), state }
  }

  @Put()
  @RequirePermission('configuracoes', 'edit')
  async save(@CurrentUser() user: AuthUser, @Body() dto: MagazordDto, @ReqContext() ctx: RequestCtx) {
    const base = dto.baseUrl.trim() ? cleanBaseUrl(dto.baseUrl) : ''
    if (base === null) throw new BadRequestException('Endereço inválido. Use o do painel da loja, ex.: https://usaparts.painel.magazord.com.br')
    const current = await this.magazord.config(user.tenantId)
    const { token, password, importProducts, storeId, siteUrl, imageBaseUrl, ...rest } = dto
    for (const [label, v] of [['site', siteUrl], ['imagens', imageBaseUrl]] as const) {
      if (v?.trim() && !cleanHttpsBase(v)) throw new BadRequestException(`Endereço de ${label} inválido (use https://).`)
    }
    const next: MagazordSettings = {
      ...current,
      ...rest,
      baseUrl: base,
      importProducts: importProducts ?? current.importProducts,
      storeId: storeId ?? current.storeId,
      siteUrl: siteUrl === undefined ? current.siteUrl : (cleanHttpsBase(siteUrl) ?? ''),
      imageBaseUrl: imageBaseUrl === undefined ? current.imageBaseUrl : (cleanHttpsBase(imageBaseUrl) ?? ''),
      ownerId: dto.ownerId ?? null,
      tags: normalizeTags(dto.tags),
      tokenEnc: token?.trim() ? encrypt(token.trim()) : current.tokenEnc,
      passwordEnc: password ? encrypt(password) : current.passwordEnc,
    }
    if (next.enabled && (!next.baseUrl || !next.tokenEnc || !next.passwordEnc)) throw new BadRequestException('Para ligar, informe o endereço do painel, o token e a senha do usuário WebService.')
    await this.magazord.save(user.tenantId, next)
    await this.audit.byUser(user, ctx, 'settings.magazord_updated', 'settings', 'magazord', {
      ativo: next.enabled,
      endereco: next.baseUrl,
      clientes: next.importCustomers,
      pedidos: next.importOrders,
      carrinhos: next.importCarts,
      produtos: next.importProducts,
      tokenAlterado: !!token,
      senhaAlterada: !!password,
    })
    return { ...view(next), state: await this.magazord.state(user.tenantId) }
  }

  @Post('testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('configuracoes', 'edit')
  async test(@CurrentUser() user: AuthUser) {
    return this.magazord.test(await this.magazord.config(user.tenantId))
  }

  /** Roda uma sincronização agora (em segundo plano; a tela acompanha pelo andamento). */
  @Post('sincronizar')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @RequirePermission('configuracoes', 'edit')
  async sync(@CurrentUser() user: AuthUser) {
    const s = await this.magazord.config(user.tenantId)
    if (!s.enabled) throw new BadRequestException('Ligue a integração antes de sincronizar.')
    await this.magazord.logSync(user.tenantId, user.id, user.email)
    void this.magazord.sync(user.tenantId).catch(() => undefined)
    return { ok: true }
  }
}

@ApiTags('Loja virtual')
@Controller('loja')
export class LojaController {
  constructor(
    private readonly loja: LojaService,
    private readonly leads: LeadsService,
  ) {}

  @Get('carrinhos')
  carts(@CurrentUser() user: AuthUser, @Query() q: CartListDto) {
    const { page, pageSize, ...f } = q
    return this.loja.list(user, f, page, pageSize)
  }

  @Get('carrinhos/exportar')
  async export(@CurrentUser() user: AuthUser, @Query() q: CartQueryDto, @Res() res: Response) {
    const rows = await this.loja.exportRows(user, q)
    const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d) : '')
    const header = ['Cliente', 'E-mail', 'Telefone', 'Produtos', 'Itens', 'Checkout iniciado', 'Última atividade', 'Situação na loja', 'Contato', 'Observação', 'Link do carrinho']
    const lines = rows.map((c) =>
      [
        c.customerName,
        c.customerEmail,
        c.customerPhone,
        ((c.items as unknown as { name: string; qty: number }[]) ?? []).map((i) => `${i.qty}x ${i.name}`).join(' | '),
        c.itemCount,
        c.checkoutStarted ? 'Sim' : 'Não',
        fmt(c.lastActivityAt),
        c.status === 3 ? 'Comprado' : c.status === 2 ? 'Abandonado' : 'Aberto',
        c.contactStatus,
        c.contactNote,
        c.checkoutUrl,
      ]
        .map(csvCell)
        .join(';'),
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="carrinhos-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send('﻿' + [header.join(';'), ...lines].join('\r\n'))
  }

  @Patch('carrinhos/:id')
  contact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContactDto, @ReqContext() ctx: RequestCtx) {
    return this.loja.updateContact(user, id, dto.contactStatus, dto.note ?? null, ctx)
  }

  /** Aba "Loja virtual" da ficha: pedidos e carrinhos do lead (mesmo controle de acesso da ficha). */
  @Get('leads/:id')
  async lead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.leads.get(user, id)
    return this.loja.forLead(id)
  }
}
