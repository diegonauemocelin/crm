import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { ApiTags } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser, ReqContext, type RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { ChatService } from './chat.service'
import { WhatsappDashboardService } from './dashboard.service'
import { INLINE_MIME, MEDIA_MAX_BYTES } from './mensagens'

class ListDto {
  @IsOptional() @IsUUID() numero?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() naoLidas?: boolean
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() arquivadas?: boolean
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @IsIn(['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO']) tipo?: string
  @IsOptional() @IsUUID() lead?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() lembretes?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) pagina?: number
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() monitorar?: boolean
  @IsOptional() @IsUUID() vendedor?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() fila?: boolean
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() aguardando?: boolean
}

class TextDto {
  @IsString() @Length(1, 4000) text!: string
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

class QuickReplyDto {
  @IsString() @Length(1, 60) title!: string
  @IsString() @Length(1, 2000) text!: string
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
}

class CompanyContactDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string
  @IsString() @Length(8, 30) phone!: string
  @IsIn(['COLEGA', 'FORNECEDOR', 'OUTRO']) category!: 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
}

class ImportDto {
  @IsString() @Length(1, 900_000) csv!: string
  @IsIn(['COLEGA', 'FORNECEDOR', 'OUTRO']) category!: 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
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
    return this.chat.companyContacts(user, { search: q.busca, page: q.pagina })
  }

  @Post('contatos')
  addContact(@CurrentUser() user: AuthUser, @Body() dto: CompanyContactDto) {
    return this.chat.addCompanyContact(user, dto)
  }

  @Post('contatos/importar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  importContacts(@CurrentUser() user: AuthUser, @Body() dto: ImportDto) {
    return this.chat.importCompanyContacts(user, dto.csv, dto.category)
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

  @Get('conversas')
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    return this.chat.conversations(user, { numberId: q.numero, unread: q.naoLidas, archived: q.arquivadas, search: q.busca, page: q.pagina, category: q.tipo, leadId: q.lead, reminders: q.lembretes, monitor: q.monitorar, sellerId: q.vendedor, awaiting: q.aguardando, queue: q.fila })
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

  @Post('conversas/:id/mensagens')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  sendText(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TextDto) {
    return this.chat.sendText(user, id, dto.text)
  }

  @Post('conversas/:id/arquivos')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_BYTES, files: 1 } }))
  sendFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() dto: CaptionDto) {
    return this.chat.sendFile(user, id, file, dto.legenda)
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

  /** Atendimento dividido: assumir (userId = eu) ou transferir para atendente ou fila de setor. */
  @Post('conversas/:id/atendente')
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @ReqContext() ctx: RequestCtx) {
    return this.chat.assign(user, id, dto, ctx)
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
    const name = (m.fileName ?? 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(m.content)
  }
}
