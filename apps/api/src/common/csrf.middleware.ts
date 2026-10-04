import { ForbiddenException, Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { CSRF_COOKIE } from '../auth/cookies'
import { env } from '../config/env'
import { randomToken, safeEqual } from './crypto'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/**
 * Webhooks de terceiros e o rastreamento do site vêm de outros domínios, sem cookie e sem sessão:
 * webhooks são autenticados por assinatura; o rastreamento só recebe páginas vistas e não altera nada sensível.
 */
const EXEMPT_PREFIXES = ['/api/webhooks/', '/api/public/rastreamento/']

function originOf(referer: string | undefined): string | undefined {
  if (!referer) return undefined
  try {
    return new URL(referer).origin
  } catch {
    return 'invalid'
  }
}

/**
 * Defesa CSRF em duas camadas, além do SameSite=Strict:
 * 1. Origin/Referer precisam ser do próprio domínio em métodos que alteram dados.
 * 2. Double-submit: o header X-CSRF-Token precisa repetir o cookie crm_csrf.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Sem cookie de CSRF para quem chega de fora (visitantes do site, Meta): eles nunca usam o painel.
    if (EXEMPT_PREFIXES.some((p) => req.originalUrl.startsWith(p))) return next()
    let token = req.cookies?.[CSRF_COOKIE] as string | undefined
    if (!token) {
      token = randomToken(24)
      res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: env.cookieSecure, sameSite: 'strict', path: '/' })
    }

    if (SAFE_METHODS.has(req.method)) return next()

    const origin = req.headers.origin ?? originOf(req.headers.referer)
    if (origin !== undefined && origin !== env.appUrl) throw new ForbiddenException('Origem da requisição não permitida.')

    const header = req.headers['x-csrf-token']
    if (typeof header !== 'string' || !req.cookies?.[CSRF_COOKIE] || !safeEqual(header, req.cookies[CSRF_COOKIE])) {
      throw new ForbiddenException('Token CSRF inválido. Recarregue a página.')
    }
    next()
  }
}
