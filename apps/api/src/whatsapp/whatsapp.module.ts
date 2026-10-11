import { Module } from '@nestjs/common'
import { CapturaModule } from '../captura/captura.module'
import { LeadsModule } from '../leads/leads.module'
import { ChatController, WhatsappRulesController } from './chat.controller'
import { ChatService } from './chat.service'
import { WhatsappDashboardService } from './dashboard.service'
import { WhatsappController, WhatsappWebhookController } from './whatsapp.controller'
import { WhatsappService } from './whatsapp.service'

/** Fase 9: números de WhatsApp da empresa pela Evolution API (conexão por QR Code, limites de números e de conexões). */
@Module({
  imports: [LeadsModule, CapturaModule],
  controllers: [WhatsappController, WhatsappWebhookController, ChatController, WhatsappRulesController],
  providers: [WhatsappService, ChatService, WhatsappDashboardService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
