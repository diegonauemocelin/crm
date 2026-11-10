import { describe, expect, it } from 'vitest'
import { hasDims, measuresFrom, parseMeasure } from '../src/integracoes/magazord'
import { fingerprint, productWeight } from '../src/merchant/frete-google'

describe('Magazord: peso e medidas', () => {
  it('peso em kg (padrão da Magazord), g e t; vírgula decimal e milhar', () => {
    expect(parseMeasure(1.5, 'peso')).toBe(1.5)
    expect(parseMeasure('1,000', 'peso')).toBe(1)
    expect(parseMeasure('0,100', 'peso')).toBe(0.1)
    expect(parseMeasure('500 g', 'peso')).toBe(0.5)
    expect(parseMeasure('250gr', 'peso')).toBe(0.25)
    expect(parseMeasure('2,5 kg', 'peso')).toBe(2.5)
    expect(parseMeasure('1.234,5', 'peso')).toBe(1234.5)
    expect(parseMeasure('1.5', 'peso')).toBe(1.5)
    expect(parseMeasure('1 t', 'peso')).toBe(1000)
    expect(parseMeasure(0, 'peso')).toBeNull()
    expect(parseMeasure(null, 'peso')).toBeNull()
    expect(parseMeasure('abc', 'peso')).toBeNull()
    expect(parseMeasure('3 lb', 'peso')).toBeNull()
    expect(parseMeasure(50_000, 'peso')).toBeNull()
  })

  it('medidas em cm (padrão), mm e m', () => {
    expect(parseMeasure(30, 'medida')).toBe(30)
    expect(parseMeasure('12,5 cm', 'medida')).toBe(12.5)
    expect(parseMeasure('1,2 m', 'medida')).toBe(120)
    expect(parseMeasure('35 mm', 'medida')).toBe(3.5)
    expect(parseMeasure(2000, 'medida')).toBeNull()
    expect(parseMeasure('-3', 'medida')).toBeNull()
  })

  it('detalhe da derivação (v3): dimensoes; sem peso, soma dos volumes', () => {
    expect(measuresFrom({ dimensoes: [{ peso: 2.35, altura: 10, largura: 20, comprimento: 30 }] })).toEqual({ weightKg: 2.35, heightCm: 10, widthCm: 20, lengthCm: 30 })
    const vols = measuresFrom({ dimensoes: [], dimensoesVolumes: [{ peso: 10, altura: 50, largura: 50, comprimento: 50 }, { peso: '5,5', altura: 10, largura: 10, comprimento: 10 }] })
    expect(vols).toEqual({ weightKg: 15.5, heightCm: 50, widthCm: 50, lengthCm: 50 })
    expect(hasDims(vols)).toBe(true)
    // Produto da v2: campos soltos.
    expect(measuresFrom({ peso: '1,000', altura: 5, largura: null, comprimento: 8 })).toEqual({ weightKg: 1, heightCm: 5, widthCm: null, lengthCm: 8 })
    expect(measuresFrom(null)).toEqual({ weightKg: null, heightCm: null, widthCm: null, lengthCm: null })
    expect(hasDims({ heightCm: 5, widthCm: null, lengthCm: 8 })).toBe(false)
  })
})

describe('Frete no Google pelo CRM: peso do produto', () => {
  const mz = { weightKg: 3, heightCm: 10, widthCm: 20, lengthCm: 30 }
  it('Magazord primeiro (com medidas), depois Tcar, senão erro', () => {
    expect(productWeight(mz, 9)).toEqual({ weight: 3, dims: { length: 30, width: 20, height: 10 }, source: 'magazord' })
    expect(productWeight({ ...mz, widthCm: null }, 9)).toEqual({ weight: 3, dims: null, source: 'magazord' })
    expect(productWeight({ ...mz, weightKg: null }, 9)).toEqual({ weight: 9, dims: null, source: 'tcar' })
    expect(productWeight(null, null)).toEqual({ error: 'Sem peso na Magazord (nem peso bruto na Tcar).' })
  })
  it('medidas mudam a impressão digital; sem medidas fica como antes', () => {
    const base = { source: 'crm' as const, price: 100, weight: 3, ceps: {}, unitId: 'u', carrierIds: [], tables: 't' }
    expect(fingerprint({ ...base, dims: null })).toBe(fingerprint(base))
    expect(fingerprint({ ...base, dims: { length: 30, width: 20, height: 10 } })).not.toBe(fingerprint(base))
  })
})
