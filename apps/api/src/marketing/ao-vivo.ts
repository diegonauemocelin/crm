/**
 * Painel de vendas em tempo real: as vendas de hoje (horário de Brasília) comparadas com ontem até a mesma hora, por
 * hora, e as últimas vendas que entraram. Origem: atendimento do Pré-Vendas, pedido da loja virtual ou de marketplace.
 * Funções puras, testadas em test/ao-vivo.spec.ts.
 */
import { localDay } from './metricas'
import type { MapOrigin } from './mapa'

const HOUR = 3_600_000

export interface LiveSale {
  source: Exclude<MapOrigin, 'tudo'>
  at: Date
  value: number
  /** Cliente (atendimento) ou número do pedido (loja). */
  title: string
  city: string | null
  state: string | null
  /** Vendedor (atendimento) ou canal (loja). */
  who: string | null
}

export interface LiveTotals {
  sales: number
  orders: number
  ticket: number
}

const totalsOf = (list: LiveSale[]): LiveTotals => {
  const sales = Math.round(list.reduce((s, x) => s + x.value, 0) * 100) / 100
  return { sales, orders: list.length, ticket: list.length ? Math.round((sales / list.length) * 100) / 100 : 0 }
}

/** Hora do dia em Brasília (0 a 23). */
const hourOf = (d: Date) => new Date(d.getTime() - 3 * HOUR).getUTCHours()

/**
 * Hoje x ontem até a mesma hora, vendas por hora (hoje e ontem) e as últimas vendas (até 30, das mais novas). As vendas
 * devem vir dos últimos dois dias; o filtro de origem já vem aplicado ("tudo" junta as três).
 */
export function buildLive(all: LiveSale[], origin: MapOrigin, now = Date.now()) {
  const list = origin === 'tudo' ? all : all.filter((s) => s.source === origin)
  const today = localDay(new Date(now))
  const yesterday = localDay(new Date(now - 24 * HOUR))
  const sameTimeYesterday = now - 24 * HOUR
  const todays = list.filter((s) => localDay(s.at) === today && s.at.getTime() <= now)
  const yesterdays = list.filter((s) => localDay(s.at) === yesterday)
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, today: 0, yesterday: 0 }))
  for (const s of todays) hours[hourOf(s.at)]!.today += s.value
  for (const s of yesterdays) hours[hourOf(s.at)]!.yesterday += s.value
  for (const h of hours) {
    h.today = Math.round(h.today * 100) / 100
    h.yesterday = Math.round(h.yesterday * 100) / 100
  }
  const bySource = (['atendimento', 'ecommerce', 'marketplace'] as const).map((source) => ({ source, ...totalsOf(todays.filter((s) => s.source === source)) }))
  return {
    now: new Date(now).toISOString(),
    today: totalsOf(todays),
    yesterdaySameTime: totalsOf(yesterdays.filter((s) => s.at.getTime() <= sameTimeYesterday)),
    yesterday: totalsOf(yesterdays),
    bySource,
    hours,
    feed: [...list]
      .filter((s) => s.at.getTime() <= now)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 30)
      .map((s) => ({ ...s, at: s.at.toISOString() })),
  }
}
