import { describe, expect, it } from 'vitest'
import { autoFieldsOf, cleanDiscardReason, cleanReactivation, keepAutoFields, stepTextFor } from '../src/atendimento/regras'

describe('campos que vieram preenchidos na pré-venda', () => {
  it('guarda só os campos com valor', () => {
    expect(autoFieldsOf({ leadAt: new Date(), name: 'Ana', phone: '+5547999990000', email: null, city: '', brandIds: [], originId: 'o1', notes: 'Entrou pelo botão' })).toEqual(['leadAt', 'name', 'phone', 'originId', 'notes'])
    expect(autoFieldsOf({ brandIds: ['b1'], sellerId: 's1', unitId: undefined })).toEqual(['sellerId', 'brandIds'])
  })

  it('campo alterado por uma pessoa passa a ser manual', () => {
    expect(keepAutoFields(['name', 'phone', 'originId'], { phone: { de: 'a', para: 'b' }, saleStatus: {} })).toEqual(['name', 'originId'])
    expect(keepAutoFields(['name'], {})).toEqual(['name'])
  })
})

describe('chamar o cliente de novo: texto por tipo de cliente', () => {
  const FINAL = '11111111-1111-1111-1111-111111111111'
  const REV = '22222222-2222-2222-2222-222222222222'
  it('usa o texto do tipo; sem texto do tipo, o padrão', () => {
    const r = cleanReactivation({ sold: [{ enabled: true, days: 60, text: 'Padrão', byType: { [REV]: '  Revenda  ', [FINAL]: '', lixo: 'x' } }] } as never)
    const step = r.sold.find((s) => s.days === 60)!
    expect(step.byType).toEqual({ [REV]: 'Revenda' })
    expect(stepTextFor(step, REV)).toBe('Revenda')
    expect(stepTextFor(step, FINAL)).toBe('Padrão')
    expect(stepTextFor(step, null)).toBe('Padrão')
  })
})

describe('descartar cadastro inválido', () => {
  it('aceita só motivo da lista; Outro pede o texto', () => {
    expect(cleanDiscardReason('Telefone não funciona e sem e-mail', '')).toBe('Telefone não funciona e sem e-mail')
    expect(cleanDiscardReason('Cadastro duplicado', ' igual ao de ontem ')).toBe('Cadastro duplicado (igual ao de ontem)')
    expect(cleanDiscardReason('Outro', '')).toBeNull()
    expect(cleanDiscardReason('Outro', 'cliente pediu')).toBe('cliente pediu')
    expect(cleanDiscardReason('qualquer', 'x')).toBeNull()
  })
})
