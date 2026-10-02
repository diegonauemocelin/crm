import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { AllowPending2fa, CurrentUser, Public, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { AccountService } from './account.service'
import { ForgotPasswordDto, LoginDto, MfaCodeDto, PasswordDto, ResetPasswordDto } from './auth.dto'
import { AuthService } from './auth.service'
import { clearSessionCookies, MFA_COOKIE, REFRESH_COOKIE, setMfaCookie, setSessionCookies } from './cookies'
import { TwoFactorService } from './two-factor.service'

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly account: AccountService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @ReqContext() ctx: RequestCtx, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password, ctx)
    if (result.status === 'mfa_required') {
      setMfaCookie(res, result.mfaToken)
      return { status: result.status }
    }
    setSessionCookies(res, result.accessToken, result.refreshToken)
    return { status: result.status }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/verify')
  @HttpCode(200)
  async verify(@Body() dto: MfaCodeDto, @Req() req: Request, @ReqContext() ctx: RequestCtx, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyMfa(req.cookies?.[MFA_COOKIE], dto.code, ctx)
    setSessionCookies(res, result.accessToken, result.refreshToken)
    return { status: result.status }
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @ReqContext() ctx: RequestCtx, @Res({ passthrough: true }) res: Response) {
    try {
      const result = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], ctx)
      setSessionCookies(res, result.accessToken, result.refreshToken)
      return { ok: true }
    } catch (err) {
      clearSessionCookies(res)
      throw err
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @ReqContext() ctx: RequestCtx, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], req.user?.familyId, ctx)
    clearSessionCookies(res)
    return { ok: true }
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgot(@Body() dto: ForgotPasswordDto, @ReqContext() ctx: RequestCtx) {
    await this.auth.requestPasswordReset(dto.email, ctx)
    return { message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto, @ReqContext() ctx: RequestCtx) {
    await this.auth.resetPassword(dto.token, dto.password, ctx)
    return { message: 'Senha definida. Faça login com a nova senha.' }
  }

  @AllowPending2fa()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.account.profile(user)
  }

  @AllowPending2fa()
  @Post('2fa/setup')
  @HttpCode(200)
  setup2fa(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user)
  }

  @AllowPending2fa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/enable')
  @HttpCode(200)
  enable2fa(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto, @ReqContext() ctx: RequestCtx) {
    return this.twoFactor.enable(user, dto.code, ctx)
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/disable')
  @HttpCode(200)
  async disable2fa(@CurrentUser() user: AuthUser, @Body() dto: PasswordDto, @ReqContext() ctx: RequestCtx) {
    await this.twoFactor.disable(user, dto.password, ctx)
    return { ok: true }
  }
}
