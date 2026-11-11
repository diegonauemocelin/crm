import { describe, expect, it } from 'vitest'
import { EvolutionClient, instanceSettings } from '../src/whatsapp/evolution'
import {
  chunks,
  HISTORY_HOURS,
  HISTORY_IDLE_MS,
  HISTORY_WAIT_MS,
  historyConvKey,
  historyConvWhere,
  historyFrom,
  historyHours,
  historyIsLast,
  historyKnownWhere,
  historyNote,
  historyPatch,
  historyStale,
  importDays,
  isOldHistory,
  matchHistoryConversation,
  pickHistory,
} from '../src/whatsapp/historico'
import { parseMessage } from '../src/whatsapp/mensagens'

const H = 3_600_000
const now = new Date('2026-11-11T18:00:00Z')
const ago = (h: number) => new Date(now.getTime() - h * H)
const CLIENT = '5549988887777@s.whatsapp.net'
const NUM_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const NUM_B = 'bbbbbbbb-0000-0000-0000-000000000002'

function msg(id: string, hoursAgo: number, o: { jid?: string; fromMe?: boolean; text?: string } = {}) {
  return {
    key: { id, remoteJid: o.jid ?? CLIENT, fromMe: o.fromMe ?? false },
    pushName: o.fromMe ? 'Você' : 'Cliente Teste',
    message: { conversation: o.text ?? 'oi' },
    messageTimestamp: Math.floor(ago(hoursAgo).getTime() / 1000),
  }
}
const parsed = (m: ReturnType<typeof msg>) => parseMessage(m)!

describe('Importar mensagens do aparelho: período', () => {
  it('período só 2 a 30 dias (padrão 15) e janela em horas', () => {
    expect([importDays(2), importDays(7), importDays(15), importDays(30)]).toEqual([2, 7, 15, 30])
    expect([importDays(1), importDays(31), importDays('x'), importDays(undefined), importDays(7.5)]).toEqual([15, 15, 15, 15, 15])
    expect(historyHours({ importHistory: false, importHistoryDays: 30 })).toBe(HISTORY_HOURS)
    expect(historyHours({ importHistory: true, importHistoryDays: 15 })).toBe(15 * 24)
    expect(historyHours({ importHistory: true, importHistoryDays: 2 })).toBe(48)
    expect(historyHours({ importHistory: true, importHistoryDays: 99 })).toBe(15 * 24)
  })

  it('a janela respeita os pisos (cadastro do número)', () => {
    const hours = historyHours({ importHistory: true, importHistoryDays: 15 })
    expect(historyFrom(now, [], hours)).toEqual(ago(15 * 24))
    expect(historyFrom(now, [ago(72)], hours)).toEqual(ago(72))
    const pick = pickHistory([msg('A1', 24 * 10), msg('A2', 24 * 20), msg('A3', 1)], historyFrom(now, [], hours))
    expect(pick.items.map((p) => p.waId)).toEqual(['A1', 'A3'])
    expect(pick.foraDaJanela).toBe(1)
  })

  it('a Evolution pede o histórico completo só com a opção ligada', async () => {
    expect(instanceSettings(false)).toMatchObject({ syncFullHistory: false, groupsIgnore: false, rejectCall: false, alwaysOnline: false, readMessages: false, readStatus: false })
    expect(instanceSettings(true).syncFullHistory).toBe(true)
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return new Response('{}')
    }) as typeof fetch
    const c = new EvolutionClient({ url: 'http://evo', apiKey: 'k' }, fake)
    await c.setSettings('crm-abc123', true)
    await c.setSettings('crm-abc123')
    await c.createInstance('crm-abc123', 'http://api/x', true)
    expect(calls[0]).toMatchObject({ url: 'http://evo/settings/set/crm-abc123', body: { syncFullHistory: true } })
    // A Evolution exige todos os campos no /settings/set.
    expect(Object.keys(calls[0]!.body).sort()).toEqual(['alwaysOnline', 'groupsIgnore', 'readMessages', 'readStatus', 'rejectCall', 'syncFullHistory'])
    expect(calls[1]!.body.syncFullHistory).toBe(false)
    expect(calls[2]!.body).toMatchObject({ instanceName: 'crm-abc123', syncFullHistory: true })
  })
})

describe('Importar mensagens do aparelho: números não se misturam', () => {
  const m = parsed(msg('X1', 5))

  it('mesmo contato em dois números: duas chaves de conversa diferentes', () => {
    expect(historyConvKey(NUM_A, m)).not.toBe(historyConvKey(NUM_B, m))
    expect(historyConvKey(NUM_A, m)).toBe(`${NUM_A}:+5549988887777`)
    // A chave é a mesma da mensagem que chega ao vivo no mesmo número (mesma fila de gravação).
    expect(historyConvKey(NUM_A, parsed(msg('X2', 1)))).toBe(historyConvKey(NUM_A, m))
  })

  it('a busca da conversa é sempre dentro do número que recebeu', () => {
    const w = historyConvWhere(NUM_A, m)
    expect(w.numberId).toBe(NUM_A)
    expect(w.OR).toEqual([{ jid: CLIENT }, { phone: '+5549988887777' }])
    const lid = parseMessage({ key: { id: 'L1', remoteJid: '123456789@lid', fromMe: false }, message: { conversation: 'oi' }, messageTimestamp: 1 })!
    expect(historyConvWhere(NUM_B, lid)).toEqual({ numberId: NUM_B, OR: [{ jid: '123456789@lid' }, { lid: '123456789@lid' }] })
  })

  it('conversa do mesmo contato em outro número nunca é reaproveitada', () => {
    const convB = { id: 'conv-b', numberId: NUM_B, jid: CLIENT, phone: '+5549988887777', lid: null }
    // Só existe no número B: a mensagem do número A abre conversa nova no A.
    expect(matchHistoryConversation([convB], NUM_A, m)).toBeNull()
    const convA = { id: 'conv-a', numberId: NUM_A, jid: 'outro@s.whatsapp.net', phone: '+5549988887777', lid: null }
    expect(matchHistoryConversation([convB, convA], NUM_A, m)?.id).toBe('conv-a')
    expect(matchHistoryConversation([convB, convA], NUM_B, m)?.id).toBe('conv-b')
  })

  it('prioridade dentro do número: contato, depois telefone, depois @lid', () => {
    const byPhone = { id: 'p', numberId: NUM_A, jid: 'x@s.whatsapp.net', phone: '+5549988887777', lid: null }
    const byJid = { id: 'j', numberId: NUM_A, jid: CLIENT, phone: null, lid: null }
    expect(matchHistoryConversation([byPhone, byJid], NUM_A, m)?.id).toBe('j')
    const lid = parseMessage({ key: { id: 'L1', remoteJid: '999@lid', fromMe: false }, message: { conversation: 'oi' }, messageTimestamp: 1 })!
    const byLid = { id: 'l', numberId: NUM_A, jid: CLIENT, phone: '+5549988887777', lid: '999@lid' }
    expect(matchHistoryConversation([byLid], NUM_A, lid)?.id).toBe('l')
    expect(matchHistoryConversation([{ ...byLid, numberId: NUM_B }], NUM_A, lid)).toBeNull()
  })

  it('histórico do número A não toca conversas do número B (simulação)', () => {
    type Conv = { id: string; numberId: string; jid: string; phone: string | null; lid: string | null; msgs: string[] }
    const db: Conv[] = [{ id: 'b1', numberId: NUM_B, jid: CLIENT, phone: '+5549988887777', lid: null, msgs: ['B-ao-vivo'] }]
    const store = (numberId: string, p: ReturnType<typeof parsed>) => {
      const w = historyConvWhere(numberId, p)
      const candidates = db.filter((c) => c.numberId === w.numberId && w.OR.some((o) => Object.entries(o).every(([k, v]) => c[k as 'jid'] === v)))
      let conv = matchHistoryConversation(candidates, numberId, p)
      if (!conv) db.push((conv = { id: `c${db.length}`, numberId, jid: p.jid, phone: null, lid: null, msgs: [] }))
      if (!conv.msgs.includes(p.waId)) conv.msgs.push(p.waId)
    }
    const pick = pickHistory([msg('H1', 30), msg('H2', 20, { fromMe: true }), msg('H3', 2)], historyFrom(now, [], 15 * 24))
    for (const p of pick.items) store(NUM_A, p)
    expect(db.find((c) => c.id === 'b1')!.msgs).toEqual(['B-ao-vivo'])
    const a = db.filter((c) => c.numberId === NUM_A)
    expect(a).toHaveLength(1)
    expect(a[0]!.msgs).toEqual(['H1', 'H2', 'H3'])
    // O mesmo histórico chegando também no número B entra na conversa do B, separada da do A.
    for (const p of pick.items) store(NUM_B, p)
    expect(db.find((c) => c.id === 'b1')!.msgs).toEqual(['B-ao-vivo', 'H1', 'H2', 'H3'])
    expect(a[0]!.msgs).toEqual(['H1', 'H2', 'H3'])
  })

  it('mensagens já gravadas: a conferência é só nas conversas do próprio número', () => {
    expect(historyKnownWhere('t1', NUM_A, ['X1'])).toEqual({ tenantId: 't1', waId: { in: ['X1'] }, conversation: { numberId: NUM_A } })
  })
})

describe('Importar mensagens do aparelho: volume e mensagens antigas', () => {
  it('lotes e repetidas no mesmo pedaço', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunks([], 200)).toEqual([])
    const pick = pickHistory([msg('D1', 3), msg('D1', 3), msg('D2', 4)], ago(24 * 15))
    expect(pick.items.map((p) => p.waId)).toEqual(['D2', 'D1'])
    expect(pick.ignoradas).toBe(1)
  })

  it('mensagem com mais de 48 h só entra como registro (sem não lida, sem reabrir, sem tempo de espera)', () => {
    expect(isOldHistory(ago(49), now)).toBe(true)
    expect(isOldHistory(ago(47), now)).toBe(false)
    const conv = { lastMessageAt: null, lastInboundAt: null, lastFromMe: false, noReplyNeeded: false, closedAt: ago(1), botFlowId: null, phone: null, name: null }
    const old = historyPatch(conv, parsed(msg('O1', 24 * 5)), { phone: '+5549988887777', name: 'Cliente', old: true })
    expect(old).toMatchObject({ lastInboundAt: ago(24 * 5), noReplyNeeded: true, lastFromMe: false, phone: '+5549988887777', name: 'Cliente' })
    expect(old).not.toHaveProperty('unread')
    expect(old).not.toHaveProperty('status')
    expect(old).not.toHaveProperty('closedAt')
    // Recente (dentro das 48 h): como antes, conta como não lida e reabre.
    const recent = historyPatch(conv, parsed(msg('R1', 3)), { phone: null, name: null })
    expect(recent).toMatchObject({ unread: { increment: 1 }, status: 'ABERTA', noReplyNeeded: false })
  })

  it('fim da importação: aviso do WhatsApp ou tempo parado', () => {
    expect(historyIsLast({ isLatest: true })).toBe(true)
    expect(historyIsLast({ progress: 100 })).toBe(true)
    expect(historyIsLast({ progress: 40, isLatest: false })).toBe(false)
    expect(historyIsLast({})).toBe(false)
    const base = { status: 'CONECTADO', connectedAt: new Date(now.getTime() - HISTORY_WAIT_MS - 1), historyUpdatedAt: null }
    expect(historyStale({ ...base, historyStatus: 'AGUARDANDO' }, now)).toBe(true)
    expect(historyStale({ ...base, historyStatus: 'AGUARDANDO', status: 'CONECTANDO' }, now)).toBe(false)
    expect(historyStale({ ...base, historyStatus: 'IMPORTANDO', historyUpdatedAt: new Date(now.getTime() - 60_000) }, now)).toBe(false)
    expect(historyStale({ ...base, historyStatus: 'IMPORTANDO', historyUpdatedAt: new Date(now.getTime() - HISTORY_IDLE_MS - 1) }, now)).toBe(true)
    expect(historyStale({ ...base, historyStatus: 'CONCLUIDO' }, now)).toBe(false)
  })

  it('nota da importação do aparelho', () => {
    expect(historyNote(1, 15)).toMatch(/^1 mensagem foi importada do aparelho \(Importar mensagens do aparelho, últimos 15 dias\)/)
    expect(historyNote(12, 7)).toMatch(/^12 mensagens foram importadas/)
    expect(historyNote(12, 7)).toMatch(/nenhuma resposta automática foi enviada/)
    expect(historyNote(3)).toMatch(/^3 mensagens que não tinham chegado ao CRM foram recuperadas/)
  })
})
