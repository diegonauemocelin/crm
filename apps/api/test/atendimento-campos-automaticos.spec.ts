import { describe, expect, it } from 'vitest'
import { autoFieldsOf, keepAutoFields } from '../src/atendimento/regras'

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
