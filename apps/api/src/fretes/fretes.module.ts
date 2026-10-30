import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { CotacaoService } from './cotacao.service'
import { FretesController } from './fretes.controller'
import { ImportacaoService } from './importacao.service'
import { PainelService } from './painel.service'
import { TabelasService } from './tabelas.service'
import { TransportadorasService } from './transportadoras.service'
import { CteService } from './cte.service'
import { FaturasService } from './faturas.service'
import { FretesOperacaoController } from './operacao.controller'
import { PedidosService } from './pedidos.service'
import { FretesRelatoriosService } from './relatorios.service'

/** Gestão de fretes: transportadoras, tabelas versionadas, motor de cálculo, importação de planilhas e cotações por filial. */
@Module({
  imports: [FilesModule],
  controllers: [FretesController, FretesOperacaoController],
  providers: [PainelService, TransportadorasService, TabelasService, ImportacaoService, CotacaoService, PedidosService, CteService, FaturasService, FretesRelatoriosService],
})
export class FretesModule {}
