import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { Request } from 'express'
import { ACCESS_COOKIE } from '../auth/cookies'

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
        // Token vencido ou inválido: cai no limite por IP.
      }
    }
    return r.ip ?? 'desconhecido'
  }
}
