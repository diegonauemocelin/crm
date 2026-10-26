import { Global, Module } from '@nestjs/common'
import { AppMovelController } from './app-movel.controller'
import { PushService } from './push.service'

/** App no celular: manifesto, ícone e notificações (o chat chama o PushService quando chega mensagem). */
@Global()
@Module({
  controllers: [AppMovelController],
  providers: [PushService],
  exports: [PushService],
})
export class AppMovelModule {}
