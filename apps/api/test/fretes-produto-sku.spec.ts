import { describe, expect, it } from 'vitest'
import { cleanSku, skuVolume } from '../src/fretes/produto-sku'

const p = { externalId: 'FLT-123', code: '123', name: 'Filtro', price: 89.9, weightKg: 1.25, heightCm: 20, widthCm: 12, lengthCm: 12, measuresAt: null }

describe('produto pelo SKU na cotação', () => {
  it('volume por unidade com peso e medidas da Magazord', () => {
    const v = skuVolume(p)
    expect(v).toMatchObject({ sku: 'FLT-123', weight: 1.25, length: 12, width: 12, height: 20, missing: [], warning: null })
  })

  it('aponta o que falta no cadastro (zero conta como falta)', () => {
    const v = skuVolume({ ...p, weightKg: null, heightCm: 0 })
    expect(v.missing).toEqual(['peso', 'altura'])
    expect(v.warning).toContain('sem peso, altura')
  })

  it('limpa o SKU digitado', () => {
    expect(cleanSku('  ABC-1 ')).toBe('ABC-1')
    expect(cleanSku(null)).toBe('')
  })
})
