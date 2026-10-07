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

export type Block =
  | { type: 'titulo'; text: string; align?: 'left' | 'center' }
  | { type: 'texto'; text: string; align?: 'left' | 'center' }
  | { type: 'imagem'; url: string; alt?: string; link?: string }
  | { type: 'botao'; text: string; url: string; color?: string }
  | { type: 'produtos'; items: { name: string; image?: string; price?: string; url?: string }[] }
  | { type: 'divisor' }
  | { type: 'espaco' }

export const BLOCK_LABEL: Record<Block['type'], string> = {
  titulo: 'Título',
  texto: 'Texto',
  imagem: 'Imagem',
  botao: 'Botão',
  produtos: 'Produtos',
  divisor: 'Linha divisória',
  espaco: 'Espaço',
}

export function newBlock(type: Block['type']): Block {
  switch (type) {
    case 'titulo':
      return { type, text: 'Olá, {primeiro_nome}!' }
    case 'texto':
      return { type, text: 'Escreva aqui. Use **negrito**, *itálico* e [links](https://www.usaparts.com.br).' }
    case 'imagem':
      return { type, url: '', alt: '' }
    case 'botao':
      return { type, text: 'Ver ofertas', url: 'https://www.usaparts.com.br' }
    case 'produtos':
      return { type, items: [{ name: 'Produto', price: 'R$ 0,00', url: 'https://www.usaparts.com.br', image: '' }] }
    default:
      return { type }
  }
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
}

export const pct = (part: number, of: number) => (of ? `${((part / of) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—')
