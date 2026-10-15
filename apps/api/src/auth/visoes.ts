/** Visões salvas de cada usuário (telas novas): filtros de uma lista guardados com um nome. Funções puras. */

export const VIEW_SCREENS = ['leads', 'pre-vendas'] as const
export type ViewScreen = (typeof VIEW_SCREENS)[number]

export interface SavedView {
  id: string
  name: string
  /** Filtros da tela, no formato do endereço (ex.: "stage=LEAD&state=PR"), sem página nem ordenação. */
  query: string
}

export const MAX_VIEWS = 20

/** Só o que é filtro: tira página e aba, e limita o tamanho. Parâmetros com nomes estranhos são descartados. */
export function cleanQuery(raw: string): string {
  const params = new URLSearchParams(raw.replace(/^\?/, '').slice(0, 2000))
  const out = new URLSearchParams()
  for (const [k, v] of params) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k) || ['page', 'aba', 'abrir', 'visao'].includes(k)) continue
    const value = v.trim().slice(0, 200)
    if (value) out.set(k, value)
  }
  return out.toString()
}

/** Confere a lista enviada pela tela: nomes de 1 a 40 letras, sem repetir, no máximo 20 visões. */
export function cleanViews(input: unknown): { views: SavedView[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'Lista de visões inválida.' }
  if (input.length > MAX_VIEWS) return { error: `Guarde no máximo ${MAX_VIEWS} visões por tela.` }
  const out: SavedView[] = []
  const names = new Set<string>()
  for (const raw of input as Record<string, unknown>[]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 40) return { error: 'Dê um nome de até 40 letras para a visão.' }
    if (names.has(name.toLowerCase())) return { error: `Já existe uma visão chamada "${name}".` }
    names.add(name.toLowerCase())
    const id = typeof raw.id === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.id) ? raw.id : `v${out.length}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`
    out.push({ id, name, query: cleanQuery(typeof raw.query === 'string' ? raw.query : '') })
  }
  return { views: out }
}

/** Lê o que está gravado no usuário (JSON livre) sem confiar no formato. */
export function readViews(stored: unknown, screen: ViewScreen): SavedView[] {
  const all = stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[screen] : null
  const r = cleanViews(Array.isArray(all) ? all.slice(0, MAX_VIEWS) : [])
  return 'views' in r ? r.views : []
}
