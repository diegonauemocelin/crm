import { DDD_UF } from './ddd'

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

/**
 * Candidato a telefone no texto: dígitos com espaço, ponto, hífen e parênteses no meio (o formato é conferido em
 * phoneFromText). Pode juntar vários telefones seguidos; splitPhones separa.
 */
const PHONE_RE = /(?<![\p{L}\p{N}@+.,-])(?:\+[ \t]?)?\(?\d[\d \t().-]{7,80}\d(?![\p{L}\p{N}@])/gu

/**
 * Formatos de telefone brasileiro: +55/55/0 opcional, DDD (com ou sem parênteses) e o número em 4-4, 5-4 ou 9 4-4.
 * Outras divisões (código de peça 6754-71-6110, 8-98018858-0, 119802-55800; CPF 479.123.456-01; linha digitável
 * 74891.12345; blocos de 4 da chave de NF-e) não são telefone.
 */
// O 0 antes do DDD só vale separado ("049 98863-2548"): grudado ("0419 8765 4321") é bloco de chave de NF-e.
const BR_SHAPE = /^(?:\+55[ .-]?|55[ .-])?(?:\(0?\d{2}\)|0\d{2}(?=[ .-])|\d{2})[ .-]?(?:9[ .-]?)?\d{4}[ .-]?\d{4}$/
/** Estrangeiro: com + e o código do país, em grupos. */
const INTL_SHAPE = /^\+[1-9]\d{0,2}(?:[ .-]?\(?\d{1,5}\)?)+$/

/** Telefone do texto no formato da base (+55DDNNNNNNNN, ou +código do país); null quando não parece telefone. */
export function phoneFromText(raw: string): string | null {
  const t = raw.trim().replace(/[ \t]+/g, ' ')
  let d = t.replace(/\D/g, '')
  if (t.startsWith('+') && !d.startsWith('55')) return INTL_SHAPE.test(t) && d.length >= 10 && d.length <= 15 ? `+${d}` : null
  // Só dígitos, sem separador: celular com DDD (11) ou com 55 na frente (13). Dez dígitos soltos parecem código.
  if (/^\+?\d+$/.test(t) ? !(d.length === 11 || (d.length === 13 && d.startsWith('55')) || (t.startsWith('+') && d.length === 12)) : !BR_SHAPE.test(t)) return null
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  else if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  if (d.length !== 10 && d.length !== 11) return null
  if (!DDD_UF[d.slice(0, 2)]) return null
  // Celular tem 9 dígitos começando com 9; fixo (ou celular antigo sem o 9), 8 dígitos começando de 2 a 9.
  if (d.length === 11 ? d[2] !== '9' : !/[2-9]/.test(d[2]!)) return null
  return `+55${d}`
}

/** Logo depois de "CPF" ou "CNPJ" é documento, não telefone. */
const DOC_BEFORE = /(?:cpf|cnpj)[\s:nº°.#-]*$/i

export type PhonePart = { text: string; phone?: string }

/** Separa os telefones de um trecho de texto (sem links). */
export function splitPhones(text: string): PhonePart[] {
  const out: PhonePart[] = []
  let last = 0
  for (const m of text.matchAll(PHONE_RE)) {
    // Vários telefones seguidos ("(49) 98863-2548 49 3664-0888"): o maior trecho válido a partir de cada palavra.
    const words = [...m[0].matchAll(/\S+/g)].map((w) => ({ start: m.index + w.index, end: m.index + w.index + w[0].length }))
    for (let i = 0; i < words.length; ) {
      // Telefone tem no máximo 6 palavras ("+55 (49) 9 8863 2548"): limita a busca em textos longos de números.
      let j = Math.min(words.length, i + 6)
      let phone: string | null = null
      for (; j > i && !(phone = phoneFromText(text.slice(words[i]!.start, words[j - 1]!.end))); j--);
      if (!phone || DOC_BEFORE.test(text.slice(Math.max(0, words[i]!.start - 20), words[i]!.start))) {
        i++
        continue
      }
      const start = words[i]!.start
      const end = words[j - 1]!.end
      if (start > last) out.push({ text: text.slice(last, start) })
      out.push({ text: text.slice(start, end), phone })
      last = end
      i = j
    }
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
