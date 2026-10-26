import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { CotacaoService } from './cotacao.service'
import { FretesController } from './fretes.controller'
import { ImportacaoService } from './importacao.service'
import { PainelService } from './painel.service'
import { TabelasService } from './tabelas.service'
import { TransportadorasService } from './transportadoras.service'

/** Gestão de fretes: transportadoras, tabelas versionadas, motor de cálculo, importação de planilhas e cotações por filial. */
@Module({
  imports: [FilesModule],
  controllers: [FretesController],
  providers: [PainelService, TransportadorasService, TabelasService, ImportacaoService, CotacaoService],
})
export class FretesModule {}
