import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { ALLOW_PENDING_2FA, IS_PUBLIC, PERMISSION } from '../common/decorators'
import { type Action, can, type PermissionSet } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import type { AccessPayload } from './auth.service'
import { ACCESS_COOKIE } from './cookies'

/**
 * Guard global: toda rota exige sessão válida, a menos que tenha @Public().
 * A cada requisição o usuário e o perfil são lidos do banco, para que desativar um usuário,
 * trocar o perfil ou encerrar a sessão tenha efeito imediato.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true

    const req = context.switchToHttp().getRequest<Request>()
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined
    if (!token) throw new UnauthorizedException()

    let payload: AccessPayload & { iat: number }
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] })
    } catch {
      throw new UnauthorizedException()
    }

    const [user, liveSession] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { role: { include: { permissions: true } } },
      }),
      this.prisma.refreshToken.findFirst({ where: { familyId: payload.fam, revokedAt: null }, select: { id: true } }),
    ])
    if (!user || !user.active || !user.role.active || !liveSession || user.tenantId !== payload.tid) {
      throw new UnauthorizedException()
    }
    // Senha trocada depois da emissão do token invalida a sessão.
    if (payload.iat * 1000 < user.passwordChangedAt.getTime() - 1000) throw new UnauthorizedException()

    const permissions: PermissionSet = Object.fromEntries(
      user.role.permissions.map((p) => [
        p.module,
        { view: p.canView, create: p.canCreate, edit: p.canEdit, delete: p.canDelete, export: p.canExport, scope: p.scope },
      ]),
    )
    const pending2faSetup = user.role.require2fa && !user.totpEnabled
    const authUser: AuthUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      familyId: payload.fam,
      pending2faSetup,
      role: { id: user.role.id, name: user.role.name, isSystem: user.role.isSystem, require2fa: user.role.require2fa },
      permissions,
    }
    req.user = authUser

    const allowIncomplete = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_2FA, targets)
    if (user.mustChangePassword && !allowIncomplete) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Troque sua senha provisória para continuar.' })
    }
    if (pending2faSetup && !allowIncomplete) {
      throw new ForbiddenException({ code: 'MFA_SETUP_REQUIRED', message: 'Configure a autenticação em dois fatores para continuar.' })
    }

    const required = this.reflector.getAllAndOverride<{ module: string; action: Action } | undefined>(PERMISSION, targets)
    if (required && !can(permissions, user.role.isSystem, required.module, required.action)) {
      throw new ForbiddenException('Você não tem permissão para esta ação.')
    }
    return true
  }
}
