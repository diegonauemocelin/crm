import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPONENTS, DEFAULT_SETTINGS } from '../src/fretes/catalogo'
import { feeComponent } from '../src/fretes/cotacao.service'
import { calculate, measure, type RuleLike } from '../src/fretes/motor'
import { interstateIcms } from '../src/fretes/cep'
import { normalizeDoc, parseFeeSheet, parseFeeText } from '../src/fretes/taxas'

const rule = (values: Record<string, number>): RuleLike => ({ cepStart: null, cepEnd: null, uf: 'SC', city: null, weightMin: 0, weightMax: null, deadlineDays: 1, restricted: false, values })
const match = (r: RuleLike) => ({ rule: r, by: 'UF' as const, exceeded: false, weightLimit: 0 })

describe('fretes: taxas por destinatário (listas da transportadora)', () => {
  it('lê o texto da taxa e completa o documento pelo tipo de pessoa', () => {
    expect(parseFeeText('TAXA TDA: 74.47')).toEqual({ code: 'TDA', fixed: 74.47, percent: null })
    expect(parseFeeText('TAXA TDE 222/20%')).toEqual({ code: 'TDE', fixed: 222, percent: 20 })
    expect(parseFeeText('TAXA TDC 47.39/0%')).toEqual({ code: 'TDC', fixed: 47.39, percent: null })
    expect(parseFeeText('TAXA TVD 579')).toEqual({ code: 'TVD', fixed: 579, percent: null })
    expect(parseFeeText('sem taxa')).toBeNull()
    expect(normalizeDoc(8547009, 'FSICA')).toBe('00008547009')
    expect(normalizeDoc(1704079000102, 'JURIDICA')).toBe('01704079000102')
    expect(normalizeDoc('', 'FSICA')).toBeNull()
  })

  it('lê a aba sem guardar o nome do destinatário', () => {
    const r = parseFeeSheet([
      ['FIS/JUR', 'CNPJ', 'NOME CLIENTE', 'CIDADE CLIENTE', 'UF CLIENTE', 'UNIDADE ATENDE', 'TAXA', 'DATA BLOQUEIO'],
      ['FSICA', 482539950, 'FULANO', 'JOINVILLE', 'SC', 'JOINVILLE', 'TAXA TDE 222/20%', '26/08/2025'],
      ['JURIDICA', 'abc', 'X', 'Y', 'SC', 'Y', 'TAXA TDE 50', null],
    ])!
    expect(r.invalid).toBe(1)
    expect(r.fees).toEqual([{ doc: '00482539950', code: 'TDE', fixed: 222, percent: 20, city: 'JOINVILLE', uf: 'SC', since: new Date('2025-08-26T00:00:00Z') }])
    expect(JSON.stringify(r)).not.toContain('FULANO')
  })

  it('TDE cobra o maior entre o fixo e o % do frete, depois dos componentes da tabela e dentro do ICMS', () => {
    const settings = { ...DEFAULT_SETTINGS, icmsMode: 'SOMADO' as const, icmsRate: 12 }
    const base = calculate(DEFAULT_COMPONENTS, settings, match(rule({ freight: 1500 })), { cargoValue: 0, personType: 'PJ', measures: measure([], 10) })
    const tde = calculate(DEFAULT_COMPONENTS, settings, match(rule({ freight: 1500 })), { cargoValue: 0, personType: 'PJ', measures: measure([], 10), extraComponents: [feeComponent({ code: 'TDE', fixed: 222, percent: 20 })] })
    expect(base.subtotal).toBe(1500)
    expect(tde.components.find((c) => c.code === 'TDE-DEST')!.value).toBe(300)
    expect(tde.subtotal).toBe(1800)
    expect(tde.icms.base).toBe(1800)
    const small = calculate(DEFAULT_COMPONENTS, settings, match(rule({ freight: 100 })), { cargoValue: 0, personType: 'PJ', measures: measure([], 10), extraComponents: [feeComponent({ code: 'TDE', fixed: 222, percent: 20 })] })
    expect(small.components.find((c) => c.code === 'TDE-DEST')!.value).toBe(222)
  })
})

describe('fretes: SVD e ICMS por estado', () => {
  it('sem nota fiscal usa o preço SVD da tabela', () => {
    const r = rule({ freight: 40, freight_kg: 0.9, svd: 47 })
    const s = { ...DEFAULT_SETTINGS, icmsMode: 'NAO_INCIDE' as const }
    expect(calculate(DEFAULT_COMPONENTS, s, match(r), { cargoValue: 0, personType: 'PF', measures: measure([], 10) }).components[0]!.value).toBe(49)
    expect(calculate(DEFAULT_COMPONENTS, s, match(r), { cargoValue: 0, personType: 'PF', measures: measure([], 10), noInvoice: true }).components[0]!.value).toBe(47)
  })

  it('alíquota interna quando origem e destino ficam no mesmo estado', () => {
    const s = { ...DEFAULT_SETTINGS, icmsMode: 'INFORMATIVO' as const, icmsRate: 12, icmsRateIntra: 17 }
    expect(calculate(DEFAULT_COMPONENTS, s, match(rule({ freight: 100 })), { cargoValue: 0, personType: 'PJ', measures: measure([], 1), sameState: true }).icms.rate).toBe(17)
    expect(calculate(DEFAULT_COMPONENTS, s, match(rule({ freight: 100 })), { cargoValue: 0, personType: 'PJ', measures: measure([], 1) }).icms.rate).toBe(12)
  })

  it('reproduz o ICMS do CT-e 1.591.853 da Expresso São Miguel (12% por dentro, total R$ 79,11)', () => {
    const comps = [
      { code: 'FRETE_PESO', name: 'FRETE PESO', formula: '58.81', inTax: true, order: 1, active: true },
      { code: 'FRETE_VALOR', name: 'FRETE VALOR', formula: '$cargo_value$ * ($freight_value$ / 100)', inTax: true, order: 2, active: true },
      { code: 'PEDAGIO', name: 'PEDAGIO', formula: 'ceil($weight$ / 100) * $toll$', inTax: true, order: 3, active: true },
      { code: 'GRIS', name: 'GRIS', formula: 'max($cargo_value$ * ($gris$ / 100), $gris_min$)', inTax: true, order: 4, active: true },
      { code: 'TAS', name: 'TAS', formula: '$tas$', inTax: true, order: 5, active: true },
    ]
    const r = calculate(comps, { ...DEFAULT_SETTINGS, icmsMode: 'SOMADO', icmsRate: 12 }, match(rule({ freight_value: 0.5, toll: 3.79, gris: 0.17, gris_min: 3.79, tas: 3 })), { cargoValue: 45.93, personType: 'PJ', measures: measure([], 0.9) })
    expect(r.components.map((c) => c.value)).toEqual([58.81, 0.23, 3.79, 3.79, 3])
    expect(r.icms.value).toBe(9.49)
    expect(r.total).toBe(79.11)
  })

  it('reproduz o ICMS interno do CT-e 340.989 (Maravilha → Palhoça/SC, 17% por dentro, total R$ 104,55)', () => {
    const comps = [
      { code: 'FRETE_PESO', name: 'FRETE PESO', formula: '74.70', inTax: true, order: 1, active: true },
      { code: 'FRETE_VALOR', name: 'FRETE VALOR', formula: '$cargo_value$ * ($freight_value$ / 100)', inTax: true, order: 2, active: true },
      { code: 'PEDAGIO', name: 'PEDAGIO', formula: 'ceil($weight$ / 100) * $toll$', inTax: true, order: 3, active: true },
      { code: 'GRIS', name: 'GRIS', formula: 'max($cargo_value$ * ($gris$ / 100), $gris_min$)', inTax: true, order: 4, active: true },
      { code: 'TAS', name: 'TAS', formula: '$tas$', inTax: true, order: 5, active: true },
    ]
    const r = calculate(comps, { ...DEFAULT_SETTINGS, icmsMode: 'SOMADO', icmsRate: 12, icmsRateIntra: 17 }, match(rule({ freight_value: 0.5, toll: 3.79, gris: 0.17, gris_min: 3.79, tas: 3 })), { cargoValue: 300, personType: 'PF', measures: measure([], 1), sameState: true })
    expect(r.subtotal).toBe(86.78)
    expect(r.icms).toMatchObject({ rate: 17, value: 17.77 })
    expect(r.total).toBe(104.55)
  })

  it('ICMS pela legislação: 7% ou 12% entre estados e a alíquota interna cadastrada no mesmo estado', () => {
    expect(interstateIcms('SC', 'BA')).toBe(7)
    expect(interstateIcms('SC', 'ES')).toBe(7)
    expect(interstateIcms('SC', 'SP')).toBe(12)
    expect(interstateIcms('BA', 'SC')).toBe(12)
    expect(interstateIcms('GO', 'MT')).toBe(12)
    expect(interstateIcms('SC', 'SC')).toBeNull()
    const s = { ...DEFAULT_SETTINGS, icmsMode: 'SOMADO' as const }
    const go = (originUf: string, destUf: string) => calculate(DEFAULT_COMPONENTS, s, match(rule({ freight: 100 })), { cargoValue: 0, personType: 'PJ', measures: measure([], 1), originUf, destUf, sameState: originUf === destUf, internalRates: { SC: 17 } })
    expect(go('SC', 'BA').icms).toMatchObject({ rate: 7, value: 7.53 })
    expect(go('RS', 'SC').icms.rate).toBe(12)
    expect(go('SC', 'SC').icms).toMatchObject({ rate: 17, value: 20.48 })
    const pr = go('PR', 'PR')
    expect(pr.icms).toMatchObject({ rate: null, value: 0 })
    expect(pr.warnings.join(' ')).toMatch(/PR sem alíquota interna/)
    // A alíquota fixada na versão vale mais que a legislação; a da regra vale mais que tudo.
    expect(calculate(DEFAULT_COMPONENTS, { ...s, icmsRate: 12 }, match(rule({ freight: 100 })), { cargoValue: 0, personType: 'PJ', measures: measure([], 1), originUf: 'SC', destUf: 'BA' }).icms.rate).toBe(12)
    expect(calculate(DEFAULT_COMPONENTS, { ...s, icmsRate: 12 }, match(rule({ freight: 100, icms_aliq: 4 })), { cargoValue: 0, personType: 'PJ', measures: measure([], 1), originUf: 'SC', destUf: 'BA' }).icms.rate).toBe(4)
  })
})

