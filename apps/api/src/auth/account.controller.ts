import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator'
import type { Response } from 'express'
import { env } from '../config/env'
import { AllowPending2fa, CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { FilesService, IMAGE_UPLOAD_LIMIT } from '../files/files.service'
import { LayoutMode, ThemeMode } from '../generated/prisma/enums'
import { AccountService } from './account.service'
import { ChangePasswordDto } from './auth.dto'
import { ACCESS_COOKIE } from './cookies'
import { SecurityService } from './security.service'
import { VIEW_SCREENS, type ViewScreen } from './visoes'

const VIEW_SCREENS_ENUM = Object.fromEntries(VIEW_SCREENS.map((s) => [s, s]))

class PreferencesDto {
  @ApiProperty({ enum: LayoutMode, required: false }) @IsOptional() @IsEnum(LayoutMode) layout?: LayoutMode
  @ApiProperty({ enum: ThemeMode, required: false }) @IsOptional() @IsEnum(ThemeMode) theme?: ThemeMode
  @ApiProperty({ enum: ['ATUAL', 'NOVO'], required: false }) @IsOptional() @IsIn(['ATUAL', 'NOVO']) screens?: 'ATUAL' | 'NOVO'
}

class ViewsDto {
  @ApiProperty({ description: 'Lista completa das visões da tela: [{ id?, name, query }]' }) @IsArray() @ArrayMaxSize(20) views!: unknown[]
}

class LessonDto {
  @ApiProperty() @IsBoolean() done!: boolean
}

class ProfileDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
  @ApiPropertyOptional({ description: 'Como o nome aparece nas mensagens do WhatsApp; vazio = primeiro nome' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) chatSignature?: string | null
}

@ApiTags('Minha conta')
@Controller('me')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly files: FilesService,
    private readonly security: SecurityService,
  ) {}

  /** Aparelhos conectados: cada login aberto, com navegador, sistema, IP e último uso. */
  @AllowPending2fa()
  @Get('sessoes')
  sessions(@CurrentUser() user: AuthUser) {
    return this.security.sessions(user.id, user.familyId)
  }

  @AllowPending2fa()
  @Delete('sessoes/:id')
  revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.security.revokeSession(user, id, ctx)
  }

  @AllowPending2fa()
  @Post('sessoes/encerrar-outras')
  @HttpCode(200)
  revokeOthers(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    return this.security.revokeOthers(user, ctx)
  }

  @Patch('preferences')
  preferences(@CurrentUser() user: AuthUser, @Body() dto: PreferencesDto) {
    return this.account.updatePreferences(user, dto)
  }

  /** Visões salvas (telas novas): filtros guardados com um nome, só para mim. */
  @Get('visoes/:tela')
  views(@CurrentUser() user: AuthUser, @Param('tela', new ParseEnumPipe(VIEW_SCREENS_ENUM)) screen: ViewScreen) {
    return this.account.views(user, screen)
  }

  @Put('visoes/:tela')
  saveViews(@CurrentUser() user: AuthUser, @Param('tela', new ParseEnumPipe(VIEW_SCREENS_ENUM)) screen: ViewScreen, @Body() dto: ViewsDto) {
    return this.account.saveViews(user, screen, dto.views)
  }

  /** Trilha de conhecimento: lições concluídas por mim. */
  @Get('trilha')
  trail(@CurrentUser() user: AuthUser) {
    return this.account.trail(user)
  }

  @Put('trilha/:licao')
  markLesson(@CurrentUser() user: AuthUser, @Param('licao') lesson: string, @Body() dto: LessonDto) {
    return this.account.markLesson(user, lesson, dto.done)
  }

  /** Progresso da equipe (quem pode ver Usuários). */
  @Get('trilha/equipe')
  teamTrail(@CurrentUser() user: AuthUser) {
    return this.account.teamTrail(user)
  }

  @Patch('profile')
  profile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto, @ReqContext() ctx: RequestCtx) {
    return this.account.updateProfile(user, dto.name, ctx, dto.chatSignature)
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_UPLOAD_LIMIT } }))
  async avatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    const asset = await this.files.saveImage(user.tenantId, 'avatar', file, false)
    return this.account.setAvatar(user, asset.id)
  }

  @AllowPending2fa()
  @Post('password')
  @HttpCode(200)
  async password(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @ReqContext() ctx: RequestCtx,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = await this.account.changePassword(user, dto.currentPassword, dto.newPassword, ctx)
    res.cookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'strict',
      path: '/api',
      maxAge: env.accessTokenTtlSec * 1000,
    })
    return { ok: true }
  }
}
