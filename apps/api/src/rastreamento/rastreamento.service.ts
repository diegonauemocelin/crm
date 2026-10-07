import { createHmac } from 'node:crypto'
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { randomToken, safeEqual } from '../common/crypto'
import { env } from '../config/env'
import { Prisma } from '../generated/prisma/client'
import { LeadConfigService } from '../leads/lead-config.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { CLIENT_ID, classifyDevice, classifyTouch, cleanUrl, describeTouch, type Device, domainAllowed, type Touch } from './origem'
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
  /** Textos que aparecem no navegador do app da loja (identificam visitas vindas do app). */
  appMarkers: string[]
}

export const DEFAULT_TRACKING: TrackingSettings = { enabled: false, siteKey: '', domains: [], requireConsent: false, retentionDays: 395, appMarkers: [] }

/** Eventos de compra aceitos do site. */
export const SHOP_EVENTS: Record<string, string> = {
  add_to_cart: 'Adicionou ao carrinho',
  begin_checkout: 'Iniciou o checkout',
  add_shipping_info: 'Informou a entrega no checkout',
  add_payment_info: 'Escolheu o pagamento no checkout',
  purchase: 'Comprou no site',
}

export interface ShopItem {
  id: string
  name: string
  price: number | null
  qty: number
}

interface Hit {
  k: string
  v: string
  s: string
  n: boolean
  u: string
  t?: string | null
  r?: string | null
  l?: string | null
  /** Dica de dispositivo publicada pela loja. */
  h?: string | null
  /** Evento de e-commerce (em vez de página vista). */
  x?: string | null
  val?: number | null
  it?: ShopItem[]
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
  const x = str(p.x, 40)
  if (x && !SHOP_EVENTS[x]) return null
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1e8 ? Math.round(n * 100) / 100 : null)
  const it = Array.isArray(p.it)
    ? (p.it as Record<string, unknown>[]).slice(0, 30).map((i) => ({
        id: String(i?.id ?? '').slice(0, 60),
        name: String(i?.name ?? '').slice(0, 160),
        price: num(i?.price),
        qty: Math.max(1, Math.min(9999, Math.round(Number(i?.qty) || 1))),
      }))
    : []
  return { k, v, s, u, n: p.n === true, t: str(p.t, 300), r: str(p.r, 2000), l: str(p.l, 200), h: str(p.h, 20), x, val: num(p.val), it }
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

  /** Empresa e configuração pela chave pública do site (também usada pela captura). */
  async siteByKey(key: string) {
    return /^[A-Za-z0-9_-]{10,64}$/.test(key) ? this.site(key) : null
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
  async collect(raw: unknown, origin: string | undefined, userAgent?: string) {
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
    const device: Device = classifyDevice(userAgent, hit.h, site.s.appMarkers)
    if (hit.x) return this.collectEvent(tenantId, hit, url, device, now)
    const touch: Touch | null = hit.n ? (classifyTouch(hit.u, hit.r, domains) ?? { source: 'direto', medium: 'direto', landing: url }) : null

    let visitor = await this.prisma.siteVisitor.findUnique({ where: { tenantId_clientId: { tenantId, clientId: hit.v } } })
    if (!visitor) {
      try {
        visitor = await this.prisma.siteVisitor.create({
          data: { tenantId, clientId: hit.v, firstDevice: device, device, firstTouch: (touch ?? { source: 'direto', medium: 'direto', landing: url }) as Prisma.InputJsonValue },
        })
      } catch (err) {
        // Duas páginas do mesmo visitante chegando juntas: a outra requisição criou primeiro.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
        visitor = await this.prisma.siteVisitor.findUniqueOrThrow({ where: { tenantId_clientId: { tenantId, clientId: hit.v } } })
      }
    }

    await this.prisma.$transaction([
      this.prisma.sitePageview.create({
        data: { tenantId, visitorId: visitor.id, sessionId: hit.s, url, title: hit.t?.trim().slice(0, 200) || null, newSession: hit.n, touch: (touch ?? undefined) as Prisma.InputJsonValue | undefined, device, occurredAt: now },
      }),
      this.prisma.siteVisitor.update({
        where: { id: visitor.id },
        data: { lastSeenAt: now, device, pageviews: { increment: 1 }, ...(hit.n ? { sessions: { increment: 1 }, lastTouch: touch as Prisma.InputJsonValue } : {}) },
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
   * Evento de compra do site (carrinho, checkout, compra). Se o visitante já é um lead conhecido,
   * entra na linha do tempo; iniciar o checkout também marca o lead para campanhas de recuperação.
   */
  private async collectEvent(tenantId: string, hit: Hit, url: string, device: Device, now: Date) {
    const visitor = await this.prisma.siteVisitor.findUnique({ where: { tenantId_clientId: { tenantId, clientId: hit.v } } })
    // Evento sem nenhuma página vista antes (script bloqueado, cookie apagado): não há a quem atribuir.
    if (!visitor) return
    const items = hit.it ?? []
    const value = hit.val ?? (items.reduce((s, i) => s + (i.price ?? 0) * i.qty, 0) || null)
    await this.prisma.siteEvent.create({
      data: { tenantId, visitorId: visitor.id, name: hit.x!, value, items: items as unknown as Prisma.InputJsonValue, url, device, occurredAt: now },
    })
    if (!visitor.leadId || hit.x === 'add_shipping_info' || hit.x === 'add_payment_info') return
    const money = value ? ` — ${value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''
    const names = items.map((i) => i.name).filter(Boolean)
    const title = `${SHOP_EVENTS[hit.x!]}${names.length ? `: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` e mais ${names.length - 3}` : ''}` : ''}${money}`
    const type = hit.x === 'add_to_cart' ? 'carrinho' : hit.x === 'begin_checkout' ? 'checkout' : 'compra_site'
    await this.prisma.leadEvent.create({ data: { tenantId, leadId: visitor.leadId, type, title: title.slice(0, 300), data: { itens: items, valor: value, pagina: url } as unknown as Prisma.InputJsonValue, occurredAt: now } })
    if (hit.x === 'begin_checkout') await this.tagLead(visitor.leadId, ['checkout-iniciado'], [])
    if (hit.x === 'purchase') await this.tagLead(visitor.leadId, [], ['checkout-iniciado', 'carrinho-abandonado'])
    await this.prisma.lead.updateMany({ where: { id: visitor.leadId }, data: { lastActivityAt: now } })
    await this.scoring.rescore(tenantId, [visitor.leadId])
  }

  /** Tags de campanha (checkout-iniciado, carrinho-abandonado): entram e saem conforme o comportamento. */
  async tagLead(leadId: string, add: string[], remove: string[]) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { tags: true } })
    if (!lead) return
    const next = [...new Set([...lead.tags, ...add])].filter((t) => !remove.includes(t))
    if (next.length !== lead.tags.length || next.some((t, i) => t !== lead.tags[i])) await this.prisma.lead.update({ where: { id: leadId }, data: { tags: next } })
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
    // Carrinho e checkout feitos antes de ser identificado também vão para a linha do tempo.
    const shop = await this.prisma.siteEvent.findMany({
      where: { visitorId, name: { in: ['add_to_cart', 'begin_checkout', 'purchase'] }, occurredAt: { gte: new Date(Date.now() - BACKFILL_DAYS * DAY) } },
      orderBy: { occurredAt: 'asc' },
      take: 50,
    })
    if (shop.length) {
      await this.prisma.leadEvent.createMany({
        data: shop.map((e) => {
          const items = (e.items as unknown as ShopItem[] | null) ?? []
          const names = items.map((i) => i.name).filter(Boolean)
          const value = e.value === null ? null : Number(e.value)
          return {
            tenantId,
            leadId,
            type: e.name === 'add_to_cart' ? 'carrinho' : e.name === 'begin_checkout' ? 'checkout' : 'compra_site',
            title: `${SHOP_EVENTS[e.name] ?? e.name}${names.length ? `: ${names.slice(0, 3).join(', ')}` : ''}${value ? ` — ${value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}`.slice(0, 300),
            data: { itens: items, valor: value, pagina: e.url } as unknown as Prisma.InputJsonValue,
            occurredAt: e.occurredAt,
          }
        }),
      })
      const last = shop[shop.length - 1]!
      if (last.name === 'begin_checkout') await this.tagLead(leadId, ['checkout-iniciado'], [])
      await this.scoring.rescore(tenantId, [leadId])
    }
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
          select: { id: true, url: true, title: true, occurredAt: true, newSession: true, touch: true, device: true },
        })
      : []
    const shop = visitors.length
      ? await this.prisma.siteEvent.findMany({
          where: { visitorId: { in: visitors.map((v) => v.id) } },
          orderBy: { occurredAt: 'desc' },
          take: 50,
          select: { id: true, name: true, value: true, items: true, occurredAt: true, device: true },
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
      firstDevice: first?.firstDevice ?? null,
      device: visitors[0]?.device ?? null,
      views,
      shop: shop.map((e) => ({ ...e, value: e.value === null ? null : Number(e.value) })),
    }
  }

  /** Resumo para a tela de configuração: confirma a instalação e mostra de onde vêm as visitas. */
  async summary(tenantId: string, days: number) {
    const since = new Date(Date.now() - days * DAY)
    const [perDay, sources, pages, totals, last, devices, leadDevices, funnel] = await Promise.all([
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
      this.prisma.$queryRaw<{ dispositivo: string; visitas: bigint }[]>`
        SELECT coalesce(device, 'desconhecido') AS dispositivo, count(*) AS visitas
        FROM site_pageviews WHERE "tenantId" = ${tenantId}::uuid AND "occurredAt" >= ${since} AND "newSession"
        GROUP BY 1 ORDER BY 2 DESC`,
      // De qual dispositivo vieram os leads identificados no período (dispositivo da primeira visita).
      this.prisma.$queryRaw<{ dispositivo: string; leads: bigint }[]>`
        SELECT coalesce("firstDevice", 'desconhecido') AS dispositivo, count(DISTINCT "leadId") AS leads
        FROM site_visitors WHERE "tenantId" = ${tenantId}::uuid AND "identifiedAt" >= ${since}
        GROUP BY 1 ORDER BY 2 DESC`,
      this.prisma.$queryRaw<{ evento: string; visitantes: bigint }[]>`
        SELECT name AS evento, count(DISTINCT "visitorId") AS visitantes
        FROM site_events WHERE "tenantId" = ${tenantId}::uuid AND "occurredAt" >= ${since}
        GROUP BY 1`,
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
      devices: devices.map((r) => ({ device: r.dispositivo, visits: n(r.visitas) })),
      leadDevices: leadDevices.map((r) => ({ device: r.dispositivo, leads: n(r.leads) })),
      shop: Object.fromEntries(funnel.map((r) => [r.evento, n(r.visitantes)])) as Record<string, number>,
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
