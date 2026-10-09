import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { adsFirstLast, adsForRecord, campaignLabel, DEFAULT_GOOGLE_ADS, type GoogleAdsSettings, isGoogleAdsTouch, touchAdsInfo } from '../googleads/googleads'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'

type TouchJson = Record<string, unknown>
export interface LeadTouch {
  t: TouchJson
  at: Date | null
  /** conversao (formulário, integração, WhatsApp...), visita (primeira/última visita ao site) ou formulario */
  via: 'conversao' | 'visita' | 'formulario'
  title?: string
}

const TICK_MS = 5 * 60_000
const BATCH = 1000

/**
 * Origem do Google Ads gravada em cada lead (primeira e última campanha) e em cada atendimento
 * (campanha do anúncio mais recente até o contato). Fica gravada para aparecer nas listas e não se perder
 * nos próximos atendimentos, vendas e atualizações do lead; é refeita quando o lead ou o atendimento muda.
 */
@Injectable()
export class OrigemAdsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OrigemAds')
  private timer?: NodeJS.Timeout
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
    setTimeout(() => void this.tick(), 45_000).unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async names(tenantId: string) {
    return (await this.settings.get<GoogleAdsSettings>(tenantId, 'google_ads', DEFAULT_GOOGLE_ADS)).campaigns ?? {}
  }

  /** Refaz a marcação de todos os atendimentos (ex.: mudaram as origens que recebem os contatos dos anúncios). */
  async recheckRecords(tenantId: string) {
    await this.prisma.$executeRaw`UPDATE service_records SET "adsCheckedAt" = NULL WHERE "tenantId" = ${tenantId}::uuid`
    void this.tick()
  }

  /** Confere os leads e atendimentos que mudaram desde a última conferência. */
  async tick() {
    if (this.running) return
    this.running = true
    try {
      for (let round = 0; round < 50; round++) {
        const leads = await this.prisma.$queryRaw<{ id: string; tenantId: string }[]>`
          SELECT l.id, l."tenantId" FROM leads l
          WHERE l."deletedAt" IS NULL AND (l."adsCheckedAt" IS NULL OR l."updatedAt" > l."adsCheckedAt" OR l."lastConversionAt" > l."adsCheckedAt"
            OR EXISTS (SELECT 1 FROM site_visitors v WHERE v."leadId" = l.id AND v."lastSeenAt" > l."adsCheckedAt"))
          LIMIT ${BATCH}`
        if (!leads.length) break
        for (const [tenantId, ids] of groupBy(leads)) await this.syncLeads(tenantId, ids)
        if (leads.length < BATCH) break
      }
      for (let round = 0; round < 50; round++) {
        const records = await this.prisma.$queryRaw<{ id: string; tenantId: string }[]>`
          SELECT r.id, r."tenantId" FROM service_records r LEFT JOIN leads l ON l.id = r."leadId"
          WHERE r."deletedAt" IS NULL AND (r."adsCheckedAt" IS NULL OR r."updatedAt" > r."adsCheckedAt" OR l."adsCheckedAt" > r."adsCheckedAt")
          LIMIT ${BATCH}`
        if (!records.length) break
        for (const [tenantId, ids] of groupBy(records)) await this.syncRecords(tenantId, ids)
        if (records.length < BATCH) break
      }
    } catch (err) {
      this.logger.error(`Origem Google Ads: ${(err as Error).message}`)
    } finally {
      this.running = false
    }
  }

  /** Todos os toques conhecidos de cada lead: conversões, primeira/última visita ao site e formulários. */
  async touchesOf(leadIds: string[]) {
    const out = new Map<string, LeadTouch[]>()
    if (!leadIds.length) return out
    const push = (leadId: string | null, t: unknown, at: Date | null, via: LeadTouch['via'], title?: string) => {
      if (!leadId || !t || typeof t !== 'object') return
      out.set(leadId, [...(out.get(leadId) ?? []), { t: t as TouchJson, at, via, title }])
    }
    const [leads, events, visitors, captures] = await Promise.all([
      this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, firstConversion: true, firstConversionAt: true, lastConversion: true, lastConversionAt: true } }),
      this.prisma.leadEvent.findMany({ where: { leadId: { in: leadIds }, type: 'conversao' }, select: { leadId: true, title: true, data: true, occurredAt: true }, orderBy: { occurredAt: 'asc' } }),
      this.prisma.siteVisitor.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true, firstTouch: true, firstSeenAt: true, lastTouch: true, lastSeenAt: true } }),
      this.prisma.captureSubmission.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true, touch: true, pageUrl: true, createdAt: true } }),
    ])
    for (const e of events) push(e.leadId, (e.data as { origem?: unknown } | null)?.origem, e.occurredAt, 'conversao', e.title)
    for (const l of leads) {
      // Primeira/última conversão: já estão nos eventos, a não ser em leads antigos ou importados.
      const has = (at: Date | null) => events.some((e) => e.leadId === l.id && at && Math.abs(e.occurredAt.getTime() - at.getTime()) < 60_000)
      if (!has(l.firstConversionAt)) push(l.id, l.firstConversion, l.firstConversionAt, 'conversao')
      if (l.lastConversionAt?.getTime() !== l.firstConversionAt?.getTime() && !has(l.lastConversionAt)) push(l.id, l.lastConversion, l.lastConversionAt, 'conversao')
    }
    for (const v of visitors) {
      push(v.leadId, v.firstTouch, v.firstSeenAt, 'visita')
      push(v.leadId, v.lastTouch, v.lastSeenAt, 'visita')
    }
    for (const c of captures) push(c.leadId, c.touch ?? (c.pageUrl ? { landing: c.pageUrl } : null), c.createdAt, 'formulario')
    return out
  }

  async syncLeads(tenantId: string, ids: string[]) {
    const [names, touches] = await Promise.all([this.names(tenantId), this.touchesOf(ids)])
    const now = new Date()
    for (const id of ids) {
      const fl = adsFirstLast(touches.get(id) ?? [], names)
      // SQL direto: não mexe no updatedAt do lead (é ele que diz quando refazer).
      await this.prisma.$executeRaw`
        UPDATE leads SET "adsFirstCampaignId" = ${fl?.first.campaignId ?? null}, "adsFirstCampaign" = ${fl?.first.campaign ?? null}, "adsFirstAt" = ${fl?.first.at ?? null},
          "adsLastCampaignId" = ${fl?.last.campaignId ?? null}, "adsLastCampaign" = ${fl?.last.campaign ?? null}, "adsLastAt" = ${fl?.last.at ?? null}, "adsCheckedAt" = ${now}
        WHERE id = ${id}::uuid AND "tenantId" = ${tenantId}::uuid`
    }
  }

  async syncRecords(tenantId: string, ids: string[]) {
    const records = await this.prisma.serviceRecord.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, leadId: true, leadAt: true, originId: true, origin: { select: { name: true } } } })
    const [s, touches] = await Promise.all([
      this.settings.get<GoogleAdsSettings>(tenantId, 'google_ads', DEFAULT_GOOGLE_ADS),
      this.touchesOf([...new Set(records.map((r) => r.leadId).filter((x): x is string => !!x))]),
    ])
    const names = s.campaigns ?? {}
    // Origens marcadas em Configurações → Google Ads como as que recebem os contatos dos anúncios (ex.: WhatsApp da LP).
    const adsOrigins = new Set(s.originIds ?? [])
    const now = new Date()
    for (const r of records) {
      const info = adsForRecord(touches.get(r.leadId ?? '') ?? [], r.leadAt, names)
      const via = info ? 'ANUNCIO' : /google/i.test(r.origin?.name ?? '') || (!!r.originId && adsOrigins.has(r.originId)) ? 'ORIGEM' : null
      await this.prisma.$executeRaw`
        UPDATE service_records SET "adsVia" = ${via}, "adsCampaignId" = ${info?.campaignId ?? null}, "adsCampaign" = ${info?.campaign ?? null}, "adsTouchAt" = ${info?.at ?? null}, "adsCheckedAt" = ${now}
        WHERE id = ${r.id}::uuid`
    }
  }

  /** Para a ficha: refaz na hora se o lead ou o atendimento mudou depois da última conferência. */
  async freshLead(tenantId: string, lead: { id: string; updatedAt: Date; lastConversionAt: Date | null; adsCheckedAt: Date | null }) {
    const c = lead.adsCheckedAt?.getTime() ?? 0
    if (!c || lead.updatedAt.getTime() > c || (lead.lastConversionAt?.getTime() ?? 0) > c) await this.syncLeads(tenantId, [lead.id])
  }

  async freshRecord(tenantId: string, r: { id: string; leadId: string | null; updatedAt: Date; adsCheckedAt: Date | null }) {
    if (r.leadId) {
      const lead = await this.prisma.lead.findUnique({ where: { id: r.leadId }, select: { id: true, updatedAt: true, lastConversionAt: true, adsCheckedAt: true } })
      if (lead) await this.freshLead(tenantId, lead)
    }
    await this.syncRecords(tenantId, [r.id])
    return this.prisma.serviceRecord.findUnique({ where: { id: r.id }, select: { adsVia: true, adsCampaignId: true, adsCampaign: true, adsTouchAt: true } })
  }

  /** Histórico de onde o lead veio: cada conversão e visita, do mais recente ao mais antigo, com a campanha do Google Ads. */
  async history(tenantId: string, leadId: string) {
    const [names, touches] = await Promise.all([this.names(tenantId), this.touchesOf([leadId])])
    const seen = new Set<string>()
    return (touches.get(leadId) ?? [])
      .map((x) => {
        const google = isGoogleAdsTouch(x.t)
        const ads = google ? touchAdsInfo(x.t, x.at, names) : null
        const str = (k: string) => (typeof x.t[k] === 'string' ? (x.t[k] as string) : null)
        return {
          at: x.at,
          via: x.via,
          title: x.title ?? null,
          source: str('source'),
          medium: str('medium'),
          campaign: ads ? campaignLabel(ads) : str('campaign'),
          campaignId: ads?.campaignId ?? null,
          googleAds: google,
          landing: str('landing'),
        }
      })
      .filter((h) => {
        // A primeira/última visita costuma repetir a conversão do mesmo momento: mostra uma vez só.
        const key = `${h.at ? Math.floor(h.at.getTime() / 600_000) : 'x'}|${h.source}|${h.medium}|${h.campaign}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
      .slice(0, 100)
  }
}

/** Nome mostrado: o nome oficial atual da campanha (cadastro), senão o gravado, senão o número. */
export function adsName(names: Record<string, string>, campaignId: string | null, campaign: string | null) {
  if (!campaignId && !campaign) return null
  return campaignLabel({ campaignId, campaign: (campaignId && names[campaignId]) || campaign })
}

function groupBy(rows: { id: string; tenantId: string }[]) {
  const m = new Map<string, string[]>()
  for (const r of rows) m.set(r.tenantId, [...(m.get(r.tenantId) ?? []), r.id])
  return m
}
