import { Module } from '@nestjs/common'
import { CapturaModule } from '../captura/captura.module'
import { EmailModule } from '../email/email.module'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { LandingController, PublicLandingController } from './landing.controller'
import { LandingService } from './landing.service'

/** Landing pages: editor em blocos com modelos e IA, publicação no subdomínio, medição (GA4, Google Ads, Meta) e teste A/B. */
@Module({
  imports: [CapturaModule, EmailModule, RastreamentoModule],
  controllers: [PublicLandingController, LandingController],
  providers: [LandingService],
})
export class LandingModule {}
