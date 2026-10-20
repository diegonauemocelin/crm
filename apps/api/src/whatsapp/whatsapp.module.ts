import { Module } from '@nestjs/common'
import { CapturaModule } from '../captura/captura.module'
import { EmailModule } from '../email/email.module'
import { LeadsModule } from '../leads/leads.module'
import { ChatController, WhatsappRulesController } from './chat.controller'
import { ChatService } from './chat.service'
import { WhatsappDashboardService } from './dashboard.service'
import { DiaSeguinteService } from './dia-seguinte.service'
import { ResumoVendedoresService } from './resumo-vendedores.service'
import { SetoresController, WhatsappController, WhatsappWebhookController } from './whatsapp.controller'
import { SetoresService } from './setores.service'
import { WhatsappService } from './whatsapp.service'

/** Fase 9: números de WhatsApp da empresa pela Evolution API (conexão por QR Code, limites de números e de conexões). */
@Module({
  imports: [LeadsModule, CapturaModule, EmailModule],
  controllers: [WhatsappController, WhatsappWebhookController, SetoresController, ChatController, WhatsappRulesController],
  providers: [WhatsappService, ChatService, WhatsappDashboardService, DiaSeguinteService, ResumoVendedoresService, SetoresService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
