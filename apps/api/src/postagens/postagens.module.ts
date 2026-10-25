import { Module } from '@nestjs/common'
import { EmailModule } from '../email/email.module'
import { PostagensController, PublicPostagensController } from './postagens.controller'
import { PostagensService } from './postagens.service'

/** Postagens no Instagram e no Facebook: calendário, biblioteca, IA gratuita, aprovação e publicação agendada. */
@Module({
  imports: [EmailModule],
  controllers: [PublicPostagensController, PostagensController],
  providers: [PostagensService],
})
export class PostagensModule {}
