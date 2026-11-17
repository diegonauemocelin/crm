import { describe, expect, it } from 'vitest'
import { channelOfSlug, channelRow, cleanFees, cleanPrice } from '../src/marketplaces/canais/canais'

describe('Shopee, Amazon e TikTok Shop: margem e preço', () => {
  it('lê o endereço e limpa as tarifas', () => {
    expect(channelOfSlug('tiktok-shop')).toBe('tiktok')
    expect(channelOfSlug('mercado-livre')).toBeNull()
    expect(cleanFees({ feePct: '20', feeFixed: 4, shipping: -3 })).toEqual({ feePct: 20, feeFixed: 4, shipping: 0 })
    expect(cleanFees({ feePct: '' })).toMatchObject({ feePct: null })
    expect(cleanPrice('41,90')).toBe(41.9)
    expect(cleanPrice(0)).toBeNull()
  })

  it('margem no preço atual e preço sugerido com o mesmo lucro da venda por fora', () => {
    const taxPct = (6.69 / 27.68) * 100
    const r = channelRow({ price: 41.9, fees: { feePct: 17, feeFixed: 0, shipping: 7.15 }, taxPct, cost: 14.57, profit: null, erpPrice: 27.68, fixedCost: 0, extraPct: 0, marginMode: 'PRECO' })
    expect(r.fee).toBe(7.12)
    expect(r.margin?.margin).toBe(2.93)
    expect(r.profitTarget?.value).toBe(6.42)
    // (14,57 + 6,42 + 7,15) ÷ (1 − 17% − 24,17%) = 47,84 → ,90
    expect(r.suggestedPrice).toBe(47.9)
  })

  it('sem a comissão informada, não sugere preço', () => {
    const r = channelRow({ price: 50, fees: { feePct: null, feeFixed: 0, shipping: 0 }, taxPct: 10, cost: 20, profit: null, erpPrice: 40, fixedCost: 0, extraPct: 0, marginMode: 'PRECO' })
    expect(r.suggestedPrice).toBeNull()
    expect(r.margin?.missing).toContain('tarifa')
  })
})
