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
