import { Module } from '@nestjs/common'
import { MetaLeadAdsService } from '../integracoes/meta.service'
import { LeadsModule } from '../leads/leads.module'
import { MetaAdminController, MetaWebhookController, PublicTrackingController, TrackingController } from './rastreamento.controller'
import { RastreamentoService } from './rastreamento.service'

/** Rastreamento do site (visitas, UTMs, identificação) e entrada de leads do Meta Lead Ads. */
@Module({
  imports: [LeadsModule],
  controllers: [PublicTrackingController, TrackingController, MetaWebhookController, MetaAdminController],
  providers: [RastreamentoService, MetaLeadAdsService],
  exports: [RastreamentoService],
})
export class RastreamentoModule {}
