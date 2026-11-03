/**
 * Concorrentes do Mercado Livre: códigos de referência dos anúncios de outras lojas e a comparação de preço com os
 * anúncios da Usaparts (só os produtos com o mesmo código). Regras sem banco (testadas em concorrentes.spec.ts).
 */
import { codeKey, extractCodes, itemCodes } from './texto'

/** Campos do anúncio que trazem o código da peça (os ids da Meta do Mercado Livre e, por garantia, o nome). */
const CODE_ATTR = /^(PART_NUMBER|MPN|MODEL|ALPHANUMERIC_MODEL|OEM|OEM_NUMBER|ORIGINAL_EQUIPMENT_MANUFACTURER|AUTOMOTIVE_PART_NUMBER|VEHICLE_PART_IDENTIFICATION_NUMBER|SELLER_SKU)$/
const CODE_NAME = /n[uú]mero de pe[cç]a|modelo|\boem\b|refer[eê]ncia|identifica[cç][aã]o de pe[cç]a/i

/**
 * Código bom para comparar: 5 ou mais letras e números, com ao menos 4 números. Tira modelos de máquina curtos
 * (JS200, 320D, 3CX) que juntariam produtos diferentes.
 */
export function usableCode(c: string) {
  return c.length >= 5 && (c.match(/\d/g)?.length ?? 0) >= 4
}

/** Códigos de um anúncio de concorrente: dos campos de código e dos que aparecem no título. */
export function competitorCodes(attributes: { id?: string | null; name?: string | null; value_name?: string | null; value?: string | null }[] | null | undefined, title: string | null | undefined) {
  const out = new Set<string>()
  for (const a of attributes ?? []) {
    const v = a.value_name ?? a.value
    if (!v) continue
    if (!CODE_ATTR.test(String(a.id ?? '').toUpperCase()) && !CODE_NAME.test(String(a.name ?? ''))) continue
    for (const part of String(v).split(/[,;|]+/)) {
      const k = codeKey(part)
      if (usableCode(k)) out.add(k)
    }
  }
  for (const c of extractCodes(title)) {
    const k = codeKey(c)
    if (usableCode(k)) out.add(k)
  }
  return [...out]
}

/** Códigos de um anúncio da Usaparts: SKU, número de peça, OEM e os que estão no título (ex.: "…4cx-32925682"). */
export function ownCodes(r: { title?: string | null; sellerSku?: string | null; partNumber?: string | null; attributes?: unknown }) {
  const { ref, oem } = itemCodes(r)
  const out = new Set([...ref, ...oem].filter(usableCode))
  for (const c of extractCodes(r.title)) {
    const k = codeKey(c)
    if (usableCode(k)) out.add(k)
  }
  return [...out]
}

export interface OwnItem {
  id: string
  title: string | null
  price: number | null
  permalink: string | null
  codes: string[]
}
export interface RivalItem {
  competitorId: string
  itemId: string
  title: string | null
  price: number | null
  previousPrice: number | null
  priceChangedAt: Date | null
  permalink: string | null
  freeShipping: boolean
  codes: string[]
}
export interface Offer extends RivalItem {
  /** (preço do concorrente − preço da Usaparts) ÷ preço da Usaparts; negativo = concorrente mais barato. */
  diff: number | null
  /** Baixou o preço nos últimos 7 dias. */
  dropped: boolean
}
export interface CompareRow {
  item: OwnItem
  code: string
  /** Melhor oferta de cada concorrente (a mais barata) para o mesmo código. */
  offers: Offer[]
  /** Algum concorrente vende mais barato. */
  cheaper: boolean
  /** Maior desvantagem da Usaparts (o menor diff). */
  worst: number | null
}

const DAY = 86_400_000

/** Só os produtos da Usaparts com o mesmo código em ao menos um concorrente, com a pior diferença primeiro. */
export function compareByCode(own: OwnItem[], rivals: RivalItem[], now = Date.now()): CompareRow[] {
  const byCode = new Map<string, RivalItem[]>()
  for (const r of rivals) for (const c of r.codes) byCode.set(c, [...(byCode.get(c) ?? []), r])
  const rows: CompareRow[] = []
  for (const item of own) {
    let code = ''
    const best = new Map<string, RivalItem>()
    for (const c of item.codes) {
      for (const r of byCode.get(c) ?? []) {
        const cur = best.get(r.competitorId)
        if (!cur || (r.price ?? Infinity) < (cur.price ?? Infinity)) best.set(r.competitorId, r)
        code ||= c
      }
    }
    if (!best.size) continue
    const offers: Offer[] = [...best.values()].map((r) => ({
      ...r,
      diff: item.price && r.price != null ? Math.round(((r.price - item.price) / item.price) * 1000) / 1000 : null,
      dropped: r.previousPrice != null && r.price != null && r.price < r.previousPrice && !!r.priceChangedAt && now - r.priceChangedAt.getTime() < 7 * DAY,
    }))
    const diffs = offers.map((o) => o.diff).filter((d): d is number => d != null)
    const worst = diffs.length ? Math.min(...diffs) : null
    rows.push({ item, code, offers, cheaper: worst != null && worst < 0, worst })
  }
  return rows.sort((a, b) => (a.worst ?? 0) - (b.worst ?? 0))
}
