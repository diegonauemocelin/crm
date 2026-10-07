import { Module } from '@nestjs/common'
import { LojaController, MagazordController } from '../integracoes/loja.controller'
import { LojaService } from '../integracoes/loja.service'
import { MagazordService } from '../integracoes/magazord.service'
import { MetaLeadAdsService } from '../integracoes/meta.service'
import { LeadsModule } from '../leads/leads.module'
import { MetaAdminController, MetaWebhookController, PublicTrackingController, TrackingController } from './rastreamento.controller'
import { RastreamentoService } from './rastreamento.service'

/** Rastreamento do site (visitas, UTMs, identificação), Meta Lead Ads e loja virtual (Magazord). */
@Module({
  imports: [LeadsModule],
  controllers: [PublicTrackingController, TrackingController, MetaWebhookController, MetaAdminController, MagazordController, LojaController],
  providers: [RastreamentoService, MetaLeadAdsService, MagazordService, LojaService],
  exports: [RastreamentoService, MagazordService],
})
export class RastreamentoModule {}
