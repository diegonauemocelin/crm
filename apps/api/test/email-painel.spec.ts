import { describe, expect, it } from 'vitest'
import { attributeSales, bestSlot, BOUNCE_SQL, insights, rates, sumSales } from '../src/email/painel'

const d = (s: string) => new Date(s)
const click = (leadId: string, campaignId: string, at: string, automationId: string | null = null) => ({ leadId, campaignId, automationId, at: d(at) })
const sale = (id: string, leadId: string, at: string, value: number) => ({ id, leadId, at: d(at), value, source: 'loja' as const })

describe('dashboard do e-mail: taxas', () => {
  it('calcula sobre os entregues e cliques por abertura', () => {
    const r = rates({ sent: 900, failed: 100, bounced: 30, opened: 270, clicked: 54, unsubscribed: 9 })
    expect(r.delivery).toBe(0.9)
    expect(r.bounce).toBe(0.03)
    expect(r.open).toBe(0.3)
    expect(r.click).toBe(0.06)
    expect(r.clickToOpen).toBe(0.2)
    expect(r.unsubscribe).toBe(0.01)
  })

  it('sem envios, as taxas ficam vazias (nunca divisão por zero)', () => {
    const r = rates({ sent: 0, failed: 0, bounced: 0, opened: 0, clicked: 0, unsubscribed: 0 })
    expect(r.open).toBeNull()
    expect(r.delivery).toBeNull()
  })

  it('o critério de devolução reconhece e-mail inexistente', () => {
    const re = new RegExp(BOUNCE_SQL, 'i')
    expect(re.test('550 5.1.1 User unknown')).toBe(true)
    expect(re.test('421 tente mais tarde')).toBe(false)
    expect(re.test('Erro 15500 interno')).toBe(false)
  })
})

describe('dashboard do e-mail: vendas de quem clicou', () => {
  it('atribui ao último clique antes da compra dentro da janela', () => {
    const clicks = [click('L1', 'C1', '2026-10-01T10:00:00Z'), click('L1', 'C2', '2026-10-05T10:00:00Z', 'A1'), click('L1', 'C3', '2026-10-09T10:00:00Z')]
    const out = attributeSales(clicks, [sale('P1', 'L1', '2026-10-06T12:00:00Z', 500)], 7)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ campaignId: 'C2', automationId: 'A1', value: 500 })
  })

  it('não conta compra fora da janela, antes do clique ou de outro lead', () => {
    const clicks = [click('L1', 'C1', '2026-10-01T10:00:00Z')]
    expect(attributeSales(clicks, [sale('P1', 'L1', '2026-10-10T10:00:00Z', 100)], 7)).toHaveLength(0)
    expect(attributeSales(clicks, [sale('P2', 'L1', '2026-09-30T10:00:00Z', 100)], 7)).toHaveLength(0)
    expect(attributeSales(clicks, [sale('P3', 'L2', '2026-10-02T10:00:00Z', 100)], 7)).toHaveLength(0)
    expect(attributeSales(clicks, [sale('P1', 'L1', '2026-10-10T10:00:00Z', 100)], 14)).toHaveLength(1)
  })

  it('cada venda conta uma vez e o total arredonda em centavos', () => {
    const clicks = [click('L1', 'C1', '2026-10-01T10:00:00Z'), click('L1', 'C1', '2026-10-01T11:00:00Z')]
    const out = attributeSales(clicks, [sale('P1', 'L1', '2026-10-02T10:00:00Z', 10.1), sale('P2', 'L1', '2026-10-03T10:00:00Z', 20.2)], 7)
    expect(sumSales(out)).toEqual({ count: 2, revenue: 30.3 })
  })
})

describe('dashboard do e-mail: o que chama atenção', () => {
  const empty = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0))

  it('melhor horário só com volume suficiente', () => {
    const g = empty()
    g[2]![9] = 3
    expect(bestSlot(g)).toBeNull()
    g[2]![9] = 40
    g[4]![15] = 20
    expect(bestSlot(g)).toEqual({ weekday: 'terça', hour: 9 })
  })

  it('alerta devolução e descadastro altos e destaca as vendas', () => {
    const list = insights({ funnel: { sent: 1000, failed: 50, bounced: 40, opened: 100, clicked: 20, unsubscribed: 10 }, previousOpen: 0.25, campaigns: [], slot: null, revenue: 1234.5, sales: 3, windowDays: 7 })
    const text = list.map((i) => i.text).join(' | ')
    expect(text).toMatch(/inexistente/)
    expect(text).toMatch(/Descadastros/)
    expect(text).toMatch(/Abertura de 10%/)
    expect(text).toMatch(/caiu 15 pontos/)
    expect(text).toMatch(/3 venda\(s\).*R\$\s?1\.234,50/)
  })

  it('sem envio no período, avisa só isso', () => {
    expect(insights({ funnel: { sent: 0, failed: 0, bounced: 0, opened: 0, clicked: 0, unsubscribed: 0 }, previousOpen: null, campaigns: [], slot: null, revenue: 0, sales: 0, windowDays: 7 })).toEqual([{ tone: 'neutro', text: 'Nenhum e-mail enviado no período.' }])
  })
})
