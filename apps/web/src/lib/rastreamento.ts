export interface Touch {
  source: string
  medium: string
  campaign?: string
  term?: string
  content?: string
  referrer?: string
  landing?: string
}

export interface TrackingConfig {
  enabled: boolean
  siteKey: string
  domains: string[]
  requireConsent: boolean
  retentionDays: number
  snippet: string
}

export interface TrackingSummary {
  days: number
  lastHit: { occurredAt: string; url: string } | null
  visitors: number
  identified: number
  perDay: { day: string; visits: number; pageviews: number }[]
  sources: { source: string; medium: string; visits: number }[]
  pages: { url: string; views: number }[]
}

export interface LeadSite {
  devices: number
  sessions: number
  pageviews: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  firstTouch: Touch | null
  lastTouch: Touch | null
  views: { id: string; url: string; title: string | null; occurredAt: string; newSession: boolean; touch: Touch | null }[]
}

export interface MetaConfig {
  enabled: boolean
  verifyToken: string
  graphVersion: string
  ownerId: string | null
  tags: string[]
  webhookUrl: string
  hasAppSecret: boolean
  hasPageToken: boolean
}

export interface MetaReceipt {
  id: string
  externalId: string
  status: 'RECEBIDO' | 'LEAD_CRIADO' | 'LEAD_ATUALIZADO' | 'SEM_CONTATO' | 'ERRO'
  leadId: string | null
  error: string | null
  receivedAt: string
}

const MEDIUM: Record<string, string> = {
  cpc: 'anúncio',
  ppc: 'anúncio',
  paid: 'anúncio',
  organico: 'busca orgânica',
  social: 'rede social',
  referencia: 'indicação de site',
  email: 'e-mail',
  direto: 'acesso direto',
}

export function mediumLabel(m: string) {
  return MEDIUM[m] ?? m
}

/** "google · anúncio · campanha bf" */
export function touchLabel(t: Touch | null | undefined) {
  if (!t) return '—'
  if (t.source === 'direto') return 'Acesso direto'
  return [t.source, mediumLabel(t.medium), t.campaign ? `campanha ${t.campaign}` : null].filter(Boolean).join(' · ')
}

/** Caminho da URL sem o domínio, para listas compactas. */
export function pathOf(url: string) {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}` || '/'
  } catch {
    return url
  }
}
