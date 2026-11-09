import { describe, expect, it } from 'vitest'
import { maskUrl } from '../src/common/mascara-url'

describe('log sem códigos de acesso no endereço', () => {
  it('mascara o código e mantém o resto', () => {
    expect(maskUrl('/api/webhooks/whatsapp/abc123/messages-upsert')).toBe('/api/webhooks/whatsapp/***/messages-upsert')
    expect(maskUrl('/api/webhooks/meta/chave?x=1')).toBe('/api/webhooks/meta/***?x=1')
    expect(maskUrl('/api/public/descadastro/tok')).toBe('/api/public/descadastro/***')
    expect(maskUrl('/api/leads?busca=1')).toBe('/api/leads?busca=1')
  })
})
