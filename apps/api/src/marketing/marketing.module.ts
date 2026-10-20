import { Module } from '@nestjs/common'
import { MarketingController } from './marketing.controller'
import { MarketingService } from './marketing.service'
import { MarketingReportsService } from './relatorios.service'

/** Marketing Inteligente: análises de marketing e vendas sobre os dados do CRM, sem alterar os módulos atuais. */
@Module({
  controllers: [MarketingController],
  providers: [MarketingService, MarketingReportsService],
})
export class MarketingModule {}
