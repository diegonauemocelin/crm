import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator'
import { CurrentUser, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import { MODULE_KEYS, MODULES, type ModuleKey } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { RolesService } from './roles.service'

class PermissionDto {
  @ApiProperty({ enum: MODULE_KEYS }) @IsIn(MODULE_KEYS as unknown as string[]) module!: ModuleKey
  @ApiProperty() @IsBoolean() view!: boolean
  @ApiProperty() @IsBoolean() create!: boolean
  @ApiProperty() @IsBoolean() edit!: boolean
  @ApiProperty() @IsBoolean() delete!: boolean
  @ApiProperty() @IsBoolean() export!: boolean
  @ApiProperty({ enum: ['OWN', 'ALL'] }) @IsIn(['OWN', 'ALL']) scope!: 'OWN' | 'ALL'
}

class RoleDto {
  @ApiProperty() @IsString() @Length(2, 60) name!: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) description?: string
  @ApiProperty() @IsBoolean() require2fa!: boolean
  @ApiProperty() @IsBoolean() active!: boolean
  @ApiProperty({ type: [PermissionDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions!: PermissionDto[]
}

@ApiTags('Perfis de acesso')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('modules')
  @RequirePermission('perfis', 'view')
  modules() {
    return MODULES
  }

  @Get()
  @RequirePermission('perfis', 'view')
  list(@CurrentUser() user: AuthUser) {
    return this.roles.list(user.tenantId)
  }

  /** Lista enxuta para o seletor de perfil no cadastro de usuários. */
  @Get('options')
  @RequirePermission('usuarios', 'view')
  async options(@CurrentUser() user: AuthUser) {
    const roles = await this.roles.list(user.tenantId)
    return roles.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }))
  }

  @Get(':id')
  @RequirePermission('perfis', 'view')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(user.tenantId, id)
  }

  @Post()
  @RequirePermission('perfis', 'create')
  create(@CurrentUser() user: AuthUser, @Body() dto: RoleDto, @ReqContext() ctx: RequestCtx) {
    return this.roles.create(user, dto, ctx)
  }

  @Put(':id')
  @RequirePermission('perfis', 'edit')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto, @ReqContext() ctx: RequestCtx) {
    return this.roles.update(user, id, dto, ctx)
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('perfis', 'delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    await this.roles.remove(user, id, ctx)
    return { ok: true }
  }
}
