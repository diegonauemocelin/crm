import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { RelatoriosService } from './relatorios.service'

/** A configuração é conferida em detalhe por src/relatorios/fontes.ts (cleanConfig). */
class RunDto {
  @ApiProperty() @IsObject() config!: Record<string, unknown>
}

class SavedDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) description?: string | null
  @ApiProperty() @IsObject() config!: Record<string, unknown>
  @ApiProperty() @IsIn(['privado', 'equipe']) visibility!: 'privado' | 'equipe'
  @ApiProperty() @IsBoolean() pinned!: boolean
  @ApiProperty() @Type(() => Number) @IsIn([1, 2]) width!: 1 | 2
}

class ArrangeDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @IsIn([1, 2]) width?: 1 | 2
  @ApiPropertyOptional() @IsOptional() @IsIn(['up', 'down']) move?: 'up' | 'down'
}

class RangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string
  @IsOptional() @IsIn(['1']) atualizar?: '1'
}

class ValuesDto {
  @IsString() @MaxLength(40) fonte!: string
  @IsString() @MaxLength(40) campo!: string
}

class Ga4Dto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiProperty() @IsString() @MaxLength(40) propertyId!: string
  @ApiPropertyOptional({ description: 'Conteúdo do arquivo JSON da conta de serviço. Vazio mantém a chave atual.' }) @IsOptional() @IsString() @MaxLength(20_000) keyFile?: string
}

@ApiTags('Dashboards e relatórios')
@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

  @Get('catalogo')
  catalog(@CurrentUser() user: AuthUser) {
    return this.relatorios.catalog(user)
  }

  @Post('executar')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  run(@CurrentUser() user: AuthUser, @Body() dto: RunDto) {
    return this.relatorios.run(user, dto.config)
  }

  @Post('exportar')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async export(@CurrentUser() user: AuthUser, @Body() dto: RunDto, @ReqContext() ctx: RequestCtx, @Res() res: Response) {
    const { filename, content } = await this.relatorios.exportCsv(user, dto.config, ctx)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(content)
  }

  @Get('valores')
  values(@CurrentUser() user: AuthUser, @Query() q: ValuesDto) {
    return this.relatorios.values(user, q.fonte, q.campo)
  }

  @Get('visao-geral')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  overview(@CurrentUser() user: AuthUser, @Query() q: RangeDto) {
    return this.relatorios.overview(user, q.from, q.to)
  }

  @Get('salvos')
  listSaved(@CurrentUser() user: AuthUser) {
    return this.relatorios.listSaved(user)
  }

  @Post('salvos')
  create(@CurrentUser() user: AuthUser, @Body() dto: SavedDto, @ReqContext() ctx: RequestCtx) {
    return this.relatorios.create(user, dto, ctx)
  }

  @Get('salvos/:id')
  getSaved(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.relatorios.getSaved(user, id)
  }

  @Get('salvos/:id/dados')
  runSaved(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.relatorios.runSaved(user, id)
  }

  @Put('salvos/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SavedDto, @ReqContext() ctx: RequestCtx) {
    return this.relatorios.update(user, id, dto, ctx)
  }

  @Delete('salvos/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.relatorios.remove(user, id, ctx)
  }

  @Post('salvos/:id/duplicar')
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.relatorios.duplicate(user, id, ctx)
  }

  @Post('salvos/:id/painel')
  @HttpCode(200)
  arrange(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ArrangeDto) {
    return this.relatorios.arrange(user, id, dto)
  }

  @Get('ga4')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  ga4(@CurrentUser() user: AuthUser, @Query() q: RangeDto) {
    return this.relatorios.ga4Report(user, q.from, q.to, q.atualizar === '1')
  }

  @Get('ga4/configuracao')
  @RequirePermission('configuracoes', 'view')
  async ga4Config(@CurrentUser() user: AuthUser) {
    return this.relatorios.ga4View(await this.relatorios.ga4Config(user.tenantId))
  }

  @Put('ga4/configuracao')
  @RequirePermission('configuracoes', 'edit')
  saveGa4(@CurrentUser() user: AuthUser, @Body() dto: Ga4Dto, @ReqContext() ctx: RequestCtx) {
    return this.relatorios.saveGa4(user, dto, ctx)
  }

  @Post('ga4/testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('configuracoes', 'edit')
  testGa4(@CurrentUser() user: AuthUser) {
    return this.relatorios.testGa4(user)
  }
}
