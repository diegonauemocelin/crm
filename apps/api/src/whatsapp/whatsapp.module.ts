import { Module } from '@nestjs/common'
import { WhatsappController, WhatsappWebhookController } from './whatsapp.controller'
import { WhatsappService } from './whatsapp.service'

/** Fase 9: números de WhatsApp da empresa pela Evolution API (conexão por QR Code, limites de números e de conexões). */
@Module({
  controllers: [WhatsappController, WhatsappWebhookController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
