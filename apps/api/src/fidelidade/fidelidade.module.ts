import { Module } from '@nestjs/common'
import { WhatsappModule } from '../whatsapp/whatsapp.module'
import { FidelidadeController, FidelidadePublicoController } from './fidelidade.controller'
import { FidelidadeService } from './fidelidade.service'
import { FidelidadeJobsService } from './jobs.service'
import { FidelidadePublicoService } from './publico.service'

/** Marketing › Fidelidade: pontos, níveis, prêmios, resgates, avaliação depois da compra e a página do cliente. */
@Module({
  imports: [WhatsappModule],
  controllers: [FidelidadeController, FidelidadePublicoController],
  providers: [FidelidadeService, FidelidadePublicoService, FidelidadeJobsService],
})
export class FidelidadeModule {}
