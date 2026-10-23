/**
 * Montagem do e-mail a partir de blocos (funções puras, testadas em test/email.spec.ts).
 * HTML no padrão dos clientes de e-mail: tabelas, estilos inline, largura máxima de 600px.
 * Texto formatado vem do editor do painel e passa por uma lista de permissões (tags e estilos conhecidos,
 * reconstruídos do zero); o resto é escapado. Links só http(s) (e mailto/tel), passando pelo rastreamento de cliques.
 */
import { waDigits } from '../captura/regras'
import type { SocialNetwork, SocialStyle } from './icones'

export type Align = 'left' | 'center' | 'right'
/** Texto também pode ser justificado. */
export type TextAlign = Align | 'justify'

/** Uma coluna do bloco de 2 colunas: imagem (opcional), texto formatado e botão (opcional). */
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
  /** Preço "de" (riscado), quando há desconto. */
  oldPrice?: string
  url?: string
}

/** Botões personalizáveis: tamanho, fonte, canto, ícone (emoji) e largura total. */
export type ButtonSize = 'P' | 'M' | 'G'
export interface ButtonStyle {
  size?: ButtonSize
  font?: string
  radius?: number
  icon?: string
  full?: boolean
}
/** Fontes que funcionam em todos os programas de e-mail (as do próprio computador de quem lê). */
export const EMAIL_FONTS: Record<string, string> = {
  arial: 'Arial,Helvetica,sans-serif',
  verdana: 'Verdana,Geneva,sans-serif',
  tahoma: 'Tahoma,Geneva,sans-serif',
  trebuchet: "'Trebuchet MS',Helvetica,sans-serif",
  georgia: 'Georgia,serif',
  times: "'Times New Roman',Times,serif",
  courier: "'Courier New',Courier,monospace",
}
/** Ícones para textos e botões: emojis (aparecem em todos os programas de e-mail, sem imagem para baixar). */
export const EMAIL_ICONS = ['➡️', '✅', '⭐', '🔥', '🛒', '📦', '🚚', '🔧', '⚙️', '📞', '💬', '📲', '📧', '📍', '🕒', '💰', '🏷️', '🎁', '👉', '▶️', '❗', '💡', '🤝', '🏆', '🚜', '🏗️'] as const
const BUTTON_SIZE: Record<ButtonSize, { pad: string; font: number }> = { P: { pad: '9px 18px', font: 13 }, M: { pad: '13px 28px', font: 15 }, G: { pad: '17px 38px', font: 18 } }

/** Id do vídeo do YouTube (watch?v=, youtu.be/, shorts/, embed/, live/). */
export function youtubeId(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(s)
  return m ? m[1]! : /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null
}

export type Block = (
  /** `text` é o formato antigo (**negrito**, [link](url)); ao salvar vira `html`. */
  | { type: 'titulo'; html: string; text?: string; align?: TextAlign; size?: number; color?: string; bg?: string }
  | { type: 'texto'; html: string; text?: string; align?: TextAlign; size?: number; color?: string; bg?: string }
  | { type: 'colunas'; columns: [ColumnContent, ColumnContent]; ratio?: 40 | 50 | 60; align?: TextAlign; color?: string; buttonColor?: string }
  | { type: 'imagem'; url: string; alt?: string; link?: string; width?: number }
  | ({ type: 'botao'; text: string; url: string; color?: string; textColor?: string; align?: Align } & ButtonStyle)
  | ({ type: 'whatsapp'; text: string; phone: string; message?: string; align?: Align; color?: string; textColor?: string } & ButtonStyle)
  | { type: 'video'; url: string; title?: string; label?: string; color?: string }
  /** Linha com 2 a 4 colunas; cada coluna tem os seus blocos (texto, título, botão, WhatsApp, imagem, vídeo, espaço, linha). */
  | { type: 'linha'; cols: Block[][]; valign?: 'top' | 'middle' }
  | { type: 'produtos'; items: ProductItem[]; columns?: 2 | 3 }
  /** Produtos do carrinho do cliente: preenchido no envio da automação (carrinho abandonado). */
  | { type: 'carrinho'; columns?: 2 | 3; buttonText?: string; buttonColor?: string; showPrices?: boolean }
  | { type: 'divisor' }
  | { type: 'redes'; links: SocialLinks; style?: SocialStyle; align?: Align }
  | { type: 'espaco'; height?: number }
) & {
  /** Espaço acima e abaixo do bloco, em px (0 a 48); vazio = o padrão de cada tipo. */
  space?: number
  /** imagem: encostar nas bordas do e-mail (largura total, sem margem nem canto arredondado). */
  edge?: boolean
  /** titulo/texto: espaçamento entre linhas, em % do tamanho da letra (100 a 200). */
  lineHeight?: number
}

export const BLOCK_TYPES = ['titulo', 'texto', 'colunas', 'imagem', 'video', 'botao', 'whatsapp', 'produtos', 'carrinho', 'redes', 'divisor', 'espaco', 'linha'] as const
/** Blocos que cabem dentro de uma coluna. */
export const COLUMN_BLOCKS = ['titulo', 'texto', 'imagem', 'video', 'botao', 'whatsapp', 'espaco', 'divisor'] as const

export type SocialLinks = Partial<Record<SocialNetwork, string>>
export const SOCIAL_NETWORKS: SocialNetwork[] = ['facebook', 'instagram', 'youtube', 'tiktok']
export const SOCIAL_LABEL: Record<SocialNetwork, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
const SOCIAL_HOSTS: Record<SocialNetwork, string[]> = {
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  instagram: ['instagram.com', 'instagr.am'],
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
}

/** Endereço da rede social: https e do domínio da própria rede (ex.: https://www.instagram.com/usaparts). */
export function socialUrl(network: SocialNetwork, raw: string | undefined | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const host = u.hostname.toLowerCase().replace(/^(www|m|web)\./, '')
    if (!SOCIAL_HOSTS[network].some((h) => host === h || host.endsWith(`.${h}`))) return null
    u.protocol = 'https:'
    return u.toString().slice(0, 300)
  } catch {
    return null
  }
}

/** Só as redes com endereço válido, na ordem padrão. */
export function cleanSocial(raw: unknown): SocialLinks {
  const r = (raw ?? {}) as Record<string, unknown>
  const out: SocialLinks = {}
  for (const n of SOCIAL_NETWORKS) {
    const u = socialUrl(n, typeof r[n] === 'string' ? (r[n] as string) : null)
    if (u) out[n] = u
  }
  return out
}

export interface Brand {
  appName: string
  color: string
  logoUrl: string | null
  /** Endereço e dados da empresa no rodapé (boa prática e exigência dos provedores). */
  footerText: string
  /** Redes sociais da empresa (cadastradas em Configurações → E-mail marketing). */
  social?: SocialLinks
  /** Ícones das redes no rodapé de todo e-mail (quando o e-mail não tem o bloco de redes). */
  socialInFooter?: boolean
  /** Endereço público dos ícones (ex.: https://crm.usaparts.com.br/api/public/e/icones). */
  iconBase?: string
}

export interface Person {
  name: string | null
  email: string
  /** Variáveis do envio: {cupom} (o cupom informado no e-mail) e {link_carrinho} (vazias quando não há). */
  vars?: Partial<Record<CartVar, string>>
}

/** {cupom}: o cupom informado no e-mail (criado à mão na Magazord). {link_carrinho}: só no envio da automação. */
export const CART_VARS = ['cupom', 'link_carrinho'] as const
export type CartVar = (typeof CART_VARS)[number]

/** Carrinho do destinatário para o bloco "Produtos do carrinho": itens e o link de volta para o carrinho. */
export interface CartContent {
  items: ProductItem[]
  url: string | null
}

export interface RenderOptions {
  brand: Brand
  subject: string
  preheader?: string | null
  person: Person
  /** Link de descadastro deste destinatário (obrigatório: o rodapé sempre tem). */
  unsubscribeUrl: string
  /** Troca cada link pelo endereço rastreado (índice do link na campanha). */
  trackLink?: (url: string, index: number) => string
  /** Pixel de abertura (opcional: no teste e na pré-visualização não vai). */
  openPixelUrl?: string | null
  /** Lista fixa de links (modelos de automação: o índice de um link nunca muda depois de enviado). */
  linkList?: string[]
  /**
   * Bloco "Produtos do carrinho": o carrinho do cliente (automação), 'exemplo' na pré-visualização e no teste, ou
   * nada (campanha comum: o bloco não aparece). Os links do carrinho vão direto, sem contagem de clique.
   */
  cart?: CartContent | 'exemplo' | null
}

const SAMPLE_CART: CartContent = {
  items: [
    { name: 'Produto do carrinho do cliente', price: 'R$ 289,90' },
    { name: 'Outro produto do carrinho', price: 'R$ 129,00', oldPrice: 'R$ 149,00' },
  ],
  url: null,
}

export const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Só endereços seguros em links e imagens. */
export function safeUrl(url: string | undefined | null, allowMail = false): string | null {
  const u = (url ?? '').trim()
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u
  if (allowMail && /^(mailto|tel):[^\s"'<>]+$/i.test(u)) return u
  return null
}

const HEX = /^#[0-9a-fA-F]{6}$/
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback)
const optHex = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v : undefined)
const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}
const alignOf = (v: unknown, fallback: Align = 'left'): Align => (v === 'center' || v === 'right' || v === 'left' ? v : fallback)
const textAlignOf = (v: unknown, fallback: TextAlign = 'left'): TextAlign => (v === 'justify' ? 'justify' : alignOf(v, fallback === 'justify' ? 'left' : fallback))

/** {nome}, {primeiro_nome}, {email}. Sem nome, a saudação fica neutra ("Olá!" em vez de "Olá, !"). */
export function personalize(text: string, p: Person, esc: (v: string) => string = (v) => v) {
  const first = p.name?.trim().split(/\s+/)[0] ?? ''
  return text
    .replace(/,?\s*\{primeiro_nome\}/g, (m) => (first ? m.replace('{primeiro_nome}', esc(first)) : ''))
    .replace(/,?\s*\{nome\}/g, (m) => (p.name?.trim() ? m.replace('{nome}', esc(p.name.trim())) : ''))
    .replaceAll('{email}', esc(p.email))
    .replace(/{(cupom|link_carrinho)}/g, (_m, k: CartVar) => esc(p.vars?.[k] ?? ''))
}

// ---------- Texto formatado ----------

const NAMED_SIZES: Record<string, number> = { 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 }
const FONT_TAG_SIZES = [0, 10, 13, 16, 18, 24, 32, 48]

function cssColor(v: string): string | null {
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(s)
  if (!m) return null
  const parts = m.slice(1, 4).map(Number)
  if (parts.some((n) => n > 255)) return null
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

function cssSize(v: string): number | null {
  const s = v.trim().toLowerCase()
  if (NAMED_SIZES[s]) return NAMED_SIZES[s]
  const m = /^(\d{1,2}(?:\.\d+)?)px$/.exec(s)
  if (!m) return null
  const n = Math.round(Number(m[1]))
  return n >= 10 && n <= 48 ? n : null
}

/** Estilos permitidos no texto: cor, fundo, tamanho, negrito, itálico, sublinhado/riscado. */
function cleanStyle(style: string): string {
  const out: string[] = []
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    const value = decl.slice(i + 1).trim().toLowerCase()
    if (prop === 'color' || prop === 'background-color') {
      const c = cssColor(value)
      if (c && !(prop === 'background-color' && c === '#ffffff')) out.push(`${prop}:${c}`)
    } else if (prop === 'font-size') {
      const n = cssSize(value)
      if (n) out.push(`font-size:${n}px;line-height:1.35`)
    } else if (prop === 'font-weight') {
      if (value === 'bold' || value === 'bolder' || /^[6-9]00$/.test(value)) out.push('font-weight:700')
    } else if (prop === 'font-style') {
      if (value === 'italic') out.push('font-style:italic')
    } else if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      const d = ['underline', 'line-through'].filter((x) => value.includes(x))
      if (d.length) out.push(`text-decoration:${d.join(' ')}`)
    }
  }
  return [...new Set(out)].join(';')
}

const decodeEntities = (v: string) =>
  v
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d{1,7});/g, (_m, d: string) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of raw.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

/** Texto sem tags: & sem entidade válida vira &amp;; < e > escapados. */
const escapeText = (t: string) => t.replace(/&(?!(?:[a-zA-Z]{2,10}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const DROP_WITH_CONTENT = new Set(['script', 'style', 'title', 'head', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'textarea', 'select'])
const NORMAL: Record<string, string> = { b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', s: 's', strike: 's', a: 'a', span: 'span', font: 'span', div: 'div', p: 'p', ul: 'ul', ol: 'ol', li: 'li' }

/**
 * HTML do editor -> HTML seguro. Cada tag permitida é reconstruída só com atributos e estilos validados;
 * qualquer outra coisa some (script, eventos, imagens, iframes...) e o texto é escapado.
 */
export function sanitizeRich(input: string, maxLength = 20_000): string {
  const src = input.slice(0, maxLength * 2)
  const out: string[] = []
  const stack: { name: string; out: string }[] = []
  let skip: string | null = null
  const re = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|(<)/g
  for (const m of src.matchAll(re)) {
    const [whole, slash, rawName, rawAttrs, text, lt] = m
    if (skip) {
      if (slash && rawName?.toLowerCase() === skip) skip = null
      continue
    }
    if (text !== undefined) {
      out.push(escapeText(text))
      continue
    }
    if (lt) {
      out.push('&lt;')
      continue
    }
    if (!rawName) continue // comentário
    const tag = rawName.toLowerCase()
    if (!slash && DROP_WITH_CONTENT.has(tag) && !/\/\s*$/.test(rawAttrs ?? '')) {
      skip = tag
      continue
    }
    if (tag === 'br') {
      out.push('<br>')
      continue
    }
    const name = NORMAL[tag]
    if (!name) continue
    if (slash) {
      const at = stack.map((s) => s.name).lastIndexOf(name)
      if (at < 0) continue
      while (stack.length > at) {
        const s = stack.pop()!
        if (s.out) out.push(`</${s.out}>`)
      }
      continue
    }
    if (whole.endsWith('/>')) continue
    const a = attrs(rawAttrs ?? '')
    let open = ''
    let outName = name
    switch (name) {
      case 'a': {
        const href = safeUrl(a.href, true)
        const style = cleanStyle(a.style ?? '')
        open = href ? `<a href="${escape(href)}" style="color:inherit;text-decoration:underline${style ? `;${style}` : ''}" target="_blank">` : ''
        if (!href) outName = ''
        break
      }
      case 'span': {
        let style = a.style ?? ''
        if (tag === 'font') {
          if (a.color) style += `;color:${a.color}`
          const size = FONT_TAG_SIZES[Number(a.size)]
          if (size) style += `;font-size:${size}px`
        }
        const clean = cleanStyle(style)
        open = clean ? `<span style="${clean}">` : ''
        if (!clean) outName = ''
        break
      }
      case 'p':
        open = '<p style="margin:0 0 12px">'
        break
      case 'ul':
      case 'ol':
        open = `<${name} style="margin:0 0 12px;padding-left:24px">`
        break
      default:
        open = `<${name}>`
    }
    stack.push({ name, out: outName })
    out.push(open)
    // Cor/tamanho em <b>, <i>, <u>, <div>... (o navegador às vezes põe ali): vira um <span> dentro da tag.
    if (['strong', 'em', 'u', 's', 'div', 'p', 'li'].includes(name)) {
      const extra = cleanStyle(a.style ?? '')
      if (extra) {
        stack.push({ name: '#estilo', out: 'span' })
        out.push(`<span style="${extra}">`)
      }
    }
  }
  while (stack.length) {
    const s = stack.pop()!
    if (s.out) out.push(`</${s.out}>`)
  }
  return out.join('').slice(0, maxLength)
}

/** Formato antigo do texto (**negrito**, *itálico*, [texto](link)) -> HTML do editor. */
export function legacyToHtml(text: string) {
  const html = escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
      const u = safeUrl(url.replace(/&amp;/g, '&'), true)
      return u ? `<a href="${escape(u)}">${label}</a>` : label
    })
    .replace(/\n/g, '<br>')
  return sanitizeRich(html)
}

const richOf = (b: { html?: string; text?: string }) => (typeof b.html === 'string' ? b.html : legacyToHtml(b.text ?? ''))

/** Versão em texto puro (parte "text/plain" do e-mail). */
export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_m, href: string, label: string) => `${label} (${href})`)
      .replace(/<br>|<\/(div|p|li)>/g, '\n')
      .replace(/<li>/g, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decodeEntities(m[1]!))

/** Link do WhatsApp: só números (com DDI 55 quando vier só DDD + número) e a mensagem pronta. */
export function whatsappUrl(phone: string, message?: string) {
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  if (digits.length < 12 || digits.length > 15) return null
  return `https://wa.me/${waDigits(digits)}${message?.trim() ? `?text=${encodeURIComponent(message.trim())}` : ''}`
}

/** Lista única de links da campanha, na ordem em que aparecem (o índice vai no link rastreado). */
export function collectLinks(blocks: Block[]): string[] {
  const out: string[] = []
  const add = (u: string | null) => {
    if (u && !out.includes(u)) out.push(u)
  }
  for (const b of blocks) {
    if (b.type === 'texto' || b.type === 'titulo') for (const h of hrefs(richOf(b))) add(safeUrl(h, true))
    if (b.type === 'colunas')
      for (const c of b.columns) {
        add(safeUrl(c.imageLink))
        for (const h of hrefs(c.html)) add(safeUrl(h, true))
        add(safeUrl(c.buttonUrl, true))
      }
    if (b.type === 'imagem') add(safeUrl(b.link))
    if (b.type === 'botao') add(safeUrl(b.url, true))
    if (b.type === 'linha') for (const col of b.cols) for (const u of collectLinks(col)) add(u)
    if (b.type === 'video') {
      const id = youtubeId(b.url)
      if (id) add(`https://www.youtube.com/watch?v=${id}`)
    }
    if (b.type === 'whatsapp') add(whatsappUrl(b.phone, b.message))
    if (b.type === 'produtos') for (const i of b.items) add(safeUrl(i.url))
    if (b.type === 'redes') for (const n of SOCIAL_NETWORKS) add(socialUrl(n, b.links[n]))
  }
  return out
}

export function renderEmail(blocks: Block[], o: RenderOptions) {
  const color = HEX.test(o.brand.color) ? o.brand.color : '#1d4ed8'
  const links = o.linkList ?? collectLinks(blocks)
  const track = (u: string) => {
    if (/^(mailto|tel):/i.test(u) || !o.trackLink) return u
    const i = links.indexOf(u)
    return i >= 0 ? o.trackLink(u, i) : u
  }
  const cart = o.cart === 'exemplo' ? SAMPLE_CART : (o.cart ?? null)
  const href = (raw: string | undefined | null, allowMail = false) => {
    // Link do carrinho do cliente: muda a cada destinatário, vai direto (sem contagem de clique).
    if ((raw ?? '').trim() === '{link_carrinho}') return safeUrl(o.person.vars?.link_carrinho ?? (o.cart === 'exemplo' ? 'https://www.exemplo.com.br/carrinho' : null))
    const u = safeUrl(raw, allowMail)
    return u ? track(u) : null
  }
  const P = (t: string) => personalize(t, o.person)
  const rows: string[] = []
  const text: string[] = []
  const sp = (b: Block, d: number) => (b.space === undefined ? d : b.space)
  const button = (link: string, label: string, bg: string, fg: string, align: Align, space = 16, s: ButtonStyle = {}, px = 32) => {
    const size = BUTTON_SIZE[s.size ?? 'M']
    const font = EMAIL_FONTS[s.font ?? ''] ?? 'Arial,Helvetica,sans-serif'
    const radius = s.radius ?? 6
    const icon = s.icon && (EMAIL_ICONS as readonly string[]).includes(s.icon) ? `${s.icon} ` : ''
    const width = s.full ? 'display:block;text-align:center' : 'display:inline-block'
    return `<tr><td align="${align}" style="padding:${space}px ${px}px"><a href="${escape(link)}" target="_blank" style="background:${bg};color:${fg};text-decoration:none;padding:${size.pad};border-radius:${radius}px;${width};font-weight:700;font-size:${size.font}px;font-family:${font}">${icon}${escape(label)}</a></td></tr>`
  }

  /** Grade de produtos (bloco Produtos e Produtos do carrinho). Links do carrinho vão direto (sem contagem). */
  const grid = (out: string[], items: ProductItem[], cols: 2 | 3, tracked: boolean) => {
    const link0 = (u: string | undefined) => (tracked ? href(u) : safeUrl(u))
    const width = cols === 2 ? '50%' : '33%'
    const cells = items.map((p) => {
      const link = link0(p.url)
      const src = safeUrl(p.image)
      const img = src ? `<img src="${escape(src)}" alt="" width="${cols === 2 ? 240 : 160}" style="display:block;width:100%;max-width:${cols === 2 ? 240 : 160}px;height:auto;border:0;margin:0 auto 8px">` : ''
      const name = `<div style="font-size:14px;line-height:19px;color:#111827;font-weight:600">${escape(p.name)}</div>`
      const old = p.oldPrice ? `<div style="font-size:12px;color:#9ca3af;text-decoration:line-through;padding-top:4px">${escape(p.oldPrice)}</div>` : ''
      const price = p.price ? `<div style="font-size:15px;color:${color};font-weight:700;padding-top:${old ? 0 : 4}px">${escape(p.price)}</div>` : ''
      const inner = `${img}${name}${old}${price}`
      return `<td valign="top" width="${width}" style="padding:8px;text-align:center">${link ? `<a href="${escape(link)}" target="_blank" style="text-decoration:none">${inner}</a>` : inner}</td>`
    })
    for (let i = 0; i < cells.length; i += cols) {
      const row = cells.slice(i, i + cols)
      while (row.length < cols) row.push(`<td width="${width}"></td>`)
      out.push(`<tr><td style="padding:4px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${row.join('')}</tr></table></td></tr>`)
    }
    for (const p of items) text.push(`- ${p.name}${p.price ? ` — ${p.price}` : ''}${safeUrl(p.url) ? ` (${safeUrl(p.url)})` : ''}`)
    text.push('')
  }

  /** Desenha um bloco; L = margem lateral (px) e largura útil (px) de onde ele está (o e-mail inteiro ou uma coluna). */
  const renderBlock = (b: Block, rows: string[], L: { px: number; w: number }): void => {
    switch (b.type) {
      case 'titulo':
      case 'texto': {
        const isTitle = b.type === 'titulo'
        const html = personalize(richOf(b), o.person, escape).replace(/href="([^"]*)"/g, (_m, h: string) => {
          const u = safeUrl(decodeEntities(h), true)
          return `href="${escape(u ? track(u) : '#')}"`
        })
        const size = clamp(b.size, isTitle ? 18 : 12, isTitle ? 40 : 24, isTitle ? 24 : 15)
        const fg = hex(b.color, isTitle ? '#111827' : '#374151')
        const bg = optHex(b.bg)
        const style = `padding:${sp(b, bg ? 16 : 8)}px ${L.px}px;font-size:${size}px;line-height:${Math.round((size * (b.lineHeight ?? 145)) / 100)}px;${isTitle ? 'font-weight:700;' : ''}color:${fg};text-align:${textAlignOf(b.align)}${bg ? `;background:${bg}` : ''}`
        rows.push(`<tr><td style="${style}">${html}</td></tr>`)
        const plain = htmlToText(personalize(richOf(b), o.person))
        text.push(isTitle ? plain.toUpperCase() : plain, '')
        break
      }
      case 'colunas': {
        // Colunas "fluidas": lado a lado na tela larga e uma embaixo da outra no celular, sem depender de CSS
        // (o Gmail e o Outlook ignoram boa parte do CSS). O Outlook do Windows usa a tabela dos comentários condicionais.
        const inner = 552
        const left = b.ratio === 40 || b.ratio === 60 ? b.ratio : 50
        const widths = [Math.round((inner * left) / 100), inner - Math.round((inner * left) / 100)]
        const fg = hex(b.color, '#374151')
        const btnBg = hex(b.buttonColor, color)
        const ta = textAlignOf(b.align)
        const col = (c: ColumnContent, w: number) => {
          const parts: string[] = []
          const src = safeUrl(c.image)
          if (src) {
            const img = `<img src="${escape(src)}" alt="" width="${w - 16}" style="display:block;width:100%;max-width:${w - 16}px;height:auto;border:0;border-radius:6px;margin:0 0 10px">`
            const link = href(c.imageLink)
            parts.push(link ? `<a href="${escape(link)}" target="_blank">${img}</a>` : img)
          }
          const html = personalize(c.html, o.person, escape).replace(/href="([^"]*)"/g, (_m, h: string) => {
            const u = safeUrl(decodeEntities(h), true)
            return `href="${escape(u ? track(u) : '#')}"`
          })
          if (html.trim()) parts.push(`<div style="font-size:15px;line-height:22px;color:${fg};text-align:${ta}">${html}</div>`)
          const blink = href(c.buttonUrl, true)
          if (blink && c.buttonText) parts.push(`<div style="padding-top:12px;text-align:${ta === 'justify' ? 'left' : ta}"><a href="${escape(blink)}" target="_blank" style="background:${btnBg};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;display:inline-block;font-weight:700;font-size:14px">${escape(P(c.buttonText))}</a></div>`)
          return `<div style="display:inline-block;width:100%;max-width:${w}px;vertical-align:top;font-size:15px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:8px">${parts.join('')}</td></tr></table></div>`
        }
        rows.push(
          `<tr><td style="padding:${sp(b, 8)}px 24px;font-size:0;text-align:left"><!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="${widths[0]}" valign="top"><![endif]-->${col(b.columns[0], widths[0]!)}<!--[if mso]></td><td width="${widths[1]}" valign="top"><![endif]-->${col(b.columns[1], widths[1]!)}<!--[if mso]></td></tr></table><![endif]--></td></tr>`,
        )
        for (const c of b.columns) {
          const plain = htmlToText(personalize(c.html, o.person))
          if (plain) text.push(plain)
          if (c.buttonText && safeUrl(c.buttonUrl, true)) text.push(`${P(c.buttonText)}: ${safeUrl(c.buttonUrl, true)}`)
          text.push('')
        }
        break
      }
      case 'imagem': {
        const src = safeUrl(b.url)
        if (!src) break
        // Encostada nas bordas: largura total (600) e sem canto arredondado, para emendar imagens sem faixa branca.
        const w = Math.round(((b.edge ? L.w + 2 * L.px : L.w) * clamp(b.width, 20, 100, 100)) / 100)
        const img = `<img src="${escape(src)}" alt="${escape(b.alt ?? '')}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;${b.edge ? '' : 'border-radius:6px;'}margin:0 auto">`
        const link = href(b.link)
        rows.push(`<tr><td align="center" style="padding:${sp(b, 8)}px ${b.edge ? 0 : L.px}px;font-size:0;line-height:0">${link ? `<a href="${escape(link)}" target="_blank">${img}</a>` : img}</td></tr>`)
        break
      }
      case 'botao': {
        const link = href(b.url, true)
        if (!link) break
        const label = P(b.text)
        rows.push(button(link, label, hex(b.color, color), hex(b.textColor, '#ffffff'), alignOf(b.align, 'center'), sp(b, 16), b, L.px))
        text.push(`${label}: ${safeUrl(b.url, true)}`, '')
        break
      }
      case 'whatsapp': {
        const url = whatsappUrl(b.phone, b.message)
        if (!url) break
        const label = P(b.text || 'Falar no WhatsApp')
        rows.push(button(track(url), label, hex(b.color, '#25D366'), hex(b.textColor, '#ffffff'), alignOf(b.align, 'center'), sp(b, 16), b, L.px))
        text.push(`${label}: ${url}`, '')
        break
      }
      case 'video': {
        // E-mail não toca vídeo: vai a capa do YouTube com o link e um "Assistir" embaixo (abre no YouTube).
        const id = youtubeId(b.url)
        if (!id) break
        const watch = `https://www.youtube.com/watch?v=${id}`
        const link = track(watch)
        const thumb = `https://img.youtube.com/vi/${id}/hqdefault.jpg`
        const alt = escape(b.title || 'Vídeo no YouTube')
        const label = P(b.label || '▶️ Assistir ao vídeo')
        const c = hex(b.color, '#dc2626')
        rows.push(`<tr><td align="center" style="padding:${sp(b, 8)}px ${L.px}px 4px"><a href="${escape(link)}" target="_blank"><img src="${escape(thumb)}" alt="${alt}" width="${L.w}" style="display:block;width:100%;max-width:${L.w}px;height:auto;border:0;border-radius:6px"></a></td></tr>`)
        if (b.title) rows.push(`<tr><td align="center" style="padding:4px ${L.px}px 0;font-size:15px;line-height:21px;font-weight:700;color:#111827">${escape(P(b.title))}</td></tr>`)
        rows.push(`<tr><td align="center" style="padding:6px ${L.px}px ${sp(b, 8)}px"><a href="${escape(link)}" target="_blank" style="color:${c};font-weight:700;font-size:15px;text-decoration:none">${escape(label)}</a></td></tr>`)
        text.push(`${b.title ? `${P(b.title)} ` : ''}Vídeo: ${watch}`, '')
        break
      }
      case 'carrinho': {
        if (!cart?.items.length) break
        grid(rows, cart.items.slice(0, 12).map((i) => (b.showPrices === false ? { ...i, price: undefined, oldPrice: undefined } : i)), b.columns === 2 ? 2 : 3, false)
        const link = safeUrl(cart.url) ?? (o.cart === 'exemplo' ? 'https://www.exemplo.com.br/carrinho' : null)
        if (link) {
          rows.push(button(link, b.buttonText || 'Finalizar minha compra', hex(b.buttonColor, color), '#ffffff', 'center', sp(b, 16), {}, L.px))
          text.push(`${b.buttonText || 'Finalizar minha compra'}: ${link}`, '')
        }
        break
      }
      case 'produtos': {
        grid(rows, b.items.slice(0, 12), b.columns === 2 ? 2 : 3, true)
        break
      }
      case 'redes': {
        const icons = socialIcons(b.links, b.style ?? 'cor', o.brand.iconBase, track)
        if (!icons) break
        rows.push(`<tr><td align="${alignOf(b.align, 'center')}" style="padding:${sp(b, 12)}px ${L.px}px">${icons}</td></tr>`)
        for (const n of SOCIAL_NETWORKS) {
          const u = socialUrl(n, b.links[n])
          if (u) text.push(`${SOCIAL_LABEL[n]}: ${u}`)
        }
        text.push('')
        break
      }
      case 'divisor':
        rows.push(`<tr><td style="padding:${sp(b, 12)}px ${L.px}px"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0"></td></tr>`)
        break
      case 'linha': {
        const n = Math.min(4, Math.max(1, b.cols.length))
        const inner = L.w + 2 * L.px - 16
        const cw = Math.floor(inner / n)
        const va = b.valign === 'middle' ? 'middle' : 'top'
        const cols = b.cols.slice(0, 4).map((col, i) => {
          const r: string[] = []
          for (const c of col) renderBlock(c, r, { px: 6, w: cw - 12 })
          const open = i === 0 ? `<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="${cw}" valign="${va}"><![endif]-->` : `<!--[if mso]></td><td width="${cw}" valign="${va}"><![endif]-->`
          return `${open}<div style="display:inline-block;width:100%;max-width:${cw}px;vertical-align:${va};font-size:15px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${r.join('') || '<tr><td>&nbsp;</td></tr>'}</table></div>`
        })
        rows.push(`<tr><td style="padding:${sp(b, 4)}px 8px;font-size:0;text-align:center">${cols.join('')}<!--[if mso]></td></tr></table><![endif]--></td></tr>`)
        break
      }
      case 'espaco': {
        const h = clamp(b.height, 8, 96, 24)
        rows.push(`<tr><td style="height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</td></tr>`)
        break
      }
    }
  }
  for (const b of blocks) renderBlock(b, rows, { px: 32, w: 536 })

  const logo = safeUrl(o.brand.logoUrl)
  const header = logo
    ? `<tr><td align="center" style="padding:24px 32px 8px"><img src="${escape(logo)}" alt="${escape(o.brand.appName)}" height="48" style="display:block;height:48px;width:auto;max-width:260px;border:0"></td></tr>`
    : `<tr><td align="center" style="padding:24px 32px 8px;font-size:20px;font-weight:700;color:${color}">${escape(o.brand.appName)}</td></tr>`
  // Rodapé com as redes (discretas, em cinza) quando o e-mail não tem o bloco de redes.
  const footerIcons = o.brand.socialInFooter && !blocks.some((b) => b.type === 'redes') ? socialIcons(o.brand.social ?? {}, 'cinza', o.brand.iconBase, (u) => u, 24) : ''
  const footer = `<tr><td style="padding:24px 32px 32px;font-size:12px;line-height:18px;color:#6b7280;text-align:center;border-top:1px solid #f3f4f6">
${footerIcons ? `<div style="padding-bottom:14px">${footerIcons}</div>` : ''}
${o.brand.footerText ? `${escape(o.brand.footerText).replace(/\n/g, '<br>')}<br><br>` : ''}Você recebe este e-mail porque autorizou o contato de ${escape(o.brand.appName)}.<br>
<a href="${escape(o.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">Não quero mais receber estes e-mails</a></td></tr>`
  const preheader = o.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escape(P(o.preheader))}</div>`
    : ''
  const pixel = o.openPixelUrl ? `<img src="${escape(o.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : ''

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(P(o.subject))}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px">
${header}
${rows.join('\n')}
${footer}
</table></td></tr></table>${pixel}</body></html>`

  const plain = [...text, '---', o.brand.footerText, `Para não receber mais: ${o.unsubscribeUrl}`].filter((l) => l !== undefined).join('\n').trim()
  return { html, text: plain, subject: P(o.subject), links }
}

/** Ícones das redes lado a lado (imagem PNG, que todo programa de e-mail mostra), cada um abre a rede em nova aba. */
function socialIcons(links: SocialLinks, style: SocialStyle, base: string | undefined, track: (u: string) => string, size = 32) {
  if (!base) return ''
  const cells = SOCIAL_NETWORKS.flatMap((n) => {
    const u = socialUrl(n, links[n])
    if (!u) return []
    const img = `<img src="${escape(`${base}/${n}-${style}.png`)}" width="${size}" height="${size}" alt="${SOCIAL_LABEL[n]}" style="display:block;width:${size}px;height:${size}px;border:0">`
    return [`<td style="padding:0 6px"><a href="${escape(track(u))}" target="_blank" rel="noopener" title="${SOCIAL_LABEL[n]}">${img}</a></td>`]
  })
  return cells.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;margin:0 auto"><tr>${cells.join('')}</tr></table>` : ''
}

/** Confere os blocos vindos do painel (tipos conhecidos, tamanhos, endereços, texto formatado). */
/** Estilo do botão vindo do editor: só valores conhecidos. */
function cleanButtonStyle(b: Record<string, unknown>): ButtonStyle {
  const out: ButtonStyle = {}
  if (b.size === 'P' || b.size === 'G') out.size = b.size
  if (typeof b.font === 'string' && b.font in EMAIL_FONTS && b.font !== 'arial') out.font = b.font
  const r = Number(b.radius)
  if (b.radius !== undefined && b.radius !== null && Number.isFinite(r)) out.radius = Math.max(0, Math.min(30, Math.round(r)))
  if (typeof b.icon === 'string' && (EMAIL_ICONS as readonly string[]).includes(b.icon)) out.icon = b.icon
  if (b.full === true) out.full = true
  return out
}

export function cleanBlocks(raw: unknown): { blocks: Block[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Conteúdo inválido.' }
  if (raw.length > 60) return { error: 'No máximo 60 blocos por e-mail.' }
  const out: Block[] = []
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  for (const b of raw as Record<string, unknown>[]) {
    const before = out.length
    switch (b?.type) {
      case 'titulo':
      case 'texto': {
        const isTitle = b.type === 'titulo'
        const html = typeof b.html === 'string' ? sanitizeRich(b.html, isTitle ? 2000 : 20_000) : legacyToHtml(str(b.text, isTitle ? 200 : 5000))
        out.push({
          type: b.type,
          html,
          align: textAlignOf(b.align),
          size: b.size === undefined ? undefined : clamp(b.size, isTitle ? 18 : 12, isTitle ? 40 : 24, isTitle ? 24 : 15),
          color: optHex(b.color),
          bg: optHex(b.bg),
        })
        break
      }
      case 'colunas': {
        const cols = Array.isArray(b.columns) ? (b.columns as Record<string, unknown>[]).slice(0, 2) : []
        while (cols.length < 2) cols.push({})
        const columns = [] as unknown as [ColumnContent, ColumnContent]
        for (const [i, c] of cols.entries()) {
          const side = i === 0 ? 'esquerda' : 'direita'
          if (c?.image && !safeUrl(String(c.image))) return { error: `Imagem da coluna da ${side} com endereço inválido (use https://).` }
          if (c?.imageLink && !safeUrl(String(c.imageLink))) return { error: `Link da imagem da coluna da ${side} inválido.` }
          if (c?.buttonText && String(c.buttonText).trim() && !safeUrl(String(c.buttonUrl ?? ''), true)) return { error: `Botão da coluna da ${side} sem um link válido (https://...).` }
          columns.push({
            html: typeof c?.html === 'string' ? sanitizeRich(c.html, 10_000) : '',
            image: str(c?.image, 500) || undefined,
            imageLink: str(c?.imageLink, 500) || undefined,
            buttonText: str(c?.buttonText, 40) || undefined,
            buttonUrl: str(c?.buttonUrl, 500) || undefined,
          })
        }
        out.push({ type: 'colunas', columns, ratio: b.ratio === 40 || b.ratio === 60 ? b.ratio : 50, align: textAlignOf(b.align), color: optHex(b.color), buttonColor: optHex(b.buttonColor) })
        break
      }
      case 'imagem':
        if (b.url && !safeUrl(String(b.url))) return { error: 'Imagem com endereço inválido (use https://).' }
        if (b.link && !safeUrl(String(b.link))) return { error: 'Link da imagem inválido (use https://).' }
        out.push({ type: 'imagem', url: str(b.url, 500), alt: str(b.alt, 200), link: str(b.link, 500) || undefined, width: b.width === undefined ? undefined : clamp(b.width, 20, 100, 100) })
        break
      case 'botao':
        if (String(b.url ?? '').trim() !== '{link_carrinho}' && !safeUrl(String(b.url ?? ''), true)) return { error: `Botão "${str(b.text, 40)}" sem um link válido (https://... ou {link_carrinho}).` }
        out.push({ type: 'botao', text: str(b.text, 60) || 'Saiba mais', url: str(b.url, 500), color: optHex(b.color), textColor: optHex(b.textColor), align: alignOf(b.align, 'center'), ...cleanButtonStyle(b) })
        break
      case 'whatsapp':
        if (!whatsappUrl(str(b.phone, 30), undefined)) return { error: 'Botão de WhatsApp sem um número válido (DDD + número).' }
        out.push({ type: 'whatsapp', text: str(b.text, 60) || 'Falar no WhatsApp', phone: str(b.phone, 30), message: str(b.message, 500) || undefined, align: alignOf(b.align, 'center'), color: optHex(b.color), textColor: optHex(b.textColor), ...cleanButtonStyle(b) })
        break
      case 'produtos': {
        const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]).slice(0, 12) : []
        out.push({
          type: 'produtos',
          columns: b.columns === 2 ? 2 : 3,
          items: items.map((i) => ({
            name: str(i?.name, 120),
            image: str(i?.image, 500) || undefined,
            price: str(i?.price, 40) || undefined,
            oldPrice: str(i?.oldPrice, 40) || undefined,
            url: str(i?.url, 500) || undefined,
          })),
        })
        break
      }
      case 'carrinho':
        out.push({ type: 'carrinho', columns: b.columns === 2 ? 2 : 3, buttonText: str(b.buttonText, 60) || undefined, buttonColor: optHex(b.buttonColor), showPrices: b.showPrices === false ? false : undefined })
        break
      case 'redes': {
        const links = (b.links ?? {}) as Record<string, unknown>
        for (const n of SOCIAL_NETWORKS) {
          if (typeof links[n] === 'string' && (links[n] as string).trim() && !socialUrl(n, links[n] as string)) return { error: `Endereço do ${SOCIAL_LABEL[n]} inválido (ex.: https://www.${n}.com/usaparts).` }
        }
        out.push({ type: 'redes', links: cleanSocial(links), style: b.style === 'cinza' ? 'cinza' : 'cor', align: alignOf(b.align, 'center') })
        break
      }
      case 'video': {
        const id = youtubeId(str(b.url, 300))
        if (str(b.url, 300).trim() && !id) return { error: 'Link do YouTube inválido (ex.: https://www.youtube.com/watch?v=...).' }
        out.push({ type: 'video', url: id ? `https://www.youtube.com/watch?v=${id}` : '', title: str(b.title, 120) || undefined, label: str(b.label, 60) || undefined, color: optHex(b.color) })
        break
      }
      case 'linha': {
        const raw = Array.isArray(b.cols) ? (b.cols as unknown[]).slice(0, 4) : []
        if (raw.length < 2) return { error: 'Colunas: use de 2 a 4 colunas.' }
        const cols: Block[][] = []
        for (const col of raw) {
          const list = Array.isArray(col) ? col.slice(0, 12) : []
          const inner = cleanBlocks(list)
          if ('error' in inner) return inner
          if (inner.blocks.some((x) => !(COLUMN_BLOCKS as readonly string[]).includes(x.type))) return { error: 'Dentro das colunas cabem texto, título, imagem, vídeo, botão, WhatsApp, espaço e linha divisória.' }
          cols.push(inner.blocks)
        }
        out.push({ type: 'linha', cols, valign: b.valign === 'middle' ? 'middle' : undefined })
        break
      }
      case 'divisor':
        out.push({ type: 'divisor' })
        break
      case 'espaco':
        out.push({ type: 'espaco', height: clamp(b.height, 8, 96, 24) })
        break
      default:
        return { error: `Tipo de bloco desconhecido: ${String(b?.type)}` }
    }
    // Espaçamento (todos os blocos, menos o próprio espaço), imagem nas bordas e entrelinha do texto.
    const added = out.length > before ? out[out.length - 1]! : null
    const within = (v: unknown, min: number, max: number) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Math.max(min, Math.min(max, Math.round(Number(v)))))
    if (added && added.type !== 'espaco') added.space = within(b.space, 0, 48)
    if (added?.type === 'imagem' && b.edge === true) added.edge = true
    if (added?.type === 'titulo' || added?.type === 'texto') added.lineHeight = within(b.lineHeight, 100, 200)
  }
  return { blocks: out }
}

/**
 * Cores mais usadas nos e-mails (para a paleta do editor): cores dos blocos e as do texto formatado.
 * Recebe a lista de blocos de várias campanhas; devolve as mais frequentes, sem o branco.
 */
export function topColors(campaigns: unknown[], limit = 12): string[] {
  const count = new Map<string, number>()
  const add = (v: unknown) => {
    if (typeof v !== 'string') return
    const h = v.toLowerCase()
    if (!HEX.test(h) || h === '#ffffff') return
    count.set(h, (count.get(h) ?? 0) + 1)
  }
  const rgb = (r: string, g: string, b: string) => `#${[r, g, b].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/color|bg/i.test(k)) add(x)
      else if (k === 'html' && typeof x === 'string') {
        for (const m of x.matchAll(/(?:^|[;"\s])(?:background-)?color:\s*(#[0-9a-f]{6})/gi)) add(m[1])
        for (const m of x.matchAll(/(?:background-)?color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/gi)) add(rgb(m[1]!, m[2]!, m[3]!))
      } else if (typeof x === 'object') walk(x)
    }
  }
  campaigns.forEach(walk)
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c)
}
