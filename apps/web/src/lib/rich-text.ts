/**
 * Texto formatado do editor de e-mail. Mesma lista de permissões do servidor (apps/api/src/email/blocos.ts):
 * negrito, itálico, sublinhado, riscado, cor, fundo, tamanho, links e listas. O servidor limpa de novo ao salvar.
 */

const TAGS: Record<string, string> = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u', S: 's', STRIKE: 's', A: 'a', SPAN: 'span', FONT: 'span', DIV: 'div', P: 'p', UL: 'ul', OL: 'ol', LI: 'li', BR: 'br' }
const DROP = new Set(['SCRIPT', 'STYLE', 'TITLE', 'HEAD', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG', 'MATH', 'TEXTAREA', 'SELECT', 'IMG', 'VIDEO', 'AUDIO'])
const FONT_SIZES = [0, 10, 13, 16, 18, 24, 32, 48]

function toHex(v: string): string | null {
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s)
  return m ? `#${m.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}` : null
}

function styleOf(el: HTMLElement): string {
  const st = el.style
  const out: string[] = []
  const color = toHex(st.color || (el.tagName === 'FONT' ? (el.getAttribute('color') ?? '') : ''))
  if (color) out.push(`color: ${color}`)
  const bg = toHex(st.backgroundColor)
  if (bg && bg !== '#ffffff') out.push(`background-color: ${bg}`)
  let size = /^(\d{1,2})(\.\d+)?px$/.exec(st.fontSize)?.[1]
  if (!size && el.tagName === 'FONT') size = String(FONT_SIZES[Number(el.getAttribute('size'))] || '')
  if (size && Number(size) >= 10 && Number(size) <= 48) out.push(`font-size: ${size}px`)
  if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) out.push('font-weight: bold')
  if (st.fontStyle === 'italic') out.push('font-style: italic')
  const deco = `${st.textDecoration} ${st.textDecorationLine}`
  const d = ['underline', 'line-through'].filter((x) => deco.includes(x))
  if (d.length) out.push(`text-decoration: ${d.join(' ')}`)
  return out.join('; ')
}

function copy(from: Node, to: Node, doc: Document) {
  for (const node of Array.from(from.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      to.appendChild(doc.createTextNode(node.textContent ?? ''))
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = node as HTMLElement
    if (DROP.has(el.tagName)) continue
    const name = TAGS[el.tagName]
    if (!name) {
      copy(el, to, doc) // tag desconhecida: fica só o conteúdo
      continue
    }
    if (name === 'br') {
      to.appendChild(doc.createElement('br'))
      continue
    }
    const out = doc.createElement(name)
    if (name === 'a') {
      const href = el.getAttribute('href') ?? ''
      if (!/^(https?:\/\/|mailto:|tel:)/i.test(href.trim())) {
        copy(el, to, doc)
        continue
      }
      out.setAttribute('href', href.trim())
    }
    const style = el.tagName === 'FONT' || name === 'span' || name === 'a' || el.getAttribute('style') ? styleOf(el) : ''
    if (name === 'span' && !style) {
      copy(el, to, doc)
      continue
    }
    if (style && (name === 'span' || name === 'a')) out.setAttribute('style', style)
    // Cor/tamanho em <b>, <i>, <u>... (o navegador às vezes põe ali): vira um <span> dentro da tag.
    let inner: HTMLElement = out
    if (style && name !== 'span' && name !== 'a') {
      inner = doc.createElement('span')
      inner.setAttribute('style', style)
      out.appendChild(inner)
    }
    copy(el, inner, doc)
    to.appendChild(out)
  }
}

/** HTML qualquer -> só o que o e-mail aceita. DOMParser não executa scripts nem carrega imagens. */
export function cleanRich(html: string): string {
  const src = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  const doc = document.implementation.createHTMLDocument('')
  const box = doc.createElement('div')
  copy(src.body, box, doc)
  return box.innerHTML
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Formato antigo (**negrito**, *itálico*, [texto](link)) -> HTML. */
export function legacyToHtml(text: string) {
  return cleanRich(
    esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\n/g, '<br>'),
  )
}

/** Texto visível (para avisos e acessibilidade). */
export function plainText(html: string) {
  return new DOMParser().parseFromString(`<body>${html}`, 'text/html').body.textContent?.trim() ?? ''
}
