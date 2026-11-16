import { Module } from '@nestjs/common'
import { LeadsModule } from '../leads/leads.module'
import { WhatsappModule } from '../whatsapp/whatsapp.module'
import { ProspeccaoController } from './prospeccao.controller'
import { ProspeccaoService } from './prospeccao.service'

/** Busca de leads (prospecção de empresas com contatos conferidos). */
@Module({
  imports: [LeadsModule, WhatsappModule],
  controllers: [ProspeccaoController],
  providers: [ProspeccaoService],
})
export class ProspeccaoModule {}
