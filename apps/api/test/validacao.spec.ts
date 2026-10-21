import { describe, expect, it } from 'vitest'
import { validationMessages } from '../src/common/validacao'

const err = (property: string, constraints: Record<string, string>, children: unknown[] = []) => ({ property, constraints, children }) as never

describe('validação em português', () => {
  it('diz o campo e o que corrigir; mensagens próprias ficam', () => {
    expect(validationMessages([err('name', { minLength: 'name must be longer than or equal to 2 characters' })])).toEqual(['O campo nome precisa ter pelo menos 2 caracteres.'])
    expect(validationMessages([err('email', { isEmail: 'email must be an email' })])).toEqual(['O campo e-mail não é um e-mail válido.'])
    expect(validationMessages([err('phone', { isLength: 'phone must be shorter than or equal to 15 characters' })])).toEqual(['O campo telefone pode ter no máximo 15 caracteres.'])
    expect(validationMessages([err('threshold', { min: 'threshold must not be less than 1' })])).toEqual(['O campo limite precisa ser no mínimo 1.'])
    expect(validationMessages([err('kind', { isIn: 'kind must be one of the following values: a, b' })])).toEqual(['O campo tipo tem um valor que não está entre as opções.'])
    expect(validationMessages([err('code', { maxLength: 'Use até 5 letras.' })])).toEqual(['Use até 5 letras.'])
    expect(validationMessages([err('extra', { whitelistValidation: 'property extra should not exist' })])[0]).toMatch(/O campo “extra” não é aceito/)
    // Dentro de listas: usa o nome da lista.
    expect(validationMessages([err('list', {}, [err('0', {}, [err('username', { isString: 'username must be a string' })])])])).toEqual(['O campo usuário precisa ser um texto.'])
  })
})
