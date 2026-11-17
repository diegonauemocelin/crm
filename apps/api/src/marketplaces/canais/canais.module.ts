import { Module } from '@nestjs/common'
import { MarketplaceTaxModule } from '../precos/impostos.module'
import { CanaisController } from './canais.controller'
import { CanaisService } from './canais.service'

/** Shopee, Amazon e TikTok Shop (anúncios, margem e preços pela API oficial de cada uma). */
@Module({
  imports: [MarketplaceTaxModule],
  controllers: [CanaisController],
  providers: [CanaisService],
})
export class CanaisModule {}
