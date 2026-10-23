import { describe, expect, it } from 'vitest'
import { cleanWeekly, weeklyCycle, weeklyFor, weeklyMessage, type WeeklyRow, weeklyStats, weeklySuggestions } from '../src/atendimento/semanal'

const row = (o: Partial<WeeklyRow> = {}): WeeklyRow => ({ sellerId: 's1', name: 'Cliente', saleStatus: 'NEGOCIACAO', saleValue: null, returnStatus: null, calledAt: null, lostReason: null, ...o })

describe('relatório semanal do vendedor: ciclo de sexta a quinta', () => {
  it('na sexta 23/10, a partir do horário, sai o ciclo 16/10 a 22/10', () => {
    const c = weeklyCycle('08:00', new Date('2026-10-23T09:00:00-03:00'))
    expect(c).toMatchObject({ key: '2026-10-23', label: '16/10 a 22/10', due: true })
    expect(c.from.toISOString()).toBe('2026-10-16T03:00:00.000Z')
    expect(c.to.toISOString()).toBe('2026-10-23T03:00:00.000Z')
    expect(c.prevFrom.toISOString()).toBe('2026-10-09T03:00:00.000Z')
  })

  it('antes do horário da sexta ainda não sai; nos outros dias também não (a prévia mostra o último ciclo)', () => {
    expect(weeklyCycle('08:00', new Date('2026-10-23T07:59:00-03:00')).due).toBe(false)
    const monday = weeklyCycle('08:00', new Date('2026-10-26T10:00:00-03:00'))
    expect(monday).toMatchObject({ key: '2026-10-23', label: '16/10 a 22/10', due: false })
    const thursday = weeklyCycle('08:00', new Date('2026-10-29T23:00:00-03:00'))
    expect(thursday).toMatchObject({ key: '2026-10-23', due: false })
    // 23h de quinta em São Paulo já é sexta em UTC: o ciclo segue o horário de Brasília.
    expect(weeklyCycle('08:00', new Date('2026-10-30T08:30:00-03:00'))).toMatchObject({ key: '2026-10-30', label: '23/10 a 29/10', due: true })
  })

  it('configuração: desligado por padrão, 08:00, todos os vendedores', () => {
    expect(cleanWeekly(undefined)).toMatchObject({ enabled: false, time: '08:00', numberId: null, allSellers: true, sellerIds: [] })
    expect(cleanWeekly({ sections: ['origens', 'repassados', 'xx'] as never }).sections).toEqual(['repassados', 'origens'])
    const c = cleanWeekly({ enabled: true, allSellers: false, sellerIds: ['a', 'a', 'b'], time: '25:00' })
    expect(c.time).toBe('08:00')
    expect(c.sellerIds).toEqual(['a', 'b'])
    expect(weeklyFor(c, 'a')).toBe(true)
    expect(weeklyFor(c, 'z')).toBe(false)
  })
})

describe('relatório semanal do vendedor: números e sugestões', () => {
  const rows = [
    row({ name: 'Ana', saleStatus: 'SIM', saleValue: 1000, calledAt: new Date() }),
    row({ name: 'Bruno', saleStatus: 'SIM', saleValue: 500, returnStatus: 'SIM' }),
    row({ name: 'Carla', saleStatus: 'NAO', lostReason: 'Preço' }),
    row({ name: 'Davi', saleStatus: 'NAO', lostReason: 'Preço' }),
    row({ name: 'Edu' }),
    row({ name: 'Fábio', calledAt: new Date() }),
    row({ name: 'Gil' }),
    row({ name: 'Hugo' }),
  ]

  it('leads repassados, vendas, conversão (vendas ÷ leads), ticket e quem está sem contato', () => {
    const s = weeklyStats(rows)
    expect(s).toMatchObject({ forwarded: 8, sales: 2, conversion: 25, revenue: 1500, ticket: 750, negotiating: 4, lost: 2, topLost: { reason: 'Preço', count: 2 } })
    expect(s.noContact).toEqual(['Edu', 'Gil', 'Hugo'])
    expect(weeklyStats([]).conversion).toBeNull()
  })

  it('sugere chamar quem está sem contato, compara com a equipe e aponta o motivo de perda', () => {
    const s = weeklyStats(rows)
    const tips = weeklySuggestions(s, { conversion: 40 }, null)
    expect(tips).toHaveLength(3)
    expect(tips[0]).toContain('3 cliente(s) ainda sem contato registrado no CRM (Edu, Gil, Hugo)')
    expect(tips[1]).toContain('abaixo da média da equipe (40%)')
    expect(tips[2]).toMatch(/negociação/)
    const great = weeklySuggestions(weeklyStats([row({ saleStatus: 'SIM', calledAt: new Date() }), row({ saleStatus: 'SIM', calledAt: new Date() }), row({ saleStatus: 'SIM', calledAt: new Date() })]), { conversion: 30 }, null)
    expect(great[0]).toContain('Parabéns')
  })

  it('mensagem do WhatsApp com o período, os números e as sugestões', () => {
    const s = weeklyStats(rows)
    const msg = weeklyMessage({ seller: 'Vinicius Wiliam Teixeira', label: '16/10 a 22/10', stats: s, prev: weeklyStats(rows.slice(0, 4)), team: { conversion: 40 }, closedInWeek: 3, suggestions: weeklySuggestions(s, { conversion: 40 }, null) })
    expect(msg).toContain('*Resumo semanal: 16/10 a 22/10*')
    expect(msg).toContain('Olá, Vinicius!')
    expect(msg).toContain('Leads repassados: *8* (ciclo anterior: 4)')
    expect(msg).toContain('Vendas realizadas: *2* (ciclo anterior: 2)')
    expect(msg).toContain('Valor vendido: R$ 1.500,00 · ticket médio R$ 750,00')
    expect(msg).toContain('Conversão (vendas ÷ leads): *25%* (ciclo anterior: 50%)')
    expect(msg).toContain('Média da equipe: 40%')
    expect(msg).toContain('também fechou 1 venda(s) de repasses anteriores')
    expect(msg).toContain('*Sugestões*')
    // Só o que foi escolhido
    const short = weeklyMessage({ seller: 'Ana', label: '16/10 a 22/10', stats: s, prev: null, team: { conversion: 40 }, closedInWeek: 0, suggestions: [], sections: ['repassados', 'motivos', 'sem_contato'] })
    expect(short).toContain('Leads repassados: *8*')
    expect(short).toContain('Motivos de perda: Preço (2)')
    expect(short).toContain('*Ainda sem contato registrado (3)*')
    expect(short).not.toContain('Conversão')
    expect(short).not.toContain('Média da equipe')
  })

  it('retorno ao cliente: taxa e tempo médio; marcas, peças e origem mais frequentes', () => {
    const f = new Date('2026-10-16T10:00:00-03:00')
    const s = weeklyStats([
      row({ returnStatus: 'SIM', forwardedAt: f, returnedAt: new Date(f.getTime() + 2 * 3_600_000), brands: ['JCB'], partTypes: ['Filtro'], origin: 'Google Ads' }),
      row({ returnStatus: 'SIM', forwardedAt: f, returnedAt: new Date(f.getTime() + 4 * 3_600_000), brands: ['JCB', 'CAT'], origin: 'Google Ads' }),
      row({ brands: ['CAT'], origin: 'Site' }),
      row({}),
    ])
    expect(s).toMatchObject({ returnRate: 50, returnHours: 3 })
    expect(s.brands).toEqual([{ name: 'CAT', count: 2 }, { name: 'JCB', count: 2 }])
    expect(s.origins[0]).toEqual({ name: 'Google Ads', count: 2 })
    const msg = weeklyMessage({ seller: 'Ana', label: 'x', stats: s, prev: null, team: { conversion: null }, closedInWeek: 0, suggestions: [], sections: ['retorno', 'marcas', 'pecas', 'origens'] })
    expect(msg).toContain('Retorno ao cliente: 50% · em média 3 h depois do repasse')
    expect(msg).toContain('Marcas mais pedidas: CAT (2), JCB (2)')
    expect(msg).toContain('Peças mais pedidas: Filtro (1)')
    expect(msg).toContain('Origem dos leads: Google Ads (2), Site (1)')
  })
})
