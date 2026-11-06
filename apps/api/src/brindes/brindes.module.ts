import { Module } from '@nestjs/common'
import { BrindesController } from './brindes.controller'
import { BrindesService } from './brindes.service'

/** Marketing › Controle de brindes. */
@Module({ controllers: [BrindesController], providers: [BrindesService] })
export class BrindesModule {}
