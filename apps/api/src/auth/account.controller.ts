import { Body, Controller, HttpCode, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, Length } from 'class-validator'
import type { Response } from 'express'
import { env } from '../config/env'
import { AllowPending2fa, CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { FilesService, IMAGE_UPLOAD_LIMIT } from '../files/files.service'
import { LayoutMode, ThemeMode } from '../generated/prisma/enums'
import { AccountService } from './account.service'
import { ChangePasswordDto } from './auth.dto'
import { ACCESS_COOKIE } from './cookies'

class PreferencesDto {
  @ApiProperty({ enum: LayoutMode, required: false }) @IsOptional() @IsEnum(LayoutMode) layout?: LayoutMode
  @ApiProperty({ enum: ThemeMode, required: false }) @IsOptional() @IsEnum(ThemeMode) theme?: ThemeMode
}

class ProfileDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
}

@ApiTags('Minha conta')
@Controller('me')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly files: FilesService,
  ) {}

  @Patch('preferences')
  preferences(@CurrentUser() user: AuthUser, @Body() dto: PreferencesDto) {
    return this.account.updatePreferences(user, dto)
  }

  @Patch('profile')
  profile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto, @ReqContext() ctx: RequestCtx) {
    return this.account.updateProfile(user, dto.name, ctx)
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
