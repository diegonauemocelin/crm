import { Module } from '@nestjs/common'
import { MarketplacesModule } from '../marketplaces/marketplaces.module'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { AssistService } from './assist.service'
import { AssistMlService } from './assist-ml.service'
import { AssistenteController, MercadoLivreWebhookController } from './assistente.controller'
import { AssistKnowledgeService } from './conhecimento.service'
import { AssistQueriesService } from './consultas.service'
import { AssistImportService } from './importacao.service'
import { AssistIntegrationService } from './integracao.service'
import { AssistPipelineService } from './pipeline.service'
import { AssistSalesService } from './vendas.service'

/**
 * Assistente das perguntas do Mercado Livre (veio do painel.usaparts.com.br): perguntas, respostas com IA ou regras,
 * frete pela Magazord, base de conhecimento, aplicações peça × máquina, anúncios da loja e vendas ligadas às perguntas.
 */
@Module({
  imports: [MarketplacesModule, RastreamentoModule],
  controllers: [AssistenteController, MercadoLivreWebhookController],
  providers: [AssistService, AssistMlService, AssistKnowledgeService, AssistPipelineService, AssistSalesService, AssistImportService, AssistQueriesService, AssistIntegrationService],
})
export class AssistenteModule {}
