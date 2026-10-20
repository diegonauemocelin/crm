import { Module } from '@nestjs/common'
import { MarketingController } from './marketing.controller'
import { MarketingService } from './marketing.service'

/**
 * Marketing Inteligente: painéis de marketing ligados ao comercial. Módulo separado, que só lê os dados do CRM
 * (PrismaService, SettingsService e AuditService vêm dos módulos globais/exportados que já existem).
 */
@Module({
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
