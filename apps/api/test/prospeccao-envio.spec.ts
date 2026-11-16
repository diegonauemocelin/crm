import { describe, expect, it } from 'vitest'
import { cleanCampaign, isOptOut, nextGapMs, OPT_OUT_LINE, pickVariation, renderMessage, sendPhone, sendWindowOpen, variationsFromAi } from '../src/prospeccao/envio'

describe('busca de leads: envio em fila', () => {
  it('valida o pedido com padrão de 2 a 10 min e 30 por dia', () => {
    const c = cleanCampaign({ numberId: 'n', prospectIds: ['a', 'a', 'b'], messages: ['Olá {empresa}, tudo bem?', 'curta'] })
    expect(c).toMatchObject({ prospectIds: ['a', 'b'], messages: ['Olá {empresa}, tudo bem?'], gapMin: 2, gapMax: 10, dailyMax: 30, optOut: true })
    expect(cleanCampaign({ numberId: 'n', prospectIds: ['a'], messages: ['mensagem longa o bastante'], gapMin: 20, gapMax: 5, dailyMax: 500 })).toMatchObject({ gapMin: 5, gapMax: 20, dailyMax: 30 })
    expect(() => cleanCampaign({ numberId: 'n', prospectIds: ['a'], messages: [] })).toThrow(/mensagem/)
    expect(() => cleanCampaign({ numberId: 'n', prospectIds: [], messages: ['mensagem longa o bastante'] })).toThrow(/empresas/)
  })

  it('troca as variáveis e põe a frase de saída', () => {
    const t = renderMessage('Olá, {empresa}! Sou {vendedor}, de {cidade} .', { empresa: 'Terra Forte', vendedor: 'Ana Souza', cidade: '' }, true)
    expect(t).toBe(`Olá, Terra Forte! Sou Ana, de.\n\n${OPT_OUT_LINE}`)
    expect(renderMessage('Responda SAIR para sair.', {}, true)).toBe('Responda SAIR para sair.')
    expect(renderMessage('Oi {empresa}', { empresa: 'X' }, false)).toBe('Oi X')
  })

  it('sorteia a variação e o intervalo dentro do combinado', () => {
    expect(pickVariation(['a', 'b', 'c'], () => 0.99)).toBe('c')
    expect(pickVariation(['a', 'b', 'c'], () => 0)).toBe('a')
    expect(nextGapMs(2, 10, () => 0)).toBe(120_000)
    expect(nextGapMs(2, 10, () => 1)).toBe(600_000)
  })

  it('entende quem pede para sair', () => {
    for (const t of ['SAIR', 'sair.', 'Parar', 'Não tenho interesse, obrigado', 'por favor não me mande mais']) expect(isOptOut(t)).toBe(true)
    for (const t of ['Bom dia, qual o preço?', 'Pode sair amanhã a entrega?', '', null]) expect(isOptOut(t)).toBe(false)
  })

  it('escolhe o celular com WhatsApp', () => {
    expect(sendPhone([{ value: '+554933333333', kind: 'fixo', whatsapp: null }, { value: '+5549999999999', kind: 'celular', whatsapp: null }])?.value).toBe('+5549999999999')
    expect(sendPhone([{ value: '+5549999999999', kind: 'celular', whatsapp: false }, { value: '+554933333333', kind: 'fixo', whatsapp: true }])?.value).toBe('+554933333333')
    expect(sendPhone([{ value: '+554933333333', kind: 'fixo', whatsapp: null }])).toBeNull()
  })

  it('sem horário comercial, envia de segunda a sábado das 8h às 18h', () => {
    expect(sendWindowOpen(true, false)).toBe(false)
    expect(sendWindowOpen(false, true, new Date('2026-11-16T13:00:00Z'))).toBe(true) // segunda 10h
    expect(sendWindowOpen(false, true, new Date('2026-11-16T22:00:00Z'))).toBe(false) // segunda 19h
    expect(sendWindowOpen(false, true, new Date('2026-11-15T13:00:00Z'))).toBe(false) // domingo
  })

  it('lê as variações que a IA devolveu', () => {
    expect(variationsFromAi('```json\n{"variacoes":["Olá {empresa}, tudo bem?","x"]}\n```')).toEqual(['Olá {empresa}, tudo bem?'])
    expect(variationsFromAi('sem json')).toEqual([])
  })
})
