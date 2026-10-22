import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import type { Response } from 'express'
import { AuditService } from '../audit/audit.service'
import { CurrentUser, Public, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { type Actor, AssistService } from './assist.service'
import { AssistKnowledgeService } from './conhecimento.service'
import { AI_DEFAULTS, type AiSettings, CLAUDE_MODELS, EFFORTS, FINAL_STATUSES, GEMINI_MODELS, KNOWLEDGE_CATEGORIES, KNOWLEDGE_STATUSES, PROVIDERS, QUESTION_STATUSES, REASONS, VALIDATION } from './constantes'
import { AssistQueriesService } from './consultas.service'
import { forbiddenContent } from './frete'
import { buildSystemPrompt, testClaudeKey, testGeminiKey } from './ia'
import { AssistImportService } from './importacao.service'
import { AssistIntegrationService } from './integracao.service'
import { AssistPipelineService } from './pipeline.service'
import { str } from './texto'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const actor = (u: AuthUser): Actor => ({ id: u.id, name: u.name })

class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(200) pageSize = 25
  @IsOptional() @IsString() @MaxLength(200) q?: string
  @IsOptional() @Matches(DATE) from?: string
  @IsOptional() @Matches(DATE) to?: string
}

class QuestionsDto extends PageDto {
  @IsOptional() @IsIn(['todas', 'respondidas', 'aguardando', 'encaminhadas', 'revisao', 'erro', 'com_venda', 'desistiu_checkout']) view?: string
}

class PendingDto extends PageDto {
  @IsOptional() @IsIn(QUESTION_STATUSES) status?: string
  @IsOptional() @IsIn(Object.keys(REASONS)) reason?: string
  @IsOptional() @IsString() @MaxLength(100) brand?: string
  @IsOptional() @IsString() @MaxLength(100) model?: string
  @IsOptional() @IsString() @MaxLength(100) code?: string
  @IsOptional() @IsString() @MaxLength(200) product?: string
  @IsOptional() @Matches(/^(none|[0-9a-f-]{36})$/) assigned?: string
  @IsOptional() @IsIn(['alta', 'media', 'baixa']) priority?: string
}

class AnswersDto extends PageDto {
  @IsOptional() @IsIn(['enviada', 'falha', 'pendente', 'preparada']) status?: string
  @IsOptional() @IsIn(['ia', 'atendente']) origin?: string
  @IsOptional() @IsIn(['sim', 'nao']) reviewed?: string
  @IsOptional() @IsIn(['sim']) flagged?: string
  @IsOptional() @IsString() @MaxLength(100) brand?: string
  @IsOptional() @IsString() @MaxLength(100) model?: string
  @IsOptional() @IsString() @MaxLength(200) product?: string
}

class DashboardDto {
  @IsOptional() @Matches(DATE) from?: string
  @IsOptional() @Matches(DATE) to?: string
  @IsOptional() @IsIn(QUESTION_STATUSES) status?: string
  @IsOptional() @IsIn(['ia', 'humano']) type?: string
}

class StatusDto {
  @IsIn(QUESTION_STATUSES) status!: string
  @IsOptional() @IsIn(Object.keys(REASONS)) reason?: string
  @IsOptional() @IsString() @MaxLength(2000) note?: string
}

class AssignDto {
  @IsOptional() @Matches(/^[0-9a-f-]{36}$/) userId?: string | null
  @IsOptional() @IsBoolean() technical?: boolean
}

class RelevanceDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(3) relevance!: number
}

class NoteDto {
  @IsString() @MaxLength(4000) note!: string
}

class AnswerDto {
  @IsString() @MaxLength(2000) text!: string
  @IsOptional() @IsIn(['resposta', 'solicitar_info']) kind?: 'resposta' | 'solicitar_info'
}

class ApproveDto {
  @IsOptional() @IsString() @MaxLength(2000) text?: string
}

class FlagDto {
  @IsBoolean() flagged!: boolean
  @IsOptional() @IsString() @MaxLength(4000) note?: string
}

class LinkKnowledgeDto {
  @Type(() => Number) @IsInt() knowledgeId!: number
}

class KnowledgeListDto extends PageDto {
  @IsOptional() @IsString() @MaxLength(100) category?: string
  @IsOptional() @IsString() @MaxLength(100) brand?: string
  @IsOptional() @IsString() @MaxLength(100) model?: string
  @IsOptional() @IsString() @MaxLength(100) code?: string
  @IsOptional() @IsIn(KNOWLEDGE_STATUSES) status?: string
  @IsOptional() @IsIn(['aprendido', 'cadastrado']) origin?: string
}

class KnowledgeDto {
  @IsOptional() @IsString() @MaxLength(1000) title?: string
  @IsString() @MaxLength(1000) category!: string
  @IsOptional() @IsString() @MaxLength(1000) brand?: string
  @IsOptional() @IsString() @MaxLength(1000) model?: string
  @IsOptional() @IsString() @MaxLength(1000) partCode?: string
  @IsOptional() @IsString() @MaxLength(1000) product?: string
  @IsOptional() @IsString() @MaxLength(1000) application?: string
  @IsOptional() @IsString() @MaxLength(1000) question?: string
  @IsString() @MaxLength(8000) answer!: string
  @IsOptional() @IsString() @MaxLength(1000) source?: string
  @IsOptional() @IsIn(KNOWLEDGE_STATUSES) status?: string
  @IsOptional() @Type(() => Number) @IsInt() originQuestionId?: number
  @IsOptional() @IsBoolean() createApplication?: boolean
}

class KnowledgeStatusDto {
  @IsIn(KNOWLEDGE_STATUSES) status!: string
}

class AppListDto extends PageDto {
  @IsOptional() @IsString() @MaxLength(100) brand?: string
  @IsOptional() @IsString() @MaxLength(100) model?: string
  @IsOptional() @IsString() @MaxLength(100) code?: string
  @IsOptional() @IsString() @MaxLength(100) system?: string
  @IsOptional() @IsIn(VALIDATION) validation?: string
}

class AppDto {
  @IsString() @MaxLength(100) partCode!: string
  @IsOptional() @IsString() @MaxLength(300) productName?: string
  @IsOptional() @IsString() @MaxLength(100) partBrand?: string
  @IsOptional() @IsString() @MaxLength(100) machineBrand?: string
  @IsString() @MaxLength(200) machineModel!: string
  @IsOptional() @IsString() @MaxLength(100) system?: string
  @IsOptional() @IsString() @MaxLength(1000) application?: string
  @IsOptional() @IsString() @MaxLength(500) source?: string
  @IsOptional() @Matches(/^[A-Z]{3}\d{5,15}$/) mlItemId?: string | null
  @IsOptional() @IsIn(VALIDATION) validationStatus?: string
}

class AppUpdateDto {
  @IsOptional() @IsString() @MaxLength(300) productName?: string
  @IsOptional() @IsString() @MaxLength(100) partBrand?: string
  @IsOptional() @IsString() @MaxLength(100) system?: string
  @IsOptional() @IsString() @MaxLength(1000) application?: string
  @IsOptional() @IsString() @MaxLength(500) source?: string
  @IsOptional() @IsString() @MaxLength(20) mlItemId?: string | null
}

class ValidateDto {
  @IsIn(VALIDATION) status!: string
}

class ItemsDto extends PageDto {
  @IsOptional() @IsString() @MaxLength(30) status?: string
}

class ImportRowDto {
  @IsOptional() @IsObject() data?: Record<string, string>
  @IsOptional() @IsIn(['aceitar', 'rejeitar', 'pendente']) decision?: string
}

class DecideAllDto {
  @IsIn(['aceitar', 'rejeitar']) decision!: 'aceitar' | 'rejeitar'
}

class AiSettingsDto {
  @IsString() @MaxLength(80) assistant_name!: string
  @IsString() @MaxLength(80) tone!: string
  @IsIn(['formal', 'semiformal']) formality!: 'formal' | 'semiformal'
  @IsBoolean() greeting_by_time!: boolean
  @Type(() => Number) @IsInt() @Min(200) @Max(1900) max_answer_chars!: number
  @IsBoolean() auto_reply!: boolean
  @Type(() => Number) @IsNumber() @Min(0.5) @Max(0.99) min_confidence!: number
  @IsBoolean() upsell_enabled!: boolean
  @IsString() @MaxLength(2000) upsell_rules!: string
  @Type(() => Number) @IsInt() @Min(0) @Max(3) max_complementary!: number
  @IsString() @MaxLength(2000) request_info_when!: string
  @IsIn(['enviar', 'revisar']) request_info_mode!: 'enviar' | 'revisar'
  @IsString() @MaxLength(2000) forward_when!: string
  @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) @MaxLength(100, { each: true }) allowed_categories!: string[]
  @IsString() @MaxLength(4000) custom_instructions!: string
  @IsIn(Object.keys(PROVIDERS)) provider!: 'claude' | 'gemini' | 'sem_ia'
  @Matches(/^gemini-[a-z0-9.-]{1,60}$/) gemini_model!: string
  @IsBoolean() gemini_fallback!: boolean
  @IsBoolean() auto_learn!: boolean
  @IsIn(['ativo', 'em_revisao']) auto_learn_status!: 'ativo' | 'em_revisao'
  @IsBoolean() auto_learn_from_ai!: boolean
  @IsIn(CLAUDE_MODELS) model!: string
  @IsIn(EFFORTS) effort!: string
  @IsIn(['planilha', 'revisao']) import_status_mode!: 'planilha' | 'revisao'
  @IsBoolean() frete_enabled!: boolean
  @IsString() @MaxLength(300) frete_intro!: string
  @IsString() @MaxLength(500) frete_outro!: string
  @IsBoolean() frete_ask_cep!: boolean
  @IsString() @MaxLength(800) frete_ask_cep_text!: string
}

class KeyDto {
  @IsString() @MaxLength(400) key!: string
}

class TestDto {
  @IsString() @MaxLength(2000) question!: string
  @IsOptional() @Matches(/^[A-Za-z]{3}\d{5,15}$/) itemId?: string
}

class StoreDto {
  @IsString() @MaxLength(500) url!: string
}

class IntegrationDto {
  @IsOptional() @IsBoolean() polling_enabled?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(60) poll_minutes?: number
  @IsOptional() @IsBoolean() sales_enabled?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) sales_window_days?: number
}

class SalesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number
}

class TakeOverDto {
  @IsBoolean() usePainelAccess!: boolean
}

const KEY_FORMAT = { claude: /^sk-ant-\S{20,300}$/, gemini: /^\S{20,300}$/ }

@ApiTags('Assistente do Mercado Livre')
@Controller('assistente')
export class AssistenteController {
  constructor(
    private readonly assist: AssistService,
    private readonly queries: AssistQueriesService,
    private readonly pipeline: AssistPipelineService,
    private readonly knowledge: AssistKnowledgeService,
    private readonly imports: AssistImportService,
    private readonly integration: AssistIntegrationService,
    private readonly audit: AuditService,
  ) {}

  private canDo(user: AuthUser, module: string, action: 'view' | 'create' | 'edit' | 'delete' | 'export') {
    return can(user.permissions, user.role.isSystem, module, action)
  }

  private async question(user: AuthUser, id: number) {
    const q = await this.assist.prisma.assistQuestion.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!q) throw new NotFoundException('Pergunta não encontrada.')
    return q
  }

  private async attempt(user: AuthUser, id: number) {
    const a = await this.assist.prisma.assistAttempt.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!a) throw new NotFoundException('Resposta não encontrada.')
    return a
  }

  // ---------- Painel ----------

  @Get('painel')
  @RequirePermission('assist_atendimento', 'view')
  dashboard(@CurrentUser() user: AuthUser, @Query() q: DashboardDto) {
    return this.queries.dashboard(user.tenantId, q)
  }

  // ---------- Perguntas ----------

  @Get('perguntas')
  @RequirePermission('assist_atendimento', 'view')
  questions(@CurrentUser() user: AuthUser, @Query() q: QuestionsDto) {
    return this.queries.questions(user.tenantId, q)
  }

  @Get('perguntas/pendentes')
  @RequirePermission('assist_atendimento', 'view')
  pending(@CurrentUser() user: AuthUser, @Query() q: PendingDto) {
    return this.queries.pending(user.tenantId, q)
  }

  @Get('perguntas/meta')
  @RequirePermission('assist_atendimento', 'view')
  meta(@CurrentUser() user: AuthUser) {
    return this.queries.meta(user.tenantId)
  }

  @Get('perguntas/:id')
  @RequirePermission('assist_atendimento', 'view')
  questionDetail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.queries.question(user.tenantId, id)
  }

  @Post('perguntas/:id/situacao')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'edit')
  async setStatus(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    if (dto.status === 'respondida') throw new BadRequestException('"Respondida" vem só da confirmação de envio do Mercado Livre.')
    await this.question(user, id)
    await this.assist.setStatus(user.tenantId, id, dto.status, { actor: actor(user), note: str(dto.note, 2000) || null, reason: dto.reason ?? null })
    await this.audit.byUser(user, ctx, 'assistente.pergunta_situacao', 'assist_question', String(id), { status: dto.status, motivo: dto.reason })
    return { ok: true }
  }

  @Post('perguntas/:id/encaminhar')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'edit')
  async assign(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignDto) {
    const q = await this.question(user, id)
    const target = dto.userId ? await this.assist.prisma.user.findFirst({ where: { id: dto.userId, tenantId: user.tenantId, active: true }, select: { id: true, name: true } }) : null
    if (dto.userId && !target) throw new BadRequestException('Responsável inválido.')
    await this.assist.prisma.assistQuestion.update({ where: { id }, data: { assignedToId: target?.id ?? null, assignedToName: target?.name ?? null } })
    await this.assist.addEvent(user.tenantId, id, 'atribuicao', { actor: actor(user), note: target ? `Encaminhada para ${target.name}.` : 'Responsável removido.' })
    if (target && ['nova', 'aguardando_analise'].includes(q.status)) await this.assist.setStatus(user.tenantId, id, dto.technical ? 'aguardando_validacao' : 'em_atendimento', { actor: actor(user) })
    await this.audit.byUser(user, ctx, 'assistente.pergunta_encaminhada', 'assist_question', String(id), { para: target?.name ?? null })
    return { ok: true }
  }

  @Post('perguntas/:id/relevancia')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'edit')
  async relevance(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RelevanceDto) {
    await this.question(user, id)
    await this.assist.prisma.assistQuestion.update({ where: { id }, data: { relevance: dto.relevance } })
    await this.assist.addEvent(user.tenantId, id, 'relevancia', { actor: actor(user), note: `Relevância comercial definida em ${dto.relevance}.` })
    return { ok: true }
  }

  @Post('perguntas/:id/observacoes')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'edit')
  async questionNote(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: NoteDto) {
    await this.question(user, id)
    const note = str(dto.note, 4000)
    if (!note) throw new BadRequestException('Escreva a observação.')
    await this.assist.prisma.assistNote.create({ data: { tenantId: user.tenantId, entity: 'question', entityId: id, userId: user.id, userName: user.name, note } })
    await this.assist.addEvent(user.tenantId, id, 'observacao', { actor: actor(user), note })
    return { ok: true }
  }

  @Post('perguntas/:id/reanalisar')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermission('assist_atendimento', 'edit')
  async reprocess(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number) {
    await this.question(user, id)
    await this.assist.addEvent(user.tenantId, id, 'reanalise_solicitada', { actor: actor(user) })
    await this.audit.byUser(user, ctx, 'assistente.pergunta_reanalisada', 'assist_question', String(id))
    return this.pipeline.process(user.tenantId, id, actor(user))
  }

  @Post('perguntas/:id/responder')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'create')
  async answer(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number, @Body() dto: AnswerDto) {
    const bad = forbiddenContent(dto.text.replace(/\b\d{5}-?\d{3}\b/g, ''))
    if (bad && !/mercadoli(vre|bre)\.com/.test(dto.text)) throw new BadRequestException(`O Mercado Livre não aceita ${bad} nas respostas. Tire do texto.`)
    const r = await this.pipeline.manualAnswer(user.tenantId, id, dto.text, actor(user), { kind: dto.kind })
    await this.audit.byUser(user, ctx, 'assistente.resposta_manual', 'assist_question', String(id), { resposta: r.attemptId, enviada: r.sent })
    return r
  }

  @Get('perguntas/:id/rascunho-pedido-info')
  @RequirePermission('assist_atendimento', 'create')
  async draft(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return { text: await this.pipeline.draftRequestInfo(user.tenantId, id) }
  }

  @Post('perguntas/:id/associar-conhecimento')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'edit')
  async linkKnowledge(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LinkKnowledgeDto) {
    await this.question(user, id)
    const k = await this.assist.prisma.assistKnowledge.findFirst({ where: { id: dto.knowledgeId, tenantId: user.tenantId, deletedAt: null }, select: { id: true, title: true, status: true } })
    if (!k) throw new NotFoundException('Conhecimento não encontrado.')
    await this.assist.addEvent(user.tenantId, id, 'conhecimento_associado', { actor: actor(user), note: `Associado ao conhecimento #${k.id}: ${k.title} (${k.status}).`, data: { knowledge_id: k.id } })
    return { ok: true, knowledge: k }
  }

  // ---------- Respostas ----------

  @Get('respostas')
  @RequirePermission('assist_atendimento', 'view')
  answers(@CurrentUser() user: AuthUser, @Query() q: AnswersDto) {
    return this.queries.answers(user.tenantId, q)
  }

  @Get('respostas/:id')
  @RequirePermission('assist_atendimento', 'view')
  answerDetail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.queries.answer(user.tenantId, id)
  }

  /** Aprova e envia uma sugestão. Texto editado vira uma nova resposta de origem "atendente". */
  @Post('respostas/:id/aprovar')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'create')
  async approve(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number, @Body() dto: ApproveDto) {
    const a = await this.attempt(user, id)
    if (!['pendente_aprovacao', 'preparada'].includes(a.sendStatus)) throw new ConflictException('Esta resposta não está aguardando aprovação.')
    const text = dto.text !== undefined ? dto.text.trim() : a.text
    const r = text !== a.text ? await this.pipeline.manualAnswer(user.tenantId, a.questionId, text, actor(user), { kind: a.kind as 'resposta' | 'solicitar_info', basedOn: a.id }) : await this.pipeline.sendAttempt(user.tenantId, a.id, actor(user))
    await this.audit.byUser(user, ctx, 'assistente.sugestao_aprovada', 'assist_attempt', String(id), { editada: text !== a.text, enviada: r.sent })
    return r
  }

  @Post('respostas/:id/reenviar')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'create')
  async retry(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number) {
    const a = await this.attempt(user, id)
    if (a.sendStatus !== 'falha') throw new ConflictException('Só respostas com falha podem ser reenviadas.')
    const r = await this.pipeline.sendAttempt(user.tenantId, a.id, actor(user))
    await this.audit.byUser(user, ctx, 'assistente.resposta_reenviada', 'assist_attempt', String(id), { enviada: r.sent })
    return r
  }

  @Post('respostas/:id/descartar')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'edit')
  async discard(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number) {
    const a = await this.attempt(user, id)
    if (!['pendente_aprovacao', 'preparada', 'falha'].includes(a.sendStatus)) throw new ConflictException('Esta resposta não pode ser descartada.')
    await this.assist.prisma.assistAttempt.update({ where: { id }, data: { sendStatus: 'descartada', error: `Descartada por ${user.name}.` } })
    await this.assist.addEvent(user.tenantId, a.questionId, 'sugestao_descartada', { actor: actor(user), data: { attempt_id: id } })
    await this.audit.byUser(user, ctx, 'assistente.sugestao_descartada', 'assist_attempt', String(id))
    return { ok: true }
  }

  /** Marca para revisão e registra observação interna, sem mudar a mensagem enviada. */
  @Post('respostas/:id/revisao')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'edit')
  async flag(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: FlagDto) {
    const a = await this.attempt(user, id)
    await this.assist.prisma.assistAttempt.update({ where: { id }, data: { flaggedForReview: dto.flagged } })
    const note = str(dto.note, 4000)
    if (note) await this.assist.prisma.assistNote.create({ data: { tenantId: user.tenantId, entity: 'answer', entityId: id, userId: user.id, userName: user.name, note } })
    await this.assist.addEvent(user.tenantId, a.questionId, dto.flagged ? 'resposta_marcada_revisao' : 'resposta_desmarcada_revisao', { actor: actor(user), note: note || null, data: { attempt_id: id } })
    return { ok: true }
  }

  @Post('respostas/:id/observacoes')
  @HttpCode(200)
  @RequirePermission('assist_atendimento', 'edit')
  async answerNote(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: NoteDto) {
    await this.attempt(user, id)
    const note = str(dto.note, 4000)
    if (!note) throw new BadRequestException('Escreva a observação.')
    await this.assist.prisma.assistNote.create({ data: { tenantId: user.tenantId, entity: 'answer', entityId: id, userId: user.id, userName: user.name, note } })
    return { ok: true }
  }

  // ---------- Base de conhecimento ----------

  @Get('conhecimento/meta')
  @RequirePermission('assist_conhecimento', 'view')
  knowledgeMeta(@CurrentUser() user: AuthUser) {
    return this.queries.knowledgeMeta(user.tenantId)
  }

  @Get('conhecimento')
  @RequirePermission('assist_conhecimento', 'view')
  knowledgeList(@CurrentUser() user: AuthUser, @Query() q: KnowledgeListDto) {
    return this.queries.knowledgeList(user.tenantId, q)
  }

  @Get('conhecimento/:id')
  @RequirePermission('assist_conhecimento', 'view')
  knowledgeDetail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.queries.knowledgeDetail(user.tenantId, id)
  }

  /** Quem não pode aprovar (editar) só cria rascunho ou envia para revisão. */
  @Post('conhecimento')
  @HttpCode(200)
  @RequirePermission('assist_conhecimento', 'create')
  async createKnowledge(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: KnowledgeDto) {
    const d = this.knowledge.validate(dto)
    let status = dto.status ?? 'em_revisao'
    if (status === 'ativo' && !this.canDo(user, 'assist_conhecimento', 'edit')) status = 'em_revisao'
    const originQuestionId = dto.originQuestionId ?? null
    if (originQuestionId) await this.question(user, originQuestionId)
    const id = await this.knowledge.create(user.tenantId, d, { actor: actor(user), status, originQuestionId, approved: status === 'ativo' })
    if (d.partCode && d.model && dto.createApplication) {
      await this.knowledge.upsertApplication(user.tenantId, { partCode: d.partCode, productName: d.product, machineBrand: d.brand, machineModel: d.model, system: d.category, application: d.application, knowledgeId: id, source: d.source, validationStatus: status === 'ativo' && d.application ? 'confirmada' : 'pendente' }, actor(user))
    }
    if (originQuestionId) {
      await this.assist.addEvent(user.tenantId, originQuestionId, 'conhecimento_cadastrado', { actor: actor(user), note: `Conhecimento #${id} cadastrado a partir desta pergunta (${status}).`, data: { knowledge_id: id } })
      const q = await this.assist.prisma.assistQuestion.findUnique({ where: { id: originQuestionId }, select: { status: true } })
      if (status === 'em_revisao' && q && !FINAL_STATUSES.includes(q.status)) await this.assist.setStatus(user.tenantId, originQuestionId, 'conhecimento_aprovacao', { actor: actor(user), note: `Conhecimento #${id} enviado para aprovação.` })
    }
    await this.audit.byUser(user, ctx, 'assistente.conhecimento_criado', 'assist_knowledge', String(id), { status, titulo: d.title })
    return { id, status }
  }

  @Put('conhecimento/:id')
  @RequirePermission('assist_conhecimento', 'edit')
  async updateKnowledge(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number, @Body() dto: KnowledgeDto) {
    const d = this.knowledge.validate(dto)
    const before = await this.assist.prisma.assistKnowledge.findFirst({ where: { id, tenantId: user.tenantId, deletedAt: null } })
    if (!before) throw new NotFoundException('Conhecimento não encontrado.')
    await this.knowledge.update(user.tenantId, id, d, { actor: actor(user), status: dto.status ?? null, approved: dto.status === 'ativo' && before.status !== 'ativo' })
    await this.audit.byUser(user, ctx, 'assistente.conhecimento_editado', 'assist_knowledge', String(id), { status: dto.status })
    return { ok: true }
  }

  @Post('conhecimento/:id/situacao')
  @HttpCode(200)
  @RequirePermission('assist_conhecimento', 'edit')
  async knowledgeStatus(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number, @Body() dto: KnowledgeStatusDto) {
    const before = await this.knowledge.setStatus(user.tenantId, id, dto.status, actor(user))
    await this.audit.byUser(user, ctx, dto.status === 'ativo' ? 'assistente.conhecimento_aprovado' : 'assistente.conhecimento_situacao', 'assist_knowledge', String(id), { de: before.status, para: dto.status })
    return { ok: true }
  }

  /** Exclusão lógica: sai da base ativa, o histórico e a auditoria ficam. */
  @Delete('conhecimento/:id')
  @RequirePermission('assist_conhecimento', 'delete')
  async deleteKnowledge(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number) {
    const k = await this.assist.prisma.assistKnowledge.findFirst({ where: { id, tenantId: user.tenantId, deletedAt: null } })
    if (!k) throw new NotFoundException('Conhecimento não encontrado.')
    await this.assist.prisma.assistKnowledge.update({ where: { id }, data: { deletedAt: new Date(), deletedByName: user.name, status: 'inativo' } })
    await this.audit.byUser(user, ctx, 'assistente.conhecimento_excluido', 'assist_knowledge', String(id), { titulo: k.title })
    return { ok: true }
  }

  // ---------- Importar planilha ----------

  @Get('importacoes/modelo')
  @RequirePermission('assist_conhecimento', 'create')
  template(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-base-conhecimento.xlsx"')
    res.send(Buffer.from(this.imports.template()))
  }

  @Get('importacoes')
  @RequirePermission('assist_conhecimento', 'create')
  async importList(@CurrentUser() user: AuthUser) {
    const rows = await this.assist.prisma.assistImport.findMany({ where: { tenantId: user.tenantId }, orderBy: { id: 'desc' }, take: 200, select: { id: true, filename: true, createdAt: true, finishedAt: true, status: true, totalRows: true, imported: true, updated: true, ignored: true, errors: true, userName: true } })
    return { rows }
  }

  @Post('importacoes')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('assist_conhecimento', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Selecione um arquivo .xlsx.')
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Formato não aceito. Envie um arquivo Excel .xlsx.')
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8')
    const r = await this.imports.upload(user.tenantId, filename, new Uint8Array(file.buffer), actor(user))
    await this.audit.byUser(user, ctx, 'assistente.planilha_enviada', 'assist_import', String(r.id), { arquivo: filename, erros_cabecalho: r.headerErrors })
    return r
  }

  @Get('importacoes/:id')
  @RequirePermission('assist_conhecimento', 'create')
  async importDetail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const imp = await this.imports.load(user.tenantId, id)
    const rows = await this.assist.prisma.assistImportRow.findMany({ where: { importId: id }, orderBy: { rowNumber: 'asc' } })
    const summary = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.action] = (acc[r.action] ?? 0) + 1), acc), {})
    return { import: imp, rows, summary }
  }

  @Put('importacoes/:id/linhas/:rowId')
  @RequirePermission('assist_conhecimento', 'create')
  editRow(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Param('rowId', ParseIntPipe) rowId: number, @Body() dto: ImportRowDto) {
    return this.imports.editRow(user.tenantId, id, rowId, dto)
  }

  @Post('importacoes/:id/decidir-todas')
  @HttpCode(200)
  @RequirePermission('assist_conhecimento', 'create')
  decideAll(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: DecideAllDto) {
    return this.imports.decideAll(user.tenantId, id, dto.decision)
  }

  @Post('importacoes/:id/confirmar')
  @HttpCode(200)
  @RequirePermission('assist_conhecimento', 'create')
  async confirmImport(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number) {
    const report = await this.imports.confirm(user.tenantId, id, actor(user), { canApprove: this.canDo(user, 'assist_conhecimento', 'edit') })
    await this.audit.byUser(user, ctx, 'assistente.importacao_confirmada', 'assist_import', String(id), { importados: report.imported, atualizados: report.updated, ignorados: report.ignored, erros: report.errors })
    return { report }
  }

  @Post('importacoes/:id/cancelar')
  @HttpCode(200)
  @RequirePermission('assist_conhecimento', 'create')
  cancelImport(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.imports.cancel(user.tenantId, id)
  }

  // ---------- Produtos e aplicações ----------

  @Get('aplicacoes/meta')
  @RequirePermission('assist_aplicacoes', 'view')
  appsMeta(@CurrentUser() user: AuthUser) {
    return this.queries.applicationsMeta(user.tenantId)
  }

  @Get('aplicacoes')
  @RequirePermission('assist_aplicacoes', 'view')
  apps(@CurrentUser() user: AuthUser, @Query() q: AppListDto) {
    return this.queries.applications(user.tenantId, q)
  }

  @Get('aplicacoes/produto/:code')
  @RequirePermission('assist_aplicacoes', 'view')
  product(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.queries.product(user.tenantId, code.slice(0, 100))
  }

  @Post('aplicacoes')
  @HttpCode(200)
  @RequirePermission('assist_aplicacoes', 'create')
  async createApp(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: AppDto) {
    let status = dto.validationStatus ?? 'pendente'
    if (status !== 'pendente' && !this.canDo(user, 'assist_aplicacoes', 'edit')) status = 'pendente'
    if (status === 'confirmada' && !str(dto.application)) throw new BadRequestException('Descreva a aplicação antes de confirmar a compatibilidade.')
    if (dto.mlItemId && !(await this.assist.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId: user.tenantId, id: dto.mlItemId } } }))) throw new BadRequestException('Anúncio não encontrado entre os anúncios sincronizados da loja.')
    const id = await this.knowledge.upsertApplication(user.tenantId, { ...dto, validationStatus: status }, actor(user))
    await this.audit.byUser(user, ctx, 'assistente.aplicacao_salva', 'assist_application', String(id), { codigo: dto.partCode, modelo: dto.machineModel, status })
    return { id }
  }

  @Put('aplicacoes/:id')
  @RequirePermission('assist_aplicacoes', 'edit')
  async updateApp(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number, @Body() dto: AppUpdateDto) {
    const cur = await this.assist.prisma.assistApplication.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!cur) throw new NotFoundException('Aplicação não encontrada.')
    if (dto.mlItemId && !(await this.assist.prisma.assistItem.findUnique({ where: { tenantId_id: { tenantId: user.tenantId, id: dto.mlItemId } } }))) throw new BadRequestException('Anúncio não encontrado entre os anúncios sincronizados da loja.')
    await this.assist.prisma.assistApplication.update({
      where: { id },
      data: { productName: dto.productName ?? cur.productName, partBrand: dto.partBrand ?? cur.partBrand, system: dto.system ?? cur.system, application: dto.application ?? cur.application, mlItemId: dto.mlItemId === undefined ? cur.mlItemId : dto.mlItemId || null, source: dto.source ?? cur.source, updatedAt: new Date() },
    })
    await this.audit.byUser(user, ctx, 'assistente.aplicacao_editada', 'assist_application', String(id))
    return { ok: true }
  }

  @Post('aplicacoes/:id/validar')
  @HttpCode(200)
  @RequirePermission('assist_aplicacoes', 'edit')
  async validateApp(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('id', ParseIntPipe) id: number, @Body() dto: ValidateDto) {
    const cur = await this.assist.prisma.assistApplication.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!cur) throw new NotFoundException('Aplicação não encontrada.')
    if (dto.status === 'confirmada' && !str(cur.application)) throw new BadRequestException('Descreva a aplicação antes de confirmar a compatibilidade.')
    await this.assist.prisma.assistApplication.update({ where: { id }, data: { validationStatus: dto.status, validatedById: user.id, validatedByName: user.name, validatedAt: new Date(), updatedAt: new Date() } })
    await this.audit.byUser(user, ctx, 'assistente.aplicacao_validada', 'assist_application', String(id), { de: cur.validationStatus, para: dto.status })
    return { ok: true }
  }

  @Get('anuncios')
  @RequirePermission('assist_aplicacoes', 'view')
  items(@CurrentUser() user: AuthUser, @Query() q: ItemsDto) {
    return this.queries.items(user.tenantId, q)
  }

  // ---------- Configurações da IA ----------

  @Get('config')
  @RequirePermission('assist_config', 'view')
  async aiConfig(@CurrentUser() user: AuthUser) {
    const [s, used, claude, gemini] = await Promise.all([
      this.assist.ai(user.tenantId),
      this.assist.prisma.assistKnowledge.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, distinct: ['category'], select: { category: true } }),
      this.assist.keyStatus(user.tenantId, 'claude'),
      this.assist.keyStatus(user.tenantId, 'gemini'),
    ])
    return { settings: s, defaults: AI_DEFAULTS, models: CLAUDE_MODELS, efforts: EFFORTS, categories: [...new Set([...KNOWLEDGE_CATEGORIES, ...used.map((u) => u.category)])], keys: { claude, gemini }, providers: PROVIDERS, geminiModels: GEMINI_MODELS }
  }

  @Put('config')
  @RequirePermission('assist_config', 'edit')
  async saveAiConfig(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: AiSettingsDto) {
    if (!dto.allowed_categories.length) throw new BadRequestException('Selecione ao menos uma categoria de conhecimento.')
    for (const [label, t] of [['Começo da resposta de frete', dto.frete_intro], ['Fim da resposta de frete', dto.frete_outro], ['Pedido de CEP', dto.frete_ask_cep_text]] as const) {
      const bad = forbiddenContent(t)
      if (bad) throw new BadRequestException(`${label}: o Mercado Livre não aceita ${bad} nas respostas. Tire do texto.`)
    }
    if (!dto.frete_intro.includes('{cep}')) throw new BadRequestException('O começo da resposta de frete precisa ter {cep}, para o cliente ver para qual CEP é o frete.')
    const cur = await this.assist.ai(user.tenantId)
    const next: AiSettings = { ...cur, ...dto }
    await this.assist.saveAi(user.tenantId, next)
    const changed = (Object.keys(next) as (keyof AiSettings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k]))
    await this.audit.byUser(user, ctx, 'assistente.config_ia', 'settings', 'assist_ai', { campos: changed, resposta_automatica: next.auto_reply, motor: next.provider })
    return { ok: true, settings: next }
  }

  @Get('config/prompt')
  @RequirePermission('assist_config', 'view')
  async prompt(@CurrentUser() user: AuthUser) {
    return { prompt: buildSystemPrompt(await this.assist.ai(user.tenantId)) }
  }

  @Put('config/chaves/:provider')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('assist_config', 'edit')
  async saveKey(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('provider') provider: string, @Body() dto: KeyDto) {
    if (provider !== 'claude' && provider !== 'gemini') throw new BadRequestException('Provedor inválido.')
    const key = dto.key.replace(/\s+/g, '').replace(/^["']|["']$/g, '')
    if (!KEY_FORMAT[provider].test(key)) throw new BadRequestException(provider === 'claude' ? 'Chave do Claude inválida: ela começa com "sk-ant-". Copie de novo em console.anthropic.com › API Keys.' : 'Chave do Gemini muito curta ou incompleta. Copie de novo em aistudio.google.com/apikey.')
    const test = provider === 'claude' ? await testClaudeKey(key) : await testGeminiKey(key)
    if (!test.ok && /inválida|permissão/.test(test.detail)) throw new BadRequestException(`A chave não foi aceita: ${test.detail}`)
    await this.assist.saveApiKey(user.tenantId, provider, key, user.name)
    const status = await this.assist.keyStatus(user.tenantId, provider)
    await this.audit.byUser(user, ctx, 'assistente.chave_ia', 'settings', provider, { chave: status.masked ?? null, validada: test.ok })
    return { ok: true, status, test }
  }

  @Post('config/chaves/:provider/testar')
  @HttpCode(200)
  @RequirePermission('assist_config', 'edit')
  async testKey(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    if (provider !== 'claude' && provider !== 'gemini') throw new BadRequestException('Provedor inválido.')
    const key = await this.assist.apiKey(user.tenantId, provider)
    if (!key) throw new BadRequestException('Nenhuma chave configurada para este provedor.')
    return provider === 'claude' ? testClaudeKey(key) : testGeminiKey(key)
  }

  @Delete('config/chaves/:provider')
  @RequirePermission('assist_config', 'edit')
  async removeKey(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Param('provider') provider: string) {
    if (provider !== 'claude' && provider !== 'gemini') throw new BadRequestException('Provedor inválido.')
    await this.assist.removeApiKey(user.tenantId, provider)
    await this.audit.byUser(user, ctx, 'assistente.chave_ia_removida', 'settings', provider)
    return { ok: true, status: await this.assist.keyStatus(user.tenantId, provider) }
  }

  @Post('config/testar')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async testAssistant(@CurrentUser() user: AuthUser, @Body() dto: TestDto) {
    // testar o assistente: quem configura ou quem responde as perguntas
    if (!this.canDo(user, 'assist_config', 'view') && !this.canDo(user, 'assist_atendimento', 'create')) throw new ForbiddenException('Seu perfil não pode testar o assistente.')
    const question = str(dto.question, 2000)
    if (!question) throw new BadRequestException('Digite uma pergunta de teste.')
    return this.pipeline.test(user.tenantId, question, dto.itemId ? dto.itemId.toUpperCase() : null)
  }

  // ---------- Integração com o Mercado Livre ----------

  @Get('integracao')
  @RequirePermission('assist_config', 'view')
  status(@CurrentUser() user: AuthUser) {
    return this.integration.status(user.tenantId)
  }

  @Post('integracao/testar')
  @HttpCode(200)
  @RequirePermission('assist_config', 'edit')
  test(@CurrentUser() user: AuthUser) {
    return this.integration.test(user.tenantId)
  }

  @Post('integracao/assumir')
  @HttpCode(200)
  @RequirePermission('assist_config', 'edit')
  async takeOver(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: TakeOverDto) {
    const r = await this.integration.takeOver(user.tenantId, actor(user), dto.usePainelAccess)
    await this.audit.byUser(user, ctx, 'assistente.atendimento_assumido', 'settings', 'assist_integration', { acessoDoPainel: dto.usePainelAccess, conta: r.nickname })
    return r
  }

  @Post('integracao/liberar')
  @HttpCode(200)
  @RequirePermission('assist_config', 'edit')
  async release(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx) {
    const r = await this.integration.release(user.tenantId, actor(user))
    await this.audit.byUser(user, ctx, 'assistente.atendimento_liberado', 'settings', 'assist_integration')
    return r
  }

  @Put('integracao/config')
  @RequirePermission('assist_config', 'edit')
  saveIntegration(@CurrentUser() user: AuthUser, @Body() dto: IntegrationDto) {
    return this.integration.saveSettings(user.tenantId, dto)
  }

  @Put('integracao/loja')
  @RequirePermission('assist_config', 'edit')
  async setStore(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestCtx, @Body() dto: StoreDto) {
    const r = await this.integration.setStore(user.tenantId, dto.url, actor(user))
    await this.audit.byUser(user, ctx, 'assistente.loja_oficial', 'settings', 'assist_store', { loja: r.store.nickname, vendedor: r.store.seller_id, lojaOficial: r.store.official_store_id })
    return r
  }

  @Delete('integracao/loja')
  @RequirePermission('assist_config', 'edit')
  removeStore(@CurrentUser() user: AuthUser) {
    return this.integration.removeStore(user.tenantId)
  }

  @Post('integracao/sincronizar-anuncios')
  @HttpCode(202)
  @RequirePermission('assist_config', 'edit')
  syncItems(@CurrentUser() user: AuthUser) {
    return this.integration.syncItems(user.tenantId, actor(user))
  }

  @Get('integracao/sincronizar-anuncios')
  @RequirePermission('assist_config', 'view')
  syncItemsStatus(@CurrentUser() user: AuthUser) {
    return this.integration.itemSyncStatus(user.tenantId)
  }

  @Post('integracao/sincronizar-perguntas')
  @HttpCode(200)
  @RequirePermission('assist_config', 'edit')
  syncQuestions(@CurrentUser() user: AuthUser) {
    return this.integration.syncQuestionsNow(user.tenantId)
  }

  @Post('integracao/sincronizar-vendas')
  @HttpCode(200)
  @RequirePermission('assist_config', 'edit')
  syncSales(@CurrentUser() user: AuthUser, @Body() dto: SalesDto) {
    return this.integration.syncSalesNow(user.tenantId, dto.days)
  }
}

/** Notificações do Mercado Livre (perguntas e pedidos). Público: confere o aplicativo e o vendedor antes de agir. */
@ApiTags('Assistente do Mercado Livre')
@Controller('webhooks/mercadolivre')
export class MercadoLivreWebhookController {
  constructor(private readonly integration: AssistIntegrationService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  receive(@Body() body: Record<string, unknown>) {
    // responde na hora; o processamento segue em segundo plano
    void this.integration.webhook(body as never).catch(() => undefined)
    return { ok: true }
  }
}
