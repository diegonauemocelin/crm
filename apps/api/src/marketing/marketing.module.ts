import { Module } from '@nestjs/common'
import { EmailModule } from '../email/email.module'
import { MarketingManagementService } from './gestao.service'
import { MarketingController } from './marketing.controller'
import { MarketingService } from './marketing.service'
import { MarketingPlatformsService } from './plataformas.service'
import { MarketingReportsService } from './relatorios.service'
import { MarketingSyncService } from './sync.service'

/** Marketing Inteligente: análises de marketing e vendas sobre os dados do CRM, sem alterar os módulos atuais. */
@Module({
  imports: [EmailModule],
  controllers: [MarketingController],
  providers: [MarketingService, MarketingReportsService, MarketingPlatformsService, MarketingManagementService, MarketingSyncService],
})
export class MarketingModule {}
