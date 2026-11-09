import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { businessMsBetween, cleanRules, DEFAULT_RULES, type WaRules } from '../whatsapp/envio'
import { businessMs } from '../whatsapp/metricas'
import {
  type Cursor,
  decodeCursor,
  encodeCursor,
  filterOf,
  hashKey,
  KEY_RE,
  keyFits,
  keyPrefix,
  localDateTime,
  MAX_PAGE,
  minutes,
  newKey,
  RateLimiter,
  sameHash,
  todaySP,
  whatsappSessions,
} from './bi'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { contratoMarkdown } from './bi-contrato'
import { PROJETO, zipDoProjeto } from './powerbi'
import { type BiTable, describeTables, pageSql, TABLE_BY_NAME } from './bi-tabelas'

const MODULE = 'bi'
/** Conversas por página da tabela de atendimentos do WhatsApp (cada uma vira um ou mais atendimentos). */
const WA_BATCH = 1000

export interface BiQuery {
  desde?: string
  meses?: number
  limite?: number
  cursor?: string
}

interface KeyRow {
  id: string
  tenantId: string
}

@Injectable()
export class BiService {
  private readonly limiter = new RateLimiter(120, 60_000)
  /** Último registro de uso gravado por chave (grava no máximo uma vez por minuto). */
  private readonly touched = new Map<string, number>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Endereço da API de BI (o que vai no parâmetro CRM_BaseUrl do Power BI). */
  baseUrl() {
    return `${env.appUrl}/api/bi/v1/`
  }

  // ---------- Chaves (Configurações › Power BI) ----------

  private assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, MODULE, action)) throw new ForbiddenException('Seu perfil não tem acesso a esta ação do Power BI.')
  }

  async keys(user: AuthUser) {
    this.assertCan(user, 'view')
    const list = await this.prisma.biKey.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      select: { id: true, name: true, prefix: true, createdByName: true, createdAt: true, lastUsedAt: true, lastUsedIp: true, revokedAt: true, revokedByName: true },
      take: 200,
    })
    return { baseUrl: this.baseUrl(), keys: list }
  }

  async createKey(user: AuthUser, name: string, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const clean = name.trim().slice(0, 80)
    if (!clean) throw new BadRequestException('Dê um nome à chave (ex.: Power BI da diretoria).')
    const active = await this.prisma.biKey.count({ where: { tenantId: user.tenantId, revokedAt: null } })
    if (active >= 20) throw new BadRequestException('Limite de 20 chaves ativas. Revogue as que não usa mais.')
    const key = newKey()
    const row = await this.prisma.biKey.create({
      data: { tenantId: user.tenantId, name: clean, keyHash: hashKey(key), prefix: keyPrefix(key), createdById: user.id, createdByName: user.name },
      select: { id: true, name: true, prefix: true, createdAt: true },
    })
    await this.audit.log({ tenantId: user.tenantId, userId: user.id, userEmail: user.email, action: 'bi.chave_criada', entity: 'bi_key', entityId: row.id, ...ctx, data: { nome: clean, inicio: row.prefix } })
    // A chave em si só sai aqui, uma vez.
    return { ...row, key, baseUrl: this.baseUrl() }
  }

  async revokeKey(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const row = await this.prisma.biKey.findFirst({ where: { id, tenantId: user.tenantId }, select: { id: true, name: true, prefix: true, revokedAt: true } })
    if (!row) throw new NotFoundException('Chave não encontrada.')
    if (row.revokedAt) return { ok: true }
    await this.prisma.biKey.update({ where: { id }, data: { revokedAt: new Date(), revokedByName: user.name } })
    await this.audit.log({ tenantId: user.tenantId, userId: user.id, userEmail: user.email, action: 'bi.chave_revogada', entity: 'bi_key', entityId: id, ...ctx, data: { nome: row.name, inicio: row.prefix } })
    return { ok: true }
  }

  contrato(user: AuthUser) {
    this.assertCan(user, 'view')
    return contratoMarkdown(this.baseUrl())
  }

  /** Pasta do projeto do Power BI (bi/powerbi do repositório; na imagem, POWERBI_DIR). */
  private powerBiDir(): string | null {
    const candidatos = [process.env.POWERBI_DIR, resolve(process.cwd(), '../../bi/powerbi'), resolve(process.cwd(), 'bi/powerbi'), resolve(__dirname, '../../../../bi/powerbi')]
    return candidatos.find((d) => d && existsSync(resolve(d, `${PROJETO}.pbip`))) ?? null
  }

  /** Projeto do Power BI (.pbip) em zip, com o endereço deste CRM no parâmetro CRM_BaseUrl. */
  projetoPowerBi(user: AuthUser) {
    this.assertCan(user, 'view')
    const dir = this.powerBiDir()
    if (!dir) throw new NotFoundException('O projeto do Power BI não está nesta instalação.')
    return { nome: `${PROJETO} - Power BI.zip`, zip: zipDoProjeto(dir, this.baseUrl()) }
  }

  // ---------- API de dados (Power BI) ----------

  /** Confere a chave do cabeçalho X-BI-Key: formato, resumo no banco (comparação em tempo constante) e revogação. */
  async authenticate(header: string | undefined, ip: string | null): Promise<KeyRow> {
    const key = typeof header === 'string' ? header.trim() : ''
    if (!key) throw new UnauthorizedException('Envie a chave do Power BI no cabeçalho X-BI-Key.')
    if (!KEY_RE.test(key)) throw new UnauthorizedException('Chave do Power BI inválida.')
    const hash = hashKey(key)
    const row = await this.prisma.biKey.findUnique({ where: { keyHash: hash }, select: { id: true, tenantId: true, keyHash: true, revokedAt: true } })
    if (!row || !sameHash(row.keyHash, hash)) throw new UnauthorizedException('Chave do Power BI inválida.')
    if (row.revokedAt) throw new UnauthorizedException('Esta chave do Power BI foi revogada. Crie outra em Configurações › Power BI.')
    const limit = this.limiter.hit(row.id)
    if (!limit.ok) throw new HttpException({ statusCode: 429, message: `Muitos pedidos com esta chave (limite de 120 por minuto). Tente de novo em ${limit.retryAfter} s.`, retryAfter: limit.retryAfter }, HttpStatus.TOO_MANY_REQUESTS)
    const now = Date.now()
    if ((this.touched.get(row.id) ?? 0) < now - 60_000) {
      this.touched.set(row.id, now)
      await this.prisma.biKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now), lastUsedIp: ip?.slice(0, 60) ?? null } })
    }
    return { id: row.id, tenantId: row.tenantId }
  }

  tables() {
    return { versao: 'v1', tabelas: describeTables() }
  }

  async page(k: KeyRow, name: string, q: BiQuery) {
    const t = TABLE_BY_NAME.get(name)
    if (!t) throw new NotFoundException(`Tabela "${name}" não existe. Veja a lista em /api/bi/v1/tabelas.`)
    const limit = Math.min(MAX_PAGE, Math.max(1, q.limite ?? MAX_PAGE))
    let cursor: Cursor | null = null
    let filter: { f: Cursor['f']; d: string | null }
    if (q.cursor) {
      cursor = decodeCursor(q.cursor, t.nome)
      if (!cursor || !keyFits(cursor.k, t.custom ? 'uuid' : t.sql!.keyType)) throw new BadRequestException('cursor inválido: use o valor de "next" da página anterior desta tabela.')
      filter = { f: cursor.f, d: cursor.d }
    } else {
      const f = filterOf({ desde: q.desde, meses: q.meses }, t.tipo === 'fato', todaySP())
      if ('error' in f) throw new BadRequestException(f.error)
      filter = f
    }
    const { rows, last } = t.custom ? await this.whatsapp(k.tenantId, filter, cursor?.k ?? null, limit) : await this.sqlPage(t, k.tenantId, filter, cursor?.k ?? null, limit)
    return {
      tabela: t.nome,
      colunas: t.colunas.map((c) => c.nome),
      rows,
      next: last ? encodeCursor({ t: t.nome, k: last, f: filter.f, d: filter.d }) : null,
    }
  }

  /** Consulta só de leitura, com tempo máximo (uma página pesada não trava o banco). */
  private readOnly<T>(fn: (q: (sql: string, ...params: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '90s'`)
        return fn((sql, ...params) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params))
      },
      { timeout: 120_000, maxWait: 15_000 },
    )
  }

  private async sqlPage(t: BiTable, tenantId: string, filter: { f: Cursor['f']; d: string | null }, after: string | null, limit: number) {
    const sql = pageSql(t, filter.f, after !== null)
    const params: unknown[] = [tenantId, limit + 1]
    if (filter.f !== 'tudo') params.push(filter.d)
    if (after !== null) params.push(t.sql!.keyType === 'int' ? Number(after) : after)
    const raw = await this.readOnly((q) => q(sql, ...params))
    const more = raw.length > limit
    const page = more ? raw.slice(0, limit) : raw
    const rows = page.map((r) => {
      const { _k, ...rest } = r
      return rest
    })
    return { rows, last: more ? String(page[page.length - 1]!._k) : null }
  }

  /**
   * fato_conversas_whatsapp: um lote de conversas por página (pela ordem do id); as mensagens de cada uma viram os
   * atendimentos (mesma regra do painel do WhatsApp). Notas internas e grupos ficam de fora.
   */
  private async whatsapp(tenantId: string, filter: { f: Cursor['f']; d: string | null }, after: string | null, limit: number) {
    const batch = Math.min(WA_BATCH, limit)
    const today = todaySP()
    // Janela das mensagens: a do filtro (janela) ou a padrão (desde), começando no dia de Brasília.
    const windowDay = filter.f === 'janela' ? filter.d! : (filterOf({}, true, today) as { d: string }).d
    const since = new Date(`${windowDay}T00:00:00-03:00`)
    const activeSince = filter.f === 'desde' ? new Date(`${filter.d}T00:00:00-03:00`) : since
    const convs = await this.prisma.whatsappConversation.findMany({
      where: { tenantId, category: { not: 'GRUPO' }, lastMessageAt: { gte: activeSince }, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: batch + 1,
      select: { id: true, numberId: true, sectorId: true, assignedUserId: true, assignedSellerId: true, leadId: true, recordId: true, category: true, status: true, noReplyNeeded: true, lastInboundAt: true },
    })
    const more = convs.length > batch
    const page = more ? convs.slice(0, batch) : convs
    if (!page.length) return { rows: [], last: null }
    const msgs = await this.prisma.whatsappMessage.findMany({
      where: { conversationId: { in: page.map((c) => c.id) }, internal: false, sentAt: { gte: since } },
      orderBy: [{ conversationId: 'asc' }, { sentAt: 'asc' }, { createdAt: 'asc' }],
      select: { conversationId: true, fromMe: true, sentAt: true, sentById: true },
    })
    const rules: WaRules = cleanRules(await this.settings.get<Partial<WaRules>>(tenantId, 'whatsapp_regras', DEFAULT_RULES))
    const hours = rules.businessHours
    const sessions = whatsappSessions(msgs, (a, b) => (hours?.enabled ? businessMsBetween(hours, a, b) : businessMs(a, b)))
    const byConv = new Map(page.map((c) => [c.id, c]))
    const lastOf = new Map<string, number>()
    sessions.forEach((s, i) => lastOf.set(s.conversationId, i))
    const now = Date.now()
    const rows = sessions.map((s, i) => {
      const c = byConv.get(s.conversationId)!
      const isLast = lastOf.get(s.conversationId) === i
      const waiting = isLast && s.pending && c.status === 'ABERTA' && !c.noReplyNeeded && !!c.lastInboundAt
      return {
        atendimento_wa_id: `${s.conversationId}:${s.startAt.getTime()}`,
        conversa_id: s.conversationId,
        numero_id: c.numberId,
        setor_id: c.sectorId,
        atendente_id: c.assignedUserId,
        vendedor_id: c.assignedSellerId,
        lead_id: c.leadId,
        atendimento_id: c.recordId,
        categoria: c.category,
        iniciado_por: s.startedBy,
        inicio_em: localDateTime(s.startAt),
        data_inicio: localDateTime(s.startAt)!.slice(0, 10),
        fim_em: localDateTime(s.endAt),
        primeira_mensagem_cliente_em: localDateTime(s.firstAt),
        primeira_resposta_em: localDateTime(s.firstRespondedAt),
        minutos_primeira_resposta: minutes(s.firstMs),
        minutos_primeira_resposta_comercial: minutes(s.firstBusinessMs),
        respondido_por_id: s.firstResponder && s.firstResponder !== 'celular' ? s.firstResponder : null,
        respondido_pelo_celular: s.firstResponder === 'celular',
        mensagens_cliente: s.inbound,
        mensagens_empresa: s.outbound,
        vezes_cliente: s.turns,
        vezes_respondidas: s.answered,
        minutos_resposta_media: s.answered ? minutes(s.responseMsSum / s.answered) : null,
        aguardando_resposta: waiting,
        minutos_aguardando: waiting ? minutes(now - c.lastInboundAt!.getTime()) : null,
      }
    })
    return { rows, last: more ? page[page.length - 1]!.id : null }
  }
}
