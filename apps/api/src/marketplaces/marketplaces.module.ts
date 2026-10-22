import { Module } from '@nestjs/common'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { BiArchiveService } from './bi.service'
import { MarketplacesController } from './marketplaces.controller'
import { MarketplacesService } from './marketplaces.service'
import { MercadoLivreService } from './mercadolivre.service'
import { MlQuestionsService } from './perguntas.service'

/**
 * Marketplaces: publicidade e vendas do Mercado Livre (e, depois, da Shopee), as perguntas de frete respondidas com a
 * cotação da Magazord e o histórico trazido do sistema anterior.
 */
@Module({
  imports: [RastreamentoModule],
  controllers: [MarketplacesController],
  providers: [MercadoLivreService, MarketplacesService, BiArchiveService, MlQuestionsService],
})
export class MarketplacesModule {}
