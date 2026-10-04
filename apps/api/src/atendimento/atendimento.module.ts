import { Module } from '@nestjs/common'
import { LeadsModule } from '../leads/leads.module'
import { AtendimentoController, CadastrosController } from './atendimento.controller'
import { CadastrosService } from './cadastros.service'
import { ImportService } from './import.service'
import { ServiceRecordsService } from './service-records.service'

@Module({
  imports: [LeadsModule],
  controllers: [AtendimentoController, CadastrosController],
  providers: [ServiceRecordsService, CadastrosService, ImportService],
})
export class AtendimentoModule {}
