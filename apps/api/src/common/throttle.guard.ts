import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { Request } from 'express'
import { createHash } from 'node:crypto'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../auth/cookies'

/**
 * Limite de requisições por usuário logado (e não por IP): no escritório todos saem pelo mesmo IP da internet,
 * e o limite por IP somaria a equipe inteira. Só vale o usuário de um token VÁLIDO (assinatura conferida):
 * quem inventa cookies continua limitado pelo IP. Sem sessão (login, formulários do site), o limite é por IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  // Injeção por propriedade: o construtor é o da biblioteca.
  @Inject(JwtService) private readonly jwt!: JwtService

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as Request
    const token = r.cookies?.[ACCESS_COOKIE] as string | undefined
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub?: string }>(token, { algorithms: ['HS256'] })
        if (payload.sub) return `u:${payload.sub}`
      } catch {
        // Token vencido ou inválido: cai no limite da sessão (abaixo) ou por IP.
      }
    }
    // Renovação da sessão (token de acesso vencido): conta por sessão, não pelo IP do escritório (com a equipe toda
    // renovando a cada 15 minutos, o limite por IP recusava a renovação e o app/tela ia para o login).
    // Só na própria renovação: nas outras rotas sem login (login, esqueci a senha, 2FA) um cookie inventado a cada
    // tentativa abriria um contador novo e furaria o limite por IP.
    const refresh = (r.path ?? r.url ?? '').split('?')[0]!.endsWith('/auth/refresh') ? (r.cookies?.[REFRESH_COOKIE] as string | undefined) : undefined
    if (refresh) return `r:${createHash('sha256').update(refresh).digest('hex').slice(0, 32)}`
    return r.ip ?? 'desconhecido'
  }
}
