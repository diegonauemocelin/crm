import { randomBytes } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { EmailAiService } from '../email/ia.service'
import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import { DEFAULT_INTEGRATIONS, INTEGRATIONS_KEY, type IntegrationsConfig } from '../marketing/config'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { type AccountMetrics, MetaPublisher, type PostMetrics } from './meta'
import {
  type Account,
  captionPrompt,
  cleanAccounts,
  engagementRate,
  groupTotals,
  type CleanPost,
  cleanCaption,
  cleanPost,
  detectPostFile,
  FORMATS,
  IMAGE_MAX_BYTES,
  imagePrompt,
  jpegSize,
  type MediaInfo,
  missingForApproval,
  networksOf,
  pendingAccounts,
  type PlanInput,
  parsePlan,
  planPrompt,
  type PostFormat,
  type PostInput,
  type PostResults,
  postSystem,
  VIDEO_MAX_BYTES,
} from './postagens'

const TICK_MS = 60_000
const ACCOUNTS_KEY = 'postagens_contas'
/** Métricas guardadas por um tempo (cada consulta faz várias chamadas à Meta). */
const METRICS_TTL_MS = 3 * 3_600_000
/** Depois de publicada, a mídia ainda fica acessível por este tempo (a Meta pode baixar de novo ao processar). */
const PUBLIC_AFTER_MS = 2 * 86_400_000

/**
 * Postagens no Instagram e no Facebook: biblioteca de mídias, calendário, textos e imagens com a IA gratuita
 * (Gemini), aprovação e publicação na hora marcada pela Graph API (com o token do Marketing Inteligente).
 */
@Injectable()
export class PostagensService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PostagensService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly metricsCache = new Map<string, { at: number; data: unknown }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly ai: EmailAiService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'postagens', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  private async integrations(tenantId: string) {
    const c = await this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)
    return { ...DEFAULT_INTEGRATIONS, ...c, metaOrganic: { ...DEFAULT_INTEGRATIONS.metaOrganic, ...c.metaOrganic }, metaAds: { ...DEFAULT_INTEGRATIONS.metaAds, ...c.metaAds } }
  }

  /**
   * Contas de publicação (Instagram e páginas). Sem lista cadastrada, usa o Instagram e a página do Marketing
   * Inteligente.
   */
  async accounts(tenantId: string): Promise<Account[]> {
    const saved = (await this.settings.get<{ accounts: Account[] }>(tenantId, ACCOUNTS_KEY, { accounts: [] })).accounts ?? []
    if (saved.length) return saved
    const c = await this.integrations(tenantId)
    const out: Account[] = []
    if (/^\d{5,25}$/.test(c.metaOrganic.instagramId)) out.push({ id: `ig-${c.metaOrganic.instagramId}`, network: 'instagram', externalId: c.metaOrganic.instagramId, name: 'Instagram', group: 'Oficial' })
    if (/^\d{5,25}$/.test(c.metaOrganic.pageId)) out.push({ id: `fb-${c.metaOrganic.pageId}`, network: 'facebook', externalId: c.metaOrganic.pageId, name: 'Página do Facebook', group: 'Oficial' })
    return out
  }

  async saveAccounts(user: AuthUser, list: unknown, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const accounts = cleanAccounts(list)
    if ('error' in accounts) throw new BadRequestException(accounts.error)
    await this.settings.set(user.tenantId, ACCOUNTS_KEY, { accounts })
    await this.audit.byUser(user, ctx, 'postagens.contas', 'settings', ACCOUNTS_KEY, { contas: accounts.map((a) => `${a.network}:${a.name}`) })
    return { accounts }
  }

  /** Contas que o token da Meta alcança (para escolher quais cadastrar). */
  async discoverAccounts(user: AuthUser) {
    this.assertCan(user, 'edit')
    const c = await this.integrations(user.tenantId)
    if (!c.metaAds.tokenEnc) throw new BadRequestException('Cadastre o token da Meta em Configurações › Marketing Inteligente.')
    try {
      return { found: await new MetaPublisher(decrypt(c.metaAds.tokenEnc)).discover() }
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }
  }

  /** Conexão com a Meta para publicar: o token do Marketing Inteligente e as contas cadastradas aqui. */
  async config(user: AuthUser) {
    this.assertCan(user, 'view')
    const c = await this.integrations(user.tenantId)
    return {
      hasToken: !!c.metaAds.tokenEnc,
      accounts: await this.accounts(user.tenantId),
      hasAi: await this.ai.available(user.tenantId),
      canApprove: can(user.permissions, user.role.isSystem, 'postagens', 'edit'),
      publicBase: env.appUrl,
    }
  }

  /** Botão "Testar publicação": permissões do token, Instagram e página. */
  async test(user: AuthUser) {
    this.assertCan(user, 'edit')
    const c = await this.integrations(user.tenantId)
    if (!c.metaAds.tokenEnc) throw new BadRequestException('Cadastre o token da Meta em Configurações › Marketing Inteligente.')
    return { checks: await new MetaPublisher(decrypt(c.metaAds.tokenEnc)).check(await this.accounts(user.tenantId)) }
  }

  // ---------- Métricas ----------

  /**
   * Métricas de cada conta (últimos 28 dias), somadas por grupo, o perfil dos seguidores (Instagram) e os números das
   * postagens publicadas pelo CRM nos últimos 60 dias. Guardadas por 3 horas; "Atualizar" busca de novo.
   */
  async metrics(user: AuthUser, refresh: boolean) {
    this.assertCan(user, 'view')
    const hit = this.metricsCache.get(user.tenantId)
    if (!refresh && hit && Date.now() - hit.at < METRICS_TTL_MS) return hit.data
    const c = await this.integrations(user.tenantId)
    if (!c.metaAds.tokenEnc) throw new BadRequestException('Cadastre o token da Meta em Configurações › Marketing Inteligente.')
    const meta = new MetaPublisher(decrypt(c.metaAds.tokenEnc))
    const accounts = await this.accounts(user.tenantId)
    const rows: (Account & AccountMetrics & { engagement: number | null; error: string | null })[] = []
    for (const a of accounts) {
      try {
        const m = a.network === 'instagram' ? await meta.instagramMetrics(a.externalId) : await meta.facebookMetrics(a.externalId)
        rows.push({ ...a, ...m, engagement: engagementRate(m), error: null })
      } catch (err) {
        rows.push({ ...a, followers: null, posts: null, reach: null, engaged: null, interactions: null, likes: null, comments: null, saves: null, shares: null, demographics: null, warnings: [], engagement: null, error: (err as Error).message.slice(0, 300) })
      }
    }
    const since = new Date(Date.now() - 60 * 86_400_000)
    const published = await this.prisma.socialPost.findMany({ where: { tenantId: user.tenantId, publishedAt: { gte: since } }, orderBy: { publishedAt: 'desc' }, take: 30, select: { id: true, title: true, format: true, publishedAt: true, results: true, mediaIds: true } })
    const posts: { postId: string; title: string; format: string; publishedAt: Date | null; mediaId: string | null; accountId: string; account: string; network: string; group: string; permalink: string | null; metrics: PostMetrics | null; engagement: number | null; error: string | null }[] = []
    for (const p of published) {
      for (const [accountId, r] of Object.entries((p.results as PostResults | null) ?? {})) {
        if (!r.id) continue
        const a = accounts.find((x) => x.id === accountId)
        const base = { postId: p.id, title: p.title, format: p.format, publishedAt: p.publishedAt, mediaId: p.mediaIds[0] ?? null, accountId, account: a?.name ?? r.name ?? accountId, network: a?.network ?? r.network ?? 'instagram', group: a?.group ?? 'Geral', permalink: r.permalink ?? null }
        try {
          const m = await meta.postMetrics(base.network as 'instagram' | 'facebook', r.id, a?.network === 'facebook' ? a.externalId : undefined)
          posts.push({ ...base, metrics: m, engagement: engagementRate({ followers: a ? (rows.find((x) => x.id === a.id)?.followers ?? null) : null, reach: m.reach, interactions: m.interactions }), error: null })
        } catch (err) {
          posts.push({ ...base, metrics: null, engagement: null, error: (err as Error).message.slice(0, 200) })
        }
      }
    }
    const data = { at: new Date().toISOString(), accounts: rows, groups: groupTotals(rows), posts }
    this.metricsCache.set(user.tenantId, { at: Date.now(), data })
    return data
  }

  // ---------- Biblioteca de mídias ----------

  async media(user: AuthUser, q: { kind?: string; page?: number }) {
    this.assertCan(user, 'view')
    const where: Prisma.SocialMediaWhereInput = { tenantId: user.tenantId, ...(q.kind === 'imagem' || q.kind === 'video' ? { kind: q.kind } : {}) }
    const page = Math.max(1, q.page ?? 1)
    const [total, items] = await Promise.all([
      this.prisma.socialMedia.count({ where }),
      this.prisma.socialMedia.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 60, take: 60, select: { id: true, kind: true, mime: true, name: true, source: true, width: true, height: true, size: true, createdByName: true, createdAt: true } }),
    ])
    return { total, page, items }
  }

  /**
   * Nova mídia: imagem JPEG (o navegador converte e enquadra antes de enviar) ou vídeo MP4/MOV. O tipo é conferido
   * pelos bytes, não pelo nome do arquivo.
   */
  async addMedia(user: AuthUser, file: Express.Multer.File | undefined, d: { name?: string; source?: string; width?: number; height?: number }) {
    this.assertCan(user, 'create')
    if (!file?.buffer?.length) throw new BadRequestException('Escolha um arquivo.')
    const type = detectPostFile(file.buffer)
    if (!type) throw new BadRequestException('Formato não aceito: imagem JPEG ou vídeo MP4.')
    if (type.kind === 'imagem' && file.size > IMAGE_MAX_BYTES) throw new BadRequestException('Imagem maior que 8 MB (limite do Instagram).')
    if (type.kind === 'video' && file.size > VIDEO_MAX_BYTES) throw new BadRequestException('Vídeo maior que 64 MB. Diminua o vídeo (ou envie pelo celular).')
    const size = type.kind === 'imagem' ? jpegSize(file.buffer) : null
    const w = size?.width ?? (Number.isFinite(d.width) ? Math.round(d.width!) : null)
    const h = size?.height ?? (Number.isFinite(d.height) ? Math.round(d.height!) : null)
    const asset = await this.files.saveBuffer(user.tenantId, 'postagem', file.buffer, type.mime, type.ext)
    const source = ['upload', 'arte', 'catalogo', 'ia', 'video'].includes(d.source ?? '') ? d.source! : 'upload'
    const name = (d.name ?? file.originalname ?? '').trim().slice(0, 120) || (type.kind === 'imagem' ? 'Imagem' : 'Vídeo')
    return this.prisma.socialMedia.create({
      data: { tenantId: user.tenantId, fileId: asset.id, kind: type.kind, mime: type.mime, name, source, width: w, height: h, size: file.size, createdById: user.id, createdByName: user.name.slice(0, 120) },
      select: { id: true, kind: true, mime: true, name: true, source: true, width: true, height: true, size: true, createdByName: true, createdAt: true },
    })
  }

  async mediaFile(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    const m = await this.prisma.socialMedia.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!m) throw new NotFoundException()
    const { content } = await this.files.read(m.fileId)
    return { mime: m.mime, content }
  }

  async removeMedia(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const m = await this.prisma.socialMedia.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!m) throw new NotFoundException('Mídia não encontrada.')
    const used = await this.prisma.socialPost.count({ where: { tenantId: user.tenantId, mediaIds: { has: id }, status: { in: ['EM_APROVACAO', 'APROVADO', 'PUBLICANDO'] } } })
    if (used) throw new BadRequestException('Esta mídia está numa postagem em aprovação ou agendada. Tire da postagem antes de apagar.')
    await this.prisma.socialMedia.delete({ where: { id } })
    await this.files.remove(m.fileId)
    await this.audit.byUser(user, ctx, 'postagens.midia_apagada', 'social_media', id, { nome: m.name })
    return { ok: true }
  }

  /** Produtos do catálogo da loja (com foto), para usar a foto numa postagem. */
  async products(user: AuthUser, search?: string) {
    this.assertCan(user, 'view')
    const s = search?.trim()
    return this.prisma.storeProduct.findMany({
      where: { tenantId: user.tenantId, active: true, image: { not: null }, ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, { code: { contains: s } }, { brand: { contains: s, mode: 'insensitive' } }] } : {}) },
      orderBy: { name: 'asc' },
      take: 40,
      select: { id: true, code: true, name: true, brand: true, url: true },
    })
  }

  /**
   * Foto de um produto do catálogo, baixada pelo servidor (a tela não pode ler imagens de outro site para montar a arte).
   * Só o endereço cadastrado do produto, só https e no máximo 8 MB.
   */
  async productImage(user: AuthUser, id: string) {
    this.assertCan(user, 'create')
    const p = await this.prisma.storeProduct.findFirst({ where: { id, tenantId: user.tenantId }, select: { image: true } })
    if (!p?.image || !/^https:\/\//i.test(p.image)) throw new NotFoundException('Produto sem foto.')
    const res = await fetch(p.image, { signal: AbortSignal.timeout(20_000), redirect: 'follow' }).catch(() => null)
    if (!res?.ok) throw new BadRequestException('Não foi possível baixar a foto do produto.')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > IMAGE_MAX_BYTES) throw new BadRequestException('Foto do produto maior que 8 MB.')
    const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim()
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new BadRequestException('A foto do produto não é uma imagem comum (JPEG, PNG ou WEBP).')
    return { mime, content: buf }
  }

  // ---------- Postagens ----------

  private shape(p: Prisma.SocialPostGetPayload<object>) {
    return {
      id: p.id,
      title: p.title,
      caption: p.caption,
      accountIds: p.accountIds,
      networks: p.networks,
      format: p.format,
      mediaIds: p.mediaIds,
      scheduledAt: p.scheduledAt,
      status: p.status,
      results: p.results,
      error: p.error,
      reviewNote: p.reviewNote,
      createdByName: p.createdByName,
      updatedByName: p.updatedByName,
      submittedAt: p.submittedAt,
      approvedByName: p.approvedByName,
      approvedAt: p.approvedAt,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }
  }

  /** Calendário: as postagens do período (pela data marcada; sem data, pela criação) e as que aguardam aprovação. */
  async list(user: AuthUser, q: { from?: string; to?: string; status?: string }) {
    this.assertCan(user, 'view')
    const from = q.from && Number.isFinite(Date.parse(q.from)) ? new Date(q.from) : new Date(Date.now() - 31 * 86_400_000)
    const to = q.to && Number.isFinite(Date.parse(q.to)) ? new Date(q.to) : new Date(Date.now() + 62 * 86_400_000)
    const where: Prisma.SocialPostWhereInput = {
      tenantId: user.tenantId,
      ...(q.status ? { status: q.status } : { OR: [{ scheduledAt: { gte: from, lte: to } }, { scheduledAt: null, createdAt: { gte: from } }, { publishedAt: { gte: from, lte: to } }] }),
    }
    const rows = await this.prisma.socialPost.findMany({ where, orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }], take: 500 })
    const counts = await this.prisma.socialPost.groupBy({ by: ['status'], where: { tenantId: user.tenantId, status: { in: ['EM_APROVACAO', 'ERRO'] } }, _count: true })
    return { items: rows.map((r) => this.shape(r)), waiting: counts.find((c) => c.status === 'EM_APROVACAO')?._count ?? 0, errors: counts.find((c) => c.status === 'ERRO')?._count ?? 0 }
  }

  private async load(user: AuthUser, id: string) {
    const p = await this.prisma.socialPost.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!p) throw new NotFoundException('Postagem não encontrada.')
    return p
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    return this.shape(await this.load(user, id))
  }

  private async mediaInfo(tenantId: string, ids: string[]): Promise<MediaInfo[]> {
    if (!ids.length) return []
    const rows = await this.prisma.socialMedia.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, kind: true, width: true, height: true } })
    return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ id: r.id, kind: r.kind as MediaInfo['kind'], width: r.width, height: r.height }))
  }

  private async clean(tenantId: string, d: PostInput): Promise<CleanPost> {
    const c = cleanPost(d, await this.accounts(tenantId))
    if ('error' in c) throw new BadRequestException(c.error)
    return c
  }

  /** O que está gravado na postagem, como entrada para as regras. */
  private stored(p: Prisma.SocialPostGetPayload<object>): PostInput {
    return { title: p.title, caption: p.caption, accountIds: p.accountIds, format: p.format, mediaIds: p.mediaIds, scheduledAt: p.scheduledAt?.toISOString() ?? null }
  }

  async create(user: AuthUser, d: PostInput, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const c = await this.clean(user.tenantId, d)
    const media = await this.mediaInfo(user.tenantId, c.mediaIds)
    const p = await this.prisma.socialPost.create({
      data: { tenantId: user.tenantId, ...c, mediaIds: media.map((m) => m.id), publicToken: randomBytes(24).toString('base64url'), createdById: user.id, createdByName: user.name.slice(0, 120) },
    })
    await this.audit.byUser(user, ctx, 'postagens.criada', 'social_post', p.id, { titulo: p.title })
    return this.shape(p)
  }

  /**
   * Salva o conteúdo. Postagem aprovada que muda de conteúdo volta para aprovação (o que foi aprovado era outra coisa);
   * só a data muda sem nova aprovação quando quem muda pode aprovar.
   */
  async update(user: AuthUser, id: string, d: PostInput, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const p = await this.load(user, id)
    if (p.status === 'PUBLICANDO' || p.status === 'PUBLICADO') throw new BadRequestException('Postagem já publicada (ou publicando): não dá mais para mudar.')
    const c = await this.clean(user.tenantId, d)
    const media = await this.mediaInfo(user.tenantId, c.mediaIds)
    const content = c.caption !== p.caption || c.format !== p.format || c.accountIds.join() !== p.accountIds.join() || media.map((m) => m.id).join() !== p.mediaIds.join()
    const approver = can(user.permissions, user.role.isSystem, 'postagens', 'edit')
    const back = p.status === 'APROVADO' && (content || !approver)
    const r = await this.prisma.socialPost.update({
      where: { id },
      data: { ...c, mediaIds: media.map((m) => m.id), updatedByName: user.name.slice(0, 120), ...(back ? { status: 'EM_APROVACAO', approvedById: null, approvedByName: null, approvedAt: null, submittedAt: new Date() } : {}), ...(p.status === 'ERRO' ? { status: 'RASCUNHO', error: null } : {}) },
    })
    await this.audit.byUser(user, ctx, 'postagens.alterada', 'social_post', id, { titulo: r.title, voltouParaAprovacao: back })
    return { ...this.shape(r), message: back ? 'Salvo. Como a postagem mudou, ela voltou para aprovação.' : 'Salvo.' }
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const p = await this.load(user, id)
    if (p.status === 'PUBLICANDO') throw new BadRequestException('A postagem está sendo publicada agora. Aguarde terminar.')
    await this.prisma.socialPost.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'postagens.apagada', 'social_post', id, { titulo: p.title, situacao: p.status })
    return { ok: true, message: p.status === 'PUBLICADO' ? 'Apagada do CRM. A publicação continua no Instagram/Facebook (apague por lá, se quiser).' : 'Postagem apagada.' }
  }

  /** Manda para aprovação (confere se está completa). */
  async submit(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const p = await this.load(user, id)
    if (!['RASCUNHO', 'ERRO'].includes(p.status)) throw new BadRequestException('Só rascunhos vão para aprovação.')
    const c = await this.clean(user.tenantId, this.stored(p))
    const missing = missingForApproval(c, await this.mediaInfo(user.tenantId, c.mediaIds))
    if (missing.length) throw new BadRequestException(`Falta completar: ${missing.join(' ')}`)
    await this.prisma.socialPost.update({ where: { id }, data: { status: 'EM_APROVACAO', submittedAt: new Date(), reviewNote: null, error: null } })
    await this.audit.byUser(user, ctx, 'postagens.enviada_aprovacao', 'social_post', id, { titulo: p.title })
    return { ok: true, message: 'Enviada para aprovação.' }
  }

  /** Aprovar: fica agendada (sem data, ou com a data já chegando, sai no próximo minuto). */
  async approve(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const p = await this.load(user, id)
    if (p.status !== 'EM_APROVACAO') throw new BadRequestException('Esta postagem não está aguardando aprovação.')
    const c = await this.clean(user.tenantId, this.stored(p))
    const missing = missingForApproval(c, await this.mediaInfo(user.tenantId, c.mediaIds))
    if (missing.length) throw new BadRequestException(`Não dá para aprovar: ${missing.join(' ')}`)
    const conn = await this.integrations(user.tenantId)
    if (!conn.metaAds.tokenEnc) throw new BadRequestException('Cadastre o token da Meta em Configurações › Marketing Inteligente antes de aprovar.')
    await this.prisma.socialPost.update({ where: { id }, data: { status: 'APROVADO', approvedById: user.id, approvedByName: user.name.slice(0, 120), approvedAt: new Date(), reviewNote: null } })
    await this.audit.byUser(user, ctx, 'postagens.aprovada', 'social_post', id, { titulo: p.title, quando: p.scheduledAt?.toISOString() ?? 'assim que aprovada' })
    return { ok: true, message: p.scheduledAt && p.scheduledAt.getTime() > Date.now() + 60_000 ? `Aprovada: sai em ${p.scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}.` : 'Aprovada: sai no próximo minuto.' }
  }

  /** Devolver para ajustes, com o motivo. */
  async reject(user: AuthUser, id: string, note: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const p = await this.load(user, id)
    if (!['EM_APROVACAO', 'APROVADO'].includes(p.status)) throw new BadRequestException('Só postagens em aprovação ou agendadas podem voltar para rascunho.')
    await this.prisma.socialPost.update({ where: { id }, data: { status: 'RASCUNHO', reviewNote: note.trim().slice(0, 500) || null, approvedById: null, approvedByName: null, approvedAt: null } })
    await this.audit.byUser(user, ctx, 'postagens.devolvida', 'social_post', id, { titulo: p.title, motivo: note.slice(0, 200) })
    return { ok: true, message: p.status === 'APROVADO' ? 'Agendamento cancelado: a postagem voltou para rascunho.' : 'Devolvida para ajustes.' }
  }

  /** Publicar agora (aprovada ou com erro: tenta de novo só as redes que faltaram). */
  async publishNow(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const p = await this.load(user, id)
    if (!['APROVADO', 'ERRO'].includes(p.status)) throw new BadRequestException(p.status === 'EM_APROVACAO' ? 'Aprove a postagem antes de publicar.' : 'Esta postagem não pode ser publicada agora.')
    if (p.status === 'ERRO' && !p.approvedAt) throw new BadRequestException('Aprove a postagem antes de publicar.')
    const claimed = await this.prisma.socialPost.updateMany({ where: { id, status: p.status }, data: { status: 'PUBLICANDO' } })
    if (!claimed.count) throw new BadRequestException('A postagem já está sendo publicada.')
    await this.audit.byUser(user, ctx, 'postagens.publicar_agora', 'social_post', id, { titulo: p.title })
    const r = await this.publish(id)
    return { ok: r.status === 'PUBLICADO', status: r.status, message: r.status === 'PUBLICADO' ? 'Publicada.' : `Não publicou: ${r.error ?? 'erro'}` }
  }

  // ---------- Publicação ----------

  /** A cada minuto: publica as aprovadas cuja hora chegou (sem data = assim que aprovadas). */
  async tick() {
    if (this.running) return
    this.running = true
    try {
      const due = await this.prisma.socialPost.findMany({ where: { status: 'APROVADO', OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] }, orderBy: { scheduledAt: 'asc' }, take: 10, select: { id: true } })
      for (const d of due) {
        const claimed = await this.prisma.socialPost.updateMany({ where: { id: d.id, status: 'APROVADO' }, data: { status: 'PUBLICANDO' } })
        if (claimed.count) await this.publish(d.id)
      }
      // Ficou "publicando" (o servidor reiniciou no meio): volta como erro para alguém conferir e tentar de novo.
      await this.prisma.socialPost.updateMany({ where: { status: 'PUBLICANDO', updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } }, data: { status: 'ERRO', error: 'A publicação foi interrompida. Confira no Instagram/Facebook se saiu e, se não, publique de novo.' } })
    } catch (err) {
      this.logger.warn(`Postagens: ${(err as Error).message}`)
    } finally {
      this.running = false
    }
  }

  /** Endereço público de uma mídia da postagem (a Meta baixa daqui). */
  mediaUrl(token: string, mediaId: string) {
    return `${env.appUrl}/api/public/postagens/${token}/${mediaId}`
  }

  private async publish(id: string) {
    const p = await this.prisma.socialPost.findUniqueOrThrow({ where: { id } })
    const results: PostResults = { ...((p.results as PostResults | null) ?? {}) }
    let error: string | null = null
    try {
      const c = await this.integrations(p.tenantId)
      if (!c.metaAds.tokenEnc) throw new Error('Token da Meta não cadastrado (Configurações › Marketing Inteligente).')
      const meta = new MetaPublisher(decrypt(c.metaAds.tokenEnc))
      const media = await this.prisma.socialMedia.findMany({ where: { tenantId: p.tenantId, id: { in: p.mediaIds } }, select: { id: true, kind: true } })
      const ordered = p.mediaIds.map((m) => media.find((x) => x.id === m)).filter((m): m is NonNullable<typeof m> => !!m)
      if (!ordered.length) throw new Error('As mídias da postagem foram apagadas da biblioteca.')
      const input = { format: p.format as PostFormat, caption: p.caption, media: ordered.map((m) => ({ kind: m.kind as 'imagem' | 'video', url: this.mediaUrl(p.publicToken, m.id) })) }
      const accounts = await this.accounts(p.tenantId)
      // Uma conta por vez: cada uma tem o seu resultado (e a nova tentativa pula as que já saíram).
      for (const id of pendingAccounts(p.accountIds, results)) {
        const a = accounts.find((x) => x.id === id)
        try {
          if (!a) throw new Error('Conta removida da lista de contas de Postagens.')
          const r = a.network === 'instagram' ? await meta.instagram(a.externalId, input) : await meta.facebook(a.externalId, input)
          results[id] = { ...r, network: a.network, name: a.name }
        } catch (err) {
          results[id] = { error: (err as Error).message.slice(0, 400), at: new Date().toISOString(), network: a?.network, name: a?.name ?? id }
        }
      }
      const failed = p.accountIds.filter((id) => !results[id]?.id)
      if (failed.length) error = failed.map((id) => `${results[id]?.network === 'facebook' ? 'Facebook' : 'Instagram'} ${results[id]?.name ?? ''}: ${results[id]?.error ?? 'não publicou'}`).join(' · ')
    } catch (err) {
      error = (err as Error).message.slice(0, 400)
    }
    const done = !error
    const r = await this.prisma.socialPost.update({ where: { id }, data: { status: done ? 'PUBLICADO' : 'ERRO', results: results as unknown as Prisma.InputJsonValue, error, ...(done ? { publishedAt: new Date() } : {}) } })
    await this.audit.log({ tenantId: p.tenantId, action: done ? 'postagens.publicada' : 'postagens.erro', entity: 'social_post', entityId: id, data: { titulo: p.title, erro: error } })
    if (error) this.logger.warn(`Postagem não publicada (${p.title}): ${error}`)
    return r
  }

  /** Mídia para a Meta baixar: só de postagem aprovada, publicando, com erro ou publicada há pouco. */
  async publicMedia(token: string, mediaId: string) {
    const p = await this.prisma.socialPost.findFirst({ where: { publicToken: token, mediaIds: { has: mediaId } }, select: { tenantId: true, status: true, publishedAt: true } })
    const open = p && (['APROVADO', 'PUBLICANDO', 'ERRO'].includes(p.status) || (p.status === 'PUBLICADO' && p.publishedAt && Date.now() - p.publishedAt.getTime() < PUBLIC_AFTER_MS))
    if (!p || !open) throw new NotFoundException()
    const m = await this.prisma.socialMedia.findFirst({ where: { id: mediaId, tenantId: p.tenantId } })
    if (!m) throw new NotFoundException()
    const { content } = await this.files.read(m.fileId)
    return { mime: m.mime, content }
  }

  // ---------- IA ----------

  private async system(tenantId: string) {
    const b = await this.settings.branding(tenantId)
    return postSystem(b.shortName || b.appName, await this.ai.about(tenantId))
  }

  async aiCaption(user: AuthUser, d: { topic?: string; network?: string; format?: string; productId?: string; current?: string; instruction?: string }) {
    this.assertCan(user, 'create')
    const product = d.productId ? await this.prisma.storeProduct.findFirst({ where: { id: d.productId, tenantId: user.tenantId }, select: { name: true, brand: true, code: true, url: true } }) : null
    const prompt = captionPrompt({ topic: (d.topic ?? '').slice(0, 500), network: d.network === 'facebook' ? 'Facebook' : d.network === 'ambos' ? 'Instagram e Facebook' : 'Instagram', format: (FORMATS as readonly string[]).includes(d.format ?? '') ? d.format! : 'FEED', product, current: d.current?.slice(0, 2200), instruction: d.instruction?.slice(0, 400) })
    if (!d.topic?.trim() && !product && !d.current?.trim()) throw new BadRequestException('Escreva o tema, escolha um produto ou escreva a legenda para a IA melhorar.')
    const raw = await this.ai.complete(user.tenantId, await this.system(user.tenantId), prompt, 1500)
    return { caption: cleanCaption(raw) }
  }

  async aiPlan(user: AuthUser, d: Partial<PlanInput> & { accountIds?: string[] }) {
    this.assertCan(user, 'create')
    const day = /^\d{4}-\d{2}-\d{2}$/
    if (!day.test(d.from ?? '') || !day.test(d.to ?? '') || d.from! > d.to!) throw new BadRequestException('Escolha o período (de / até).')
    if (Date.parse(d.to!) - Date.parse(d.from!) > 62 * 86_400_000) throw new BadRequestException('Período de no máximo 2 meses por vez.')
    const input: PlanInput = {
      from: d.from!,
      to: d.to!,
      perWeek: Math.min(14, Math.max(1, Math.round(Number(d.perWeek) || 3))),
      themes: (d.themes ?? '').slice(0, 800),
      networks: networksOf(d.accountIds ?? [], await this.accounts(user.tenantId)),
      formats: (d.formats ?? []).filter((f): f is PostFormat => (FORMATS as readonly string[]).includes(f)),
      times: (d.times ?? []).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 6),
    }
    if (!input.networks.length) input.networks = ['instagram', 'facebook']
    if (!input.formats.length) input.formats = ['FEED', 'STORIES']
    const raw = await this.ai.complete(user.tenantId, await this.system(user.tenantId), planPrompt(input), 8000)
    const items = parsePlan(raw, input)
    if (!items.length) throw new BadRequestException('A IA não devolveu um calendário válido. Tente de novo (ou diminua o período).')
    return { items }
  }

  /** Cria os rascunhos do calendário sugerido (sem mídia: escolha as imagens em cada um). */
  async createDrafts(user: AuthUser, d: { items: { date: string; time: string; format: string; title: string; caption: string; imageIdea?: string }[]; accountIds: string[] }, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const list = (d.items ?? []).slice(0, 40)
    let n = 0
    for (const it of list) {
      const at = Date.parse(`${it.date}T${it.time}:00-03:00`)
      const c = await this.clean(user.tenantId, { title: it.title, caption: it.caption, format: it.format, accountIds: d.accountIds, scheduledAt: Number.isFinite(at) ? new Date(at).toISOString() : null })
      await this.prisma.socialPost.create({ data: { tenantId: user.tenantId, ...c, reviewNote: it.imageIdea ? `Ideia de imagem: ${it.imageIdea.slice(0, 400)}` : null, publicToken: randomBytes(24).toString('base64url'), createdById: user.id, createdByName: user.name.slice(0, 120) } })
      n++
    }
    await this.audit.byUser(user, ctx, 'postagens.calendario_ia', 'social_post', undefined, { rascunhos: n })
    return { ok: true, created: n, message: `${n} rascunho(s) criado(s) no calendário. Escolha a imagem de cada um e mande para aprovação.` }
  }

  /** Imagem com a IA gratuita (volta para a tela, que enquadra, converte em JPEG e guarda na biblioteca). */
  async aiImage(user: AuthUser, d: { idea?: string; format?: string }) {
    this.assertCan(user, 'create')
    const idea = (d.idea ?? '').trim().slice(0, 600)
    if (idea.length < 5) throw new BadRequestException('Descreva a imagem (ex.: escavadeira trabalhando em obra, ao entardecer).')
    const format = (FORMATS as readonly string[]).includes(d.format ?? '') ? (d.format as PostFormat) : 'FEED'
    return this.ai.image(user.tenantId, imagePrompt(idea, format), format === 'FEED' ? '1:1' : '9:16')
  }
}
