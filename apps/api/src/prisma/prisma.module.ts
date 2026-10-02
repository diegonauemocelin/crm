import { Global, Injectable, Module, NotFoundException } from '@nestjs/common'
import { env } from '../config/env'
import { PrismaService } from './prisma.service'

/**
 * Hoje o sistema atende uma empresa só. Rotas públicas (login, branding) usam o tenant padrão;
 * quando virar SaaS, a resolução passa a ser pelo domínio da requisição.
 */
@Injectable()
export class TenantService {
  private defaultTenantId: string | null = null

  constructor(private readonly prisma: PrismaService) {}

  async defaultId(): Promise<string> {
    if (this.defaultTenantId) return this.defaultTenantId
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: env.tenantSlug } })
    if (!tenant) throw new NotFoundException('Tenant padrão não encontrado. Rode o seed (npm run db:seed).')
    this.defaultTenantId = tenant.id
    return tenant.id
  }
}

@Global()
@Module({
  providers: [PrismaService, TenantService],
  exports: [PrismaService, TenantService],
})
export class PrismaModule {}
