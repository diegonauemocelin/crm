import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator'
import { TwoFactorService } from '../auth/two-factor.service'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { UsersService } from './users.service'

class ListUsersQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive'
}

class CreateUserDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string
  @ApiProperty() @IsEmail({}, { message: 'E-mail inválido.' }) @MaxLength(200) email!: string
  @ApiProperty() @IsUUID() roleId!: string
  @ApiProperty({ required: false }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unitId?: string | null
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 128) password?: string
  @ApiProperty() @IsBoolean() sendInvite!: boolean
}

class UpdateUserDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(2, 120) name?: string
  @ApiProperty({ required: false }) @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) @MaxLength(200) email?: string
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() roleId?: string
  @ApiProperty({ required: false }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() unitId?: string | null
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() active?: boolean
}

/** Usuários nunca são apagados: são desativados, preservando o histórico e a auditoria. */
@ApiTags('Usuários')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Get()
  @RequirePermission('usuarios', 'view')
  list(@CurrentUser() user: AuthUser, @Query() q: ListUsersQuery) {
    return this.users.list(user.tenantId, q)
  }

  @Get(':id')
  @RequirePermission('usuarios', 'view')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(user.tenantId, id)
  }

  @Post()
  @RequirePermission('usuarios', 'create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto, @ReqContext() ctx: RequestCtx) {
    return this.users.create(user, dto, ctx)
  }

  @Patch(':id')
  @RequirePermission('usuarios', 'edit')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @ReqContext() ctx: RequestCtx) {
    return this.users.update(user, id, dto, ctx)
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @RequirePermission('usuarios', 'edit')
  async unlock(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.users.unlock(user, id, ctx)
    return { ok: true }
  }

  @Post(':id/reset-2fa')
  @HttpCode(200)
  @RequirePermission('usuarios', 'edit')
  async reset2fa(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.twoFactor.resetForUser(user, id, ctx)
    return { ok: true }
  }

  @Post(':id/send-password-link')
  @HttpCode(200)
  @RequirePermission('usuarios', 'edit')
  async sendLink(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.users.sendReset(user, id, ctx)
    return { ok: true }
  }
}
