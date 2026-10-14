/**
 * Produtos vistos na loja: páginas vistas (rastreamento do site) cruzadas com o endereço de cada produto do catálogo.
 * Um produto com variações (SKUs) tem uma página só; a página é a unidade dos números.
 */
import { pagePath } from '../rastreamento/origem'

export interface ProductRow {
  id: string
  code: string
  externalId: string
  name: string
  brand: string | null
  price: number | null
  stock: number | null
  image: string | null
  url: string | null
  path: string
  active: boolean
}

export interface ProductPage {
  path: string
  name: string
  brand: string | null
  url: string | null
  image: string | null
  /** Menor preço entre as variações ativas. */
  price: number | null
  /** Soma do estoque das variações (null se a loja não informa). */
  stock: number | null
  active: boolean
  codes: string[]
  productId: string
}

/** Junta as variações da mesma página: nome mais curto (sem a variação), menor preço, estoque somado. */
export function groupByPage(rows: ProductRow[]): Map<string, ProductPage> {
  const out = new Map<string, ProductPage>()
  for (const r of rows) {
    const cur = out.get(r.path)
    const codes = [r.code, r.externalId].filter(Boolean)
    if (!cur) {
      out.set(r.path, { path: r.path, name: r.name, brand: r.brand, url: r.url, image: r.image, price: r.active ? r.price : null, stock: r.stock, active: r.active, codes, productId: r.id })
      continue
    }
    if (r.name.length < cur.name.length) cur.name = r.name
    cur.brand ??= r.brand
    cur.image ??= r.image
    if (r.active && r.price !== null && (cur.price === null || r.price < cur.price)) cur.price = r.price
    if (r.stock !== null) cur.stock = (cur.stock ?? 0) + Math.max(0, r.stock)
    cur.active ||= r.active
    for (const c of codes) if (!cur.codes.includes(c)) cur.codes.push(c)
  }
  for (const p of out.values()) if (p.stock !== null && p.stock < 0) p.stock = 0
  return out
}

/**
 * Item de carrinho ou de compra é deste produto? A loja manda o código do produto ("042442") ou o da variação
 * ("042442P"); aceita o código igual ou o da variação começando pelo código do produto (com 4+ caracteres).
 */
export function itemMatches(itemCode: string | null | undefined, codes: string[]) {
  const id = String(itemCode ?? '').trim().toLowerCase()
  if (!id) return false
  return codes.some((c) => {
    const code = c.toLowerCase()
    return id === code || (code.length >= 4 && id.startsWith(code) && id.length - code.length <= 3)
  })
}

export interface LeadView {
  leadId: string
  path: string
  views: number
  firstAt: Date
  lastAt: Date
}
export interface LeadCart {
  leadId: string
  status: number
  at: Date
  items: { code?: string; url?: string | null }[]
}
export interface LeadPurchase {
  leadId: string
  at: Date
  items: { id?: string }[]
}

/** Situação do produto para o lead depois da primeira visita: comprou, está no carrinho ou só viu. */
export function productStatus(v: LeadView, page: ProductPage, carts: LeadCart[], purchases: LeadPurchase[]): 'comprou' | 'carrinho' | 'viu' {
  const since = v.firstAt.getTime() - 86_400_000
  const has = (items: { code?: string; url?: string | null; id?: string }[]) =>
    items.some((i) => itemMatches(i.code ?? i.id, page.codes) || (!!i.url && pagePath(i.url) === page.path))
  const mine = carts.filter((c) => c.leadId === v.leadId && c.at.getTime() >= since && has(c.items))
  if (mine.some((c) => c.status === 3) || purchases.some((p) => p.leadId === v.leadId && p.at.getTime() >= since && has(p.items))) return 'comprou'
  if (mine.length) return 'carrinho'
  return 'viu'
}

/** Ordem da lista de oportunidades: quem viu mais vezes e mais recentemente primeiro; no carrinho antes de só viu. */
export function rankOpportunities<T extends { views: number; lastAt: Date; status: string }>(list: T[]) {
  return [...list].sort((a, b) => (a.status === 'carrinho' ? 0 : 1) - (b.status === 'carrinho' ? 0 : 1) || b.views - a.views || b.lastAt.getTime() - a.lastAt.getTime())
}
