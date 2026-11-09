import { Body, Controller, Delete, Get, Headers, HttpException, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import type { Request, Response } from 'express'
import { CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { MAX_MONTHS, MAX_PAGE } from './bi'
import { BiService } from './bi.service'

class BiPageQuery {
  /** Fatos: só o que foi criado ou alterado desde a data. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desde precisa ser uma data AAAA-MM-DD.' }) desde?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_MONTHS) meses?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE) limite?: number
  @IsOptional() @IsString() @MaxLength(2000) cursor?: string
}

class BiKeyDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string
}

/**
 * API de BI para o Power BI (Desktop e Service, sem gateway): tabelas só de leitura, autenticadas pela chave no
 * cabeçalho X-BI-Key (sem sessão e sem cookie). Fora do CSRF (só GET) e com limite por chave no serviço.
 */
@ApiTags('Power BI')
@Public()
@Controller('bi/v1')
export class BiDataController {
  constructor(private readonly bi: BiService) {}

  /** Teste de conexão do Power BI Service (credencial anônima): responde sem chave e sem dados. */
  @Get()
  root() {
    return { ok: true, api: 'CRM BI', versao: 'v1' }
  }

  @Get('tabelas')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async tables(@Headers('x-bi-key') key: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth(key, req, res)
    return this.bi.tables()
  }

  @Get(':tabela')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async page(@Headers('x-bi-key') key: string | undefined, @Param('tabela') tabela: string, @Query() q: BiPageQuery, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const k = await this.auth(key, req, res)
    res.setHeader('Cache-Control', 'no-store')
    return this.bi.page(k, tabela.slice(0, 60), q)
  }

  private async auth(key: string | undefined, req: Request, res: Response) {
    try {
      return await this.bi.authenticate(key, req.ip ?? null)
    } catch (err) {
      const body = err instanceof HttpException ? (err.getResponse() as { retryAfter?: number }) : null
      if (body && typeof body === 'object' && body.retryAfter) res.setHeader('Retry-After', String(body.retryAfter))
      throw err
    }
  }
}

/** Configurações › Power BI: chaves de acesso (criar, listar, revogar) e o contrato de dados em Markdown. */
@ApiTags('Power BI')
@Controller('power-bi')
export class BiKeysController {
  constructor(private readonly bi: BiService) {}

  @Get('chaves')
  keys(@CurrentUser() user: AuthUser) {
    return this.bi.keys(user)
  }

  @Post('chaves')
  create(@CurrentUser() user: AuthUser, @Body() body: BiKeyDto, @ReqContext() ctx: RequestCtx) {
    return this.bi.createKey(user, body.name, ctx)
  }

  @Delete('chaves/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.bi.revokeKey(user, id, ctx)
  }

  @Get('contrato')
  contract(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const md = this.bi.contrato(user)
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', 'attachment; filename="BI-CONTRATO.md"')
    res.send(md)
  }
}
