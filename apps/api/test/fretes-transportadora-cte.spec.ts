import { describe, expect, it } from 'vitest'
import { autoCarrierFromCte } from '../src/fretes/cte'

describe('transportadora cadastrada pelo CT-e', () => {
  it('usa o nome fantasia, o CNPJ e a cidade de quem emitiu', () => {
    const d = autoCarrierFromCte({ emitCnpj: '12345678000199', emitName: 'CIT EXPRESS ENCOMENDAS  LTDA', emitFant: 'CIT EXPRESS', emitCity: 'Porto Alegre', emitUf: 'rs', number: '1234', issuedAt: '2026-11-20T10:00:00-03:00' })
    expect(d).toMatchObject({ cnpj: '12345678000199', legalName: 'CIT EXPRESS ENCOMENDAS LTDA', name: 'CIT EXPRESS', city: 'Porto Alegre', state: 'RS' })
    expect(d?.notes).toContain('CT-e nº 1234 de 20/11/2026')
  })
  it('sem fantasia, o nome é a razão social; CNPJ inválido não cadastra', () => {
    expect(autoCarrierFromCte({ emitCnpj: '12345678000199', emitName: 'TRANSPORTES X LTDA', number: null, issuedAt: null })?.name).toBe('TRANSPORTES X LTDA')
    expect(autoCarrierFromCte({ emitCnpj: '123', emitName: 'X', number: null, issuedAt: null })).toBeNull()
    expect(autoCarrierFromCte({ emitCnpj: null, emitName: 'X', number: null, issuedAt: null })).toBeNull()
  })
})
