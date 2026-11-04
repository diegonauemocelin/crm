import { Body, Controller, Delete, Get, HttpCode, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { MAX_LOOKBACK_DAYS, SEFAZ_INTERVALS } from './sefaz'
import { SefazService } from './sefaz.service'

class SefazSettingsDto {
  @ApiPropertyOptional({ enum: ['PRODUCAO', 'HOMOLOGACAO'] }) @IsOptional() @IsIn(['PRODUCAO', 'HOMOLOGACAO']) env?: 'PRODUCAO' | 'HOMOLOGACAO'
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(11) @Max(53) ufCode?: number
  @ApiPropertyOptional({ enum: SEFAZ_INTERVALS }) @IsOptional() @Type(() => Number) @IsIn([...SEFAZ_INTERVALS]) intervalHours?: number
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LOOKBACK_DAYS) lookbackDays?: number
}

class SefazCertDto extends SefazSettingsDto {
  @ApiPropertyOptional() @IsString() @MaxLength(200) senha!: string
}

/** Captura de CT-e na SEFAZ (Distribuição DF-e): configuração, certificado A1 e "Buscar agora". */
@ApiTags('Fretes')
@Controller('fretes/sefaz')
export class FretesSefazController {
  constructor(private readonly sefaz: SefazService) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.sefaz.view(user)
  }

  @Post('certificado')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 100 * 1024 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Body() dto: SefazCertDto, @ReqContext() ctx: RequestCtx) {
    const { senha, ...settings } = dto
    return this.sefaz.uploadCertificate(user, file, senha, settings, ctx)
  }

  @Put()
  save(@CurrentUser() user: AuthUser, @Body() dto: SefazSettingsDto, @ReqContext() ctx: RequestCtx) {
    return this.sefaz.save(user, dto, ctx)
  }

  @Delete('certificado')
  remove(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.sefaz.removeCertificate(user, ctx)
  }

  @Post('reler')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  restart(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.sefaz.restart(user, ctx)
  }

  @Post('buscar')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  run(@CurrentUser() user: AuthUser) {
    return this.sefaz.runNow(user)
  }
}
