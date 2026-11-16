import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { GEMINI_MODELS, SECRET_KEY } from '../assistente/constantes'
import { AuditService } from '../audit/audit.service'
import { decrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { LeadCaptureService } from '../leads/lead-capture.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { whatsappOf } from '../whatsapp/mensagens'
import { WhatsappService } from '../whatsapp/whatsapp.service'
import { cnpjLookup, geocode, hasMx, osmSearch } from './fontes'
import { type AiProvider, claudeSearch, geminiSearch, searchCost } from './ia'
import {
  alreadyKnown,
  cepOf,
  cleanCriteria,
  distanceKm,
  type EmailContact,
  hasValidContact,
  mergeEmails,
  mergePhones,
  nameKey,
  osmTerms,
  type PhoneContact,
  type ProspectCriteria,
  type ProspectData,
  prospectsFromAi,
} from './prospeccao'

const MODULE = 'prospeccao'
const CONFIG_KEY = 'prospeccao'
const ORIGIN = 'Prospecção'
const STALE_MS = 20 * 60_000
/** WhatsApp: no máximo 30 números por pedido, um a cada 4 s (conferir muitos de uma vez arrisca o número da empresa). */
const WA_MAX = 30
const WA_GAP_MS = 4000
const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const

interface ProspeccaoConfig {
  provider: AiProvider
  claudeModel: string
  /** Buscas por dia na empresa (as do Claude custam). */
  dailyLimit: number
  /** Pesquisas na web por busca (Claude). */
  maxWebSearches: number
}
const DEFAULT_CONFIG: ProspeccaoConfig = { provider: 'claude', claudeModel: 'claude-opus-5-5', dailyLimit: 10, maxWebSearches: 8 }

const blockKeys = (p: { cnpj?: string | null; name: string; site?: string | null; phones: PhoneContact[]; emails: EmailContact[] }) => [
  ...(p.cnpj ? [`cnpj:${p.cnpj}`] : []),
  ...p.phones.map((x) => `tel:${x.value}`),
  ...p.emails.map((x) => `email:${x.value}`),
  ...(p.site ? [`site:${new URL(p.site).hostname.replace(/^www\./, '')}`] : []),
  `nome:${nameKey(p.name)}`,
]

/**
 * Busca de leads (Atendimento Comercial): acha empresas do segmento e da região pedidos, com contatos comerciais
 * públicos conferidos (e-mail com domínio que recebe e-mail, telefone válido, WhatsApp sob pedido), tira quem já é
 * lead ou pediu para não ser contatado e deixa a equipe transformar em lead com um clique.
 */
@Injectable()
export class ProspeccaoService {
  private readonly logger = new Logger(ProspeccaoService.name)
  private readonly waRunning = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly capture: LeadCaptureService,
    private readonly whatsapp: WhatsappService,
  ) {}

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, MODULE, action)) throw new ForbiddenException('Seu perfil não pode usar a busca de leads.')
  }

  async config(tenantId: string): Promise<ProspeccaoConfig> {
    const c = await this.settings.get<Partial<ProspeccaoConfig>>(tenantId, CONFIG_KEY, {})
    return {
      provider: c.provider === 'gemini' ? 'gemini' : 'claude',
      claudeModel: (CLAUDE_MODELS as readonly string[]).includes(c.claudeModel ?? '') ? c.claudeModel! : DEFAULT_CONFIG.claudeModel,
      dailyLimit: Number.isInteger(c.dailyLimit) && c.dailyLimit! >= 1 && c.dailyLimit! <= 200 ? c.dailyLimit! : DEFAULT_CONFIG.dailyLimit,
      maxWebSearches: Number.isInteger(c.maxWebSearches) && c.maxWebSearches! >= 2 && c.maxWebSearches! <= 20 ? c.maxWebSearches! : DEFAULT_CONFIG.maxWebSearches,
    }
  }

  async key(tenantId: string, provider: AiProvider): Promise<string | null> {
    const r = await this.settings.get<{ enc?: string }>(tenantId, SECRET_KEY(provider), {})
    let enc = r.enc
    // Gemini: a chave do assistente ou, se não houver, a do e-mail marketing.
    if (!enc && provider === 'gemini') enc = (await this.settings.get<{ apiKeyEnc?: string | null }>(tenantId, 'email_ia', {})).apiKeyEnc ?? undefined
    if (!enc) return null
    try {
      return decrypt(enc)
    } catch {
      return null
    }
  }

  private todayStart() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    return new Date(Date.now() - ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000)
  }

  // ---------- Tela ----------

  async view(user: AuthUser) {
    this.assertCan(user, 'view')
    const [config, claude, gemini, searches, today] = await Promise.all([
      this.config(user.tenantId),
      this.key(user.tenantId, 'claude'),
      this.key(user.tenantId, 'gemini'),
      this.prisma.prospectSearch.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.prospectSearch.count({ where: { tenantId: user.tenantId, createdAt: { gte: this.todayStart() } } }),
    ])
    return {
      config,
      models: CLAUDE_MODELS,
      keys: { claude: !!claude, gemini: !!gemini },
      today,
      canConfig: can(user.permissions, user.role.isSystem, 'configuracoes', 'edit') || user.role.isSystem,
      searches: searches.map((s) => ({ ...this.fixStale(s), criteria: s.criteria as unknown as ProspectCriteria })),
    }
  }

  private fixStale<T extends { status: string; error: string | null; createdAt: Date }>(s: T): T {
    return s.status === 'GERANDO' && Date.now() - s.createdAt.getTime() > STALE_MS ? { ...s, status: 'ERRO', error: 'A busca foi interrompida. Faça de novo.' } : s
  }

  async saveConfig(user: AuthUser, d: Partial<ProspeccaoConfig>, ctx: RequestCtx) {
    if (!(can(user.permissions, user.role.isSystem, 'configuracoes', 'edit') || user.role.isSystem)) throw new ForbiddenException('Só quem cuida das configurações muda a IA e o limite da busca de leads.')
    const cur = await this.config(user.tenantId)
    const next = { ...cur, ...d }
    await this.settings.set(user.tenantId, CONFIG_KEY, next)
    const saved = await this.config(user.tenantId)
    await this.audit.byUser(user, ctx, 'prospeccao.configuracao', 'setting', CONFIG_KEY, { ...saved })
    return saved
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const s = await this.prisma.prospectSearch.findFirst({ where: { id, tenantId: user.tenantId }, include: { prospects: { orderBy: [{ score: 'desc' }, { name: 'asc' }] } } })
    if (!s) throw new NotFoundException('Busca não encontrada.')
    return { ...this.fixStale(s), criteria: s.criteria as unknown as ProspectCriteria, whatsappRunning: this.waRunning.has(s.id) }
  }

  // ---------- Buscar ----------

  async start(user: AuthUser, raw: Partial<Record<keyof ProspectCriteria, unknown>>, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const criteria = cleanCriteria(raw)
    if (!criteria.place) throw new BadRequestException('Informe a cidade, o estado ou o CEP.')
    if (!criteria.segment && !criteria.keywords.length) throw new BadRequestException('Informe o segmento ou palavras-chave.')
    const cfg = await this.config(user.tenantId)
    if (!(await this.key(user.tenantId, cfg.provider))) throw new BadRequestException(cfg.provider === 'claude' ? 'Falta a chave da Anthropic (Claude): cadastre em Atendimento Comercial › Análise das perdas (IA).' : 'Falta a chave do Gemini: cadastre em Marketplaces › Assistente ML › Configurações ou no e-mail marketing.')
    const today = await this.prisma.prospectSearch.count({ where: { tenantId: user.tenantId, createdAt: { gte: this.todayStart() } } })
    if (today >= cfg.dailyLimit) throw new BadRequestException(`Limite de ${cfg.dailyLimit} buscas por dia atingido. Volta amanhã (ou peça ao gestor para aumentar).`)
    if (await this.prisma.prospectSearch.count({ where: { tenantId: user.tenantId, status: 'GERANDO', createdAt: { gt: new Date(Date.now() - STALE_MS) } } })) throw new BadRequestException('Já tem uma busca em andamento. Aguarde terminar.')
    const s = await this.prisma.prospectSearch.create({ data: { tenantId: user.tenantId, criteria: criteria as unknown as Prisma.InputJsonValue, provider: cfg.provider, createdById: user.id, createdBy: user.name } })
    await this.audit.byUser(user, ctx, 'prospeccao.buscar', 'prospect_search', s.id, { ...criteria, ia: cfg.provider })
    void this.run(s.id)
    return s
  }

  private async run(id: string) {
    const s = await this.prisma.prospectSearch.findUnique({ where: { id } })
    if (!s) return
    const fail = (error: string) => this.prisma.prospectSearch.update({ where: { id }, data: { status: 'ERRO', error: error.slice(0, 500), finishedAt: new Date() } })
    try {
      const c = s.criteria as unknown as ProspectCriteria
      const cfg = await this.config(s.tenantId)
      const center = await geocode(c.place, cepOf(c.place))
      if (!center) return void (await fail(`Não achei o lugar "${c.place}". Use "cidade, UF" ou um CEP.`))
      await this.prisma.prospectSearch.update({ where: { id }, data: { centerLat: center.lat, centerLon: center.lon, centerLabel: center.label.slice(0, 200) } })
      const osm = await osmSearch(center, c.radiusKm, osmTerms(c))
      const candidates = osm.slice(0, 40).map((p) => ({ nome: p.name, endereco: [p.address, p.city, p.uf].filter(Boolean).join(', '), telefones: p.phones.map((x) => x.value), emails: p.emails.map((x) => x.value), site: p.site, ramo: p.kind }))
      const user = [
        `Busque até ${c.limit} empresas.`,
        `Segmento: ${c.segment || '(não informado)'}`,
        c.keywords.length ? `Interesse / palavras-chave: ${c.keywords.join(', ')}` : '',
        `Região: ${center.label}${c.radiusKm ? ` e até ${c.radiusKm} km ao redor` : ''} (${center.city ?? ''}${center.uf ? `/${center.uf}` : ''}).`,
        c.notes ? `Perfil ideal e observações: ${c.notes}` : '',
        candidates.length ? `Candidatos do mapa (OpenStreetMap), para conferir e completar:\n${JSON.stringify(candidates)}` : 'Sem candidatos do mapa nesta região: pesquise na web.',
      ]
        .filter(Boolean)
        .join('\n')
      const key = (await this.key(s.tenantId, cfg.provider))!
      const ai = cfg.provider === 'claude' ? await claudeSearch(key, cfg.claudeModel, user, cfg.maxWebSearches) : await geminiSearch(key, GEMINI_MODELS, user)
      const enriched = await this.enrich(prospectsFromAi(ai.input).slice(0, c.limit), osm)
      const kept = await this.filterKnown(s.tenantId, enriched, c.onlyWithContact)
      await this.prisma.prospect.createMany({
        data: kept.map((p) => ({
          tenantId: s.tenantId,
          searchId: id,
          name: p.name,
          cnpj: p.cnpj,
          segment: p.segment,
          city: p.city,
          uf: p.uf,
          address: p.address,
          site: p.site,
          instagram: p.instagram,
          phones: p.phones as unknown as Prisma.InputJsonValue,
          emails: p.emails as unknown as Prisma.InputJsonValue,
          score: p.score,
          reason: p.reason,
          sources: [...new Set([...p.sources, ...ai.sources])].slice(0, 8),
          distanceKm: p.lat !== null && p.lon !== null ? distanceKm(center, { lat: p.lat, lon: p.lon }) : null,
          cnpjStatus: p.cnpjStatus,
        })),
      })
      await this.prisma.prospectSearch.update({
        where: { id },
        data: { status: 'PRONTO', model: ai.model, found: kept.length, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, webSearches: ai.webSearches, costUsd: searchCost(cfg.provider, cfg.claudeModel, ai), finishedAt: new Date() },
      })
    } catch (e) {
      this.logger.warn(`Busca de leads ${id}: ${(e as Error).message}`)
      await fail((e as Error).message || 'Erro na busca.').catch(() => undefined)
    }
  }

  /** Junta os dados do mapa (mesmo nome), confere o CNPJ na Receita e o domínio de cada e-mail. */
  private async enrich(list: ProspectData[], osm: Awaited<ReturnType<typeof osmSearch>>) {
    const byName = new Map(osm.map((p) => [nameKey(p.name), p]))
    const mx = new Map<string, boolean>()
    const out: (ProspectData & { cnpjStatus: string | null })[] = []
    for (const p of list) {
      const m = byName.get(nameKey(p.name))
      let phones = [...p.phones, ...(m?.phones ?? [])]
      let emails = [...p.emails, ...(m?.emails ?? [])]
      let cnpjStatus: string | null = null
      if (p.cnpj) {
        const info = await cnpjLookup(p.cnpj)
        if (info) {
          cnpjStatus = info.status
          phones = [...phones, ...info.phones]
          emails = [...emails, ...info.emails]
        }
      }
      // Empresa baixada, inapta ou suspensa na Receita: fica de fora.
      if (cnpjStatus && !/ativa/i.test(cnpjStatus)) continue
      const merged = mergeEmails(emails)
      for (const e of merged) {
        const domain = e.value.split('@')[1]!
        if (!mx.has(domain)) mx.set(domain, await hasMx(domain))
        e.mx = mx.get(domain)!
      }
      out.push({ ...p, phones: mergePhones(phones), emails: merged.filter((e) => e.mx), site: p.site ?? m?.site ?? null, lat: m?.lat ?? null, lon: m?.lon ?? null, address: p.address ?? m?.address ?? null, cnpjStatus })
    }
    return out
  }

  /** Tira quem já é lead (mesmo telefone ou e-mail), quem está na lista de não contatar e, se pedido, quem ficou sem contato válido. */
  private async filterKnown(tenantId: string, list: (ProspectData & { cnpjStatus: string | null })[], onlyWithContact: boolean) {
    const phones = list.flatMap((p) => p.phones.map((x) => x.value))
    const emails = list.flatMap((p) => p.emails.map((x) => x.value))
    const leads = phones.length || emails.length ? await this.prisma.lead.findMany({ where: { tenantId, deletedAt: null, OR: [...(phones.length ? [{ phone: { in: phones } }] : []), ...(emails.length ? [{ email: { in: emails } }] : [])] }, select: { phone: true, email: true } }) : []
    const known = { phones: new Set(leads.map((l) => l.phone).filter((x): x is string => !!x)), emails: new Set(leads.map((l) => l.email).filter((x): x is string => !!x)) }
    const blocks = new Set((await this.prisma.prospectBlock.findMany({ where: { tenantId }, select: { key: true } })).map((b) => b.key))
    return list.filter((p) => !alreadyKnown(p, known) && !blockKeys(p).some((k) => blocks.has(k)) && (!onlyWithContact || hasValidContact(p)))
  }

  // ---------- WhatsApp ----------

  /** Confere, aos poucos, quais celulares da busca têm WhatsApp (pelo número da empresa conectado). */
  async checkWhatsapp(user: AuthUser, id: string) {
    this.assertCan(user, 'edit')
    const s = await this.prisma.prospectSearch.findFirst({ where: { id, tenantId: user.tenantId }, select: { id: true } })
    if (!s) throw new NotFoundException('Busca não encontrada.')
    const client = this.whatsapp.client
    const number = await this.prisma.whatsappNumber.findFirst({ where: { tenantId: user.tenantId, deletedAt: null, status: 'CONECTADO' }, orderBy: { createdAt: 'asc' } })
    if (!client || !number) throw new BadRequestException('Nenhum número de WhatsApp conectado para conferir.')
    if (this.waRunning.has(id)) return { started: false, message: 'A conferência já está em andamento.' }
    this.waRunning.add(id)
    void (async () => {
      try {
        const rows = await this.prisma.prospect.findMany({ where: { searchId: id, status: 'NOVO' }, orderBy: { score: 'desc' } })
        let checked = 0
        for (const r of rows) {
          const phones = r.phones as unknown as PhoneContact[]
          let changed = false
          for (const p of phones) {
            if (p.whatsapp !== null || checked >= WA_MAX) continue
            const variants = /^\+55(\d{2})9(\d{8})$/.exec(p.value) ? [p.value, p.value.replace(/^(\+55\d{2})9/, '$1')] : [p.value]
            try {
              p.whatsapp = !!whatsappOf(await client.checkNumbers(number.instanceName, variants.map((v) => v.slice(1))))?.exists
            } catch {
              continue
            }
            changed = true
            checked++
            await new Promise((res) => setTimeout(res, WA_GAP_MS))
          }
          if (changed) await this.prisma.prospect.update({ where: { id: r.id }, data: { phones: phones as unknown as Prisma.InputJsonValue } })
          if (checked >= WA_MAX) break
        }
      } finally {
        this.waRunning.delete(id)
      }
    })()
    return { started: true, message: `Conferindo até ${WA_MAX} números, um a cada ${WA_GAP_MS / 1000} segundos.` }
  }

  // ---------- Ações em cada empresa ----------

  private async prospect(user: AuthUser, id: string) {
    const p = await this.prisma.prospect.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!p) throw new NotFoundException('Empresa não encontrada.')
    return p
  }

  /** Vira lead (origem "Prospecção"), com o melhor contato: WhatsApp confirmado, celular, fixo; e-mail com MX. */
  async toLead(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const p = await this.prospect(user, id)
    if (p.leadId) return { leadId: p.leadId }
    const r = await this.leadFor(user.tenantId, id)
    await this.audit.byUser(user, ctx, 'prospeccao.virou_lead', 'prospect', id, { empresa: p.name, lead: r.leadId })
    return r
  }

  /** Lead da empresa (cria na primeira vez), também usado pelo chat e pelo envio em fila. */
  async leadFor(tenantId: string, id: string, phoneOverride?: string | null) {
    const p = await this.prisma.prospect.findFirst({ where: { id, tenantId } })
    if (!p) throw new NotFoundException('Empresa não encontrada.')
    if (p.leadId) return { leadId: p.leadId }
    const phones = p.phones as unknown as PhoneContact[]
    const emails = p.emails as unknown as EmailContact[]
    const phone = phones.find((x) => x.whatsapp === true) ?? phones.find((x) => x.kind === 'celular' && x.whatsapp !== false) ?? phones[0]
    const email = emails.find((x) => x.mx === true)
    const r = await this.capture.capture(
      tenantId,
      { name: p.name, company: p.name, phone: phoneOverride ?? phone?.value ?? null, email: email?.value ?? null, city: p.city, state: p.uf },
      {
        title: `Encontrado na busca de leads${p.segment ? ` (${p.segment})` : ''}`,
        originName: ORIGIN,
        touch: { source: 'prospeccao', medium: 'busca de leads' },
        details: { segmento: p.segment, nota: p.score, motivo: p.reason, site: p.site, instagram: p.instagram, cnpj: p.cnpj },
        tags: ['prospeccao'],
      },
    )
    if (!r) throw new BadRequestException('Sem telefone nem e-mail válido para criar o lead.')
    await this.prisma.prospect.update({ where: { id }, data: { status: 'LEAD', leadId: r.leadId } })
    return { leadId: r.leadId }
  }

  async discard(user: AuthUser, id: string) {
    this.assertCan(user, 'edit')
    await this.prospect(user, id)
    await this.prisma.prospect.update({ where: { id }, data: { status: 'DESCARTADO' } })
    return { ok: true }
  }

  /** Não contatar: a empresa (CNPJ, telefones, e-mails, site e nome) nunca volta numa busca. */
  async doNotContact(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const p = await this.prospect(user, id)
    await this.block(user.tenantId, p, user.name)
    await this.audit.byUser(user, ctx, 'prospeccao.nao_contatar', 'prospect', id, { empresa: p.name })
    return { ok: true }
  }

  /** Bloqueia a empresa (nunca volta numa busca nem recebe envio). */
  async block(tenantId: string, p: { id: string; cnpj: string | null; name: string; site: string | null; phones: unknown; emails: unknown }, by: string) {
    const keys = blockKeys({ cnpj: p.cnpj, name: p.name, site: p.site, phones: p.phones as unknown as PhoneContact[], emails: p.emails as unknown as EmailContact[] })
    await this.prisma.prospectBlock.createMany({ data: keys.map((key) => ({ tenantId, key, name: p.name, createdBy: by })), skipDuplicates: true })
    await this.prisma.prospect.update({ where: { id: p.id }, data: { status: 'NAO_CONTATAR' } })
  }
}
