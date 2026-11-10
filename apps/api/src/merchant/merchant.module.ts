import { Module } from '@nestjs/common'
import { FretesModule } from '../fretes/fretes.module'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { MerchantController } from './merchant.controller'
import { MerchantFreteService } from './merchant-frete.service'

/** Google Merchant Center: frete por estado nos produtos do Google Shopping (simulado na Magazord ou calculado pelas tabelas de Fretes). */
@Module({ imports: [RastreamentoModule, FretesModule], controllers: [MerchantController], providers: [MerchantFreteService] })
export class MerchantModule {}
