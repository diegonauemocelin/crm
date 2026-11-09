import { Module } from '@nestjs/common'
import { TcarController, TcarWebhookController } from './tcar.controller'
import { TcarService } from './tcar.service'

/** Tcar (ERP): PingAlive, consulta de produtos, fotos e orçamento/pré-nota para a cotação de frete. */
@Module({
  controllers: [TcarWebhookController, TcarController],
  providers: [TcarService],
  exports: [TcarService],
})
export class TcarModule {}
