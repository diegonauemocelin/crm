import { describe, expect, it } from 'vitest'
import { deviceNameOf, PASSKEY_MAX } from '../src/auth/passkey'

describe('entrar com Face ID / digital', () => {
  it('dá nome ao aparelho pelo navegador', () => {
    expect(deviceNameOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone')
    expect(deviceNameOf('Mozilla/5.0 (Linux; Android 14)')).toBe('Android')
    expect(deviceNameOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows')
    expect(deviceNameOf(null)).toBe('Aparelho')
    expect(PASSKEY_MAX).toBe(5)
  })
})

describe('concorrentes: códigos equivalentes do ERP', () => {
  it('usa o código de fábrica e as referências da Tcar', async () => {
    const { erpCrossCodes } = await import('../src/assistente/concorrentes')
    const codes = erpCrossCodes({ factoryCode: '87305713', refs: ['196073A1', 'JS200', ''] })
    expect(codes).toContain('87305713')
    expect(codes.some((c) => c.startsWith('196073'))).toBe(true)
    expect(codes).not.toContain('JS200')
    expect(erpCrossCodes(null)).toEqual([])
  })
})

describe('concorrentes: número do anúncio no link', () => {
  it('acha o MLB no link, no wid e solto', async () => {
    const { itemIdOf } = await import('../src/assistente/concorrentes')
    expect(itemIdOf('https://produto.mercadolivre.com.br/MLB-4430805-disco-de-freio')).toBe('MLB4430805')
    expect(itemIdOf('https://www.mercadolivre.com.br/disco/p/MLB123456?wid=MLB7745868123')).toBe('MLB7745868123')
    expect(itemIdOf('https://www.mercadolivre.com.br/disco/p/MLB123456')).toBeNull()
    expect(itemIdOf(' mlb5810727168 ')).toBe('MLB5810727168')
    expect(itemIdOf('sem número')).toBeNull()
  })
})
