import { describe, expect, it } from 'vitest'
import { buildLive, type LiveSale } from '../src/marketing/ao-vivo'

// 25/10/2026 15:30 em Brasília (18:30 UTC).
const now = Date.parse('2026-10-25T18:30:00Z')
const sale = (source: LiveSale['source'], iso: string, value: number): LiveSale => ({ source, at: new Date(iso), value, title: 'x', city: null, state: null, who: null })
const list: LiveSale[] = [
  sale('atendimento', '2026-10-25T12:10:00Z', 1000), // hoje 09:10
  sale('ecommerce', '2026-10-25T17:59:00Z', 200), // hoje 14:59
  sale('marketplace', '2026-10-25T03:05:00Z', 50), // hoje 00:05
  sale('ecommerce', '2026-10-24T13:00:00Z', 300), // ontem 10:00 (antes da mesma hora)
  sale('atendimento', '2026-10-24T20:00:00Z', 700), // ontem 17:00 (depois da mesma hora)
  sale('ecommerce', '2026-10-25T02:59:00Z', 80), // ontem 23:59 em Brasília
]

describe('vendas em tempo real', () => {
  it('hoje x ontem até a mesma hora, no horário de Brasília', () => {
    const r = buildLive(list, 'tudo', now)
    expect(r.today).toEqual({ sales: 1250, orders: 3, ticket: 416.67 })
    expect(r.yesterdaySameTime).toEqual({ sales: 300, orders: 1, ticket: 300 })
    expect(r.yesterday).toEqual({ sales: 1080, orders: 3, ticket: 360 })
    expect(r.hours[9]).toEqual({ hour: 9, today: 1000, yesterday: 0 })
    expect(r.hours[0]!.today).toBe(50)
    expect(r.hours[23]!.yesterday).toBe(80)
    expect(r.bySource.find((s) => s.source === 'ecommerce')).toEqual({ source: 'ecommerce', sales: 200, orders: 1, ticket: 200 })
  })

  it('filtra pela origem e lista as últimas vendas da mais nova para a mais antiga', () => {
    const r = buildLive(list, 'ecommerce', now)
    expect(r.today.sales).toBe(200)
    expect(r.feed.map((s) => s.value)).toEqual([200, 80, 300])
    expect(buildLive(list, 'tudo', now).feed[0]!.value).toBe(200)
  })
})
