import { describe, expect, it } from 'vitest'
import {
  cepsOf,
  cleanConfig,
  crmOptions,
  DEFAULT_MERCHANT_FRETE,
  estimateRun,
  fingerprint,
  gapOf,
  isDue,
  matchSku,
  Pacer,
  parseRate,
  regionId,
  retryWait,
  shippingAttribute,
  storedFp,
  storedUfs,
  tcarWeightFor,
  UF_CEP_RANGES,
  UF_REF_CEP,
  UFS,
  ufQuote,
  weightIndex,
} from '../src/merchant/frete-google'

describe('frete no Google Shopping', () => {
  it('cada estado tem faixas de CEP válidas e o CEP de referência cai numa delas', () => {
    for (const uf of UFS) {
      const ranges = UF_CEP_RANGES[uf]
      expect(ranges.length, uf).toBeGreaterThan(0)
      for (const [b, e] of ranges) expect(b.length, uf).toBe(e.length)
      const cep = UF_REF_CEP[uf]
      const inside = ranges.some(([b, e]) => {
        const n = b.length - 1
        const p = cep.slice(0, n)
        return p >= b.slice(0, n) && p <= e.slice(0, n)
      })
      expect(inside, `${uf} ${cep}`).toBe(true)
    }
  })

  it('frete do estado: a opção mais barata de cada CEP, e a maior entre os CEPs', () => {
    expect(ufQuote('SC', [[{ price: 30, days: 5 }, { price: 25, days: 8 }], [{ price: 40, days: 9 }]])).toEqual({ uf: 'SC', price: 40, days: 9 })
    expect(ufQuote('AC', [[{ price: 30, days: 5 }], []])).toEqual({ uf: 'AC', price: null, days: null })
  })

  it('atributo shipping por região, em micros', () => {
    const s = shippingAttribute([{ uf: 'SC', price: 39.9, days: 4 }, { uf: 'AC', price: null, days: null }], { service: 'Entrega', handlingMin: 1, handlingMax: 2 })
    expect(s).toEqual([{ price: { amountMicros: '39900000', currencyCode: 'BRL' }, country: 'BR', region: regionId('SC'), service: 'Entrega', minHandlingTime: '1', maxHandlingTime: '2', minTransitTime: '4', maxTransitTime: '4' }])
  })

  it('CEPs do estado e validação da configuração', () => {
    expect(cepsOf({ ceps: {} }, 'SC')).toEqual(['88010000'])
    expect(cepsOf({ ceps: { SC: ['89874-000', 'x'] } }, 'SC')).toEqual(['89874000'])
    expect(cleanConfig({ enabled: true }, DEFAULT_MERCHANT_FRETE)).toEqual({ error: 'Informe o número da conta do Merchant Center.' })
    expect(cleanConfig({ handlingMin: 3, handlingMax: 1 }, DEFAULT_MERCHANT_FRETE)).toMatchObject({ error: expect.stringMatching(/manuseio/) })
  })

  it('liga o produto do Google ao SKU da Magazord pelo id ou pelo endereço', () => {
    const store = [{ externalId: 'ABC-1', code: '1001', path: '/filtro-de-ar', url: null }, { externalId: 'XYZ', code: '2002', path: null, url: 'https://loja.com.br/kit-filtro' }]
    expect(matchSku({ offerId: 'abc-1' }, store)).toBe('ABC-1')
    expect(matchSku({ offerId: '1001' }, store)).toBe('ABC-1')
    expect(matchSku({ offerId: 'zz', link: 'https://loja.com.br/kit-filtro/' }, store)).toBe('XYZ')
    expect(matchSku({ offerId: 'zz', link: 'https://loja.com.br/outro' }, store)).toBeNull()
  })

  it('configuração da fonte do frete e do ritmo', () => {
    const base = { ...DEFAULT_MERCHANT_FRETE, merchantId: '123' }
    expect(cleanConfig({}, base)).toMatchObject({ source: 'magazord', magazordPerMinute: 40, refreshDays: 7, carrierIds: [] })
    expect(cleanConfig({ source: 'crm' }, base)).toEqual({ error: expect.stringMatching(/filial/) })
    const unit = '0b6e2c1a-1111-4222-8333-444455556666'
    expect(cleanConfig({ source: 'crm', unitId: unit, carrierIds: [unit, unit] }, base)).toMatchObject({ source: 'crm', unitId: unit, carrierIds: [unit] })
    expect(cleanConfig({ source: 'outra' as never }, base)).toEqual({ error: 'Fonte do frete inválida.' })
    expect(cleanConfig({ carrierIds: ['x'] }, base)).toEqual({ error: 'Transportadoras inválidas.' })
    expect(cleanConfig({ magazordPerMinute: 500 }, base)).toMatchObject({ error: expect.stringMatching(/por minuto/) })
    expect(cleanConfig({ refreshDays: 0 }, base)).toMatchObject({ error: expect.stringMatching(/dias/) })
    // Configuração antiga (sem os campos novos) continua valendo.
    const old = { ...base } as Partial<typeof base>
    delete old.source
    delete old.magazordPerMinute
    expect(cleanConfig({}, old as typeof base)).toMatchObject({ source: 'magazord', magazordPerMinute: 40 })
  })

  it('lê os cabeçalhos de limite da Magazord', () => {
    const now = 1_700_000_000_000
    expect(parseRate({ retryAfter: '12' }, now)).toEqual({ retryAfterMs: 12_000, remaining: null, resetMs: null })
    expect(parseRate({ retryAfter: new Date(now + 30_000).toUTCString() }, now).retryAfterMs).toBe(30_000)
    expect(parseRate({ remaining: '0', reset: '20' }, now)).toEqual({ retryAfterMs: null, remaining: 0, resetMs: 20_000 })
    expect(parseRate({ remaining: '4', reset: String(now / 1000 + 45) }, now)).toEqual({ retryAfterMs: null, remaining: 4, resetMs: 45_000 })
    expect(parseRate({}, now)).toEqual({ retryAfterMs: null, remaining: null, resetMs: null })
  })

  it('429: espera 5, 15, 30 e 60 s (ou o Retry-After) e depois desiste do produto', () => {
    const none = { retryAfterMs: null }
    expect([0, 1, 2, 3].map((a) => retryWait(a, none))).toEqual([5_000, 15_000, 30_000, 60_000])
    expect(retryWait(4, none)).toBeNull()
    expect(retryWait(0, { retryAfterMs: 40_000 })).toBe(40_000)
    expect(retryWait(1, { retryAfterMs: 999_000 })).toBe(120_000)
    expect(retryWait(4, { retryAfterMs: 1_000 })).toBeNull()
  })

  it('ritmo: intervalo entre chamadas, mais lento depois de 429 e esperando a cota zerada', () => {
    expect(gapOf(40)).toBe(1_500)
    const p = new Pacer(1_000)
    expect(p.take(0)).toBe(0)
    expect(p.take(0)).toBe(1_000)
    expect(p.take(5_000)).toBe(0)
    p.limited()
    expect(p.gap).toBe(1_500)
    for (let i = 0; i < 20; i++) p.limited()
    expect(p.gap).toBe(15_000)
    p.ok({ retryAfterMs: null, remaining: null, resetMs: null }, 10_000)
    expect(p.gap).toBe(14_250)
    const q = new Pacer(1_000)
    q.take(0)
    q.ok({ retryAfterMs: null, remaining: 0, resetMs: 30_000 }, 0)
    expect(q.take(0)).toBe(30_000)
  })

  it('estimativa da rodada', () => {
    expect(estimateRun({ ceps: {}, batchSize: 100, magazordPerMinute: 60, source: 'magazord' })).toEqual({ calls: 27, products: 100, minutes: Math.ceil((100 * 1_100 + 100 * 27 * 1_000) / 60_000) })
    expect(estimateRun({ ceps: { SC: ['88010000', '89874000'] }, batchSize: 100, magazordPerMinute: 60, source: 'magazord' }, 10).calls).toBe(28)
  })

  it('produto sem mudança só volta depois dos dias de refazer', () => {
    const fp = fingerprint({ source: 'magazord', price: 10, weight: null, ceps: {} })
    const now = Date.parse('2026-11-10T12:00:00Z')
    const sent = new Date('2026-11-08T12:00:00Z')
    expect(isDue({ sentAt: null, error: null, quotes: null }, fp, 7, now)).toBe(true)
    expect(isDue({ sentAt: sent, error: 'x', quotes: { ufs: [], fp } }, fp, 7, now)).toBe(true)
    expect(isDue({ sentAt: sent, error: null, quotes: { ufs: [], fp } }, fp, 7, now)).toBe(false)
    expect(isDue({ sentAt: sent, error: null, quotes: { ufs: [], fp } }, fp, 2, now)).toBe(true)
    expect(isDue({ sentAt: sent, error: null, quotes: { ufs: [], fp } }, fingerprint({ source: 'magazord', price: 11, weight: null, ceps: {} }), 7, now)).toBe(true)
    // Formato antigo (só a lista de estados): recalcula uma vez.
    expect(isDue({ sentAt: sent, error: null, quotes: [] }, fp, 7, now)).toBe(true)
    expect(storedUfs([{ uf: 'SC', price: 1, days: 2 }])).toHaveLength(1)
    expect(storedUfs({ ufs: [{ uf: 'SC', price: 1, days: 2 }], fp })).toHaveLength(1)
    expect(storedFp([])).toBeNull()
    // Na fonte CRM, peso e tabelas entram na conta.
    const a = fingerprint({ source: 'crm', price: 10, weight: 2, ceps: {}, unitId: 'u', tables: 't1' })
    expect(fingerprint({ source: 'crm', price: 10, weight: 2.5, ceps: {}, unitId: 'u', tables: 't1' })).not.toBe(a)
    expect(fingerprint({ source: 'crm', price: 10, weight: 2, ceps: {}, unitId: 'u', tables: 't2' })).not.toBe(a)
  })

  it('peso do produto na Tcar pelo código da loja ou pelo SKU', () => {
    const w = weightIndex([
      { code: 'FL-100', grossWeight: 1.25 },
      { code: 'abc-1', grossWeight: 0 },
      { code: 'SKU-9', grossWeight: 3 },
    ])
    expect(tcarWeightFor({ code: 'fl-100', externalId: 'X' }, w)).toBe(1.25)
    expect(tcarWeightFor({ code: 'ABC-1', externalId: 'sku-9' }, w)).toBe(3)
    expect(tcarWeightFor({ code: 'ABC-1', externalId: 'nada' }, w)).toBeNull()
    expect(tcarWeightFor({ code: null, externalId: 'nada' }, w)).toBeNull()
  })

  it('frete pelas tabelas do CRM: a opção mais barata das transportadoras que valem, por estado', () => {
    const results = [
      { status: 'OK', total: 80, deadlineDays: 4, carrierId: 'a' },
      { status: 'OK', total: 55.555, deadlineDays: 6, carrierId: 'b' },
      { status: 'SEM_COBERTURA', total: null, deadlineDays: null, carrierId: 'c' },
      { status: 'OK', total: 30, deadlineDays: 9, carrierId: 'c' },
    ]
    expect(crmOptions(results)[0]).toEqual({ price: 30, days: 9 })
    expect(crmOptions(results, ['a', 'b'])).toEqual([{ price: 55.56, days: 6 }, { price: 80, days: 4 }])
    expect(crmOptions(results, ['z'])).toEqual([])
    // Dois CEPs no estado: a mais barata de cada, e a maior entre os CEPs.
    expect(ufQuote('SC', [crmOptions(results, ['a', 'b']), crmOptions(results)])).toEqual({ uf: 'SC', price: 55.56, days: 9 })
  })
})
