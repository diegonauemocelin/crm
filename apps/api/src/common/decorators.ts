import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'
import type { Request } from 'express'
import type { Action, ModuleKey } from './permissions'
import type { AuthUser } from './types'

export const IS_PUBLIC = 'isPublic'
/** Rota acessível sem login. */
export const Public = () => SetMetadata(IS_PUBLIC, true)

export const ALLOW_PENDING_2FA = 'allowPending2fa'
/** Rota liberada enquanto o usuário ainda precisa configurar o 2FA obrigatório. */
export const AllowPending2fa = () => SetMetadata(ALLOW_PENDING_2FA, true)

export const PERMISSION = 'permission'
export const RequirePermission = (module: ModuleKey, action: Action) => SetMetadata(PERMISSION, { module, action })

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<Request>().user as AuthUser
})

export const ReqContext = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>()
  return requestContext(req)
})

export function requestContext(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null }
}
export type RequestCtx = ReturnType<typeof requestContext>
