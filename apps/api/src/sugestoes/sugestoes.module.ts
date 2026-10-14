import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { SugestoesController } from './sugestoes.controller'
import { SugestoesService } from './sugestoes.service'

/** Sugestões de melhoria dos usuários, com análise e resposta do administrador. */
@Module({
  imports: [FilesModule],
  controllers: [SugestoesController],
  providers: [SugestoesService],
})
export class SugestoesModule {}
