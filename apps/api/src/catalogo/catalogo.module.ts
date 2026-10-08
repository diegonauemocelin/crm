import { Module } from '@nestjs/common'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { CatalogoController } from './catalogo.controller'
import { CatalogoService } from './catalogo.service'

/** Catálogo de produtos da loja virtual (copiado da Magazord), com o interesse dos clientes pelos carrinhos. */
@Module({
  imports: [RastreamentoModule],
  controllers: [CatalogoController],
  providers: [CatalogoService],
})
export class CatalogoModule {}
