import { Module } from '@nestjs/common'
import { LeadsModule } from '../leads/leads.module'
import { RastreamentoModule } from '../rastreamento/rastreamento.module'
import { CapturaAdminService } from './captura-admin.service'
import { CapturaController, PublicCapturaController } from './captura.controller'
import { CapturaService } from './captura.service'

/** Fase 4: formulários, pop-ups e botão de WhatsApp no site (e, na 0.5.1, landing pages). */
@Module({
  imports: [LeadsModule, RastreamentoModule],
  controllers: [PublicCapturaController, CapturaController],
  providers: [CapturaService, CapturaAdminService],
  exports: [CapturaService],
})
export class CapturaModule {}
