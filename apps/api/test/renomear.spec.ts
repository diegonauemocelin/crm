import { describe, expect, it } from 'vitest'
import { namePattern, renameJson, renameText, validNames } from '../src/settings/renomear'

const swap = (text: string, from: string, to: string) => renameText(text, namePattern(from)!, to)

describe('trocar o nome da empresa nos textos', () => {
  it('troca as variações do nome antigo', () => {
    expect(swap('Fale com a USA Parts', 'USA Parts', 'Usaparts')).toBe('Fale com a Usaparts')
    expect(swap('Bem-vindo à USA-Parts e à usa  parts', 'USA Parts', 'Usaparts')).toBe('Bem-vindo à Usaparts e à Usaparts')
    expect(swap('OFERTAS USA PARTS', 'USA Parts', 'Usaparts')).toBe('OFERTAS USAPARTS')
  })

  it('não mexe em site, e-mail, cupom nem em outra palavra', () => {
    const text = 'Usaparts: www.usaparts.com.br, vendas@usaparts.com.br, instagram.com/usaparts, cupom USAPARTS10, usaparts-crm. Obrigado, Usaparts.'
    expect(swap(text, 'Usaparts', 'Usaparts Peças')).toBe('Usaparts Peças: www.usaparts.com.br, vendas@usaparts.com.br, instagram.com/usaparts, cupom USAPARTS10, usaparts-crm. Obrigado, Usaparts Peças.')
  })

  it('no JSON, só os valores de texto mudam', () => {
    const r = renameJson({ blocks: [{ type: 'titulo', text: 'USA Parts' }], 'USA Parts': 1, n: 2 }, namePattern('USA Parts')!, 'Usaparts')
    expect(r).toEqual({ value: { blocks: [{ type: 'titulo', text: 'Usaparts' }], 'USA Parts': 1, n: 2 }, changes: 1 })
  })

  it('confere os nomes', () => {
    expect(validNames('US', 'X')).toMatch(/nome antigo/)
    expect(validNames('USA Parts', '')).toMatch(/nome novo/)
    expect(validNames('USA Parts', 'Usa"parts')).toMatch(/pontuação simples/)
    expect(validNames('USA Parts', 'Usaparts')).toBeNull()
  })
})
