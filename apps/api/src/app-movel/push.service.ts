import { Injectable, Logger } from '@nestjs/common'
import webpush from 'web-push'
import { decrypt, encrypt } from '../common/crypto'
import type { AuthUser } from '../common/types'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'

interface PushKeys {
  publicKey: string
  privateKeyEnc: string
}

export interface PushMessage {
  title: string
  body: string
  /** Endereço aberto ao tocar na notificação (ex.: /app/conversa/<id>). */
  url: string
  /** Mesma etiqueta substitui a notificação anterior (ex.: uma por conversa). */
  tag?: string
}

/**
 * Notificações do app no celular (Web Push). As chaves VAPID são criadas na primeira vez e guardadas nas
 * configurações da empresa (a privada criptografada). Inscrição que o navegador recusou (404/410) é apagada.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push')
  /** Teste: troca o envio de verdade. */
  sender: (sub: webpush.PushSubscription, payload: string, opts: webpush.RequestOptions) => Promise<unknown> = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async keys(tenantId: string): Promise<{ publicKey: string; privateKey: string }> {
    const s = await this.settings.get<Partial<PushKeys>>(tenantId, 'web_push', {})
    if (s.publicKey && s.privateKeyEnc) return { publicKey: s.publicKey, privateKey: decrypt(s.privateKeyEnc) }
    const k = webpush.generateVAPIDKeys()
    await this.settings.set<PushKeys>(tenantId, 'web_push', { publicKey: k.publicKey, privateKeyEnc: encrypt(k.privateKey) })
    return k
  }

  async publicKey(tenantId: string) {
    return (await this.keys(tenantId)).publicKey
  }

  async subscribe(user: AuthUser, d: { endpoint: string; p256dh: string; auth: string }, userAgent?: string) {
    // O mesmo aparelho pode passar de um usuário para outro: a inscrição fica com quem entrou por último.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: d.endpoint },
      create: { tenantId: user.tenantId, userId: user.id, endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth, userAgent: userAgent?.slice(0, 300) },
      update: { tenantId: user.tenantId, userId: user.id, p256dh: d.p256dh, auth: d.auth, userAgent: userAgent?.slice(0, 300) },
    })
    return { ok: true }
  }

  async unsubscribe(user: AuthUser, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } })
    return { ok: true }
  }

  /** Envia para todos os aparelhos dos usuários. Nunca derruba quem chamou. */
  async notify(tenantId: string, userIds: string[], msg: PushMessage) {
    const ids = [...new Set(userIds)]
    if (!ids.length) return 0
    try {
      const subs = await this.prisma.pushSubscription.findMany({ where: { tenantId, userId: { in: ids } } })
      if (!subs.length) return 0
      const k = await this.keys(tenantId)
      const subject = env.appUrl.startsWith('https://') ? env.appUrl : 'mailto:crm@localhost.invalid'
      const payload = JSON.stringify({ title: msg.title.slice(0, 80), body: msg.body.slice(0, 180), url: msg.url, tag: msg.tag })
      let sent = 0
      await Promise.all(
        subs.map(async (s) => {
          try {
            await this.sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 3600, urgency: 'high', timeout: 10_000 })
            sent++
            await this.prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } })
          } catch (err) {
            const code = (err as { statusCode?: number }).statusCode
            if (code === 404 || code === 410) await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } })
            else this.logger.warn(`Notificação não saiu (${code ?? 'sem código'}): ${(err as Error).message}`)
          }
        }),
      )
      return sent
    } catch (err) {
      this.logger.warn(`Notificações: ${(err as Error).message}`)
      return 0
    }
  }
}
