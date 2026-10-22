import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { ApiTags } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { ChatService } from './chat.service'
import { WhatsappDashboardService } from './dashboard.service'
import { LABEL_COLORS } from './envio'
import { contentDisposition, INLINE_MIME, MEDIA_MAX_BYTES, mediaFileName } from './mensagens'

class ListDto {
  @IsOptional() @IsUUID() numero?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() naoLidas?: boolean
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() arquivadas?: boolean
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @IsIn(['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO', 'GRUPO']) tipo?: string
  @IsOptional() @IsUUID() lead?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() lembretes?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) pagina?: number
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() monitorar?: boolean
  @IsOptional() @IsUUID() vendedor?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() fila?: boolean
  @IsOptional() @IsUUID() etiqueta?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() aguardando?: boolean
  /** Aba "Aguardando vendedor": pré-venda repassada, sem retorno do vendedor. */
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() aguardandoVendedor?: boolean
}

class TextDto {
  @IsString() @Length(1, 4000) text!: string
  /** Responder (citar) uma mensagem da conversa. */
  @IsOptional() @IsUUID() quotedId?: string
}

class FinishDto {
  @IsBoolean() enviarMensagem!: boolean
}

class FinishManyDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids!: string[]
}

class EditTextDto {
  @IsString() @Length(1, 4000) text!: string
}

class ReactionDto {
  /** Emoji; vazio tira a reação. */
  @IsString() @MaxLength(16) emoji!: string
}

class SaveAsContactDto {
  @IsString() @Length(1, 120) name!: string
  @IsIn(['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO']) category!: 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
}

class HelpersDto {
  @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) userIds!: string[]
}

class ForwardTargetDto {
  @IsOptional() @IsUUID() conversationId?: string
  @IsOptional() @IsString() @Length(8, 30) phone?: string
  @IsOptional() @IsString() @MaxLength(120) label?: string
}

class ForwardDto {
  @ValidateNested({ each: true }) @Type(() => ForwardTargetDto) @ArrayMaxSize(10) targets!: ForwardTargetDto[]
}

class ForwardManyDto extends ForwardDto {
  @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) messageIds!: string[]
}

class ContactDto {
  @IsString() @Length(1, 80) name!: string
  @IsString() @Length(8, 30) phone!: string
}

class ShareSearchDto {
  @IsOptional() @IsString() @MaxLength(80) busca?: string
  /** Agenda do número de WhatsApp (nova conversa). */
  @IsOptional() @IsUUID() numero?: string
}

class CaptionDto {
  @IsOptional() @IsString() @MaxLength(1000) legenda?: string
}

class StartDto {
  @IsUUID() numberId!: string
  @IsOptional() @IsString() @MaxLength(30) phone?: string
  @IsOptional() @IsUUID() leadId?: string
}

class UpdateDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() assignedSellerId?: string | null
  @IsOptional() @IsIn(['ABERTA', 'ARQUIVADA']) status?: 'ABERTA' | 'ARQUIVADA'
}

class AssignDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() userId?: string | null
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) sectorId?: string | null
}

class CategoryDto {
  @IsIn(['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO']) category!: 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
  @IsOptional() @IsBoolean() removeAuto?: boolean
}

class ReminderDto {
  @IsISO8601() dueAt!: string
  @IsOptional() @IsString() @MaxLength(500) note?: string
}

class SnoozeDto {
  @Type(() => Number) @IsInt() @Min(5) @Max(10_080) minutes!: number
}

class QuickReplySendDto {
  @IsOptional() @IsString() @MaxLength(1000) legenda?: string
}

class QuickReplyDto {
  @IsString() @Length(1, 60) title!: string
  @IsString() @Length(1, 2000) text!: string
  /** Padrão da empresa (todos veem); sem marcar, é pessoal. */
  @IsOptional() @IsBoolean() standard?: boolean
}

class ToCallQuery {
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) pagina?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) dias?: number
  /** Período (AAAA-MM-DD, horário de Brasília): de e até (inclusive). */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) de?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) ate?: string
}

class LabelDto {
  @IsString() @Length(1, 30) name!: string
  @IsIn([...LABEL_COLORS]) color!: string
  @IsOptional() @IsBoolean() standard?: boolean
}

class ConversationLabelsDto {
  @IsUUID(undefined, { each: true }) @ArrayMaxSize(50) labelIds!: string[]
}

class ThreadDto {
  @IsOptional() @IsISO8601() antes?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() monitorar?: boolean
}

class MediaQuery {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() monitorar?: boolean
}

class RulesDto {
  @IsIn(['LEAD_E_PREVENDA', 'SO_LEAD', 'NADA']) newContact!: 'LEAD_E_PREVENDA' | 'SO_LEAD' | 'NADA'
  @IsIn(['HISTORICO_E_PREVENDA', 'SO_HISTORICO']) knownLead!: 'HISTORICO_E_PREVENDA' | 'SO_HISTORICO'
  @Type(() => Number) @IsInt() @Min(1) @Max(90) reopenDays!: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) yellowMinutes?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(2880) redMinutes?: number
  /** Horário comercial e mensagem de ausência: conferidos campo a campo em cleanRules. */
  @IsOptional() @IsObject() businessHours?: { enabled?: boolean; days?: ({ start: string; end: string } | null)[] }
  @IsOptional() @IsObject() away?: { enabled?: boolean; text?: string; cooldownHours?: number }
}

/** Agenda de contatos: id de um número (uuid) ou vazio (geral). */
const AGENDA = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/

class CompanyContactDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string
  @IsString() @Length(8, 30) phone!: string
  @IsIn(['COLEGA', 'FORNECEDOR', 'OUTRO']) category!: 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
  @IsOptional() @Matches(AGENDA) agenda?: string
}

class ImportDto {
  @IsString() @Length(1, 900_000) csv!: string
  @IsIn(['COLEGA', 'FORNECEDOR', 'OUTRO']) category!: 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
  @IsOptional() @Matches(AGENDA) agenda?: string
}

class DashQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) de?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) ate?: string
  @IsOptional() @IsUUID() numero?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() todos?: boolean
}

class ContactsQuery {
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) pagina?: number
  @IsOptional() @IsIn(['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO']) tipo?: 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
  /** Agenda: id do número; vazio = geral (vale para todos os números). */
  @IsOptional() @Matches(AGENDA) agenda?: string
}

class ContactUpdateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string
  @IsOptional() @IsIn(['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO']) category?: 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
  /** Mudar para a agenda de outro número (ou para a geral, com vazio). */
  @IsOptional() @Matches(AGENDA) agenda?: string
}

class ContactsFileDto {
  @IsString() @Length(1, 1_900_000) text!: string
  @IsOptional() @Matches(AGENDA) agenda?: string
}

class ContactRowDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string | null
  @IsString() @Length(8, 30) phone!: string
  @IsIn(['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO']) category!: 'CLIENTE' | 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
}

class ContactsSaveDto {
  @ValidateNested({ each: true }) @Type(() => ContactRowDto) @ArrayMaxSize(5000) rows!: ContactRowDto[]
  @IsOptional() @Matches(AGENDA) agenda?: string
}

/** Regras do WhatsApp e contatos da empresa (administrador: permissão "Números de WhatsApp"). */
@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsappRulesController {
  constructor(
    private readonly chat: ChatService,
    private readonly dash: WhatsappDashboardService,
  ) {}

  /** Dashboard de atendimento (respeita o escopo da permissão "Chat WhatsApp"). */
  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser, @Query() q: DashQuery) {
    return this.dash.dashboard(user, { from: q.de, to: q.ate, numberId: q.numero, all: q.todos })
  }

  @Get('regras')
  rules(@CurrentUser() user: AuthUser) {
    return this.chat.getRules(user)
  }

  @Put('regras')
  saveRules(@CurrentUser() user: AuthUser, @Body() dto: RulesDto) {
    return this.chat.saveRules(user, dto)
  }

  @Get('contatos')
  contacts(@CurrentUser() user: AuthUser, @Query() q: ContactsQuery) {
    return this.chat.companyContacts(user, { search: q.busca, page: q.pagina, category: q.tipo, scope: q.agenda })
  }

  @Patch('contatos/:id')
  updateContact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContactUpdateDto) {
    return this.chat.updateCompanyContact(user, id, { name: dto.name, category: dto.category, scope: dto.agenda })
  }

  /** Prévia da importação de um arquivo do celular (.vcf) ou CSV: nada é gravado. */
  @Post('contatos/previa')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  previewFile(@CurrentUser() user: AuthUser, @Body() dto: ContactsFileDto) {
    return this.chat.previewContactsFile(user, dto.text, dto.agenda)
  }

  /** Prévia dos contatos do WhatsApp conectado no número. */
  @Post('contatos/previa-whatsapp/:numero')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  previewWhatsapp(@CurrentUser() user: AuthUser, @Param('numero', ParseUUIDPipe) numero: string) {
    return this.chat.previewContactsWhatsapp(user, numero)
  }

  /** Grava os contatos escolhidos na prévia, cada um com o tipo escolhido. */
  @Post('contatos/salvar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  saveContacts(@CurrentUser() user: AuthUser, @Body() dto: ContactsSaveDto) {
    return this.chat.saveContacts(user, dto.rows, dto.agenda)
  }

  @Post('contatos')
  addContact(@CurrentUser() user: AuthUser, @Body() dto: CompanyContactDto) {
    return this.chat.addCompanyContact(user, { name: dto.name, phone: dto.phone, category: dto.category, scope: dto.agenda })
  }

  @Post('contatos/importar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  importContacts(@CurrentUser() user: AuthUser, @Body() dto: ImportDto) {
    return this.chat.importCompanyContacts(user, dto.csv, dto.category, dto.agenda)
  }

  @Delete('contatos/:id')
  removeContact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.removeCompanyContact(user, id)
  }
}

/** Chat WhatsApp: conversas visíveis para o usuário (permissão "Chat WhatsApp", com escopo). */
@ApiTags('WhatsApp')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Finalizar atendimento: mensagem de encerramento (opcional), sai do atendente e da fila, arquiva. */
  @Post('conversas/:id/finalizar')
  @HttpCode(200)
  finish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FinishDto, @ReqContext() ctx: RequestCtx) {
    return this.chat.finish(user, id, dto.enviarMensagem, ctx)
  }

  /** Finalizar vários atendimentos de uma vez, sem mensagem de encerramento. */
  @Post('conversas/finalizar-varias')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  finishMany(@CurrentUser() user: AuthUser, @Body() dto: FinishManyDto, @ReqContext() ctx: RequestCtx) {
    return this.chat.finishMany(user, dto.ids, ctx)
  }

  /** Não precisa responder: o cliente só se despediu; a conversa sai dos avisos de "cliente esperando". */
  @Post('conversas/:id/sem-resposta')
  @HttpCode(200)
  noReply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.chat.noReply(user, id, ctx)
  }

  /** O que a pessoa pode monitorar: TODOS (permissão de monitoramento), EQUIPE (é gestora) ou nada. */
  @Get('monitoramento')
  monitorAccess(@CurrentUser() user: AuthUser) {
    return this.chat.monitorAccess(user)
  }

  @Get('conversas')
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    return this.chat.conversations(user, { numberId: q.numero, unread: q.naoLidas, archived: q.arquivadas, search: q.busca, page: q.pagina, category: q.tipo, leadId: q.lead, reminders: q.lembretes, monitor: q.monitorar, sellerId: q.vendedor, awaiting: q.aguardando, queue: q.fila, labelId: q.etiqueta, waitingSeller: q.aguardandoVendedor })
  }

  /** Números em que o usuário pode iniciar conversa. */
  @Get('numeros')
  startOptions(@CurrentUser() user: AuthUser) {
    return this.chat.startOptions(user)
  }

  @Post('conversas')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  start(@CurrentUser() user: AuthUser, @Body() dto: StartDto) {
    return this.chat.start(user, dto)
  }

  @Patch('conversas/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDto) {
    return this.chat.update(user, id, dto)
  }

  @Put('conversas/:id/tipo')
  setCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto) {
    return this.chat.setCategory(user, id, dto)
  }

  /** Encaminhar uma mensagem para outras conversas ou telefones da agenda (até 10). */
  @Post('mensagens/:id/encaminhar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  forward(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ForwardDto) {
    return this.chat.forward(user, [id], dto.targets.filter((t) => t.conversationId || t.phone))
  }

  /** Encaminhar várias mensagens de uma vez (até 20), na ordem em que foram escritas. */
  @Post('mensagens/encaminhar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  forwardMany(@CurrentUser() user: AuthUser, @Body() dto: ForwardManyDto) {
    return this.chat.forward(user, dto.messageIds, dto.targets.filter((t) => t.conversationId || t.phone))
  }

  /** Compartilhar um contato (cartão) na conversa. */
  @Post('conversas/:id/contato')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sendContact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContactDto) {
    return this.chat.sendContact(user, id, dto)
  }

  /** Sugestões de contatos para compartilhar (vendedores, agenda e leads). */
  @Get('contatos-para-compartilhar')
  shareOptions(@CurrentUser() user: AuthUser, @Query() q: ShareSearchDto) {
    return this.chat.shareOptions(user, q.busca ?? '', q.numero)
  }

  /** Transcrever um áudio da conversa (Gemini, com a chave do e-mail marketing). */
  @Post('mensagens/:id/transcrever')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  transcribe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('monitorar') monitorar?: string) {
    return this.chat.transcribe(user, id, monitorar === 'true')
  }

  /** Corrigir o texto de uma mensagem enviada (até 15 minutos depois, limite do WhatsApp). */
  @Patch('mensagens/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  editMessage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditTextDto, @ReqContext() ctx: RequestCtx) {
    return this.chat.editMessage(user, id, dto.text, ctx)
  }

  /** Apagar para todos uma mensagem enviada (até 2 dias depois, limite do WhatsApp). */
  @Delete('mensagens/:id')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  deleteMessage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() ctx: RequestCtx) {
    return this.chat.deleteMessage(user, id, ctx)
  }

  /** Reagir a uma mensagem (emoji; vazio tira). */
  @Post('mensagens/:id/reacao')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  react(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReactionDto) {
    return this.chat.react(user, id, dto.emoji)
  }

  @Post('conversas/:id/mensagens')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  sendText(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TextDto) {
    return this.chat.sendText(user, id, dto.text, dto.quotedId)
  }

  @Post('conversas/:id/arquivos')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_BYTES, files: 1 } }))
  sendFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() dto: CaptionDto) {
    return this.chat.sendFile(user, id, file, dto.legenda)
  }

  /** Figurinhas salvas pela pessoa (cada atendente tem as suas). */
  @Get('figurinhas')
  stickers(@CurrentUser() user: AuthUser) {
    return this.chat.stickers(user)
  }

  @Get('figurinhas/:id/imagem')
  async stickerImage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const s = await this.chat.stickerImage(user, id)
    res.setHeader('Content-Type', s.mime)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(s.content)
  }

  /** Figurinha nova a partir de uma imagem do computador (PNG, JPG, WEBP ou GIF, até 1 MB). */
  @Post('figurinhas')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }))
  addSticker(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.chat.addSticker(user, file)
  }

  @Delete('figurinhas/:id')
  removeSticker(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.removeSticker(user, id)
  }

  /** Salva nas figurinhas da pessoa uma figurinha da conversa. */
  @Post('mensagens/:id/salvar-figurinha')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  saveSticker(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.saveSticker(user, id)
  }

  @Post('conversas/:id/figurinhas/:figurinha')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sendSticker(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('figurinha', ParseUUIDPipe) figurinha: string) {
    return this.chat.sendSticker(user, id, figurinha)
  }

  /** Mensagem de voz gravada no navegador (vai como áudio de voz do WhatsApp). */
  @Post('conversas/:id/audio')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_BYTES, files: 1 } }))
  sendVoice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.chat.sendFile(user, id, file, undefined, true)
  }

  /** Alertas para todas as telas: não lidas e lembretes vencidos (consultado a cada poucos segundos). */
  @Get('alertas')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  alerts(@CurrentUser() user: AuthUser) {
    return this.chat.alerts(user)
  }

  @Get('conversas/:id/lembretes')
  reminders(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.reminders(user, id)
  }

  @Post('conversas/:id/lembretes')
  createReminder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReminderDto) {
    return this.chat.createReminder(user, id, dto)
  }

  @Post('lembretes/:id/concluir')
  @HttpCode(200)
  completeReminder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.completeReminder(user, id)
  }

  @Post('lembretes/:id/adiar')
  @HttpCode(200)
  snoozeReminder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SnoozeDto) {
    return this.chat.snoozeReminder(user, id, dto.minutes)
  }

  @Post('lembretes/:id/avisado')
  @HttpCode(200)
  notified(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.markReminderNotified(user, id)
  }

  @Delete('lembretes/:id')
  removeReminder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.removeReminder(user, id)
  }

  @Get('respostas')
  quickReplies(@CurrentUser() user: AuthUser, @Query('conversa') conversa?: string) {
    return this.chat.quickReplies(user, conversa && /^[0-9a-f-]{36}$/.test(conversa) ? conversa : undefined)
  }

  @Post('respostas')
  createQuickReply(@CurrentUser() user: AuthUser, @Body() dto: QuickReplyDto) {
    return this.chat.saveQuickReply(user, null, dto)
  }

  @Put('respostas/:id')
  updateQuickReply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuickReplyDto) {
    return this.chat.saveQuickReply(user, id, dto)
  }

  @Delete('respostas/:id')
  removeQuickReply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.removeQuickReply(user, id)
  }

  /** Arquivo da resposta rápida (catálogo em PDF, tabela, foto). */
  @Post('respostas/:id/arquivo')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_BYTES, files: 1 } }))
  setQuickReplyFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.chat.setQuickReplyFile(user, id, file)
  }

  @Delete('respostas/:id/arquivo')
  removeQuickReplyFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.removeQuickReplyFile(user, id)
  }

  /** Manda na conversa o arquivo de uma resposta rápida, com a legenda. */
  @Post('conversas/:id/respostas/:replyId/enviar')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sendQuickReplyFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('replyId', ParseUUIDPipe) replyId: string, @Body() dto: QuickReplySendDto) {
    return this.chat.sendQuickReplyFile(user, id, replyId, dto.legenda)
  }

  /** Leads com telefone que converteram e ainda não tiveram conversa no WhatsApp. */
  @Get('para-chamar')
  toCall(@CurrentUser() user: AuthUser, @Query() q: ToCallQuery) {
    return this.chat.toCall(user, { search: q.busca, page: q.pagina, days: q.dias, from: q.de, to: q.ate })
  }

  @Get('etiquetas')
  labels(@CurrentUser() user: AuthUser) {
    return this.chat.labels(user)
  }

  @Post('etiquetas')
  createLabel(@CurrentUser() user: AuthUser, @Body() dto: LabelDto) {
    return this.chat.saveLabel(user, null, dto)
  }

  @Put('etiquetas/:id')
  updateLabel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LabelDto) {
    return this.chat.saveLabel(user, id, dto)
  }

  @Delete('etiquetas/:id')
  removeLabel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.removeLabel(user, id)
  }

  /** Etiquetas da conversa (as que este usuário vê). */
  @Put('conversas/:id/etiquetas')
  setLabels(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConversationLabelsDto) {
    return this.chat.setConversationLabels(user, id, dto.labelIds)
  }

  /** Atendimento dividido: assumir (userId = eu) ou transferir para atendente ou fila de setor. */
  @Post('conversas/:id/atendente')
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @ReqContext() ctx: RequestCtx) {
    return this.chat.assign(user, id, dto, ctx)
  }

  /** Salvar o número da conversa como contato na agenda do número de WhatsApp. */
  @Post('conversas/:id/salvar-contato')
  @HttpCode(200)
  saveAsContact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAsContactDto) {
    return this.chat.saveAsContact(user, id, dto)
  }

  /** Participantes: outros atendentes do mesmo número que também atendem a conversa (lista completa). */
  @Post('conversas/:id/participantes')
  @HttpCode(200)
  setHelpers(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HelpersDto, @ReqContext() ctx: RequestCtx) {
    return this.chat.setHelpers(user, id, dto.userIds, ctx)
  }

  /** Nota interna: só no CRM, o cliente não recebe. */
  @Post('conversas/:id/notas')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  addNote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TextDto, @ReqContext() ctx: RequestCtx) {
    return this.chat.addNote(user, id, dto.text, ctx)
  }

  @Get('conversas/:id')
  thread(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ThreadDto, @ReqContext() ctx: RequestCtx) {
    return this.chat.conversation(user, id, q.antes, q.monitorar ? { ctx } : undefined)
  }

  /** Mídia: imagens, áudios, vídeos e PDF abrem na tela; o resto vai como download (nunca é executado no navegador). */
  @Get('midias/:id')
  async media(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MediaQuery, @Res() res: Response) {
    const m = await this.chat.media(user, id, !!q.monitorar)
    const inline = INLINE_MIME.has(m.mime)
    res.setHeader('Content-Type', inline ? m.mime : 'application/octet-stream')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Content-Disposition', contentDisposition(mediaFileName(m.fileName, m.mime, m.sentAt), inline))
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(m.content)
  }
}
