import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '../config/env'
import { PrismaClient } from '../generated/prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    // O Prisma guarda o plano compilado de cada formato de consulta (padrão: 1.000). Lotes grandes de importação geram
    // planos de vários MB que nunca se repetem e esgotavam a memória da API; 200 cobre com folga as consultas do dia a dia.
    super({ adapter: new PrismaPg({ connectionString: env.databaseUrl }), queryPlanCacheMaxSize: 200 })
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
