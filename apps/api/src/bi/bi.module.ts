import { Module } from '@nestjs/common'
import { BiDataController, BiKeysController } from './bi.controller'
import { BiService } from './bi.service'

/** Power BI: API de BI (/api/bi/v1, chave no X-BI-Key) e as chaves em Configurações › Power BI. */
@Module({ controllers: [BiDataController, BiKeysController], providers: [BiService] })
export class BiModule {}
