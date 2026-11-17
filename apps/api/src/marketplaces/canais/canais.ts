/**
 * Shopee, Amazon e TikTok Shop: configuração das tarifas de cada marketplace e a linha de cada anúncio (margem e preço
 * sugerido), com as mesmas contas do Mercado Livre (margem.ts). Funções puras (test/canais.spec.ts).
 *
 * Essas plataformas não informam a tarifa antes da venda pela API como o Mercado Livre: a comissão, a taxa fixa por item e
 * o frete que a loja paga são os do contrato de cada uma, informados pela empresa na tela. Nada é suposto.
 */
import { computeMargin, type MarginMode, priceForProfit, profitTargetOf, round2, roundTo90 } from '../precos/margem'
import type { ChannelKey } from './tipos'

export const CHANNEL_SLUG: Record<ChannelKey, string> = { shopee: 'shopee', amazon: 'amazon', tiktok: 'tiktok-shop' }
export const CHANNEL_MODULE: Record<ChannelKey, string> = { shopee: 'mkt_shopee', amazon: 'mkt_amazon', tiktok: 'mkt_tiktok' }
export const channelOfSlug = (slug: string): ChannelKey | null => (Object.entries(CHANNEL_SLUG).find(([, s]) => s === slug)?.[0] as ChannelKey | undefined) ?? null

/** Tarifas do marketplace informadas pela empresa (as do contrato/da tabela da plataforma). */
export interface ChannelFees {
  /** Comissão sobre o preço de venda (%). null = não informada (a margem diz o que falta). */
  feePct: number | null
  /** Taxa fixa por item vendido (R$). */
  feeFixed: number
  /** Frete pago pela loja por venda (R$), em média. */
  shipping: number
}
export const DEFAULT_FEES: ChannelFees = { feePct: null, feeFixed: 0, shipping: 0 }

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : null
}

export function cleanFees(raw: Partial<Record<keyof ChannelFees, unknown>>, base: ChannelFees = DEFAULT_FEES): ChannelFees {
  const pct = 'feePct' in raw ? (raw.feePct === null || raw.feePct === '' ? null : num(raw.feePct)) : base.feePct
  return {
    feePct: pct === null ? null : round2(Math.min(90, Math.max(0, pct))),
    feeFixed: 'feeFixed' in raw ? round2(Math.min(10_000, Math.max(0, num(raw.feeFixed) ?? 0))) : base.feeFixed,
    shipping: 'shipping' in raw ? round2(Math.min(10_000, Math.max(0, num(raw.shipping) ?? 0))) : base.shipping,
  }
}

export interface RowInput {
  price: number | null
  fees: ChannelFees
  /** Imposto da venda (%), do mesmo jeito que no Mercado Livre (notas ou alíquota manual). */
  taxPct: number | null
  ipiPct?: number
  cost: number | null
  /** Lucro do produto informado em Preços (R$ ou % do custo), quando houver. */
  profit: { profitValue: number | null; profitPct: number | null } | null
  /** Preço de venda do ERP (Tcar), base do lucro quando não há lucro informado. */
  erpPrice: number | null
  fixedCost: number
  extraPct: number
  marginMode: MarginMode
}

/**
 * Margem do anúncio no preço atual e o preço sugerido que deixa o mesmo lucro da venda por fora (como "Lucro do
 * produto" no Mercado Livre): (custo + lucro + taxa fixa + frete) ÷ (1 − comissão% − imposto% − outras%), com ,90.
 */
export function channelRow(i: RowInput) {
  const fee = i.fees.feePct === null || i.price === null ? null : round2((i.price * i.fees.feePct) / 100 + i.fees.feeFixed)
  const margin = i.price === null ? null : computeMargin({ price: i.price, fee, shipping: i.fees.shipping, taxPct: i.taxPct, cost: i.cost, fixedCost: i.fixedCost, extraPct: i.extraPct, marginMode: i.marginMode })
  const target = profitTargetOf(i.profit, i.cost, i.erpPrice, i.taxPct, i.ipiPct ?? 0)
  const suggested =
    target && i.cost !== null && i.taxPct !== null && i.fees.feePct !== null
      ? roundTo90(priceForProfit(target.value, { fee: { pct: i.fees.feePct, fixed: i.fees.feeFixed }, shipping: i.fees.shipping, taxPct: i.taxPct, extraPct: i.extraPct, cost: i.cost, fixedCost: i.fixedCost }))
      : null
  return { fee, margin, profitTarget: target, suggestedPrice: suggested }
}

/** Preço novo válido (R$ 0,01 a R$ 1.000.000), com centavos. */
export function cleanPrice(v: unknown): number | null {
  const n = num(v)
  return n === null || n < 0.01 || n > 1_000_000 ? null : round2(n)
}
