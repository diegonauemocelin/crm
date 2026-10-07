/**
 * Montagem do e-mail a partir de blocos (funções puras, testadas em test/email.spec.ts).
 * HTML no padrão dos clientes de e-mail: tabelas, estilos inline, largura máxima de 600px.
 * Texto formatado vem do editor do painel e passa por uma lista de permissões (tags e estilos conhecidos,
 * reconstruídos do zero); o resto é escapado. Links só http(s) (e mailto/tel), passando pelo rastreamento de cliques.
 */

export type Align = 'left' | 'center' | 'right'

export interface ProductItem {
  name: string
  image?: string
  price?: string
  /** Preço "de" (riscado), quando há desconto. */
  oldPrice?: string
  url?: string
}

export type Block =
  /** `text` é o formato antigo (**negrito**, [link](url)); ao salvar vira `html`. */
  | { type: 'titulo'; html: string; text?: string; align?: Align; size?: number; color?: string; bg?: string }
  | { type: 'texto'; html: string; text?: string; align?: Align; size?: number; color?: string; bg?: string }
  | { type: 'imagem'; url: string; alt?: string; link?: string; width?: number }
  | { type: 'botao'; text: string; url: string; color?: string; textColor?: string; align?: Align }
  | { type: 'whatsapp'; text: string; phone: string; message?: string; align?: Align }
  | { type: 'produtos'; items: ProductItem[]; columns?: 2 | 3 }
  | { type: 'divisor' }
  | { type: 'espaco'; height?: number }

export const BLOCK_TYPES = ['titulo', 'texto', 'imagem', 'botao', 'whatsapp', 'produtos', 'divisor', 'espaco'] as const

export interface Brand {
  appName: string
  color: string
  logoUrl: string | null
  /** Endereço e dados da empresa no rodapé (boa prática e exigência dos provedores). */
  footerText: string
}

export interface Person {
  name: string | null
  email: string
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

/** {nome}, {primeiro_nome}, {email}. Sem nome, a saudação fica neutra ("Olá!" em vez de "Olá, !"). */
export function personalize(text: string, p: Person, esc: (v: string) => string = (v) => v) {
  const first = p.name?.trim().split(/\s+/)[0] ?? ''
  return text
    .replace(/,?\s*\{primeiro_nome\}/g, (m) => (first ? m.replace('{primeiro_nome}', esc(first)) : ''))
    .replace(/,?\s*\{nome\}/g, (m) => (p.name?.trim() ? m.replace('{nome}', esc(p.name.trim())) : ''))
    .replaceAll('{email}', esc(p.email))
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
  return `https://wa.me/${digits}${message?.trim() ? `?text=${encodeURIComponent(message.trim())}` : ''}`
}

/** Lista única de links da campanha, na ordem em que aparecem (o índice vai no link rastreado). */
export function collectLinks(blocks: Block[]): string[] {
  const out: string[] = []
  const add = (u: string | null) => {
    if (u && !out.includes(u)) out.push(u)
  }
  for (const b of blocks) {
    if (b.type === 'texto' || b.type === 'titulo') for (const h of hrefs(richOf(b))) add(safeUrl(h, true))
    if (b.type === 'imagem') add(safeUrl(b.link))
    if (b.type === 'botao') add(safeUrl(b.url, true))
    if (b.type === 'whatsapp') add(whatsappUrl(b.phone, b.message))
    if (b.type === 'produtos') for (const i of b.items) add(safeUrl(i.url))
  }
  return out
}

export function renderEmail(blocks: Block[], o: RenderOptions) {
  const color = HEX.test(o.brand.color) ? o.brand.color : '#1d4ed8'
  const links = collectLinks(blocks)
  const track = (u: string) => {
    if (/^(mailto|tel):/i.test(u) || !o.trackLink) return u
    const i = links.indexOf(u)
    return i >= 0 ? o.trackLink(u, i) : u
  }
  const href = (raw: string | undefined | null, allowMail = false) => {
    const u = safeUrl(raw, allowMail)
    return u ? track(u) : null
  }
  const P = (t: string) => personalize(t, o.person)
  const rows: string[] = []
  const text: string[] = []
  const button = (link: string, label: string, bg: string, fg: string, align: Align) =>
    `<tr><td align="${align}" style="padding:16px 32px"><a href="${escape(link)}" target="_blank" style="background:${bg};color:${fg};text-decoration:none;padding:13px 28px;border-radius:6px;display:inline-block;font-weight:700;font-size:15px">${escape(label)}</a></td></tr>`

  for (const b of blocks) {
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
        const style = `padding:${bg ? '16px 32px' : '8px 32px'};font-size:${size}px;line-height:${Math.round(size * 1.45)}px;${isTitle ? 'font-weight:700;' : ''}color:${fg};text-align:${alignOf(b.align)}${bg ? `;background:${bg}` : ''}`
        rows.push(`<tr><td style="${style}">${html}</td></tr>`)
        const plain = htmlToText(personalize(richOf(b), o.person))
        text.push(isTitle ? plain.toUpperCase() : plain, '')
        break
      }
      case 'imagem': {
        const src = safeUrl(b.url)
        if (!src) break
        const w = Math.round((536 * clamp(b.width, 20, 100, 100)) / 100)
        const img = `<img src="${escape(src)}" alt="${escape(b.alt ?? '')}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;border-radius:6px;margin:0 auto">`
        const link = href(b.link)
        rows.push(`<tr><td align="center" style="padding:8px 32px">${link ? `<a href="${escape(link)}" target="_blank">${img}</a>` : img}</td></tr>`)
        break
      }
      case 'botao': {
        const link = href(b.url, true)
        if (!link) break
        const label = P(b.text)
        rows.push(button(link, label, hex(b.color, color), hex(b.textColor, '#ffffff'), alignOf(b.align, 'center')))
        text.push(`${label}: ${safeUrl(b.url, true)}`, '')
        break
      }
      case 'whatsapp': {
        const url = whatsappUrl(b.phone, b.message)
        if (!url) break
        const label = P(b.text || 'Falar no WhatsApp')
        rows.push(button(track(url), label, '#25D366', '#ffffff', alignOf(b.align, 'center')))
        text.push(`${label}: ${url}`, '')
        break
      }
      case 'produtos': {
        const items = b.items.slice(0, 12)
        const cols = b.columns === 2 ? 2 : 3
        const width = cols === 2 ? '50%' : '33%'
        const cells = items.map((p) => {
          const link = href(p.url)
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
          rows.push(`<tr><td style="padding:4px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${row.join('')}</tr></table></td></tr>`)
        }
        for (const p of items) text.push(`- ${p.name}${p.price ? ` — ${p.price}` : ''}${safeUrl(p.url) ? ` (${safeUrl(p.url)})` : ''}`)
        text.push('')
        break
      }
      case 'divisor':
        rows.push('<tr><td style="padding:12px 32px"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0"></td></tr>')
        break
      case 'espaco': {
        const h = clamp(b.height, 8, 96, 24)
        rows.push(`<tr><td style="height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</td></tr>`)
        break
      }
    }
  }

  const logo = safeUrl(o.brand.logoUrl)
  const header = logo
    ? `<tr><td align="center" style="padding:24px 32px 8px"><img src="${escape(logo)}" alt="${escape(o.brand.appName)}" height="48" style="display:block;height:48px;width:auto;max-width:260px;border:0"></td></tr>`
    : `<tr><td align="center" style="padding:24px 32px 8px;font-size:20px;font-weight:700;color:${color}">${escape(o.brand.appName)}</td></tr>`
  const footer = `<tr><td style="padding:24px 32px 32px;font-size:12px;line-height:18px;color:#6b7280;text-align:center;border-top:1px solid #f3f4f6">
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

/** Confere os blocos vindos do painel (tipos conhecidos, tamanhos, endereços, texto formatado). */
export function cleanBlocks(raw: unknown): { blocks: Block[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Conteúdo inválido.' }
  if (raw.length > 60) return { error: 'No máximo 60 blocos por e-mail.' }
  const out: Block[] = []
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  for (const b of raw as Record<string, unknown>[]) {
    switch (b?.type) {
      case 'titulo':
      case 'texto': {
        const isTitle = b.type === 'titulo'
        const html = typeof b.html === 'string' ? sanitizeRich(b.html, isTitle ? 2000 : 20_000) : legacyToHtml(str(b.text, isTitle ? 200 : 5000))
        out.push({
          type: b.type,
          html,
          align: alignOf(b.align),
          size: b.size === undefined ? undefined : clamp(b.size, isTitle ? 18 : 12, isTitle ? 40 : 24, isTitle ? 24 : 15),
          color: optHex(b.color),
          bg: optHex(b.bg),
        })
        break
      }
      case 'imagem':
        if (b.url && !safeUrl(String(b.url))) return { error: 'Imagem com endereço inválido (use https://).' }
        if (b.link && !safeUrl(String(b.link))) return { error: 'Link da imagem inválido (use https://).' }
        out.push({ type: 'imagem', url: str(b.url, 500), alt: str(b.alt, 200), link: str(b.link, 500) || undefined, width: b.width === undefined ? undefined : clamp(b.width, 20, 100, 100) })
        break
      case 'botao':
        if (!safeUrl(String(b.url ?? ''), true)) return { error: `Botão "${str(b.text, 40)}" sem um link válido (https://...).` }
        out.push({ type: 'botao', text: str(b.text, 60) || 'Saiba mais', url: str(b.url, 500), color: optHex(b.color), textColor: optHex(b.textColor), align: alignOf(b.align, 'center') })
        break
      case 'whatsapp':
        if (!whatsappUrl(str(b.phone, 30), undefined)) return { error: 'Botão de WhatsApp sem um número válido (DDD + número).' }
        out.push({ type: 'whatsapp', text: str(b.text, 60) || 'Falar no WhatsApp', phone: str(b.phone, 30), message: str(b.message, 500) || undefined, align: alignOf(b.align, 'center') })
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
      case 'divisor':
        out.push({ type: 'divisor' })
        break
      case 'espaco':
        out.push({ type: 'espaco', height: clamp(b.height, 8, 96, 24) })
        break
      default:
        return { error: `Tipo de bloco desconhecido: ${String(b?.type)}` }
    }
  }
  return { blocks: out }
}
