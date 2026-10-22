import { Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MARKETPLACE } from './mercadolivre'
import { MercadoLivreService } from './mercadolivre.service'

/**
 * Cópia do Usaparts BI dentro do banco do CRM (esquema "bi"), trazida pelo deploy/importar-bi.sh sem alterar nada.
 * O Mercado Livre Ads vai para as telas de Marketplaces; o resto fica guardado e aparece em "Histórico do BI".
 * Só a empresa marcada na importação (bi._crm_importacao) enxerga esses dados.
 */

/** Tabelas que não saem em planilha: sessões e pedidos de senha não servem para consulta. */
const HIDDEN_TABLES = new Set(['Session', 'PasswordReset', 'OAuthState', '_prisma_migrations', '_crm_importacao'])
/** Colunas com segredo (senha, tokens criptografados) nunca saem. */
const HIDDEN_COLUMN = /passwordHash|tokenHash|Enc$|codeVerifier/i

const LABELS: Record<string, string> = {
  Lead: 'Leads das planilhas',
  LeadHistory: 'Histórico de alterações dos leads',
  DataSource: 'Planilhas ligadas (fontes de dados)',
  ImportBatch: 'Importações de planilhas',
  ImportIssue: 'Avisos e erros das importações',
  DictionaryEntry: 'Dicionário de padronização',
  AdSpend: 'Investimentos (lançados à mão e das integrações)',
  GadsCampaign: 'Google Ads: campanhas',
  GadsCampaignDaily: 'Google Ads: números por dia',
  MlCampaign: 'Mercado Livre Product Ads: campanhas',
  MlCampaignDaily: 'Mercado Livre Product Ads: números por dia',
  MlAdGroup: 'Mercado Livre: anúncios (grupos de anúncios)',
  MlAdGroupDaily: 'Mercado Livre: anúncios por dia',
  MlDisplayCampaign: 'Mercado Livre Display: campanhas',
  MlDisplayDaily: 'Mercado Livre Display: números por dia',
  Integration: 'Integrações conectadas (sem os tokens)',
  SyncRun: 'Histórico de sincronizações',
  User: 'Usuários do BI (sem as senhas)',
  Profile: 'Perfis de acesso do BI',
  Suggestion: 'Sugestões de melhoria',
  Notification: 'Notificações',
  AccessLog: 'Registro de acessos',
  AuditLog: 'Auditoria do BI',
  Setting: 'Configurações do BI (sem segredos)',
  VersionInstall: 'Versões instaladas do BI',
  Session: 'Sessões de login',
  PasswordReset: 'Pedidos de troca de senha',
  OAuthState: 'Autorizações em andamento',
}

export interface BiLeadFilters {
  search?: string
  fonte?: string
  situacao?: string
  atendimento?: string
  de?: string
  ate?: string
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`

@Injectable()
export class BiArchiveService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BiArchiveService.name)
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: MercadoLivreService,
  ) {}

  onApplicationBootstrap() {
    // Logo depois de subir e a cada 30 minutos: se o script trouxe uma cópia nova do BI, o Mercado Livre entra sozinho.
    setTimeout(() => void this.autoImport(), 60_000).unref()
    this.timer = setInterval(() => void this.autoImport(), 30 * 60_000)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  /** Dados da importação: empresa dona e data da cópia. Sem o esquema "bi", null. */
  async meta(): Promise<{ tenantId: string; importedAt: string; biVersion: string | null } | null> {
    const exists = await this.prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('bi._crm_importacao') IS NOT NULL AS ok`
    if (!exists[0]?.ok) return null
    const rows = await this.prisma.$queryRaw<{ tenant_id: string; importado_em: Date; versao_bi: string | null }[]>`SELECT tenant_id::text, importado_em, versao_bi FROM bi._crm_importacao ORDER BY importado_em DESC LIMIT 1`
    const r = rows[0]
    return r ? { tenantId: r.tenant_id, importedAt: r.importado_em.toISOString(), biVersion: r.versao_bi } : null
  }

  private async owned(tenantId: string) {
    const m = await this.meta()
    if (!m || m.tenantId !== tenantId) throw new NotFoundException('Os dados do Usaparts BI ainda não foram trazidos para esta empresa. Rode o deploy/importar-bi.sh na VPS (docs/DEPLOY.md).')
    return m
  }

  private async tables() {
    const rows = await this.prisma.$queryRaw<{ name: string }[]>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'bi' AND table_type = 'BASE TABLE' ORDER BY table_name`
    return rows.map((r) => r.name)
  }

  async status(tenantId: string) {
    const m = await this.meta()
    if (!m || m.tenantId !== tenantId) return { available: false as const }
    const tables = []
    for (const name of await this.tables()) {
      if (name.startsWith('_')) continue
      const c = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM bi.${ident(name)}`)
      tables.push({ name, label: LABELS[name] ?? name, rows: Number(c[0]?.n ?? 0), exportable: !HIDDEN_TABLES.has(name) })
    }
    const st = await this.ml.syncState(tenantId)
    return { available: true as const, importedAt: m.importedAt, biVersion: m.biVersion, tables, marketplace: { importedAt: st.biImportedAt ?? null, rows: st.biRows ?? 0 } }
  }

  async autoImport() {
    if (this.busy) return
    this.busy = true
    try {
      const m = await this.meta()
      if (!m) return
      const st = await this.ml.syncState(m.tenantId)
      if (st.biImportedAt === m.importedAt) return
      const r = await this.importMarketplace(m.tenantId)
      this.logger.log(`Usaparts BI: ${r.rows} registros do Mercado Livre trazidos`)
    } catch (err) {
      this.logger.warn(`Usaparts BI: ${(err as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  /**
   * Mercado Livre Ads do BI para as tabelas de Marketplaces. Nada é apagado nem sobrescrito: o que o CRM já
   * sincronizou fica como está (ON CONFLICT DO NOTHING). Pode rodar de novo sem duplicar.
   */
  async importMarketplace(tenantId: string) {
    const m = await this.owned(tenantId)
    const T = tenantId
    const ML = MARKETPLACE
    const has = async (t: string) => (await this.prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regclass('bi.${ident(t)}') IS NOT NULL AS ok`))[0]?.ok === true
    let rows = 0
    const steps: Prisma.Sql[] = []
    if (await has('MlCampaign'))
      steps.push(Prisma.sql`
        INSERT INTO marketplace_campaigns (id, "tenantId", marketplace, product, "campaignId", name, status, strategy, budget, "roasTarget", "acosTarget", extra, "updatedAt")
        SELECT gen_random_uuid(), ${T}::uuid, ${ML}, 'product_ads', c.id, c.name, c.status, c.strategy, c.budget, c."roasTarget", c."acosTarget",
          jsonb_build_object('advertiserId', c."advertiserId", 'currencyId', c."currencyId", 'dateCreated', c."dateCreated", 'origem', 'bi'), now()
        FROM bi."MlCampaign" c ON CONFLICT DO NOTHING`)
    if (await has('MlDisplayCampaign'))
      steps.push(Prisma.sql`
        INSERT INTO marketplace_campaigns (id, "tenantId", marketplace, product, "campaignId", name, status, strategy, "startDate", "endDate", extra, "updatedAt")
        SELECT gen_random_uuid(), ${T}::uuid, ${ML}, 'display', c.id, c.name, c.status, c.goal, c."startDate"::date, c."endDate"::date,
          jsonb_build_object('advertiserId', c."advertiserId", 'type', c.type, 'goal', c.goal, 'origem', 'bi'), now()
        FROM bi."MlDisplayCampaign" c ON CONFLICT DO NOTHING`)
    if (await has('MlAdGroup'))
      steps.push(Prisma.sql`
        INSERT INTO marketplace_ads (id, "tenantId", marketplace, "adId", "campaignId", "externalId", type, title, thumbnail, status, "updatedAt")
        SELECT gen_random_uuid(), ${T}::uuid, ${ML}, g.id, g."campaignId", g."externalId", g.type, g.title, g.thumbnail, g.status, now()
        FROM bi."MlAdGroup" g ON CONFLICT DO NOTHING`)
    if (await has('MlCampaignDaily'))
      steps.push(Prisma.sql`
        INSERT INTO marketplace_ad_days (id, "tenantId", marketplace, product, level, "entityId", "campaignId", date, impressions, clicks, cost, revenue, "directRevenue", "indirectRevenue",
          units, "directUnits", "indirectUnits", items, "organicUnits", "organicRevenue", source, "updatedAt")
        SELECT gen_random_uuid(), ${T}::uuid, ${ML}, 'product_ads', 'campaign', d."campaignId", d."campaignId", d.date, d.prints, d.clicks, d.cost, d."totalAmount", d."directAmount", d."indirectAmount",
          d.units, d."directUnits", d."indirectUnits", d."advertisingItems", d."organicUnits", d."organicAmount", 'bi', now()
        FROM bi."MlCampaignDaily" d ON CONFLICT DO NOTHING`)
    if (await has('MlAdGroupDaily'))
      steps.push(Prisma.sql`
        INSERT INTO marketplace_ad_days (id, "tenantId", marketplace, product, level, "entityId", "campaignId", date, impressions, clicks, cost, revenue, "directRevenue", "indirectRevenue",
          units, items, source, "updatedAt")
        SELECT gen_random_uuid(), ${T}::uuid, ${ML}, 'product_ads', 'ad', d."adGroupId", d."campaignId", d.date, d.prints, d.clicks, d.cost, d."totalAmount", d."directAmount", d."indirectAmount",
          d.units, d."advertisingItems", 'bi', now()
        FROM bi."MlAdGroupDaily" d ON CONFLICT DO NOTHING`)
    if (await has('MlDisplayDaily'))
      steps.push(Prisma.sql`
        INSERT INTO marketplace_ad_days (id, "tenantId", marketplace, product, level, "entityId", "campaignId", date, impressions, clicks, cost, revenue, "directRevenue",
          units, items, "pageViews", "addToCart", checkouts, "eventRevenue", source, "updatedAt")
        SELECT gen_random_uuid(), ${T}::uuid, ${ML}, 'display', 'campaign', d."campaignId", d."campaignId", d.date, d.prints, d.clicks, d.cost, d."directAmount", d."directAmount",
          d.units, d.items, d."productPageViews", d."addToCart", d.checkouts, d."directAmountEvent", 'bi', now()
        FROM bi."MlDisplayDaily" d ON CONFLICT DO NOTHING`)
    await this.prisma.$transaction(async (tx) => {
      for (const s of steps) rows += await tx.$executeRaw(s)
    })
    await this.prefillConfig(tenantId)
    await this.ml.setSyncState(tenantId, { biImportedAt: m.importedAt, biRows: rows })
    return { ok: true, rows, message: rows ? `${rows.toLocaleString('pt-BR')} registros do Mercado Livre trazidos do BI.` : 'Os dados do Mercado Livre do BI já estavam no CRM.' }
  }

  /** Anunciante e Client ID que o BI usava, para conectar com um clique (o segredo e os tokens não vêm: ficam criptografados no BI). */
  private async prefillConfig(tenantId: string) {
    const c = await this.ml.config(tenantId)
    const patch: Record<string, string | null> = {}
    try {
      const integ = await this.prisma.$queryRaw<{ settings: Record<string, string | null> | null }[]>`SELECT settings FROM bi."Integration" WHERE provider::text = 'MERCADO_LIVRE_ADS' ORDER BY "updatedAt" DESC LIMIT 1`
      const s = integ[0]?.settings ?? {}
      if (!c.advertiserId && s.advertiserId) Object.assign(patch, { advertiserId: s.advertiserId, siteId: s.siteId ?? null, advertiserName: s.advertiserName ?? null })
      if (!c.displayAdvertiserId && s.displayAdvertiserId) Object.assign(patch, { displayAdvertiserId: s.displayAdvertiserId, displayStatus: s.displayStatus ?? null })
      if (!c.nickname && s.nickname) patch.nickname = s.nickname
      const app = await this.prisma.$queryRaw<{ id: string | null }[]>`SELECT value->>'clientId' AS id FROM bi."Setting" WHERE key = 'app:mercadolivre'`
      if (!c.clientId && app[0]?.id) patch.clientId = app[0].id
    } catch {
      // BI de versão antiga, sem essas tabelas: conecta normalmente pela tela.
    }
    if (Object.keys(patch).length) await this.ml.patch(tenantId, patch)
  }

  // ---------- Consultas do histórico ----------

  private leadWhere(f: BiLeadFilters) {
    const parts: Prisma.Sql[] = [Prisma.sql`TRUE`]
    if (f.search) {
      const like = `%${f.search}%`
      parts.push(Prisma.sql`(l."customerName" ILIKE ${like} OR l.seller ILIKE ${like} OR l.campaign ILIKE ${like} OR l.origin ILIKE ${like} OR l.notes ILIKE ${like})`)
    }
    if (f.fonte) parts.push(Prisma.sql`l."dataSourceId" = ${f.fonte}`)
    if (f.situacao) parts.push(Prisma.sql`l."saleStatus"::text = ${f.situacao}`)
    if (f.atendimento) parts.push(Prisma.sql`l."attendanceType"::text = ${f.atendimento}`)
    if (f.de) parts.push(Prisma.sql`l."entryDate" >= ${f.de}::date`)
    if (f.ate) parts.push(Prisma.sql`l."entryDate" <= ${f.ate}::date`)
    return Prisma.join(parts, ' AND ')
  }

  async leads(tenantId: string, f: BiLeadFilters, page: number, pageSize: number) {
    await this.owned(tenantId)
    const where = this.leadWhere(f)
    const [items, total, sources, summary] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT l.id, to_char(l."entryDate", 'YYYY-MM-DD') AS "entryDate", l."customerName", l."customerType", l.region, l.state, l.origin, l.platform, l.campaign, l.brand, l.seller,
          l."attendanceType"::text AS "attendanceType", l."saleStatus"::text AS "saleStatus", l.revenue::float AS revenue, l.notes, d.name AS source
        FROM bi."Lead" l JOIN bi."DataSource" d ON d.id = l."dataSourceId"
        WHERE ${where} ORDER BY l."entryDate" DESC NULLS LAST, l.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM bi."Lead" l WHERE ${where}`,
      this.prisma.$queryRaw<{ id: string; name: string; leads: bigint }[]>`SELECT d.id, d.name, count(l.id) AS leads FROM bi."DataSource" d LEFT JOIN bi."Lead" l ON l."dataSourceId" = d.id GROUP BY d.id, d.name ORDER BY d.name`,
      this.prisma.$queryRaw<{ sold: bigint; revenue: number | null; first: string | null; last: string | null }[]>`
        SELECT count(*) FILTER (WHERE l."saleStatus"::text = 'VENDEU') AS sold, sum(l.revenue) FILTER (WHERE l."saleStatus"::text = 'VENDEU')::float AS revenue,
          to_char(min(l."entryDate"), 'YYYY-MM-DD') AS first, to_char(max(l."entryDate"), 'YYYY-MM-DD') AS last
        FROM bi."Lead" l WHERE ${where}`,
    ])
    const s = summary[0]
    return {
      items,
      total: Number(total[0]?.n ?? 0),
      page,
      pageSize,
      sources: sources.map((x) => ({ id: x.id, name: x.name, leads: Number(x.leads) })),
      summary: { sold: Number(s?.sold ?? 0), revenue: s?.revenue ?? 0, first: s?.first ?? null, last: s?.last ?? null },
    }
  }

  async spend(tenantId: string) {
    await this.owned(tenantId)
    return this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, platform::text AS platform, source::text AS source, to_char("periodStart", 'YYYY-MM-DD') AS "periodStart", to_char("periodEnd", 'YYYY-MM-DD') AS "periodEnd",
        amount::float AS amount, "accountId", "campaignId", "campaignName", notes, "createdAt"
      FROM bi."AdSpend" ORDER BY "periodStart" DESC, platform LIMIT 5000`
  }

  async googleAds(tenantId: string) {
    await this.owned(tenantId)
    const [campaigns, months] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c.id, c.name, c.status, c."channelType", c."customerId", to_char(min(d.date), 'YYYY-MM-DD') AS first, to_char(max(d.date), 'YYYY-MM-DD') AS last,
          coalesce(sum(d.impressions), 0)::int AS impressions, coalesce(sum(d.clicks), 0)::int AS clicks, coalesce(sum(d.cost), 0)::float AS cost,
          coalesce(sum(d.conversions), 0)::float AS conversions, coalesce(sum(d."conversionsValue"), 0)::float AS "conversionsValue"
        FROM bi."GadsCampaign" c LEFT JOIN bi."GadsCampaignDaily" d ON d."campaignId" = c.id
        GROUP BY c.id ORDER BY cost DESC`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char(date, 'YYYY-MM') AS month, sum(impressions)::int AS impressions, sum(clicks)::int AS clicks, sum(cost)::float AS cost, sum(conversions)::float AS conversions, sum("conversionsValue")::float AS "conversionsValue"
        FROM bi."GadsCampaignDaily" GROUP BY 1 ORDER BY 1`,
    ])
    return { campaigns, months }
  }

  /** Planilha (CSV com ";", para o Excel em português) de uma tabela guardada, sem colunas com segredo. */
  async exportTable(tenantId: string, table: string) {
    await this.owned(tenantId)
    if (HIDDEN_TABLES.has(table) || !(await this.tables()).includes(table)) throw new NotFoundException('Tabela não encontrada no histórico do BI.')
    const cols = (await this.prisma.$queryRaw<{ name: string }[]>`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'bi' AND table_name = ${table} ORDER BY ordinal_position`)
      .map((c) => c.name)
      .filter((c) => !HIDDEN_COLUMN.test(c))
    // Setting guarda o segredo do aplicativo dentro do JSON: sai sem ele.
    const expr = (c: string) => (table === 'Setting' && c === 'value' ? `(${ident(c)} - 'clientSecretEnc')::text` : `${ident(c)}::text`)
    const rows = await this.prisma.$queryRawUnsafe<Record<string, string | null>[]>(`SELECT ${cols.map((c) => `${expr(c)} AS ${ident(c)}`).join(', ')} FROM bi.${ident(table)}`)
    const cell = (v: string | null) => {
      if (v === null) return ''
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
      return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
    }
    const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c] ?? null)).join(';'))].join('\r\n')
    return { name: `bi-${table}.csv`, csv }
  }
}
