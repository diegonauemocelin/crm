import { describe, expect, it } from 'vitest'
import { applyVariables, feminineSeller } from '../src/whatsapp/envio'

describe('mensagens: vendedor ou vendedora', () => {
  it('vendedora: ajusta artigo e palavra, com maiúscula no começo da frase', () => {
    expect(applyVariables('Olá, {nome}! O vendedor {vendedor} já entrou em contato com você?', { nome: 'João Silva', vendedor: 'Mariana Souza', genero: 'F' })).toBe('Olá, João! A vendedora Mariana já entrou em contato com você?')
    expect(feminineSeller('encaminhado para o vendedor {vendedor}, do vendedor e ao vendedor')).toBe('encaminhado para a vendedora {vendedor}, da vendedora e à vendedora')
  })
  it('vendedor (ou sem gênero): texto igual', () => {
    expect(applyVariables('O vendedor {vendedor} já entrou em contato?', { vendedor: 'Carlos', genero: 'M' })).toBe('O vendedor Carlos já entrou em contato?')
    expect(applyVariables('O vendedor {vendedor} já entrou em contato?', { vendedor: 'Carlos' })).toBe('O vendedor Carlos já entrou em contato?')
    expect(feminineSeller('vendedores e vendedora')).toBe('vendedores e vendedora')
  })
})
