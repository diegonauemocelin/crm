import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { env } from '../config/env'
import { AccountController } from './account.controller'
import { AccountService } from './account.service'
import { AuthController } from './auth.controller'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { SecurityService } from './security.service'
import { TwoFactorService } from './two-factor.service'

@Module({
  imports: [JwtModule.register({ secret: env.jwtAccessSecret, signOptions: { algorithm: 'HS256' } })],
  controllers: [AuthController, AccountController],
  providers: [AuthService, TwoFactorService, AccountService, AuthGuard, SecurityService],
  exports: [AuthService, TwoFactorService, AuthGuard, JwtModule, SecurityService],
})
export class AuthModule {}
