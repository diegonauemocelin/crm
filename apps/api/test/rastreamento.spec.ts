import { createHmac } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { contactFromMeta, leadgenNotices, touchFromMeta, validSignature } from '../src/integracoes/meta'
import { classifyTouch, cleanDomain, cleanUrl, describeTouch, domainAllowed } from '../src/rastreamento/origem'
import { buildScript } from '../src/rastreamento/script'

const SITE = ['usaparts.com.br']

describe('origem da visita', () => {
  it('UTMs têm prioridade sobre o site que indicou', () => {
    const t = classifyTouch('https://www.usaparts.com.br/p/filtro?utm_source=Newsletter&utm_medium=email&utm_campaign=outubro', 'https://www.google.com/', SITE)
    expect(t).toMatchObject({ source: 'newsletter', medium: 'email', campaign: 'outubro', referrer: 'www.google.com' })
  })

  it('reconhece anúncio do Google e do Meta pelos identificadores de clique', () => {
    expect(classifyTouch('https://usaparts.com.br/?gclid=abc', null, SITE)).toMatchObject({ source: 'google', medium: 'cpc' })
    expect(classifyTouch('https://usaparts.com.br/?fbclid=abc', 'https://l.instagram.com/', SITE)).toMatchObject({ source: 'instagram', medium: 'social' })
  })

  it('classifica busca orgânica, rede social, e-mail, indicação e acesso direto', () => {
    expect(classifyTouch('https://usaparts.com.br/', 'https://www.google.com.br/', SITE)).toMatchObject({ source: 'google', medium: 'organico' })
    expect(classifyTouch('https://usaparts.com.br/', 'https://search.brave.com/', SITE)).toMatchObject({ source: 'brave', medium: 'organico' })
    expect(classifyTouch('https://usaparts.com.br/', 'https://lm.facebook.com/', SITE)).toMatchObject({ source: 'facebook', medium: 'social' })
    expect(classifyTouch('https://usaparts.com.br/', 'https://mail.google.com/', SITE)).toMatchObject({ source: 'email', medium: 'email' })
    expect(classifyTouch('https://usaparts.com.br/', 'https://www.forum-tratores.com.br/topico/1', SITE)).toMatchObject({ source: 'forum-tratores.com.br', medium: 'referencia', referrer: 'www.forum-tratores.com.br' })
    expect(classifyTouch('https://usaparts.com.br/', null, SITE)).toMatchObject({ source: 'direto', medium: 'direto' })
  })

  it('navegação dentro do próprio site não é uma nova origem', () => {
    expect(classifyTouch('https://www.usaparts.com.br/carrinho', 'https://usaparts.com.br/produto', SITE)).toBeNull()
  })

  it('guarda só o domínio de quem indicou e descreve em português', () => {
    const t = classifyTouch('https://usaparts.com.br/?utm_source=google&utm_medium=cpc&utm_campaign=bf', null, SITE)
    expect(describeTouch(t)).toBe('google (anúncio) · campanha bf')
    expect(describeTouch({ source: 'direto', medium: 'direto' })).toBe('acesso direto')
  })
})

describe('privacidade da URL guardada', () => {
  it('descarta parâmetros desconhecidos (podem ter e-mail, token, CPF) e o fragmento', () => {
    expect(cleanUrl('https://usaparts.com.br/conta?email=a@b.com&token=xyz&utm_source=x&q=filtro#topo')).toBe('https://usaparts.com.br/conta?utm_source=x&q=filtro')
  })

  it('recusa esquemas que não são http(s)', () => {
    expect(cleanUrl('javascript:alert(1)')).toBeNull()
    expect(cleanUrl('não é url')).toBeNull()
  })
})

describe('domínios do site', () => {
  it('aceita o domínio e subdomínios, nunca domínios parecidos', () => {
    expect(domainAllowed('usaparts.com.br', SITE)).toBe(true)
    expect(domainAllowed('www.usaparts.com.br', SITE)).toBe(true)
    expect(domainAllowed('usaparts.com.br.golpe.com', SITE)).toBe(false)
    expect(domainAllowed('falsausaparts.com.br', SITE)).toBe(false)
    expect(domainAllowed(null, SITE)).toBe(false)
  })

  it('normaliza o que é digitado no painel', () => {
    expect(cleanDomain('https://www.UsaParts.com.br/loja')).toBe('www.usaparts.com.br')
    expect(cleanDomain('*.usaparts.com.br')).toBe('usaparts.com.br')
    expect(cleanDomain('localhost')).toBeNull()
    expect(cleanDomain('a b.com')).toBeNull()
  })
})

describe('script do site', () => {
  it('é JavaScript válido e não envia nada sem consentimento quando o modo exige', () => {
    const code = buildScript({ key: 'k'.repeat(24), endpoint: 'https://crm.exemplo.com.br/api/public/rastreamento/coleta', requireConsent: true, cookieDomains: SITE })
    const sent: string[] = []
    const doc = { cookie: '', title: 'Teste', referrer: '', readyState: 'complete', addEventListener: () => undefined }
    const win: Record<string, unknown> = {
      navigator: { sendBeacon: (_u: string, b: string) => (sent.push(b), true) },
      crypto: { getRandomValues: (a: Uint8Array) => a.fill(7) },
      addEventListener: () => undefined,
    }
    const ctx = { window: win, document: doc, location: { href: 'https://www.usaparts.com.br/?crm_lid=abc', hostname: 'www.usaparts.com.br', protocol: 'https:' }, history: { state: null, replaceState: () => undefined }, URL, setTimeout }
    runInNewContext(code, ctx)
    expect(sent).toHaveLength(0)
    ;(win.usaCrm as (c: string, a?: unknown) => void)('consent', true)
    expect(sent).toHaveLength(1)
    const hit = JSON.parse(sent[0]!)
    // O token de identificação é enviado e some da URL registrada.
    expect(hit).toMatchObject({ l: 'abc', n: true, u: 'https://www.usaparts.com.br/' })
    expect(doc.cookie).toContain('Domain=.usaparts.com.br')
  })

  it('respeita o sinal de privacidade do navegador (GPC)', () => {
    const code = buildScript({ key: 'k'.repeat(24), endpoint: 'https://crm/x', requireConsent: false, cookieDomains: SITE })
    const sent: string[] = []
    const win: Record<string, unknown> = { navigator: { globalPrivacyControl: true, sendBeacon: (_u: string, b: string) => (sent.push(b), true) }, addEventListener: () => undefined }
    runInNewContext(code, { window: win, document: { cookie: '', readyState: 'complete' }, location: { href: 'https://usaparts.com.br/', hostname: 'usaparts.com.br', protocol: 'https:' }, history: {}, URL, setTimeout })
    expect(sent).toHaveLength(0)
  })
})

describe('Meta Lead Ads', () => {
  const body = Buffer.from(JSON.stringify({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: '123456', form_id: '99', page_id: '7', created_time: 1760000000 } }, { field: 'feed', value: {} }] }] }))

  it('aceita só a assinatura feita com a chave secreta do app', () => {
    const sig = `sha256=${createHmac('sha256', 'segredo').update(body).digest('hex')}`
    expect(validSignature(body, sig, 'segredo')).toBe(true)
    expect(validSignature(body, sig, 'outro')).toBe(false)
    expect(validSignature(Buffer.concat([body, Buffer.from(' ')]), sig, 'segredo')).toBe(false)
    expect(validSignature(body, undefined, 'segredo')).toBe(false)
  })

  it('lê só os avisos de novo lead, com id numérico', () => {
    expect(leadgenNotices(JSON.parse(body.toString()))).toEqual([{ leadgenId: '123456', formId: '99', pageId: '7', createdTime: 1760000000 }])
    expect(leadgenNotices({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: '../me' } }] }] })).toEqual([])
    expect(leadgenNotices({ object: 'user' })).toEqual([])
  })

  it('converte as respostas do formulário em contato e guarda as perguntas extras', () => {
    const { contact, answers } = contactFromMeta({
      field_data: [
        { name: 'email', values: ['Joao@Exemplo.com'] },
        { name: 'phone_number', values: ['+5547999998888'] },
        { name: 'first_name', values: ['João'] },
        { name: 'last_name', values: ['Silva'] },
        { name: 'qual_a_marca_da_maquina?', values: ['John Deere'] },
      ],
    })
    expect(contact).toEqual({ email: 'Joao@Exemplo.com', phone: '+5547999998888', name: 'João Silva' })
    expect(answers).toEqual({ 'qual_a_marca_da_maquina?': 'John Deere' })
  })

  it('origem: plataforma, anúncio pago ou orgânico, campanha', () => {
    expect(touchFromMeta({ platform: 'ig', is_organic: false, campaign_name: 'Peças', ad_name: 'Vídeo' }, '99')).toEqual({ source: 'instagram', medium: 'cpc', campaign: 'Peças', content: 'Vídeo', landing: 'Formulário do Meta 99' })
  })
})
