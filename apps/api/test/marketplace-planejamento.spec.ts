import { describe, expect, it } from 'vitest'
import { MODULE_KEYS } from '../src/common/permissions'
import {
  roasOf,
  abcClasses,
  addLine,
  auditFindings,
  type AuditSummary,
  catalogAlerts,
  cleanPlanConfig,
  closeDre,
  daysInMonth,
  dreCsv,
  emptyDre,
  fullSuggestion,
  goalProgress,
  isSale,
  lineContribution,
  monthWindows,
  orderLines,
  parsePerformance,
  parsePurchaseExperience,
  parseReputation,
  seasonality,
} from '../src/marketplaces/planejamento/planejamento'

describe('pedidos do Mercado Livre', () => {
  it('linhas com sale_fee × quantidade', () => {
    const l = orderLines({ id: 2000001, status: 'paid', date_created: '2026-10-05T10:00:00.000-03:00', shipping: { id: 44 }, order_items: [{ item: { id: 'MLB1', title: 'Filtro', seller_sku: 'F1', variation_id: null }, quantity: 3, unit_price: 50, sale_fee: 6.5, listing_type_id: 'gold_special' }] })
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ orderId: '2000001', itemId: 'MLB1', variationId: '', quantity: 3, total: 150, saleFee: 19.5, shippingId: '44' })
    expect(orderLines({ id: 1, order_items: [] })).toEqual([])
    expect(orderLines({ id: 1, date_created: '2026-10-05T10:00:00Z', order_items: [{ item: { id: 'MLB2' }, quantity: 1, unit_price: 10 }] })[0]!.saleFee).toBeNull()
    expect(isSale('cancelled')).toBe(false)
    expect(isSale('paid')).toBe(true)
  })

  it('janelas mensais', () => {
    const w = monthWindows(new Date('2026-09-20T00:00:00Z'), new Date('2026-11-11T00:00:00Z'))
    expect(w.map((x) => x.from.toISOString().slice(0, 10))).toEqual(['2026-09-20', '2026-10-01', '2026-11-01'])
    expect(w.at(-1)!.to.toISOString().slice(0, 10)).toBe('2026-11-11')
  })

  it('contribuição da linha e tarifa estimada quando o pedido não traz', () => {
    const c = { shippingPerUnit: 10, taxPct: 10, unitCost: 30, extraPct: 0, fixedCostPerSale: 2, feePct: 13 }
    const r = lineContribution({ total: 100, quantity: 1, saleFee: 12 }, c)
    expect(r.contribution).toBe(36)
    const e = lineContribution({ total: 100, quantity: 1, saleFee: null }, c)
    expect(e.fee).toBe(13)
    expect(e.feeEstimated).toBe(true)
    expect(lineContribution({ total: 100, quantity: 2, saleFee: 12 }, { ...c, unitCost: null }).missingCost).toBe(true)
  })
})

describe('curva ABC e alertas', () => {
  it('A até 80%, B até 95%, C o resto e quem não vendeu', () => {
    const m = abcClasses([
      { id: 'a', value: 500 },
      { id: 'b', value: 300 },
      { id: 'c', value: 120 },
      { id: 'd', value: 50 },
      { id: 'e', value: 30 },
      { id: 'z', value: 0 },
    ])
    expect([...'abcdez'].map((k) => m.get(k))).toEqual(['A', 'A', 'B', 'B', 'C', 'C'])
  })

  it('alertas do catálogo', () => {
    const base = { status: 'active', availableQuantity: 5, unitsInWindow: 3, windowDays: 90, daysSinceLastSale: 2, stalledDays: 60, marginPct: 20, minMarginPct: 10 }
    const codes = (x: Partial<typeof base>) => catalogAlerts({ ...base, ...x }).map((a) => a.code)
    expect(codes({})).toEqual([])
    expect(codes({ availableQuantity: 0 })).toContain('sem_estoque')
    expect(codes({ status: 'paused' })).toContain('pausado_com_estoque')
    expect(codes({ daysSinceLastSale: 75 })).toContain('parado')
    expect(codes({ unitsInWindow: 0, daysSinceLastSale: null })).toContain('sem_venda')
    expect(codes({ marginPct: 5 })).toContain('margem_baixa')
    expect(codes({ marginPct: -1 })).toContain('prejuizo')
  })
})

describe('qualidade e reputação', () => {
  it('pontos pendentes da nota de qualidade', () => {
    const p = parsePerformance({ score: 69.4, level: 'Good', level_wording: 'Profissional', buckets: [{ title: 'Dados do produto', variables: [{ title: 'Fotos', rules: [{ status: 'PENDING', mode: 'OPPORTUNITY', wordings: { title: 'Suba 3 fotos.' } }, { status: 'COMPLETED', wordings: { title: 'ok' } }] }] }] })
    expect(p).toMatchObject({ score: 69, levelWording: 'Profissional', pending: [{ area: 'Dados do produto', text: 'Suba 3 fotos.', warning: false }] })
    expect(parsePerformance(null).score).toBeNull()
  })
  it('experiência de compra', () => {
    const x = parsePurchaseExperience({ reputation: { value: 50, color: 'orange', text: 'Média' }, metrics_details: { problems: [{ quantity: '1 problema', level_two: { title: { text: 'Mal estado' } } }] } })
    expect(x).toEqual({ value: 50, color: 'orange', text: 'Média', problems: ['Mal estado · 1 problema'] })
  })
  it('reputação do vendedor', () => {
    const r = parseReputation({ seller_reputation: { level_id: '5_green', power_seller_status: 'gold', metrics: { claims: { rate: 0.01 }, delayed_handling_time: { rate: 0.2 }, sales: { completed: 900, period: '60 days' } } } })
    expect(r).toMatchObject({ levelId: '5_green', claimsRate: 0.01, delayedRate: 0.2, salesCompleted: 900 })
    expect(parseReputation({})).toBeNull()
  })
  it('diagnóstico da conta', () => {
    const s: AuditSummary = {
      reputation: { levelId: '3_yellow', powerSellerStatus: null, claimsRate: 0.03, cancellationsRate: 0, delayedRate: 0, salesCompleted: 10, period: '60 days' },
      items: { total: 10, active: 8, paused: 2, noStock: 1, pausedWithStock: 1, stalled: 2, lowMargin: 1, loss: 1, noCost: 3 },
      quality: { read: 0, avgScore: null, withPending: 0, badExperience: 0 },
      attributes: { measured: 8, missingBrand: 1, missingPartNumber: 2 },
      questions: { unanswered: 4, oldestHours: 30 },
      ads: { cost: 100, revenue: 1000, acos: 10, days: 30 },
      sales: { revenue: 5000, orders: 40, units: 50, contributionPct: 8, days: 30 },
    }
    const f = auditFindings(s, 10)
    expect(f[0]!.level).toBe('alerta')
    expect(f.map((x) => x.area)).toEqual(expect.arrayContaining(['Reputação', 'Catálogo', 'Margem', 'Ficha técnica', 'Perguntas', 'Publicidade', 'Resultado']))
  })
})

describe('metas, Full e sazonalidade', () => {
  it('projeção do mês pelo ritmo', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(goalProgress(30000, 10000, 10, 30)).toMatchObject({ pct: 33.33, projection: 30000, projectionPct: 100 })
    expect(goalProgress(null, 500, 5, 30).pct).toBeNull()
  })

  it('sugestão de Full pelo giro, limitada ao estoque', () => {
    const base = { units30: 30, units60: 45, stock: 100, isFull: false, marginPct: 20, minMarginPct: 10, coverageDays: 30, windowDays: 30 as const, storageCostPerUnitMonth: null }
    expect(fullSuggestion(base)).toMatchObject({ dailyRate: 1, qty: 30 })
    expect(fullSuggestion({ ...base, stock: 10 })!.qty).toBe(10)
    expect(fullSuggestion({ ...base, isFull: true, stock: 25 })!.qty).toBe(5)
    expect(fullSuggestion({ ...base, isFull: true, stock: 40 })).toBeNull()
    expect(fullSuggestion({ ...base, marginPct: 5 })).toBeNull()
    expect(fullSuggestion({ ...base, units30: 0 })).toBeNull()
    expect(fullSuggestion({ ...base, storageCostPerUnitMonth: 1 })!.storageCost).toBe(30)
  })

  it('meses fortes da sazonalidade', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, revenue: i === 10 ? 300 : 100, units: 1 }))
    const s = seasonality(rows)
    expect(s[10]).toMatchObject({ label: 'nov', strong: true })
    expect(s[0]!.strong).toBe(false)
    expect(seasonality([])[0]!.index).toBeNull()
  })

  it('configuração', () => {
    expect(cleanPlanConfig({ coverageDays: 999, fullWindowDays: 60, storageCostPerUnitMonth: '1,5', fullMinMarginPct: '' })).toMatchObject({ coverageDays: 180, fullWindowDays: 60, storageCostPerUnitMonth: 1.5, fullMinMarginPct: null })
  })
})

describe('DRE', () => {
  it('soma, contribuição com Ads, % sem custo e CSV', () => {
    const d = emptyDre('2026-10', '2026-10')
    const c = { shippingPerUnit: 0, taxPct: 10, unitCost: 40, extraPct: 0, fixedCostPerSale: 0, feePct: 12 }
    addLine(d, lineContribution({ total: 100, quantity: 1, saleFee: 12 }, c), 1)
    addLine(d, lineContribution({ total: 100, quantity: 1, saleFee: 12 }, { ...c, unitCost: null }), 1)
    d.ads = 20
    const r = closeDre(d)
    expect(r).toMatchObject({ gross: 200, fees: 24, taxes: 20, cogs: 40, ads: 20, contribution: 96, contributionPct: 48, noCostPct: 50, estimated: true })
    const csv = dreCsv([r], 'Mês')
    expect(csv.startsWith('﻿Mês;Venda bruta')).toBe(true)
    expect(csv).toContain('2026-10;200,00;24,00')
  })

  it('módulo de permissão novo', () => {
    expect(MODULE_KEYS).toContain('marketplace_planejamento')
  })
})

describe('ROAS', () => {
  it('é o ACOS ao contrário', () => {
    expect(roasOf(15)).toBe(6.67)
    expect(roasOf(10.7)).toBe(9.35)
    expect(roasOf(null)).toBeNull()
    expect(roasOf(0)).toBeNull()
  })
})
