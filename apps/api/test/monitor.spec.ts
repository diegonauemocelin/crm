import { describe, expect, it } from 'vitest'
import { bucket, cpuPercent, numberLevel, RequestCounter, usageLevel } from '../src/monitor/monitor'

describe('monitoramento', () => {
  it('calcula a CPU entre duas leituras e conta os pedidos', () => {
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBe(75)
    expect(cpuPercent({ idle: 1, total: 1 }, { idle: 1, total: 1 })).toBe(0)
    const c = new RequestCounter()
    c.add(100, 200)
    c.add(300, 500)
    expect(c.take()).toEqual({ requests: 2, errors: 1, avgMs: 200 })
    expect(c.take()).toEqual({ requests: 0, errors: 0, avgMs: 0 })
  })
  it('agrupa as amostras e classifica', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 17, 12, m))
    const b = bucket(
      [
        { at: at(0), cpuPct: 10, memPct: 50, diskPct: 40, dbMs: 2, requests: 10, errors: 0, avgMs: 20, apiMemMb: 150 },
        { at: at(5), cpuPct: 30, memPct: 52, diskPct: 40, dbMs: 4, requests: 5, errors: 1, avgMs: 40, apiMemMb: 160 },
        { at: at(20), cpuPct: 50, memPct: 60, diskPct: null, dbMs: 6, requests: 0, errors: 0, avgMs: 0, apiMemMb: 170 },
      ],
      15,
    )
    expect(b).toHaveLength(2)
    expect(b[0]).toMatchObject({ cpu: 20, requests: 15, errors: 1, avgMs: 30 })
    expect(b[1]!.disk).toBeNull()
    expect(usageLevel(95)).toBe('problema')
    expect(usageLevel(80)).toBe('atencao')
    const now = Date.now()
    expect(numberLevel({ status: 'DESCONECTADO', statusReason: null, lastInboundAt: null }, now, true).level).toBe('problema')
    expect(numberLevel({ status: 'CONECTADO', statusReason: null, lastInboundAt: new Date(now - 5 * 3_600_000) }, now, true).level).toBe('atencao')
    expect(numberLevel({ status: 'CONECTADO', statusReason: null, lastInboundAt: new Date(now - 5 * 3_600_000) }, now, false).level).toBe('ok')
  })
})
