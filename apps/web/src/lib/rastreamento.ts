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
  appMarkers: string[]
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
  devices: { device: string; visits: number }[]
  leadDevices: { device: string; leads: number }[]
  shop: Record<string, number>
}

export interface LeadSite {
  devices: number
  sessions: number
  pageviews: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  firstTouch: Touch | null
  lastTouch: Touch | null
  firstDevice: string | null
  device: string | null
  views: { id: string; url: string; title: string | null; occurredAt: string; newSession: boolean; touch: Touch | null; device: string | null }[]
  shop: { id: string; name: string; value: number | null; items: { id: string; name: string; price: number | null; qty: number }[] | null; occurredAt: string; device: string | null }[]
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

export type Device = 'celular' | 'tablet' | 'computador' | 'app' | 'desconhecido'
export const DEVICE_LABEL: Record<string, string> = { celular: 'Celular', tablet: 'Tablet', computador: 'Computador (PC)', app: 'App da loja', desconhecido: 'Não identificado' }

export const SHOP_LABEL: Record<string, string> = {
  add_to_cart: 'Adicionou ao carrinho',
  begin_checkout: 'Iniciou o checkout',
  add_shipping_info: 'Informou a entrega',
  add_payment_info: 'Escolheu o pagamento',
  purchase: 'Comprou',
}

// ---------- Loja virtual (Magazord) ----------

export interface MagazordState {
  running: boolean
  lastRunAt: string | null
  lastOkAt: string | null
  lastError: string | null
  customersPage: number
  customersBackfillDone: boolean
  productsSyncedAt?: string | null
  productsError?: string | null
  totals: { customers: number; leadsCreated: number; orders: number; carts: number; products?: number }
}

export interface MagazordConfig {
  enabled: boolean
  baseUrl: string
  hasToken: boolean
  hasPassword: boolean
  importCustomers: boolean
  importOrders: boolean
  importCarts: boolean
  importProducts: boolean
  storeId: number
  siteUrl: string
  imageBaseUrl: string
  ownerId: string | null
  tags: string[]
  abandonHours: number
  cartMessage: string
  coupon: string
  state: MagazordState
}

export interface CartItem {
  code: string
  name: string
  qty: number
  image: string | null
  url: string | null
}

export type ContactStatus = 'PENDENTE' | 'CONTATADO' | 'RECUPERADO' | 'PERDIDO'
export const CONTACT_LABEL: Record<ContactStatus, string> = { PENDENTE: 'A contatar', CONTATADO: 'Contatado', RECUPERADO: 'Recuperado', PERDIDO: 'Desistiu' }

export interface Cart {
  id: string
  externalId: string
  status: 1 | 2 | 3
  leadId: string | null
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  startedAt: string | null
  lastActivityAt: string | null
  checkoutStarted: boolean
  checkoutUrl: string | null
  items: CartItem[]
  itemCount: number
  value: number | null
  orderCode: string | null
  contactStatus: ContactStatus
  contactNote: string | null
  contactedAt: string | null
  contactedBy: string | null
  message: string
}

export interface CartPage {
  total: number
  page: number
  pageSize: number
  configured: boolean
  counts: Record<'abandonados' | 'checkout' | 'recuperados', number>
  items: Cart[]
}

export interface LeadShop {
  orders: { id: string; code: string; orderedAt: string; total: number; statusName: string; statusGroup: string; payment: string | null }[]
  carts: { id: string; status: number; lastActivityAt: string | null; checkoutStarted: boolean; checkoutUrl: string | null; items: CartItem[]; contactStatus: ContactStatus }[]
  totalSpent: number
  paidOrders: number
}
