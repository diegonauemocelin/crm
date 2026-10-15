import { describe, expect, it } from 'vitest'
import { cleanHours, cleanRules, DEFAULT_AWAY_TEXT, DEFAULT_HOURS, isOpen, parseReceipts, receiptUpgrades } from '../src/whatsapp/envio'

describe('WhatsApp: horário comercial', () => {
  const on = { ...DEFAULT_HOURS, enabled: true }
  // Datas em UTC: Brasília = UTC-3.
  it('aberto de segunda a sexta das 8h às 18h e sábado até 12h (horário de Brasília)', () => {
    expect(isOpen(on, new Date('2026-10-14T11:00:00Z'))).toBe(true) // quarta, 8h
    expect(isOpen(on, new Date('2026-10-14T10:59:00Z'))).toBe(false) // quarta, 7h59
    expect(isOpen(on, new Date('2026-10-14T20:59:00Z'))).toBe(true) // quarta, 17h59
    expect(isOpen(on, new Date('2026-10-14T21:00:00Z'))).toBe(false) // quarta, 18h
    expect(isOpen(on, new Date('2026-10-17T14:00:00Z'))).toBe(true) // sábado, 11h
    expect(isOpen(on, new Date('2026-10-17T15:30:00Z'))).toBe(false) // sábado, 12h30
    expect(isOpen(on, new Date('2026-10-18T14:00:00Z'))).toBe(false) // domingo
    expect(isOpen(on, new Date('2026-10-15T02:00:00Z'))).toBe(false) // quarta, 23h (já quinta em UTC)
    expect(isOpen({ ...on, enabled: false }, new Date('2026-10-18T14:00:00Z'))).toBe(true) // desligado = sempre aberto
  })

  it('confere cada dia: horário inválido ou fim antes do início vira fechado', () => {
    const h = cleanHours({ enabled: true, days: [null, { start: '08:00', end: '18:00' }, { start: '18:00', end: '08:00' }, { start: '25:00', end: '26:00' }, { start: '8:00', end: '12:00' }] as never })
    expect(h.days).toEqual([null, { start: '08:00', end: '18:00' }, null, null, null, null, null])
    expect(cleanHours(undefined)).toEqual({ ...DEFAULT_HOURS, enabled: false })
  })

  it('mensagem de ausência: texto padrão, limite de tamanho e intervalo entre 1 e 168 horas', () => {
    const r = cleanRules({ away: { enabled: true, text: '  ', cooldownHours: 500 } })
    expect(r.away).toEqual({ enabled: true, text: DEFAULT_AWAY_TEXT, cooldownHours: 12 })
    expect(cleanRules({ away: { enabled: true, text: 'Volto já', cooldownHours: 24 } }).away).toEqual({ enabled: true, text: 'Volto já', cooldownHours: 24 })
  })
})

describe('WhatsApp: confirmação de entrega e leitura', () => {
  it('lê o evento messages.update da Evolution (formato novo e antigo) e ignora as mensagens recebidas', () => {
    expect(
      parseReceipts([
        { keyId: '3EB0ABCDEF123456', remoteJid: '5549999990000@s.whatsapp.net', fromMe: true, status: 'DELIVERY_ACK' },
        { key: { id: '3EB0FEDCBA654321', fromMe: true }, update: { status: 4 } },
        { keyId: 'RECEBIDA00000001', fromMe: false, status: 'READ' },
        { keyId: '3EB0X', status: 'READ' },
        { keyId: '3EB0ERRO00000001', fromMe: true, status: 'ERROR' },
      ]),
    ).toEqual([
      { waId: '3EB0ABCDEF123456', status: 'ENTREGUE' },
      { waId: '3EB0FEDCBA654321', status: 'LIDA' },
      { waId: '3EB0ERRO00000001', status: 'ERRO' },
    ])
    expect(parseReceipts({ keyId: '3EB0ABCDEF123456', status: 'PLAYED' })).toEqual([{ waId: '3EB0ABCDEF123456', status: 'LIDA' }])
  })

  it('a situação só avança (enviada → entregue → lida); nota interna não muda', () => {
    expect(receiptUpgrades('ENVIADA', 'ENTREGUE')).toBe(true)
    expect(receiptUpgrades('ENTREGUE', 'LIDA')).toBe(true)
    expect(receiptUpgrades('LIDA', 'ENTREGUE')).toBe(false)
    expect(receiptUpgrades(null, 'ENVIADA')).toBe(true)
    expect(receiptUpgrades('ENTREGUE', 'ERRO')).toBe(false)
    expect(receiptUpgrades('ENVIADA', 'ERRO')).toBe(true)
    expect(receiptUpgrades('NOTA', 'LIDA')).toBe(false)
  })
})
