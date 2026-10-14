import { Module } from '@nestjs/common'
import { LeadsModule } from '../leads/leads.module'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { CatalogoController } from './catalogo.controller'
import { CatalogoService } from './catalogo.service'
import { ProdutosVistosService } from './vistos.service'

/** Catálogo de produtos da loja virtual (copiado da Magazord), com o interesse dos clientes pelos carrinhos. */
@Module({
  imports: [RastreamentoModule, LeadsModule],
  controllers: [CatalogoController],
  providers: [CatalogoService, ProdutosVistosService],
})
export class CatalogoModule {}
