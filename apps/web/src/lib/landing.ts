/** Landing pages: tipos do editor (o catálogo de blocos vem do servidor, em /landing/opcoes). */

export type FieldType = 'text' | 'textarea' | 'url' | 'image' | 'datetime' | 'select' | 'icon' | 'list' | 'form' | 'whatsapp' | 'boolean'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  max?: number
  hint?: string
  placeholder?: string
  options?: { value: string; label: string }[]
  item?: FieldDef[]
  maxItems?: number
  showIf?: { key: string; values: string[] }
}

export interface BlockDef {
  type: string
  label: string
  description: string
  variants?: { value: string; label: string }[]
  fields: FieldDef[]
}

export type Block = { id: string; type: string; variant?: string; background?: string } & Record<string, unknown>

export interface Theme {
  primary: string
  accent: string
  mode: 'claro' | 'escuro'
  font: string
  radius: 'reto' | 'suave' | 'arredondado'
  button: 'solido' | 'contorno' | 'pilula'
  width: 'normal' | 'larga'
  header: 'logo' | 'logo-botao' | 'nenhum'
  headerCta: string
  whatsapp: string
  whatsappMessage: string
}

export interface Seo {
  title: string
  description: string
  image: string
  noindex: boolean
}

export interface LandingConfig {
  domain: string
  ga4Id: string
  pixelId: string
  useAdsTag: boolean
  cookieText: string
  homeUrl: string
}

export interface LandingOptions {
  blocks: BlockDef[]
  backgrounds: { value: string; label: string }[]
  fonts: string[]
  icons: { key: string; label: string; svg: string }[]
  templates: { key: string; name: string; description: string; goal: string; blocks: string[] }[]
  forms: { id: string; name: string }[]
  whatsapps: { id: string; name: string }[]
  config: LandingConfig
  aiAvailable: boolean
  base: string
}

export interface LandingPage {
  id: string
  name: string
  slug: string
  status: 'RASCUNHO' | 'PUBLICADA' | 'PAUSADA'
  theme: Theme
  blocks: Block[]
  blocksB: Block[] | null
  abActive: boolean
  abSplit: number
  seo: Seo
  publishedAt: string | null
  updatedAt: string
  url: string
}

export interface LandingListItem {
  id: string
  name: string
  slug: string
  status: LandingPage['status']
  abActive: boolean
  publishedAt: string | null
  updatedAt: string
  url: string
  visitors30: number
  leads30: number
  conversion30: number | null
}

export interface LandingMetrics {
  period: { from: string; to: string }
  ab: boolean
  variants: { variant: 'A' | 'B'; visitors: number; views: number; scroll: number; cta: number; whatsapp: number; leads: number; conversion: number | null; sales: number; revenue: number }[]
  totals: { visitors: number; leads: number; cta: number; sales: number; revenue: number }
  byDay: { day: string; visitors: number; leads: number }[]
  bySource: { source: string; medium: string; campaign: string; visitors: number; clicks: number; leads: number }[]
}

export const STATUS_LABEL: Record<LandingPage['status'], string> = { RASCUNHO: 'Rascunho', PUBLICADA: 'No ar', PAUSADA: 'Pausada' }

/** Bloco novo com os campos vazios (o servidor completa e limpa ao salvar). */
export function newBlock(def: BlockDef): Block {
  const b: Block = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, type: def.type, background: 'padrao' }
  if (def.variants) b.variant = def.variants[0]!.value
  for (const f of def.fields) b[f.key] = f.type === 'list' ? [] : f.type === 'select' || f.type === 'icon' ? (f.options?.[0]?.value ?? '') : f.type === 'boolean' ? false : ''
  return b
}

/** Canais para o gerador de links com UTM (anúncios e divulgação). */
export const UTM_CHANNELS = [
  { key: 'google', label: 'Google Ads', source: 'google', medium: 'cpc' },
  { key: 'meta', label: 'Meta Ads (Facebook e Instagram)', source: 'meta', medium: 'paid_social' },
  { key: 'tiktok', label: 'TikTok Ads', source: 'tiktok', medium: 'paid_social' },
  { key: 'instagram', label: 'Instagram orgânico (bio, stories)', source: 'instagram', medium: 'social' },
  { key: 'email', label: 'E-mail marketing', source: 'email', medium: 'email' },
  { key: 'whatsapp', label: 'WhatsApp (listas e status)', source: 'whatsapp', medium: 'messaging' },
] as const

export function utmUrl(base: string, source: string, medium: string, campaign: string, content = '') {
  const u = new URL(base)
  u.searchParams.set('utm_source', source)
  u.searchParams.set('utm_medium', medium)
  if (campaign) u.searchParams.set('utm_campaign', campaign)
  if (content) u.searchParams.set('utm_content', content)
  return u.toString()
}

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
