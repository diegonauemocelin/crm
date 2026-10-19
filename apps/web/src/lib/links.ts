/** Links dentro do texto das mensagens: http(s)://... ou www.... (o "www." ganha https://). */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi

/** Pontuação no fim que é da frase, não do link ("veja www.site.com.br."). */
function trimUrl(raw: string) {
  let url = raw.replace(/[.,;:!?]+$/, '')
  // Parêntese no fim só fica se o link abriu um (ex.: páginas da Wikipédia).
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1)
  return url
}

export type TextPart = { text: string; href?: undefined } | { text: string; href: string }

/** Separa o texto em trechos comuns e links (só http/https: nada de javascript: ou arquivos locais). */
export function splitLinks(text: string): TextPart[] {
  const out: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0])
    const start = m.index
    if (start > last) out.push({ text: text.slice(last, start) })
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    try {
      const u = new URL(href)
      if (u.protocol === 'http:' || u.protocol === 'https:') out.push({ text: url, href: u.href })
      else out.push({ text: url })
    } catch {
      out.push({ text: url })
    }
    last = start + url.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
