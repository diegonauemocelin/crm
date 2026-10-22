import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { CapturaService } from '../captura/captura.service'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { EmailAiService } from '../email/ia.service'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { classifyDevice, domainAllowed } from '../rastreamento/origem'
import { RastreamentoService } from '../rastreamento/rastreamento.service'
import { SettingsService } from '../settings/settings.service'
import { BACKGROUNDS, BLOCKS, type Block, cleanBlocks, cleanSeo, cleanSlug, cleanTheme, DEFAULT_SEO, DEFAULT_THEME, FONTS, ICONS, RESERVED_SLUGS, type Theme } from './blocos'
import { improvePrompt, type LpBrief, type LpOutline, lpSystem, outlinePrompt, pagePrompt, parseJson, parseOutlines } from './ia'
import { TEMPLATES } from './modelos'
import { renderLanding, type RenderInput } from './render'

export interface LandingSettings {
  /** Subdomínio das páginas (ex.: lp.usaparts.com.br). Vazio = só pelo endereço do CRM (/lp/...). */
  domain: string
  /** GA4: ID de medição (G-XXXXXXX). */
  ga4Id: string
  /** Meta Pixel: ID do pixel. */
  pixelId: string
  /** Usar a tag de conversão do Google Ads da Captura (formulário e WhatsApp). */
  useAdsTag: boolean
  cookieText: string
  /** Para onde vai quem abre o subdomínio sem página (ex.: o site da empresa). */
  homeUrl: string
}

export const DEFAULT_LANDING: LandingSettings = {
  domain: '',
  ga4Id: '',
  pixelId: '',
  useAdsTag: true,
  cookieText: 'Usamos cookies para medir as visitas desta página e melhorar nossos anúncios. Você pode aceitar ou recusar.',
  homeUrl: '',
}

const KEY = 'landing'
const EVENT_TYPES = new Set(['view', 'scroll', 'cta', 'whatsapp', 'lead'])
const UUID = /^[0-9a-f-]{36}$/
const VISITOR = /^[a-f0-9]{16,40}$/
const CACHE_MS = 5 * 60_000
const DAY = 86_400_000

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

@Injectable()
export class LandingService {
  /** Página pronta em HTML por versão (A/B), por alguns minutos: cada visita de anúncio não remonta a página. */
  private readonly cache = new Map<string, { html: string; at: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly captura: CapturaService,
    private readonly tracking: RastreamentoService,
    private readonly ai: EmailAiService,
  ) {}

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'email_marketing', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  async config(tenantId: string) {
    return this.settings.get<LandingSettings>(tenantId, KEY, DEFAULT_LANDING)
  }

  async saveConfig(user: AuthUser, d: Partial<LandingSettings>, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const cur = await this.config(user.tenantId)
    const domain = (d.domain ?? cur.domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new BadRequestException('Subdomínio inválido. Ex.: lp.usaparts.com.br')
    const ga4Id = (d.ga4Id ?? cur.ga4Id).trim().toUpperCase()
    if (ga4Id && !/^G-[A-Z0-9]{4,15}$/.test(ga4Id)) throw new BadRequestException('ID de medição do GA4 inválido. Ele começa com G- (ex.: G-ABC123XYZ).')
    const pixelId = (d.pixelId ?? cur.pixelId).trim()
    if (pixelId && !/^\d{10,20}$/.test(pixelId)) throw new BadRequestException('ID do Meta Pixel inválido: são só números.')
    const homeUrl = (d.homeUrl ?? cur.homeUrl).trim()
    if (homeUrl && !/^https:\/\/[^\s]+$/.test(homeUrl)) throw new BadRequestException('Endereço do site inválido (use https://...).')
    const next: LandingSettings = { domain, ga4Id, pixelId, homeUrl, useAdsTag: d.useAdsTag ?? cur.useAdsTag, cookieText: (d.cookieText ?? cur.cookieText).trim().slice(0, 300) || DEFAULT_LANDING.cookieText }
    await this.settings.set(user.tenantId, KEY, next)
    this.cache.clear()
    await this.audit.byUser(user, ctx, 'landing.config_updated', 'settings', KEY, { ...next })
    return next
  }

  /** Endereço público da página: no subdomínio, ou pelo CRM enquanto o subdomínio não estiver configurado. */
  publicUrl(s: LandingSettings, slug: string) {
    return s.domain ? `https://${s.domain}/${slug}` : `${env.appUrl}/lp/${slug}`
  }

  // ---------- Telas ----------

  /** Catálogo dos blocos, modelos e opções que o editor precisa (formulários e botões de WhatsApp da Captura). */
  async options(user: AuthUser) {
    this.assertCan(user, 'view')
    const T = user.tenantId
    const [forms, whatsapps, s, ai] = await Promise.all([
      this.prisma.captureForm.findMany({ where: { tenantId: T, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.captureWhatsapp.findMany({ where: { tenantId: T, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.config(T),
      this.ai.available(T),
    ])
    return {
      blocks: BLOCKS,
      backgrounds: BACKGROUNDS,
      fonts: FONTS,
      icons: Object.entries(ICONS).map(([key, i]) => ({ key, label: i.label, svg: i.svg })),
      templates: TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, goal: t.goal, blocks: t.blocks.map((b) => String(b.type)) })),
      forms,
      whatsapps,
      config: s,
      aiAvailable: ai,
      base: s.domain ? `https://${s.domain}/` : `${env.appUrl}/lp/`,
    }
  }

  async list(user: AuthUser) {
    this.assertCan(user, 'view')
    const T = user.tenantId
    const pages = await this.prisma.landingPage.findMany({ where: { tenantId: T, deletedAt: null }, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, slug: true, status: true, abActive: true, publishedAt: true, updatedAt: true } })
    const since = new Date(Date.now() - 30 * DAY)
    const stats = pages.length
      ? await this.prisma.$queryRaw<{ pageId: string; visitors: bigint; leads: bigint }[]>`
          SELECT "pageId", count(DISTINCT visitor) FILTER (WHERE type = 'view') AS visitors, count(*) FILTER (WHERE type = 'lead') AS leads
          FROM landing_events WHERE "tenantId" = ${T}::uuid AND "occurredAt" >= ${since} GROUP BY "pageId"`
      : []
    const s = await this.config(T)
    return pages.map((p) => {
      const st = stats.find((x) => x.pageId === p.id)
      const visitors = Number(st?.visitors ?? 0)
      const leads = Number(st?.leads ?? 0)
      return { ...p, url: this.publicUrl(s, p.slug), visitors30: visitors, leads30: leads, conversion30: visitors ? Math.round((leads / visitors) * 1000) / 10 : null }
    })
  }

  private async load(user: AuthUser, id: string) {
    const p = await this.prisma.landingPage.findFirst({ where: { id, tenantId: user.tenantId, deletedAt: null } })
    if (!p) throw new NotFoundException('Landing page não encontrada.')
    return p
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const p = await this.load(user, id)
    return { ...p, url: this.publicUrl(await this.config(user.tenantId), p.slug) }
  }

  /** Tema inicial com as cores da marca (Configurações › Marca). */
  private async brandTheme(tenantId: string, extra: Partial<Theme> = {}): Promise<Theme> {
    const b = await this.settings.branding(tenantId)
    const brand = b.brandColor || b.primaryColor
    return cleanTheme({ ...DEFAULT_THEME, primary: brand, accent: b.primaryColor, ...extra })
  }

  /** Endereço livre: o pedido, ou com -2, -3... se já existir outra página com ele. */
  private async freeSlug(tenantId: string, wanted: string, exceptId?: string) {
    let base = cleanSlug(wanted) || 'pagina'
    if (RESERVED_SLUGS.has(base)) base = `${base}-lp`
    for (let i = 1; i < 100; i++) {
      const slug = i === 1 ? base : `${base}-${i}`
      const taken = await this.prisma.landingPage.findFirst({ where: { tenantId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })
      if (!taken) return slug
    }
    throw new BadRequestException('Não foi possível gerar um endereço livre para a página.')
  }

  /** Formulários sem escolha recebem o primeiro formulário ativo da Captura (dá para trocar no editor). */
  private async withDefaultForm(tenantId: string, blocks: Block[]) {
    if (!blocks.some((b) => b.type === 'formulario' && !b.formId)) return blocks
    const form = await this.prisma.captureForm.findFirst({ where: { tenantId, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    return form ? blocks.map((b) => (b.type === 'formulario' && !b.formId ? { ...b, formId: form.id } : b)) : blocks
  }

  async create(user: AuthUser, d: { name?: string; template?: string; blocks?: unknown; seo?: unknown; theme?: unknown }, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const T = user.tenantId
    const tpl = d.template ? TEMPLATES.find((t) => t.key === d.template) : null
    if (d.template && !tpl) throw new BadRequestException('Modelo não encontrado.')
    const name = (d.name ?? '').trim().slice(0, 120) || tpl?.name || 'Nova landing page'
    const cleaned = cleanBlocks(d.blocks ?? tpl?.blocks ?? [{ type: 'hero', variant: 'imagem-direita', title: name, action: 'formulario', ctaText: 'Pedir orçamento' }, { type: 'formulario', variant: 'lado-a-lado', title: 'Fale com a gente' }])
    if ('error' in cleaned) throw new BadRequestException(cleaned.error)
    const theme = d.theme ? cleanTheme(d.theme, await this.brandTheme(T, tpl?.theme)) : await this.brandTheme(T, tpl?.theme)
    const page = await this.prisma.landingPage.create({
      data: {
        tenantId: T,
        name,
        slug: await this.freeSlug(T, name),
        theme: theme as unknown as Prisma.InputJsonValue,
        blocks: (await this.withDefaultForm(T, cleaned.blocks)) as unknown as Prisma.InputJsonValue,
        seo: cleanSeo({ ...DEFAULT_SEO, ...tpl?.seo, ...((d.seo as object) ?? {}) }) as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
    })
    await this.audit.byUser(user, ctx, 'landing.created', 'landing_page', page.id, { nome: name, modelo: tpl?.key ?? null })
    return page
  }

  async save(user: AuthUser, id: string, d: { name?: string; slug?: string; theme?: unknown; blocks?: unknown; blocksB?: unknown; abActive?: boolean; abSplit?: number; seo?: unknown }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const p = await this.load(user, id)
    const data: Prisma.LandingPageUpdateInput = {}
    if (d.name !== undefined) {
      const name = d.name.trim().slice(0, 120)
      if (!name) throw new BadRequestException('Dê um nome à página.')
      data.name = name
    }
    if (d.slug !== undefined) {
      const slug = cleanSlug(d.slug)
      if (!slug) throw new BadRequestException('Informe o endereço da página (letras, números e hífen).')
      if (RESERVED_SLUGS.has(slug)) throw new BadRequestException('Este endereço é reservado. Escolha outro.')
      if (await this.prisma.landingPage.findFirst({ where: { tenantId: user.tenantId, slug, id: { not: id } }, select: { id: true } })) throw new BadRequestException('Já existe outra página com este endereço.')
      data.slug = slug
    }
    if (d.theme !== undefined) data.theme = cleanTheme(d.theme, p.theme as unknown as Theme) as unknown as Prisma.InputJsonValue
    if (d.blocks !== undefined) {
      const c = cleanBlocks(d.blocks)
      if ('error' in c) throw new BadRequestException(c.error)
      data.blocks = c.blocks as unknown as Prisma.InputJsonValue
    }
    if (d.blocksB !== undefined) {
      if (d.blocksB === null) data.blocksB = Prisma.DbNull
      else {
        const c = cleanBlocks(d.blocksB)
        if ('error' in c) throw new BadRequestException(`Versão B: ${c.error}`)
        data.blocksB = c.blocks as unknown as Prisma.InputJsonValue
      }
    }
    if (d.abSplit !== undefined) data.abSplit = Math.min(90, Math.max(10, Math.round(Number(d.abSplit) || 50)))
    if (d.abActive !== undefined) data.abActive = d.abActive === true
    if (d.seo !== undefined) data.seo = cleanSeo(d.seo) as unknown as Prisma.InputJsonValue
    const next = await this.prisma.landingPage.update({ where: { id }, data })
    if (next.abActive && !Array.isArray(next.blocksB)) await this.prisma.landingPage.update({ where: { id }, data: { abActive: false } })
    this.cache.clear()
    await this.audit.byUser(user, ctx, 'landing.updated', 'landing_page', id, { nome: next.name, campos: Object.keys(data) })
    return this.get(user, id)
  }

  async duplicate(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const p = await this.load(user, id)
    const name = `${p.name} (cópia)`.slice(0, 120)
    const copy = await this.prisma.landingPage.create({
      data: { tenantId: user.tenantId, name, slug: await this.freeSlug(user.tenantId, name), theme: p.theme as Prisma.InputJsonValue, blocks: p.blocks as Prisma.InputJsonValue, seo: p.seo as Prisma.InputJsonValue, createdById: user.id },
    })
    await this.audit.byUser(user, ctx, 'landing.duplicated', 'landing_page', copy.id, { origem: p.id })
    return copy
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const p = await this.load(user, id)
    // O endereço fica livre para outra página.
    await this.prisma.landingPage.update({ where: { id }, data: { deletedAt: new Date(), status: 'PAUSADA', slug: `${p.slug}--excluida-${Date.now().toString(36)}` } })
    this.cache.clear()
    await this.audit.byUser(user, ctx, 'landing.removed', 'landing_page', id, { nome: p.name })
    return { ok: true }
  }

  /** O que impede ou atrapalha publicar (ex.: formulário sem escolha, WhatsApp sem número). */
  problems(p: { blocks: unknown; blocksB?: unknown; theme: unknown }, forms: Set<string>) {
    const out: string[] = []
    const t = p.theme as Theme
    const all = [...((p.blocks as Block[]) ?? []), ...((Array.isArray(p.blocksB) ? p.blocksB : []) as Block[])]
    if (!all.length) out.push('A página não tem nenhum bloco.')
    if (!all.some((b) => b.type === 'formulario' || b.type === 'whatsapp')) out.push('Inclua um bloco de Formulário ou de WhatsApp: sem ele a página não gera contato.')
    for (const b of all) {
      if (b.type === 'formulario' && (!b.formId || !forms.has(String(b.formId)))) out.push('Um bloco de Formulário está sem formulário de captura ativo.')
      if (b.type === 'whatsapp' && b.mode !== 'captura' && !t.whatsapp) out.push('O bloco de WhatsApp precisa do número em Tema › WhatsApp.')
      if (b.type === 'whatsapp' && b.mode === 'captura' && !b.whatsappId) out.push('O bloco de WhatsApp com captura está sem o botão escolhido.')
      if (b.action === 'whatsapp' && !t.whatsapp && !all.some((x) => x.type === 'whatsapp')) out.push(`O botão "${String(b.ctaText || '')}" abre o WhatsApp, mas a página não tem o número (Tema › WhatsApp).`)
      if (typeof b.title === 'string' && /\[[^\]]+\]/.test(b.title)) out.push(`Há texto para completar entre colchetes: "${b.title}".`)
    }
    return [...new Set(out)]
  }

  async publish(user: AuthUser, id: string, publish: boolean, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const p = await this.load(user, id)
    if (publish) {
      const forms = new Set((await this.prisma.captureForm.findMany({ where: { tenantId: user.tenantId, active: true }, select: { id: true } })).map((f) => f.id))
      const blocking = this.problems(p, forms).filter((x) => !x.startsWith('Há texto'))
      if (blocking.length) throw new BadRequestException(`Antes de publicar: ${blocking.join(' ')}`)
    }
    await this.prisma.landingPage.update({ where: { id }, data: publish ? { status: 'PUBLICADA', publishedAt: p.publishedAt ?? new Date() } : { status: 'PAUSADA' } })
    this.cache.clear()
    await this.audit.byUser(user, ctx, publish ? 'landing.published' : 'landing.paused', 'landing_page', id, { nome: p.name, endereco: p.slug })
    return this.get(user, id)
  }

  // ---------- Montagem da página ----------

  private async renderInput(tenantId: string, page: { id: string; name: string; slug: string; theme: unknown; seo: unknown }, blocks: Block[], variant: 'A' | 'B', preview: boolean): Promise<RenderInput> {
    const [s, branding, pub, track] = await Promise.all([this.config(tenantId), this.settings.branding(tenantId), this.captura.publicConfig(tenantId), this.tracking.config(tenantId)])
    const formIds = new Set(blocks.filter((b) => b.type === 'formulario').map((b) => String(b.formId)))
    const waIds = new Set(blocks.filter((b) => b.type === 'whatsapp' && b.mode === 'captura').map((b) => String(b.whatsappId)))
    const forms = Object.fromEntries(Object.entries(pub.forms as Record<string, { fields: RenderInput['forms'][string]['fields']; submitLabel: string; successMessage: string; consentText: string | null }>).filter(([k]) => formIds.has(k)))
    const whatsapps = Object.fromEntries(
      (pub.whatsapps as { id: string; fields: RenderInput['forms'][string]['fields']; buttonText: string }[]).filter((w) => waIds.has(w.id)).map((w) => [w.id, { fields: w.fields, buttonText: w.buttonText }]),
    )
    const ads = s.useAdsTag && pub.adsTag ? { tagId: pub.adsTag.tagId, formSendTo: pub.adsTag.formSendTo, whatsappSendTo: pub.adsTag.whatsappSendTo } : null
    // Script de rastreamento do CRM (liga a visita ao lead e à venda) quando o subdomínio é um dos domínios do site.
    const crmScript = track.enabled && track.siteKey && s.domain && domainAllowed(s.domain, track.domains) ? `${env.appUrl}/api/public/rastreamento/script.js?k=${track.siteKey}` : null
    return {
      page: { id: page.id, name: page.name, slug: page.slug, theme: cleanTheme(page.theme), blocks, seo: cleanSeo(page.seo) },
      variant,
      brand: { name: branding.shortName || branding.appName, logoUrl: branding.logoFileId ? `${env.appUrl}/api/files/public/${branding.logoFileId}` : null, companyInfo: branding.companyInfo ?? '', privacyUrl: pub.privacyUrl ?? null },
      forms,
      whatsapps,
      tracking: { ga4: s.ga4Id || null, pixel: s.pixelId || null, ads: ads?.tagId || ads?.formSendTo || ads?.whatsappSendTo ? ads : null, crmScript, cookieText: s.cookieText },
      url: this.publicUrl(s, page.slug),
      preview,
    }
  }

  /** Prévia do editor (o que está na tela, ainda não salvo). */
  async preview(user: AuthUser, d: { id?: string; name?: string; slug?: string; theme?: unknown; blocks?: unknown; seo?: unknown }) {
    this.assertCan(user, 'view')
    const c = cleanBlocks(d.blocks ?? [])
    if ('error' in c) throw new BadRequestException(c.error)
    const html = renderLanding(await this.renderInput(user.tenantId, { id: d.id && UUID.test(d.id) ? d.id : '00000000-0000-0000-0000-000000000000', name: (d.name ?? 'Prévia').slice(0, 120), slug: cleanSlug(d.slug) || 'previa', theme: cleanTheme(d.theme), seo: d.seo ?? {} }, c.blocks, 'A', true))
    return { html }
  }

  /**
   * Página publicada pelo endereço (subdomínio ou /lp/ do CRM). Com teste A/B, a versão vem do cookie do visitante
   * (ou é sorteada na primeira visita). null = não existe ou não está publicada.
   */
  async publicPage(host: string | undefined, slug: string, cookieVariant: string | undefined) {
    const clean = cleanSlug(slug)
    if (!clean || clean !== slug.toLowerCase()) return null
    const pages = await this.prisma.landingPage.findMany({ where: { slug: clean, status: 'PUBLICADA', deletedAt: null }, take: 5 })
    if (!pages.length) return null
    let page = pages[0]!
    if (pages.length > 1 && host) {
      const h = host.toLowerCase().split(':')[0]!
      for (const p of pages) if ((await this.config(p.tenantId)).domain === h) page = p
    }
    const hasB = page.abActive && Array.isArray(page.blocksB) && page.blocksB.length > 0
    const variant: 'A' | 'B' = !hasB ? 'A' : cookieVariant === 'A' || cookieVariant === 'B' ? cookieVariant : Math.random() * 100 < page.abSplit ? 'B' : 'A'
    const key = `${page.id}:${variant}:${page.updatedAt.getTime()}`
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return { html: hit.html, variant, pageId: page.id, ab: hasB }
    const blocks = (variant === 'B' ? page.blocksB : page.blocks) as Block[]
    const html = renderLanding(await this.renderInput(page.tenantId, page, blocks, variant, false))
    if (this.cache.size > 200) this.cache.clear()
    this.cache.set(key, { html, at: Date.now() })
    return { html, variant, pageId: page.id, ab: hasB }
  }

  /** Para onde vai quem abre o subdomínio sem o endereço de uma página. */
  async homeFor(host: string | undefined) {
    const h = host?.toLowerCase().split(':')[0]
    if (!h) return null
    const row = await this.prisma.tenantSetting.findFirst({ where: { key: KEY, value: { path: ['domain'], equals: h } } })
    return row ? ((row.value as Partial<LandingSettings>).homeUrl ?? null) || null : null
  }

  // ---------- Coleta pública ----------

  private async publishedPage(id: unknown) {
    if (typeof id !== 'string' || !UUID.test(id)) return null
    return this.prisma.landingPage.findFirst({ where: { id, status: 'PUBLICADA', deletedAt: null }, select: { id: true, tenantId: true, name: true, blocks: true, blocksB: true } })
  }

  /** Visita, rolagem e cliques. Qualquer coisa fora do esperado é descartada em silêncio. */
  async event(raw: unknown, userAgent?: string) {
    const b = (raw ?? {}) as Record<string, unknown>
    if (!EVENT_TYPES.has(String(b.e)) || b.e === 'lead' || typeof b.v !== 'string' || !VISITOR.test(b.v)) return
    const page = await this.publishedPage(b.p)
    if (!page) return
    // Mesma visita contada uma vez por tipo a cada 30 minutos (recarregar a página não infla os números).
    const recent = await this.prisma.landingEvent.findFirst({ where: { pageId: page.id, visitor: b.v, type: String(b.e), occurredAt: { gte: new Date(Date.now() - 30 * 60_000) } }, select: { id: true } })
    if (recent) return
    await this.prisma.landingEvent.create({
      data: { tenantId: page.tenantId, pageId: page.id, variant: b.x === 'B' ? 'B' : 'A', type: String(b.e), visitor: b.v, source: clip(b.s, 80), medium: clip(b.m, 60), campaign: clip(b.c, 150), device: classifyDevice(userAgent, null, []) },
    })
  }

  /**
   * Formulário (ou WhatsApp com captura) da página: o lead nasce pela Captura, com a página como origem, e a
   * conversão fica registrada na página (versão A/B e origem da visita).
   */
  async submit(raw: unknown, meta: { ip: string | null; userAgent?: string }) {
    const b = (raw ?? {}) as Record<string, unknown>
    const page = await this.publishedPage(b.p)
    if (!page) return { ok: false, message: 'Esta página não está mais no ar.' }
    const kind = b.kind === 'whatsapp' ? 'whatsapp' : 'form'
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : ''
    // Só formulários e botões que estão mesmo na página.
    const blocks = [...((page.blocks as Block[]) ?? []), ...((Array.isArray(page.blocksB) ? page.blocksB : []) as Block[])]
    const used = blocks.some((x) => (kind === 'form' ? x.type === 'formulario' && x.formId === id : x.type === 'whatsapp' && x.whatsappId === id))
    if (!id || !used) return { ok: false, message: 'Formulário inválido.' }
    const r = await this.captura.submit(
      page.tenantId,
      {
        k: '',
        kind: kind === 'form' ? 'landing' : 'whatsapp',
        ...(kind === 'form' ? { formId: id } : { whatsappId: id }),
        v: typeof b.cv === 'string' ? b.cv.slice(0, 80) : undefined,
        u: typeof b.u === 'string' ? b.u.slice(0, 1000) : undefined,
        d: b.d && typeof b.d === 'object' ? (b.d as Record<string, unknown>) : {},
        consent: b.consent === true,
        hp: typeof b.hp === 'string' ? b.hp : '',
        t: typeof b.t === 'number' ? b.t : undefined,
      },
      meta,
    )
    const { leadId, ...result } = r
    if (r.ok && leadId) {
      await this.prisma.landingEvent.create({
        data: { tenantId: page.tenantId, pageId: page.id, variant: b.x === 'B' ? 'B' : 'A', type: 'lead', visitor: typeof b.v === 'string' && VISITOR.test(b.v) ? b.v : 'sem-id', source: clip(b.s, 80), medium: clip(b.m, 60), campaign: clip(b.c, 150), device: classifyDevice(meta.userAgent, null, []), leadId },
      })
    }
    return result
  }

  // ---------- Métricas ----------

  async metrics(user: AuthUser, id: string, q: { from?: string; to?: string }) {
    this.assertCan(user, 'view')
    const p = await this.load(user, id)
    const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
    const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY).toISOString().slice(0, 10)
    const start = new Date(`${from}T00:00:00-03:00`)
    const end = new Date(Date.parse(`${to}T00:00:00-03:00`) + DAY)
    const [byVariant, byDay, bySource, leads] = await Promise.all([
      this.prisma.$queryRaw<{ variant: string; visitors: bigint; views: bigint; scroll: bigint; cta: bigint; whatsapp: bigint; leads: bigint }[]>`
        SELECT variant, count(DISTINCT visitor) FILTER (WHERE type = 'view') AS visitors, count(*) FILTER (WHERE type = 'view') AS views,
          count(*) FILTER (WHERE type = 'scroll') AS scroll, count(*) FILTER (WHERE type = 'cta') AS cta, count(*) FILTER (WHERE type = 'whatsapp') AS whatsapp, count(*) FILTER (WHERE type = 'lead') AS leads
        FROM landing_events WHERE "pageId" = ${p.id}::uuid AND "occurredAt" >= ${start} AND "occurredAt" < ${end} GROUP BY variant ORDER BY variant`,
      this.prisma.$queryRaw<{ day: string; visitors: bigint; leads: bigint }[]>`
        SELECT to_char(("occurredAt" AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS day, count(DISTINCT visitor) FILTER (WHERE type = 'view') AS visitors, count(*) FILTER (WHERE type = 'lead') AS leads
        FROM landing_events WHERE "pageId" = ${p.id}::uuid AND "occurredAt" >= ${start} AND "occurredAt" < ${end} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ source: string | null; medium: string | null; campaign: string | null; visitors: bigint; cta: bigint; leads: bigint }[]>`
        SELECT source, medium, campaign, count(DISTINCT visitor) FILTER (WHERE type = 'view') AS visitors, count(*) FILTER (WHERE type IN ('cta','whatsapp')) AS cta, count(*) FILTER (WHERE type = 'lead') AS leads
        FROM landing_events WHERE "pageId" = ${p.id}::uuid AND "occurredAt" >= ${start} AND "occurredAt" < ${end} GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 30`,
      this.prisma.landingEvent.findMany({ where: { pageId: p.id, type: 'lead', occurredAt: { gte: start, lt: end }, leadId: { not: null } }, select: { leadId: true, occurredAt: true, variant: true } }),
    ])
    // Vendas: atendimento de Pré-Vendas do lead marcado como venda, aberto a partir do envio na página.
    const leadIds = [...new Set(leads.map((l) => l.leadId!))]
    const sales = leadIds.length
      ? await this.prisma.serviceRecord.findMany({ where: { tenantId: user.tenantId, deletedAt: null, kind: 'PRE_VENDAS', saleStatus: 'SIM', leadId: { in: leadIds }, leadAt: { gte: new Date(start.getTime() - DAY) } }, select: { leadId: true, saleValue: true } })
      : []
    const variantOfLead = new Map(leads.map((l) => [l.leadId!, l.variant]))
    const n = (v: bigint | undefined) => Number(v ?? 0)
    const variants = (['A', 'B'] as const)
      .map((v) => {
        const r = byVariant.find((x) => x.variant === v)
        const vs = sales.filter((s) => variantOfLead.get(s.leadId!) === v)
        const visitors = n(r?.visitors)
        const leadsN = n(r?.leads)
        return {
          variant: v,
          visitors,
          views: n(r?.views),
          scroll: n(r?.scroll),
          cta: n(r?.cta),
          whatsapp: n(r?.whatsapp),
          leads: leadsN,
          conversion: visitors ? Math.round((leadsN / visitors) * 1000) / 10 : null,
          sales: vs.length,
          revenue: Math.round(vs.reduce((a, s) => a + Number(s.saleValue ?? 0), 0) * 100) / 100,
        }
      })
      .filter((v) => v.variant === 'A' || v.visitors || v.leads)
    return {
      period: { from, to },
      ab: p.abActive,
      variants,
      totals: variants.reduce((a, v) => ({ visitors: a.visitors + v.visitors, leads: a.leads + v.leads, cta: a.cta + v.cta + v.whatsapp, sales: a.sales + v.sales, revenue: Math.round((a.revenue + v.revenue) * 100) / 100 }), { visitors: 0, leads: 0, cta: 0, sales: 0, revenue: 0 }),
      byDay: byDay.map((d) => ({ day: d.day, visitors: n(d.visitors), leads: n(d.leads) })),
      bySource: bySource.map((s) => ({ source: s.source ?? 'direto', medium: s.medium ?? '', campaign: s.campaign ?? '', visitors: n(s.visitors), clicks: n(s.cta), leads: n(s.leads) })),
    }
  }

  // ---------- IA ----------

  private async aiReady(tenantId: string) {
    if (!(await this.ai.available(tenantId))) throw new BadRequestException('Para usar a IA, cadastre a chave do Gemini em Configurações › E-mail marketing (é gratuita no Google AI Studio).')
    const b = await this.settings.branding(tenantId)
    return lpSystem(b.shortName || b.appName, await this.ai.about(tenantId))
  }

  private brief(d: Partial<LpBrief>): LpBrief {
    const goal = String(d.goal ?? '').trim().slice(0, 600)
    if (goal.length < 10) throw new BadRequestException('Descreva o objetivo da página (ex.: captar orçamentos de filtros Komatsu PC200 vindos do Google Ads).')
    return { goal, audience: String(d.audience ?? '').slice(0, 300), offer: String(d.offer ?? '').slice(0, 400), channel: String(d.channel ?? '').slice(0, 80), language: d.language === 'es' ? 'es' : 'pt' }
  }

  async aiOutlines(user: AuthUser, d: Partial<LpBrief>) {
    this.assertCan(user, 'create')
    const system = await this.aiReady(user.tenantId)
    const options = parseOutlines(await this.ai.complete(user.tenantId, system, outlinePrompt(this.brief(d)), 1500))
    if (!options.length) throw new BadRequestException('A IA não respondeu no formato esperado. Tente de novo ou detalhe mais o objetivo.')
    return { options }
  }

  async aiBuild(user: AuthUser, d: Partial<LpBrief> & { outline?: LpOutline }) {
    this.assertCan(user, 'create')
    const system = await this.aiReady(user.tenantId)
    const o = d.outline
    if (!o || !Array.isArray(o.blocks) || !o.blocks.length) throw new BadRequestException('Escolha uma das estruturas sugeridas.')
    const brief = this.brief(d)
    const answer = parseJson(await this.ai.complete(user.tenantId, system, pagePrompt(brief, { title: String(o.title).slice(0, 80), angle: String(o.angle ?? '').slice(0, 240), blocks: o.blocks.map(String).slice(0, 14) }), 8000)) as { seo?: unknown; blocks?: unknown } | null
    const c = cleanBlocks(answer?.blocks)
    if (!answer || 'error' in c || !c.blocks.length) throw new BadRequestException('A IA não montou a página no formato esperado. Tente de novo.')
    return { blocks: await this.withDefaultForm(user.tenantId, c.blocks), seo: cleanSeo(answer.seo), theme: brief.language === 'es' ? { whatsappMessage: '¡Hola! Vengo de la página {pagina} y quisiera una cotización.' } : {} }
  }

  async aiImprove(user: AuthUser, d: { block?: unknown; instruction?: string }) {
    this.assertCan(user, 'edit')
    const system = await this.aiReady(user.tenantId)
    const c = cleanBlocks([d.block])
    if ('error' in c) throw new BadRequestException(c.error)
    const original = c.blocks[0]!
    const answer = parseJson(await this.ai.complete(user.tenantId, system, improvePrompt(original, String(d.instruction ?? '').slice(0, 300)), 3000))
    const out = cleanBlocks([{ ...(answer as object), id: original.id, type: original.type }])
    if ('error' in out) throw new BadRequestException('A IA não respondeu no formato esperado. Tente de novo.')
    // Imagens, formulário e destino dos botões continuam os de antes.
    const keep = ['image', 'formId', 'whatsappId', 'action', 'url', 'mode', 'variant', 'background', 'endsAt']
    const merged: Block = { ...out.blocks[0]! }
    for (const k of keep) if (k in original) merged[k] = original[k]
    if (Array.isArray(original.items) && Array.isArray(merged.items)) {
      merged.items = (merged.items as Record<string, unknown>[]).map((it, i) => {
        const o = (original.items as Record<string, unknown>[])[i] ?? {}
        return { ...it, ...('image' in o ? { image: o.image } : {}), ...('url' in o ? { url: o.url } : {}), ...('price' in o ? { price: o.price } : {}) }
      })
    }
    return { block: merged }
  }

  /** Produtos do catálogo da loja (Magazord) para o bloco de produtos. */
  async products(user: AuthUser, q: string) {
    this.assertCan(user, 'view')
    const term = q.trim().slice(0, 80)
    const rows = await this.prisma.storeProduct.findMany({
      where: { tenantId: user.tenantId, ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { code: { contains: term, mode: 'insensitive' } }] } : {}) },
      orderBy: { name: 'asc' },
      take: 20,
      select: { id: true, code: true, name: true, image: true, url: true, price: true },
    })
    return rows.map((r) => ({ ...r, price: r.price === null ? null : Number(r.price) }))
  }
}
