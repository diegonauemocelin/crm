/**
 * Fontes públicas da busca de leads: localização (BrasilAPI CEP e Nominatim/OpenStreetMap), empresas no mapa
 * (Overpass/OpenStreetMap), cadastro do CNPJ (BrasilAPI, dados abertos da Receita) e conferência do e-mail (registro MX
 * do domínio). Sem chave e sem custo; respeitando o uso justo de cada serviço (uma consulta por vez).
 */
import { promises as dns } from 'node:dns'
import { emailOf, type EmailContact, osmPlaces, overpassQuery, type OsmPlace, phoneOf, type PhoneContact } from './prospeccao'

const UA = 'SG-Multiconecta-CRM/1.0 (prospeccao de empresas)'
const json = async (url: string, init: RequestInit = {}, ms = 30_000) => {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
  return (await res.json()) as unknown
}

export interface Center {
  lat: number
  lon: number
  label: string
  city: string | null
  uf: string | null
}

/** Centro da busca: CEP (BrasilAPI) ou "cidade, UF"/endereço (Nominatim). */
export async function geocode(place: string, cep: string | null): Promise<Center | null> {
  let query = place
  if (cep) {
    try {
      const c = (await json(`https://brasilapi.com.br/api/cep/v2/${cep}`)) as { city?: string; state?: string; street?: string; neighborhood?: string; location?: { coordinates?: { latitude?: string; longitude?: string } } }
      const lat = Number(c.location?.coordinates?.latitude)
      const lon = Number(c.location?.coordinates?.longitude)
      const label = [c.street, c.neighborhood, c.city && c.state ? `${c.city}/${c.state}` : null].filter(Boolean).join(', ')
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0) return { lat, lon, label: label || cep, city: c.city ?? null, uf: c.state ?? null }
      if (c.city && c.state) query = `${c.city}, ${c.state}`
    } catch {
      // CEP não encontrado: tenta pelo texto
    }
  }
  const r = (await json(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: `${query}, Brasil`, format: 'jsonv2', limit: '1', countrycodes: 'br', addressdetails: '1' })}`)) as {
    lat?: string
    lon?: string
    display_name?: string
    address?: { city?: string; town?: string; village?: string; municipality?: string; 'ISO3166-2-lvl4'?: string }
  }[]
  const g = r[0]
  if (!g) return null
  const lat = Number(g.lat)
  const lon = Number(g.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const uf = g.address?.['ISO3166-2-lvl4']?.split('-')[1] ?? null
  return { lat, lon, label: (g.display_name ?? query).split(',').slice(0, 3).join(',').trim(), city: g.address?.city ?? g.address?.town ?? g.address?.village ?? g.address?.municipality ?? null, uf }
}

/** Empresas do OpenStreetMap no raio que combinam com os termos. Falha do serviço: lista vazia (a IA segue). */
export async function osmSearch(center: { lat: number; lon: number }, radiusKm: number, terms: string[]): Promise<OsmPlace[]> {
  if (!terms.length) return []
  // O serviço público às vezes responde 502/504 por sobrecarga: tenta de novo uma vez, 5 s depois.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = await json('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: overpassQuery(center, radiusKm, terms) }).toString() }, 60_000)
      return osmPlaces(body)
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 5000))
    }
  }
  return []
}

export interface CnpjInfo {
  status: string | null
  name: string | null
  tradeName: string | null
  activity: string | null
  size: string | null
  city: string | null
  uf: string | null
  phones: PhoneContact[]
  emails: EmailContact[]
}

/** Cadastro público do CNPJ (dados abertos da Receita, pela BrasilAPI). Só dados da empresa: o quadro de sócios não é lido. */
export async function cnpjLookup(cnpj: string): Promise<CnpjInfo | null> {
  try {
    const c = (await json(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {}, 20_000)) as Record<string, unknown>
    const s = (k: string) => (typeof c[k] === 'string' && (c[k] as string).trim() ? (c[k] as string).trim() : null)
    const phones = [s('ddd_telefone_1'), s('ddd_telefone_2')].filter((x): x is string => !!x).map((p) => phoneOf(p, 'cadastro do CNPJ')).filter((p): p is PhoneContact => !!p)
    const email = s('email')
    return {
      status: s('descricao_situacao_cadastral'),
      name: s('razao_social'),
      tradeName: s('nome_fantasia'),
      activity: s('cnae_fiscal_descricao'),
      size: s('porte'),
      city: s('municipio'),
      uf: s('uf'),
      phones,
      emails: email ? [emailOf(email, 'cadastro do CNPJ')].filter((e): e is EmailContact => !!e) : [],
    }
  } catch {
    return null
  }
}

/** O domínio do e-mail recebe e-mail? (registro MX; sem MX, aceita o A como reserva, como os servidores fazem). */
export async function hasMx(domain: string): Promise<boolean> {
  const t = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('tempo')), 8000))])
  try {
    const mx = await t(dns.resolveMx(domain))
    if (mx.some((r) => r.exchange && r.exchange !== '.')) return true
  } catch {
    // sem MX
  }
  try {
    return (await t(dns.resolve4(domain))).length > 0
  } catch {
    return false
  }
}
