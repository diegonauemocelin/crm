import { Module } from '@nestjs/common'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { PublicWebPushController, WebPushController } from './webpush.controller'
import { WebPushService } from './webpush.service'

/** Marketing › Web Push: notificações no navegador para quem visita a loja virtual. */
@Module({
  imports: [RastreamentoModule],
  controllers: [PublicWebPushController, WebPushController],
  providers: [WebPushService],
})
export class WebPushModule {}
