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
      eventSource: 'WEB',
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

describe('Google Ads: quais contatos enviar', () => {
  it('origem marcada OU anúncio detectado; com tudo desligado, todos', async () => {
    const { shouldSend } = await import('../src/googleads/googleads')
    const s = { onlyGoogle: true, originIds: ['whats', 'tel'] }
    expect(shouldSend(s, true, null)).toBe(true)
    expect(shouldSend(s, false, 'whats')).toBe(true)
    expect(shouldSend(s, false, 'tel')).toBe(true)
    expect(shouldSend(s, false, 'site')).toBe(false)
    expect(shouldSend({ onlyGoogle: false, originIds: ['whats'] }, true, 'site')).toBe(false)
    expect(shouldSend({ onlyGoogle: false, originIds: [] }, false, null)).toBe(true)
  })
})

describe('Google Ads: campanha do contato', () => {
  it('lê o número da campanha que o Google põe no link (gad_campaignid) e classifica como anúncio', async () => {
    const { classifyTouch } = await import('../src/rastreamento/origem')
    const { campaignIdFromUrl } = await import('../src/googleads/googleads')
    const t = classifyTouch('https://teste.usaparts.com.br/jcb?gad_source=1&gad_campaignid=21987654321&gclid=Cj0KCQjwXYZ123', null, ['usaparts.com.br'])
    expect(t).toMatchObject({ source: 'google', medium: 'cpc', campaignId: '21987654321' })
    expect(t?.landing).toContain('gad_campaignid=21987654321')
    const u = classifyTouch('https://teste.usaparts.com.br/?utm_source=google&utm_medium=cpc&utm_campaign=JCB%20Pe%C3%A7as&gad_campaignid=21987654321', null, ['usaparts.com.br'])
    expect(u).toMatchObject({ source: 'google', medium: 'cpc', campaign: 'JCB Peças', campaignId: '21987654321' })
    expect(campaignIdFromUrl('https://x.com/?utm_id=123456')).toBe('123456')
    expect(campaignIdFromUrl('https://x.com/?gad_campaignid=abc')).toBeNull()
  })

  it('nome pelo utm_campaign ou pela lista cadastrada; só o número quando não há nome', async () => {
    const { adsInfoOf, campaignLabel } = await import('../src/googleads/googleads')
    const at = new Date('2026-10-01T12:00:00Z')
    const withName = adsInfoOf([{ t: { source: 'google', medium: 'cpc', campaign: 'JCB Peças', campaignId: '111222' }, at }])
    expect(withName).toMatchObject({ campaignId: '111222', campaign: 'JCB Peças' })
    expect(campaignLabel(withName!)).toBe('JCB Peças')
    const fromList = adsInfoOf([{ t: { source: 'google', medium: 'cpc', landing: 'https://x.com/?gad_campaignid=333444&gclid=Cj0KCQjwAAA111' }, at }], { '333444': 'Filtros Caterpillar' })
    expect(campaignLabel(fromList!)).toBe('Filtros Caterpillar')
    const onlyId = adsInfoOf([{ t: { source: 'google', medium: 'cpc', campaign: '555666' }, at }])
    expect(onlyId).toMatchObject({ campaignId: '555666', campaign: null })
    expect(campaignLabel(onlyId!)).toBe('campanha nº 555666')
    // A mais recente vale; orgânico não conta.
    const both = adsInfoOf([
      { t: { source: 'google', medium: 'cpc', campaign: 'Antiga', campaignId: '1111' }, at: new Date('2026-09-01T00:00:00Z') },
      { t: { source: 'google', medium: 'cpc', campaign: 'Nova', campaignId: '2222' }, at },
      { t: { source: 'google', medium: 'organico' }, at: new Date('2026-10-05T00:00:00Z') },
    ])
    expect(both?.campaign).toBe('Nova')
    expect(adsInfoOf([{ t: { source: 'google', medium: 'organico' }, at }])).toBeNull()
  })
})

describe('Google Ads: links como os da conta da USA Parts', () => {
  it('utm_campaign repetido (nome + número) e meio "cpa"', async () => {
    const { classifyTouch } = await import('../src/rastreamento/origem')
    const { adsInfoOf, campaignLabel } = await import('../src/googleads/googleads')
    const url =
      'https://teste.usaparts.com.br/?utm_source=google&utm_medium=cpc&utm_campaign=concorrentes&utm_term=&utm_content=jcb_ad01&utm_source=google&utm_medium=cpa&utm_campaign=17622332326&gclid=Cj0KCQjwAbc123'
    const t = classifyTouch(url, null, ['usaparts.com.br'])
    expect(t).toMatchObject({ source: 'google', medium: 'cpc', campaign: 'concorrentes', campaignId: '17622332326', content: 'jcb_ad01' })
    expect(campaignLabel(adsInfoOf([{ t, at: new Date() }])!)).toBe('concorrentes')
    // Só o modelo atual (meio "cpa", número na campanha), sem gclid: ainda é anúncio do Google.
    const only = classifyTouch('https://teste.usaparts.com.br/?utm_source=google&utm_medium=cpa&utm_campaign=17622332326', null, ['usaparts.com.br'])
    expect(adsInfoOf([{ t: only, at: new Date() }])).toMatchObject({ campaignId: '17622332326', campaign: null })
  })
})

describe('Google Ads: nomes das campanhas pelo script', () => {
  it('nome oficial do Google vale mais que o utm_campaign do link', async () => {
    const { adsInfoOf, campaignLabel } = await import('../src/googleads/googleads')
    const info = adsInfoOf([{ t: { source: 'google', medium: 'cpc', campaign: 'concorrentes', campaignId: '17622332326' }, at: new Date() }], { '17622332326': '[V4] [SEARCH] [LP JCB]' })
    expect(campaignLabel(info!)).toBe('[V4] [SEARCH] [LP JCB]')
    expect(campaignLabel({ campaign: null, campaignId: '999999' })).toBe('campanha nº 999999')
  })

  it('confere a lista enviada (só números como id, nomes sem caracteres de controle)', async () => {
    const { cleanCampaignList } = await import('../src/googleads/googleads')
    expect(cleanCampaignList({ campaigns: [{ id: '22031677137', name: ' [kw3] Paraná\u0007 ' }, { id: 'abc', name: 'x' }, { id: '123456', name: '' }] })).toEqual({ campaigns: { '22031677137': '[kw3] Paraná' }, count: 1 })
    expect(cleanCampaignList({})).toMatchObject({ error: expect.any(String) })
  })

  it('script do Google Ads é JavaScript válido, lê todos os tipos de campanha e envia ao endereço', async () => {
    const { campaignsScript } = await import('../src/googleads/googleads')
    const code = campaignsScript('https://crm.usaparts.com.br/api/webhooks/google-ads/campanhas/abc')
    const sent: { url: string; body: unknown }[] = []
    const camp = (id: number, name: string) => ({ getId: () => id, getName: () => name })
    const iter = (list: ReturnType<typeof camp>[]) => () => ({ get: () => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++]! } } })
    const AdsApp = { campaigns: iter([camp(111, 'Busca JCB')]), performanceMaxCampaigns: iter([camp(222, 'PMax Peças')]), shoppingCampaigns: () => { throw new Error('sem shopping') }, videoCampaigns: iter([]) }
    const UrlFetchApp = { fetch: (url: string, o: { payload: string }) => (sent.push({ url, body: JSON.parse(o.payload) }), { getResponseCode: () => 200, getContentText: () => 'ok' }) }
    new Function('AdsApp', 'UrlFetchApp', 'Logger', `${code}\nmain()`)(AdsApp, UrlFetchApp, { log: () => undefined })
    expect(sent).toEqual([{ url: 'https://crm.usaparts.com.br/api/webhooks/google-ads/campanhas/abc', body: { campaigns: [{ id: '111', name: 'Busca JCB' }, { id: '222', name: 'PMax Peças' }] } }])
  })
})

describe('Google Ads: lote recusado por alguns eventos', () => {
  it('divide o lote e envia os bons; só os problemáticos ficam com erro', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { GoogleAdsService } = await import('../src/googleads/googleads.service')
    const { encrypt } = await import('../src/common/crypto')
    const { DEFAULT_GOOGLE_ADS } = await import('../src/googleads/googleads')
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const rows = Array.from({ length: 42 }, (_, i) => ({ id: `c${i}`, recordId: `rec${i}`, leadId: null, kind: 'venda', transactionId: `r${i}:venda`, actionId: '200', eventAt: new Date(), value: null, clickIds: { gclid: i === 7 || i === 30 ? 'RUIM_xxxxxxxx' : `Cj0KCQjwBom${i}xx` } }))
    const status = new Map<string, string>()
    const prisma = {
      googleAdsConversion: {
        findMany: async () => rows,
        update: async () => undefined,
        updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { status: string } }) => where.id.in.forEach((id) => status.set(id, data.status)),
      },
      lead: { findMany: async () => [] },
      serviceRecord: { findMany: async () => [] },
    }
    const s = { ...DEFAULT_GOOGLE_ADS, enabled: true, customerId: '1234567890', clientEmail: 'crm@p.iam.gserviceaccount.com', privateKeyEnc: encrypt(pem), actions: { ...DEFAULT_GOOGLE_ADS.actions, venda: '300' } }
    const service = new GoogleAdsService(prisma as never, {} as never, {} as never)
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }))
      calls++
      const body = JSON.parse(String(init.body)) as { destinations: { productDestinationId: string }[]; events: { adIdentifiers?: { gclid?: string } }[] }
      // Vai para a conversão configurada agora (300), não a guardada quando o envio foi registrado (200).
      if (body.destinations[0]!.productDestinationId !== '300') return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'wrong action' } }), { status: 400 })
      if (body.events.some((e) => e.adIdentifiers?.gclid?.startsWith('RUIM'))) return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid gclid' } }), { status: 400 })
      return new Response(JSON.stringify({ requestId: 'ok' }))
    }) as typeof fetch
    try {
      const r = await service.send('t', s)
      expect(r.sent).toBeGreaterThanOrEqual(36)
      expect(r.sent + r.failed).toBe(42)
      expect(status.get('c0')).toBe('ENVIADO')
      expect(status.get('c7')).toBe('ERRO')
      expect(status.get('c30')).toBe('ERRO')
      expect(calls).toBeLessThan(40)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('Google Ads: detalhes do erro e origem do evento', () => {
  it('mostra o campo recusado e o motivo; WhatsApp vira MESSAGE, ligação PHONE', async () => {
    const { adsError, eventSourceFor } = await import('../src/googleads/googleads')
    const body = { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'There was a problem with the request.', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'events.events[0].event_source', description: 'Invalid value' }] }, { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'INVALID_ARGUMENT', metadata: { requestId: 'x1' } }] } }
    const msg = adsError(400, body, '')
    expect(msg).toContain('events.events[0].event_source: Invalid value')
    expect(msg).toContain('motivo INVALID_ARGUMENT')
    expect(eventSourceFor('WhatsApp')).toBe('MESSAGE')
    expect(eventSourceFor('Ligação')).toBe('PHONE')
    expect(eventSourceFor('Site - LP')).toBe('WEB')
    expect(eventSourceFor(null)).toBe('WEB')
  })
})
