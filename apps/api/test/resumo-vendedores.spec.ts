import { describe, expect, it } from 'vitest'
import { cleanDigest, DEFAULT_DIGEST_TEXT, digestFor, digestMessages, readablePhone, saleSituation, todayWindow } from '../src/atendimento/regras'

const items = [
  { name: 'João da Silva', phone: '+5549991848098' },
  { name: 'Maria Souza', phone: '+552798813902' },
  { name: 'Sem Fone', phone: null },
]

describe('resumo do dia para o vendedor', () => {
  it('configuração padrão: desligada, 18h, uma mensagem por cliente, todos os vendedores', () => {
    expect(cleanDigest(null)).toEqual({ enabled: false, time: '18:00', text: DEFAULT_DIGEST_TEXT, numberId: null, split: true, allSellers: true, sellerIds: [] })
    expect(cleanDigest({ time: '7h', sellerIds: ['a', 'a', 'b'] as string[] })).toMatchObject({ time: '18:00', sellerIds: ['a', 'b'] })
  })

  it('todos os vendedores ou só os escolhidos', () => {
    const on = cleanDigest({ enabled: true })
    expect(digestFor(on, 'x')).toBe(true)
    const some = cleanDigest({ enabled: true, allSellers: false, sellerIds: ['a'] })
    expect(digestFor(some, 'a')).toBe(true)
    expect(digestFor(some, 'b')).toBe(false)
    expect(digestFor(cleanDigest({ enabled: false }), 'a')).toBe(false)
  })

  it('uma mensagem por cliente: telefone na primeira linha (clicável no WhatsApp) e o nome embaixo', () => {
    const m = digestMessages('Olá, {vendedor}! Hoje ({data}): {quantidade} cliente(s).', 'Carlos Pereira', '2026-10-19', items, true)
    expect(m).toEqual(['Olá, Carlos! Hoje (19/10/2026): 3 cliente(s).', '(49) 99184-8098\nJoão da Silva', '(27) 9881-3902\nMaria Souza', 'sem telefone\nSem Fone'])
  })

  it('lista única numa mensagem só', () => {
    const [m] = digestMessages('{vendedor}: {quantidade}', 'Ana', '2026-10-19', items.slice(0, 2), false)
    expect(m).toBe('Ana: 2\n\n1. (49) 99184-8098 — João da Silva\n2. (27) 9881-3902 — Maria Souza')
  })

  it('situação ao lado do nome: vendeu, não vendeu e motivo, aguardando retorno do vendedor', () => {
    expect(saleSituation('SIM')).toBe('Vendeu')
    expect(saleSituation('NAO', 'Preço')).toBe('Não vendeu (Preço)')
    expect(saleSituation('NAO', null)).toBe('Não vendeu')
    expect(saleSituation('NEGOCIACAO')).toBe('Aguardando retorno do vendedor')
    const list = [{ ...items[0]!, situation: 'Vendeu' }, { ...items[1]!, situation: 'Aguardando retorno do vendedor' }]
    expect(digestMessages('{vendedor}', 'Ana', '2026-10-19', list, false)[0]).toBe('Ana\n\n1. (49) 99184-8098 — João da Silva — Vendeu\n2. (27) 9881-3902 — Maria Souza — Aguardando retorno do vendedor')
    expect(digestMessages('{vendedor}', 'Ana', '2026-10-19', list, true)[1]).toBe('(49) 99184-8098\nJoão da Silva — Vendeu')
  })

  it('telefone legível e dia de São Paulo', () => {
    expect(readablePhone('+5511958797164')).toBe('(11) 95879-7164')
    expect(readablePhone('+595981123456')).toBe('+595981123456')
    // 17:59 em São Paulo: ainda não; 18:00: sai. 23h em SP já é outro dia em UTC, mas o dia é o de SP.
    expect(todayWindow('18:00', new Date('2026-10-19T20:59:00Z')).due).toBe(false)
    expect(todayWindow('18:00', new Date('2026-10-19T21:00:00Z'))).toMatchObject({ due: true, day: '2026-10-19' })
    expect(todayWindow('18:00', new Date('2026-10-20T02:00:00Z')).day).toBe('2026-10-19')
  })
})
