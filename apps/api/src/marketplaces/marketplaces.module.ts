import { Module } from '@nestjs/common'
import { BiArchiveService } from './bi.service'
import { MarketplacesController } from './marketplaces.controller'
import { MarketplacesService } from './marketplaces.service'
import { MercadoLivreService } from './mercadolivre.service'

/** Marketplaces: publicidade e vendas do Mercado Livre (e, depois, da Shopee), e o histórico trazido do Usaparts BI. */
@Module({
  controllers: [MarketplacesController],
  providers: [MercadoLivreService, MarketplacesService, BiArchiveService],
})
export class MarketplacesModule {}
