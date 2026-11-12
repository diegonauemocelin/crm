// Preços de concorrentes para Preços e promoções: os 2 mais baratos entre os anúncios das lojas concorrentes
// cadastradas com o mesmo código e os anúncios de outros vendedores no mesmo produto do catálogo do Mercado Livre.
// Só regras (sem banco); testes em test/precos-concorrentes.spec.ts.

export interface RivalOffer {
  itemId: string
  title: string | null
  price: number
  permalink: string | null
  seller: string | null
  freeShipping: boolean
  /** CODIGO: loja concorrente cadastrada, mesmo código; CATALOGO: mesmo produto do catálogo do ML. */
  source: 'CODIGO' | 'CATALOGO'
}

/** Junta as ofertas (sem repetir anúncio nem incluir o próprio), da mais barata para a mais cara, e fica com `n`. */
export function cheapestRivals(offers: RivalOffer[], ownItemId: string, n = 2): RivalOffer[] {
  const by = new Map<string, RivalOffer>()
  for (const o of offers) {
    if (!o.itemId || o.itemId === ownItemId || !Number.isFinite(o.price) || o.price <= 0) continue
    const old = by.get(o.itemId)
    // O mesmo anúncio pelas duas fontes: fica o de loja cadastrada (tem o nome da loja e o título).
    if (!old || (old.source === 'CATALOGO' && o.source === 'CODIGO')) by.set(o.itemId, o)
  }
  return [...by.values()].sort((a, b) => a.price - b.price || a.itemId.localeCompare(b.itemId)).slice(0, n)
}

/** Link público de um anúncio (MLB123 → produto.mercadolivre.com.br/MLB-123). */
export function itemLink(itemId: string) {
  return `https://produto.mercadolivre.com.br/${itemId.replace(/^([A-Z]{3})(\d+)$/, '$1-$2')}`
}
