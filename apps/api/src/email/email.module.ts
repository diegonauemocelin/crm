import { Module } from '@nestjs/common'
import { LeadsModule } from '../leads/leads.module'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { EmailController, EmailTrackingController } from './email.controller'
import { EmailService } from './email.service'

/** Fase 5: e-mail marketing (segmentos, campanhas em blocos, envio pelo SMTP, aberturas e cliques). */
@Module({
  imports: [LeadsModule, RastreamentoModule],
  controllers: [EmailController, EmailTrackingController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
