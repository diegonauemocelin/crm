import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '../config/env'
import { PrismaClient } from '../generated/prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) })
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
