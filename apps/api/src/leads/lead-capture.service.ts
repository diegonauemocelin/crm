import { Injectable } from '@nestjs/common'
import { normalizePhone, UF_LIST, ufFromPhone } from '../atendimento/br'
import type { Prisma } from '../generated/prisma/client'
import { adsInfoOf, campaignLabel, DEFAULT_GOOGLE_ADS, GOOGLE_ADS_TAG, type GoogleAdsSettings } from '../googleads/googleads'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { LeadConfigService } from './lead-config.service'
import { normalizeEmail, normalizeTags } from './mapeamento'

export interface CapturedContact {
  name?: string | null
  email?: string | null
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
  city?: string | null
  state?: string | null
}

export interface Conversion {
  /** Texto da linha do tempo, ex.: "Converteu no formulário do Meta (Campanha X)". */
  title: string
  /** Nome da origem no cadastro (criada se não existir), ex.: "Meta Lead Ads". */
  originName: string
  /** Fonte/meio/campanha da conversão. */
  touch: Record<string, unknown>
  /** Respostas e identificadores extras, guardados no evento. */
  details?: Record<string, unknown>
  ownerId?: string | null
  tags?: string[]
  occurredAt?: Date
  /** Campos personalizados já validados (chave -> valor). Só completam os que estiverem vazios. */
  customFields?: Record<string, unknown>
}

/**
 * Entrada de leads vindos de fora (Meta Lead Ads agora; formulários, LPs e pop-ups na Fase 4).
 * Mesma regra da importação: com e-mail, identifica só pelo e-mail; sem e-mail, pelo telefone.
 * Nunca apaga dado existente: só completa o que estiver vazio.
 */
@Injectable()
export class LeadCaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LeadConfigService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Campanha do Google Ads da conversão (pelo código de clique / número da campanha na página de entrada).
   * Quando o link traz o número e o nome (utm_campaign) juntos, guarda o nome para os próximos contatos da campanha.
   */
  private async googleAds(tenantId: string, touch: Record<string, unknown>, at: Date) {
    const info = adsInfoOf([{ t: touch, at }])
    if (!info) return null
    const s = await this.settings.get<GoogleAdsSettings>(tenantId, 'google_ads', DEFAULT_GOOGLE_ADS)
    if (info.campaignId && info.campaign && !s.campaigns[info.campaignId]) {
      await this.settings.set(tenantId, 'google_ads', { ...s, campaigns: { ...s.campaigns, [info.campaignId]: info.campaign.slice(0, 120) } })
    }
    return { ...info, campaign: info.campaign ?? (info.campaignId ? (s.campaigns[info.campaignId] ?? null) : null) }
  }

  private async originId(tenantId: string, name: string) {
    const found = await this.prisma.lookupItem.findFirst({ where: { tenantId, type: 'ORIGEM', name: { equals: name, mode: 'insensitive' } } })
    return found?.id ?? (await this.prisma.lookupItem.create({ data: { tenantId, type: 'ORIGEM', name } })).id
  }

  async capture(tenantId: string, c: CapturedContact, conv: Conversion): Promise<{ leadId: string; created: boolean } | null> {
    const email = c.email ? normalizeEmail(c.email) : null
    const phone = c.phone ? normalizePhone(c.phone) : null
    if (!email && !phone) return null
    const clean = (v: string | null | undefined, n: number) => v?.trim().slice(0, n) || null
    const stateRaw = c.state?.trim().toUpperCase() ?? null
    const state = stateRaw && (UF_LIST as readonly string[]).includes(stateRaw) ? stateRaw : (phone ? ufFromPhone(phone) : null)
    const at = conv.occurredAt ?? new Date()
    // Veio de anúncio do Google: marca o lead (tag "google-ads") e diz a campanha na linha do tempo.
    const ads = await this.googleAds(tenantId, conv.touch, at)
    const tags = normalizeTags([...(conv.tags ?? []), ...(ads ? [GOOGLE_ADS_TAG] : [])])
    const originId = await this.originId(tenantId, conv.originName)
    const touch = conv.touch as Prisma.InputJsonValue
    const title = ads ? `${conv.title} · Google Ads, ${campaignLabel(ads)}` : conv.title
    const event = { tenantId, type: 'conversao', title: title.slice(0, 300), data: { origem: conv.touch, ...(ads ? { googleAds: { campanha: ads.campaign, numeroCampanha: ads.campaignId } } : {}), ...(conv.details ?? {}) } as Prisma.InputJsonValue, occurredAt: at }

    const existing = await this.prisma.lead.findFirst({
      where: { tenantId, deletedAt: null, anonymizedAt: null, ...(email ? { email } : { phone }) },
      orderBy: { createdAt: 'asc' },
    })

    if (!existing) {
      // Com e-mail novo, cria mesmo que o telefone já exista em outro lead (regra da base):
      // telefone compartilhado (empresa, família) não identifica uma pessoa.
      const lead = await this.prisma.lead.create({
        data: {
          tenantId,
          name: clean(c.name, 160),
          email,
          phone,
          company: clean(c.company, 160),
          jobTitle: clean(c.jobTitle, 120),
          city: clean(c.city, 80),
          state,
          ownerId: conv.ownerId ?? null,
          originId,
          tags,
          customFields: (conv.customFields ?? {}) as Prisma.InputJsonValue,
          firstConversionAt: at,
          lastConversionAt: at,
          firstConversion: touch,
          lastConversion: touch,
          lastActivityAt: at,
          events: { create: event },
        },
      })
      await this.config.rescore(tenantId, [lead.id])
      return { leadId: lead.id, created: true }
    }

    const data: Prisma.LeadUncheckedUpdateInput = {
      lastConversionAt: at,
      lastConversion: touch,
      lastActivityAt: at,
      tags: [...new Set([...existing.tags, ...tags])],
      events: { create: event },
    }
    if (!existing.firstConversionAt) {
      data.firstConversionAt = at
      data.firstConversion = touch
    }
    if (!existing.name && c.name) data.name = clean(c.name, 160)
    if (!existing.phone && phone) data.phone = phone
    if (!existing.company && c.company) data.company = clean(c.company, 160)
    if (!existing.jobTitle && c.jobTitle) data.jobTitle = clean(c.jobTitle, 120)
    if (!existing.city && c.city) data.city = clean(c.city, 80)
    if (!existing.state && state) data.state = state
    if (!existing.originId) data.originId = originId
    if (!existing.ownerId && conv.ownerId) data.ownerId = conv.ownerId
    if (conv.customFields && Object.keys(conv.customFields).length) {
      const current = (existing.customFields ?? {}) as Record<string, unknown>
      const fill = Object.fromEntries(Object.entries(conv.customFields).filter(([k]) => current[k] === undefined || current[k] === null || current[k] === ''))
      if (Object.keys(fill).length) data.customFields = { ...current, ...fill } as Prisma.InputJsonValue
    }
    await this.prisma.lead.update({ where: { id: existing.id }, data })
    await this.config.rescore(tenantId, [existing.id])
    return { leadId: existing.id, created: false }
  }
}
