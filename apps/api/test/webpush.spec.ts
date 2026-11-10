import { createECDH, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildScript } from '../src/rastreamento/script'
import {
  buildPayload,
  buildServiceWorker,
  campaignError,
  cleanPrompt,
  DEFAULT_PROMPT,
  isDue,
  parseSubscribe,
  parseUnsubscribe,
  PROMPT_RULE_JS,
  pushEndpointOk,
  saoPauloToUtc,
  scheduleError,
  signDelivery,
  siteOrigin,
  statsOf,
  subscriptionKeysOk,
  SW_MARKER,
  verifyDelivery,
  withUtm,
} from '../src/webpush/webpush'

const ok = { name: 'Black Friday', title: 'Ofertas de filtros', message: 'Até 20% nos filtros', url: 'https://www.loja.com.br/ofertas', buttonLabel: null }

function browserKeys() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }
}

describe('web push: campanha', () => {
  it('rascunho só precisa do nome; enviar exige título, mensagem e URL https', () => {
    expect(campaignError({ ...ok, title: '', message: '', url: '' }, false)).toBeNull()
    expect(campaignError({ ...ok, name: ' ' }, false)).toMatch(/nome/)
    expect(campaignError({ ...ok, title: '' }, true)).toMatch(/título/)
    expect(campaignError({ ...ok, message: '' }, true)).toMatch(/mensagem/)
    expect(campaignError({ ...ok, url: '' }, true)).toMatch(/URL/)
    expect(campaignError({ ...ok, url: 'http://www.loja.com.br' }, false)).toMatch(/https/)
    expect(campaignError({ ...ok, url: 'javascript:alert(1)' }, true)).toMatch(/https/)
    expect(campaignError({ ...ok, title: 'x'.repeat(71) }, false)).toMatch(/70/)
    expect(campaignError({ ...ok, message: 'x'.repeat(141) }, false)).toMatch(/140/)
    expect(campaignError({ ...ok, buttonLabel: '' }, true)).toMatch(/botão/)
    expect(campaignError({ ...ok, buttonLabel: 'Ver ofertas' }, true)).toBeNull()
    expect(campaignError(ok, true)).toBeNull()
  })

  it('agenda no horário de Brasília e recusa data inexistente ou passada', () => {
    expect(saoPauloToUtc('2026-11-20', '10:30')?.toISOString()).toBe('2026-11-20T13:30:00.000Z')
    expect(saoPauloToUtc('2026-02-31', '10:00')).toBeNull()
    expect(saoPauloToUtc('2026-11-20', '25:00')).toBeNull()
    const now = new Date('2026-11-09T12:00:00Z')
    expect(scheduleError(new Date('2026-11-09T11:00:00Z'), now)).toMatch(/futuro/)
    expect(scheduleError(new Date('2026-11-09T12:00:30Z'), now)).toBeNull()
    expect(scheduleError(new Date('2028-01-01T00:00:00Z'), now)).toMatch(/um ano/)
  })

  it('só agendado com horário vencido sai', () => {
    const now = new Date('2026-11-09T12:00:00Z')
    expect(isDue({ status: 'AGENDADO', scheduledAt: new Date('2026-11-09T11:59:00Z') }, now)).toBe(true)
    expect(isDue({ status: 'AGENDADO', scheduledAt: new Date('2026-11-09T12:01:00Z') }, now)).toBe(false)
    expect(isDue({ status: 'RASCUNHO', scheduledAt: new Date('2026-11-09T11:00:00Z') }, now)).toBe(false)
    expect(isDue({ status: 'AGENDADO', scheduledAt: null }, now)).toBe(false)
  })

  it('porcentagens: entregas sobre disparos, cliques sobre entregas', () => {
    expect(statsOf({ sent: 200, delivered: 150, clicks: 15 })).toEqual({ deliveredPct: 75, clickPct: 10 })
    expect(statsOf({ sent: 0, delivered: 0, clicks: 0 })).toEqual({ deliveredPct: 0, clickPct: 0 })
    expect(statsOf({ sent: 3, delivered: 0, clicks: 1 })).toEqual({ deliveredPct: 0, clickPct: 33.3 })
  })

  it('link da campanha ganha a origem webpush sem perder as UTMs da pessoa', () => {
    expect(withUtm('https://loja.com.br/ofertas?x=1', 'Black Friday Ação')).toBe('https://loja.com.br/ofertas?x=1&utm_source=crm&utm_medium=webpush&utm_campaign=black-friday-acao')
    expect(withUtm('https://loja.com.br/?utm_source=rd', 'X')).toBe('https://loja.com.br/?utm_source=rd')
  })

  it('conteúdo enviado respeita os limites', () => {
    const p = JSON.parse(buildPayload({ title: 't'.repeat(90), body: 'b'.repeat(200), icon: null, image: null, url: 'https://crm/c', button: 'Ver', shown: 'https://crm/e', tag: 'crm-1' }))
    expect(p.title).toHaveLength(70)
    expect(p.body).toHaveLength(140)
    expect(p.button).toBe('Ver')
  })
})

describe('web push: inscrição e links', () => {
  it('aceita só serviços de notificação conhecidos, em https', () => {
    expect(pushEndpointOk('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(pushEndpointOk('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true)
    expect(pushEndpointOk('https://web.push.apple.com/QK')).toBe(true)
    expect(pushEndpointOk('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true)
    expect(pushEndpointOk('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(pushEndpointOk('https://fcm.googleapis.com.evil.com/x')).toBe(false)
    expect(pushEndpointOk('https://169.254.169.254/latest')).toBe(false)
    expect(pushEndpointOk('https://fcm.googleapis.com:8443/x')).toBe(false)
    expect(pushEndpointOk(`https://fcm.googleapis.com/${'a'.repeat(1000)}`)).toBe(false)
  })

  it('confere as chaves do navegador e o corpo da inscrição', () => {
    const k = browserKeys()
    expect(subscriptionKeysOk(k.p256dh, k.auth)).toBe(true)
    expect(subscriptionKeysOk(k.p256dh, randomBytes(8).toString('base64url'))).toBe(false)
    expect(subscriptionKeysOk(Buffer.alloc(65, 1).toString('base64url'), k.auth)).toBe(false)
    const body = { k: 'chave-do-site-123', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...k, v: 'a'.repeat(32) }
    expect(parseSubscribe(JSON.stringify(body))).toEqual(body)
    expect(parseSubscribe(JSON.stringify({ ...body, v: 'xx' }))?.v).toBeNull()
    expect(parseSubscribe(JSON.stringify({ ...body, endpoint: 'https://evil.com/x' }))).toBeNull()
    expect(parseSubscribe(JSON.stringify({ ...body, k: 'curta' }))).toBeNull()
    expect(parseSubscribe('{quebrado')).toBeNull()
    expect(parseUnsubscribe(JSON.stringify({ k: body.k, endpoint: body.endpoint }))).toEqual({ k: body.k, endpoint: body.endpoint })
  })

  it('entrega e clique só contam com a assinatura do envio', () => {
    const key = 'segredo'
    const cid = '11111111-1111-4111-8111-111111111111'
    const sid = '22222222-2222-4222-8222-222222222222'
    const u = signDelivery(key, cid, sid)
    expect(verifyDelivery(key, cid, u)).toBe(sid)
    expect(verifyDelivery(key, '33333333-3333-4333-8333-333333333333', u)).toBeNull()
    expect(verifyDelivery('outro', cid, u)).toBeNull()
    expect(verifyDelivery(key, cid, `${sid}.xxxxxxxxxxxxxxxxxxxxxx`)).toBeNull()
    expect(verifyDelivery(key, cid, 123)).toBeNull()
  })

  it('endereço da loja: só https e domínio público', () => {
    expect(siteOrigin('www.usaparts.com.br')).toBe('https://www.usaparts.com.br')
    expect(siteOrigin('https://www.usaparts.com.br/produtos?x=1')).toBe('https://www.usaparts.com.br')
    expect(siteOrigin('http://www.usaparts.com.br')).toBeNull()
    expect(siteOrigin('https://127.0.0.1')).toBeNull()
    expect(siteOrigin('https://localhost')).toBeNull()
  })
})

describe('web push: navegador', () => {
  it('pergunta só com a permissão em aberto e depois do prazo do "Agora não"', () => {
    const ask = new Function(`${PROMPT_RULE_JS}; return wpShouldAsk`)() as (perm: string, until: string | null, now: number) => boolean
    const now = Date.UTC(2026, 10, 9)
    expect(ask('default', null, now)).toBe(true)
    expect(ask('granted', null, now)).toBe(false)
    expect(ask('denied', null, now)).toBe(false)
    expect(ask('default', String(now + 86_400_000), now)).toBe(false)
    expect(ask('default', String(now - 1), now)).toBe(true)
    expect(ask('default', 'lixo', now)).toBe(true)
  })

  it('caixa de permissão com padrões em português e campos conferidos', () => {
    expect(cleanPrompt(undefined)).toEqual(DEFAULT_PROMPT)
    const p = cleanPrompt({ title: '  Novidades ', delaySec: 9999, askAgainDays: 0, color: 'red' })
    expect(p.title).toBe('Novidades')
    expect(p.delaySec).toBe(300)
    expect(p.askAgainDays).toBe(1)
    expect(p.color).toBe(DEFAULT_PROMPT.color)
  })

  it('service worker e script do site são JavaScript válido', () => {
    const sw = buildServiceWorker({ apiBase: 'https://crm.exemplo.com', siteKey: 'chave-do-site-123' })
    expect(sw).toContain(SW_MARKER)
    expect(sw).toContain('"api":"https://crm.exemplo.com"')
    expect(() => new Function(sw)).not.toThrow()
    const js = buildScript({ key: 'k'.repeat(24), endpoint: 'https://crm.exemplo.com/api/public/rastreamento/coleta', requireConsent: false, cookieDomains: ['exemplo.com'] })
    expect(js).toContain('startPush()')
    expect(js).not.toMatch(/innerHTML/)
    expect(() => new Function(js)).not.toThrow()
  })

  it('script da loja: mostra a caixa, pede a permissão, registra o service worker e envia a inscrição', async () => {
    type El = { tag: string; children: El[]; textContent: string; style: Record<string, string>; listeners: Record<string, () => void>; [k: string]: unknown }
    const make = (tag: string): El => {
      const e: El = { tag, children: [], textContent: '', style: {}, listeners: {} }
      Object.assign(e, {
        appendChild: (c: El) => (e.children.push(c), (c.parentNode = e), c),
        removeChild: (c: El) => (e.children.splice(e.children.indexOf(c), 1), (c.parentNode = null)),
        setAttribute: () => undefined,
        attachShadow: () => e,
        addEventListener: (n: string, f: () => void) => (e.listeners[n] = f),
      })
      return e
    }
    const body = make('body')
    const d = { body, createElement: make }
    const store: Record<string, string> = {}
    const posts: { url: string; body: unknown }[] = []
    const timers: (() => void)[] = []
    const reg = {
      active: { scriptURL: 'https://www.loja.com.br/crm-push-sw.js' },
      pushManager: {
        getSubscription: () => Promise.resolve(null),
        subscribe: (o: { applicationServerKey: Uint8Array }) => {
          expect(o.applicationServerKey).toHaveLength(65)
          return Promise.resolve({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'P', auth: 'A' } }) })
        },
      },
    }
    const registered: unknown[] = []
    const nav = { serviceWorker: { getRegistrations: () => Promise.resolve([]), register: (f: string, o: unknown) => (registered.push([f, o]), Promise.resolve(reg)) } }
    let perm = 'default'
    const w = {
      PushManager: {},
      Notification: { get permission() { return perm }, requestPermission: () => ((perm = 'granted'), Promise.resolve('granted')) },
      localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) },
      atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    }
    const publicKey = createECDH('prime256v1').generateKeys().toString('base64url')
    const fakeFetch = (url: string, o?: { body?: string }) => {
      if (url.includes('/config')) return Promise.resolve({ json: () => ({ enabled: true, key: publicKey, sw: 'crm-push-sw.js', host: 'www.loja.com.br', icon: null, prompt: { ...DEFAULT_PROMPT, delaySec: 3 } }) })
      posts.push({ url, body: JSON.parse(o!.body!) })
      return Promise.resolve({})
    }
    const { PUSH_JS } = await import('../src/webpush/webpush')
    const C = { e: 'https://crm.exemplo.com/api/public/rastreamento/coleta', k: 'chave-do-site-123' }
    const run = new Function('w', 'd', 'C', 'nav', 'get', 'fetch', 'setTimeout', 'location', `${PUSH_JS}; return startPush`)(
      w, d, C, nav, (n: string) => (n === '_crm_vid' ? 'f'.repeat(32) : null), fakeFetch, (f: () => void) => timers.push(f), { protocol: 'https:', origin: 'https://www.loja.com.br', hostname: 'www.loja.com.br' },
    ) as () => void
    run()
    await new Promise((r) => setTimeout(r, 0))
    expect(timers).toHaveLength(1)
    timers[0]!()
    const box = body.children[0]!
    const buttons: El[] = []
    const walk = (e: El) => (e.tag === 'button' && buttons.push(e), e.children.forEach(walk))
    walk(box)
    expect(buttons.map((b) => b.textContent)).toEqual(['Agora não', 'Permitir'])
    buttons[1]!.listeners.click!()
    expect(body.children).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 10))
    expect(registered).toEqual([['/crm-push-sw.js', { scope: '/' }]])
    expect(posts).toEqual([{ url: 'https://crm.exemplo.com/api/public/webpush/inscrever', body: { k: C.k, endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'P', auth: 'A', v: 'f'.repeat(32) } }])
    expect(store._crm_wp_sync).toBeTruthy()
  })

  it('service worker mostra a notificação, avisa a entrega e abre o link no clique', async () => {
    const listeners: Record<string, (e: unknown) => void> = {}
    const shown: unknown[] = []
    const opened: string[] = []
    const fetched: string[] = []
    const self = {
      addEventListener: (n: string, f: (e: unknown) => void) => (listeners[n] = f),
      skipWaiting: () => undefined,
      clients: { claim: () => Promise.resolve(), openWindow: (u: string) => opened.push(u) },
      registration: { showNotification: (t: string, o: unknown) => (shown.push([t, o]), Promise.resolve()) },
    }
    const fakeFetch = (u: string) => (fetched.push(u), Promise.resolve())
    new Function('self', 'fetch', buildServiceWorker({ apiBase: 'https://crm', siteKey: 'chave-do-site-123' }))(self, fakeFetch)
    const waits: Promise<unknown>[] = []
    const data = { title: 'Oi', body: 'Msg', icon: 'https://crm/i.png', image: null, url: 'https://crm/c/1?u=x', button: 'Ver', shown: 'https://crm/e/1?u=x', tag: 'crm-1' }
    listeners.push!({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
    expect(shown).toEqual([['Oi', { body: 'Msg', data: { url: 'https://crm/c/1?u=x' }, tag: 'crm-1', icon: 'https://crm/i.png', actions: [{ action: 'abrir', title: 'Ver' }] }]])
    expect(fetched).toEqual(['https://crm/e/1?u=x'])
    listeners.notificationclick!({ notification: { close: () => undefined, data: { url: 'https://crm/c/1?u=x' } }, waitUntil: () => undefined })
    expect(opened).toEqual(['https://crm/c/1?u=x'])
  })
})
