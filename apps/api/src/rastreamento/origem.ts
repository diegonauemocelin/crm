/**
 * Regras puras do rastreamento do site (testadas em test/rastreamento.spec.ts):
 * de onde veio a visita, o que guardar da URL e quais domínios podem enviar dados.
 */

export interface Touch {
  /** Ex.: google, facebook, instagram, newsletter, direto. */
  source: string
  /** Ex.: cpc, organico, social, referencia, email, direto. */
  medium: string
  campaign?: string
  term?: string
  content?: string
  /** Só o domínio de quem indicou (nunca a URL completa). */
  referrer?: string
  /** Página de entrada, já limpa. */
  landing?: string
  /** Gravado como JSON no banco. */
  [key: string]: string | undefined
}

const SEARCH: [string, string][] = [
  ['google.', 'google'],
  ['bing.com', 'bing'],
  ['yahoo.', 'yahoo'],
  ['duckduckgo.com', 'duckduckgo'],
  ['ecosia.org', 'ecosia'],
  ['search.brave.com', 'brave'],
  ['yandex.', 'yandex'],
]
const SOCIAL: [string, string][] = [
  ['facebook.com', 'facebook'],
  ['fb.com', 'facebook'],
  ['instagram.com', 'instagram'],
  ['linkedin.com', 'linkedin'],
  ['lnkd.in', 'linkedin'],
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['tiktok.com', 'tiktok'],
  ['t.co', 'twitter'],
  ['twitter.com', 'twitter'],
  ['x.com', 'twitter'],
  ['pinterest.', 'pinterest'],
  ['whatsapp.com', 'whatsapp'],
  ['wa.me', 'whatsapp'],
]

/** Parâmetros que podem ficar na URL guardada. O resto (que pode ter e-mail, CPF, token...) é descartado. */
const KEEP_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'q', 'busca', 'categoria', 'page', 'pagina'])

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

function matchesHost(host: string, pattern: string) {
  return pattern.endsWith('.') ? host.includes(pattern) : host === pattern || host.endsWith(`.${pattern}`)
}

/** O domínio está na lista (o próprio ou um subdomínio dele)? */
export function domainAllowed(host: string | null, allowed: string[]) {
  if (!host) return false
  const h = host.toLowerCase()
  return allowed.some((d) => {
    const a = d.trim().toLowerCase().replace(/^\*\./, '')
    return a && (h === a || h.endsWith(`.${a}`))
  })
}

/** Normaliza um domínio digitado no painel ("https://www.loja.com.br/" -> "www.loja.com.br"). */
export function cleanDomain(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(s) ? s : null
}

/** URL guardada: sem senha/fragmento e só com os parâmetros conhecidos. */
export function cleanUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const params = new URLSearchParams()
  for (const [k, v] of u.searchParams) if (KEEP_PARAMS.has(k.toLowerCase())) params.append(k.toLowerCase(), v.slice(0, 120))
  const qs = params.toString()
  return `${u.protocol}//${u.host}${u.pathname}${qs ? `?${qs}` : ''}`.slice(0, 500)
}

const clip = (v: string | null | undefined, n = 120) => (v ? v.trim().slice(0, n) || undefined : undefined)

/**
 * Classifica a origem da visita, na ordem: UTMs > identificadores de anúncio (gclid/fbclid) >
 * site que indicou (busca, rede social ou outro site) > direto.
 * Retorna null quando a navegação veio do próprio site (não é uma nova origem).
 */
export function classifyTouch(pageUrl: string, referrer: string | null | undefined, siteDomains: string[]): Touch | null {
  let page: URL
  try {
    page = new URL(pageUrl)
  } catch {
    return null
  }
  const p = page.searchParams
  const landing = cleanUrl(pageUrl) ?? undefined
  const refHost = hostOf(referrer)
  const internal = !!refHost && (domainAllowed(refHost, siteDomains) || refHost === page.hostname.toLowerCase())
  const utmSource = clip(p.get('utm_source'), 80)

  if (utmSource) {
    return {
      source: utmSource.toLowerCase(),
      medium: clip(p.get('utm_medium'), 80)?.toLowerCase() ?? 'desconhecido',
      campaign: clip(p.get('utm_campaign')),
      term: clip(p.get('utm_term')),
      content: clip(p.get('utm_content')),
      referrer: internal ? undefined : (refHost ?? undefined),
      landing,
    }
  }
  if (p.get('gclid')) return { source: 'google', medium: 'cpc', referrer: refHost ?? undefined, landing }
  if (p.get('fbclid')) return { source: refHost && refHost.includes('instagram') ? 'instagram' : 'facebook', medium: 'social', referrer: refHost ?? undefined, landing }
  if (internal) return null
  if (!refHost) return { source: 'direto', medium: 'direto', landing }

  // Webmail antes da busca: mail.google.com também casa com "google.".
  if (/(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com)$|(^|\.)webmail\./.test(refHost)) return { source: 'email', medium: 'email', referrer: refHost, landing }
  const search = SEARCH.find(([s]) => matchesHost(refHost, s))
  if (search) return { source: search[1], medium: 'organico', referrer: refHost, landing }
  const social = SOCIAL.find(([s]) => matchesHost(refHost, s))
  if (social) return { source: social[1], medium: 'social', referrer: refHost, landing }
  return { source: refHost.replace(/^www\./, ''), medium: 'referencia', referrer: refHost, landing }
}

const MEDIUM_LABEL: Record<string, string> = {
  cpc: 'anúncio',
  ppc: 'anúncio',
  paid: 'anúncio',
  organico: 'busca orgânica',
  social: 'rede social',
  referencia: 'indicação de site',
  email: 'e-mail',
  direto: 'acesso direto',
}

/** Texto curto para a linha do tempo: "google (anúncio) · campanha black-friday". */
export function describeTouch(t: Touch | null | undefined) {
  if (!t) return 'origem desconhecida'
  if (t.source === 'direto') return 'acesso direto'
  const medium = MEDIUM_LABEL[t.medium] ?? t.medium
  return `${t.source} (${medium})${t.campaign ? ` · campanha ${t.campaign}` : ''}`
}

/** Identificadores gerados pelo navegador: aleatórios, curtos, sem dado pessoal. */
export const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/
