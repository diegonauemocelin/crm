import { createHmac } from 'node:crypto'
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { randomToken, safeEqual } from '../common/crypto'
import { env } from '../config/env'
import { Prisma } from '../generated/prisma/client'
import { LeadConfigService } from '../leads/lead-config.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { CLIENT_ID, classifyTouch, cleanUrl, describeTouch, domainAllowed, type Touch } from './origem'
import { buildScript } from './script'

export interface TrackingSettings {
  enabled: boolean
  /** Chave pública que vai no código do site (não é segredo: só diz para qual empresa os dados vão). */
  siteKey: string
  /** Domínios do site. Visitas de outros domínios são ignoradas. */
  domains: string[]
  /** true: só rastreia depois que o visitante aceitar o banner de cookies do site. */
  requireConsent: boolean
  /** Páginas vistas mais antigas que isso são apagadas. */
  retentionDays: number
}

export const DEFAULT_TRACKING: TrackingSettings = { enabled: false, siteKey: '', domains: [], requireConsent: false, retentionDays: 395 }

interface Hit {
  k: string
  v: string
  s: string
  n: boolean
  u: string
  t?: string | null
  r?: string | null
  l?: string | null
}

const DAY = 86_400_000
/** Visitas anteriores à identificação que entram na linha do tempo do lead. */
const BACKFILL_DAYS = 90

function parseHit(raw: unknown): Hit | null {
  let p: Record<string, unknown>
  try {
    p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!p || typeof p !== 'object') return null
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)
  const k = str(p.k, 64)
  const v = str(p.v, 64)
  const s = str(p.s, 64)
  const u = str(p.u, 2000)
  if (!k || !v || !s || !u || !CLIENT_ID.test(v) || !CLIENT_ID.test(s)) return null
  return { k, v, s, u, n: p.n === true, t: str(p.t, 300), r: str(p.r, 2000), l: str(p.l, 200) }
}

function hostOf(url: string | null | undefined) {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

@Injectable()
export class RastreamentoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RastreamentoService.name)
  private readonly cache = new Map<string, { tenantId: string; s: TrackingSettings; at: number }>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly scoring: LeadConfigService,
  ) {}

  onApplicationBootstrap() {
    // Limpeza diária das páginas vistas fora do prazo de guarda (LGPD: não guardar mais que o necessário).
    this.timer = setInterval(() => void this.cleanup(), DAY)
    this.timer.unref()
    setTimeout(() => void this.cleanup(), 60_000).unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  // ---------- Configuração ----------

  async config(tenantId: string): Promise<TrackingSettings> {
    const s = await this.settings.get(tenantId, 'tracking', DEFAULT_TRACKING)
    if (!s.siteKey) {
      s.siteKey = randomToken(18)
      await this.settings.set(tenantId, 'tracking', s)
    }
    return s
  }

  async save(tenantId: string, s: TrackingSettings) {
    await this.settings.set(tenantId, 'tracking', s)
    this.cache.clear()
    return s
  }

  snippet(s: TrackingSettings) {
    return `<script async src="${env.appUrl}/api/public/rastreamento/script.js?k=${s.siteKey}"></script>`
  }

  private async site(key: string) {
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < 60_000) return hit
    const row = await this.prisma.tenantSetting.findFirst({ where: { key: 'tracking', value: { path: ['siteKey'], equals: key } } })
    if (!row) return null
    const entry = { tenantId: row.tenantId, s: { ...DEFAULT_TRACKING, ...(row.value as Partial<TrackingSettings>) }, at: Date.now() }
    if (this.cache.size > 100) this.cache.clear()
    this.cache.set(key, entry)
    return entry
  }

  async script(key: string) {
    const site = /^[A-Za-z0-9_-]{10,64}$/.test(key) ? await this.site(key) : null
    if (!site?.s.enabled) return '/* Rastreamento do CRM desativado. */\n'
    return buildScript({ key, endpoint: `${env.appUrl}/api/public/rastreamento/coleta`, requireConsent: site.s.requireConsent, cookieDomains: site.s.domains })
  }

  // ---------- Link rastreável (e-mails e, depois, WhatsApp) ----------

  private tokenKey() {
    return createHmac('sha256', env.jwtAccessSecret).update('rastreamento-v1').digest()
  }

  /** Vai no parâmetro crm_lid dos links: quem clicar é ligado ao lead. Não dá acesso a nada além disso. */
  leadToken(leadId: string) {
    const sig = createHmac('sha256', this.tokenKey()).update(leadId).digest('base64url').slice(0, 27)
    return `${Buffer.from(leadId).toString('base64url')}.${sig}`
  }

  leadFromToken(token: string) {
    const [encoded, sig] = token.split('.')
    if (!encoded || !sig) return null
    const leadId = Buffer.from(encoded, 'base64url').toString('utf8')
    if (!/^[0-9a-f-]{36}$/.test(leadId)) return null
    const expected = createHmac('sha256', this.tokenKey()).update(leadId).digest('base64url').slice(0, 27)
    return safeEqual(sig, expected) ? leadId : null
  }

  // ---------- Coleta ----------

  /** Recebe uma página vista. Qualquer dado fora do esperado é descartado em silêncio (o site nunca vê erro). */
  async collect(raw: unknown, origin: string | undefined) {
    const hit = parseHit(raw)
    if (!hit) return
    const site = await this.site(hit.k)
    if (!site?.s.enabled) return
    const domains = site.s.domains
    // O navegador manda a origem real; a URL informada também precisa ser de um domínio do site.
    if (origin && origin !== 'null' && !domainAllowed(hostOf(origin), domains)) return
    if (!domainAllowed(hostOf(hit.u), domains)) return
    const url = cleanUrl(hit.u)
    if (!url) return

    const tenantId = site.tenantId
    const now = new Date()
    const touch: Touch | null = hit.n ? (classifyTouch(hit.u, hit.r, domains) ?? { source: 'direto', medium: 'direto', landing: url }) : null

    let visitor = await this.prisma.siteVisitor.findUnique({ where: { tenantId_clientId: { tenantId, clientId: hit.v } } })
    if (!visitor) {
      try {
        visitor = await this.prisma.siteVisitor.create({
          data: { tenantId, clientId: hit.v, firstTouch: (touch ?? { source: 'direto', medium: 'direto', landing: url }) as Prisma.InputJsonValue },
        })
      } catch (err) {
        // Duas páginas do mesmo visitante chegando juntas: a outra requisição criou primeiro.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
        visitor = await this.prisma.siteVisitor.findUniqueOrThrow({ where: { tenantId_clientId: { tenantId, clientId: hit.v } } })
      }
    }

    await this.prisma.$transaction([
      this.prisma.sitePageview.create({
        data: { tenantId, visitorId: visitor.id, sessionId: hit.s, url, title: hit.t?.trim().slice(0, 200) || null, newSession: hit.n, touch: (touch ?? undefined) as Prisma.InputJsonValue | undefined, occurredAt: now },
      }),
      this.prisma.siteVisitor.update({
        where: { id: visitor.id },
        data: { lastSeenAt: now, pageviews: { increment: 1 }, ...(hit.n ? { sessions: { increment: 1 }, lastTouch: touch as Prisma.InputJsonValue } : {}) },
      }),
    ])

    const tokenLead = hit.l ? this.leadFromToken(hit.l) : null
    if (tokenLead && tokenLead !== visitor.leadId) {
      await this.identify(tenantId, visitor.id, tokenLead)
    } else if (visitor.leadId && hit.n) {
      await this.registerVisits(tenantId, visitor.leadId, [{ at: now, url, touch }])
    }
  }

  /**
   * Liga o visitante a um lead (link de e-mail, formulário, integração). As visitas anteriores
   * (até 90 dias) entram na linha do tempo e no lead scoring.
   */
  async identify(tenantId: string, visitorId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId, deletedAt: null, anonymizedAt: null }, select: { id: true } })
    if (!lead) return false
    await this.prisma.siteVisitor.update({ where: { id: visitorId }, data: { leadId, identifiedAt: new Date() } })
    const sessions = await this.prisma.sitePageview.findMany({
      where: { visitorId, newSession: true, occurredAt: { gte: new Date(Date.now() - BACKFILL_DAYS * DAY) } },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      select: { occurredAt: true, url: true, touch: true },
    })
    await this.registerVisits(
      tenantId,
      leadId,
      sessions.map((s) => ({ at: s.occurredAt, url: s.url, touch: s.touch as Touch | null })),
    )
    return true
  }

  /** Identifica pelo id do navegador (usado pelos formulários do próprio CRM na Fase 4). */
  async identifyClient(tenantId: string, clientId: string, leadId: string) {
    if (!CLIENT_ID.test(clientId)) return false
    const visitor = await this.prisma.siteVisitor.findUnique({ where: { tenantId_clientId: { tenantId, clientId } } })
    return visitor && visitor.leadId !== leadId ? this.identify(tenantId, visitor.id, leadId) : false
  }

  private async registerVisits(tenantId: string, leadId: string, visits: { at: Date; url: string; touch: Touch | null }[]) {
    if (!visits.length) return
    await this.prisma.leadEvent.createMany({
      data: visits.map((v) => ({
        tenantId,
        leadId,
        type: 'visita',
        title: `Visitou o site · ${describeTouch(v.touch)}`,
        data: { pagina: v.url, origem: (v.touch ?? null) as Prisma.InputJsonValue },
        occurredAt: v.at,
      })),
    })
    const latest = visits.reduce((a, b) => (a.at > b.at ? a : b)).at
    await this.prisma.lead.updateMany({ where: { id: leadId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: latest } }] }, data: { lastActivityAt: latest } })
    await this.scoring.rescore(tenantId, [leadId])
  }

  // ---------- Consultas ----------

  /** Visitas de um lead (aba "Site" da ficha). A permissão sobre o lead é checada por quem chama. */
  async forLead(leadId: string) {
    const visitors = await this.prisma.siteVisitor.findMany({ where: { leadId }, orderBy: { lastSeenAt: 'desc' } })
    const views = visitors.length
      ? await this.prisma.sitePageview.findMany({
          where: { visitorId: { in: visitors.map((v) => v.id) } },
          orderBy: { occurredAt: 'desc' },
          take: 100,
          select: { id: true, url: true, title: true, occurredAt: true, newSession: true, touch: true },
        })
      : []
    const first = visitors.reduce<(typeof visitors)[number] | null>((a, b) => (!a || b.firstSeenAt < a.firstSeenAt ? b : a), null)
    return {
      devices: visitors.length,
      sessions: visitors.reduce((s, v) => s + v.sessions, 0),
      pageviews: visitors.reduce((s, v) => s + v.pageviews, 0),
      firstSeenAt: first?.firstSeenAt ?? null,
      lastSeenAt: visitors[0]?.lastSeenAt ?? null,
      firstTouch: first?.firstTouch ?? null,
      lastTouch: visitors[0]?.lastTouch ?? null,
      views,
    }
  }

  /** Resumo para a tela de configuração: confirma a instalação e mostra de onde vêm as visitas. */
  async summary(tenantId: string, days: number) {
    const since = new Date(Date.now() - days * DAY)
    const [perDay, sources, pages, totals, last] = await Promise.all([
      this.prisma.$queryRaw<{ dia: string; visitas: bigint; paginas: bigint }[]>`
        SELECT to_char("occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
               count(*) FILTER (WHERE "newSession") AS visitas, count(*) AS paginas
        FROM site_pageviews WHERE "tenantId" = ${tenantId}::uuid AND "occurredAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ fonte: string; meio: string; visitas: bigint }[]>`
        SELECT coalesce(touch->>'source', 'direto') AS fonte, coalesce(touch->>'medium', 'direto') AS meio, count(*) AS visitas
        FROM site_pageviews WHERE "tenantId" = ${tenantId}::uuid AND "occurredAt" >= ${since} AND "newSession"
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`,
      this.prisma.$queryRaw<{ pagina: string; vistas: bigint }[]>`
        SELECT split_part(url, '?', 1) AS pagina, count(*) AS vistas
        FROM site_pageviews WHERE "tenantId" = ${tenantId}::uuid AND "occurredAt" >= ${since}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      this.prisma.$queryRaw<{ visitantes: bigint; identificados: bigint }[]>`
        SELECT count(*) AS visitantes, count("leadId") AS identificados
        FROM site_visitors WHERE "tenantId" = ${tenantId}::uuid AND "lastSeenAt" >= ${since}`,
      this.prisma.sitePageview.findFirst({ where: { tenantId }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true, url: true } }),
    ])
    const n = (v: bigint | number | null | undefined) => Number(v ?? 0)
    return {
      days,
      lastHit: last,
      visitors: n(totals[0]?.visitantes),
      identified: n(totals[0]?.identificados),
      perDay: perDay.map((r) => ({ day: r.dia, visits: n(r.visitas), pageviews: n(r.paginas) })),
      sources: sources.map((r) => ({ source: r.fonte, medium: r.meio, visits: n(r.visitas) })),
      pages: pages.map((r) => ({ url: r.pagina, views: n(r.vistas) })),
    }
  }

  // ---------- Guarda dos dados ----------

  async cleanup() {
    try {
      for (const row of await this.prisma.tenantSetting.findMany({ where: { key: 'tracking' } })) {
        const s = { ...DEFAULT_TRACKING, ...(row.value as Partial<TrackingSettings>) }
        const limit = new Date(Date.now() - s.retentionDays * DAY)
        const views = await this.prisma.sitePageview.deleteMany({ where: { tenantId: row.tenantId, occurredAt: { lt: limit } } })
        // Visitante anônimo sem visita no prazo some por inteiro; o identificado fica (os eventos já estão no lead).
        const visitors = await this.prisma.siteVisitor.deleteMany({ where: { tenantId: row.tenantId, leadId: null, lastSeenAt: { lt: limit } } })
        if (views.count || visitors.count) this.logger.log(`Rastreamento: ${views.count} página(s) e ${visitors.count} visitante(s) anônimo(s) apagados (prazo de ${s.retentionDays} dias).`)
      }
    } catch (err) {
      this.logger.error(`Limpeza do rastreamento falhou: ${(err as Error).message}`)
    }
  }
}
