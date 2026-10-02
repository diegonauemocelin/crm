import { BadRequestException, Injectable } from '@nestjs/common'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import * as nodemailer from 'nodemailer'
import { env } from '../config/env'
import { decrypt } from '../common/crypto'
import { type BrandingSettings, SettingsService, type SmtpSettings } from './settings.service'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

/** Bloqueia apontar o SMTP para a rede interna (proteção contra SSRF / varredura de portas internas). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

@Injectable()
export class MailService {
  constructor(private readonly settings: SettingsService) {}

  /** Resolve o host uma única vez e conecta direto no IP verificado, evitando DNS rebinding entre a checagem e a conexão. */
  async resolveSafeHost(host: string): Promise<string> {
    if (env.smtpAllowPrivate) return host
    let addresses: { address: string }[]
    try {
      addresses = await lookup(host, { all: true })
    } catch {
      throw new BadRequestException(`Não foi possível resolver o servidor "${host}". Confira o endereço.`)
    }
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      throw new BadRequestException('O servidor SMTP não pode apontar para um endereço de rede interna.')
    }
    return addresses[0]!.address
  }

  async transport(config: SmtpSettings, password?: string) {
    if (!config.host || !config.fromEmail) throw new BadRequestException('Servidor de e-mail não configurado. Acesse Configurações > E-mail.')
    const address = await this.resolveSafeHost(config.host)
    const pass = password ?? (config.passwordEnc ? decrypt(config.passwordEnc) : undefined)
    return nodemailer.createTransport({
      host: address,
      port: config.port,
      secure: config.security === 'ssl',
      requireTLS: config.security === 'starttls',
      auth: config.username ? { user: config.username, pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      // O certificado continua sendo validado contra o nome do servidor, não contra o IP.
      tls: { minVersion: 'TLSv1.2', servername: config.host },
    })
  }

  async send(tenantId: string, message: MailMessage) {
    const config = await this.settings.smtp(tenantId)
    await this.sendWith(config, message)
  }

  async sendWith(config: SmtpSettings, message: MailMessage, password?: string) {
    const transport = await this.transport(config, password)
    try {
      await transport.sendMail({
        from: config.fromName ? { name: config.fromName, address: config.fromEmail } : config.fromEmail,
        replyTo: config.replyTo || undefined,
        ...message,
      })
    } finally {
      transport.close()
    }
  }

  async verify(config: SmtpSettings, password?: string) {
    const transport = await this.transport(config, password)
    try {
      await transport.verify()
    } finally {
      transport.close()
    }
  }

  /** Template HTML simples e compatível com clientes de e-mail (tabelas e estilos inline). */
  simpleTemplate(
    branding: BrandingSettings,
    c: { title: string; greeting: string; body: string; buttonLabel?: string; buttonUrl?: string; footnote?: string },
  ) {
    const color = /^#[0-9a-f]{6}$/i.test(branding.primaryColor) ? branding.primaryColor : '#1d4ed8'
    const button =
      c.buttonLabel && c.buttonUrl
        ? `<tr><td style="padding:8px 0 24px"><a href="${escapeHtml(c.buttonUrl)}" style="background:${color};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:600">${escapeHtml(c.buttonLabel)}</a></td></tr>`
        : ''
    return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;padding-bottom:16px">${escapeHtml(c.title)}</td></tr>
<tr><td style="font-size:15px;line-height:22px;padding-bottom:8px">${escapeHtml(c.greeting)}</td></tr>
<tr><td style="font-size:15px;line-height:22px;padding-bottom:24px">${escapeHtml(c.body)}</td></tr>
${button}
${c.footnote ? `<tr><td style="font-size:13px;color:#6b7280">${escapeHtml(c.footnote)}</td></tr>` : ''}
</table>
<p style="font-size:12px;color:#9ca3af;margin-top:16px">${escapeHtml(branding.appName)}</p>
</td></tr></table></body></html>`
  }
}
