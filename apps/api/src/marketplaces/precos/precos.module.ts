import { Module } from '@nestjs/common'
import { EmailModule } from '../../email/email.module'
import { MarketplacesModule } from '../marketplaces.module'
import { MarketplaceTaxModule } from './impostos.module'
import { PrecosController } from './precos.controller'
import { PrecosService } from './precos.service'

/** Marketplaces › Preços e promoções (Mercado Livre): margem, preço, desconto individual e cupons do vendedor. */
@Module({
  imports: [EmailModule, MarketplacesModule, MarketplaceTaxModule],
  controllers: [PrecosController],
  providers: [PrecosService],
})
export class MarketplacePrecosModule {}
