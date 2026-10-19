import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '../config/env'
import { PrismaClient } from '../generated/prisma/client'

/** Erros do banco que passam sozinhos: subindo, em recuperação depois de uma queda ou ainda sem aceitar conexões. */
export function isDatabaseStarting(err: unknown) {
  const text = `${(err as { message?: string })?.message ?? ''} ${JSON.stringify((err as { meta?: unknown })?.meta ?? '')}`
  return /57P03|recovery mode|not yet accepting connections|starting up|ECONNREFUSED|Can't reach database|terminating connection/i.test(text)
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Banco')

  constructor() {
    // O Prisma guarda o plano compilado de cada formato de consulta (padrão: 1.000). Lotes grandes de importação geram
    // planos de vários MB que nunca se repetem e esgotavam a memória da API; 200 cobre com folga as consultas do dia a dia.
    super({ adapter: new PrismaPg({ connectionString: env.databaseUrl }), queryPlanCacheMaxSize: 200 })
  }

  /**
   * Espera o banco aceitar conexões antes de a API começar (até 2 minutos). Depois de uma queda, o PostgreSQL passa
   * um tempo "em recuperação"; sem esperar, a API caía na inicialização e ficava reiniciando sem parar.
   */
  async onModuleInit() {
    const until = Date.now() + 120_000
    for (let attempt = 1; ; attempt++) {
      try {
        await this.$queryRaw`SELECT 1`
        if (attempt > 1) this.logger.log('Banco de dados disponível de novo.')
        return
      } catch (err) {
        if (!isDatabaseStarting(err) || Date.now() > until) throw err
        if (attempt === 1 || attempt % 10 === 0) this.logger.warn(`Banco de dados ainda subindo ou em recuperação; esperando... (${(err as Error).message.split('\n').pop()?.slice(0, 160)})`)
        await new Promise((r) => setTimeout(r, 3_000))
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
