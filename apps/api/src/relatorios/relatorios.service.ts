import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt, sha256 } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { type Action, can, type Scope } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { buildQuery, catalog, cleanConfig, type Filter, type ReportConfig, resolvePeriod, type ResultRow, type ScopeCtx, fillTime, shapeRows, SOURCE_BY_KEY, TIME_LIMIT, todaySP } from './fontes'
import { cleanPropertyId, DEFAULT_GA4, GA_API, GA_TOKEN_URL, gaBody, gaError, type GaReport, type GaRequest, gaRows, type Ga4Settings, parseKeyFile, signJwt } from './ga4'

type Exec = (sql: Prisma.Sql) => Promise<Record<string, unknown>[]>

export interface SavedInput {
  name: string
  description?: string | null
  config: unknown
  visibility: 'privado' | 'equipe'
  pinned: boolean
  width: 1 | 2
}

const GA_CACHE_MS = 15 * 60_000
/** Campos de campanha que podem vir como número do Google Ads (mostrados com o nome da campanha). */
const CAMPAIGN_DIMS = new Set(['campanha', 'lead_campanha', 'lead_campanha_ultima', 'lead_campanha_numero'])

@Injectable()
export class RelatoriosService {
  private readonly logger = new Logger(RelatoriosService.name)
  private readonly gaTokens = new Map<string, { token: Promise<string>; until: number }>()
  private readonly gaCache = new Map<string, { at: number; data: unknown }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'relatorios', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  scopeOf(user: AuthUser): Scope {
    return user.role.isSystem ? 'ALL' : (user.permissions.relatorios?.scope ?? 'ALL')
  }

  private ctx(user: AuthUser): ScopeCtx {
    return { tenantId: user.tenantId, scope: this.scopeOf(user), userId: user.id, unitId: user.unitId ?? null }
  }

  /** Consultas só de leitura, com tempo máximo: um relatório pesado não trava o banco. */
  private readOnly<T>(fn: (exec: Exec) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '20s'`)
        return fn((sql) => tx.$queryRaw<Record<string, unknown>[]>(sql))
      },
      { timeout: 90_000, maxWait: 15_000 },
    )
  }

  private async campaignNames(tenantId: string): Promise<Record<string, string> | null> {
    const s = await this.settings.get<{ campaigns?: Record<string, string> }>(tenantId, 'google_ads', {})
    return s.campaigns && Object.keys(s.campaigns).length ? s.campaigns : null
  }

  catalog(user: AuthUser) {
    this.assertCan(user, 'view')
    return { scope: this.scopeOf(user), sources: catalog(this.scopeOf(user)) }
  }

  private clean(user: AuthUser, raw: unknown): ReportConfig {
    const r = cleanConfig(raw)
    if ('error' in r) throw new BadRequestException(r.error)
    const source = SOURCE_BY_KEY.get(r.config.source)!
    if (source.scopedBy === 'none' && this.scopeOf(user) !== 'ALL') throw new ForbiddenException('Seu perfil vê só parte dos dados; os dados do site são da empresa toda.')
    return r.config
  }

  private async execute(exec: Exec, user: AuthUser, config: ReportConfig) {
    const ctx = this.ctx(user)
    const period = resolvePeriod(config.period, todaySP())
    const grouped = config.dimensions.length > 0
    const main = buildQuery(config, ctx, period, true)
    const time = main.dims[0]?.time ? main.dims[0].key : null
    let rows = grouped ? shapeRows(await exec(main.sql), config.dimensions.length, config.metrics.length, time ? TIME_LIMIT : config.limit) : []
    if (time && config.dimensions.length === 1) rows = fillTime(rows, time, main.metrics, period.from, period.to)
    const totals = shapeRows(await exec(buildQuery(config, ctx, period, false).sql), 0, config.metrics.length, 1)[0]?.values ?? []
    const previous = config.compare ? (shapeRows(await exec(buildQuery(config, ctx, period.previous, false).sql), 0, config.metrics.length, 1)[0]?.values ?? null) : null
    return {
      config,
      period,
      // Campanha que veio só como número: mostra o nome (lista número → nome do Google Ads). O filtro continua pelo valor guardado.
      dimensions: await Promise.all(
        main.dims.map(async (d) => ({
          key: d.key,
          label: d.label,
          labels: CAMPAIGN_DIMS.has(d.key) ? await this.campaignNames(user.tenantId) : (d.labels ?? null),
          time: !!d.time,
          list: !!d.array,
        })),
      ),
      metrics: main.metrics.map((m) => ({ key: m.key, label: m.label, format: m.format })),
      rows,
      totals,
      previousTotals: previous,
    }
  }

  run(user: AuthUser, raw: unknown) {
    this.assertCan(user, 'view')
    const config = this.clean(user, raw)
    return this.readOnly((exec) => this.execute(exec, user, config))
  }

  /** Valores existentes de um campo (para montar os filtros), do último ano. */
  async values(user: AuthUser, sourceKey: string, field: string) {
    this.assertCan(user, 'view')
    const source = SOURCE_BY_KEY.get(sourceKey)
    const dim = source?.dimensions.find((d) => d.key === field)
    if (!source || !dim || dim.time) throw new BadRequestException('Campo inválido.')
    const config = this.clean(user, { source: source.key, dimensions: [field], metrics: [source.metrics[0]!.key], period: { preset: '12m' }, limit: 500, chart: 'tabela', compare: false })
    const r = await this.readOnly((exec) => this.execute(exec, user, config))
    return r.rows.map((row) => ({ value: row.dims[0] ?? null, label: row.dims[0] === null ? 'Não informado' : (r.dimensions[0]?.labels?.[row.dims[0]!] ?? dim.labels?.[row.dims[0]!] ?? row.dims[0]), count: row.values[0] ?? 0 }))
  }

  async exportCsv(user: AuthUser, raw: unknown, ctx: RequestCtx) {
    this.assertCan(user, 'export')
    const config = this.clean(user, { ...(raw as object), limit: 500 })
    const r = await this.readOnly((exec) => this.execute(exec, user, config))
    await this.audit.byUser(user, ctx, 'report.exported', 'report', undefined, { fonte: config.source, linhas: r.rows.length, de: r.period.from, ate: r.period.to })
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
      return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
    }
    const num = (v: number | null, format: string) => (v === null ? '' : format === 'pct' ? (v * 100).toFixed(1).replace('.', ',') + '%' : format === 'int' ? String(Math.round(v)) : v.toFixed(2).replace('.', ','))
    const header = [...r.dimensions.map((d) => d.label), ...r.metrics.map((m) => m.label)]
    const label = (i: number, v: string | null) => (v === null ? 'Não informado' : (r.dimensions[i]!.labels?.[v] ?? v))
    const lines = (config.dimensions.length ? r.rows : [{ dims: [], values: r.totals }] as ResultRow[]).map((row) =>
      [...row.dims.map((v, i) => label(i, v)), ...row.values.map((v, i) => num(v, r.metrics[i]!.format))].map(cell).join(';'),
    )
    return { filename: `relatorio-${config.source}-${r.period.from}-a-${r.period.to}.csv`, content: '﻿' + [header.map(cell).join(';'), ...lines].join('\r\n') }
  }

  // ---------- Painel geral (visão de marketing) ----------

  async overview(user: AuthUser, from: string, to: string) {
    this.assertCan(user, 'view')
    if (this.scopeOf(user) !== 'ALL') throw new ForbiddenException('A visão geral mostra números da empresa toda; seu perfil vê só parte dos dados. Use o criador de relatórios.')
    const period = resolvePeriod({ preset: 'personalizado', from, to }, todaySP())
    if (period.days < 1 || period.days > 1100) throw new BadRequestException('Período inválido (máximo de 3 anos).')
    const grain = period.days <= 62 ? 'dia' : period.days <= 400 ? 'semana' : 'mes'
    const base = (source: string, metrics: string[], extra: Partial<ReportConfig> = {}): ReportConfig => ({
      source,
      dimensions: [],
      metrics,
      filters: [],
      period: { preset: 'personalizado', from, to },
      chart: 'tabela',
      limit: 10,
      compare: true,
      ...extra,
    })
    const novos: Filter[] = [{ field: 'entrada', op: 'diferente', values: ['importado'] }]
    const pre: Filter[] = [{ field: 'tipo', op: 'igual', values: ['PRE_VENDAS'] }]

    return this.readOnly(async (exec) => {
      const run = (c: ReportConfig) => this.execute(exec, user, c)
      const by = (source: string, dim: string, metrics: string[], filters: Filter[] = [], limit = 10) => run(base(source, metrics, { dimensions: [dim], filters, limit, compare: false }))

      const [visits, conversions, leads, orders, carts, emails, records] = [
        await run(base('visitas', ['visitas', 'visitantes'])),
        await run(base('conversoes', ['conversoes'])),
        await run(base('leads', ['leads'], { filters: novos })),
        await run(base('pedidos', ['pedidos_pagos', 'receita', 'ticket', 'clientes'])),
        await run(base('carrinhos', ['abandonados', 'valor_abandonado'])),
        await run(base('emails', ['enviados', 'taxa_abertura', 'taxa_clique'])),
        await run(base('atendimentos', ['atendimentos', 'vendas', 'valor_vendido'], { filters: pre })),
      ]
      const kpi = (r: Awaited<ReturnType<typeof run>>, i: number) => ({ value: r.totals[i] ?? null, previous: r.previousTotals?.[i] ?? null })

      const timeline = new Map<string, Record<string, number | string>>()
      const addSeries = (r: Awaited<ReturnType<typeof run>>, name: string) => {
        for (const row of r.rows) {
          const b = row.dims[0]!
          timeline.set(b, { ...(timeline.get(b) ?? { bucket: b }), [name]: row.values[0] ?? 0 })
        }
      }
      addSeries(await by('visitas', grain, ['visitas'], [], 2000), 'visits')
      addSeries(await by('leads', grain, ['leads'], novos, 2000), 'leads')
      addSeries(await by('pedidos', grain, ['receita'], [], 2000), 'revenue')
      addSeries(await by('atendimentos', grain, ['valor_vendido'], pre, 2000), 'salesValue')

      const firstBuyers = await run(base('pedidos', ['clientes'], { filters: [{ field: 'compra', op: 'igual', values: ['Primeira compra'] }, { field: 'situacao', op: 'igual', values: ['pago'] }] }))
      const list = (r: Awaited<ReturnType<typeof run>>) => r.rows.map((row) => ({ name: row.dims[0] === null ? null : (r.dimensions[0]!.labels?.[row.dims[0]!] ?? row.dims[0]), values: row.values }))

      return {
        period,
        granularity: grain,
        kpis: {
          visits: kpi(visits, 0),
          visitors: kpi(visits, 1),
          conversions: kpi(conversions, 0),
          leads: kpi(leads, 0),
          orders: kpi(orders, 0),
          revenue: kpi(orders, 1),
          ticket: kpi(orders, 2),
          abandoned: kpi(carts, 0),
          abandonedValue: kpi(carts, 1),
          emailsSent: kpi(emails, 0),
          openRate: kpi(emails, 1),
          clickRate: kpi(emails, 2),
          records: kpi(records, 0),
          recordSales: kpi(records, 1),
          recordRevenue: kpi(records, 2),
        },
        funnel: [
          { key: 'visitantes', label: 'Visitantes do site', value: visits.totals[1] ?? 0 },
          { key: 'conversoes', label: 'Conversões (formulários, pop-ups, WhatsApp)', value: conversions.totals[0] ?? 0 },
          { key: 'leads', label: 'Leads novos', value: leads.totals[0] ?? 0 },
          { key: 'clientes', label: 'Clientes de primeira compra (loja)', value: firstBuyers.totals[0] ?? 0 },
        ],
        timeline: [...timeline.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))),
        visitsBySource: list(await by('visitas', 'fonte_meio', ['visitas'])),
        leadsBySource: list(await by('leads', 'fonte', ['leads'], novos)),
        revenueBySource: list(await by('pedidos', 'lead_fonte', ['receita', 'pedidos_pagos'], [{ field: 'situacao', op: 'igual', values: ['pago'] }])),
        conversionsByCapture: list(await by('conversoes', 'captura', ['conversoes'])),
        landingPages: list(await by('visitas', 'pagina_entrada', ['visitas'])),
        devices: list(await by('visitas', 'dispositivo', ['visitas'])),
        campaigns: list(await by('emails', 'campanha', ['enviados', 'taxa_abertura', 'taxa_clique'], [{ field: 'tipo', op: 'igual', values: ['CAMPANHA'] }], 8)),
        recordsByOrigin: list(await by('atendimentos', 'origem', ['atendimentos', 'vendas'], pre)),
      }
    })
  }

  // ---------- Relatórios salvos e painel ----------

  private visibleWhere(user: AuthUser): Prisma.SavedReportWhereInput {
    return { tenantId: user.tenantId, OR: [{ visibility: 'equipe' }, { createdById: user.id }] }
  }

  private async names(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))]
    const users = list.length ? await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : []
    return new Map(users.map((u) => [u.id, u.name]))
  }

  async listSaved(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.savedReport.findMany({ where: this.visibleWhere(user), orderBy: [{ pinned: 'desc' }, { position: 'asc' }, { name: 'asc' }] })
    const names = await this.names(rows.map((r) => r.createdById))
    return rows.map((r) => ({ ...r, createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null, mine: r.createdById === user.id }))
  }

  async getSaved(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const r = await this.prisma.savedReport.findFirst({ where: { id, ...this.visibleWhere(user) } })
    if (!r) throw new NotFoundException('Relatório não encontrado.')
    const names = await this.names([r.createdById])
    return { ...r, createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null, mine: r.createdById === user.id }
  }

  /** Relatório da equipe pode ser alterado por quem tem permissão; o privado, só por quem criou. */
  private async editable(user: AuthUser, id: string, action: Action) {
    this.assertCan(user, action)
    const r = await this.prisma.savedReport.findFirst({ where: { id, ...this.visibleWhere(user) } })
    if (!r) throw new NotFoundException('Relatório não encontrado.')
    if (r.visibility === 'privado' && r.createdById !== user.id) throw new ForbiddenException('Só quem criou pode alterar este relatório.')
    return r
  }

  private data(user: AuthUser, input: SavedInput) {
    const name = input.name.trim()
    if (name.length < 2) throw new BadRequestException('Dê um nome ao relatório.')
    return {
      name,
      description: input.description?.trim() || null,
      config: this.clean(user, input.config) as unknown as Prisma.InputJsonValue,
      visibility: input.visibility,
      pinned: input.pinned,
      width: input.width === 2 ? 2 : 1,
    }
  }

  async create(user: AuthUser, input: SavedInput, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const data = this.data(user, input)
    const last = await this.prisma.savedReport.aggregate({ where: { tenantId: user.tenantId }, _max: { position: true } })
    const r = await this.prisma.savedReport.create({ data: { ...data, tenantId: user.tenantId, createdById: user.id, position: (last._max.position ?? 0) + 1 } })
    await this.audit.byUser(user, ctx, 'report.created', 'report', r.id, { nome: r.name, visibilidade: r.visibility })
    return this.getSaved(user, r.id)
  }

  async update(user: AuthUser, id: string, input: SavedInput, ctx: RequestCtx) {
    const current = await this.editable(user, id, 'edit')
    const data = this.data(user, input)
    // Só quem criou pode transformar um relatório da equipe em privado.
    if (data.visibility === 'privado' && current.createdById !== user.id) throw new ForbiddenException('Só quem criou pode tornar o relatório privado.')
    await this.prisma.savedReport.update({ where: { id }, data })
    await this.audit.byUser(user, ctx, 'report.updated', 'report', id, { nome: data.name, visibilidade: data.visibility })
    return this.getSaved(user, id)
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    const r = await this.editable(user, id, 'delete')
    await this.prisma.savedReport.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'report.deleted', 'report', id, { nome: r.name })
    return { ok: true }
  }

  async duplicate(user: AuthUser, id: string, ctx: RequestCtx) {
    const r = await this.getSaved(user, id)
    return this.create(user, { name: `${r.name} (cópia)`.slice(0, 120), description: r.description, config: r.config, visibility: 'privado', pinned: false, width: r.width === 2 ? 2 : 1 }, ctx)
  }

  /** Painel: fixar/desafixar, largura e ordem dos relatórios fixados. */
  async arrange(user: AuthUser, id: string, change: { pinned?: boolean; width?: 1 | 2; move?: 'up' | 'down' }) {
    await this.editable(user, id, 'edit')
    if (change.pinned !== undefined || change.width !== undefined) {
      await this.prisma.savedReport.update({ where: { id }, data: { ...(change.pinned !== undefined ? { pinned: change.pinned } : {}), ...(change.width ? { width: change.width } : {}) } })
    }
    if (change.move) {
      const pinned = await this.prisma.savedReport.findMany({ where: { ...this.visibleWhere(user), pinned: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true } })
      const i = pinned.findIndex((p) => p.id === id)
      const j = change.move === 'up' ? i - 1 : i + 1
      if (i >= 0 && j >= 0 && j < pinned.length) {
        ;[pinned[i], pinned[j]] = [pinned[j]!, pinned[i]!]
        for (const [pos, p] of pinned.entries()) await this.prisma.savedReport.update({ where: { id: p.id }, data: { position: pos + 1 } })
      }
    }
    return { ok: true }
  }

  async runSaved(user: AuthUser, id: string) {
    const r = await this.getSaved(user, id)
    return this.run(user, r.config)
  }

  // ---------- Google Analytics 4 ----------

  ga4Config(tenantId: string) {
    return this.settings.get<Ga4Settings>(tenantId, 'ga4', DEFAULT_GA4)
  }

  ga4View(s: Ga4Settings) {
    const { privateKeyEnc, ...rest } = s
    return { ...rest, hasKey: !!privateKeyEnc }
  }

  async saveGa4(user: AuthUser, input: { enabled: boolean; propertyId: string; keyFile?: string }, ctx: RequestCtx) {
    const current = await this.ga4Config(user.tenantId)
    const propertyId = input.propertyId.trim() ? cleanPropertyId(input.propertyId) : ''
    if (propertyId === null) throw new BadRequestException('ID da propriedade inválido: use só os números (ex.: 123456789).')
    let clientEmail = current.clientEmail
    let privateKeyEnc = current.privateKeyEnc
    if (input.keyFile?.trim()) {
      const key = parseKeyFile(input.keyFile)
      if ('error' in key) throw new BadRequestException(key.error)
      clientEmail = key.clientEmail
      privateKeyEnc = encrypt(key.privateKey)
    }
    const next: Ga4Settings = { enabled: input.enabled, propertyId, clientEmail, privateKeyEnc, updatedAt: new Date().toISOString() }
    if (next.enabled && (!next.propertyId || !next.privateKeyEnc)) throw new BadRequestException('Para ligar, informe o ID da propriedade e o arquivo de chave da conta de serviço.')
    await this.settings.set(user.tenantId, 'ga4', next)
    this.clearGaCache(user.tenantId)
    await this.audit.byUser(user, ctx, 'settings.ga4_updated', 'settings', 'ga4', { ativo: next.enabled, propriedade: next.propertyId, contaDeServico: next.clientEmail, chaveAlterada: !!input.keyFile?.trim() })
    return this.ga4View(next)
  }

  private clearGaCache(tenantId: string) {
    for (const k of this.gaCache.keys()) if (k.startsWith(`${tenantId}:`)) this.gaCache.delete(k)
    for (const k of this.gaTokens.keys()) if (k.startsWith(`${tenantId}:`)) this.gaTokens.delete(k)
  }

  /** Token de acesso (1 hora). Pedidos ao mesmo tempo esperam o mesmo token, em vez de pedir um cada. */
  private gaToken(tenantId: string, s: Ga4Settings): Promise<string> {
    const key = `${tenantId}:${sha256(s.clientEmail + (s.privateKeyEnc ?? ''))}`
    const cached = this.gaTokens.get(key)
    if (cached && cached.until > Date.now()) return cached.token
    const token = this.fetchGaToken(s).then(
      (r) => {
        this.gaTokens.set(key, { token: Promise.resolve(r.token), until: Date.now() + (r.expiresIn - 300) * 1000 })
        return r.token
      },
      (err: unknown) => {
        this.gaTokens.delete(key)
        throw err
      },
    )
    this.gaTokens.set(key, { token, until: Date.now() + 60_000 })
    return token
  }

  private async fetchGaToken(s: Ga4Settings) {
    const assertion = signJwt(s.clientEmail, decrypt(s.privateKeyEnc!))
    const res = await fetch(GA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    })
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
    if (!res.ok || !body?.access_token) throw new BadRequestException(gaError(res.status, body, s.clientEmail))
    return { token: body.access_token, expiresIn: body.expires_in ?? 3600 }
  }

  private async gaBatch(tenantId: string, s: Ga4Settings, requests: object[]) {
    const token = await this.gaToken(tenantId, s)
    const res = await fetch(`${GA_API}/properties/${s.propertyId}:batchRunReports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    const body = (await res.json().catch(() => null)) as { reports?: GaReport[] } | null
    if (!res.ok) {
      this.logger.warn(`GA4 respondeu ${res.status} para a empresa ${tenantId}`)
      throw new BadRequestException(gaError(res.status, body, s.clientEmail))
    }
    return body?.reports ?? []
  }

  async testGa4(user: AuthUser) {
    const s = await this.ga4Config(user.tenantId)
    if (!s.propertyId || !s.privateKeyEnc) return { ok: false, message: 'Salve o ID da propriedade e o arquivo de chave antes de testar.' }
    try {
      const today = todaySP()
      const [r] = await this.gaBatch(user.tenantId, s, [gaBody({ from: resolvePeriod({ preset: '7' }, today).from, to: today }, { metrics: ['sessions'] })])
      const sessions = gaRows(r ?? {})[0]?.sessions ?? 0
      return { ok: true, message: `Conectado. ${Number(sessions).toLocaleString('pt-BR')} sessões nos últimos 7 dias.` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Falha ao consultar o Google Analytics.' }
    }
  }

  async ga4Report(user: AuthUser, from: string, to: string, refresh = false) {
    this.assertCan(user, 'view')
    if (this.scopeOf(user) !== 'ALL') throw new ForbiddenException('Os dados do Google Analytics são da empresa toda; seu perfil vê só parte dos dados.')
    const s = await this.ga4Config(user.tenantId)
    if (!s.enabled || !s.propertyId || !s.privateKeyEnc) return { configured: false as const }
    const period = resolvePeriod({ preset: 'personalizado', from, to }, todaySP())
    if (period.days < 1 || period.days > 1100) throw new BadRequestException('Período inválido (máximo de 3 anos).')
    const cacheKey = `${user.tenantId}:${from}:${to}`
    const hit = this.gaCache.get(cacheKey)
    if (!refresh && hit && Date.now() - hit.at < GA_CACHE_MS) return hit.data

    const range = { from: period.from, to: period.to }
    const totalsMetrics = ['activeUsers', 'newUsers', 'sessions', 'engagementRate', 'averageSessionDuration', 'screenPageViews', 'keyEvents', 'ecommercePurchases', 'purchaseRevenue']
    const req = (r: GaRequest, prev = false) => gaBody(range, r, prev ? period.previous : undefined)
    const [first, second] = await Promise.all([
      this.gaBatch(user.tenantId, s, [
        req({ metrics: totalsMetrics }, true),
        req({ dimensions: ['date'], metrics: ['sessions', 'activeUsers', 'keyEvents', 'purchaseRevenue'], orderBy: { dimension: 'date' }, limit: 1100 }),
        req({ dimensions: ['sessionDefaultChannelGroup'], metrics: ['sessions', 'activeUsers', 'keyEvents', 'purchaseRevenue'], orderBy: { metric: 'sessions' }, limit: 15 }),
        req({ dimensions: ['sessionSourceMedium'], metrics: ['sessions', 'keyEvents', 'purchaseRevenue'], orderBy: { metric: 'sessions' }, limit: 15 }),
        req({ dimensions: ['pagePath'], metrics: ['screenPageViews', 'activeUsers'], orderBy: { metric: 'screenPageViews' }, limit: 15 }),
      ]),
      this.gaBatch(user.tenantId, s, [
        req({ dimensions: ['deviceCategory'], metrics: ['sessions', 'purchaseRevenue'], orderBy: { metric: 'sessions' }, limit: 5 }),
        req({ dimensions: ['landingPage'], metrics: ['sessions', 'keyEvents'], orderBy: { metric: 'sessions' }, limit: 15 }),
        req({ dimensions: ['region'], metrics: ['sessions', 'purchaseRevenue'], orderBy: { metric: 'sessions' }, limit: 15 }),
        req({ dimensions: ['itemName'], metrics: ['itemRevenue', 'itemsPurchased'], orderBy: { metric: 'itemRevenue' }, limit: 15 }),
      ]),
    ])
    // Totais com dois períodos: a dimensão "dateRange" separa o atual (date_range_0) do anterior.
    const totalsRows = gaRows(first[0] ?? {})
    const pick = (range: string) => totalsRows.find((r) => r.dateRange === range) ?? (range === 'date_range_0' && totalsRows.length === 1 ? totalsRows[0] : undefined)
    const now = pick('date_range_0') ?? {}
    const before = pick('date_range_1') ?? {}
    const data = {
      configured: true as const,
      fetchedAt: new Date().toISOString(),
      period,
      totals: Object.fromEntries(totalsMetrics.map((m) => [m, { value: Number(now[m] ?? 0), previous: before[m] === undefined ? null : Number(before[m]) }])),
      daily: gaRows(first[1] ?? {}),
      channels: gaRows(first[2] ?? {}),
      sourceMedium: gaRows(first[3] ?? {}),
      pages: gaRows(first[4] ?? {}),
      devices: gaRows(second[0] ?? {}),
      landingPages: gaRows(second[1] ?? {}),
      regions: gaRows(second[2] ?? {}),
      items: gaRows(second[3] ?? {}),
    }
    for (const [k, v] of this.gaCache) if (Date.now() - v.at >= GA_CACHE_MS) this.gaCache.delete(k)
    this.gaCache.set(cacheKey, { at: Date.now(), data })
    return data
  }
}
