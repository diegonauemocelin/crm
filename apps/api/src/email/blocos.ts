/**
 * Montagem do e-mail a partir de blocos (funções puras, testadas em test/email.spec.ts).
 * HTML no padrão dos clientes de e-mail: tabelas, estilos inline, largura máxima de 600px.
 * Todo texto vindo do painel é escapado; links só http(s) (e mailto/tel), passando pelo rastreamento de cliques.
 */

export type Block =
  | { type: 'titulo'; text: string; align?: 'left' | 'center' }
  | { type: 'texto'; text: string; align?: 'left' | 'center' }
  | { type: 'imagem'; url: string; alt?: string; link?: string }
  | { type: 'botao'; text: string; url: string; color?: string }
  | { type: 'produtos'; items: { name: string; image?: string; price?: string; url?: string }[] }
  | { type: 'divisor' }
  | { type: 'espaco' }

export const BLOCK_TYPES = ['titulo', 'texto', 'imagem', 'botao', 'produtos', 'divisor', 'espaco'] as const

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

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Só endereços seguros em links e imagens. */
export function safeUrl(url: string | undefined | null, allowMail = false): string | null {
  const u = (url ?? '').trim()
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u
  if (allowMail && /^(mailto|tel):[^\s"'<>]+$/i.test(u)) return u
  return null
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** {nome}, {primeiro_nome}, {email}. Sem nome, a saudação fica neutra ("Olá!" em vez de "Olá, !"). */
export function personalize(text: string, p: Person) {
  const first = p.name?.trim().split(/\s+/)[0] ?? ''
  return text
    .replace(/,?\s*\{primeiro_nome\}/g, (m) => (first ? m.replace('{primeiro_nome}', first) : ''))
    .replace(/,?\s*\{nome\}/g, (m) => (p.name?.trim() ? m.replace('{nome}', p.name.trim()) : ''))
    .replaceAll('{email}', p.email)
}

/** Lista única de links da campanha, na ordem em que aparecem (o índice vai no link rastreado). */
export function collectLinks(blocks: Block[]): string[] {
  const out: string[] = []
  const add = (u: string | null) => {
    if (u && !out.includes(u)) out.push(u)
  }
  for (const b of blocks) {
    if (b.type === 'texto') for (const m of b.text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) add(safeUrl(m[2], true))
    if (b.type === 'imagem') add(safeUrl(b.link))
    if (b.type === 'botao') add(safeUrl(b.url, true))
    if (b.type === 'produtos') for (const i of b.items) add(safeUrl(i.url))
  }
  return out
}

/** Texto do painel -> HTML: **negrito**, *itálico*, [texto](link) e quebras de linha. O resto é escapado. */
function richText(text: string, link: (u: string) => string | null) {
  return escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
      const href = link(url.replace(/&amp;/g, '&'))
      return href ? `<a href="${escape(href)}" style="color:inherit;text-decoration:underline">${label}</a>` : label
    })
    .replace(/\n/g, '<br>')
}

export function renderEmail(blocks: Block[], o: RenderOptions) {
  const color = HEX.test(o.brand.color) ? o.brand.color : '#1d4ed8'
  const links = collectLinks(blocks)
  const href = (raw: string | undefined | null, allowMail = false) => {
    const u = safeUrl(raw, allowMail)
    if (!u) return null
    if (/^(mailto|tel):/i.test(u) || !o.trackLink) return u
    const i = links.indexOf(u)
    return i >= 0 ? o.trackLink(u, i) : u
  }
  const P = (t: string) => personalize(t, o.person)
  const rows: string[] = []
  const text: string[] = []

  for (const b of blocks) {
    switch (b.type) {
      case 'titulo': {
        const t = P(b.text)
        rows.push(`<tr><td style="padding:8px 32px;font-size:24px;line-height:30px;font-weight:700;color:#111827;text-align:${b.align === 'center' ? 'center' : 'left'}">${escape(t)}</td></tr>`)
        text.push(t.toUpperCase(), '')
        break
      }
      case 'texto': {
        const t = P(b.text)
        rows.push(`<tr><td style="padding:8px 32px;font-size:15px;line-height:23px;color:#374151;text-align:${b.align === 'center' ? 'center' : 'left'}">${richText(t, (u) => href(u, true))}</td></tr>`)
        text.push(t.replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)'), '')
        break
      }
      case 'imagem': {
        const src = safeUrl(b.url)
        if (!src) break
        const img = `<img src="${escape(src)}" alt="${escape(b.alt ?? '')}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:6px">`
        const link = href(b.link)
        rows.push(`<tr><td style="padding:8px 32px">${link ? `<a href="${escape(link)}">${img}</a>` : img}</td></tr>`)
        break
      }
      case 'botao': {
        const link = href(b.url, true)
        if (!link) break
        const bg = b.color && HEX.test(b.color) ? b.color : color
        const label = P(b.text)
        rows.push(
          `<tr><td align="center" style="padding:16px 32px"><a href="${escape(link)}" style="background:${bg};color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:6px;display:inline-block;font-weight:700;font-size:15px">${escape(label)}</a></td></tr>`,
        )
        text.push(`${label}: ${safeUrl(b.url, true)}`, '')
        break
      }
      case 'produtos': {
        const items = b.items.slice(0, 12)
        const cells = items.map((p) => {
          const link = href(p.url)
          const img = safeUrl(p.image) ? `<img src="${escape(safeUrl(p.image)!)}" alt="" width="160" style="display:block;width:100%;max-width:160px;height:auto;border:0;margin:0 auto 8px">` : ''
          const name = `<div style="font-size:14px;line-height:19px;color:#111827;font-weight:600">${escape(p.name)}</div>`
          const price = p.price ? `<div style="font-size:15px;color:${color};font-weight:700;padding-top:4px">${escape(p.price)}</div>` : ''
          const inner = `${img}${name}${price}`
          return `<td valign="top" width="33%" style="padding:8px;text-align:center">${link ? `<a href="${escape(link)}" style="text-decoration:none">${inner}</a>` : inner}</td>`
        })
        for (let i = 0; i < cells.length; i += 3) {
          const row = cells.slice(i, i + 3)
          while (row.length < 3) row.push('<td width="33%"></td>')
          rows.push(`<tr><td style="padding:4px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${row.join('')}</tr></table></td></tr>`)
        }
        for (const p of items) text.push(`- ${p.name}${p.price ? ` — ${p.price}` : ''}${safeUrl(p.url) ? ` (${safeUrl(p.url)})` : ''}`)
        text.push('')
        break
      }
      case 'divisor':
        rows.push('<tr><td style="padding:12px 32px"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0"></td></tr>')
        break
      case 'espaco':
        rows.push('<tr><td style="height:24px;line-height:24px">&nbsp;</td></tr>')
        break
    }
  }

  const logo = safeUrl(o.brand.logoUrl)
  const header = logo
    ? `<tr><td align="center" style="padding:24px 32px 8px"><img src="${escape(logo)}" alt="${escape(o.brand.appName)}" height="44" style="display:block;height:44px;width:auto;border:0"></td></tr>`
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

/** Confere os blocos vindos do painel (tipos conhecidos, tamanhos, endereços). */
export function cleanBlocks(raw: unknown): { blocks: Block[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Conteúdo inválido.' }
  if (raw.length > 60) return { error: 'No máximo 60 blocos por e-mail.' }
  const out: Block[] = []
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  for (const b of raw as Record<string, unknown>[]) {
    const align = b?.align === 'center' ? 'center' : 'left'
    switch (b?.type) {
      case 'titulo':
        out.push({ type: 'titulo', text: str(b.text, 200), align })
        break
      case 'texto':
        out.push({ type: 'texto', text: str(b.text, 5000), align })
        break
      case 'imagem':
        if (b.url && !safeUrl(String(b.url))) return { error: 'Imagem com endereço inválido (use https://).' }
        out.push({ type: 'imagem', url: str(b.url, 500), alt: str(b.alt, 200), link: str(b.link, 500) || undefined })
        break
      case 'botao':
        if (!safeUrl(String(b.url ?? ''), true)) return { error: `Botão "${str(b.text, 40)}" sem um link válido (https://...).` }
        out.push({ type: 'botao', text: str(b.text, 60) || 'Saiba mais', url: str(b.url, 500), color: HEX.test(String(b.color ?? '')) ? String(b.color) : undefined })
        break
      case 'produtos': {
        const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]).slice(0, 12) : []
        out.push({ type: 'produtos', items: items.map((i) => ({ name: str(i?.name, 120), image: str(i?.image, 500) || undefined, price: str(i?.price, 40) || undefined, url: str(i?.url, 500) || undefined })) })
        break
      }
      case 'divisor':
      case 'espaco':
        out.push({ type: b.type })
        break
      default:
        return { error: `Tipo de bloco desconhecido: ${String(b?.type)}` }
    }
  }
  return { blocks: out }
}
