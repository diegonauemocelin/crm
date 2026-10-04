import { Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt, randomToken, safeEqual } from '../common/crypto'
import { env } from '../config/env'
import { Prisma } from '../generated/prisma/client'
import { LeadCaptureService } from '../leads/lead-capture.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { contactFromMeta, GRAPH_VERSION, type LeadgenNotice, leadgenNotices, type MetaLead, touchFromMeta, validSignature } from './meta'

export interface MetaSettings {
  /** Desligado por padrão: só liga quando o app do Meta estiver aprovado. */
  enabled: boolean
  /** Parte secreta da URL do webhook (identifica a empresa sem expor o id interno). */
  webhookKey: string
  /** Token que o Meta repete na verificação da URL (configurado igual nos dois lados). */
  verifyToken: string
  appSecretEnc: string | null
  pageTokenEnc: string | null
  graphVersion: string
  ownerId: string | null
  tags: string[]
}

export const DEFAULT_META: MetaSettings = {
  enabled: false,
  webhookKey: '',
  verifyToken: '',
  appSecretEnc: null,
  pageTokenEnc: null,
  graphVersion: 'v23.0',
  ownerId: null,
  tags: ['meta-lead-ads'],
}

const PROVIDER = 'meta_lead_ads'

@Injectable()
export class MetaLeadAdsService {
  private readonly logger = new Logger(MetaLeadAdsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly capture: LeadCaptureService,
    private readonly audit: AuditService,
  ) {}

  async config(tenantId: string): Promise<MetaSettings> {
    const s = await this.settings.get(tenantId, 'meta_lead_ads', DEFAULT_META)
    if (!s.webhookKey || !s.verifyToken) {
      s.webhookKey ||= randomToken(24)
      s.verifyToken ||= randomToken(24)
      await this.settings.set(tenantId, 'meta_lead_ads', s)
    }
    return s
  }

  save(tenantId: string, s: MetaSettings) {
    return this.settings.set(tenantId, 'meta_lead_ads', s)
  }

  webhookUrl(s: MetaSettings) {
    return `${env.appUrl}/api/webhooks/meta/${s.webhookKey}`
  }

  private async byWebhookKey(key: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(key)) return null
    const row = await this.prisma.tenantSetting.findFirst({ where: { key: 'meta_lead_ads', value: { path: ['webhookKey'], equals: key } } })
    return row ? { tenantId: row.tenantId, s: { ...DEFAULT_META, ...(row.value as Partial<MetaSettings>) } } : null
  }

  /** Verificação da URL no painel do Meta (GET com hub.challenge). */
  async verify(key: string, mode: unknown, token: unknown, challenge: unknown) {
    const site = await this.byWebhookKey(key)
    if (!site?.s.enabled || mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') return null
    return safeEqual(token, site.s.verifyToken) && /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? challenge : null
  }

  /** Aviso de novo lead. Valida a assinatura; o processamento continua depois de responder 200 ao Meta. */
  async receive(key: string, raw: Buffer, signature: string | undefined): Promise<boolean> {
    const site = await this.byWebhookKey(key)
    if (!site?.s.enabled || !site.s.appSecretEnc) return false
    if (!validSignature(raw, signature, decrypt(site.s.appSecretEnc))) return false
    let body: unknown
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      return false
    }
    const notices = leadgenNotices(body)
    void (async () => {
      for (const n of notices) await this.process(site.tenantId, site.s, n)
    })().catch((err) => this.logger.error(`Meta Lead Ads: ${(err as Error).message}`))
    return true
  }

  private async process(tenantId: string, s: MetaSettings, n: LeadgenNotice) {
    // O Meta reenvia avisos: a chave única garante que cada lead é processado uma vez só.
    let receiptId: string
    try {
      receiptId = (await this.prisma.integrationReceipt.create({ data: { tenantId, provider: PROVIDER, externalId: n.leadgenId, status: 'RECEBIDO' } })).id
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return
      throw err
    }
    try {
      const lead = await this.fetchLead(s, n.leadgenId)
      const { contact, answers } = contactFromMeta(lead)
      const formId = lead.form_id ?? n.formId
      const result = await this.capture.capture(tenantId, contact, {
        title: `Converteu no formulário do ${lead.platform === 'ig' ? 'Instagram' : 'Facebook'}${lead.campaign_name ? ` · campanha ${lead.campaign_name}` : ''}`,
        originName: 'Meta Lead Ads',
        touch: touchFromMeta(lead, formId),
        details: { formulario: formId, anuncio: lead.ad_name ?? null, conjunto: lead.adset_name ?? null, respostas: answers, metaLeadId: n.leadgenId },
        ownerId: s.ownerId,
        tags: s.tags,
        occurredAt: lead.created_time ? new Date(lead.created_time) : n.createdTime ? new Date(n.createdTime * 1000) : undefined,
      })
      await this.prisma.integrationReceipt.update({
        where: { id: receiptId },
        data: result ? { status: result.created ? 'LEAD_CRIADO' : 'LEAD_ATUALIZADO', leadId: result.leadId } : { status: 'SEM_CONTATO', error: 'O formulário não trouxe e-mail nem telefone.' },
      })
      if (result) await this.audit.log({ tenantId, action: 'meta_lead_ads.lead_received', entity: 'lead', entityId: result.leadId, data: { criado: result.created, formulario: formId } })
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500)
      this.logger.warn(`Meta Lead Ads: lead ${n.leadgenId} não processado: ${msg}`)
      await this.prisma.integrationReceipt.update({ where: { id: receiptId }, data: { status: 'ERRO', error: msg } })
    }
  }

  /** Busca as respostas do lead na Graph API (host fixo: sem risco de SSRF). */
  private async fetchLead(s: MetaSettings, leadgenId: string): Promise<MetaLead> {
    if (!s.pageTokenEnc) throw new Error('Token da página não configurado.')
    const version = GRAPH_VERSION.test(s.graphVersion) ? s.graphVersion : DEFAULT_META.graphVersion
    const url = new URL(`https://graph.facebook.com/${version}/${leadgenId}`)
    url.searchParams.set('fields', 'field_data,created_time,form_id,ad_name,adset_name,campaign_name,platform,is_organic')
    url.searchParams.set('access_token', decrypt(s.pageTokenEnc))
    return this.graph<MetaLead>(url)
  }

  private async graph<T>(url: URL): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
    if (!res.ok || body.error) throw new Error(`Meta respondeu ${res.status}: ${body.error?.message ?? 'erro desconhecido'}`)
    return body
  }

  /** Botão "Testar conexão": confere se o token da página é aceito pelo Meta. */
  async test(s: MetaSettings, pageToken?: string) {
    const token = pageToken || (s.pageTokenEnc ? decrypt(s.pageTokenEnc) : '')
    if (!token) return { ok: false, message: 'Informe o token de acesso da página.' }
    const version = GRAPH_VERSION.test(s.graphVersion) ? s.graphVersion : DEFAULT_META.graphVersion
    const url = new URL(`https://graph.facebook.com/${version}/me`)
    url.searchParams.set('fields', 'id,name')
    url.searchParams.set('access_token', token)
    try {
      const me = await this.graph<{ id: string; name?: string }>(url)
      return { ok: true, message: `Conectado à página ${me.name ?? me.id}.` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  receipts(tenantId: string) {
    return this.prisma.integrationReceipt.findMany({ where: { tenantId, provider: PROVIDER }, orderBy: { receivedAt: 'desc' }, take: 20 })
  }
}
