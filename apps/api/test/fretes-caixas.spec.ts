import { describe, expect, it } from 'vitest'
import { cleanBoxes, fitsIn, suggestBox, type FreightBox } from '../src/fretes/caixas'

let n = 0
const id = () => `cx-000${++n}`
const boxes: FreightBox[] = cleanBoxes(
  [
    { name: 'Grande', length: 60, width: 40, height: 40, tare: 1, maxWeight: 30 },
    { name: 'Pequena', length: 20, width: 20, height: 20, tare: 0.2, maxWeight: 10 },
    { name: 'Média', length: 40, width: 30, height: 30, tare: 0.5, maxWeight: 20 },
  ],
  id,
)

describe('caixas de embalagem', () => {
  it('limpa o cadastro (nome e medidas obrigatórios, vírgula aceita)', () => {
    const r = cleanBoxes([{ name: ' A ', length: '30,5', width: 20, height: 10 }, { name: '', length: 1, width: 1, height: 1 }, { name: 'B', length: 0, width: 1, height: 1 }], id)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: 'A', length: 30.5, tare: 0, maxWeight: null, active: true })
  })

  it('cabe girando o produto', () => {
    expect(fitsIn({ length: 10, width: 38, height: 25 }, { length: 40, width: 30, height: 30 })).toBe(true)
    expect(fitsIn({ length: 45, width: 10, height: 10 }, { length: 40, width: 30, height: 30 })).toBe(false)
  })

  it('sugere a menor caixa onde tudo cabe', () => {
    const r = suggestBox([{ quantity: 5, weight: 1, length: 15, width: 10, height: 10 }], boxes)
    // 5 × 1.500 cm³ = 7.500 > 80% de 8.000 da pequena (6.400): vai a média.
    expect(r.status).toBe('OK')
    if (r.status === 'OK') {
      expect(r.box.name).toBe('Média')
      expect(r.weight).toBe(5.5)
    }
    const s = suggestBox([{ quantity: 2, weight: 1, length: 15, width: 10, height: 10 }], boxes)
    expect(s.status === 'OK' && s.box.name).toBe('Pequena')
  })

  it('respeita o peso máximo da caixa', () => {
    const r = suggestBox([{ quantity: 1, weight: 12, length: 10, width: 10, height: 10 }], boxes)
    expect(r.status === 'OK' && r.box.name).toBe('Média')
  })

  it('várias caixas quando não cabe numa só; produto maior que tudo avisa', () => {
    const r = suggestBox([{ quantity: 10, weight: 5, length: 40, width: 30, height: 20 }], boxes)
    expect(r.status).toBe('VARIAS')
    if (r.status === 'VARIAS') {
      expect(r.box.name).toBe('Grande')
      // 10 × 24.000 cm³ = 240.000; 80% da grande = 76.800 → 4 caixas.
      expect(r.count).toBe(4)
    }
    expect(suggestBox([{ quantity: 1, weight: 1, length: 90, width: 10, height: 10 }], boxes).status).toBe('NAO_CABE')
    expect(suggestBox([{ quantity: 1, weight: 1, length: 0, width: 10, height: 10 }], boxes).status).toBe('SEM_MEDIDAS')
    expect(suggestBox([{ quantity: 1, weight: 1, length: 5, width: 5, height: 5 }], []).status).toBe('SEM_CAIXAS')
  })
})
