import { Module } from '@nestjs/common'
import { AtendimentoController, CadastrosController } from './atendimento.controller'
import { CadastrosService } from './cadastros.service'
import { ImportService } from './import.service'
import { ServiceRecordsService } from './service-records.service'

@Module({
  controllers: [AtendimentoController, CadastrosController],
  providers: [ServiceRecordsService, CadastrosService, ImportService],
})
export class AtendimentoModule {}
