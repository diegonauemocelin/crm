import { Module } from '@nestjs/common'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { MerchantController } from './merchant.controller'
import { MerchantFreteService } from './merchant-frete.service'

/** Google Merchant Center: frete por estado nos produtos do Google Shopping (simulado na Magazord). */
@Module({ imports: [RastreamentoModule], controllers: [MerchantController], providers: [MerchantFreteService] })
export class MerchantModule {}
