/**
 * Mapa de vendas do Dashboard executivo: soma por estado (e cidade) das vendas e dos atendimentos, separando a origem
 * (atendimento do Pré-Vendas, pedido da loja virtual ou pedido de marketplace que chega pela loja). Funções puras,
 * testadas em test/mapa.spec.ts.
 */
import { REGIONS } from './metricas'

export const MAP_ORIGINS = ['tudo', 'atendimento', 'ecommerce', 'marketplace'] as const
export type MapOrigin = (typeof MAP_ORIGINS)[number]
type Source = Exclude<MapOrigin, 'tudo'>

export const UFS = Object.keys(REGIONS).sort()

const NAMES: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT',
  'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
}

/** Sigla do estado a partir da sigla ou do nome (com ou sem acento); null quando não é um estado do Brasil. */
export function ufOf(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const up = s.toUpperCase()
  if (REGIONS[up]) return up
  return NAMES[s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()] ?? null
}

/** Pedido da loja: canal vazio, Site, Loja, Manual ou PDV é e-commerce; qualquer outro (Mercado Livre, Shopee...) é marketplace. */
export function orderSource(channel: string | null | undefined): 'ecommerce' | 'marketplace' {
  const c = (channel ?? '').trim().toLowerCase()
  return !c || /^(site|loja|loja virtual|e-?commerce|manual|pdv|balc[aã]o)$/.test(c) ? 'ecommerce' : 'marketplace'
}

/** Uma linha do mapa: um atendimento (com ou sem venda) ou um pedido pago. */
export interface MapRow {
  source: Source
  state: string | null
  city: string | null
  /** Valor vendido (0 quando o atendimento não virou venda). */
  value: number
  sale: boolean
}

export interface MapCell {
  sales: number
  orders: number
  attendances: number
}

export interface MapResult {
  states: (MapCell & { uf: string; cities: (MapCell & { city: string })[] })[]
  totals: MapCell
  /** Vendas e atendimentos sem estado conhecido (não aparecem no mapa). */
  noState: MapCell
}

const empty = (): MapCell => ({ sales: 0, orders: 0, attendances: 0 })
const add = (c: MapCell, r: MapRow) => {
  if (r.sale) {
    c.sales = Math.round((c.sales + r.value) * 100) / 100
    c.orders++
  }
  if (r.source === 'atendimento') c.attendances++
}
const cityKey = (s: string) => s.trim().replace(/\s+/g, ' ')

/** Soma por estado e cidade, só da origem pedida ("tudo" junta as três). Cidades: as 30 de maior venda de cada estado. */
export function aggregateMap(rows: MapRow[], origin: MapOrigin): MapResult {
  const byUf = new Map<string, { cell: MapCell; cities: Map<string, MapCell> }>()
  const totals = empty()
  const noState = empty()
  for (const r of rows) {
    if (origin !== 'tudo' && r.source !== origin) continue
    add(totals, r)
    const uf = ufOf(r.state)
    if (!uf) {
      add(noState, r)
      continue
    }
    let s = byUf.get(uf)
    if (!s) byUf.set(uf, (s = { cell: empty(), cities: new Map() }))
    add(s.cell, r)
    const city = r.city ? cityKey(r.city) : ''
    if (city) {
      const k = city.toLowerCase()
      let c = s.cities.get(k)
      if (!c) s.cities.set(k, (c = { ...empty(), city } as MapCell & { city: string }))
      add(c, r)
    }
  }
  return {
    states: [...byUf.entries()]
      .map(([uf, s]) => ({
        uf,
        ...s.cell,
        cities: ([...s.cities.values()] as (MapCell & { city: string })[]).sort((a, b) => b.sales - a.sales || b.attendances - a.attendances).slice(0, 30),
      }))
      .sort((a, b) => b.sales - a.sales || b.attendances - a.attendances),
    totals,
    noState,
  }
}
