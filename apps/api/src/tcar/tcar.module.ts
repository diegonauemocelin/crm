import { Module } from '@nestjs/common'
import { TcarController, TcarWebhookController } from './tcar.controller'
import { TcarService } from './tcar.service'

/** Tcar (ERP): PingAlive e consulta de produtos. */
@Module({
  controllers: [TcarWebhookController, TcarController],
  providers: [TcarService],
})
export class TcarModule {}
