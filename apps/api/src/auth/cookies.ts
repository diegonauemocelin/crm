import type { CookieOptions, Response } from 'express'
import { env } from '../config/env'

export const ACCESS_COOKIE = 'crm_at'
export const REFRESH_COOKIE = 'crm_rt'
export const MFA_COOKIE = 'crm_mfa'
export const CSRF_COOKIE = 'crm_csrf'

function base(path: string, maxAgeSec: number): CookieOptions {
  return { httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path, maxAge: maxAgeSec * 1000 }
}

export function setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, base('/api', env.accessTokenTtlSec))
  res.cookie(REFRESH_COOKIE, refreshToken, base('/api/auth', env.refreshTokenTtlSec))
  res.clearCookie(MFA_COOKIE, { path: '/api/auth' })
}

export function setMfaCookie(res: Response, token: string) {
  res.cookie(MFA_COOKIE, token, base('/api/auth', 5 * 60))
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { path: '/api' })
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' })
  res.clearCookie(MFA_COOKIE, { path: '/api/auth' })
}
