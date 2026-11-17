/**
 * Análise de mercado (funções puras): categorias em que a loja vende, tendências de busca e mais vendidos do Mercado
 * Livre (API oficial: /trends e /highlights), o que a loja já cobre e a leitura da IA (pontos a melhorar e de atenção).
 */

export const MAX_CATEGORIES = 6

export interface OwnListing {
  categoryId: string | null
  title: string | null
  sales30: number | null
}

/** Categorias com mais anúncios e vendas da loja (as que importam para a análise). */
export function topCategories(items: OwnListing[], max = MAX_CATEGORIES) {
  const by = new Map<string, { id: string; items: number; sales30: number }>()
  for (const i of items) {
    if (!i.categoryId) continue
    const c = by.get(i.categoryId) ?? { id: i.categoryId, items: 0, sales30: 0 }
    c.items++
    c.sales30 += i.sales30 ?? 0
    by.set(i.categoryId, c)
  }
  return [...by.values()].sort((a, b) => b.sales30 - a.sales30 || b.items - a.items).slice(0, max)
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A loja tem anúncio para a busca em alta? Todas as palavras da busca (de 3+ letras) aparecem no título de algum
 * anúncio. Devolve quantos anúncios cobrem.
 */
export function coverage(keyword: string, titles: string[]) {
  const words = norm(keyword)
    .split(' ')
    .filter((w) => w.length >= 3)
  if (!words.length) return 0
  return titles.filter((t) => {
    const n = ` ${norm(t)} `
    return words.every((w) => n.includes(` ${w}`) || n.includes(w))
  }).length
}

export interface TrendRow {
  keyword: string
  url: string | null
  ownListings: number
}

/** Lê a resposta de /trends: lista de { keyword, url }. */
export function trendsOf(raw: unknown, titles: string[], max = 20): TrendRow[] {
  const list = Array.isArray(raw) ? (raw as { keyword?: unknown; url?: unknown }[]) : []
  return list
    .filter((t) => typeof t?.keyword === 'string' && t.keyword.trim())
    .slice(0, max)
    .map((t) => ({ keyword: String(t.keyword).trim().slice(0, 120), url: typeof t.url === 'string' && /^https:\/\//.test(t.url) ? t.url : null, ownListings: coverage(String(t.keyword), titles) }))
}

/** Lê a resposta de /highlights: { content: [{ id, position, type }] } (top 20 da categoria). */
export function highlightsOf(raw: unknown) {
  const content = (raw as { content?: unknown } | null)?.content
  return (Array.isArray(content) ? (content as { id?: unknown; position?: unknown; type?: unknown }[]) : [])
    .filter((c) => typeof c?.id === 'string' && /^ML[A-Z]U?\d+$/.test(c.id))
    .map((c) => ({ id: String(c.id), position: Number(c.position) || 0, type: typeof c.type === 'string' ? c.type : 'ITEM' }))
    .sort((a, b) => a.position - b.position)
    .slice(0, 20)
}

export interface MarketSnapshot {
  generatedAt: string
  segment: string
  region: string
  categories: {
    id: string
    name: string
    ownItems: number
    ownSales30: number
    trends: TrendRow[]
    bestSellers: { position: number; id: string; type: string; name: string | null; ownListings: number }[]
  }[]
}

/** Números do topo do painel: tendências que a loja não cobre, mais vendidos que ela não tem. */
export function snapshotTotals(s: MarketSnapshot) {
  const trends = s.categories.flatMap((c) => c.trends)
  const best = s.categories.flatMap((c) => c.bestSellers)
  return {
    categories: s.categories.length,
    trends: trends.length,
    trendsUncovered: trends.filter((t) => !t.ownListings).length,
    bestSellers: best.length,
    bestSellersUncovered: best.filter((b) => b.name && !b.ownListings).length,
  }
}

export interface AiReading {
  resumo: string
  melhorar: { titulo: string; detalhe: string }[]
  atencao: { titulo: string; detalhe: string }[]
  oportunidades: { titulo: string; detalhe: string }[]
}

/** Pedido ao Gemini: lê os números do painel e devolve pontos a melhorar, de atenção e oportunidades. */
export function aiPrompt(s: MarketSnapshot, company: string) {
  const data = s.categories.map((c) => ({
    categoria: c.name,
    anuncios_da_loja: c.ownItems,
    vendas_30_dias_da_loja: c.ownSales30,
    buscas_em_alta: c.trends.map((t) => `${t.keyword}${t.ownListings ? ` (loja tem ${t.ownListings})` : ' (loja NÃO tem)'}`),
    mais_vendidos: c.bestSellers.filter((b) => b.name).map((b) => `${b.position}º ${b.name}${b.ownListings ? ' (loja tem parecido)' : ''}`),
  }))
  return `Você é analista de mercado de uma empresa brasileira que vende no Mercado Livre.
Empresa: ${company}. Segmento: ${s.segment || 'não informado'}. Região de atuação: ${s.region || 'Brasil'}.

Dados reais do Mercado Livre desta semana (API oficial: buscas em alta e os 20 mais vendidos de cada categoria em que a loja vende), com o que a loja já tem:
${JSON.stringify(data)}

Use também a pesquisa do Google para o contexto do segmento e da região (demanda, sazonalidade, notícias do setor).

Regras:
- Português do Brasil, direto, para o dono da empresa.
- Baseie-se nos dados; não invente números, preços, vendas nem fatos. Quando usar a pesquisa, diga de onde veio.
- "melhorar": o que a loja pode fazer (anúncios, cobertura de produtos, títulos). "atencao": riscos e sinais de alerta. "oportunidades": buscas em alta ou mais vendidos que a loja não cobre e faria sentido cobrir.
- De 3 a 6 itens em cada lista, cada um com título curto e detalhe de 1 a 3 frases.

Responda SOMENTE com JSON: {"resumo": "...", "melhorar": [{"titulo": "...", "detalhe": "..."}], "atencao": [...], "oportunidades": [...]}`
}

const items = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((x) => ({ titulo: String((x as { titulo?: unknown })?.titulo ?? '').trim().slice(0, 160), detalhe: String((x as { detalhe?: unknown })?.detalhe ?? '').trim().slice(0, 800) }))
    .filter((x) => x.titulo)
    .slice(0, 8)

/** Leitura da IA (JSON solto no texto ou em bloco de código); null se não veio no formato. */
export function readingFromAi(text: string): AiReading | null {
  const json = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const d = JSON.parse(json) as Record<string, unknown>
    const r = { resumo: String(d.resumo ?? '').trim().slice(0, 1500), melhorar: items(d.melhorar), atencao: items(d.atencao), oportunidades: items(d.oportunidades) }
    return r.resumo || r.melhorar.length || r.atencao.length ? r : null
  } catch {
    return null
  }
}
