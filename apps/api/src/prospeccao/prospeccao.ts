/**
 * Busca de leads (prospecção de empresas): regras puras, sem banco e sem rede (test/prospeccao.spec.ts).
 * Só dados públicos de EMPRESAS (site, cadastro do CNPJ, mapa, perfis comerciais): nada de dado pessoal de sócio ou
 * funcionário (LGPD). Cada contato guarda de onde veio e o que foi conferido.
 */
import { DDD_UF, normalizePhone } from '../atendimento/br'

export const MAX_RESULTS = 40
export const MAX_RADIUS_KM = 300

export interface ProspectCriteria {
  /** Centro: CEP ou "cidade, UF". */
  place: string
  /** Raio em km (0 = só a cidade). */
  radiusKm: number
  /** Ramo/segmento (ex.: "terraplenagem", "construtora", "locadora de máquinas"). */
  segment: string
  /** Palavras-chave e interesse (ex.: "escavadeira, pá carregadeira"). */
  keywords: string[]
  /** Observações para a IA (porte, perfil ideal etc.). */
  notes: string
  /** Quantas empresas buscar (até MAX_RESULTS). */
  limit: number
  /** Só mostrar quem tem ao menos um contato válido. */
  onlyWithContact: boolean
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '')

export function cleanCriteria(raw: Partial<Record<keyof ProspectCriteria, unknown>>): ProspectCriteria {
  const radius = Math.round(Number(raw.radiusKm))
  const limit = Math.round(Number(raw.limit))
  const kw = Array.isArray(raw.keywords) ? raw.keywords : typeof raw.keywords === 'string' ? raw.keywords.split(/[,;\n]/) : []
  return {
    place: clip(raw.place, 120),
    radiusKm: Number.isFinite(radius) ? Math.max(0, Math.min(MAX_RADIUS_KM, radius)) : 50,
    segment: clip(raw.segment, 120),
    keywords: [...new Set(kw.map((k) => clip(k, 40).toLowerCase()).filter(Boolean))].slice(0, 12),
    notes: clip(raw.notes, 600),
    limit: Number.isFinite(limit) ? Math.max(5, Math.min(MAX_RESULTS, limit)) : 20,
    onlyWithContact: raw.onlyWithContact !== false,
  }
}

/** CEP só com dígitos (8) ou null. */
export const cepOf = (s: string) => {
  const d = s.replace(/\D/g, '')
  return d.length === 8 ? d : null
}

/** Distância em km entre dois pontos (fórmula de haversine). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (x: number) => (x * Math.PI) / 180
  const dLat = r(b.lat - a.lat)
  const dLon = r(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10
}

// ---------- Contatos ----------

export type PhoneKind = 'celular' | 'fixo'

export interface PhoneContact {
  /** +55DDDNÚMERO */
  value: string
  kind: PhoneKind
  source: string
  /** WhatsApp conferido: true/false; null = ainda não conferido. */
  whatsapp: boolean | null
}

export interface EmailContact {
  value: string
  source: string
  /** O domínio recebe e-mail (registro MX). null = não conferido. */
  mx: boolean | null
}

/** Telefone brasileiro válido (DDD existente; celular com 9). */
export function phoneOf(raw: string, source: string): PhoneContact | null {
  const e164 = normalizePhone(raw)
  if (!e164 || !e164.startsWith('+55')) return null
  const digits = e164.slice(3)
  if (!DDD_UF[digits.slice(0, 2)]) return null
  return { value: e164, kind: digits.length === 11 ? 'celular' : 'fixo', source: source.slice(0, 80), whatsapp: null }
}

/** E-mails que não servem para contato comercial (sistemas, listas). */
const BAD_LOCAL = /^(no-?reply|nao-?responda|naoresponda|mailer-daemon|postmaster|abuse|bounce|donotreply|webmaster)$/i
const BAD_DOMAIN = /(example\.(com|org)|sentry\.io|wixpress\.com|domain\.com|email\.com)$/i

export function emailOf(raw: string, source: string): EmailContact | null {
  const v = raw.trim().toLowerCase().replace(/^mailto:/, '')
  if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return null
  const [local, domain] = v.split('@') as [string, string]
  if (BAD_LOCAL.test(local) || BAD_DOMAIN.test(domain) || /\.(png|jpe?g|gif|webp|svg)$/.test(domain)) return null
  return { value: v, source: source.slice(0, 80), mx: null }
}

/** Junta contatos repetidos (mesmo número/e-mail), mantendo as fontes. */
export function mergePhones(list: PhoneContact[]): PhoneContact[] {
  const by = new Map<string, PhoneContact>()
  for (const p of list) {
    const cur = by.get(p.value)
    if (!cur) by.set(p.value, { ...p })
    else if (!cur.source.includes(p.source)) cur.source = `${cur.source}, ${p.source}`.slice(0, 120)
  }
  return [...by.values()].slice(0, 6)
}
export function mergeEmails(list: EmailContact[]): EmailContact[] {
  const by = new Map<string, EmailContact>()
  for (const e of list) {
    const cur = by.get(e.value)
    if (!cur) by.set(e.value, { ...e })
    else if (!cur.source.includes(e.source)) cur.source = `${cur.source}, ${e.source}`.slice(0, 120)
  }
  return [...by.values()].slice(0, 5)
}

/** CNPJ com dígitos verificadores corretos (só dígitos) ou null. */
export function cnpjOf(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return null
  const calc = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = w.reduce((acc, x, i) => acc + x * Number(d[i]), 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]) ? d : null
}

/** Site normalizado (https://dominio/) ou null; redes sociais e diretórios não contam como site. */
export function siteOf(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  if (!/\./.test(u.hostname) || /(facebook|instagram|linkedin|google|wa\.me|whatsapp|youtube|tiktok)\./i.test(u.hostname)) return null
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 300)
}

export function instagramOf(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  const m = /(?:instagram\.com\/|^@)([A-Za-z0-9._]{2,30})\/?$/.exec(s) ?? /^([A-Za-z0-9._]{2,30})$/.exec(s)
  return m ? `https://instagram.com/${m[1]}` : null
}

/** Chave para achar a mesma empresa vinda de fontes diferentes: nome sem acento, sem forma jurídica. */
export function nameKey(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|me|epp|eireli|s\/?a|sa|cia|comercio|com|ind|industria|e|de|da|do|dos|das)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// ---------- OpenStreetMap (Overpass) ----------

/** Termos para o mapa: segmento e palavras-chave, cada um com até 3 palavras, sem caracteres de expressão regular. */
export function osmTerms(c: Pick<ProspectCriteria, 'segment' | 'keywords'>) {
  const all = [c.segment, ...c.keywords]
    .map((t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((t) => t.length >= 3)
  return [...new Set(all)].slice(0, 8)
}

/**
 * Consulta do Overpass: empresas com nome dentro do raio cujo nome ou ramo combina com os termos. Sem acento no
 * termo, o regex usa classes ([aá]) para achar o nome com acento.
 */
export function overpassQuery(center: { lat: number; lon: number }, radiusKm: number, terms: string[]) {
  const acc: Record<string, string> = { a: '[aáàâã]', e: '[eéê]', i: '[ií]', o: '[oóôõ]', u: '[uúü]', c: '[cç]' }
  const re = terms.map((t) => t.replace(/[aeiouc]/g, (ch) => acc[ch]!)).join('|')
  const r = Math.max(1, Math.min(MAX_RADIUS_KM, radiusKm || 20)) * 1000
  const around = `(around:${r},${center.lat.toFixed(5)},${center.lon.toFixed(5)})`
  return `[out:json][timeout:50];(nwr${around}["name"~"${re}",i];nwr${around}["shop"~"${re}",i]["name"];nwr${around}["craft"~"${re}",i]["name"];);out center tags 150;`
}

export interface OsmPlace {
  name: string
  lat: number | null
  lon: number | null
  address: string | null
  city: string | null
  uf: string | null
  phones: PhoneContact[]
  emails: EmailContact[]
  site: string | null
  kind: string | null
}

/** Lugares do resultado do Overpass. */
export function osmPlaces(body: unknown): OsmPlace[] {
  const els = Array.isArray((body as { elements?: unknown })?.elements) ? ((body as { elements: unknown[] }).elements as Record<string, unknown>[]) : []
  const out: OsmPlace[] = []
  for (const e of els) {
    const t = (e.tags ?? {}) as Record<string, string>
    const name = clip(t.name, 160)
    if (!name) continue
    const lat = typeof e.lat === 'number' ? e.lat : typeof (e.center as { lat?: number })?.lat === 'number' ? (e.center as { lat: number }).lat : null
    const lon = typeof e.lon === 'number' ? e.lon : typeof (e.center as { lon?: number })?.lon === 'number' ? (e.center as { lon: number }).lon : null
    const phones = [t.phone, t['contact:phone'], t['contact:mobile'], t['contact:whatsapp']].flatMap((p) => (p ? p.split(/[;,/]/) : [])).map((p) => phoneOf(p, 'OpenStreetMap')).filter((p): p is PhoneContact => !!p)
    const emails = [t.email, t['contact:email']].flatMap((x) => (x ? x.split(/[;,]/) : [])).map((x) => emailOf(x, 'OpenStreetMap')).filter((x): x is EmailContact => !!x)
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ')
    out.push({
      name,
      lat,
      lon,
      address: street || null,
      city: clip(t['addr:city'], 80) || null,
      uf: clip(t['addr:state'], 2).toUpperCase() || null,
      phones: mergePhones(phones),
      emails: mergeEmails(emails),
      site: siteOf(t.website ?? t['contact:website']),
      kind: clip(t.shop ?? t.craft ?? t.office ?? t.industrial ?? t.amenity, 60) || null,
    })
  }
  // Mesmo nome repetido (nó e área): fica um.
  const seen = new Set<string>()
  return out.filter((p) => {
    const k = nameKey(p.name)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------- Resultado da IA ----------

/** Ferramenta que a IA chama no fim com as empresas encontradas (esquema estrito). */
export const REGISTRAR_TOOL = {
  name: 'registrar_empresas',
  description: 'Registra a lista final de empresas encontradas, com os contatos comerciais públicos e a avaliação de cada uma. Chame uma vez, no fim.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['empresas'],
    properties: {
      empresas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['nome', 'cnpj', 'segmento', 'cidade', 'uf', 'endereco', 'site', 'instagram', 'telefones', 'emails', 'nota', 'motivo', 'fontes'],
          properties: {
            nome: { type: 'string' },
            cnpj: { type: 'string' },
            segmento: { type: 'string' },
            cidade: { type: 'string' },
            uf: { type: 'string' },
            endereco: { type: 'string' },
            site: { type: 'string' },
            instagram: { type: 'string' },
            telefones: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['numero', 'fonte'], properties: { numero: { type: 'string' }, fonte: { type: 'string' } } } },
            emails: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['email', 'fonte'], properties: { email: { type: 'string' }, fonte: { type: 'string' } } } },
            nota: { type: 'integer' },
            motivo: { type: 'string' },
            fontes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
} as const

export interface ProspectData {
  name: string
  cnpj: string | null
  segment: string | null
  city: string | null
  uf: string | null
  address: string | null
  site: string | null
  instagram: string | null
  phones: PhoneContact[]
  emails: EmailContact[]
  score: number
  reason: string
  sources: string[]
  lat: number | null
  lon: number | null
}

/** Empresas que a IA registrou, já limpas (contatos que não passam na validação de formato ficam de fora). */
export function prospectsFromAi(input: unknown): ProspectData[] {
  const list = Array.isArray((input as { empresas?: unknown })?.empresas) ? ((input as { empresas: unknown[] }).empresas as Record<string, unknown>[]) : []
  return list
    .map((e) => {
      const name = clip(e.nome, 160)
      const tels = Array.isArray(e.telefones) ? (e.telefones as { numero?: string; fonte?: string }[]) : []
      const mails = Array.isArray(e.emails) ? (e.emails as { email?: string; fonte?: string }[]) : []
      const score = Math.round(Number(e.nota))
      return {
        name,
        cnpj: cnpjOf(e.cnpj),
        segment: clip(e.segmento, 120) || null,
        city: clip(e.cidade, 80) || null,
        uf: clip(e.uf, 2).toUpperCase() || null,
        address: clip(e.endereco, 200) || null,
        site: siteOf(e.site),
        instagram: instagramOf(e.instagram),
        phones: mergePhones(tels.map((t) => phoneOf(String(t.numero ?? ''), clip(t.fonte, 80) || 'pesquisa na web')).filter((p): p is PhoneContact => !!p)),
        emails: mergeEmails(mails.map((m) => emailOf(String(m.email ?? ''), clip(m.fonte, 80) || 'pesquisa na web')).filter((m): m is EmailContact => !!m)),
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 50,
        reason: clip(e.motivo, 500),
        sources: (Array.isArray(e.fontes) ? (e.fontes as unknown[]) : []).map((f) => clip(f, 200)).filter((f) => /^https:\/\//.test(f)).slice(0, 5),
        lat: null,
        lon: null,
      }
    })
    .filter((p) => p.name)
}

/** O lead já está na base (mesmo telefone ou e-mail)? */
export function alreadyKnown(p: Pick<ProspectData, 'phones' | 'emails'>, known: { phones: Set<string>; emails: Set<string> }) {
  return p.phones.some((x) => known.phones.has(x.value)) || p.emails.some((x) => known.emails.has(x.value))
}

/** Tem contato que passou nas conferências (e-mail com MX, telefone válido ou WhatsApp confirmado)? */
export function hasValidContact(p: Pick<ProspectData, 'phones' | 'emails'>) {
  return p.phones.some((x) => x.whatsapp !== false) || p.emails.some((x) => x.mx === true)
}

export const SYSTEM_PROMPT = `Você pesquisa empresas (B2B) no Brasil para a prospecção comercial de uma empresa. Use a pesquisa na web para achar empresas reais do segmento pedido na região pedida e os contatos COMERCIAIS públicos de cada uma (site da empresa, cadastro do CNPJ, perfil comercial no Google ou no Instagram).

Regras:
- Só empresas (pessoa jurídica). Nunca dados pessoais de sócios ou funcionários (CPF, celular pessoal, e-mail pessoal): só contatos da empresa publicados por ela.
- Não invente: cada telefone, e-mail, CNPJ e site precisa ter aparecido numa fonte que você leu; informe a fonte de cada contato (ex.: "site da empresa", "Google", "Instagram", "cadastro do CNPJ") e as URLs em "fontes".
- Use os "candidatos do mapa" quando combinarem com o perfil: complete os dados deles e acrescente outras empresas que achar.
- Dê uma nota de 0 a 100 de quanto a empresa combina com o perfil buscado (segmento, interesse, região, porte) e o motivo em uma frase.
- Campos sem informação: texto vazio ("") ou lista vazia. Formato: telefone com DDD, UF com 2 letras.
- No fim, chame a ferramenta registrar_empresas uma vez com a lista (no máximo o número pedido), da maior nota para a menor.`
