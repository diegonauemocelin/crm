export type CampaignStatus = 'RASCUNHO' | 'AGENDADA' | 'ENVIANDO' | 'PAUSADA' | 'ENVIADA' | 'CANCELADA'

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  RASCUNHO: 'Rascunho',
  AGENDADA: 'Agendada',
  ENVIANDO: 'Enviando',
  PAUSADA: 'Pausada',
  ENVIADA: 'Enviada',
  CANCELADA: 'Cancelada',
}

export const STATUS_TONE: Record<CampaignStatus, string> = {
  RASCUNHO: '',
  AGENDADA: 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300',
  ENVIANDO: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  PAUSADA: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  ENVIADA: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  CANCELADA: 'text-muted-foreground',
}

export type Align = 'left' | 'center' | 'right'

export interface ProductItem {
  name: string
  image?: string
  price?: string
  oldPrice?: string
  url?: string
}

export type Block =
  | { type: 'titulo'; html: string; align?: Align; size?: number; color?: string; bg?: string }
  | { type: 'texto'; html: string; align?: Align; size?: number; color?: string; bg?: string }
  | { type: 'imagem'; url: string; alt?: string; link?: string; width?: number }
  | { type: 'botao'; text: string; url: string; color?: string; textColor?: string; align?: Align }
  | { type: 'whatsapp'; text: string; phone: string; message?: string; align?: Align }
  | { type: 'produtos'; items: ProductItem[]; columns?: 2 | 3 }
  | { type: 'divisor' }
  | { type: 'espaco'; height?: number }

export type BlockType = Block['type']

export const BLOCK_LABEL: Record<BlockType, string> = {
  titulo: 'Título',
  texto: 'Texto',
  imagem: 'Imagem',
  botao: 'Botão',
  whatsapp: 'WhatsApp',
  produtos: 'Produtos',
  divisor: 'Linha divisória',
  espaco: 'Espaço',
}

export function newBlock(type: BlockType, whatsappPhone = ''): Block {
  switch (type) {
    case 'titulo':
      return { type, html: 'Olá, {primeiro_nome}!', align: 'left' }
    case 'texto':
      return { type, html: 'Escreva aqui. Selecione um trecho para deixar em <strong>negrito</strong>, <em>itálico</em>, mudar a cor ou o tamanho.', align: 'left' }
    case 'imagem':
      return { type, url: '', alt: '', width: 100 }
    case 'botao':
      return { type, text: 'Ver ofertas', url: 'https://www.usaparts.com.br', align: 'center' }
    case 'whatsapp':
      return { type, text: 'Falar no WhatsApp', phone: whatsappPhone, message: 'Olá! Vim pelo e-mail e quero saber mais.', align: 'center' }
    case 'produtos':
      return { type, columns: 3, items: [] }
    case 'espaco':
      return { type, height: 24 }
    default:
      return { type }
  }
}

/** Produto do catálogo da loja (Magazord). */
export interface StoreProduct {
  id: string
  code: string
  name: string
  brand: string | null
  price: number | null
  priceFrom: number | null
  stock: number | null
  image: string | null
  url: string | null
}

export interface ProductSearch {
  items: StoreProduct[]
  total: number
  page: number
  pageSize: number
  catalog: { enabled: boolean; updating: boolean; syncedAt: string | null; error: string | null }
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function productItem(p: StoreProduct): ProductItem {
  return { name: p.name, image: p.image ?? undefined, url: p.url ?? undefined, price: p.price ? brl.format(p.price) : undefined, oldPrice: p.priceFrom ? brl.format(p.priceFrom) : undefined }
}

export const formatBRL = (v: number | null) => (v ? brl.format(v) : '—')

export interface EmailImage {
  id: string
  url: string
  size: number
  createdAt: string
}

export interface WhatsappNumber {
  id: string
  name: string
  phone: string
  message: string
}

export interface Segment {
  id: string
  name: string
  filters: SegmentFilters
  eligible: number
  createdAt: string
}

export interface SegmentFilters {
  stage?: string
  grade?: string
  tag?: string
  state?: string
  ownerId?: string
  unitId?: string
  originId?: string
  hasPhone?: 'true' | 'false'
  from?: string
  to?: string
}

export interface Campaign {
  id: string
  name: string
  subject: string
  preheader: string | null
  fromName: string | null
  replyTo: string | null
  blocks: Block[]
  segmentId: string | null
  segment?: { name: string } | null
  /** CAMPANHA (para um segmento) ou MODELO (enviado pelas automações). */
  kind: 'CAMPANHA' | 'MODELO'
  status: CampaignStatus
  scheduledAt: string | null
  startedAt: string | null
  finishedAt: string | null
  total: number
  sent: number
  failed: number
  opens: number
  clicks: number
  unsubscribes: number
  createdAt: string
}

export interface CampaignReport {
  total: number
  sent: number
  failed: number
  opens: number
  clicks: number
  unsubscribes: number
  pending: number
  links: { url: string; clicks: number }[]
  recipients: { id: string; email: string; leadId: string; status: string; error: string | null; openedAt: string | null; clickedAt: string | null; clicks: number; unsubscribedAt: string | null }[]
}

export interface EmailSettings {
  fromName: string
  replyTo: string
  footerText: string
  ratePerMinute: number
  logoUrl: string | null
  ownLogo: boolean
}

export const pct = (part: number, of: number) => (of ? `${((part / of) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—')
