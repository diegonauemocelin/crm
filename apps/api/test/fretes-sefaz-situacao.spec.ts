import { describe, expect, it } from 'vitest'
import { isOutage, sefazHealth } from '../src/fretes/sefaz'

const now = new Date('2026-11-24T15:00:00Z')
const run = (status: string, message: string | null, cStat: string | null = null, h = 1) => ({ status, message, cStat, startedAt: new Date(now.getTime() - h * 3_600_000) })

describe('situação da SEFAZ', () => {
  it('falha de comunicação × erro de cadastro', () => {
    expect(isOutage('SEFAZ respondeu HTTP 503.', null)).toBe(true)
    expect(isOutage('A SEFAZ não respondeu em 60 segundos.', null)).toBe(true)
    expect(isOutage('Serviço Paralisado Momentaneamente', '108')).toBe(true)
    expect(isOutage('Sem certificado A1.', null)).toBe(false)
    expect(isOutage('Rejeição: CNPJ não autorizado', '215')).toBe(false)
  })

  it('fora (duas falhas), instável (uma), atrasada e ok', () => {
    const base = { lastRunAt: new Date(now.getTime() - 3_600_000), intervalHours: 4 }
    expect(sefazHealth({ ...base, runs: [run('ERRO', 'SEFAZ respondeu HTTP 503.'), run('ERRO', 'A SEFAZ não respondeu em 60 segundos.', null, 5)] }, now).state).toBe('FORA')
    expect(sefazHealth({ ...base, runs: [run('ERRO', 'SEFAZ respondeu HTTP 502.'), run('OK', 'ok', '138', 5)] }, now).state).toBe('INSTAVEL')
    expect(sefazHealth({ ...base, runs: [run('ERRO', 'Sem certificado A1.')] }, now).state).toBe('OK')
    expect(sefazHealth({ runs: [run('OK', 'ok', '137', 20)], lastRunAt: new Date(now.getTime() - 20 * 3_600_000), intervalHours: 4 }, now).state).toBe('ATRASADA')
    expect(sefazHealth({ runs: [run('OK', 'ok', '137', 20)], lastRunAt: new Date(now.getTime() - 20 * 3_600_000), intervalHours: 0 }, now).state).toBe('OK')
    expect(sefazHealth({ ...base, runs: [run('RODANDO', null), run('OK', 'ok', '137', 2)] }, now).state).toBe('OK')
  })
})
