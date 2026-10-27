import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPONENTS, DEFAULT_SETTINGS } from '../src/fretes/catalogo'
import { normalizeCep, ufByCep } from '../src/fretes/cep'
import { addBusinessDays, calculate, matchRule, measure, type RuleLike, weights } from '../src/fretes/motor'

const rule = (p: Partial<RuleLike>): RuleLike => ({ cepStart: null, cepEnd: null, uf: null, city: null, weightMin: 0, weightMax: null, deadlineDays: null, restricted: false, values: {}, ...p })

describe('fretes: cubagem e peso taxado', () => {
  it('soma volumes em cm e kg e avisa medida suspeita', () => {
    const m = measure([{ quantity: 2, weight: 10, length: 50, width: 40, height: 30 }], null)
    expect(m).toMatchObject({ realWeight: 20, cubicMeters: 0.12, quantity: 2 })
    expect(() => measure([{ quantity: 1, weight: 1, length: 5000, width: 1, height: 1 }], null)).toThrow(/centímetros/)
    expect(measure([], 35)).toMatchObject({ realWeight: 35, cubicMeters: 0, quantity: 1 })
  })
  it('isenção de cubagem até o volume combinado (ex.: 0,30 m³)', () => {
    const small = measure([{ quantity: 1, weight: 10, length: 100, width: 60, height: 50 }], null)
    const big = measure([{ quantity: 1, weight: 10, length: 100, width: 80, height: 50 }], null)
    const s = { cubageFactor: 265, useCubage: true, cubageExemptM3: 0.3 }
    expect(weights(small, s)).toEqual({ real: 10, cubed: 79.5, taxed: 10 })
    expect(weights(big, s).taxed).toBe(106)
  })
})

describe('fretes: escolha da regra', () => {
  const rules = [
    rule({ uf: 'SC', weightMin: 0, weightMax: 10, values: { freight: 50 } }),
    rule({ cepStart: 89874000, cepEnd: 89874999, weightMin: 0, weightMax: 10, values: { freight: 20 } }),
    rule({ cepStart: 89874000, cepEnd: 89874999, weightMin: 10, weightMax: 30, values: { freight: 30 } }),
    rule({ cepStart: 88000000, cepEnd: 89999999, weightMin: 0, weightMax: 10, values: { freight: 40 } }),
    rule({ city: 'São Paulo', uf: 'SP', weightMin: 0, weightMax: null, values: { freight: 70 } }),
  ]
  it('faixa de CEP mais estreita, depois cidade, depois UF', () => {
    expect(matchRule(rules, { zip: 89874000, uf: 'SC', city: 'Maravilha' }, 5)).toMatchObject({ by: 'CEP', rule: { values: { freight: 20 } } })
    expect(matchRule(rules, { zip: 88301000, uf: 'SC', city: 'Itajaí' }, 5)).toMatchObject({ by: 'CEP', rule: { values: { freight: 40 } } })
    expect(matchRule(rules, { zip: 1310100, uf: 'SP', city: 'SAO PAULO - SP' }, 5)).toMatchObject({ by: 'CIDADE' })
    expect(matchRule(rules, { zip: 80000000, uf: 'PR', city: 'Curitiba' }, 5)).toMatchObject({ rule: null })
  })
  it('no limite entre faixas vale a de baixo; acima da última marca excedente', () => {
    expect(matchRule(rules, { zip: 89874100, uf: 'SC', city: null }, 10)).toMatchObject({ rule: { values: { freight: 20 } }, exceeded: false })
    expect(matchRule(rules, { zip: 89874100, uf: 'SC', city: null }, 10.5)).toMatchObject({ rule: { values: { freight: 30 } } })
    expect(matchRule(rules, { zip: 89874100, uf: 'SC', city: null }, 45)).toMatchObject({ rule: { values: { freight: 30 } }, exceeded: true, weightLimit: 30 })
  })
})

describe('fretes: cálculo', () => {
  const input = (p: Partial<Parameters<typeof calculate>[3]> = {}) => ({ cargoValue: 1000, personType: 'PJ' as const, measures: measure([], 25), ...p })

  it('frete peso, ad valorem, GRIS com mínimo, pedágio por fração e ICMS por dentro', () => {
    const r = rule({ weightMin: 20, weightMax: 30, deadlineDays: 3, values: { freight: 80, advalorem: 0.3, gris: 0.1, gris_min: 2.5, toll: 4.2, fraction: 100, icms_aliq: 12 } })
    const res = calculate(DEFAULT_COMPONENTS, DEFAULT_SETTINGS, { rule: r, by: 'UF', exceeded: false, weightLimit: 30 }, input())
    expect(res.ok).toBe(true)
    const v = Object.fromEntries(res.components.map((c) => [c.code, c.value]))
    expect(v).toMatchObject({ FRETE_PESO: 80, FRETE_VALOR: 0, ADVALOREM: 3, GRIS: 2.5, PEDAGIO: 4.2, TAS: 0 })
    expect(res.subtotal).toBe(89.7)
    // 89,70 / (1 - 0,12) = 101,93 → ICMS 12,23
    expect(res.icms).toMatchObject({ rate: 12, base: 89.7, value: 12.23 })
    expect(res.total).toBe(101.93)
    expect(res.components.find((c) => c.code === 'REENTREGA')).toBeUndefined()
  })

  it('T-CPF só para pessoa física; mínimo do frete; excedente', () => {
    const r = rule({ weightMin: 0, weightMax: 10, values: { freight: 10, min_freight: 35, t_cpf: 7, over_weight: 1.5 } })
    const settings = { ...DEFAULT_SETTINGS, icmsMode: 'NAO_INCIDE' as const }
    const pj = calculate(DEFAULT_COMPONENTS, settings, { rule: r, by: 'UF', exceeded: false, weightLimit: 10 }, input({ measures: measure([], 5) }))
    expect(pj.components.find((c) => c.code === 'T-CPF')).toMatchObject({ skipped: true, value: 0 })
    expect(pj.total).toBe(35)
    const pf = calculate(DEFAULT_COMPONENTS, settings, { rule: r, by: 'UF', exceeded: true, weightLimit: 10 }, input({ personType: 'PF', measures: measure([], 40) }))
    // 10 + 1,5 × 30 kg excedentes = 55; + T-CPF 7
    expect(pf.total).toBe(62)
  })

  it('peso cubado vale quando maior que o real', () => {
    const r = rule({ values: { freight_kg: 2 } })
    const m = measure([{ quantity: 1, weight: 10, length: 100, width: 100, height: 50 }], null)
    const res = calculate(DEFAULT_COMPONENTS, { ...DEFAULT_SETTINGS, icmsMode: 'NAO_INCIDE' }, { rule: r, by: 'UF', exceeded: false, weightLimit: 0 }, input({ measures: m }))
    expect(res.weights).toEqual({ real: 10, cubed: 150, taxed: 150 })
    expect(res.total).toBe(300)
  })

  it('acima da última faixa sem excedente e fórmula com divisão por zero não viram preço', () => {
    const r = rule({ weightMax: 10, values: { freight: 10 } })
    expect(calculate(DEFAULT_COMPONENTS, DEFAULT_SETTINGS, { rule: r, by: 'UF', exceeded: true, weightLimit: 10 }, input())).toMatchObject({ ok: false, error: expect.stringMatching(/excedente/) })
    const broken = [{ code: 'X', name: 'X', formula: '$weight$ / $fraction$', inTax: true, order: 1, active: true }]
    expect(calculate(broken, DEFAULT_SETTINGS, { rule: rule({}), by: 'UF', exceeded: false, weightLimit: 0 }, input())).toMatchObject({ ok: false, error: expect.stringMatching(/Divisão por zero/) })
  })

  it('componentes anteriores ficam disponíveis (taxa sobre o frete)', () => {
    const comps = [
      { code: 'FRETE_PESO', name: 'Frete', formula: '$freight$', inTax: true, order: 1, active: true },
      { code: 'EMERG', name: 'Emergencial', formula: '$c_frete_peso$ * 0.1 + $subtotal$ * 0', inTax: false, order: 2, active: true },
    ]
    const res = calculate(comps, { ...DEFAULT_SETTINGS, icmsMode: 'INFORMATIVO', icmsRate: 10 }, { rule: rule({ values: { freight: 200 } }), by: 'UF', exceeded: false, weightLimit: 0 }, input())
    expect(res.components.map((c) => c.value)).toEqual([200, 20])
    expect(res.icms).toMatchObject({ base: 200, value: 20 })
    expect(res.total).toBe(220)
  })
})

describe('fretes: CEP e prazo', () => {
  it('UF pela faixa oficial e CEP sem o zero da frente', () => {
    expect(normalizeCep(1310100)).toBe('01310100')
    expect(ufByCep('89874000')).toBe('SC')
    expect(ufByCep('94930625')).toBe('RS')
    expect(ufByCep('69301000')).toBe('RR')
    expect(normalizeCep('00000-000')).toBeNull()
  })
  it('dias úteis pulam o fim de semana', () => {
    // 23/10/2026 é sexta-feira
    expect(addBusinessDays(new Date('2026-10-23T12:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-10-26')
    expect(addBusinessDays(new Date('2026-10-23T12:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2026-11-02')
  })
})
