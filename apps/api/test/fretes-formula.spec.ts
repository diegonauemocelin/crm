import { describe, expect, it } from 'vitest'
import { checkFormula, compileFormula, evaluate, roundTo } from '../src/fretes/formula'

const calc = (f: string, vars: Record<string, number> = {}) => evaluate(compileFormula(f), vars).value

describe('fretes: fórmulas', () => {
  it('calcula as fórmulas da tela de componentes', () => {
    expect(calc('$cargo_value$ * ($advalorem$/100)', { cargo_value: 1000, advalorem: 0.3 })).toBeCloseTo(3)
    expect(calc('ceil($weight$ / $fraction$) * $toll$', { weight: 150, fraction: 100, toll: 5.5 })).toBe(11)
    expect(calc('ceil($weight$ / $fraction$) * $toll$', { weight: 100, fraction: 100, toll: 5.5 })).toBe(5.5)
    expect(calc('if($fraction$ > 0, ceil($weight$ / $fraction$) * $toll$, $toll$)', { weight: 30, fraction: 0, toll: 4 })).toBe(4)
    expect(calc('se($weight$ >= 10 && $is_pf$, 1, 2)', { weight: 10, is_pf: 1 })).toBe(1)
    expect(calc('max(1, 2, 3) + min(4, 5) - -1')).toBe(8)
    expect(calc('2 + 3 * 4 % 5')).toBe(4)
    expect(calc('!0 + !5')).toBe(1)
    expect(calc('round(10 / 3, 2)')).toBe(3.33)
  })

  it('variável sem valor vale zero e é avisada', () => {
    const r = evaluate(compileFormula('$tda$ + $trt$ + 1'), { trt: 2 })
    expect(r).toEqual({ value: 3, missing: ['tda'] })
  })

  it('if não calcula o lado que não vale (sem divisão por zero escondida)', () => {
    expect(calc('if($fraction$, $weight$ / $fraction$, 0)', { fraction: 0, weight: 5 })).toBe(0)
    expect(() => calc('$weight$ / $fraction$', { fraction: 0, weight: 5 })).toThrow(/Divisão por zero/)
  })

  it('recusa código e sintaxe inválida com mensagem em português', () => {
    for (const bad of ['process.exit(1)', 'constructor', 'eval("1")', '$a$ +', '(1 + 2', '1 2', '$Abc$', '$a', '1; 2', 'ceil()', 'max(', '`x`', 'a[0]', '""']) {
      const r = checkFormula(bad)
      expect(r.ok, bad).toBe(false)
    }
    expect(checkFormula('process.exit(1)')).toMatchObject({ ok: false, error: expect.stringMatching(/Função não permitida|Caractere/) })
    expect(checkFormula('x'.repeat(501))).toMatchObject({ ok: false })
    expect(checkFormula('')).toMatchObject({ ok: false, error: 'A fórmula está vazia.' })
    expect(checkFormula('$cargo_value$ * $gris$')).toEqual({ ok: true, variables: ['cargo_value', 'gris'] })
  })

  it('arredonda dinheiro meio para cima sem erro de ponto flutuante', () => {
    expect(roundTo(1.005, 2)).toBe(1.01)
    expect(roundTo(2.675, 2)).toBe(2.68)
    expect(roundTo(-1.005, 2)).toBe(-1.01)
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3)
  })
})
