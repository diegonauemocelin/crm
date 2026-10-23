import { Module } from '@nestjs/common'
import { MarketplacesController } from './marketplaces.controller'
import { MarketplacesService } from './marketplaces.service'
import { MercadoLivreService } from './mercadolivre.service'

/** Marketplaces: publicidade e vendas do Mercado Livre (e, depois, da Shopee). */
@Module({
  exports: [MercadoLivreService, MarketplacesService],
  controllers: [MarketplacesController],
  providers: [MercadoLivreService, MarketplacesService],
})
export class MarketplacesModule {}
