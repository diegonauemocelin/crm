import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { GEMINI_MODELS, SECRET_KEY } from '../assistente/constantes'
import { AuditService } from '../audit/audit.service'
import { decrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { claudeGrounded, geminiGrounded } from './ia'
import { aiPrompt, cleanConfig, CONFIG_KEY, DEFAULT_CONFIG, type InternalSnapshot, type MarketConfig, marketplaceName, PERIOD_DAYS, readingFromAi, STALE_MS } from './mercado'

const MODULE = 'mi_mercado'
const CLAUDE_MODEL = 'claude-sonnet-5-5'
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100

@Injectable()
export class MercadoService {
  private readonly logger = new Logger(MercadoService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, MODULE, action)) throw new ForbiddenException('Seu perfil não pode usar a análise de mercado.')
  }

  async config(tenantId: string): Promise<MarketConfig> {
    return cleanConfig(await this.settings.get<Partial<MarketConfig>>(tenantId, CONFIG_KEY, {}), DEFAULT_CONFIG)
  }

  /** Chave da IA: a do Gemini (assistente ou e-mail marketing) ou a do Claude; segue o motor escolhido na Busca de leads. */
  private async ai(tenantId: string): Promise<{ provider: 'gemini' | 'claude'; key: string } | null> {
    const read = async (enc: string | undefined | null) => {
      if (!enc) return null
      try {
        return decrypt(enc)
      } catch {
        return null
      }
    }
    const gemini = (await read((await this.settings.get<{ enc?: string }>(tenantId, SECRET_KEY('gemini'), {})).enc)) ?? (await read((await this.settings.get<{ apiKeyEnc?: string | null }>(tenantId, 'email_ia', {})).apiKeyEnc))
    const claude = await read((await this.settings.get<{ enc?: string }>(tenantId, SECRET_KEY('claude'), {})).enc)
    const prefer = (await this.settings.get<{ provider?: string }>(tenantId, 'prospeccao', {})).provider
    if (prefer === 'claude' && claude) return { provider: 'claude', key: claude }
    if (gemini) return { provider: 'gemini', key: gemini }
    if (claude) return { provider: 'claude', key: claude }
    return null
  }

  private fix<T extends { status: string; error: string | null; createdAt: Date }>(a: T): T {
    return a.status === 'GERANDO' && Date.now() - a.createdAt.getTime() > STALE_MS ? { ...a, status: 'ERRO', error: 'A análise foi interrompida. Gere de novo.' } : a
  }

  async view(user: AuthUser) {
    this.assertCan(user, 'view')
    const [config, ai, list] = await Promise.all([
      this.config(user.tenantId),
      this.ai(user.tenantId),
      this.prisma.marketAnalysis.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, error: true, model: true, createdBy: true, createdAt: true, finishedAt: true } }),
    ])
    return { config, ai: ai?.provider ?? null, analyses: list.map((a) => this.fix(a)) }
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const a = await this.prisma.marketAnalysis.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!a) throw new NotFoundException('Análise não encontrada.')
    return this.fix(a)
  }

  async saveConfig(user: AuthUser, raw: Partial<Record<keyof MarketConfig, unknown>>, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const c = cleanConfig(raw, await this.config(user.tenantId))
    await this.settings.set(user.tenantId, CONFIG_KEY, c)
    await this.audit.byUser(user, ctx, 'mercado.config', 'settings', CONFIG_KEY, { segmento: c.segment, regiao: c.region, concorrentes: c.competitors.length })
    return c
  }

  async start(user: AuthUser, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const config = await this.config(user.tenantId)
    if (!config.segment) throw new BadRequestException('Descreva o segmento da empresa (o que vende e para quem) antes de gerar a análise.')
    if (!(await this.ai(user.tenantId))) throw new BadRequestException('Cadastre a chave do Gemini (gratuita) ou do Claude em Atendimento › Busca de leads › Configurações para usar a análise de mercado.')
    const running = await this.prisma.marketAnalysis.findFirst({ where: { tenantId: user.tenantId, status: 'GERANDO', createdAt: { gte: new Date(Date.now() - STALE_MS) } } })
    if (running) throw new BadRequestException('Já tem uma análise sendo gerada. Espere terminar.')
    const a = await this.prisma.marketAnalysis.create({ data: { tenantId: user.tenantId, createdBy: user.name.slice(0, 120) } })
    await this.audit.byUser(user, ctx, 'mercado.analise', 'market_analysis', a.id, {})
    void this.run(a.id, user.tenantId, config)
    return a
  }

  /** Retrato interno dos últimos 90 dias: canais, leads por estado, marcas e produtos que mais saem. */
  async snapshot(tenantId: string): Promise<InternalSnapshot> {
    const since = new Date(Date.now() - PERIOD_DAYS * 86_400_000)
    const [shop, market, leads, states, brands, shopItems, marketItems] = await Promise.all([
      this.prisma.ecommerceOrder.aggregate({ where: { tenantId, statusGroup: 'pago', orderedAt: { gte: since } }, _count: true, _sum: { total: true } }),
      this.prisma.$queryRaw<{ marketplace: string; pedidos: bigint; faturamento: unknown }[]>`
        SELECT marketplace, COUNT(DISTINCT "orderId") AS pedidos, SUM(total) AS faturamento FROM marketplace_order_lines
        WHERE "tenantId" = ${tenantId}::uuid AND "dateCreated" >= ${since} AND COALESCE(status, '') NOT IN ('cancelled', 'invalid')
        GROUP BY marketplace ORDER BY 3 DESC`,
      this.prisma.lead.count({ where: { tenantId, createdAt: { gte: since } } }),
      this.prisma.lead.groupBy({ by: ['state'], where: { tenantId, createdAt: { gte: since }, state: { not: null } }, _count: { _all: true }, orderBy: { _count: { state: 'desc' } }, take: 8 }),
      this.prisma.$queryRaw<{ marca: string; unidades: bigint }[]>`
        SELECT i.brand AS marca, SUM(i.quantity) AS unidades FROM ecommerce_order_items i JOIN ecommerce_orders o ON o.id = i."orderId"
        WHERE o."tenantId" = ${tenantId}::uuid AND o."statusGroup" = 'pago' AND o."orderedAt" >= ${since} AND COALESCE(i.brand, '') <> ''
        GROUP BY i.brand ORDER BY 2 DESC LIMIT 12`,
      this.prisma.$queryRaw<{ produto: string; unidades: bigint }[]>`
        SELECT i.name AS produto, SUM(i.quantity) AS unidades FROM ecommerce_order_items i JOIN ecommerce_orders o ON o.id = i."orderId"
        WHERE o."tenantId" = ${tenantId}::uuid AND o."statusGroup" = 'pago' AND o."orderedAt" >= ${since}
        GROUP BY i.name ORDER BY 2 DESC LIMIT 12`,
      this.prisma.$queryRaw<{ produto: string; unidades: bigint; marketplace: string }[]>`
        SELECT title AS produto, SUM(quantity) AS unidades, MIN(marketplace) AS marketplace FROM marketplace_order_lines
        WHERE "tenantId" = ${tenantId}::uuid AND "dateCreated" >= ${since} AND COALESCE(status, '') NOT IN ('cancelled', 'invalid') AND COALESCE(title, '') <> ''
        GROUP BY title ORDER BY 2 DESC LIMIT 12`,
    ])
    const channels = [{ canal: 'Loja virtual (site)', pedidos: shop._count, faturamento: num(shop._sum.total) }, ...market.map((m) => ({ canal: marketplaceName(m.marketplace), pedidos: Number(m.pedidos), faturamento: num(m.faturamento) }))].filter((c) => c.pedidos > 0)
    const topProducts = [...shopItems.map((p) => ({ produto: p.produto.slice(0, 120), unidades: Number(p.unidades), canal: 'Loja virtual' })), ...marketItems.map((p) => ({ produto: p.produto.slice(0, 120), unidades: Number(p.unidades), canal: marketplaceName(p.marketplace) }))].sort((a, b) => b.unidades - a.unidades).slice(0, 15)
    return {
      periodDays: PERIOD_DAYS,
      channels,
      leads,
      leadStates: states.map((s) => ({ uf: s.state ?? '', leads: s._count._all })),
      topBrands: brands.map((b) => ({ marca: b.marca.slice(0, 60), unidades: Number(b.unidades) })),
      topProducts,
    }
  }

  private async run(id: string, tenantId: string, config: MarketConfig) {
    try {
      const ai = await this.ai(tenantId)
      if (!ai) throw new Error('Sem chave de IA cadastrada.')
      const snap = await this.snapshot(tenantId)
      const today = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long' }).format(new Date())
      const prompt = aiPrompt(snap, config, today)
      const r = ai.provider === 'claude' ? await claudeGrounded(ai.key, CLAUDE_MODEL, prompt) : await geminiGrounded(ai.key, GEMINI_MODELS, prompt)
      const reading = readingFromAi(r.text)
      if (!reading) throw new Error('A IA não devolveu a análise no formato esperado. Gere de novo.')
      await this.prisma.marketAnalysis.update({ where: { id }, data: { status: 'PRONTO', snapshot: { ...snap, config } as unknown as Prisma.InputJsonValue, reading: reading as unknown as Prisma.InputJsonValue, sources: r.sources, model: r.model, finishedAt: new Date() } })
    } catch (e) {
      this.logger.warn(`Análise de mercado ${id}: ${(e as Error).message}`)
      await this.prisma.marketAnalysis.update({ where: { id }, data: { status: 'ERRO', error: (e as Error).message.slice(0, 500), finishedAt: new Date() } }).catch(() => undefined)
    }
  }
}
