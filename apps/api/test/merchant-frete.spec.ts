import { describe, expect, it } from 'vitest'
import {
  cepKeyError,
  cepsOf,
  cleanConfig,
  CEP_KEYS,
  MAX_SHIPPING_ENTRIES,
  mergeIntervals,
  prefixInterval,
  REGION_BY_KEY,
  regionIdOf,
  regionOfCep,
  REGIONS,
  REGIONS_VERSION,
  regionsReady,
  stateIntervals,
  subtractIntervals,
  toPostalCodes,
  UF_CAPITAL_RANGES,
  UF_INT_REF_CEP,
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
  simulationSku,
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
    expect(ufQuote('SC-INT', [[{ price: 30, days: 5 }, { price: 25, days: 8 }], [{ price: 40, days: 9 }]])).toEqual({ region: 'SC-INT', uf: 'SC', price: 40, days: 9 })
    expect(ufQuote('AC-CAP', [[{ price: 30, days: 5 }], []])).toEqual({ region: 'AC-CAP', uf: 'AC', price: null, days: null })
    expect(ufQuote('DF', [])).toEqual({ region: 'DF', uf: 'DF', price: null, days: null })
  })

  it('atributo shipping por região, em micros', () => {
    const s = shippingAttribute([{ region: 'SC-CAP', uf: 'SC', price: 39.9, days: 4 }, { region: 'AC-INT', uf: 'AC', price: null, days: null }], { service: 'Entrega', handlingMin: 1, handlingMax: 2 })
    expect(s).toEqual([{ price: { amountMicros: '39900000', currencyCode: 'BRL' }, country: 'BR', region: 'crm-uf-sc-cap', service: 'Entrega', minHandlingTime: '1', maxHandlingTime: '2', minTransitTime: '4', maxTransitTime: '4' }])
    // Frete guardado antes das regiões novas (sem region): o estado inteiro.
    expect(shippingAttribute([{ uf: 'SC', price: 10, days: null }], { service: 'Entrega', handlingMin: 1, handlingMax: 2 })[0]!.region).toBe(regionId('SC'))
    // Todas as regiões cabem no limite do Google (até 100 atributos shipping por produto).
    const all = shippingAttribute(REGIONS.map((r) => ({ region: r.key, uf: r.uf, price: 10, days: 3 })), { service: 'Entrega', handlingMin: 1, handlingMax: 2 })
    expect(all).toHaveLength(53)
    expect(all.length).toBeLessThanOrEqual(MAX_SHIPPING_ENTRIES)
    expect(new Set(all.map((x) => x.region)).size).toBe(53)
    expect(all.map((x) => x.region)).toContain('crm-uf-df')
    expect(all.map((x) => x.region)).toContain('crm-uf-sp-int')
  })

  it('CEPs do estado e validação da configuração', () => {
    expect(cepsOf({ ceps: {} }, 'SC-CAP')).toEqual(['88010000'])
    expect(cepsOf({ ceps: {} }, 'SC-INT')).toEqual([UF_INT_REF_CEP.SC])
    expect(cepsOf({ ceps: {} }, 'DF')).toEqual([UF_REF_CEP.DF])
    // "SC" (antigo) vale para capital e interior; "SC-CAP"/"SC-INT" têm preferência na sua região.
    expect(cepsOf({ ceps: { SC: ['89874-000', 'x'] } }, 'SC-CAP')).toEqual(['89874000'])
    expect(cepsOf({ ceps: { SC: ['89874-000', 'x'] } }, 'SC-INT')).toEqual(['89874000'])
    expect(cepsOf({ ceps: { SC: ['89874000'], 'SC-CAP': ['88015-100'] } }, 'SC-CAP')).toEqual(['88015100'])
    expect(cepsOf({ ceps: { SC: ['89874000'], 'SC-CAP': ['88015-100'] } }, 'SC-INT')).toEqual(['89874000'])
    expect(cepsOf({ ceps: { 'SC-INT': ['89201090', '89874000'] } }, 'SC-CAP')).toEqual(['88010000'])
    expect(cepsOf({ ceps: { 'SC-INT': ['89201090', '89874000'] } }, 'SC-INT')).toEqual(['89201090', '89874000'])
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
    // Capital e interior de 26 estados e o DF: 53 simulações por produto.
    expect(estimateRun({ ceps: {}, batchSize: 100, magazordPerMinute: 60, source: 'magazord' })).toEqual({ calls: 53, products: 100, minutes: Math.ceil((100 * 1_100 + 100 * 53 * 1_000) / 60_000) })
    // Magazord a ~20 por minuto: 53 simulações levam uns 3 minutos por produto.
    expect(estimateRun({ ceps: {}, batchSize: 10, magazordPerMinute: 20, source: 'magazord' }).minutes).toBe(Math.ceil((10 * 1_100 + 10 * 53 * 3_000) / 60_000))
    // SC antigo com 2 CEPs vale para as duas regiões, mas cada CEP é consultado uma vez: 53 - 2 + 2.
    expect(estimateRun({ ceps: { SC: ['88010000', '89874000'] }, batchSize: 100, magazordPerMinute: 60, source: 'magazord' }, 10).calls).toBe(53)
    expect(estimateRun({ ceps: { 'SC-INT': ['89201090', '89874000'] }, batchSize: 100, magazordPerMinute: 60, source: 'magazord' }, 10).calls).toBe(54)
    expect(estimateRun({ ceps: {}, batchSize: 100, magazordPerMinute: 60, source: 'crm' }, 10).calls).toBe(53)
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
    // Dois CEPs na região: a mais barata de cada, e a maior entre os CEPs.
    expect(ufQuote('SC-INT', [crmOptions(results, ['a', 'b']), crmOptions(results)])).toEqual({ region: 'SC-INT', uf: 'SC', price: 55.56, days: 9 })
  })
})

describe('simulação de frete da Magazord: código do produto', () => {
  it('manda o código (não o id interno)', () => {
    const by = new Map([['5435', { code: '044124' }]])
    expect(simulationSku('5435', by)).toBe('044124')
    expect(simulationSku('999', by)).toBe('999')
  })
})

describe('retirada na loja fora do frete do Google', () => {
  it('reconhece as opções de retirada', async () => {
    const { isPickup } = await import('../src/merchant/frete-google')
    expect(isPickup('Retirar na Loja em Maravilha/SC')).toBe(true)
    expect(isPickup('Retirada no balcão')).toBe(true)
    expect(isPickup('Total Express')).toBe(false)
    expect(isPickup('Jadlog.Package')).toBe(false)
  })
})

describe('regiões de capital e interior', () => {
  const covered = (list: [number, number][]) => list.reduce((n, [a, b]) => n + b - a + 1, 0)

  it('53 regiões com ids crm-uf-xx-cap / crm-uf-xx-int e o DF inteiro', () => {
    expect(REGIONS).toHaveLength(53)
    expect(REGION_BY_KEY.get('SC-CAP')!.id).toBe('crm-uf-sc-cap')
    expect(REGION_BY_KEY.get('SC-INT')!.id).toBe('crm-uf-sc-int')
    expect(REGION_BY_KEY.get('DF')!.id).toBe('crm-uf-df')
    expect(regionIdOf('DF')).toBe(regionId('DF'))
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(53)
    expect(CEP_KEYS).toContain('SC')
    expect(CEP_KEYS).toContain('SC-CAP')
    expect(CEP_KEYS).not.toContain('DF-CAP')
  })

  it('capital + interior = o estado inteiro, sem sobrepor, e os estados não se sobrepõem', () => {
    const all: [number, number][] = []
    for (const uf of UFS) {
      const state = stateIntervals(uf)
      const parts = REGIONS.filter((r) => r.uf === uf)
      const cap = parts.find((r) => r.zone === 'CAP')
      const int = parts.find((r) => r.zone === 'INT')
      if (uf === 'DF') {
        expect(parts.map((r) => r.key)).toEqual(['DF'])
        expect(parts[0]!.intervals).toEqual(state)
      } else {
        expect(cap && int, uf).toBeTruthy()
        // A capital fica dentro do estado.
        expect(subtractIntervals(cap!.intervals, state), uf).toEqual([])
        // Sem sobrepor: a capital tirada do interior não muda nada.
        expect(subtractIntervals(int!.intervals, cap!.intervals), uf).toEqual(int!.intervals)
        // Juntas cobrem o estado inteiro.
        expect(mergeIntervals([...cap!.intervals, ...int!.intervals]), uf).toEqual(state)
        expect(covered(cap!.intervals) + covered(int!.intervals), uf).toBe(covered(state))
      }
      all.push(...state)
    }
    // Os estados não se sobrepõem e cobrem 01000–99999 (menos 789xx, sem estado).
    expect(covered(all)).toBe(covered(mergeIntervals(all)))
    expect(mergeIntervals(all)).toEqual([[1000, 78899], [79000, 99999]])
  })

  it('cada CEP de referência cai na sua região', () => {
    for (const r of REGIONS) expect(regionOfCep(r.refCep)?.key, `${r.key} ${r.refCep}`).toBe(r.key)
    for (const uf of Object.keys(UF_CAPITAL_RANGES) as (keyof typeof UF_CAPITAL_RANGES)[]) expect(UF_INT_REF_CEP[uf], uf).toMatch(/^\d{8}$/)
  })

  it('faixas em prefixos do Merchant Center (início e fim do mesmo tamanho)', () => {
    expect(prefixInterval('01*', '19*')).toEqual([1000, 19999])
    expect(prefixInterval('680*', '688*')).toEqual([68000, 68899])
    expect(toPostalCodes([[6000, 7999], [8500, 19999], [68915, 68999]])).toEqual([
      { begin: '06*', end: '07*' },
      { begin: '085*', end: '199*' },
      { begin: '68915*', end: '68999*' },
    ])
    expect(toPostalCodes(REGION_BY_KEY.get('SP-INT')!.intervals)).toEqual([
      { begin: '06*', end: '07*' },
      { begin: '085*', end: '199*' },
    ])
    expect(toPostalCodes(REGION_BY_KEY.get('SC-CAP')!.intervals)).toEqual([{ begin: '880*', end: '880*' }])
    for (const r of REGIONS) for (const p of toPostalCodes(r.intervals)) expect(p.begin.length, r.key).toBe(p.end.length)
  })

  it('CEPs da capital só em -CAP e do interior só em -INT', () => {
    expect(regionOfCep('88010-000')?.key).toBe('SC-CAP')
    expect(regionOfCep('89874-000')?.key).toBe('SC-INT')
    expect(regionOfCep('70040-010')?.key).toBe('DF')
    // Natal vai até 59139 (zona norte); 59141 é Parnamirim. Distritos rurais de Porto Velho ficam no interior.
    expect(regionOfCep('59139000')?.key).toBe('RN-CAP')
    expect(regionOfCep('59141000')?.key).toBe('RN-INT')
    expect(regionOfCep('76840000')?.key).toBe('RO-INT')
    expect(cepKeyError('SC-CAP', '88010000')).toBeNull()
    expect(cepKeyError('SC-INT', '89874000')).toBeNull()
    expect(cepKeyError('SC-CAP', '89874000')).toMatch(/SC-INT/)
    expect(cepKeyError('SC-INT', '88010000')).toMatch(/SC-CAP/)
    expect(cepKeyError('SC-INT', '80010000')).toMatch(/faixas de CEP de SC/)
    expect(cepKeyError('DF-CAP', '70040010')).toMatch(/inválida/)
    const base = { ...DEFAULT_MERCHANT_FRETE, merchantId: '123' }
    expect(cleanConfig({ ceps: { 'SC-CAP': ['89874-000'] } }, base)).toEqual({ error: expect.stringMatching(/não é da capital/) })
    expect(cleanConfig({ ceps: { 'SC-INT': ['88010-000'] } }, base)).toEqual({ error: expect.stringMatching(/é da capital/) })
    // Chave antiga (estado) continua aceita, com qualquer CEP; chave desconhecida é ignorada.
    expect(cleanConfig({ ceps: { SC: ['88010-000'], 'SC-INT': ['89874-000'], XX: ['01001000'] } }, base)).toMatchObject({ ceps: { SC: ['88010000'], 'SC-INT': ['89874000'] } })
    expect(cleanConfig({ ceps: { 'sc-cap': ['88010-000'] } as never }, base)).toMatchObject({ ceps: {} })
  })

  it('conta preparada com as regiões antigas pede o Preparar a conta de novo', () => {
    expect(regionsReady({ dataSource: 'ds', regionsVersion: REGIONS_VERSION })).toBe(true)
    expect(regionsReady({ dataSource: 'ds', regionsVersion: undefined })).toBe(false)
    expect(regionsReady({ dataSource: null, regionsVersion: REGIONS_VERSION })).toBe(false)
    const base = { ...DEFAULT_MERCHANT_FRETE, merchantId: '123', dataSource: 'ds', regionsVersion: REGIONS_VERSION }
    expect(cleanConfig({}, base)).toMatchObject({ regionsVersion: REGIONS_VERSION })
    expect(cleanConfig({ merchantId: '999' }, base)).toMatchObject({ regionsVersion: null, dataSource: null })
    // Regiões novas refazem todos os produtos (impressão digital muda com a versão).
    expect(fingerprint({ source: 'magazord', price: 10, weight: null, ceps: {} })).toContain(`r${REGIONS_VERSION}`)
  })
})
