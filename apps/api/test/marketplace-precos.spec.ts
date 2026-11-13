import { describe, expect, it } from 'vitest'
import { MODULE_KEYS } from '../src/common/permissions'
import { aggregateTaxRates, isMercadoEnvios, parseNfeTaxes, taxRateFor } from '../src/marketplaces/precos/impostos'
import {
  applyPriceRule,
  cleanPrecosConfig,
  computeMargin,
  couponBody,
  couponUnitPrice,
  feeFromRow,
  mlMessagePt,
  pickListingPrice,
  priceForMargin,
  pricingTips,
  promoDealPrice,
  refinePrice,
  sendRetryDelay,
  type TipInput,
  validateCoupon,
  validatePromo,
} from '../src/marketplaces/precos/margem'

const base = { fee: 13, shipping: 20, taxPct: 10, cost: 40, fixedCost: 2, extraPct: 0 }

describe('margem', () => {
  it('preço − tarifa − frete − imposto − outras taxas − custo − custo fixo', () => {
    const m = computeMargin({ price: 100, ...base })
    expect(m.tax).toBe(10)
    expect(m.margin).toBe(15)
    expect(m.marginPct).toBe(15)
    expect(m.missing).toEqual([])
  })

  it('sem custo, tarifa ou imposto não calcula; sem frete calcula e avisa', () => {
    expect(computeMargin({ price: 100, ...base, cost: null }).margin).toBeNull()
    expect(computeMargin({ price: 100, ...base, fee: null }).missing).toContain('tarifa')
    expect(computeMargin({ price: 100, ...base, taxPct: null }).margin).toBeNull()
    const s = computeMargin({ price: 100, ...base, shipping: null })
    expect(s.margin).toBe(35)
    expect(s.missing).toEqual(['frete'])
  })

  it('outras taxas (%) entram sobre o preço', () => {
    expect(computeMargin({ price: 200, ...base, extraPct: 2.5 }).extra).toBe(5)
  })
})

describe('preço para a margem alvo', () => {
  const model = { fee: { pct: 13, fixed: 0 }, shipping: 20, taxPct: 10, extraPct: 0, cost: 40, fixedCost: 2 }
  it('fórmula fechada e conferência', () => {
    const p = priceForMargin(15, model)!
    expect(p).toBe(100)
    const zero = priceForMargin(0, model)!
    expect(zero).toBeCloseTo(62 / 0.77, 1)
    const m = computeMargin({ price: zero, fee: (zero * 13) / 100, shipping: 20, taxPct: 10, cost: 40, fixedCost: 2, extraPct: 0 })
    expect(Math.abs(m.margin!)).toBeLessThan(0.02)
  })

  it('impossível quando os percentuais passam de 100%', () => {
    expect(priceForMargin(80, model)).toBeNull()
  })

  it('busca com a tarifa real (faixa com parte fixa abaixo de R$ 79)', async () => {
    const feeAt = async (price: number) => ({ pct: 13, fixed: price < 79 ? 6.25 : 0 })
    const p = await refinePrice(10, { ...model, shipping: 0, cost: 30 }, feeAt)
    expect(p).not.toBeNull()
    const fee = await feeAt(p!)
    const m = computeMargin({ price: p!, fee: (p! * fee.pct) / 100 + fee.fixed, shipping: 0, taxPct: 10, cost: 30, fixedCost: 2, extraPct: 0 })
    expect(m.marginPct!).toBeGreaterThanOrEqual(9.9)
    expect(m.marginPct!).toBeLessThan(10.2)
    expect(await refinePrice(10, model, async () => null)).toBeNull()
  })
})

describe('regras de alteração', () => {
  it('valor, + e − %', () => {
    expect(applyPriceRule(100, { mode: 'valor', value: 120.456 })).toBe(120.46)
    expect(applyPriceRule(100, { mode: 'percentual', value: 10 })).toBe(110)
    expect(applyPriceRule(100, { mode: 'percentual', value: -15 })).toBe(85)
    expect(applyPriceRule(100, { mode: 'percentual', value: -100 })).toBeNull()
  })

  it('preço promocional', () => {
    expect(promoDealPrice(200, { mode: 'percentual', value: 10 })).toBe(180)
    expect(promoDealPrice(200, { mode: 'preco', value: 150 })).toBe(150)
  })

  it('desconto individual: 5% a menos de 80%, até 14 dias, a partir de hoje', () => {
    const ok = { price: 100, dealPrice: 90, start: '2026-11-11', finish: '2026-11-20', today: '2026-11-11' }
    expect(validatePromo(ok)).toBeNull()
    expect(validatePromo({ ...ok, dealPrice: 96 })).toMatch(/5%/)
    expect(validatePromo({ ...ok, dealPrice: 20 })).toMatch(/80%/)
    expect(validatePromo({ ...ok, finish: '2026-11-30' })).toMatch(/14 dias/)
    expect(validatePromo({ ...ok, start: '2026-11-10' })).toMatch(/antes de hoje/)
    expect(validatePromo({ ...ok, dealPrice: 100 })).toMatch(/menor/)
  })
})

describe('cupom do vendedor', () => {
  const pct = { name: 'Black', subType: 'FIXED_PERCENTAGE' as const, fixedPercentage: 10, minPurchaseAmount: 100, maxPurchaseAmount: 50, budget: 1000, start: '2026-11-12', finish: '2026-11-30', code: 'BLACK10' }
  const fixed = { name: 'Dez', subType: 'FIXED_AMOUNT' as const, fixedAmount: 10, minPurchaseAmount: 100, budget: 500, start: '2026-11-12', finish: '2026-11-20' }
  it('valida as regras da documentação', () => {
    expect(validateCoupon(pct, '2026-11-11')).toBeNull()
    expect(validateCoupon(fixed, '2026-11-11')).toBeNull()
    expect(validateCoupon({ ...pct, finish: '2026-12-31' }, '2026-11-11')).toMatch(/31 dias/)
    expect(validateCoupon({ ...pct, fixedPercentage: 4 }, '2026-11-11')).toMatch(/5%/)
    expect(validateCoupon({ ...pct, budget: 40 }, '2026-11-11')).toMatch(/orçamento/)
    expect(validateCoupon({ ...fixed, fixedAmount: 100 }, '2026-11-11')).toMatch(/menor que o valor mínimo/)
    expect(validateCoupon({ ...pct, code: 'com espaço' }, '2026-11-11')).toMatch(/código/)
    expect(validateCoupon({ ...pct, finish: pct.start }, '2026-11-11')).toMatch(/1 dia/)
  })

  it('corpo da chamada só com os campos do subtipo', () => {
    const b = couponBody(pct)
    expect(b).toMatchObject({ promotion_type: 'SELLER_COUPON_CAMPAIGN', sub_type: 'FIXED_PERCENTAGE', fixed_percentage: 10, max_purchase_amount: 50, partial_coupon_code: 'BLACK10', start_date: '2026-11-12T00:00:00' })
    expect(b).not.toHaveProperty('fixed_amount')
    expect(couponBody(fixed)).not.toHaveProperty('partial_coupon_code')
  })

  it('preço por unidade com o cupom (pior caso)', () => {
    expect(couponUnitPrice(200, pct)).toBe(180)
    expect(couponUnitPrice(900, pct)).toBe(850)
    expect(couponUnitPrice(50, pct)).toBeNull()
    expect(couponUnitPrice(150, fixed)).toBe(140)
  })
})

describe('tarifa e envio', () => {
  it('lê listing_prices (lista ou lista de listas)', () => {
    const raw = [[{ listing_type_id: 'gold_special', sale_fee_amount: 13.5, sale_fee_details: { percentage_fee: 13.5, fixed_fee: 0 } }, { listing_type_id: 'gold_pro', sale_fee_amount: 18.5, sale_fee_details: { percentage_fee: 18.5, fixed_fee: 0 } }]]
    expect(feeFromRow(pickListingPrice(raw, 'gold_pro'))).toEqual({ amount: 18.5, model: { pct: 18.5, fixed: 0 } })
    expect(feeFromRow(pickListingPrice(raw, 'free'))).toBeNull()
  })

  it('repete só em 429 e erro do servidor, até 3 vezes', () => {
    expect(sendRetryDelay(429, 0)).toBe(2000)
    expect(sendRetryDelay(503, 2)).toBe(12000)
    expect(sendRetryDelay(503, 3)).toBeNull()
    expect(sendRetryDelay(400, 0)).toBeNull()
  })

  it('mensagem do Mercado Livre em português', () => {
    expect(mlMessagePt('O Mercado Livre respondeu 400: item.price.not_modifiable: Cannot modify price on items with dynamic pricing')).toMatch(/automatização de preços/)
    expect(mlMessagePt('error_credibility_price: The price is not credible.')).toMatch(/crível/)
    expect(mlMessagePt('algo novo')).toBe('algo novo')
  })

  it('configuração limpa', () => {
    const c = cleanPrecosConfig({ taxPct: '12,5', minMarginPct: 8, targetMarginPct: '', extraFeePct: 300, fixedCostPerSale: -3 })
    expect(c).toMatchObject({ taxPct: 12.5, minMarginPct: 8, targetMarginPct: null, extraFeePct: 95, fixedCostPerSale: 0, useNfeTaxes: true })
  })
})

describe('dicas', () => {
  const margin = computeMargin({ price: 100, ...base })
  const t: TipInput = {
    status: 'active',
    availableQuantity: 3,
    margin,
    minMarginPct: 20,
    targetMarginPct: 25,
    suggestedPrice: 120,
    minPrice: 80,
    regularPrice: 100,
    promoPrice: null,
    regularMarginPct: null,
    competitorMin: null,
    competitorCount: 0,
    listingTypeId: 'gold_special',
    otherFee: null,
    freeShipping: true,
    mandatoryFreeShipping: false,
    sales30: 1,
    sales60: 2,
    taxSource: 'sku',
  }
  it('margem abaixo do mínimo sugere o preço', () => {
    const tips = pricingTips(t)
    expect(tips[0]!.code).toBe('margem_baixa')
    expect(tips[0]!.text).toContain('R$ 120,00')
  })
  it('sem custo, concorrente, pausado, sem vendas, Premium', () => {
    const codes = (x: Partial<TipInput>) => pricingTips({ ...t, ...x }).map((i) => i.code)
    expect(codes({ margin: computeMargin({ price: 100, ...base, cost: null }) })).toContain('sem_custo')
    expect(codes({ competitorMin: 70, competitorCount: 2 })).toContain('concorrente')
    expect(pricingTips({ ...t, competitorMin: 70 }).find((i) => i.code === 'concorrente')!.text).toMatch(/preço mínimo/)
    // Lucro esperado do produto (planilha): abaixo dele é alerta
    const low = pricingTips({ ...t, profitTarget: 1000 }).find((i) => i.code === 'lucro_abaixo')
    expect(low?.level).toBe('alerta')
    expect(low!.text).toMatch(/abaixo do esperado de R\$\s?1\.000,00/)
    expect(codes({ profitTarget: 0 })).not.toContain('lucro_abaixo')
    expect(codes({ status: 'paused' })).toContain('pausado')
    expect(codes({ sales60: 0, sales30: 0 })).toContain('sem_venda_60')
    expect(codes({ sales60: null, sales30: null })).not.toContain('sem_venda_30')
    expect(codes({ otherFee: { listingTypeId: 'gold_pro', amount: 18, pct: 18 } })).toContain('premium')
    expect(codes({ mandatoryFreeShipping: true, freeShipping: false })).toContain('frete_obrigatorio')
  })
  it('promoção que derruba a margem', () => {
    const tips = pricingTips({ ...t, promoPrice: 90, regularMarginPct: 25 })
    expect(tips[0]!.code).toBe('promocao_margem')
  })
})

const NFE = (carrier: string, items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe42261111222333000181550010000123451000123456" versao="4.00">
<ide><mod>55</mod><tpNF>1</tpNF></ide>
${items}
<transp><modFrete>2</modFrete><transporta><xNome>${carrier}</xNome></transporta></transp>
</infNFe></NFe></nfeProc>`
const DET = (sku: string, ncm: string, vProd: number, icms: number, pis: number, cofins: number, difal = 0) =>
  `<det nItem="1"><prod><cProd>${sku}</cProd><NCM>${ncm}</NCM><vProd>${vProd.toFixed(2)}</vProd></prod><imposto><ICMS><ICMS00><vBC>${vProd}</vBC><vICMS>${icms.toFixed(2)}</vICMS></ICMS00></ICMS><ICMSUFDest><vICMSUFDest>${difal.toFixed(2)}</vICMSUFDest></ICMSUFDest><PIS><PISAliq><vPIS>${pis.toFixed(2)}</vPIS></PISAliq></PIS><COFINS><COFINSAliq><vCOFINS>${cofins.toFixed(2)}</vCOFINS></COFINSAliq></COFINS></imposto></det>`

describe('impostos pelas NF-e do Mercado Envios', () => {
  it('lê os impostos por item', () => {
    const n = parseNfeTaxes(NFE('MERCADO ENVIOS SERVICOS DE LOGISTICA LTDA', DET(' abc-1 ', '84212300', 100, 12, 1.65, 7.6, 5) + DET('XYZ', '40169300', 50, 6, 0.83, 3.8)))
    expect(n.items).toHaveLength(2)
    expect(n.items[0]).toEqual({ sku: 'ABC-1', ncm: '84212300', value: 100, tax: 26.25, ipi: 0 })
    expect(n.productsValue).toBe(150)
    expect(() => parseNfeTaxes('<x/>')).toThrow()
  })

  it('reconhece o Mercado Envios pelo nome (sem acento/caixa) ou CNPJ conhecido', () => {
    expect(isMercadoEnvios('Mercado Envios Serviços de Logística', null)).toBe(true)
    expect(isMercadoEnvios('MERCADOENVIOS', null)).toBe(true)
    expect(isMercadoEnvios('TRANSPORTES EXEMPLO', '11111111000111', ['11111111000111'])).toBe(true)
    expect(isMercadoEnvios('TRANSPORTES EXEMPLO', '22222222000122', ['11111111000111'])).toBe(false)
  })

  it('média ponderada por SKU, NCM e geral; escolha SKU → NCM → geral → manual', () => {
    const r = aggregateTaxRates([
      { key: 'a', items: [{ sku: 'ABC', ncm: '84212300', value: 100, tax: 20 }, { sku: 'XYZ', ncm: '40169300', value: 100, tax: 10 }] },
      { key: 'b', items: [{ sku: 'ABC', ncm: '84212300', value: 300, tax: 30 }] },
    ])
    expect(r.notes).toBe(2)
    expect(r.bySku.ABC).toEqual({ pct: 12.5, notes: 2 })
    expect(r.overall!.pct).toBe(12)
    expect(taxRateFor('abc', null, r, 5)).toMatchObject({ pct: 12.5, source: 'sku' })
    expect(taxRateFor('NOVO', '40169300', r, 5)).toMatchObject({ pct: 10, source: 'ncm' })
    expect(taxRateFor('NOVO', null, r, 5)).toMatchObject({ pct: 12, source: 'geral' })
    expect(taxRateFor('NOVO', null, null, 5)).toMatchObject({ pct: 5, source: 'manual' })
    expect(taxRateFor('ABC', null, r, 5, false)).toMatchObject({ source: 'manual' })
    expect(taxRateFor('NOVO', null, null, null)).toMatchObject({ pct: null, source: null })
  })

  it('módulo de permissão novo', () => {
    expect(MODULE_KEYS).toContain('marketplace_precos')
  })
})

describe('formas de cálculo da margem', () => {
  it('custo, custo + imposto e ao final de todos os custos', async () => {
    const { priceForMargin, marginPctOf } = await import('../src/marketplaces/precos/margem')
    const m = { fee: { pct: 17, fixed: 0 }, shipping: 27.05, taxPct: 30, extraPct: 0, cost: 86, fixedCost: 0 }
    // Custo 86 + 45% = 124,70; + frete 27,05; ÷ (1 − 47% de tarifa e imposto) = 286,33 (arredonda para cima)
    expect(priceForMargin(45, { ...m, marginMode: 'CUSTO' })).toBe(286.33)
    expect(priceForMargin(45, { ...m, marginMode: 'CUSTO_IMPOSTO' })).toBeGreaterThan(286.33)
    expect(priceForMargin(45, { ...m, marginMode: 'PRECO' })).toBe(1413.13)
    expect(marginPctOf(38.7, 286.32, 86, 85.9, 'CUSTO')).toBe(45)
    expect(marginPctOf(10, 100, 50, 10, 'PRECO')).toBe(10)
  })
})

describe('lucro por produto', () => {
  it('preço que deixa o lucro em R$ e de onde vem o lucro', async () => {
    const { priceForProfit, profitTargetOf } = await import('../src/marketplaces/precos/margem')
    const m = { fee: { pct: 17, fixed: 0 }, shipping: 27.05, taxPct: 24.4, extraPct: 0, cost: 48.7, fixedCost: 0 }
    const p = priceForProfit(93.99, m)!
    const left = p - p * 0.17 - p * 0.244 - 27.05 - 48.7
    expect(Math.abs(left - 93.99)).toBeLessThan(0.02)
    expect(profitTargetOf({ profitValue: 93.99, profitPct: null }, 48.7, 181)).toEqual({ value: 93.99, source: 'produto' })
    expect(profitTargetOf({ profitValue: null, profitPct: 50 }, 48.7, null)).toEqual({ value: 24.35, source: 'produto_pct' })
    expect(profitTargetOf(null, 48.7, 181)).toEqual({ value: 132.3, source: 'erp' })
    // Como o Tcar (030592): venda 224,56 − custo 86,37 − 27,03% de impostos = 77,49
    expect(profitTargetOf(null, 86.37, 224.56, 27.03)).toEqual({ value: 77.49, source: 'erp' })
    // Com o IPI de 3,25% (líquido 231,86) e 26,18% de impostos sobre o líquido: 84,78, igual ao Tcar
    expect(profitTargetOf(null, 86.37, 224.56, 26.18, 3.25)).toEqual({ value: 84.79, source: 'erp' })
    expect(profitTargetOf(null, null, 181)).toBeNull()
  })
})

describe('IPI aprendido das notas', () => {
  it('guarda o IPI do item e calcula o % sobre o valor sem IPI', () => {
    const r = aggregateTaxRates([{ key: 'n1', items: [{ sku: '030592', ncm: null, value: 231.86, tax: 60.71, ipi: 7.3 }] }, { key: 'n0', items: [{ sku: 'VELHA', ncm: null, value: 100, tax: 20 }] }])
    expect(r.bySku['030592']).toMatchObject({ pct: 26.18, ipiPct: 3.25 })
    expect(r.bySku['VELHA']!.ipiPct).toBeUndefined()
    expect(taxRateFor('030592', null, r, null)).toMatchObject({ pct: 26.18, ipiPct: 3.25 })
  })
})

describe('venda do Mercado Livre na NF-e', () => {
  it('EBAZAR, Mercado Envios ou "Mercado Livre" na observação', async () => {
    const { isMercadoEnvios, infCplOf, parseNfeTaxes } = await import('../src/marketplaces/precos/impostos')
    expect(isMercadoEnvios('EBAZAR.COM.BR. LTDA', null)).toBe(true)
    expect(isMercadoEnvios('Transportadora X', null, [], 'Pedido 123 - Venda MERCADO LIVRE')).toBe(true)
    expect(isMercadoEnvios('Transportadora X', null, [], 'Venda balcão')).toBe(false)
    expect(infCplOf('<infAdic><infCpl>Mercado Livre pedido 9</infCpl></infAdic>')).toBe('Mercado Livre pedido 9')
    const xml = '<nfeProc><NFe><infNFe><det nItem="1"><prod><cProd>030592</cProd><NCM>40093100</NCM><vProd>224.56</vProd></prod><imposto><ICMS><ICMS00><vICMS>40.00</vICMS></ICMS00></ICMS><IPI><IPITrib><vIPI>7.30</vIPI></IPITrib></IPI></imposto></det></infNFe></NFe></nfeProc>'
    const t = parseNfeTaxes(xml)
    expect(t.items[0]).toMatchObject({ sku: '030592', value: 231.86, tax: 47.3 })
  })
})

describe('preço com centavos ,90', () => {
  it('arredonda sempre para cima até ,90', async () => {
    const { roundTo90 } = await import('../src/marketplaces/precos/margem')
    expect(roundTo90(102.35)).toBe(102.9)
    expect(roundTo90(102.9)).toBe(102.9)
    expect(roundTo90(102.95)).toBe(103.9)
    expect(roundTo90(31.29)).toBe(31.9)
    expect(roundTo90(100)).toBe(100.9)
    expect(roundTo90(null)).toBeNull()
  })
})

describe('preço sugerido pelo depósito do Mercado Livre', () => {
  it('o Mercado Livre deposita o preço de venda do ERP', async () => {
    const { priceForDeposit, roundTo90 } = await import('../src/marketplaces/precos/margem')
    // SKU 041073: valor líquido 9,19, tarifa 17%, frete 13,85 → 27,759... → 27,90
    const p = priceForDeposit(9.19, { fee: { pct: 17, fixed: 0 }, shipping: 13.85, extraPct: 0, fixedCost: 0 })!
    expect(p).toBeCloseTo(27.76, 2)
    expect(roundTo90(p)).toBe(27.9)
    expect(Math.abs(p - p * 0.17 - 13.85 - 9.19)).toBeLessThan(0.01)
    // Custo fixo, parte fixa da tarifa e outras taxas entram; percentuais demais = impossível
    expect(priceForDeposit(10, { fee: { pct: 10, fixed: 2 }, shipping: 0, extraPct: 10, fixedCost: 4 })).toBe(20)
    expect(priceForDeposit(10, { fee: { pct: 60, fixed: 0 }, shipping: 0, extraPct: 40, fixedCost: 0 })).toBeNull()
  })

  it('dica quando o depósito fica abaixo do preço de venda', () => {
    const margin = computeMargin({ price: 20, fee: 3.4, shipping: 13.85, taxPct: 10, cost: 5, fixedCost: 0, extraPct: 0 })
    const t: TipInput = { status: 'active', availableQuantity: 1, margin, minMarginPct: -50, targetMarginPct: null, suggestedPrice: 27.9, minPrice: null, regularPrice: 20, promoPrice: null, regularMarginPct: null, competitorMin: null, competitorCount: 0, listingTypeId: 'gold_special', otherFee: null, freeShipping: true, mandatoryFreeShipping: false, sales30: 1, sales60: 1, taxSource: 'sku' }
    const tip = pricingTips({ ...t, depositTarget: 9.19, profitTarget: 1000 })
    const d = tip.find((i) => i.code === 'deposito_abaixo')
    expect(d?.level).toBe('alerta')
    expect(d!.text).toMatch(/deposita R\$\s?2,75, abaixo do preço de venda de R\$\s?9,19\. Suba o preço para R\$\s?27,90\./)
    expect(tip.map((i) => i.code)).not.toContain('lucro_abaixo')
    expect(pricingTips({ ...t, depositTarget: 2.75 }).map((i) => i.code)).not.toContain('deposito_abaixo')
  })

  it('configuração da base do preço sugerido', () => {
    expect(cleanPrecosConfig({}).suggestBase).toBe('LUCRO')
    expect(cleanPrecosConfig({ suggestBase: 'DEPOSITO' }).suggestBase).toBe('DEPOSITO')
    expect(cleanPrecosConfig({ suggestBase: 'outro' }).suggestBase).toBe('LUCRO')
    expect(cleanPrecosConfig({ taxPct: 5 }, { ...cleanPrecosConfig({}), suggestBase: 'DEPOSITO' }).suggestBase).toBe('DEPOSITO')
  })
})
