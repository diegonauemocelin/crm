import { Module } from '@nestjs/common'
import { MarketplaceTaxService } from './impostos.service'

/** Impostos das vendas do Mercado Livre (NF-e do Mercado Envios): usado pelos Fretes (importação de XML) e por Preços. */
@Module({
  providers: [MarketplaceTaxService],
  exports: [MarketplaceTaxService],
})
export class MarketplaceTaxModule {}
