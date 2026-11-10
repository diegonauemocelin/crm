import { Controller, Get, Query, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { AnalisesService } from './analises.service'

const DIA = /^\d{4}-\d{2}-\d{2}$/
const DIA_MSG = { message: 'Use a data no formato AAAA-MM-DD.' }

/** Medidas, dimensões e filtros são conferidos em detalhe por src/analises/modelo.ts (listas fechadas). */
class ConsultaDto {
  @Matches(DIA, DIA_MSG) de!: string
  @Matches(DIA, DIA_MSG) ate!: string
  @IsString() @MaxLength(400) medidas!: string
  @IsOptional() @IsString() @MaxLength(100) dims?: string
  /** JSON: {"filial":["<id>"],"uf":["PR"]}. */
  @IsOptional() @IsString() @MaxLength(8000) filtros?: string
  @IsOptional() @IsIn(['anterior', 'mes_anterior', 'ano_anterior']) comparar?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1200) limite?: number
}

class RegistrosDto {
  @Matches(DIA, DIA_MSG) de!: string
  @Matches(DIA, DIA_MSG) ate!: string
  @IsString() @MaxLength(40) medida!: string
  @IsOptional() @IsString() @MaxLength(8000) filtros?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) pagina?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) tamanho?: number
}

class ExportarDto extends RegistrosDto {
  @IsIn(['xlsx', 'csv']) formato!: 'xlsx' | 'csv'
}

/**
 * Análises (BI nativo do CRM): consultas agregadas, "ver registros" e planilha. Sem permissão própria: cada fonte
 * segue o módulo do CRM dela (Pré-Vendas, Base de leads, Chat), com o escopo do perfil.
 */
@ApiTags('Análises')
@Controller('analises')
export class AnalisesController {
  constructor(private readonly analises: AnalisesService) {}

  @Get('modelo')
  modelo(@CurrentUser() user: AuthUser) {
    return this.analises.modelo(user)
  }

  @Get('opcoes')
  opcoes(@CurrentUser() user: AuthUser) {
    return this.analises.opcoes(user)
  }

  @Get('consulta')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  consulta(@CurrentUser() user: AuthUser, @Query() q: ConsultaDto) {
    return this.analises.consulta(user, q)
  }

  @Get('registros')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  registros(@CurrentUser() user: AuthUser, @Query() q: RegistrosDto) {
    return this.analises.registros(user, q)
  }

  @Get('registros/exportar')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async exportar(@CurrentUser() user: AuthUser, @Query() q: ExportarDto, @ReqContext() ctx: RequestCtx, @Res() res: Response) {
    const f = await this.analises.exportar(user, q, q.formato, ctx)
    res.setHeader('Content-Type', f.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(f.content)
  }
}
