import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import type { Response } from 'express'
import { finalize, type Observable } from 'rxjs'
import { REQUESTS } from './monitor.service'

/** Conta cada pedido à API (tempo e se deu erro 5xx) para o Monitoramento. */
@Injectable()
export class RequestCounterInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now()
    const res = ctx.switchToHttp().getResponse<Response>()
    return next.handle().pipe(finalize(() => REQUESTS.add(Date.now() - start, res?.statusCode ?? 200)))
  }
}
