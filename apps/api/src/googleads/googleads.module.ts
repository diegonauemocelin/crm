import { Module } from '@nestjs/common'
import { LeadsModule } from '../leads/leads.module'
import { GoogleAdsController, GoogleAdsWebhookController } from './googleads.controller'
import { GoogleAdsService } from './googleads.service'

/** Retorno dos atendimentos (venda, perda por motivo, retorno do vendedor) para as campanhas do Google Ads. */
@Module({
  imports: [LeadsModule],
  controllers: [GoogleAdsController, GoogleAdsWebhookController],
  providers: [GoogleAdsService],
})
export class GoogleAdsModule {}
