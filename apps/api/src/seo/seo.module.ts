import { Module } from '@nestjs/common'
import { EmailModule } from '../email/email.module'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { SeoController } from './seo.controller'
import { SeoService } from './seo.service'

/** SEO do e-commerce (produtos da Magazord): nota, sugestões da IA gratuita, revisão, envio e desfazer. */
@Module({
  imports: [EmailModule, RastreamentoModule],
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
