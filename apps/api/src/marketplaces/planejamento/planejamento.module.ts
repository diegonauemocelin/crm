import { Module } from '@nestjs/common'
import { EmailModule } from '../../email/email.module'
import { MarketplacesModule } from '../marketplaces.module'
import { MarketplaceTaxModule } from '../precos/impostos.module'
import { PlanejamentoController } from './planejamento.controller'
import { PlanejamentoService } from './planejamento.service'

/** Marketplaces › Planejamento (Mercado Livre): curva ABC, auditoria e SWOT, metas, Full, sazonalidade e DRE. */
@Module({
  imports: [EmailModule, MarketplacesModule, MarketplaceTaxModule],
  controllers: [PlanejamentoController],
  providers: [PlanejamentoService],
})
export class MarketplacePlanejamentoModule {}
