import { Module } from '@nestjs/common'
import { WhatsappModule } from '../whatsapp/whatsapp.module'
import { AnalisesController } from './analises.controller'
import { AnalisesService } from './analises.service'

/** Análises: BI nativo do CRM (páginas com filtros, drill-down e "ver registros"), com as permissões do CRM. */
@Module({ imports: [WhatsappModule], controllers: [AnalisesController], providers: [AnalisesService] })
export class AnalisesModule {}
