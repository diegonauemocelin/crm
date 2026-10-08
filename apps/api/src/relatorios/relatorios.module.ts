import { Module } from '@nestjs/common'
import { RelatoriosController } from './relatorios.controller'
import { RelatoriosService } from './relatorios.service'

/** Fase 7: visão geral de marketing, Google Analytics 4, criador de relatórios e painel com os relatórios fixados. */
@Module({
  controllers: [RelatoriosController],
  providers: [RelatoriosService],
})
export class RelatoriosModule {}
