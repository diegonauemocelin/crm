import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt, randomToken, safeEqual, sha256 } from '../common/crypto'
import { env } from '../config/env'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { GA_TOKEN_URL, parseKeyFile, signJwt } from '../relatorios/ga4'
import { SettingsService } from '../settings/settings.service'
import {
  actionFor,
  adsError,
  adsInfoOf,
  campaignLabel,
  campaignsScript,
  cleanCampaignList,
  BATCH_SIZE,
  buildEvent,
  CLICK_WINDOW_DAYS,
  type ClickIds,
  clickIdsFromUrl,
  cleanActionId,
  cleanCustomerId,
  type ConversionKind,
  DEFAULT_GOOGLE_ADS,
  DM_INGEST_URL,
  DM_SCOPE,
  type GoogleAdsSettings,
  ingestBody,
  isGoogleAdsTouch,
  shouldSend,
} from './googleads'

const DAY = 86_400_000
const TICK_MS = 15 * 60_000
const MAX_ATTEMPTS = 5

interface TouchJson {
  source?: string
  medium?: string
  campaign?: string
  landing?: string
  [k: string]: unknown
}

export interface GoogleAdsInput {
  enabled: boolean
  customerId: string
  loginCustomerId?: string
  keyFile?: string
  actions: { contato?: string; negociacao?: string; venda?: string; perda?: string; perdaPorMotivo?: Record<string, string> }
  sendUserData: boolean
  onlyGoogle: boolean
  originIds?: string[]
  campaigns?: Record<string, string>
  startDate?: string | null
}

/**
 * Retorno dos atendimentos para o Google Ads: a cada 15 minutos registra os resultados novos (contato, retorno do
 * vendedor, venda, perda por motivo) de quem veio de anúncio e envia pela Data Manager API. Cada resultado vai uma vez só.
 */
@Injectable()
export class GoogleAdsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GoogleAdsService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly tokens = new Map<string, { token: Promise<string>; until: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
    setTimeout(() => void this.tick(), 90_000).unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  // ---------- Configuração ----------

  config(tenantId: string) {
    return this.settings.get<GoogleAdsSettings>(tenantId, 'google_ads', DEFAULT_GOOGLE_ADS)
  }

  view(s: GoogleAdsSettings) {
    const { privateKeyEnc, campaignsToken, ...rest } = s
    const url = campaignsToken ? `${env.appUrl}/api/webhooks/google-ads/campanhas/${campaignsToken}` : null
    return { ...rest, hasKey: !!privateKeyEnc, campaignsScript: url ? campaignsScript(url) : null }
  }

  /** Configuração com a chave do endereço dos nomes das campanhas (criada na primeira vez). */
  async configWithToken(tenantId: string) {
    const s = await this.config(tenantId)
    if (s.campaignsToken) return s
    const next = { ...s, campaignsToken: randomToken(24) }
    await this.settings.set(tenantId, 'google_ads', next)
    return next
  }

  /** Recebe do script do Google Ads a lista número → nome das campanhas. O nome do Google vale mais que o cadastrado à mão. */
  async receiveCampaigns(token: string, body: unknown) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
    const rows = await this.prisma.tenantSetting.findMany({ where: { key: 'google_ads' }, select: { tenantId: true, value: true } })
    const row = rows.find((r) => {
      const t = (r.value as { campaignsToken?: string } | null)?.campaignsToken
      return typeof t === 'string' && safeEqual(t, token)
    })
    if (!row) return null
    const r = cleanCampaignList(body)
    if ('error' in r) throw new BadRequestException(r.error)
    const s = await this.config(row.tenantId)
    await this.settings.set(row.tenantId, 'google_ads', { ...s, campaigns: { ...s.campaigns, ...r.campaigns }, campaignsSyncedAt: new Date().toISOString() })
    return { ok: true, campanhas: r.count }
  }

  async save(user: AuthUser, input: GoogleAdsInput, ctx: RequestCtx) {
    const current = await this.config(user.tenantId)
    const customerId = input.customerId.trim() ? cleanCustomerId(input.customerId) : ''
    if (customerId === null) throw new BadRequestException('ID da conta do Google Ads inválido: são 10 números (ex.: 123-456-7890).')
    const loginCustomerId = input.loginCustomerId?.trim() ? cleanCustomerId(input.loginCustomerId) : ''
    if (loginCustomerId === null) throw new BadRequestException('ID da conta de administrador (MCC) inválido: são 10 números.')
    let clientEmail = current.clientEmail
    let privateKeyEnc = current.privateKeyEnc
    if (input.keyFile?.trim()) {
      const key = parseKeyFile(input.keyFile)
      if ('error' in key) throw new BadRequestException(key.error)
      clientEmail = key.clientEmail
      privateKeyEnc = encrypt(key.privateKey)
    }
    const motivos = Object.fromEntries(
      Object.entries(input.actions.perdaPorMotivo ?? {})
        .filter(([k]) => /^[0-9a-f-]{36}$/.test(k))
        .map(([k, v]) => [k, cleanActionId(v)])
        .filter(([, v]) => v),
    )
    // Só origens que existem na lista "Origem" do Pré-Vendas desta empresa.
    const wanted = [...new Set((input.originIds ?? []).filter((x) => /^[0-9a-f-]{36}$/.test(x)))].slice(0, 50)
    const originIds = wanted.length ? (await this.prisma.lookupItem.findMany({ where: { tenantId: user.tenantId, type: 'ORIGEM', id: { in: wanted } }, select: { id: true } })).map((o) => o.id) : []
    const startDate = input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : (current.startDate ?? new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10))
    const next: GoogleAdsSettings = {
      campaignsToken: current.campaignsToken,
      campaignsSyncedAt: current.campaignsSyncedAt,
      enabled: input.enabled,
      customerId,
      loginCustomerId,
      clientEmail,
      privateKeyEnc,
      actions: {
        contato: cleanActionId(input.actions.contato).replace('-', ''),
        negociacao: cleanActionId(input.actions.negociacao).replace('-', ''),
        venda: cleanActionId(input.actions.venda).replace('-', ''),
        perda: cleanActionId(input.actions.perda).replace('-', ''),
        perdaPorMotivo: motivos,
      },
      sendUserData: input.sendUserData,
      onlyGoogle: input.onlyGoogle,
      originIds,
      campaigns:
        input.campaigns === undefined
          ? current.campaigns
          : Object.fromEntries(
              Object.entries(input.campaigns)
                .map(([id, name]) => [id.trim(), String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120)] as const)
                .filter(([id, name]) => /^\d{4,20}$/.test(id) && name)
                .slice(0, 500),
            ),
      startDate,
      updatedAt: new Date().toISOString(),
    }
    if (next.enabled) {
      if (!next.customerId || !next.privateKeyEnc) throw new BadRequestException('Para ligar, informe o ID da conta e envie o arquivo de chave da conta de serviço.')
      const { perdaPorMotivo, ...main } = next.actions
      if (!Object.values(main).some(Boolean) && !Object.values(perdaPorMotivo).some((v) => v && v !== '-')) throw new BadRequestException('Informe ao menos uma conversão (ex.: a de venda).')
    }
    await this.settings.set(user.tenantId, 'google_ads', next)
    for (const k of this.tokens.keys()) if (k.startsWith(`${user.tenantId}:`)) this.tokens.delete(k)
    await this.audit.byUser(user, ctx, 'settings.google_ads_updated', 'settings', 'google_ads', {
      ativo: next.enabled,
      conta: next.customerId,
      contaDeServico: next.clientEmail,
      chaveAlterada: !!input.keyFile?.trim(),
      dadosDoCliente: next.sendUserData,
      soGoogle: next.onlyGoogle,
      origens: next.originIds.length,
      desde: next.startDate,
    })
    return this.view(next)
  }

  /** Aprende o nome de uma campanha (quando o link traz o número e o utm_campaign juntos). Nunca troca um nome já cadastrado. */
  async learnCampaign(tenantId: string, id: string, name: string) {
    if (!/^\d{4,20}$/.test(id) || !name.trim() || /^\d+$/.test(name.trim())) return
    const s = await this.config(tenantId)
    if (s.campaigns[id]) return
    await this.settings.set(tenantId, 'google_ads', { ...s, campaigns: { ...s.campaigns, [id]: name.trim().slice(0, 120) } })
  }

  // ---------- Acesso ao Google ----------

  private token(tenantId: string, s: GoogleAdsSettings): Promise<string> {
    const key = `${tenantId}:${sha256(s.clientEmail + (s.privateKeyEnc ?? ''))}`
    const cached = this.tokens.get(key)
    if (cached && cached.until > Date.now()) return cached.token
    const token = (async () => {
      const assertion = signJwt(s.clientEmail, decrypt(s.privateKeyEnc!), Date.now(), DM_SCOPE)
      const res = await fetch(GA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      })
      const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
      if (!res.ok || !body?.access_token) throw new Error(adsError(res.status, body, s.clientEmail))
      this.tokens.set(key, { token: Promise.resolve(body.access_token), until: Date.now() + ((body.expires_in ?? 3600) - 300) * 1000 })
      return body.access_token
    })()
    this.tokens.set(key, { token, until: Date.now() + 60_000 })
    token.catch(() => this.tokens.delete(key))
    return token
  }

  private async ingest(tenantId: string, s: GoogleAdsSettings, actionId: string, events: object[], validateOnly = false) {
    const token = await this.token(tenantId, s)
    const res = await fetch(DM_INGEST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(ingestBody(s, actionId, events, validateOnly)),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    const body = (await res.json().catch(() => null)) as { requestId?: string } | null
    if (!res.ok) throw new Error(adsError(res.status, body, s.clientEmail))
    return body?.requestId ?? null
  }

  /** Teste: confere a chave e manda um envio de validação (o Google confere sem gravar nada). */
  async test(user: AuthUser) {
    const s = await this.config(user.tenantId)
    if (!s.customerId || !s.privateKeyEnc) return { ok: false, message: 'Salve o ID da conta e o arquivo de chave antes de testar.' }
    const actionId = [s.actions.venda, s.actions.contato, s.actions.negociacao, s.actions.perda].find(Boolean)
    if (!actionId) return { ok: false, message: 'Informe ao menos a conversão de venda antes de testar.' }
    try {
      const event = buildEvent({ transactionId: 'teste-crm', eventAt: new Date(Date.now() - DAY), value: 1, clickIds: null, email: 'teste@exemplo.com', phone: null }, true)!
      await this.ingest(user.tenantId, { ...s, sendUserData: true }, actionId, [event], true)
      return { ok: true, message: 'Conectado. O Google aceitou a conta e a conversão (teste de validação, nada foi gravado).' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  // ---------- Registro dos resultados ----------

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: 'google_ads' }, select: { tenantId: true } })
      for (const r of rows) {
        const s = await this.config(r.tenantId)
        if (!s.enabled || !s.customerId || !s.privateKeyEnc) continue
        await this.scan(r.tenantId, s).catch((err: unknown) => this.logger.error(`Google Ads (registro): ${(err as Error).message}`))
        await this.send(r.tenantId, s).catch((err: unknown) => this.logger.error(`Google Ads (envio): ${(err as Error).message}`))
      }
    } finally {
      this.running = false
    }
  }

  /** Registra como PENDENTE os resultados novos dos atendimentos de Pré-Vendas que vieram de anúncio. */
  async scan(tenantId: string, s: GoogleAdsSettings) {
    const floor = Math.max(Date.now() - CLICK_WINDOW_DAYS * DAY, s.startDate ? Date.parse(`${s.startDate}T00:00:00-03:00`) : 0)
    const records = await this.prisma.serviceRecord.findMany({
      where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, leadAt: { gte: new Date(floor) } },
      select: {
        id: true,
        leadId: true,
        leadAt: true,
        saleStatus: true,
        saleValue: true,
        returnStatus: true,
        lostReasonId: true,
        originId: true,
        updatedAt: true,
        origin: { select: { name: true } },
        lead: { select: { firstConversion: true, firstConversionAt: true, lastConversion: true, lastConversionAt: true } },
      },
      take: 5000,
    })
    if (!records.length) return 0
    const ids = records.map((r) => r.id)
    const existing = new Set((await this.prisma.googleAdsConversion.findMany({ where: { tenantId, recordId: { in: ids } }, select: { transactionId: true } })).map((c) => c.transactionId))
    const changes = await this.prisma.$queryRaw<{ recordId: string; field: string; at: Date }[]>`
      SELECT "recordId", f AS field, max("createdAt") AS at FROM service_record_history, unnest(ARRAY['saleStatus','returnStatus']) f
      WHERE "recordId" = ANY(${ids}::uuid[]) AND changes ? f GROUP BY 1, 2`
    const changedAt = new Map(changes.map((c) => [`${c.recordId}:${c.field}`, c.at]))
    const leadIds = [...new Set(records.map((r) => r.leadId).filter((x): x is string => !!x))]
    const [visitors, captures] = await Promise.all([
      this.prisma.siteVisitor.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true, firstTouch: true, firstSeenAt: true, lastTouch: true, lastSeenAt: true } }),
      this.prisma.captureSubmission.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true, touch: true, pageUrl: true, createdAt: true } }),
    ])
    const touchesOf = new Map<string, { t: TouchJson; at: Date | null }[]>()
    const push = (leadId: string | null, t: unknown, at: Date | null) => {
      if (!leadId || !t || typeof t !== 'object') return
      touchesOf.set(leadId, [...(touchesOf.get(leadId) ?? []), { t: t as TouchJson, at }])
    }
    for (const v of visitors) {
      push(v.leadId, v.firstTouch, v.firstSeenAt)
      push(v.leadId, v.lastTouch, v.lastSeenAt)
    }
    for (const c of captures) push(c.leadId, c.touch ?? (c.pageUrl ? { landing: c.pageUrl } : null), c.createdAt)

    const rows: Prisma.GoogleAdsConversionCreateManyInput[] = []
    for (const r of records) {
      const touches = [...(touchesOf.get(r.leadId ?? '') ?? [])]
      if (r.lead) {
        if (r.lead.firstConversion) touches.push({ t: r.lead.firstConversion as TouchJson, at: r.lead.firstConversionAt })
        if (r.lead.lastConversion) touches.push({ t: r.lead.lastConversion as TouchJson, at: r.lead.lastConversionAt })
      }
      // Toque de anúncio mais recente até o contato (é dele o código de clique que o Google reconhece).
      const before = touches.filter((x) => !x.at || x.at.getTime() <= r.leadAt.getTime() + DAY).sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
      const google = before.find((x) => isGoogleAdsTouch(x.t))
      const fromGoogle = !!google || /google/i.test(r.origin?.name ?? '')
      if (!shouldSend(s, fromGoogle, r.originId)) continue
      const clickIds: ClickIds | null = google ? clickIdsFromUrl(google.t.landing) : null
      const clickAt = google?.at ?? null

      const kinds: { kind: ConversionKind; at: Date; value: number | null }[] = [{ kind: 'contato', at: r.leadAt, value: null }]
      if (r.returnStatus === 'SIM') kinds.push({ kind: 'negociacao', at: changedAt.get(`${r.id}:returnStatus`) ?? r.leadAt, value: null })
      if (r.saleStatus === 'SIM') kinds.push({ kind: 'venda', at: changedAt.get(`${r.id}:saleStatus`) ?? r.leadAt, value: r.saleValue === null ? null : Number(r.saleValue) })
      if (r.saleStatus === 'NAO') kinds.push({ kind: 'perda', at: changedAt.get(`${r.id}:saleStatus`) ?? r.leadAt, value: null })

      for (const k of kinds) {
        const actionId = actionFor(s, k.kind, r.lostReasonId)
        const transactionId = `${r.id}:${k.kind}`
        if (!actionId || existing.has(transactionId)) continue
        // O Google não aceita conversão mais de 90 dias depois do clique.
        const late = clickAt && k.at.getTime() - clickAt.getTime() > CLICK_WINDOW_DAYS * DAY
        rows.push({
          tenantId,
          recordId: r.id,
          leadId: r.leadId,
          kind: k.kind,
          transactionId,
          actionId,
          eventAt: k.at,
          value: k.value,
          clickIds: (clickIds ?? undefined) as Prisma.InputJsonValue | undefined,
          campaign: google ? campaignLabel(adsInfoOf([google], s.campaigns) ?? { campaign: null, campaignId: null }).slice(0, 160) : null,
          status: late ? 'IGNORADO' : 'PENDENTE',
          error: late ? 'Mais de 90 dias depois do clique no anúncio (o Google não aceita).' : null,
        })
      }
    }
    if (rows.length) await this.prisma.googleAdsConversion.createMany({ data: rows, skipDuplicates: true })
    return rows.length
  }

  /** Envia os pendentes (e tenta de novo os que deram erro, até 5 vezes, com intervalo de 1 hora). */
  async send(tenantId: string, s: GoogleAdsSettings) {
    const pending = await this.prisma.googleAdsConversion.findMany({
      where: { tenantId, OR: [{ status: 'PENDENTE' }, { status: 'ERRO', attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lt: new Date(Date.now() - 3_600_000) } }] },
      orderBy: { eventAt: 'asc' },
      take: 5000,
    })
    if (!pending.length) return { sent: 0, failed: 0, ignored: 0 }
    const leads = new Map(
      (await this.prisma.lead.findMany({ where: { id: { in: [...new Set(pending.map((p) => p.leadId).filter((x): x is string => !!x))] } }, select: { id: true, email: true, phone: true, anonymizedAt: true } })).map((l) => [l.id, l]),
    )
    let sent = 0
    let failed = 0
    let ignored = 0
    const byAction = new Map<string, typeof pending>()
    for (const p of pending) byAction.set(p.actionId, [...(byAction.get(p.actionId) ?? []), p])
    for (const [actionId, list] of byAction) {
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const chunk = list.slice(i, i + BATCH_SIZE)
        const events: object[] = []
        const included: string[] = []
        for (const p of chunk) {
          const lead = p.leadId ? leads.get(p.leadId) : undefined
          // Lead com dados apagados a pedido (LGPD): não envia nada dele.
          const anon = !!lead?.anonymizedAt
          const ev = anon
            ? null
            : buildEvent({ transactionId: p.transactionId, eventAt: p.eventAt, value: p.value === null ? null : Number(p.value), clickIds: p.clickIds as ClickIds | null, email: lead?.email ?? null, phone: lead?.phone ?? null }, s.sendUserData)
          if (!ev) {
            await this.prisma.googleAdsConversion.update({ where: { id: p.id }, data: { status: 'IGNORADO', error: anon ? 'Dados do cliente apagados a pedido (LGPD).' : 'Sem código de clique nem e-mail/telefone: o Google não teria como reconhecer o cliente.' } })
            ignored++
            continue
          }
          events.push(ev)
          included.push(p.id)
        }
        if (!events.length) continue
        try {
          const requestId = await this.ingest(tenantId, s, actionId, events)
          await this.prisma.googleAdsConversion.updateMany({ where: { id: { in: included } }, data: { status: 'ENVIADO', requestId, error: null, sentAt: new Date(), attempts: { increment: 1 } } })
          sent += included.length
        } catch (err) {
          await this.prisma.googleAdsConversion.updateMany({ where: { id: { in: included } }, data: { status: 'ERRO', error: (err as Error).message.slice(0, 500), attempts: { increment: 1 } } })
          failed += included.length
          this.logger.warn(`Google Ads: envio recusado (${included.length} conversões): ${(err as Error).message}`)
        }
      }
    }
    return { sent, failed, ignored }
  }

  async sendNow(user: AuthUser, ctx: RequestCtx) {
    const s = await this.config(user.tenantId)
    if (!s.enabled) throw new BadRequestException('Ligue a integração antes de enviar.')
    const registered = await this.scan(user.tenantId, s)
    const r = await this.send(user.tenantId, s)
    await this.audit.byUser(user, ctx, 'google_ads.sent_now', 'settings', 'google_ads', { registrados: registered, ...r })
    return { registered, ...r }
  }

  /** Acompanhamento: quantos de cada resultado e situação, e os últimos registros. */
  async status(user: AuthUser) {
    const [groups, recent] = await Promise.all([
      this.prisma.googleAdsConversion.groupBy({ by: ['kind', 'status'], where: { tenantId: user.tenantId }, _count: { _all: true } }),
      this.prisma.googleAdsConversion.findMany({ where: { tenantId: user.tenantId }, orderBy: { updatedAt: 'desc' }, take: 50 }),
    ])
    const names = new Map(
      (await this.prisma.lead.findMany({ where: { id: { in: recent.map((r) => r.leadId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]),
    )
    return {
      counts: groups.map((g) => ({ kind: g.kind, status: g.status, count: g._count._all })),
      recent: recent.map((r) => ({
        id: r.id,
        recordId: r.recordId,
        leadId: r.leadId,
        leadName: r.leadId ? (names.get(r.leadId) ?? null) : null,
        kind: r.kind,
        status: r.status,
        error: r.error,
        eventAt: r.eventAt,
        value: r.value === null ? null : Number(r.value),
        campaign: r.campaign,
        byClick: !!r.clickIds,
        sentAt: r.sentAt,
      })),
    }
  }
}
