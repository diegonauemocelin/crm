import { Injectable } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'

export interface BrandingSettings {
  appName: string
  shortName: string
  primaryColor: string
  sidebarColor: string
  logoFileId: string | null
  logoDarkFileId: string | null
  faviconFileId: string | null
  loginTitle: string
  loginSubtitle: string
  defaultLayout: 'MODERN' | 'CLASSIC'
  allowLayoutChoice: boolean
  supportEmail: string
}

export type SmtpSecurity = 'ssl' | 'starttls' | 'none'

export interface SmtpSettings {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  passwordEnc: string | null
  fromName: string
  fromEmail: string
  replyTo: string
  /** 0 = sem limite. */
  maxPerMinute: number
}

export const DEFAULT_BRANDING: BrandingSettings = {
  appName: 'CRM USA Parts',
  shortName: 'USA Parts',
  primaryColor: '#1d4ed8',
  sidebarColor: '#0f1e3d',
  logoFileId: null,
  logoDarkFileId: null,
  faviconFileId: null,
  loginTitle: 'Bem-vindo de volta',
  loginSubtitle: 'Acesse sua conta para continuar.',
  defaultLayout: 'MODERN',
  allowLayoutChoice: true,
  supportEmail: '',
}

export const DEFAULT_SMTP: SmtpSettings = {
  host: '',
  port: 465,
  security: 'ssl',
  username: '',
  passwordEnc: null,
  fromName: '',
  fromEmail: '',
  replyTo: '',
  maxPerMinute: 0,
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T extends object>(tenantId: string, key: string, defaults: T): Promise<T> {
    const row = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key } } })
    return { ...defaults, ...((row?.value as Partial<T> | undefined) ?? {}) }
  }

  async set<T extends object>(tenantId: string, key: string, value: T): Promise<T> {
    const json = value as unknown as Prisma.InputJsonValue
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: json },
      update: { value: json },
    })
    return value
  }

  branding(tenantId: string) {
    return this.get(tenantId, 'branding', DEFAULT_BRANDING)
  }

  smtp(tenantId: string) {
    return this.get(tenantId, 'smtp', DEFAULT_SMTP)
  }
}

export function publicBranding(b: BrandingSettings) {
  const { logoFileId, logoDarkFileId, faviconFileId, ...rest } = b
  return {
    ...rest,
    logoUrl: logoFileId ? `/api/files/public/${logoFileId}` : null,
    logoDarkUrl: logoDarkFileId ? `/api/files/public/${logoDarkFileId}` : null,
    faviconUrl: faviconFileId ? `/api/files/public/${faviconFileId}` : null,
  }
}
