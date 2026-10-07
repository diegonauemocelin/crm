import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { isFollowOverdue, shouldCreatePostSale, validateFollow } from '../src/atendimento/regras'
import { cartItems, cartMessage, cleanBaseUrl, customerFrom, mzDateTime, nameFromUrl, orderGroup, parseMzDate } from '../src/integracoes/magazord'
import { classifyDevice } from '../src/rastreamento/origem'
import { buildScript } from '../src/rastreamento/script'

describe('pós-venda automático', () => {
  it('nasce quando a pré-venda passa a ter resultado, uma vez só', () => {
    expect(shouldCreatePostSale('PRE_VENDAS', 'NEGOCIACAO', 'SIM')).toBe(true)
    expect(shouldCreatePostSale('PRE_VENDAS', null, 'NAO')).toBe(true)
    expect(shouldCreatePostSale('PRE_VENDAS', 'SIM', 'NAO')).toBe(false)
    expect(shouldCreatePostSale('PRE_VENDAS', 'NEGOCIACAO', 'NEGOCIACAO')).toBe(false)
    expect(shouldCreatePostSale('POS_VENDAS', 'NEGOCIACAO', 'SIM')).toBe(false)
  })

  it('mudar a situação exige observação e não volta para "aguardando contato"', () => {
    expect(validateFollow('PENDENTE', 'RESOLVIDO', '')).toMatch(/observação/)
    expect(validateFollow('PENDENTE', 'VOLTOU_AO_VENDEDOR', 'Cliente quer trocar a peça')).toBeNull()
    expect(validateFollow('ANALISANDO', 'PENDENTE', 'x')).toMatch(/não pode voltar/)
    expect(validateFollow('ANALISANDO', 'ANALISANDO', null)).toBeNull()
  })

  it('fora do prazo só enquanto ninguém registrou contato', () => {
    const now = new Date('2026-10-07T12:00:00Z')
    const past = new Date('2026-10-07T11:00:00Z')
    expect(isFollowOverdue({ followStatus: 'PENDENTE', dueAt: past }, now)).toBe(true)
    expect(isFollowOverdue({ followStatus: 'CONTATADO', dueAt: past }, now)).toBe(false)
    expect(isFollowOverdue({ followStatus: 'PENDENTE', dueAt: new Date('2026-10-08T00:00:00Z') }, now)).toBe(false)
  })
})

describe('dispositivo da visita', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
  const WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36'
  const INSTAGRAM = 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 Instagram 350.0.0'
  const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'

  it('separa celular, computador e tablet', () => {
    expect(classifyDevice(IPHONE, null)).toBe('celular')
    expect(classifyDevice(ANDROID, null)).toBe('celular')
    expect(classifyDevice(WINDOWS, 'desktop')).toBe('computador')
    expect(classifyDevice(IPAD, null)).toBe('tablet')
  })

  it('reconhece o app da loja (WebView, dica da loja ou marcador configurado), mas não o Instagram', () => {
    expect(classifyDevice(WEBVIEW, null)).toBe('app')
    expect(classifyDevice(IOS_APP, null)).toBe('app')
    expect(classifyDevice(INSTAGRAM, null)).toBe('celular')
    expect(classifyDevice(ANDROID, 'app')).toBe('app')
    expect(classifyDevice(`${ANDROID} UsaPartsApp/2.1`, null, ['usapartsapp'])).toBe('app')
  })
})

describe('Magazord', () => {
  it('agrupa as situações do pedido', () => {
    expect(orderGroup(4)).toBe('pago')
    expect(orderGroup(8)).toBe('pago')
    expect(orderGroup(1)).toBe('pendente')
    expect(orderGroup(2)).toBe('cancelado')
    expect(orderGroup(16)).toBe('outro')
  })

  it('aceita só endereços do painel da Magazord (proteção contra SSRF)', () => {
    expect(cleanBaseUrl('usaparts.painel.magazord.com.br')).toBe('https://usaparts.painel.magazord.com.br')
    expect(cleanBaseUrl('https://usaparts.painel.magazord.com.br/api/')).toBe('https://usaparts.painel.magazord.com.br')
    expect(cleanBaseUrl('http://usaparts.painel.magazord.com.br')).toBeNull()
    expect(cleanBaseUrl('https://magazord.com.br.golpe.com')).toBeNull()
    expect(cleanBaseUrl('https://169.254.169.254')).toBeNull()
    expect(cleanBaseUrl('https://user:pass@x.magazord.com.br')).toBeNull()
  })

  it('datas sem fuso são horário de Brasília', () => {
    expect(parseMzDate('2026-10-07 10:00:00')?.toISOString()).toBe('2026-10-07T13:00:00.000Z')
    expect(parseMzDate('2026-10-07')?.toISOString()).toBe('2026-10-07T03:00:00.000Z')
    expect(parseMzDate('2026-10-07T15:51:28.071Z')?.toISOString()).toBe('2026-10-07T15:51:28.071Z')
    expect(mzDateTime(new Date('2026-10-07T13:00:00Z'))).toBe('2026-10-07 10:00:00')
  })

  it('cliente da loja vira lead: celular preferido, endereço, sem CPF', () => {
    const c = customerFrom({
      id: 77,
      tipo: 1,
      nome: 'João da Silva',
      email: ' Joao@Exemplo.com ',
      dataCadastro: '2026-09-01',
      pessoaContato: [{ tipo: 1, contato: '(47) 3333-4444' }, { tipo: 2, contato: '(47) 99647-0159' }],
      pessoaEndereco: [{ cidadeNome: 'Itajaí', estadoSigla: 'sc' }],
    })
    expect(c).toMatchObject({ externalId: '77', email: 'joao@exemplo.com', phone: '+5547996470159', city: 'Itajaí', state: 'SC', company: null })
    expect(JSON.stringify(c)).not.toMatch(/cpf/i)
  })

  it('produtos do carrinho com nome legível e links só https', () => {
    expect(nameFromUrl('https://www.usaparts.com.br/filtro-de-combustivel-racor-re539465', 'X')).toBe('Filtro de combustivel racor re539465')
    const items = cartItems([{ codigo_produto: '042442', quantidade: 2, url_pagina: 'https://www.usaparts.com.br/filtro-x', midia_url: 'javascript:alert(1)' }])
    expect(items).toEqual([{ code: '042442', name: 'Filtro x', qty: 2, image: null, url: 'https://www.usaparts.com.br/filtro-x' }])
  })

  it('mensagem de recuperação com nome, produtos, cupom e link', () => {
    const msg = cartMessage('Olá, {nome}! {produtos} te esperando. Cupom {cupom}: {link}', {
      name: 'Maria Souza',
      items: [{ code: '1', name: 'Filtro', qty: 1, image: null, url: null }, { code: '2', name: 'Correia', qty: 1, image: null, url: null }],
      link: 'https://loja/c/abc',
      coupon: 'VOLTA10',
    })
    expect(msg).toBe('Olá, Maria! Filtro e Correia te esperando. Cupom VOLTA10: https://loja/c/abc')
  })
})

describe('script: eventos de carrinho do dataLayer', () => {
  it('envia add_to_cart e begin_checkout publicados pela loja (formato gtag), sem repetir', () => {
    const code = buildScript({ key: 'k'.repeat(24), endpoint: 'https://crm/x', requireConsent: false, cookieDomains: ['usaparts.com.br'] })
    const sent: string[] = []
    const dataLayer: unknown[] = [{ device: 'mobile' }]
    const win: Record<string, unknown> = {
      dataLayer,
      navigator: { sendBeacon: (_u: string, b: string) => (sent.push(b), true) },
      crypto: { getRandomValues: (a: Uint8Array) => a.fill(9) },
      addEventListener: () => undefined,
    }
    let tick: () => void = () => undefined
    const ctx = {
      window: win,
      document: { cookie: '', title: 'Loja', referrer: '', readyState: 'complete', addEventListener: () => undefined },
      location: { href: 'https://www.usaparts.com.br/carrinho', hostname: 'www.usaparts.com.br', protocol: 'https:' },
      history: {},
      URL,
      setTimeout,
      setInterval: (fn: () => void) => ((tick = fn), 0),
    }
    runInNewContext(code, ctx)
    const add = ['event', 'add_to_cart', { items: [{ item_id: '042442P', item_name: 'Filtro', price: 75.74, quantity: 2 }], value: 151.48, currency: 'BRL' }]
    dataLayer.push(add, ['event', 'view_item', { items: [] }], ['event', 'begin_checkout', { items: [{ item_id: '1', item_name: 'Correia', price: 10 }], value: 10 }], add)
    tick()
    const events = sent.map((b) => JSON.parse(b)).filter((h) => h.x)
    expect(events.map((e) => e.x)).toEqual(['add_to_cart', 'begin_checkout'])
    expect(events[0]).toMatchObject({ val: 151.48, h: 'mobile', it: [{ id: '042442P', name: 'Filtro', price: 75.74, qty: 2 }] })
  })
})
