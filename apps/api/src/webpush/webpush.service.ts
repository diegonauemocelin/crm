import { createHmac } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import webpush from 'web-push'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { type Action, can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { downloadPublic } from '../fretes/download'
import { FilesService } from '../files/files.service'
import type { WebPushCampaign } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { domainAllowed } from '../rastreamento/origem'
import { RastreamentoService } from '../rastreamento/rastreamento.service'
import { SettingsService } from '../settings/settings.service'
import {
  buildPayload,
  buildServiceWorker,
  type CampaignInput,
  campaignError,
  cleanPrompt,
  DEFAULT_SETTINGS,
  type PromptSettings,
  parseSubscribe,
  parseUnsubscribe,
  saoPauloToUtc,
  scheduleError,
  SETTINGS_KEY,
  type SitePushSettings,
  siteOrigin,
  signDelivery,
  statsOf,
  SW_FILE,
  SW_MARKER,
  verifyDelivery,
  withUtm,
} from './webpush'

const TICK_MS = 60_000
/** Inscritos lidos por vez e envios ao mesmo tempo. */
const PAGE = 500
const CONCURRENCY = 25
/** Falhas seguidas (fora 404/410) até o inscrito sair da lista. */
const MAX_FAILS = 5
/** Limite de segurança por empresa (evita que alguém encha a base com inscrições falsas). */
const MAX_SUBSCRIBERS = 500_000
export const IMAGE_KIND = 'webpush-image'
const IMAGE_LIMIT = 1024 * 1024

const fileUrl = (id: string) => `${env.appUrl}/api/files/public/${id}`

export interface CampaignBody extends CampaignInput {
  iconFileId?: string | null
  imageFileId?: string | null
}

/**
 * Marketing › Web Push: inscrição dos visitantes da loja, campanhas, envio agendado e contagem de entregas e cliques.
 * Chaves VAPID próprias do site (configuração "site_push"); as do app no celular ("web_push") não são tocadas.
 */
@Injectable()
export class WebPushService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WebPush')
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  /** Campanhas sendo enviadas por este processo (e as empresas delas: uma por vez por empresa). */
  private readonly running = new Set<string>()
  private readonly busyTenants = new Set<string>()
  private readonly keyLocks = new Map<string, Promise<{ publicKey: string; privateKey: string }>>()
  /** Teste: troca o envio de verdade. */
  sender: (sub: webpush.PushSubscription, payload: string, opts: webpush.RequestOptions) => Promise<unknown> = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tracking: RastreamentoService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private assertCan(user: AuthUser, action: Action) {
    if (!can(user.permissions, user.role.isSystem, 'web_push', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  private linkKey() {
    return createHmac('sha256', env.jwtAccessSecret).update('webpush-v1').digest()
  }

  // ---------- Configuração ----------

  async config(tenantId: string): Promise<SitePushSettings> {
    const s = await this.settings.get<SitePushSettings>(tenantId, SETTINGS_KEY, DEFAULT_SETTINGS)
    return { ...s, prompt: cleanPrompt(s.prompt) }
  }

  /** Cria o par de chaves na primeira vez (uma vez só, mesmo com dois pedidos ao mesmo tempo). */
  private keys(tenantId: string) {
    const pending = this.keyLocks.get(tenantId)
    if (pending) return pending
    const p = (async () => {
      const s = await this.config(tenantId)
      if (s.publicKey && s.privateKeyEnc) return { publicKey: s.publicKey, privateKey: decrypt(s.privateKeyEnc) }
      const k = webpush.generateVAPIDKeys()
      await this.settings.set<SitePushSettings>(tenantId, SETTINGS_KEY, { ...s, publicKey: k.publicKey, privateKeyEnc: encrypt(k.privateKey) })
      return k
    })().finally(() => this.keyLocks.delete(tenantId))
    this.keyLocks.set(tenantId, p)
    return p
  }

  private async siteOf(tenantId: string, s: SitePushSettings) {
    const track = await this.tracking.config(tenantId)
    const siteUrl = siteOrigin(s.siteUrl) ?? (track.domains[0] ? siteOrigin(track.domains[0]) : null)
    const host = siteUrl ? new URL(siteUrl).hostname : null
    return { track, siteUrl, scriptOk: track.enabled && !!host && domainAllowed(host, track.domains) }
  }

  async view(user: AuthUser) {
    this.assertCan(user, 'view')
    const s = await this.config(user.tenantId)
    const { track, siteUrl, scriptOk } = await this.siteOf(user.tenantId, s)
    const subscribers = await this.prisma.webPushSubscriber.count({ where: { tenantId: user.tenantId, active: true } })
    return {
      enabled: s.enabled,
      siteUrl,
      prompt: s.prompt,
      subscribers,
      swFile: SW_FILE,
      swUrl: siteUrl ? `${siteUrl}/${SW_FILE}` : null,
      tracking: { enabled: track.enabled, domains: track.domains, scriptOk },
      defaultIconUrl: await this.defaultIcon(user.tenantId),
    }
  }

  async saveConfig(user: AuthUser, dto: { enabled: boolean; siteUrl: string; prompt: Partial<PromptSettings> }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const siteUrl = dto.siteUrl.trim() ? siteOrigin(dto.siteUrl) : ''
    if (siteUrl === null) throw new BadRequestException('Endereço da loja inválido. Use só o domínio com https, ex.: https://www.usaparts.com.br')
    const current = await this.config(user.tenantId)
    const next: SitePushSettings = { ...current, enabled: dto.enabled, siteUrl, prompt: cleanPrompt(dto.prompt) }
    if (next.enabled) {
      const { scriptOk } = await this.siteOf(user.tenantId, next)
      if (!scriptOk) throw new BadRequestException('Para ativar a coleta, o script do CRM precisa estar ligado nesse domínio (Configurações › Rastreamento do site).')
    }
    await this.settings.set(user.tenantId, SETTINGS_KEY, next)
    if (next.enabled) await this.keys(user.tenantId)
    await this.audit.byUser(user, ctx, 'webpush.config', 'settings', SETTINGS_KEY, { ativo: next.enabled, site: siteUrl })
    return this.view(user)
  }

  /** Arquivo do service worker para baixar e publicar na raiz da loja. */
  async swFile(user: AuthUser) {
    this.assertCan(user, 'view')
    const track = await this.tracking.config(user.tenantId)
    return buildServiceWorker({ apiBase: env.appUrl, siteKey: track.siteKey })
  }

  /** Confere se https://loja/crm-push-sw.js responde com o arquivo certo. */
  async checkSw(user: AuthUser) {
    this.assertCan(user, 'view')
    const s = await this.config(user.tenantId)
    const { siteUrl } = await this.siteOf(user.tenantId, s)
    if (!siteUrl) return { ok: false, url: null, message: 'Informe o endereço da loja.' }
    const url = `${siteUrl}/${SW_FILE}`
    try {
      const body = (await downloadPublic(url, 64 * 1024)).toString('utf8')
      if (!body.includes(SW_MARKER)) return { ok: false, url, message: 'O endereço responde, mas não é o arquivo do CRM (baixe de novo e publique sem alterar).' }
      return { ok: true, url, message: 'Arquivo encontrado na raiz da loja.' }
    } catch (err) {
      return { ok: false, url, message: `Arquivo não encontrado: ${(err as Error).message}.` }
    }
  }

  private async defaultIcon(tenantId: string) {
    const b = await this.settings.branding(tenantId)
    const id = b.appIconFileId || b.faviconFileId || b.logoFileId
    return id ? fileUrl(id) : null
  }

  // ---------- Rotas públicas (loja) ----------

  private async siteFor(key: string, origin: string | undefined) {
    const site = await this.tracking.siteByKey(key)
    if (!site?.s.enabled || !origin) return null
    try {
      return domainAllowed(new URL(origin).hostname, site.s.domains) ? site : null
    } catch {
      return null
    }
  }

  /** Configuração da caixa de permissão para o script do site. null: não responde para essa origem. */
  async publicConfig(key: string, origin: string | undefined) {
    const site = await this.siteFor(key, origin)
    if (!site) return null
    const s = await this.config(site.tenantId)
    if (!s.enabled || !s.publicKey) return { allowed: true, body: { enabled: false } }
    // Só no domínio da loja (onde está o service worker): landing pages e outros subdomínios não pedem a permissão.
    const { siteUrl } = await this.siteOf(site.tenantId, s)
    const host = siteUrl ? new URL(siteUrl).hostname : null
    return { allowed: true, body: { enabled: true, key: s.publicKey, sw: SW_FILE, host, icon: await this.defaultIcon(site.tenantId), prompt: s.prompt } }
  }

  async subscribe(raw: unknown, origin: string | undefined, userAgent: string | undefined) {
    const p = parseSubscribe(raw)
    if (!p) return false
    const site = await this.siteFor(p.k, origin)
    if (!site) return false
    const tenantId = site.tenantId
    const s = await this.config(tenantId)
    if (!s.enabled) return false
    const existing = await this.prisma.webPushSubscriber.findUnique({ where: { endpoint: p.endpoint }, select: { id: true, tenantId: true, leadId: true } })
    if (existing && existing.tenantId !== tenantId) return false
    const visitor = p.v ? await this.prisma.siteVisitor.findUnique({ where: { tenantId_clientId: { tenantId, clientId: p.v } }, select: { leadId: true } }) : null
    const leadId = visitor?.leadId ?? existing?.leadId ?? null
    const data = { p256dh: p.p256dh, auth: p.auth, userAgent: userAgent?.slice(0, 300) ?? null, visitorId: p.v ?? undefined, leadId, active: true, failCount: 0, failedAt: null, lastSeenAt: new Date() }
    if (existing) {
      await this.prisma.webPushSubscriber.update({ where: { id: existing.id }, data })
    } else {
      if ((await this.prisma.webPushSubscriber.count({ where: { tenantId, active: true } })) >= MAX_SUBSCRIBERS) return false
      await this.prisma.webPushSubscriber.create({ data: { ...data, tenantId, endpoint: p.endpoint } })
    }
    return true
  }

  async unsubscribe(raw: unknown, origin: string | undefined) {
    const p = parseUnsubscribe(raw)
    if (!p) return
    const site = await this.siteFor(p.k, origin)
    if (!site) return
    await this.prisma.webPushSubscriber.updateMany({ where: { tenantId: site.tenantId, endpoint: p.endpoint }, data: { active: false } })
  }

  /** O service worker mostrou a notificação: conta a entrega (uma por inscrito). */
  async shown(campaignId: string, u: unknown) {
    const sub = verifyDelivery(this.linkKey(), campaignId, u)
    if (!sub) return
    const r = await this.prisma.webPushDelivery.updateMany({ where: { campaignId, subscriberId: sub, shownAt: null }, data: { shownAt: new Date() } })
    if (r.count) await this.prisma.webPushCampaign.update({ where: { id: campaignId }, data: { delivered: { increment: 1 } } })
  }

  /** Clique: conta (uma vez por inscrito) e devolve o link da própria campanha. Nunca um endereço vindo do pedido. */
  async click(campaignId: string, u: unknown): Promise<string | null> {
    const c = await this.prisma.webPushCampaign.findUnique({ where: { id: campaignId }, select: { url: true, name: true, status: true } })
    if (!c || !['ENVIANDO', 'ENVIADO'].includes(c.status)) return null
    const sub = verifyDelivery(this.linkKey(), campaignId, u)
    if (sub) {
      const now = new Date()
      const shown = await this.prisma.webPushDelivery.updateMany({ where: { campaignId, subscriberId: sub, shownAt: null }, data: { shownAt: now } })
      const clicked = await this.prisma.webPushDelivery.updateMany({ where: { campaignId, subscriberId: sub, clickedAt: null }, data: { clickedAt: now } })
      if (shown.count || clicked.count) {
        await this.prisma.webPushCampaign.update({ where: { id: campaignId }, data: { delivered: { increment: shown.count }, clicks: { increment: clicked.count } } })
      }
    }
    return withUtm(c.url, c.name)
  }

  // ---------- Campanhas ----------

  private present(c: WebPushCampaign) {
    return {
      id: c.id,
      name: c.name,
      title: c.title,
      message: c.message,
      url: c.url,
      buttonLabel: c.buttonLabel,
      iconFileId: c.iconFileId,
      iconUrl: c.iconFileId ? fileUrl(c.iconFileId) : null,
      imageFileId: c.imageFileId,
      imageUrl: c.imageFileId ? fileUrl(c.imageFileId) : null,
      status: c.status,
      scheduledAt: c.scheduledAt,
      sentAt: c.sentAt,
      finishedAt: c.finishedAt,
      targets: c.targets,
      sent: c.sent,
      failed: c.failed,
      delivered: c.delivered,
      clicks: c.clicks,
      ...statsOf(c),
      error: c.error,
      createdByName: c.createdByName,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }
  }

  async list(user: AuthUser) {
    this.assertCan(user, 'view')
    const rows = await this.prisma.webPushCampaign.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ updatedAt: 'desc' }], take: 500 })
    return rows.map((r) => this.present(r))
  }

  private async own(user: AuthUser, id: string) {
    const c = await this.prisma.webPushCampaign.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!c) throw new NotFoundException('Web push não encontrado.')
    return c
  }

  async get(user: AuthUser, id: string) {
    this.assertCan(user, 'view')
    return this.present(await this.own(user, id))
  }

  private async checkFiles(tenantId: string, ids: (string | null | undefined)[]) {
    for (const id of ids) {
      if (!id) continue
      const f = await this.prisma.fileAsset.findFirst({ where: { id, tenantId, kind: IMAGE_KIND }, select: { id: true } })
      if (!f) throw new BadRequestException('Imagem não encontrada. Envie de novo.')
    }
  }

  private fields(d: CampaignBody) {
    return {
      name: d.name.trim(),
      title: d.title.trim(),
      message: d.message.trim(),
      url: d.url.trim(),
      buttonLabel: d.buttonLabel == null ? null : d.buttonLabel.trim(),
      iconFileId: d.iconFileId ?? null,
      imageFileId: d.imageFileId ?? null,
    }
  }

  async create(user: AuthUser, d: CampaignBody, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const err = campaignError(d, false)
    if (err) throw new BadRequestException(err)
    await this.checkFiles(user.tenantId, [d.iconFileId, d.imageFileId])
    const c = await this.prisma.webPushCampaign.create({ data: { ...this.fields(d), tenantId: user.tenantId, createdById: user.id, createdByName: user.name } })
    await this.audit.byUser(user, ctx, 'webpush.criado', 'web_push', c.id, { nome: c.name })
    return this.present(c)
  }

  async update(user: AuthUser, id: string, d: CampaignBody, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const c = await this.own(user, id)
    if (!['RASCUNHO', 'AGENDADO', 'CANCELADO'].includes(c.status)) throw new BadRequestException('Web push já enviado não pode ser alterado. Use Duplicar.')
    // Agendado continua agendado: precisa estar completo.
    const err = campaignError(d, c.status === 'AGENDADO')
    if (err) throw new BadRequestException(err)
    await this.checkFiles(user.tenantId, [d.iconFileId, d.imageFileId])
    const r = await this.prisma.webPushCampaign.updateMany({ where: { id, tenantId: user.tenantId, status: c.status }, data: this.fields(d) })
    if (!r.count) throw new BadRequestException('O web push mudou de situação enquanto você editava. Abra de novo.')
    await this.audit.byUser(user, ctx, 'webpush.alterado', 'web_push', id, { nome: d.name })
    return this.present(await this.own(user, id))
  }

  private async readyToSend(user: AuthUser, id: string) {
    this.assertCan(user, 'edit')
    const c = await this.own(user, id)
    if (!['RASCUNHO', 'CANCELADO', 'AGENDADO'].includes(c.status)) throw new BadRequestException('Este web push já foi enviado.')
    const err = campaignError(c, true)
    if (err) throw new BadRequestException(err)
    const s = await this.config(user.tenantId)
    if (!s.publicKey) throw new BadRequestException('Ative a coleta de inscritos em Gerenciar coleta antes de enviar.')
    return c
  }

  async sendNow(user: AuthUser, id: string, ctx: RequestCtx) {
    const c = await this.readyToSend(user, id)
    const targets = await this.prisma.webPushSubscriber.count({ where: { tenantId: user.tenantId, active: true } })
    if (!targets) throw new BadRequestException('Ainda não há inscritos para receber.')
    await this.prisma.webPushCampaign.updateMany({ where: { id, status: c.status }, data: { status: 'AGENDADO', scheduledAt: new Date(), error: null } })
    await this.audit.byUser(user, ctx, 'webpush.enviado', 'web_push', id, { nome: c.name, inscritos: targets })
    void this.tick()
    return this.present(await this.own(user, id))
  }

  async schedule(user: AuthUser, id: string, date: string, time: string, ctx: RequestCtx) {
    const c = await this.readyToSend(user, id)
    const at = saoPauloToUtc(date, time)
    if (!at) throw new BadRequestException('Data ou hora inválida.')
    const err = scheduleError(at, new Date())
    if (err) throw new BadRequestException(err)
    await this.prisma.webPushCampaign.updateMany({ where: { id, status: c.status }, data: { status: 'AGENDADO', scheduledAt: at, error: null } })
    await this.audit.byUser(user, ctx, 'webpush.agendado', 'web_push', id, { nome: c.name, quando: at.toISOString() })
    return this.present(await this.own(user, id))
  }

  /** Tira do agendamento: volta para os rascunhos. */
  async cancel(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const r = await this.prisma.webPushCampaign.updateMany({ where: { id, tenantId: user.tenantId, status: 'AGENDADO' }, data: { status: 'RASCUNHO', scheduledAt: null } })
    if (!r.count) throw new BadRequestException('Só dá para cancelar um web push agendado que ainda não começou a sair.')
    await this.audit.byUser(user, ctx, 'webpush.cancelado', 'web_push', id)
    return this.present(await this.own(user, id))
  }

  async duplicate(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const c = await this.own(user, id)
    const copy = await this.prisma.webPushCampaign.create({
      data: { tenantId: user.tenantId, name: `${c.name} (cópia)`.slice(0, 80), title: c.title, message: c.message, url: c.url, buttonLabel: c.buttonLabel, iconFileId: c.iconFileId, imageFileId: c.imageFileId, createdById: user.id, createdByName: user.name },
    })
    await this.audit.byUser(user, ctx, 'webpush.duplicado', 'web_push', copy.id, { de: id })
    return this.present(copy)
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user, 'delete')
    const r = await this.prisma.webPushCampaign.deleteMany({ where: { id, tenantId: user.tenantId, status: { in: ['RASCUNHO', 'CANCELADO'] } } })
    if (!r.count) throw new BadRequestException('Só rascunhos podem ser excluídos.')
    await this.audit.byUser(user, ctx, 'webpush.excluido', 'web_push', id)
    return { ok: true }
  }

  async uploadImage(user: AuthUser, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    this.assertCan(user, 'create')
    const asset = await this.files.saveImage(user.tenantId, IMAGE_KIND, file, true, { maxBytes: IMAGE_LIMIT, types: ['png', 'jpg', 'webp', 'gif'] })
    await this.audit.byUser(user, ctx, 'webpush.imagem', 'file', asset.id, { tamanho: asset.size })
    return { id: asset.id, url: fileUrl(asset.id) }
  }

  // ---------- Envio ----------

  /** A cada minuto: retoma envios interrompidos (reinício) e começa os agendados que venceram, um por empresa. */
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      const sending = await this.prisma.webPushCampaign.findMany({ where: { status: 'ENVIANDO' }, select: { id: true, tenantId: true } })
      for (const c of sending) if (!this.running.has(c.id) && !this.busyTenants.has(c.tenantId)) void this.run(c.id, c.tenantId)
      const busy = new Set([...sending.map((c) => c.tenantId), ...this.busyTenants])
      const due = await this.prisma.webPushCampaign.findMany({ where: { status: 'AGENDADO', scheduledAt: { lte: new Date() } }, orderBy: { scheduledAt: 'asc' }, take: 50, select: { id: true, tenantId: true } })
      for (const c of due) {
        if (busy.has(c.tenantId)) continue
        const claimed = await this.prisma.webPushCampaign.updateMany({ where: { id: c.id, status: 'AGENDADO' }, data: { status: 'ENVIANDO', sentAt: new Date() } })
        if (!claimed.count) continue
        busy.add(c.tenantId)
        void this.run(c.id, c.tenantId)
      }
    } catch (err) {
      this.logger.warn(`Web push: ${(err as Error).message}`)
    } finally {
      this.ticking = false
    }
  }

  private async run(id: string, tenantId: string) {
    this.running.add(id)
    this.busyTenants.add(tenantId)
    try {
      let c = await this.prisma.webPushCampaign.findUnique({ where: { id } })
      if (!c || c.status !== 'ENVIANDO') return
      if (!c.targets) {
        const targets = await this.prisma.webPushSubscriber.count({ where: { tenantId, active: true } })
        c = await this.prisma.webPushCampaign.update({ where: { id }, data: { targets } })
      }
      const s = await this.config(tenantId)
      if (!s.publicKey || !s.privateKeyEnc) throw new Error('chaves do Web Push não criadas (ative a coleta)')
      const vapid = { subject: siteOrigin(s.siteUrl) ?? (env.appUrl.startsWith('https://') ? env.appUrl : 'mailto:crm@localhost.invalid'), publicKey: s.publicKey, privateKey: decrypt(s.privateKeyEnc) }
      const icon = c.iconFileId ? fileUrl(c.iconFileId) : await this.defaultIcon(tenantId)
      const image = c.imageFileId ? fileUrl(c.imageFileId) : null
      const key = this.linkKey()
      let cursor: string | undefined
      for (;;) {
        // Só quem ainda não recebeu esta campanha: depois de reiniciar, continua de onde parou.
        const subs = await this.prisma.webPushSubscriber.findMany({
          where: { tenantId, active: true, deliveries: { none: { campaignId: id } }, ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: { id: 'asc' },
          take: PAGE,
        })
        if (!subs.length) break
        cursor = subs[subs.length - 1]!.id
        const ok: string[] = []
        const gone: string[] = []
        const failed: string[] = []
        for (let i = 0; i < subs.length; i += CONCURRENCY) {
          await Promise.all(
            subs.slice(i, i + CONCURRENCY).map(async (sub) => {
              const u = signDelivery(key, id, sub.id)
              const payload = buildPayload({
                title: c.title,
                body: c.message,
                icon,
                image,
                url: `${env.appUrl}/api/public/webpush/c/${id}?u=${u}`,
                button: c.buttonLabel,
                shown: `${env.appUrl}/api/public/webpush/e/${id}?u=${u}`,
                tag: `crm-${id}`,
              })
              try {
                await this.sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { vapidDetails: vapid, TTL: 86_400, urgency: 'normal', timeout: 15_000 })
                ok.push(sub.id)
              } catch (err) {
                const code = (err as { statusCode?: number }).statusCode
                if (code === 404 || code === 410) gone.push(sub.id)
                else failed.push(sub.id)
              }
            }),
          )
        }
        const now = new Date()
        if (ok.length) {
          await this.prisma.webPushDelivery.createMany({ data: ok.map((subscriberId) => ({ campaignId: id, subscriberId })), skipDuplicates: true })
          await this.prisma.webPushSubscriber.updateMany({ where: { id: { in: ok } }, data: { failCount: 0, lastSeenAt: now } })
        }
        // Inscrição que o navegador cancelou (404/410): sai da lista.
        if (gone.length) await this.prisma.webPushSubscriber.updateMany({ where: { id: { in: gone } }, data: { active: false, failedAt: now } })
        if (failed.length) {
          await this.prisma.webPushSubscriber.updateMany({ where: { id: { in: failed } }, data: { failCount: { increment: 1 }, failedAt: now } })
          await this.prisma.webPushSubscriber.updateMany({ where: { id: { in: failed }, failCount: { gte: MAX_FAILS } }, data: { active: false } })
        }
        await this.prisma.webPushCampaign.update({ where: { id }, data: { sent: { increment: ok.length }, failed: { increment: gone.length + failed.length } } })
        if (subs.length < PAGE) break
      }
      await this.prisma.webPushCampaign.update({ where: { id }, data: { status: 'ENVIADO', finishedAt: new Date() } })
    } catch (err) {
      this.logger.warn(`Web push ${id} não saiu: ${(err as Error).message}`)
      await this.prisma.webPushCampaign.update({ where: { id }, data: { status: 'ERRO', error: (err as Error).message.slice(0, 300), finishedAt: new Date() } }).catch(() => undefined)
    } finally {
      this.running.delete(id)
      this.busyTenants.delete(tenantId)
    }
  }
}
