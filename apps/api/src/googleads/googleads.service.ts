import { BadRequestException, Injectable, Logger, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt, randomToken, safeEqual, sha256 } from '../common/crypto'
import { env } from '../config/env'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { cleanStats, adsScript } from './painel'
import { cleanDetail, cleanTerms } from './detalhes'
import { GoogleAdsPanelService } from './painel.service'
import { GA_TOKEN_URL, parseKeyFile, signJwt } from '../relatorios/ga4'
import { SettingsService } from '../settings/settings.service'
import {
  actionFor,
  SCRIPT_KEY,
  type ScriptState,
  adsError,
  adsInfoOf,
  campaignLabel,
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
  DM_STATUS_URL,
  eventSourceFor,
  type GoogleAdsSettings,
  ingestBody,
  isGoogleAdsTouch,
  shouldSend,
  badEvents,
  summarizeRequestStatus,
  tooOldForGoogle,
} from './googleads'

const DAY = 86_400_000

/** Resumo de uma rodada: atendimentos olhados, quantos se encaixam nas regras e quantos resultados novos entraram na fila. */
export interface ScanStats {
  since: string
  considered: number
  matched: number
  registered: number
}
/** Confere a cada 10 minutos se já passou o intervalo; o envio automático em si é a cada 2 horas. */
const TICK_MS = 10 * 60_000
/** Intervalo do envio automático ao Google (ritmo calmo; o Google pede ao menos 1 envio por dia). */
export const AUTO_INTERVAL_MS = 2 * 3_600_000
/** "Enviar agora": no máximo 1 vez a cada 10 minutos. */
export const MANUAL_GAP_MS = 10 * 60_000
/** Pausa entre um pedido e outro ao Google, para não mandar em rajada. */
const REQUEST_GAP_MS = 1000
const MAX_ATTEMPTS = 5
const SYNC_KEY = 'google_ads_sync'
interface SyncState {
  lastAutoAt?: string
  lastManualAt?: string
  /** Último aviso do Google para esperar (limite atingido / fora do ar): o resto fica para a janela seguinte. */
  pausedReason?: string | null
  /** Última conferência dos atendimentos: quantos olhados, quantos vieram de anúncio e quantos entraram na fila. */
  lastScan?: ScanStats & { at: string }
}
/** O Google confere o envio depois: a primeira consulta do resultado espera 30 minutos e desiste depois de 7 dias. */
const CHECK_AFTER_MS = 30 * 60_000
const CHECK_UNTIL_MS = 7 * DAY
const CHECKS_PER_RUN = 30

/** Limite do Google, Google fora do ar ou falha de rede: para de enviar agora e tenta na próxima janela. */
export class AdsRetryLater extends Error {}
/** O Google recusou o lote por causa de alguns eventos (pelo índice): os outros podem ir sem eles. */
export class AdsBadEvents extends Error {
  constructor(message: string, readonly bad: Map<number, { field: string; description: string }>) {
    super(message)
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
 * Retorno dos atendimentos para o Google Ads: a cada 2 horas registra os resultados novos (contato, retorno do
 * vendedor, venda, perda por motivo) de quem veio de anúncio e envia pela Data Manager API. Cada resultado vai uma vez só.
 */
@Injectable()
export class GoogleAdsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GoogleAdsService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly tokens = new Map<string, { token: Promise<string>; until: number }>()
  /** Pausa entre pedidos ao Google (os testes zeram). */
  gapMs = REQUEST_GAP_MS

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Optional() private readonly panel?: GoogleAdsPanelService,
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
    return { ...rest, hasKey: !!privateKeyEnc, campaignsScript: url ? adsScript(url) : null }
  }

  /** Último contato do script do Google Ads e se o CRM aceitou o envio. */
  scriptState(tenantId: string) {
    return this.settings.get<ScriptState>(tenantId, SCRIPT_KEY, {})
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
    if (!row) {
      this.logger.warn('Script do Google Ads chamou com um endereço que não existe mais (cole o código novo de Configurações → Google Ads).')
      return null
    }
    // Último contato do script (com ou sem erro): mostra no painel se ele parou de rodar ou se o CRM recusou o envio.
    const note = async (lastError: string | null) => {
      const prev = await this.settings.get<ScriptState>(row.tenantId, SCRIPT_KEY, {})
      await this.settings.set(row.tenantId, SCRIPT_KEY, { ...prev, lastCallAt: new Date().toISOString(), lastError })
    }
    try {
      const out = await this.storeFromScript(row.tenantId, body)
      await note(null)
      return out
    } catch (err) {
      await note(((err as Error).message || 'erro desconhecido').slice(0, 300)).catch(() => {})
      throw err
    }
  }

  private async storeFromScript(tenantId: string, body: unknown) {
    const row = { tenantId }
    const b = (body ?? {}) as { campaigns?: unknown; stats?: unknown }
    const bb = b as { detail?: unknown; terms?: unknown }
    if (b.campaigns === undefined && b.stats === undefined && bb.detail === undefined && bb.terms === undefined) throw new BadRequestException('Nada para receber.')
    const out: Record<string, unknown> = { ok: true }
    if (b.campaigns !== undefined) {
      const r = cleanCampaignList(body)
      if ('error' in r) throw new BadRequestException(r.error)
      const s = await this.config(row.tenantId)
      await this.settings.set(row.tenantId, 'google_ads', { ...s, campaigns: { ...s.campaigns, ...r.campaigns }, campaignsSyncedAt: new Date().toISOString() })
      out.campanhas = r.count
    }
    // Detalhes para o Marketing Inteligente (script ampliado): recortes e termos de pesquisa.
    if (bb.detail !== undefined && this.panel) {
      const d = cleanDetail(body)
      if ('error' in d) throw new BadRequestException(d.error)
      Object.assign(out, await this.panel.storeDetail(row.tenantId, d))
    }
    if (bb.terms !== undefined && this.panel) {
      const t = cleanTerms(body)
      if ('error' in t) throw new BadRequestException(t.error)
      Object.assign(out, await this.panel.storeTerms(row.tenantId, t))
    }
    // Investimento por dia, campanha e palavra-chave (script novo), para o painel do Google Ads.
    if (b.stats !== undefined && this.panel) {
      const st = cleanStats(body)
      if ('error' in st) throw new BadRequestException(st.error)
      Object.assign(out, await this.panel.store(row.tenantId, st))
    }
    return out
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
    const requeued = await this.requeueForNewActions(user.tenantId, next)
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
      reenviar: requeued,
    })
    return { ...this.view(next), requeued }
  }

  /**
   * Trocou o ID de uma ação de conversão (ex.: a ação foi apagada e criada de novo no Google Ads): os resultados que
   * foram para a ação antiga voltam para a fila e vão para a nova (só os que o Google ainda aceita: até 90 dias).
   */
  async requeueForNewActions(tenantId: string, s: GoogleAdsSettings, now = Date.now()) {
    const rows = await this.prisma.googleAdsConversion.findMany({
      where: { tenantId, status: { in: ['ENVIADO', 'ERRO'] }, eventAt: { gte: new Date(now - CLICK_WINDOW_DAYS * DAY) } },
      select: { id: true, recordId: true, kind: true, actionId: true },
    })
    if (!rows.length) return 0
    const reasons = new Map(
      (await this.prisma.serviceRecord.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordId))] } }, select: { id: true, lostReasonId: true } })).map((r) => [r.id, r.lostReasonId]),
    )
    const ids = rows.filter((r) => {
      const action = actionFor(s, r.kind as ConversionKind, reasons.get(r.recordId) ?? null)
      return !!action && action !== r.actionId
    }).map((r) => r.id)
    for (let i = 0; i < ids.length; i += 5000) {
      await this.prisma.googleAdsConversion.updateMany({
        where: { id: { in: ids.slice(i, i + 5000) } },
        data: { status: 'PENDENTE', attempts: 0, error: null, googleStatus: null, googleDetail: null, googleCheckedAt: null, requestId: null },
      })
    }
    return ids.length
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
    }).catch((err: unknown) => {
      throw new AdsRetryLater(`Sem conexão com o Google (${(err as Error).name === 'TimeoutError' ? 'demorou demais' : 'falha de rede'}). O CRM tenta de novo mais tarde.`)
    })
    const body = (await res.json().catch(() => null)) as { requestId?: string } | null
    if (!res.ok) {
      const msg = adsError(res.status, body, s.clientEmail)
      if (res.status === 429 || res.status >= 500) throw new AdsRetryLater(msg)
      const bad = res.status === 400 ? badEvents(body) : new Map<number, { field: string; description: string }>()
      if (bad.size) throw new AdsBadEvents(msg, bad)
      throw new Error(msg)
    }
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

  private async syncState(tenantId: string) {
    return this.settings.get<SyncState>(tenantId, SYNC_KEY, {})
  }

  private async setSyncState(tenantId: string, patch: SyncState) {
    await this.settings.set(tenantId, SYNC_KEY, { ...(await this.syncState(tenantId)), ...patch })
  }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: 'google_ads' }, select: { tenantId: true } })
      for (const r of rows) {
        const s = await this.config(r.tenantId)
        if (!s.enabled || !s.customerId || !s.privateKeyEnc) continue
        // A hora do último envio fica no banco: reiniciar ou atualizar o CRM não dispara envio fora do ritmo de 2 horas.
        const state = await this.syncState(r.tenantId)
        if (state.lastAutoAt && Date.now() - Date.parse(state.lastAutoAt) < AUTO_INTERVAL_MS) continue
        await this.setSyncState(r.tenantId, { lastAutoAt: new Date().toISOString() })
        await this.scan(r.tenantId, s).catch((err: unknown) => this.logger.error(`Google Ads (registro): ${(err as Error).message}`))
        await this.send(r.tenantId, s).catch((err: unknown) => this.logger.error(`Google Ads (envio): ${(err as Error).message}`))
      }
      // A resposta final do Google sai depois do envio: confere a cada rodada de 10 minutos (sem esperar as 2 horas).
      for (const r of rows) {
        const s = await this.config(r.tenantId)
        if (!s.enabled || !s.customerId || !s.privateKeyEnc) continue
        await this.checkResults(r.tenantId, s).catch((err: unknown) => this.logger.warn(`Google Ads (conferência): ${(err as Error).message}`))
      }
    } finally {
      this.running = false
    }
  }

  /** Registra como PENDENTE os resultados novos dos atendimentos de Pré-Vendas que vieram de anúncio. */
  async scan(tenantId: string, s: GoogleAdsSettings): Promise<ScanStats> {
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
    const since = new Date(floor - 3 * 3_600_000).toISOString().slice(0, 10)
    if (!records.length) {
      await this.setSyncState(tenantId, { lastScan: { since, considered: 0, matched: 0, registered: 0, at: new Date().toISOString() } })
      return { since, considered: 0, matched: 0, registered: 0 }
    }
    let matched = 0
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
      matched++
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
        // Nem conversão antes do clique (o cadastro pode ter ficado registrado segundos antes da visita).
        const eventAt = clickAt && k.at.getTime() <= clickAt.getTime() ? new Date(clickAt.getTime() + 60_000) : k.at
        rows.push({
          tenantId,
          recordId: r.id,
          leadId: r.leadId,
          kind: k.kind,
          transactionId,
          actionId,
          eventAt,
          value: k.value,
          clickIds: (clickIds ?? undefined) as Prisma.InputJsonValue | undefined,
          campaign: google ? campaignLabel(adsInfoOf([google], s.campaigns) ?? { campaign: null, campaignId: null }).slice(0, 160) : null,
          status: late ? 'IGNORADO' : 'PENDENTE',
          error: late ? 'Mais de 90 dias depois do clique no anúncio (o Google não aceita).' : null,
        })
      }
    }
    if (rows.length) await this.prisma.googleAdsConversion.createMany({ data: rows, skipDuplicates: true })
    const stats = { since, considered: records.length, matched, registered: rows.length }
    await this.setSyncState(tenantId, { lastScan: { ...stats, at: new Date().toISOString() } })
    return stats
  }

  /** Envia os pendentes (e tenta de novo os que deram erro, até 5 vezes, um por envio automático de 2 horas). */
  /** retryNow (botão "Enviar agora"): tenta de novo na hora todos os que deram erro, sem esperar e sem o limite de tentativas. */
  async send(tenantId: string, s: GoogleAdsSettings, retryNow = false) {
    const pending = await this.prisma.googleAdsConversion.findMany({
      where: { tenantId, OR: [{ status: 'PENDENTE' }, retryNow ? { status: 'ERRO' } : { status: 'ERRO', attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lt: new Date(Date.now() - AUTO_INTERVAL_MS + 2 * TICK_MS) } }] },
      orderBy: { eventAt: 'asc' },
      take: 5000,
    })
    if (!pending.length) {
      await this.setSyncState(tenantId, { pausedReason: null })
      return { sent: 0, failed: 0, ignored: 0, paused: null as string | null }
    }
    const leads = new Map(
      (await this.prisma.lead.findMany({ where: { id: { in: [...new Set(pending.map((p) => p.leadId).filter((x): x is string => !!x))] } }, select: { id: true, email: true, phone: true, anonymizedAt: true } })).map((l) => [l.id, l]),
    )
    // Origem do atendimento: diz ao Google se o contato veio por mensagem (WhatsApp), ligação ou site.
    const records = new Map(
      (await this.prisma.serviceRecord.findMany({ where: { id: { in: [...new Set(pending.map((p) => p.recordId))] } }, select: { id: true, lostReasonId: true, origin: { select: { name: true } } } })).map((r) => [r.id, r]),
    )
    let sent = 0
    let failed = 0
    let ignored = 0
    // Usa sempre a conversão configurada agora: se a pessoa trocar o ID no painel, os pendentes e os com erro vão para o novo.
    const byAction = new Map<string, typeof pending>()
    for (const p of pending) {
      const actionId = actionFor(s, p.kind as ConversionKind, records.get(p.recordId)?.lostReasonId ?? null)
      if (!actionId) continue
      byAction.set(actionId, [...(byAction.get(actionId) ?? []), p])
    }
    for (const [actionId, list] of byAction) {
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const chunk = list.slice(i, i + BATCH_SIZE)
        const events: object[] = []
        const included: string[] = []
        for (const p of chunk) {
          const lead = p.leadId ? leads.get(p.leadId) : undefined
          // Velha demais: o Google recusaria o lote inteiro por causa dela.
          const old = tooOldForGoogle(p.eventAt, p.clickIds as ClickIds | null)
          if (old) {
            await this.prisma.googleAdsConversion.update({ where: { id: p.id }, data: { status: 'IGNORADO', error: old } })
            ignored++
            continue
          }
          // Lead com dados apagados a pedido (LGPD): não envia nada dele.
          const anon = !!lead?.anonymizedAt
          const ev = anon
            ? null
            : buildEvent({ transactionId: p.transactionId, eventAt: p.eventAt, value: p.value === null ? null : Number(p.value), clickIds: p.clickIds as ClickIds | null, email: lead?.email ?? null, phone: lead?.phone ?? null, source: eventSourceFor(records.get(p.recordId)?.origin?.name) }, s.sendUserData)
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
          const r = await this.sendChunk(tenantId, s, actionId, included.map((id, k) => ({ id, ev: events[k]! })), 0)
          sent += r.sent
          failed += r.failed
        } catch (err) {
          if (!(err instanceof AdsRetryLater)) throw err
          // O Google pediu para esperar (ou não respondeu): para tudo agora; o resto fica para a próxima janela.
          this.logger.warn(`Google Ads: envio pausado até a próxima janela: ${err.message}`)
          await this.setSyncState(tenantId, { pausedReason: err.message })
          return { sent, failed, ignored, paused: err.message }
        }
      }
    }
    await this.setSyncState(tenantId, { pausedReason: null })
    return { sent, failed, ignored, paused: null as string | null }
  }

  /**
   * O Google recusa o lote inteiro se um evento tiver problema. Quando a recusa é por dado inválido, divide o lote
   * ao meio e reenvia (até 4 vezes), para os eventos bons passarem e só os problemáticos ficarem com erro.
   */
  private async sendChunk(tenantId: string, s: GoogleAdsSettings, actionId: string, items: { id: string; ev: object }[], depth: number): Promise<{ sent: number; failed: number }> {
    const ids = items.map((x) => x.id)
    try {
      if (this.gapMs) await sleep(this.gapMs)
      const requestId = await this.ingest(tenantId, s, actionId, items.map((x) => x.ev))
      await this.prisma.googleAdsConversion.updateMany({ where: { id: { in: ids } }, data: { status: 'ENVIADO', actionId, requestId, error: null, sentAt: new Date(), attempts: { increment: 1 }, googleStatus: null, googleDetail: null, googleCheckedAt: null } })
      return { sent: ids.length, failed: 0 }
    } catch (err) {
      const msg = (err as Error).message
      if (err instanceof AdsRetryLater) {
        // Não conta como tentativa: o problema é do lado do Google ou da rede, não do dado.
        await this.prisma.googleAdsConversion.updateMany({ where: { id: { in: ids }, status: 'ERRO' }, data: { error: msg.slice(0, 500) } })
        throw err
      }
      // O Google disse quais eventos estão errados: tira só esses e manda o resto de novo na hora.
      if (err instanceof AdsBadEvents && depth < 6) {
        const badIds = items.filter((_, i) => err.bad.has(i))
        const rest = items.filter((_, i) => !err.bad.has(i))
        for (const [i, b] of err.bad) {
          const it = items[i]
          if (!it) continue
          const when = (it.ev as { eventTimestamp?: string }).eventTimestamp?.slice(0, 10).split('-').reverse().join('/') ?? ''
          const outOfWindow = /timestamp/i.test(b.field)
          await this.prisma.googleAdsConversion.updateMany({
            where: { id: it.id },
            data: outOfWindow
              ? { status: 'IGNORADO', error: `Fora do prazo que o Google aceita (conversão de ${when}).`, attempts: { increment: 1 } }
              : { status: 'ERRO', actionId, error: `O Google recusou este evento: ${b.field} ${b.description}`.slice(0, 500), attempts: { increment: 1 } },
          })
        }
        this.logger.warn(`Google Ads: ${badIds.length} evento(s) recusado(s) no lote (ação ${actionId}); reenviando os outros ${rest.length}.`)
        if (!rest.length || badIds.length === 0) return { sent: 0, failed: badIds.length }
        const r = await this.sendChunk(tenantId, s, actionId, rest, depth + 1)
        return { sent: r.sent, failed: r.failed + badIds.length }
      }
      if (items.length > 1 && depth < 4 && msg.startsWith('O Google recusou o envio')) {
        const half = Math.ceil(items.length / 2)
        const a = await this.sendChunk(tenantId, s, actionId, items.slice(0, half), depth + 1)
        const b = await this.sendChunk(tenantId, s, actionId, items.slice(half), depth + 1)
        return { sent: a.sent + b.sent, failed: a.failed + b.failed }
      }
      await this.prisma.googleAdsConversion.updateMany({ where: { id: { in: ids } }, data: { status: 'ERRO', actionId, error: msg.slice(0, 500), attempts: { increment: 1 } } })
      this.logger.warn(`Google Ads: envio recusado (${ids.length} conversões, ação ${actionId}): ${msg}`)
      return { sent: 0, failed: ids.length }
    }
  }

  /**
   * Resposta final do Google: o envio é aceito na hora, mas o Google confere os dados depois (clique encontrado,
   * conta certa, ação de conversão do tipo certo). Consulta cada envio (requestId) até ter o resultado.
   */
  async checkResults(tenantId: string, s: GoogleAdsSettings, now = Date.now()) {
    const pending = await this.prisma.googleAdsConversion.findMany({
      where: {
        tenantId,
        status: 'ENVIADO',
        requestId: { not: null },
        sentAt: { lt: new Date(now - CHECK_AFTER_MS), gte: new Date(now - CHECK_UNTIL_MS) },
        OR: [{ googleStatus: null }, { googleStatus: 'PROCESSANDO', googleCheckedAt: { lt: new Date(now - CHECK_AFTER_MS) } }],
      },
      distinct: ['requestId'],
      select: { requestId: true },
      orderBy: { sentAt: 'asc' },
      take: CHECKS_PER_RUN,
    })
    let checked = 0
    for (const p of pending) {
      const token = await this.token(tenantId, s)
      if (this.gapMs) await sleep(this.gapMs)
      const res = await fetch(`${DM_STATUS_URL}?requestId=${encodeURIComponent(p.requestId!)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      }).catch(() => null)
      if (!res) return checked
      const body = (await res.json().catch(() => null)) as unknown
      if (res.status === 429 || res.status >= 500) return checked
      const sum = res.ok ? summarizeRequestStatus(body) : null
      await this.prisma.googleAdsConversion.updateMany({
        where: { tenantId, requestId: p.requestId },
        data: sum
          ? { googleStatus: sum.status, googleDetail: sum.detail, googleCheckedAt: new Date(now) }
          : { googleStatus: 'PROCESSANDO', googleDetail: res.ok ? null : adsError(res.status, body, s.clientEmail).slice(0, 500), googleCheckedAt: new Date(now) },
      })
      // "Ação criada há pouco" / "clique recente demais": o Google pede para esperar. Volta o lote para a fila; as que
      // já tinham entrado voltam como repetidas (o Google ignora pelo transactionId).
      if (sum?.retry && sum.status !== 'PROCESSANDO') {
        await this.prisma.googleAdsConversion.updateMany({
          where: { tenantId, requestId: p.requestId, attempts: { lt: MAX_ATTEMPTS } },
          data: { status: 'PENDENTE', error: `O Google pediu para esperar (${sum.detail ?? 'aguarde'}). Reenvio automático.`.slice(0, 500) },
        })
      }
      checked++
    }
    return checked
  }

  async sendNow(user: AuthUser, ctx: RequestCtx) {
    const s = await this.config(user.tenantId)
    if (!s.enabled) throw new BadRequestException('Ligue a integração antes de enviar.')
    const state = await this.syncState(user.tenantId)
    const wait = state.lastManualAt ? MANUAL_GAP_MS - (Date.now() - Date.parse(state.lastManualAt)) : 0
    if (wait > 0) throw new BadRequestException(`Para não sobrecarregar o Google, “Enviar agora” pode ser usado 1 vez a cada 10 minutos. Tente de novo em ${Math.ceil(wait / 60_000)} min.`)
    // Também reinicia a contagem do envio automático (o próximo fica para daqui a 2 horas).
    const now = new Date().toISOString()
    await this.setSyncState(user.tenantId, { lastManualAt: now, lastAutoAt: now })
    const stats = await this.scan(user.tenantId, s)
    const r = await this.send(user.tenantId, s, true)
    await this.checkResults(user.tenantId, s).catch(() => 0)
    await this.audit.byUser(user, ctx, 'google_ads.sent_now', 'settings', 'google_ads', { registrados: stats.registered, ...r })
    return { ...stats, ...r }
  }

  /** Acompanhamento: quantos de cada resultado e situação, e os últimos registros. */
  async status(user: AuthUser) {
    const [groups, recent, sync] = await Promise.all([
      this.prisma.googleAdsConversion.groupBy({ by: ['kind', 'status'], where: { tenantId: user.tenantId }, _count: { _all: true } }),
      this.prisma.googleAdsConversion.findMany({ where: { tenantId: user.tenantId }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      this.syncState(user.tenantId),
    ])
    const [googleGroups, rejections] = await Promise.all([
      this.prisma.googleAdsConversion.groupBy({ by: ['googleStatus'], where: { tenantId: user.tenantId, status: 'ENVIADO' }, _count: { _all: true } }),
      this.prisma.googleAdsConversion.findMany({
        where: { tenantId: user.tenantId, googleStatus: { in: ['RECUSADO', 'PARCIAL'] }, googleDetail: { not: null } },
        distinct: ['requestId'],
        orderBy: { sentAt: 'desc' },
        take: 5,
        select: { googleDetail: true, kind: true, sentAt: true },
      }),
    ])
    const names = new Map(
      (await this.prisma.lead.findMany({ where: { id: { in: recent.map((r) => r.leadId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]),
    )
    return {
      lastRunAt: sync.lastAutoAt ?? null,
      nextRunAt: sync.lastAutoAt ? new Date(Date.parse(sync.lastAutoAt) + AUTO_INTERVAL_MS).toISOString() : null,
      pausedReason: sync.pausedReason ?? null,
      lastScan: sync.lastScan ?? null,
      google: googleGroups.map((g) => ({ status: g.googleStatus, count: g._count._all })),
      rejections: rejections.map((r) => ({ detail: r.googleDetail, kind: r.kind, sentAt: r.sentAt })),
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
        googleStatus: r.googleStatus,
        googleDetail: r.googleDetail,
      })),
    }
  }
}
