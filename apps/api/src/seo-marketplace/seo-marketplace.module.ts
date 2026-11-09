import { Module } from '@nestjs/common'
import { EmailModule } from '../email/email.module'
import { MarketplacesModule } from '../marketplaces/marketplaces.module'
import { SeoMarketplaceController } from './seo-marketplace.controller'
import { SeoMarketplaceService } from './seo-marketplace.service'

/** SEO Marketplace (anúncios do Mercado Livre): nota, sugestões da IA gratuita, revisão, envio e desfazer. */
@Module({
  imports: [EmailModule, MarketplacesModule],
  controllers: [SeoMarketplaceController],
  providers: [SeoMarketplaceService],
})
export class SeoMarketplaceModule {}
