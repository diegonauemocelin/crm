import 'dotenv/config'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`)
  return value
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback
}

function loadEnv() {
  const nodeEnv = optional('NODE_ENV', 'development')
  const jwtSecret = required('JWT_ACCESS_SECRET')
  if (jwtSecret.length < 32) throw new Error('JWT_ACCESS_SECRET precisa ter ao menos 32 caracteres')

  const encryptionKey = Buffer.from(required('APP_ENCRYPTION_KEY'), 'base64')
  if (encryptionKey.length !== 32) throw new Error('APP_ENCRYPTION_KEY precisa ser 32 bytes em base64 (openssl rand -base64 32)')

  const appUrl = new URL(required('APP_URL'))

  return {
    nodeEnv,
    isProd: nodeEnv === 'production',
    port: Number(optional('PORT', '3000')),
    databaseUrl: required('DATABASE_URL'),
    jwtAccessSecret: jwtSecret,
    encryptionKey,
    appUrl: appUrl.origin,
    cookieSecure: optional('COOKIE_SECURE', nodeEnv === 'production' ? 'true' : 'false') === 'true',
    uploadDir: optional('UPLOAD_DIR', './storage/uploads'),
    releasesFile: optional('RELEASES_FILE', '../../releases.json'),
    gitCommit: optional('GIT_COMMIT', 'dev'),
    buildDate: optional('BUILD_DATE', new Date().toISOString()),
    githubRepo: process.env.GITHUB_REPO || null,
    githubToken: process.env.GITHUB_TOKEN || null,
    tenantSlug: optional('TENANT_SLUG', 'default'),
    smtpAllowPrivate: optional('SMTP_ALLOW_PRIVATE', 'false') === 'true',
    // WhatsApp (Evolution API na rede interna do Docker). Sem a chave, o módulo fica desligado.
    evolutionUrl: optional('EVOLUTION_URL', 'http://evolution:8080').replace(/\/+$/, ''),
    evolutionApiKey: process.env.EVOLUTION_API_KEY || null,
    evolutionWebhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET || null,
    /** Endereço da API do CRM visto de dentro da rede do Docker (a Evolution manda os eventos para cá). */
    internalApiUrl: optional('INTERNAL_API_URL', 'http://api:3000').replace(/\/+$/, ''),
    whatsappMaxNumbers: Math.max(1, Number(optional('WHATSAPP_MAX_NUMBERS', '10')) || 10),
    whatsappMaxConnected: Math.max(1, Number(optional('WHATSAPP_MAX_CONNECTED', '3')) || 3),
    accessTokenTtlSec: 15 * 60,
    refreshTokenTtlSec: 12 * 60 * 60,
  }
}

export const env = loadEnv()
export type Env = typeof env
