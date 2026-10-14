import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { randomToken, safeEqual, sha256 } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { ACTION_TIMEOUT_MS, allowedAction, DEFAULT_TCAR, detailQuery, fold, AUTO_REFRESH_MIN_AGE_MS, AUTO_REFRESH_TOP, MAX_ACTIONS_PER_PING, MAX_LIVE_PER_PING, nextSync, OFFLINE_AFTER_MS, PAGE_SIZE, productFrom, productQuery, rowsOf, type TcarSettings } from './tcar'

const KEY = 'tcar'
const STATE = 'tcar_state'

interface TcarState {
  lastPingAt: string | null
  instance: { hostname: string | null; ip: string | null; version: string | null; companyId: number | null; branchId: number | null; uptime: number | null } | null
  lastFullAt: string | null
  lastIncrementalAt: string | null
  fullRunning: boolean
  fullRunAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  products: number
}
const DEFAULT_STATE: TcarState = { lastPingAt: null, instance: null, lastFullAt: null, lastIncrementalAt: null, fullRunning: false, fullRunAt: null, lastError: null, lastErrorAt: null, products: 0 }

export const SEARCH_FIELDS = ['tudo', 'sku', 'referencia', 'integracao', 'fabrica', 'titulo', 'utilizado'] as const
export type SearchField = (typeof SEARCH_FIELDS)[number]

/** Tcar (ERP): PingAlive (o servidor da Tcar chama o CRM), cópia dos produtos e a consulta da equipe. */
@Injectable()
export class TcarService {
  private readonly logger = new Logger(TcarService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private async config(tenantId: string): Promise<TcarSettings> {
    return { ...DEFAULT_TCAR, ...(await this.settings.get<TcarSettings>(tenantId, KEY, DEFAULT_TCAR)) }
  }
  private async state(tenantId: string): Promise<TcarState> {
    return { ...DEFAULT_STATE, ...(await this.settings.get<TcarState>(tenantId, STATE, DEFAULT_STATE)) }
  }
  private async saveState(tenantId: string, patch: Partial<TcarState>) {
    await this.settings.set(tenantId, STATE, { ...(await this.state(tenantId)), ...patch })
  }

  // ---------- PingAlive (chamado pelo servidor da Tcar) ----------

  /** Empresa dona da chave enviada no x-api-key (a chave é guardada só como resumo). */
  private async tenantByKey(key: string | undefined) {
    if (!key || key.length < 20 || key.length > 200) throw new UnauthorizedException()
    const hash = sha256(key)
    const rows = await this.prisma.tenantSetting.findMany({ where: { key: KEY } })
    for (const r of rows) {
      const s = { ...DEFAULT_TCAR, ...(r.value as Partial<TcarSettings>) }
      if (s.enabled && s.keyHash && safeEqual(s.keyHash, hash)) return { tenantId: r.tenantId, s }
    }
    throw new UnauthorizedException()
  }

  private async fail(tenantId: string, message: string) {
    this.logger.warn(`Tcar: ${message}`)
    await this.saveState(tenantId, { lastError: message.slice(0, 300), lastErrorAt: new Date().toISOString() })
  }

  /** Keepalive: registra o contato e devolve as consultas pendentes (no máximo algumas por vez). */
  async ping(key: string | undefined, body: Record<string, unknown>) {
    const { tenantId, s } = await this.tenantByKey(key)
    const companyId = Number(body?.company_id) || null
    const branchId = Number(body?.branch_id) || null
    // Primeiro contato fixa a empresa e a filial; depois disso, outra identidade é recusada.
    if (s.companyId === null && companyId) await this.settings.set(tenantId, KEY, { ...s, companyId, branchId })
    else if ((s.companyId !== null && companyId !== s.companyId) || (s.branchId !== null && branchId !== s.branchId)) {
      await this.fail(tenantId, `Contato recusado: empresa/filial ${companyId}/${branchId} diferente da configurada (${s.companyId}/${s.branchId}).`)
      throw new ForbiddenException()
    }
    const now = new Date()
    await this.saveState(tenantId, {
      lastPingAt: now.toISOString(),
      instance: { hostname: String(body?.hostname ?? '').slice(0, 80) || null, ip: String(body?.ip_detected ?? '').slice(0, 45) || null, version: String(body?.version ?? '').slice(0, 30) || null, companyId, branchId, uptime: Number(body?.uptime_seconds) || null },
    })
    await this.expireStale(tenantId, now)
    await this.plan(tenantId, s, now)
    // Pedido feito na tela (estoque de uma peça na hora) passa na frente da cópia.
    const [live, sync] = await Promise.all([
      this.prisma.tcarAction.findMany({ where: { tenantId, status: 'PENDENTE', kind: 'live' }, orderBy: [{ createdAt: 'asc' }], take: MAX_LIVE_PER_PING }),
      this.prisma.tcarAction.findMany({ where: { tenantId, status: 'PENDENTE', kind: { not: 'live' } }, orderBy: [{ createdAt: 'asc' }], take: MAX_ACTIONS_PER_PING }),
    ])
    const batch = [...live, ...sync]
    if (batch.length) await this.prisma.tcarAction.updateMany({ where: { id: { in: batch.map((a) => a.id) } }, data: { status: 'ENVIADA', sentAt: now, attempts: { increment: 1 } } })
    return {
      status: 'success',
      actions: batch.filter((a) => allowedAction(a.cmd, 'GET')).map((a) => ({ transaction: a.id, cmd: a.cmd, verb: 'GET', query_params: a.query, data: {} })),
    }
  }

  /** Enviada e sem resposta: volta para a fila (até 3 tentativas). */
  private async expireStale(tenantId: string, now: Date) {
    const stale = await this.prisma.tcarAction.findMany({ where: { tenantId, status: 'ENVIADA', sentAt: { lt: new Date(now.getTime() - ACTION_TIMEOUT_MS) } } })
    for (const a of stale) {
      if (a.attempts < 3) await this.prisma.tcarAction.update({ where: { id: a.id }, data: { status: 'PENDENTE' } })
      else await this.giveUp(tenantId, a, 'A Tcar não respondeu a consulta depois de 3 tentativas.')
    }
  }

  private async giveUp(tenantId: string, a: { id: string; kind: string }, error: string) {
    await this.prisma.tcarAction.update({ where: { id: a.id }, data: { status: 'ERRO', error: error.slice(0, 500), doneAt: new Date() } })
    if (a.kind === 'full') await this.saveState(tenantId, { fullRunning: false })
    await this.fail(tenantId, error)
  }

  /** Agenda a cópia completa ou a dos produtos alterados, quando for a hora. */
  private async plan(tenantId: string, s: TcarSettings, now: Date) {
    const st = await this.state(tenantId)
    const due = nextSync(now, st, s)
    if (due === 'full') {
      await this.prisma.tcarAction.create({ data: { tenantId, kind: 'full', ...this.q(productQuery({ offset: 0, branchIds: s.branchIds })), runAt: now, offset: 0 } })
      await this.saveState(tenantId, { fullRunning: true, fullRunAt: now.toISOString() })
    } else if (due === 'incremental') {
      const open = await this.prisma.tcarAction.count({ where: { tenantId, kind: 'incremental', status: { in: ['PENDENTE', 'ENVIADA'] } } })
      if (!open) {
        // Desde a última consulta, com 5 minutos de folga (o relógio da Tcar pode estar adiantado).
        const base = st.lastIncrementalAt ?? st.lastFullAt
        const since = base ? new Date(Date.parse(base) - 5 * 60_000) : null
        await this.prisma.tcarAction.create({ data: { tenantId, kind: 'incremental', ...this.q(productQuery({ since, branchIds: s.branchIds })), runAt: now } })
        await this.saveState(tenantId, { lastIncrementalAt: now.toISOString() })
      }
    }
  }

  private q(a: { cmd: string; query_params: Record<string, string | number> }) {
    return { cmd: a.cmd, query: a.query_params as Prisma.InputJsonValue }
  }

  /** Resultado de uma consulta: grava os produtos e, na cópia completa, pede a próxima página. */
  async report(key: string | undefined, body: Record<string, unknown>) {
    const { tenantId, s } = await this.tenantByKey(key)
    const id = String(body?.transaction ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 'success' }
    const a = await this.prisma.tcarAction.findFirst({ where: { id, tenantId } })
    if (!a || a.status === 'OK' || a.status === 'ERRO') return { status: 'success' }
    const code = Number(body?.result_code) || 0
    if (code !== 200) {
      const msg = String((body?.data as { message?: unknown } | undefined)?.message ?? '').slice(0, 300)
      const error = `A Tcar respondeu ${code || 'sem código'} à consulta de produtos${msg ? `: ${msg}` : ''}.`
      // Produto inexistente (busca de uma peça) não é falha da integração.
      if (a.kind === 'live' && code === 404) await this.prisma.tcarAction.update({ where: { id }, data: { status: 'ERRO', resultCode: code, error: 'Produto não encontrado na Tcar.', doneAt: new Date() } })
      else if (a.attempts < 3 && code >= 500) await this.prisma.tcarAction.update({ where: { id }, data: { status: 'PENDENTE', resultCode: code, error } })
      else await this.giveUp(tenantId, a, error)
      return { status: 'success' }
    }
    const { rows, total } = rowsOf(body?.data)
    const now = new Date()
    const seenAt = a.kind === 'full' && a.runAt ? a.runAt : now
    let saved = 0
    for (const row of rows.slice(0, 1000)) {
      const p = productFrom(row, s.usedInField)
      if (!p) continue
      const data = { ...p, branches: p.branches as unknown as Prisma.InputJsonValue, seenAt, stockAt: now }
      await this.prisma.tcarProduct.upsert({ where: { tenantId_code: { tenantId, code: p.code } }, create: { tenantId, ...data }, update: data })
      saved++
    }
    await this.prisma.tcarAction.update({ where: { id }, data: { status: 'OK', resultCode: 200, doneAt: now, error: null } })
    if (a.kind === 'full') {
      const more = rows.length >= PAGE_SIZE && (total === null || a.offset + rows.length < total)
      if (more) {
        await this.prisma.tcarAction.create({ data: { tenantId, kind: 'full', ...this.q(productQuery({ offset: a.offset + PAGE_SIZE, branchIds: s.branchIds })), runAt: a.runAt, offset: a.offset + PAGE_SIZE } })
      } else {
        await this.finishFull(tenantId, a.runAt ?? now, a.offset + rows.length)
      }
    }
    return { status: 'success', saved }
  }

  /** Fim da cópia completa: tira da busca o que sumiu da Tcar (com proteção contra resposta incompleta). */
  private async finishFull(tenantId: string, runAt: Date, copied: number) {
    const before = await this.prisma.tcarProduct.count({ where: { tenantId } })
    const stale = await this.prisma.tcarProduct.count({ where: { tenantId, seenAt: { lt: runAt } } })
    if (copied > 0 && (before < 50 || copied >= (before - stale) * 0.5) && stale < before * 0.5) {
      await this.prisma.tcarProduct.deleteMany({ where: { tenantId, seenAt: { lt: runAt } } })
    } else if (stale) {
      await this.fail(tenantId, `A cópia completa trouxe ${copied} produtos e ${stale} ficaram de fora; para não apagar por engano, os antigos foram mantidos.`)
    }
    await this.saveState(tenantId, { fullRunning: false, lastFullAt: runAt.toISOString(), lastIncrementalAt: runAt.toISOString(), products: await this.prisma.tcarProduct.count({ where: { tenantId } }), lastError: null })
  }

  // ---------- Consulta da equipe ----------

  private assertView(user: AuthUser) {
    if (!can(user.permissions, user.role.isSystem, 'consulta_produtos', 'view')) throw new ForbiddenException('Você não tem permissão para consultar produtos.')
  }

  async search(user: AuthUser, q: { term?: string; field?: SearchField; inStock?: boolean; page?: number }) {
    this.assertView(user)
    const T = user.tenantId
    const term = (q.term ?? '').trim().slice(0, 100)
    const field: SearchField = q.field ?? 'tudo'
    const like = `%${fold(term).replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const raw = term.replace(/[\\%_]/g, (c) => `\\${c}`)
    const parts: Prisma.Sql[] = [Prisma.sql`p."tenantId" = ${T}::uuid`]
    if (term) {
      if (field === 'tudo') for (const t of fold(term).split(/\s+/).filter(Boolean).slice(0, 8)) parts.push(Prisma.sql`p."searchText" LIKE ${`%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`)
      if (field === 'sku') parts.push(Prisma.sql`p.code ILIKE ${`%${raw}%`}`)
      if (field === 'fabrica') parts.push(Prisma.sql`p."factoryCode" ILIKE ${`%${raw}%`}`)
      if (field === 'integracao') parts.push(Prisma.sql`p."integrationCode" ILIKE ${`%${raw}%`}`)
      if (field === 'referencia') parts.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(p.refs) r WHERE r ILIKE ${`%${raw}%`})`)
      if (field === 'titulo') parts.push(Prisma.sql`p."searchText" LIKE ${like} AND p.name ILIKE ${`%${raw}%`}`)
      if (field === 'utilizado') parts.push(Prisma.sql`p."usedIn" ILIKE ${`%${raw}%`}`)
    }
    if (q.inStock) parts.push(Prisma.sql`p.stock > 0`)
    const where = Prisma.join(parts, ' AND ')
    const page = Math.max(1, q.page ?? 1)
    const size = 50
    // Código igual ao digitado (SKU, fábrica, integração ou referência) aparece primeiro.
    const exact = term ? Prisma.sql`(lower(p.code) = lower(${term}) OR lower(p."factoryCode") = lower(${term}) OR lower(p."integrationCode") = lower(${term}) OR lower(${term}) = ANY(SELECT lower(r) FROM unnest(p.refs) r)) DESC,` : Prisma.empty
    const [rows, count, st, s] = await Promise.all([
      this.prisma.$queryRaw<(Record<string, unknown> & { stock: string | null; price: string | null; resalePrice: string | null })[]>`
        SELECT p.id, p.code, p.name, p.ean, p."factoryCode", p."integrationCode", p.refs, p.brand, p."groupName", p."subgroupName", p.application, p."usedIn", p.unit,
          p.stock::text AS stock, p.price::text AS price, p."resalePrice"::text AS "resalePrice", p.branches, p."stockAt"
        FROM tcar_products p WHERE ${where}
        ORDER BY ${exact} (p.stock > 0) DESC NULLS LAST, p.name ASC
        LIMIT ${size} OFFSET ${(page - 1) * size}`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM tcar_products p WHERE ${where}`,
      this.state(T),
      this.config(T),
    ])
    const n = (v: string | null) => (v === null ? null : Number(v))
    return {
      total: count[0]?.n ?? 0,
      page,
      pageSize: size,
      sync: { enabled: s.enabled, lastPingAt: st.lastPingAt, online: s.enabled && !!st.lastPingAt && Date.now() - Date.parse(st.lastPingAt) < OFFLINE_AFTER_MS, lastFullAt: st.lastFullAt, products: st.products, usedInConfigured: !!s.usedInField },
      items: rows.map((r) => ({ ...r, stock: n(r.stock), price: n(r.price), resalePrice: n(r.resalePrice) })),
    }
  }

  /** "Atualizar estoque agora": pede a peça à Tcar no próximo contato (alguns segundos). */
  async refreshOne(user: AuthUser, code: string) {
    this.assertView(user)
    const s = await this.config(user.tenantId)
    if (!s.enabled) throw new BadRequestException('A integração com a Tcar está desligada.')
    const p = await this.prisma.tcarProduct.findFirst({ where: { tenantId: user.tenantId, code }, select: { code: true } })
    if (!p) throw new NotFoundException('Produto não encontrado.')
    const open = await this.prisma.tcarAction.findFirst({ where: { tenantId: user.tenantId, kind: 'live', cmd: detailQuery(p.code, []).cmd, status: { in: ['PENDENTE', 'ENVIADA'] } } })
    if (open) return { actionId: open.id }
    const q = detailQuery(p.code, s.branchIds)
    const a = await this.prisma.tcarAction.create({ data: { tenantId: user.tenantId, kind: 'live', cmd: q.cmd, query: q.query_params as Prisma.InputJsonValue } })
    return { actionId: a.id }
  }

  /**
   * Busca na tela: pede à Tcar o estoque e o preço atuais das primeiras peças do resultado (as atualizadas há menos de
   * 2 minutos ficam como estão). Sem contato recente da Tcar, não pede nada: a tela mostra a última cópia.
   */
  async refreshMany(user: AuthUser, codes: string[]) {
    this.assertView(user)
    const T = user.tenantId
    const [s, st] = await Promise.all([this.config(T), this.state(T)])
    const online = s.enabled && !!st.lastPingAt && Date.now() - Date.parse(st.lastPingAt) < OFFLINE_AFTER_MS
    if (!online) return { online: false, pending: [] as { code: string; actionId: string }[] }
    const wanted = [...new Set(codes.map((c) => String(c).slice(0, 60)))].slice(0, AUTO_REFRESH_TOP)
    const products = await this.prisma.tcarProduct.findMany({ where: { tenantId: T, code: { in: wanted } }, select: { code: true, stockAt: true } })
    const cmds = products.map((p) => detailQuery(p.code, []).cmd)
    const open = new Map((await this.prisma.tcarAction.findMany({ where: { tenantId: T, kind: 'live', cmd: { in: cmds }, status: { in: ['PENDENTE', 'ENVIADA'] } }, select: { id: true, cmd: true } })).map((a) => [a.cmd, a.id]))
    const pending: { code: string; actionId: string }[] = []
    for (const p of products) {
      const q = detailQuery(p.code, s.branchIds)
      const already = open.get(q.cmd)
      if (already) pending.push({ code: p.code, actionId: already })
      else if (Date.now() - p.stockAt.getTime() >= AUTO_REFRESH_MIN_AGE_MS) {
        const a = await this.prisma.tcarAction.create({ data: { tenantId: T, kind: 'live', cmd: q.cmd, query: q.query_params as Prisma.InputJsonValue } })
        pending.push({ code: p.code, actionId: a.id })
      }
    }
    return { online: true, pending }
  }

  /** Andamento de várias consultas da tela de uma vez. */
  async actionsStatus(user: AuthUser, ids: string[]) {
    this.assertView(user)
    const rows = await this.prisma.tcarAction.findMany({ where: { id: { in: ids.slice(0, 50) }, tenantId: user.tenantId, kind: 'live' }, select: { id: true, status: true, error: true } })
    return rows
  }

  async actionStatus(user: AuthUser, id: string) {
    this.assertView(user)
    const a = await this.prisma.tcarAction.findFirst({ where: { id, tenantId: user.tenantId, kind: 'live' }, select: { status: true, error: true, cmd: true } })
    if (!a) throw new NotFoundException()
    return { status: a.status, error: a.error }
  }

  // ---------- Configuração (administrador) ----------

  private assertAdmin(user: AuthUser, action: 'view' | 'edit') {
    if (!can(user.permissions, user.role.isSystem, 'configuracoes', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  async view(user: AuthUser) {
    this.assertAdmin(user, 'view')
    const [s, st, pending] = await Promise.all([this.config(user.tenantId), this.state(user.tenantId), this.prisma.tcarAction.count({ where: { tenantId: user.tenantId, status: { in: ['PENDENTE', 'ENVIADA'] } } })])
    const { keyHash, ...rest } = s
    return {
      ...rest,
      hasKey: !!keyHash,
      urls: { ping: `${env.appUrl}/api/webhooks/tcar/ping`, report: `${env.appUrl}/api/webhooks/tcar/report` },
      state: { ...st, pendingActions: pending },
    }
  }

  async save(user: AuthUser, d: { enabled: boolean; branchIds?: number[]; usedInField?: string; fullEveryHours?: number; incrementalMinutes?: number; resetIdentity?: boolean }, ctx: RequestCtx) {
    this.assertAdmin(user, 'edit')
    const cur = await this.config(user.tenantId)
    const field = (d.usedInField ?? cur.usedInField).trim().toLowerCase()
    if (field && !/^[a-z0-9_]{2,60}$/.test(field)) throw new BadRequestException('Nome de campo inválido: use o nome que aparece na resposta da Tcar (letras, números e _).')
    if (d.enabled && !cur.keyHash) throw new BadRequestException('Gere a chave da integração antes de ligar.')
    const next: TcarSettings = {
      ...cur,
      enabled: d.enabled,
      branchIds: [...new Set((d.branchIds ?? cur.branchIds).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20),
      usedInField: field,
      fullEveryHours: Math.min(48, Math.max(1, d.fullEveryHours ?? cur.fullEveryHours)),
      incrementalMinutes: Math.min(240, Math.max(2, d.incrementalMinutes ?? cur.incrementalMinutes)),
      ...(d.resetIdentity ? { companyId: null, branchId: null } : {}),
    }
    await this.settings.set(user.tenantId, KEY, next)
    await this.audit.byUser(user, ctx, 'settings.tcar_updated', 'settings', KEY, { ativo: next.enabled, filiais: next.branchIds, campoUtilizadoEm: next.usedInField || null })
    return this.view(user)
  }

  /** Nova chave da integração: mostrada uma vez só (para colar no tcarwebserver.ini); a anterior deixa de valer. */
  async newKey(user: AuthUser, ctx: RequestCtx) {
    this.assertAdmin(user, 'edit')
    const key = `tcar_${randomToken(30)}`
    const cur = await this.config(user.tenantId)
    await this.settings.set(user.tenantId, KEY, { ...cur, keyHash: sha256(key) })
    await this.audit.byUser(user, ctx, 'settings.tcar_key_generated', 'settings', KEY)
    return { key }
  }

  /** Copiar tudo de novo no próximo contato (ex.: depois de configurar as filiais ou o "utilizado em"). */
  async fullNow(user: AuthUser, ctx: RequestCtx) {
    this.assertAdmin(user, 'edit')
    await this.prisma.tcarAction.updateMany({ where: { tenantId: user.tenantId, kind: { in: ['full', 'incremental'] }, status: { in: ['PENDENTE', 'ENVIADA'] } }, data: { status: 'ERRO', error: 'Substituída por uma nova cópia completa.', doneAt: new Date() } })
    await this.saveState(user.tenantId, { lastFullAt: null, fullRunning: false })
    await this.audit.byUser(user, ctx, 'settings.tcar_full_sync', 'settings', KEY)
    return { ok: true }
  }
}
