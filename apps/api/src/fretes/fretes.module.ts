import { FretesSefazController } from './sefaz.controller'
import { SefazService } from './sefaz.service'
import { IntegracoesService } from './integracoes.service'
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
import { TcarModule } from '../tcar/tcar.module'
import { NfeService } from './nfe.service'

/** Gestão de fretes: transportadoras, tabelas versionadas, motor de cálculo, importação de planilhas e cotações por filial. */
@Module({
  imports: [FilesModule, TcarModule],
  controllers: [FretesController, FretesOperacaoController, FretesSefazController],
  providers: [PainelService, TransportadorasService, TabelasService, ImportacaoService, CotacaoService, PedidosService, CteService, FaturasService, FretesRelatoriosService, SefazService, IntegracoesService, NfeService],
  exports: [IntegracoesService],
})
export class FretesModule {}
