import { describe, expect, it } from 'vitest'
import { cleanNextDay, DEFAULT_NEXT_DAY_TEXT, isCallOverdue, nextCallDue, nextDayWindow } from '../src/atendimento/regras'

const H = 3_600_000
const now = new Date('2026-10-20T15:00:00Z')
const neg = { kind: 'PRE_VENDAS' as const, forwarded: true, saleStatus: 'NEGOCIACAO' as const }

describe('em negociação: prazo para chamar o cliente', () => {
  it('ao entrar em negociação, o prazo é agora + horas configuradas', () => {
    expect(nextCallDue(neg, { ...neg, forwarded: false, callDueAt: null }, 24, undefined, now)).toEqual(new Date(now.getTime() + 24 * H))
    expect(nextCallDue(neg, null, 48, undefined, now)).toEqual(new Date(now.getTime() + 48 * H))
  })

  it('continuando em negociação, mantém o prazo; a data escolhida na ficha vale', () => {
    const due = new Date('2026-10-21T12:00:00Z')
    expect(nextCallDue(neg, { ...neg, callDueAt: due }, 24, undefined, now)).toEqual(due)
    const chosen = new Date('2026-10-25T12:00:00Z')
    expect(nextCallDue(neg, { ...neg, callDueAt: due }, 24, chosen, now)).toEqual(chosen)
  })

  it('fora da negociação não há prazo', () => {
    const due = new Date('2026-10-21T12:00:00Z')
    expect(nextCallDue({ ...neg, saleStatus: 'SIM' }, { ...neg, callDueAt: due }, 24, undefined, now)).toBeNull()
    expect(nextCallDue({ ...neg, forwarded: false }, { ...neg, callDueAt: due }, 24, undefined, now)).toBeNull()
    expect(nextCallDue({ ...neg, kind: 'POS_VENDAS' }, null, 24, undefined, now)).toBeNull()
  })

  it('avisa só depois do prazo e enquanto estiver em negociação', () => {
    expect(isCallOverdue({ ...neg, callDueAt: new Date(now.getTime() - 1) }, now)).toBe(true)
    expect(isCallOverdue({ ...neg, callDueAt: new Date(now.getTime() + H) }, now)).toBe(false)
    expect(isCallOverdue({ ...neg, saleStatus: 'NAO', callDueAt: new Date(now.getTime() - H) }, now)).toBe(false)
    expect(isCallOverdue({ ...neg, callDueAt: null }, now)).toBe(false)
  })
})

describe('mensagem automática no dia seguinte', () => {
  it('configuração inválida volta para o padrão (desligada)', () => {
    expect(cleanNextDay(null)).toEqual({ enabled: false, time: '09:00', text: DEFAULT_NEXT_DAY_TEXT, numberId: null })
    expect(cleanNextDay({ enabled: true, time: '25:00', text: '  ' })).toMatchObject({ enabled: true, time: '09:00', text: DEFAULT_NEXT_DAY_TEXT })
    expect(cleanNextDay({ enabled: true, time: '08:30', text: ' Oi {nome} ' })).toMatchObject({ time: '08:30', text: 'Oi {nome}' })
  })

  it('antes do horário (São Paulo) não envia; depois, vale para quem abriu pré-venda ontem', () => {
    // 11:59 em São Paulo
    expect(nextDayWindow('12:00', new Date('2026-10-20T14:59:00Z'))).toBeNull()
    const w = nextDayWindow('12:00', new Date('2026-10-20T15:00:00Z'))!
    expect(w.day).toBe('2026-10-19')
    expect(w.from.toISOString()).toBe('2026-10-19T03:00:00.000Z')
    expect(w.to.toISOString()).toBe('2026-10-20T03:00:00.000Z')
  })

  it('a virada do dia é a de São Paulo, não a do servidor (UTC)', () => {
    // 22h de 20/10 em São Paulo = 01h de 21/10 em UTC: ainda é dia 20, "ontem" é 19.
    expect(nextDayWindow('09:00', new Date('2026-10-21T01:00:00Z'))!.day).toBe('2026-10-19')
  })
})
