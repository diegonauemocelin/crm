import { describe, expect, it } from 'vitest'
import { cleanContactCheck, cleanForwardMessage, deadline, isOverdue, nextCallDue, skipsPostSale } from '../src/atendimento/regras'
import { reportCycle, weeklyMessage, weeklyStats } from '../src/atendimento/semanal'
import { addBusinessMs, businessMsBetween, cleanHours, describeHours, isOpen, subBusinessMs } from '../src/whatsapp/envio'

// Seg. a sex. 08:00–18:00 com almoço 12:00–13:30; sábado e domingo fechados. 2026-10-26 é segunda-feira.
const H = cleanHours({
  enabled: true,
  days: [null, ...Array.from({ length: 5 }, () => ({ start: '08:00', end: '18:00', pauseStart: '12:00', pauseEnd: '13:30' })), null],
})
const at = (iso: string) => new Date(iso)
const HOUR = 3_600_000

describe('Horário comercial com almoço', () => {
  it('guarda a pausa só quando ela fica dentro do dia', () => {
    expect(H.days[1]).toEqual({ start: '08:00', end: '18:00', pauseStart: '12:00', pauseEnd: '13:30' })
    const bad = cleanHours({ enabled: true, days: [null, { start: '08:00', end: '18:00', pauseStart: '13:00', pauseEnd: '12:00' }, { start: '08:00', end: '12:00', pauseStart: '11:00', pauseEnd: '13:00' }] })
    expect(bad.days[1]).toEqual({ start: '08:00', end: '18:00' })
    expect(bad.days[2]).toEqual({ start: '08:00', end: '12:00' })
  })

  it('no almoço, à noite e no fim de semana está fechado', () => {
    expect(isOpen(H, at('2026-10-26T11:59:00-03:00'))).toBe(true)
    expect(isOpen(H, at('2026-10-26T12:30:00-03:00'))).toBe(false)
    expect(isOpen(H, at('2026-10-26T13:30:00-03:00'))).toBe(true)
    expect(isOpen(H, at('2026-10-26T19:00:00-03:00'))).toBe(false)
    expect(isOpen(H, at('2026-10-31T10:00:00-03:00'))).toBe(false)
  })

  it('conta só o tempo aberto entre dois instantes', () => {
    // 11h às 14h: 1 h de manhã + 30 min depois do almoço.
    expect(businessMsBetween(H, at('2026-10-26T11:00:00-03:00'), at('2026-10-26T14:00:00-03:00'))).toBe(1.5 * HOUR)
    // Sexta 17h até segunda 9h: 1 h na sexta + 1 h na segunda.
    expect(businessMsBetween(H, at('2026-10-30T17:00:00-03:00'), at('2026-11-02T09:00:00-03:00'))).toBe(2 * HOUR)
    // Desligado: tempo corrido.
    expect(businessMsBetween({ ...H, enabled: false }, at('2026-10-30T17:00:00-03:00'), at('2026-10-30T19:00:00-03:00'))).toBe(2 * HOUR)
  })

  it('prazo pula almoço, noite e fim de semana (e o contrário volta para o mesmo ponto)', () => {
    // Repasse às 11h, 2 horas de atendimento: 1 h até o almoço e 1 h depois -> 14h30.
    expect(addBusinessMs(H, at('2026-10-26T11:00:00-03:00'), 2 * HOUR).toISOString()).toBe(at('2026-10-26T14:30:00-03:00').toISOString())
    // Sexta 17h + 2 h -> segunda 9h.
    const due = addBusinessMs(H, at('2026-10-30T17:00:00-03:00'), 2 * HOUR)
    expect(due.toISOString()).toBe(at('2026-11-02T09:00:00-03:00').toISOString())
    expect(subBusinessMs(H, due, 2 * HOUR).toISOString()).toBe(at('2026-10-30T17:00:00-03:00').toISOString())
    // Chegou de madrugada: o prazo começa a contar na abertura.
    expect(addBusinessMs(H, at('2026-10-27T03:00:00-03:00'), 30 * 60_000).toISOString()).toBe(at('2026-10-27T08:30:00-03:00').toISOString())
  })

  it('texto do horário junta os dias iguais', () => {
    expect(describeHours(H)).toBe('seg. a sex. das 08:00 às 12:00 e das 13:30 às 18:00')
  })
})

describe('Prazos da pré e da pós-venda no horário comercial', () => {
  it('24 horas de prazo na sexta à tarde vencem só na terça', () => {
    // 8,5 h de atendimento por dia: sexta 17h + 24 h = 1 h na sexta + 8,5 seg + 8,5 ter + 6 h qua -> quarta 15h30.
    expect(deadline(at('2026-10-30T17:00:00-03:00'), 24, H).toISOString()).toBe(at('2026-11-04T15:30:00-03:00').toISOString())
    expect(deadline(at('2026-10-30T17:00:00-03:00'), 24, null).toISOString()).toBe(at('2026-10-31T17:00:00-03:00').toISOString())
  })

  it('retorno do vendedor atrasado só conta o horário comercial', () => {
    const r = { forwarded: true, returnStatus: 'PENDENTE' as const, forwardedAt: at('2026-10-30T17:00:00-03:00') }
    // Segunda 9h: só 2 h de atendimento desde o repasse.
    expect(isOverdue(r, 4, at('2026-11-02T09:00:00-03:00'), H)).toBe(false)
    expect(isOverdue(r, 4, at('2026-11-02T09:00:00-03:00'), null)).toBe(true)
    expect(isOverdue(r, 4, at('2026-11-02T11:01:00-03:00'), H)).toBe(true)
  })

  it('prazo para chamar o cliente usa o horário comercial', () => {
    const next = { kind: 'PRE_VENDAS' as const, forwarded: true, saleStatus: 'NEGOCIACAO' as const }
    expect(nextCallDue(next, null, 2, null, at('2026-10-26T11:00:00-03:00'), H)?.toISOString()).toBe(at('2026-10-26T14:30:00-03:00').toISOString())
  })
})

describe('Mensagem depois do repasse e motivos sem pós-venda', () => {
  it('padrão na hora do repasse, limites e texto', () => {
    const c = cleanForwardMessage({ enabled: true, text: '  ' })
    expect(c.delayMinutes).toBe(0)
    expect(c.text).toContain('{vendedor}')
    expect(cleanForwardMessage({ delayMinutes: 0 }).delayMinutes).toBe(0)
    expect(cleanForwardMessage({ delayMinutes: -5 }).delayMinutes).toBe(0)
    expect(cleanForwardMessage({ delayMinutes: 90, gapMin: 30, gapMax: 5 })).toMatchObject({ delayMinutes: 90, gapMin: 5, gapMax: 30, enabled: false })
  })

  it('pergunta se o vendedor entrou em contato: 30 minutos e texto próprio', () => {
    const c = cleanContactCheck({ enabled: true, text: '' })
    expect(c.delayMinutes).toBe(30)
    expect(c.text).toMatch(/já entrou em contato/)
    expect(cleanContactCheck({ delayMinutes: 45 }).delayMinutes).toBe(45)
  })

  it('motivos de produto em falta não geram pós-venda', () => {
    for (const r of ['Não temos o produto', 'Sem produto', 'Sem estoque', 'Produto indisponível', 'Não trabalhamos com essa peça', 'Peça em falta']) expect(skipsPostSale(r), r).toBe(true)
    for (const r of ['Preço', 'Prazo de entrega', 'Comprou com concorrente', 'Cliente não respondeu', 'Frete caro']) expect(skipsPostSale(r), r).toBe(false)
  })
})

describe('Resumo dos vendedores: semanal, quinzenal e mensal', () => {
  it('quinzenal: 1 a 15 sai no dia 16; 16 ao fim do mês sai no dia 1º', () => {
    const a = reportCycle('QUINZENAL', '08:00', at('2026-10-16T09:00:00-03:00'))
    expect(a).toMatchObject({ key: '2026-10-16', label: '01/10 a 15/10', due: true, word: 'quinzenal' })
    expect(a.from.toISOString()).toBe(at('2026-10-01T00:00:00-03:00').toISOString())
    expect(a.prevFrom.toISOString()).toBe(at('2026-09-16T00:00:00-03:00').toISOString())
    const b = reportCycle('QUINZENAL', '08:00', at('2026-11-01T07:00:00-03:00'))
    expect(b).toMatchObject({ key: '2026-11-01', label: '16/10 a 31/10', due: false })
    expect(reportCycle('QUINZENAL', '08:00', at('2026-11-05T09:00:00-03:00')).due).toBe(false)
  })

  it('mensal: o mês anterior, enviado no dia 1º (inclusive na virada do ano)', () => {
    const c = reportCycle('MENSAL', '08:00', at('2027-01-01T10:00:00-03:00'))
    expect(c).toMatchObject({ key: '2027-01-01', label: '01/12 a 31/12', due: true, word: 'mensal' })
    expect(c.prevFrom.toISOString()).toBe(at('2026-11-01T00:00:00-03:00').toISOString())
  })

  it('semanal continua de sexta a quinta', () => {
    expect(reportCycle('SEMANAL', '08:00', at('2026-10-30T09:00:00-03:00'))).toMatchObject({ key: '2026-10-30', due: true, word: 'semanal' })
  })

  it('o título diz a frequência', () => {
    const stats = weeklyStats([{ sellerId: 's', name: 'A', saleStatus: 'SIM', saleValue: 10, returnStatus: null, calledAt: null, lostReason: null }])
    expect(weeklyMessage({ seller: 'Ana', label: '01/10 a 31/10', stats, prev: null, team: { conversion: null }, closedInWeek: 0, suggestions: [], word: 'mensal' })).toMatch(/^\*Resumo mensal: 01\/10 a 31\/10\*/)
  })
})
