import { Module } from '@nestjs/common'
import { EmailModule } from '../email/email.module'
import { LeadsModule } from '../leads/leads.module'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { WhatsappModule } from '../whatsapp/whatsapp.module'
import { AutomacoesController } from './automacoes.controller'
import { AutomacoesService } from './automacoes.service'

/** Fase 6: fluxos de automação (gatilho, esperas, condições e ações) e o motor que executa os passos. */
@Module({
  imports: [LeadsModule, RastreamentoModule, EmailModule, WhatsappModule],
  controllers: [AutomacoesController],
  providers: [AutomacoesService],
})
export class AutomacoesModule {}
