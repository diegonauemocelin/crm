import { describe, expect, it } from 'vitest'
import { actionFor, buildEvent, clickIdsFromUrl, cleanActionId, cleanCustomerId, DEFAULT_GOOGLE_ADS, ingestBody, isGoogleAdsTouch, isoWithOffset, normalizeE164, normalizeEmail, sha256Hex } from '../src/googleads/googleads'

describe('Google Ads: identificação do clique', () => {
  it('lê gclid, gbraid e wbraid da página de entrada', () => {
    expect(clickIdsFromUrl('https://teste.usaparts.com.br/jcb?utm_source=google&gclid=Cj0KCQjw_ABC-123xyz')).toEqual({ gclid: 'Cj0KCQjw_ABC-123xyz' })
    expect(clickIdsFromUrl('https://usaparts.com.br/?gbraid=0AAAAAo-abcdef12')).toEqual({ gbraid: '0AAAAAo-abcdef12' })
    expect(clickIdsFromUrl('https://usaparts.com.br/?gclid=<script>')).toBeNull()
    expect(clickIdsFromUrl('nao é url')).toBeNull()
  })

  it('reconhece visita de anúncio do Google', () => {
    expect(isGoogleAdsTouch({ source: 'google', medium: 'cpc' })).toBe(true)
    expect(isGoogleAdsTouch({ source: 'google', medium: 'organico' })).toBe(false)
    expect(isGoogleAdsTouch({ source: 'newsletter', medium: 'email', landing: 'https://x.com/?gclid=Cj0KCQjw_ABC123' })).toBe(true)
    expect(isGoogleAdsTouch(null)).toBe(false)
  })
})

describe('Google Ads: configuração', () => {
  it('IDs da conta e da conversão', () => {
    expect(cleanCustomerId('123-456-7890')).toBe('1234567890')
    expect(cleanCustomerId('12345')).toBeNull()
    expect(cleanActionId(' 987654321 ')).toBe('987654321')
    expect(cleanActionId('abc')).toBe('')
    expect(cleanActionId('-')).toBe('-')
  })

  it('perda usa o motivo; "-" não envia; sem motivo usa o padrão', () => {
    const s = { ...DEFAULT_GOOGLE_ADS, actions: { contato: '', negociacao: '', venda: '111', perda: '222', perdaPorMotivo: { m1: '333', m2: '-' } } }
    expect(actionFor(s, 'venda', null)).toBe('111')
    expect(actionFor(s, 'perda', 'm1')).toBe('333')
    expect(actionFor(s, 'perda', 'm2')).toBe('')
    expect(actionFor(s, 'perda', 'outro')).toBe('222')
    expect(actionFor(s, 'contato', null)).toBe('')
  })
})

describe('Google Ads: evento enviado', () => {
  it('normaliza e criptografa e-mail e telefone como o Google pede', () => {
    expect(normalizeEmail('  Ana.Silva@Exemplo.COM ')).toBe('ana.silva@exemplo.com')
    expect(normalizeE164('+55 (49) 98886-1936')).toBe('+5549988861936')
    expect(sha256Hex('teste@exemplo.com')).toMatch(/^[0-9a-f]{64}$/)
    expect(isoWithOffset(new Date('2026-10-08T15:30:00Z'))).toBe('2026-10-08T12:30:00-03:00')
  })

  it('venda com clique e dados do cliente; sem nada para casar, não envia', () => {
    const ev = buildEvent({ transactionId: 'r1:venda', eventAt: new Date('2026-10-08T15:30:00Z'), value: 1234.567, clickIds: { gclid: 'Cj0KCQjw_ABC' }, email: 'Ana@x.com', phone: '+5549988861936' }, true)
    expect(ev).toEqual({
      transactionId: 'r1:venda',
      eventTimestamp: '2026-10-08T12:30:00-03:00',
      eventSource: 'OTHER',
      adIdentifiers: { gclid: 'Cj0KCQjw_ABC' },
      userData: { userIdentifiers: [{ emailAddress: sha256Hex('ana@x.com') }, { phoneNumber: sha256Hex('+5549988861936') }] },
      conversionValue: 1234.57,
      currency: 'BRL',
    })
    // O e-mail/telefone nunca vai em texto.
    expect(JSON.stringify(ev)).not.toContain('ana@x.com')
    expect(buildEvent({ transactionId: 'r2:perda', eventAt: new Date(), value: null, clickIds: null, email: 'ana@x.com', phone: null }, false)).toBeNull()
    expect(buildEvent({ transactionId: 'r3:perda', eventAt: new Date(), value: null, clickIds: { gbraid: '0AAAAAo-abc12345' }, email: null, phone: null }, false)).toMatchObject({ adIdentifiers: { gbraid: '0AAAAAo-abc12345' } })
  })

  it('pedido: conta, MCC, ação e consentimento só para medição (nunca personalização)', () => {
    const s = { ...DEFAULT_GOOGLE_ADS, customerId: '1234567890', loginCustomerId: '9999999999' }
    const body = ingestBody(s, '555', [{ a: 1 }], true)
    expect(body).toMatchObject({
      destinations: [{ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' }, loginAccount: { accountType: 'GOOGLE_ADS', accountId: '9999999999' }, productDestinationId: '555' }],
      encoding: 'HEX',
      consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_DENIED' },
      validateOnly: true,
    })
    expect(ingestBody({ ...s, loginCustomerId: '', sendUserData: false }, '555', []).destinations[0]!.loginAccount.accountId).toBe('1234567890')
    expect(ingestBody({ ...s, sendUserData: false }, '555', []).consent.adUserData).toBe('CONSENT_DENIED')
  })
})
