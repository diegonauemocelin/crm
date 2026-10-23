import { describe, expect, it } from 'vitest'
import { scriptDiagnosis } from '../../web/src/lib/google-ads'
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

describe('Google Ads: links como os da conta da Usaparts', () => {
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
    const store = new Map<string, object>()
    const settings = { get: async (_t: string, k: string, d: object) => store.get(k) ?? d, set: async (_t: string, k: string, v: object) => (store.set(k, v), v) }
    const service = new GoogleAdsService(prisma as never, settings as never, {} as never)
    service.gapMs = 0
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

describe('Google Ads: origem gravada no lead e no atendimento', () => {
  it('lead: primeira e última campanha; atendimento: anúncio mais recente até o contato', async () => {
    const { adsFirstLast, adsForRecord } = await import('../src/googleads/googleads')
    const d = (s: string) => new Date(`${s}T12:00:00-03:00`)
    const touches = [
      { t: { source: 'google', medium: 'cpc', campaign: 'Busca JCB', campaignId: '21987654321' }, at: d('2026-08-01') },
      { t: { source: 'facebook', medium: 'social' }, at: d('2026-08-20') },
      { t: { source: 'google', medium: 'cpc', landing: 'https://lp.usaparts.com.br/x?gclid=abc&gad_campaignid=21987654322' }, at: d('2026-09-10') },
    ]
    const names = { '21987654322': 'PMax Peças' }
    const fl = adsFirstLast(touches, names)!
    expect(fl.first).toMatchObject({ campaignId: '21987654321', campaign: 'Busca JCB' })
    expect(fl.last).toMatchObject({ campaignId: '21987654322', campaign: 'PMax Peças' })
    // Atendimento de agosto: só o anúncio de agosto conta; o de setembro é posterior.
    expect(adsForRecord(touches, d('2026-08-25'), names)).toMatchObject({ campaignId: '21987654321' })
    // Atendimento de outubro (venda seguinte): mantém a campanha mais recente.
    expect(adsForRecord(touches, d('2026-10-05'), names)).toMatchObject({ campaignId: '21987654322', campaign: 'PMax Peças' })
    // Antes de qualquer anúncio: sem campanha.
    expect(adsForRecord(touches, d('2026-07-01'), names)).toBeNull()
    expect(adsFirstLast([{ t: { source: 'direto', medium: 'direto' }, at: null }])).toBeNull()
  })
})

describe('Google Ads: ritmo de envio', () => {
  async function setup(fetchImpl: (body: unknown) => Response) {
    const { generateKeyPairSync } = await import('node:crypto')
    const { GoogleAdsService } = await import('../src/googleads/googleads.service')
    const { encrypt } = await import('../src/common/crypto')
    const { DEFAULT_GOOGLE_ADS } = await import('../src/googleads/googleads')
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `c${i}`, recordId: `rec${i}`, leadId: null, kind: 'venda', transactionId: `r${i}:venda`, actionId: '300', eventAt: new Date(), value: null, clickIds: { gclid: `Cj0KCQjwBom${i}xx` } }))
    const status = new Map<string, string>()
    const prisma = {
      googleAdsConversion: {
        findMany: async () => rows,
        update: async () => undefined,
        updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { status?: string } }) => where.id.in.forEach((id) => data.status && status.set(id, data.status)),
      },
      lead: { findMany: async () => [] },
      serviceRecord: { findMany: async () => [] },
    }
    const s = { ...DEFAULT_GOOGLE_ADS, enabled: true, customerId: '1234567890', clientEmail: 'crm@p.iam.gserviceaccount.com', privateKeyEnc: encrypt(pem), actions: { ...DEFAULT_GOOGLE_ADS.actions, venda: '300' } }
    const store = new Map<string, object>([['google_ads', s]])
    const settings = { get: async (_t: string, k: string, d: object) => store.get(k) ?? d, set: async (_t: string, k: string, v: object) => (store.set(k, v), v) }
    const service = new GoogleAdsService(prisma as never, settings as never, { byUser: async () => undefined } as never)
    service.gapMs = 0
    let calls = 0
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }))
      calls++
      return fetchImpl(JSON.parse(String(init.body)))
    }) as typeof fetch
    return { service, s, status, store, calls: () => calls, restore: () => (globalThis.fetch = original) }
  }

  it('para tudo quando o Google pede para esperar (429), sem contar tentativa nem dividir o lote', async () => {
    const t = await setup(() => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota' } }), { status: 429 }))
    try {
      const r = await t.service.send('t', t.s)
      expect(t.calls()).toBe(1)
      expect(r.sent).toBe(0)
      expect(r.paused).toMatch(/Limite de envios do Google/)
      expect(t.status.size).toBe(0)
      expect((t.store.get('google_ads_sync') as { pausedReason?: string }).pausedReason).toMatch(/Limite/)
    } finally {
      t.restore()
    }
  })

  it('"Enviar agora" no máximo 1 vez a cada 10 minutos', async () => {
    const t = await setup(() => new Response(JSON.stringify({ requestId: 'ok' })))
    const user = { id: 'u', tenantId: 't' } as never
    try {
      await t.service.sendNow(user, {} as never)
      await expect(t.service.sendNow(user, {} as never)).rejects.toThrow(/1 vez a cada 10 minutos/)
      const sync = t.store.get('google_ads_sync') as { lastAutoAt?: string; lastManualAt?: string }
      expect(sync.lastAutoAt).toBe(sync.lastManualAt)
    } finally {
      t.restore()
    }
  })
})

describe('Painel do Google Ads', () => {
  it('script manda campanhas, dias de campanha e de palavra-chave, só lendo a conta', async () => {
    const { adsScript } = await import('../src/googleads/painel')
    const code = adsScript('https://crm.usaparts.com.br/api/webhooks/google-ads/campanhas/abc')
    const sent: { campaigns?: unknown[]; stats?: { campaigns?: Record<string, unknown>[]; keywords?: Record<string, unknown>[] } }[] = []
    const iter = <T>(list: T[]) => ({ hasNext: () => list.length > 0, next: () => list.shift()! })
    const AdsApp = {
      campaigns: () => ({ get: () => iter([{ getId: () => 21987654321, getName: () => 'Busca JCB' }]) }),
      performanceMaxCampaigns: () => ({ get: () => iter([]) }),
      shoppingCampaigns: () => ({ get: () => iter([]) }),
      videoCampaigns: () => ({ get: () => iter([]) }),
      currentAccount: () => ({ getTimeZone: () => 'America/Sao_Paulo' }),
      search: (q: string) =>
        q.includes('FROM campaign')
          ? iter([{ segments: { date: '2026-10-01' }, campaign: { id: 21987654321, name: 'Busca JCB' }, metrics: { costMicros: '12340000', clicks: '10', impressions: '200', conversions: 1 } }])
          : iter([{ segments: { date: '2026-10-01' }, campaign: { id: 21987654321 }, adGroup: { id: 555 }, adGroupCriterion: { criterionId: 777, keyword: { text: 'peças jcb', matchType: 'PHRASE' } }, metrics: { costMicros: '5000000', clicks: '4', impressions: '50', conversions: 0 } }]),
    }
    const UrlFetchApp = { fetch: (_u: string, o: { payload: string }) => (sent.push(JSON.parse(o.payload)), { getResponseCode: () => 200, getContentText: () => 'ok' }) }
    const Utilities = { formatDate: (d: Date) => d.toISOString().slice(0, 10), sleep: () => undefined }
    new Function('AdsApp', 'UrlFetchApp', 'Logger', 'Utilities', `${code}\nmain()`)(AdsApp, UrlFetchApp, { log: () => undefined }, Utilities)
    expect(sent[0]).toEqual({ campaigns: [{ id: '21987654321', name: 'Busca JCB' }] })
    expect(sent[1]!.stats!.campaigns![0]).toMatchObject({ d: '2026-10-01', c: '21987654321', n: 'Busca JCB', cost: 12.34, cl: 10, im: 200, cv: 1 })
    expect(sent[2]!.stats!.keywords![0]).toMatchObject({ c: '21987654321', g: '555', k: '777', t: 'peças jcb', m: 'PHRASE', cost: 5 })
    expect(code).not.toMatch(/\.(set|pause|enable|remove|apply)\w*\(/)
  })

  it('limpa o que chega: descarta linhas inválidas e valores negativos', async () => {
    const { cleanStats, keywordKey, ratios, panelPeriod } = await import('../src/googleads/painel')
    const r = cleanStats({ stats: { campaigns: [{ d: '2026-10-01', c: '123', n: 'A<b>', cost: 10.005, cl: 3, im: 9, cv: 0 }, { d: 'x', c: '1', cost: 1, cl: 1, im: 1, cv: 0 }, { d: '2026-10-01', c: '9', cost: -5, cl: 1, im: 1, cv: 0 }], keywords: [{ d: '2026-10-01', c: '1', g: '2', k: '3', t: '"peças jcb"', m: 'DROP TABLE', cost: 1, cl: 1, im: 1, cv: 0 }] } })
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.campaigns).toHaveLength(1)
    expect(r.keywords[0]!.matchType).toBe('BROAD')
    expect(keywordKey('[Peças  JCB]')).toBe('peças jcb')
    expect(keywordKey('+peças +jcb')).toBe('peças jcb')
    expect(ratios({ cost: 100, clicks: 50, leads: 4, sales: 1, revenue: 500 })).toEqual({ cpc: 2, costPerLead: 25, costPerSale: 100, conversionRate: 0.25, roas: 5 })
    expect(ratios({ cost: 0, clicks: 0, leads: 3, sales: 0, revenue: 0 })).toMatchObject({ costPerLead: null, roas: null })
    expect(panelPeriod('2026-10-10', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-10' })
  })
})

describe('Saldo pré-pago do Google Ads (estimado)', () => {
  it('saldo informado + recargas depois dele - gasto desde então; avisa quando dura menos que o limite', async () => {
    const { estimateBalance, DEFAULT_BALANCE } = await import('../src/googleads/painel')
    expect(estimateBalance(DEFAULT_BALANCE, 100, [])).toBeNull()
    const s = {
      ...DEFAULT_BALANCE,
      alertDays: 5,
      // Informado às 10h: R$ 1.000; naquela hora o gasto conhecido do dia era R$ 40.
      anchor: { amount: 1000, at: '2026-10-05T13:00:00.000Z', date: '2026-10-05', knownCost: 40 },
      deposits: [
        { id: 'a', amount: 999, at: '2026-10-01T12:00:00.000Z' }, // antes do saldo informado: já está nele
        { id: 'b', amount: 500, at: '2026-10-07T12:00:00.000Z' },
      ],
    }
    // Do dia 05 em diante o script já mostra R$ 640 (R$ 40 já conhecidos não contam de novo).
    const e = estimateBalance(s, 640, [100, 100, 100, 100, 100, 100, 100])!
    expect(e).toMatchObject({ spent: 600, deposits: 500, balance: 900, avgDaily: 100, low: false })
    expect(e.daysLeft).toBe(9)
    expect(estimateBalance(s, 1140, [100, 100, 100, 100, 100, 100, 100])).toMatchObject({ balance: 400, low: true })
    expect(estimateBalance(s, 2000, [])).toMatchObject({ balance: -460, low: true, daysLeft: null })
  })
})

describe('Google Ads: conferência depois do envio', () => {
  it('traduz a resposta final do Google (aceito, parcial, recusado com os motivos)', async () => {
    const { summarizeRequestStatus } = await import('../src/googleads/googleads')
    expect(summarizeRequestStatus({ requestStatusPerDestination: [{ requestStatus: 'SUCCESS', eventsIngestionStatus: { recordCount: '12' } }] })).toEqual({ status: 'ACEITO', detail: null, retry: false })
    expect(summarizeRequestStatus({ requestStatusPerDestination: [{ requestStatus: 'PROCESSING' }] })?.status).toBe('PROCESSANDO')
    const r = summarizeRequestStatus({
      requestStatusPerDestination: [
        {
          requestStatus: 'PARTIAL_SUCCESS',
          eventsIngestionStatus: { recordCount: '10' },
          errorInfo: { errorCounts: [{ recordCount: '3', reason: 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND' }, { recordCount: '1', reason: 'PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER' }] },
        },
      ],
    })
    expect(r?.status).toBe('PARCIAL')
    expect(r?.detail).toBe('3 de 10: o Google não achou o clique · 1 de 10: o clique é de outra conta do Google Ads (confira o ID da conta)')
    expect(summarizeRequestStatus({ requestStatusPerDestination: [{ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ recordCount: 2, reason: 'PROCESSING_ERROR_REASON_NOVO_MOTIVO' }] } }] })?.detail).toBe('2: novo motivo')
    expect(summarizeRequestStatus({})).toBeNull()
  })

  it('consulta cada envio uma vez (pelo requestId) e grava o resultado em todas as conversões dele', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { GoogleAdsService } = await import('../src/googleads/googleads.service')
    const { encrypt } = await import('../src/common/crypto')
    const { DEFAULT_GOOGLE_ADS } = await import('../src/googleads/googleads')
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const updates: { where: { requestId: string }; data: { googleStatus: string; googleDetail: string | null } }[] = []
    let query: { where?: { sentAt?: { lt: Date } } } = {}
    const prisma = {
      googleAdsConversion: {
        findMany: async (q: typeof query) => ((query = q), [{ requestId: 'req-1' }, { requestId: 'req-2' }]),
        updateMany: async (u: (typeof updates)[number]) => void updates.push(u),
      },
    }
    const s = { ...DEFAULT_GOOGLE_ADS, enabled: true, customerId: '1234567890', clientEmail: 'crm@p.iam.gserviceaccount.com', privateKeyEnc: encrypt(pem) }
    const service = new GoogleAdsService(prisma as never, {} as never, {} as never)
    service.gapMs = 0
    const original = globalThis.fetch
    const asked: string[] = []
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }))
      asked.push(String(url))
      return String(url).includes('req-1')
        ? new Response(JSON.stringify({ requestStatusPerDestination: [{ requestStatus: 'SUCCESS' }] }))
        : new Response(JSON.stringify({ requestStatusPerDestination: [{ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ recordCount: '5', reason: 'PROCESSING_ERROR_REASON_INVALID_CLICK' }] } }] }))
    }) as typeof fetch
    try {
      const now = Date.parse('2026-10-17T12:00:00Z')
      expect(await service.checkResults('t', s, now)).toBe(2)
      expect(asked.every((u) => u.startsWith('https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId='))).toBe(true)
      // Só pergunta depois de 30 minutos do envio (o Google ainda está conferindo).
      expect(query.where?.sentAt?.lt.getTime()).toBe(now - 30 * 60_000)
      expect(updates.map((u) => [u.where.requestId, u.data.googleStatus])).toEqual([
        ['req-1', 'ACEITO'],
        ['req-2', 'RECUSADO'],
      ])
      expect(updates[1]!.data.googleDetail).toBe('5: o clique não é de anúncio do Google Ads')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('Google Ads: ações de conversão criadas de novo', () => {
  it('trocar o ID da ação devolve para a fila o que foi para a ação antiga (até 90 dias)', async () => {
    const { GoogleAdsService } = await import('../src/googleads/googleads.service')
    const { DEFAULT_GOOGLE_ADS } = await import('../src/googleads/googleads')
    const rows = [
      { id: 'a', recordId: 'r1', kind: 'contato', actionId: '111' },
      { id: 'b', recordId: 'r2', kind: 'venda', actionId: '999' },
      { id: 'c', recordId: 'r3', kind: 'perda', actionId: '333' },
      { id: 'd', recordId: 'r4', kind: 'negociacao', actionId: '444' },
    ]
    let where: { status?: { in: string[] }; eventAt?: { gte: Date } } = {}
    const requeued: string[] = []
    const prisma = {
      googleAdsConversion: {
        findMany: async (q: { where: typeof where }) => ((where = q.where), rows),
        updateMany: async (u: { where: { id: { in: string[] } }; data: { status: string; googleStatus: null } }) => {
          expect(u.data).toMatchObject({ status: 'PENDENTE', googleStatus: null, attempts: 0 })
          requeued.push(...u.where.id.in)
        },
      },
      serviceRecord: { findMany: async () => [{ id: 'r3', lostReasonId: 'motivo-preco' }] },
    }
    const service = new GoogleAdsService(prisma as never, {} as never, {} as never)
    const s = { ...DEFAULT_GOOGLE_ADS, actions: { contato: '211', negociacao: '', venda: '999', perda: '300', perdaPorMotivo: { 'motivo-preco': '333' } } }
    const now = Date.parse('2026-10-17T12:00:00Z')
    expect(await service.requeueForNewActions('t', s, now)).toBe(1)
    // Contato mudou de ação (111 → 211); venda e perda por motivo continuam; qualificado sem ação não envia.
    expect(requeued).toEqual(['a'])
    expect(where.status?.in).toEqual(['ENVIADO', 'ERRO'])
    expect(where.eventAt?.gte.getTime()).toBe(now - 90 * 86_400_000)
  })

  it('"ação criada há pouco" volta para a fila; repetidas contam como aceitas', async () => {
    const { summarizeRequestStatus } = await import('../src/googleads/googleads')
    const recent = summarizeRequestStatus({ requestStatusPerDestination: [{ requestStatus: 'PARTIAL_SUCCESS', errorInfo: { errorCounts: [{ recordCount: '59', reason: 'PROCESSING_ERROR_REASON_DESTINATION_TOO_RECENTLY_CREATED' }] } }] })
    expect(recent?.retry).toBe(true)
    const dup = summarizeRequestStatus({ requestStatusPerDestination: [{ requestStatus: 'PARTIAL_SUCCESS', errorInfo: { errorCounts: [{ recordCount: '40', reason: 'PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID' }] } }] })
    expect(dup).toMatchObject({ status: 'ACEITO', retry: false })
  })
})

describe('Google Ads: prazo do Google', () => {
  it('não manda conversão velha demais (90 dias com clique, 63 só com e-mail/telefone)', async () => {
    const { tooOldForGoogle } = await import('../src/googleads/googleads')
    const now = Date.parse('2026-10-15T12:00:00Z')
    const ago = (d: number) => new Date(now - d * 86_400_000)
    expect(tooOldForGoogle(ago(70), null, now)).toMatch(/63 dias/)
    expect(tooOldForGoogle(ago(60), null, now)).toBeNull()
    expect(tooOldForGoogle(ago(70), { gclid: 'Cj0KCQjw_ABC123' }, now)).toBeNull()
    expect(tooOldForGoogle(ago(89.5), { gbraid: '0AAAAAo-abcdef12' }, now)).toMatch(/90 dias/)
  })
})

describe('Google Ads: eventos recusados pelo índice', () => {
  it('tira só os eventos apontados pelo Google e manda o resto na hora', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { GoogleAdsService } = await import('../src/googleads/googleads.service')
    const { encrypt } = await import('../src/common/crypto')
    const { DEFAULT_GOOGLE_ADS, badEvents } = await import('../src/googleads/googleads')
    const violation = (i: number) => ({ field: `events.events[${i}].event_timestamp`, description: 'Event did not occur within the acceptable time window.' })
    expect([...badEvents({ error: { details: [{ fieldViolations: [violation(0), violation(2)] }] } }).keys()]).toEqual([0, 2])
    expect(badEvents({ error: { message: 'x' } }).size).toBe(0)

    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, recordId: `rec${i}`, leadId: null, kind: 'contato', transactionId: `r${i}:contato`, actionId: '300', eventAt: new Date(Date.now() - (i === 1 || i === 4 ? 50 : 2) * 86_400_000), value: null, clickIds: { gclid: `Cj0KCQjwBom${i}xx` } }))
    const status = new Map<string, string>()
    const prisma = {
      googleAdsConversion: {
        findMany: async () => rows,
        update: async () => undefined,
        updateMany: async ({ where, data }: { where: { id: string | { in: string[] } }; data: { status: string } }) => (typeof where.id === 'string' ? [where.id] : where.id.in).forEach((id) => status.set(id, data.status)),
      },
      lead: { findMany: async () => [] },
      serviceRecord: { findMany: async () => [] },
    }
    const s = { ...DEFAULT_GOOGLE_ADS, enabled: true, customerId: '1234567890', clientEmail: 'crm@p.iam.gserviceaccount.com', privateKeyEnc: encrypt(pem), actions: { ...DEFAULT_GOOGLE_ADS.actions, contato: '300' } }
    const settings = { get: async (_t: string, _k: string, d: object) => d, set: async (_t: string, _k: string, v: object) => v }
    const service = new GoogleAdsService(prisma as never, settings as never, {} as never)
    service.gapMs = 0
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }))
      calls++
      const body = JSON.parse(String(init.body)) as { events: { eventTimestamp: string }[] }
      const old = body.events.map((e, i) => (Date.now() - Date.parse(e.eventTimestamp) > 30 * 86_400_000 ? i : -1)).filter((i) => i >= 0)
      if (old.length) return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'There was a problem with the request.', details: [{ fieldViolations: old.map(violation) }] } }), { status: 400 })
      return new Response(JSON.stringify({ requestId: 'ok' }))
    }) as typeof fetch
    try {
      const r = await service.send('t', s)
      expect(calls).toBe(2)
      expect(r.sent).toBe(4)
      expect(status.get('c1')).toBe('IGNORADO')
      expect(status.get('c4')).toBe('IGNORADO')
      expect(status.get('c0')).toBe('ENVIADO')
      expect(status.get('c5')).toBe('ENVIADO')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('Google Ads: diagnóstico do script do investimento', () => {
  const setup = async () => {
    const { GoogleAdsService } = await import('../src/googleads/googleads.service')
    const store = new Map<string, object>()
    const token = 'tok_abcdefghijklmnopqrstuvwx'
    const prisma = { tenantSetting: { findMany: async () => [{ tenantId: 't', value: { campaignsToken: token } }] } }
    const settings = { get: async (_t: string, k: string, d: object) => store.get(k) ?? (k === 'google_ads' ? { ...DEFAULT_GOOGLE_ADS, campaignsToken: token } : d), set: async (_t: string, k: string, v: object) => (store.set(k, v), v) }
    const stored: unknown[] = []
    const panel = { store: async (_t: string, st: unknown) => (stored.push(st), { dias: 1, palavras: 0 }) }
    const service = new GoogleAdsService(prisma as never, settings as never, {} as never, panel as never)
    return { service, store, token, stored }
  }

  it('guarda o último contato do script, aceito ou recusado', async () => {
    const { service, store, token } = await setup()
    await service.receiveCampaigns(token, { campaigns: [{ id: '123', name: 'Pesquisa' }] })
    expect(store.get('google_ads_script')).toMatchObject({ lastError: null })
    expect((store.get('google_ads_script') as { lastCallAt: string }).lastCallAt).toMatch(/^\d{4}-/)
    await expect(service.receiveCampaigns(token, { stats: { campaigns: Array.from({ length: 5001 }, () => ({})) } })).rejects.toThrow('Linhas demais')
    expect(store.get('google_ads_script')).toMatchObject({ lastError: 'Linhas demais em um envio (máximo 5.000).' })
    expect(await service.receiveCampaigns('endereco_que_nao_existe_mais', { campaigns: [] })).toBeNull()
  })

  it('explica por que o investimento não chega', () => {
    const now = Date.parse('2026-10-20T20:00:00Z')
    const h = (n: number) => new Date(now - n * 3_600_000).toISOString()
    expect(scriptDiagnosis(h(10), { lastCallAt: h(10), lastError: null }, now)).toBeNull()
    expect(scriptDiagnosis(h(24 * 11), { lastCallAt: h(2), lastError: 'Linhas demais em um envio (máximo 5.000).' }, now)).toContain('o CRM recusou: Linhas demais')
    expect(scriptDiagnosis(h(24 * 11), { campaignsSyncedAt: h(5) }, now)).toContain('é o script antigo')
    const parado = scriptDiagnosis(h(24 * 11), { campaignsSyncedAt: h(24 * 11) }, now)!
    expect(parado).toContain('não manda dados desde')
    expect(parado).toContain('Frequência “Diariamente”')
    expect(scriptDiagnosis(null, undefined, now)).toContain('não manda dados ainda')
  })
})
