import { describe, expect, it } from 'vitest'
import { summarize } from '../src/fretes/gerencial'
import { cleanWeeklyFreight, spNow, weeklyDue, weeklyFreightEmail, weeklyPeriod } from '../src/fretes/resumo-semanal'

describe('resumo semanal de fretes', () => {
  it('limpa a configuração (e-mails válidos, sem repetir)', () => {
    const c = cleanWeeklyFreight({ active: true, weekday: 1, hour: 9, emails: 'a@x.com.br; A@x.com.br, ruim, b@y.com' })
    expect(c).toEqual({ active: true, weekday: 1, hour: 9, emails: ['a@x.com.br', 'b@y.com'], unitId: null })
    expect(cleanWeeklyFreight({ weekday: 9, hour: 30 })).toMatchObject({ active: false, weekday: 1, hour: 8 })
  })

  it('hora de enviar no fuso de São Paulo, uma vez por dia', () => {
    // 2026-11-23 é segunda; 11:30 UTC = 08:30 em São Paulo.
    const now = new Date('2026-11-23T11:30:00Z')
    expect(spNow(now)).toEqual({ date: '2026-11-23', weekday: 1, hour: 8 })
    const cfg = cleanWeeklyFreight({ active: true, weekday: 1, hour: 8, emails: ['a@x.com'] })
    expect(weeklyDue(cfg, now, null)).toBe(true)
    expect(weeklyDue(cfg, now, '2026-11-23')).toBe(false)
    expect(weeklyDue({ ...cfg, hour: 9 }, now, null)).toBe(false)
    expect(weeklyDue({ ...cfg, emails: [] }, now, null)).toBe(false)
  })

  it('período: os 7 dias anteriores', () => {
    expect(weeklyPeriod('2026-11-23')).toEqual({ from: '2026-11-16', to: '2026-11-22' })
  })

  it('monta o e-mail com os números e escapa os nomes', () => {
    const s = summarize([{ carrier: 'T <A>', month: '2026-11', total: 120, expected: 100, recStatus: 'DIVERGENTE', credit: null, weight: 10, nota: 80, seller: 'Ana', uf: 'SC', city: 'Itajai', customer: 'C' }], 1)
    const m = weeklyFreightEmail(s, { from: '2026-11-16', to: '2026-11-22', appName: 'CRM', unitName: null, link: 'https://crm/x', color: '#123456' })
    expect(m.subject).toContain('16/11/2026 a 22/11/2026')
    expect(m.html).toContain('T &lt;A&gt;')
    expect(m.html).toContain('Ana')
    expect(m.text).toContain('Ana: 1 nota(s)')
  })
})
