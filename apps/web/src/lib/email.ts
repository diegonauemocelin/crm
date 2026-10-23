import { money } from './format'

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
export type TextAlign = Align | 'justify'

export interface ColumnContent {
  html: string
  image?: string
  imageLink?: string
  buttonText?: string
  buttonUrl?: string
}

export interface ProductItem {
  name: string
  image?: string
  price?: string
  oldPrice?: string
  url?: string
}

/** Botão personalizável: tamanho, fonte, canto (px), ícone (emoji) e largura total. */
export interface ButtonStyle {
  size?: 'P' | 'M' | 'G'
  font?: string
  radius?: number
  icon?: string
  full?: boolean
}
/** Fontes que funcionam em todos os programas de e-mail. */
export const EMAIL_FONTS: { id: string; name: string; css: string }[] = [
  { id: 'arial', name: 'Arial', css: 'Arial,Helvetica,sans-serif' },
  { id: 'verdana', name: 'Verdana', css: 'Verdana,Geneva,sans-serif' },
  { id: 'tahoma', name: 'Tahoma', css: 'Tahoma,Geneva,sans-serif' },
  { id: 'trebuchet', name: 'Trebuchet', css: "'Trebuchet MS',Helvetica,sans-serif" },
  { id: 'georgia', name: 'Georgia', css: 'Georgia,serif' },
  { id: 'times', name: 'Times New Roman', css: "'Times New Roman',Times,serif" },
  { id: 'courier', name: 'Courier', css: "'Courier New',Courier,monospace" },
]
/** Ícones para textos e botões (emojis: aparecem em todos os programas de e-mail). */
export const EMAIL_ICONS = ['➡️', '✅', '⭐', '🔥', '🛒', '📦', '🚚', '🔧', '⚙️', '📞', '💬', '📲', '📧', '📍', '🕒', '💰', '🏷️', '🎁', '👉', '▶️', '❗', '💡', '🤝', '🏆', '🚜', '🏗️'] as const
export const BUTTON_SIZES: Record<'P' | 'M' | 'G', { name: string; pad: string; font: number }> = {
  P: { name: 'Pequeno', pad: '9px 18px', font: 13 },
  M: { name: 'Médio', pad: '13px 28px', font: 15 },
  G: { name: 'Grande', pad: '17px 38px', font: 18 },
}
/** Id do vídeo do YouTube (watch?v=, youtu.be/, shorts/, embed/, live/). */
export function youtubeId(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(s)
  return m ? m[1]! : /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null
}

export type Block = (
  | { type: 'titulo'; html: string; align?: TextAlign; size?: number; color?: string; bg?: string }
  | { type: 'texto'; html: string; align?: TextAlign; size?: number; color?: string; bg?: string }
  | { type: 'colunas'; columns: [ColumnContent, ColumnContent]; ratio?: 40 | 50 | 60; align?: TextAlign; color?: string; buttonColor?: string }
  | { type: 'imagem'; url: string; alt?: string; link?: string; width?: number }
  | ({ type: 'botao'; text: string; url: string; color?: string; textColor?: string; align?: Align } & ButtonStyle)
  | ({ type: 'whatsapp'; text: string; phone: string; message?: string; align?: Align; color?: string; textColor?: string } & ButtonStyle)
  | { type: 'video'; url: string; title?: string; label?: string; color?: string }
  /** Linha com 2 a 4 colunas; cada coluna tem os seus blocos. */
  | { type: 'linha'; cols: Block[][]; valign?: 'top' | 'middle' }
  | { type: 'produtos'; items: ProductItem[]; columns?: 2 | 3 }
  /** Produtos do carrinho do cliente: preenchido no envio pela automação de carrinho abandonado. */
  | { type: 'carrinho'; columns?: 2 | 3; buttonText?: string; buttonColor?: string; showPrices?: boolean }
  | { type: 'divisor' }
  | { type: 'redes'; links: SocialLinks; style?: 'cor' | 'cinza'; align?: Align }
  | { type: 'espaco'; height?: number }
) & {
  /** Espaço acima e abaixo do bloco (0 a 48 px); vazio = o padrão. */
  space?: number
  /** imagem: encostar nas bordas (largura total, sem margem). */
  edge?: boolean
  /** titulo/texto: entrelinha em % do tamanho da letra (100 a 200). */
  lineHeight?: number
}

export type BlockType = Block['type']

export type SocialNetwork = 'facebook' | 'instagram' | 'youtube' | 'tiktok'
export type SocialLinks = Partial<Record<SocialNetwork, string>>
export const SOCIAL_NETWORKS: SocialNetwork[] = ['facebook', 'instagram', 'youtube', 'tiktok']
export const SOCIAL_LABEL: Record<SocialNetwork, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
export const SOCIAL_PLACEHOLDER: Record<SocialNetwork, string> = {
  facebook: 'https://www.facebook.com/usaparts',
  instagram: 'https://www.instagram.com/usaparts',
  youtube: 'https://www.youtube.com/@usaparts',
  tiktok: 'https://www.tiktok.com/@usaparts',
}
/** Ícone servido pelo CRM (o mesmo que vai no e-mail). */
export const socialIcon = (n: SocialNetwork, style: 'cor' | 'cinza') => `/api/public/e/icones/${n}-${style}.png`

export const BLOCK_LABEL: Record<BlockType, string> = {
  titulo: 'Título',
  texto: 'Texto',
  linha: 'Colunas (2 a 4)',
  colunas: '2 colunas (antigo)',
  imagem: 'Imagem',
  video: 'Vídeo (YouTube)',
  botao: 'Botão',
  whatsapp: 'WhatsApp',
  produtos: 'Produtos',
  carrinho: 'Produtos do carrinho',
  redes: 'Redes sociais',
  divisor: 'Linha divisória',
  espaco: 'Espaço',
}

/** Blocos que cabem dentro de uma coluna. */
export const COLUMN_BLOCKS = ['titulo', 'texto', 'imagem', 'video', 'botao', 'whatsapp', 'espaco', 'divisor'] as const

export function newBlock(type: BlockType, whatsappPhone = '', social: SocialLinks = {}): Block {
  switch (type) {
    case 'titulo':
      return { type, html: 'Olá, {primeiro_nome}!', align: 'left' }
    case 'texto':
      return { type, html: 'Escreva aqui. Selecione um trecho para deixar em <strong>negrito</strong>, <em>itálico</em>, mudar a cor ou o tamanho.', align: 'left' }
    case 'colunas':
      return {
        type,
        ratio: 50,
        align: 'left',
        columns: [
          { html: '<p>Texto da coluna da esquerda. Use para uma foto com descrição ao lado.</p>' },
          { html: '<p>Texto da coluna da direita. No celular, as colunas ficam uma embaixo da outra.</p>' },
        ],
      }
    case 'imagem':
      return { type, url: '', alt: '', width: 100 }
    case 'linha':
      return { type, cols: [[{ type: 'texto', html: 'Coluna 1. Arraste botões, imagens ou vídeos para cá.', align: 'left' }], [{ type: 'texto', html: 'Coluna 2. Solte um bloco na beira de uma coluna para criar outra (até 4).', align: 'left' }]] }
    case 'video':
      return { type, url: '', label: '▶️ Assistir ao vídeo' }
    case 'botao':
      return { type, text: 'Ver ofertas', url: 'https://www.usaparts.com.br', align: 'center' }
    case 'whatsapp':
      return { type, text: 'Falar no WhatsApp', phone: whatsappPhone, message: 'Olá! Vim pelo e-mail e quero saber mais.', align: 'center' }
    case 'produtos':
      return { type, columns: 3, items: [] }
    case 'carrinho':
      return { type, columns: 2, buttonText: 'Finalizar minha compra' }
    case 'redes':
      return { type, links: { ...social }, style: 'cor', align: 'center' }
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

export function productItem(p: StoreProduct): ProductItem {
  return { name: p.name, image: p.image ?? undefined, url: p.url ?? undefined, price: p.price ? money(p.price) : undefined, oldPrice: p.priceFrom ? money(p.priceFrom) : undefined }
}

export const formatBRL = (v: number | null) => (v ? money(v) : '—')

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
  /** Região do Brasil (pelo estado) ou Internacional (país fora do Brasil). */
  region?: 'NORTE' | 'NORDESTE' | 'CENTRO_OESTE' | 'SUDESTE' | 'SUL' | 'INTERNACIONAL'
  from?: string
  to?: string
  /** Atendimento: resultado, motivo da perda, tipo e período (datas ou últimos N dias). */
  serviceResult?: 'SIM' | 'NAO' | 'NEGOCIACAO'
  serviceKind?: 'PRE_VENDAS' | 'POS_VENDAS'
  lostReasonId?: string
  serviceFrom?: string
  serviceTo?: string
  serviceDays?: number
}

export interface Campaign {
  id: string
  name: string
  subject: string
  preheader: string | null
  fromName: string | null
  replyTo: string | null
  /** Cupom do e-mail ({cupom} no texto), criado à mão na Magazord: o mesmo para todos. */
  coupon: string | null
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
  /** Não entregues por recusa temporária do servidor (4xx: "slow down", fila cheia): dá para tentar de novo. */
  temporaryFailed?: number
  /** O servidor pediu para esperar: minutos até a próxima tentativa (0 = enviando normal). */
  waitingMinutes?: number
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
  social: SocialLinks
  socialInFooter: boolean
}

export const pct = (part: number, of: number) => (of ? `${((part / of) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—')
