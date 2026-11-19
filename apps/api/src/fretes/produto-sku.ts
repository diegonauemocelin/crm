/**
 * Produto pelo SKU para a cotação de frete (funções puras, testadas em test/fretes-produto-sku.spec.ts): peso e medidas
 * cadastrados na Magazord (catálogo da loja copiado no CRM) viram um volume da cotação, por unidade.
 */

export interface SkuProduct {
  externalId: string
  code: string
  name: string
  price: number | null
  weightKg: number | null
  heightCm: number | null
  widthCm: number | null
  lengthCm: number | null
  measuresAt: Date | null
}

/** Limpa o SKU digitado (espaços e tamanho). */
export function cleanSku(v: unknown) {
  return typeof v === 'string' ? v.trim().slice(0, 80) : ''
}

/** Volume por unidade a partir do cadastro, e o que falta no cadastro da Magazord (peso ou alguma medida). */
export function skuVolume(p: SkuProduct) {
  const pos = (v: number | null) => (v !== null && v > 0 ? v : null)
  const weight = pos(p.weightKg)
  const length = pos(p.lengthCm)
  const width = pos(p.widthCm)
  const height = pos(p.heightCm)
  const missing = [weight === null && 'peso', length === null && 'comprimento', width === null && 'largura', height === null && 'altura'].filter((x): x is string => !!x)
  return {
    sku: p.externalId,
    code: p.code,
    name: p.name,
    unitPrice: p.price,
    weight,
    length,
    width,
    height,
    measuresAt: p.measuresAt,
    missing,
    warning: missing.length ? `Cadastro da Magazord sem ${missing.join(', ')}: complete na Magazord ou digite na cotação.` : null,
  }
}
