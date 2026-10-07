import { describe, expect, it } from 'vitest'
import { type Block, cleanBlocks, collectLinks, htmlToText, personalize, renderEmail, safeUrl, sanitizeRich, whatsappUrl } from '../src/email/blocos'

const brand = { appName: 'USA Parts', color: '#1d4ed8', logoUrl: 'https://crm.usaparts.com.br/api/files/public/logo', footerText: 'USA Parts Importadora\nMaravilha/SC' }
const base = { brand, subject: 'Ofertas para {primeiro_nome}', person: { name: 'Maria Souza', email: 'maria@x.com' }, unsubscribeUrl: 'https://crm/descadastro/tok?c=1' }

const clean = (raw: unknown[]) => {
  const r = cleanBlocks(raw)
  if ('error' in r) throw new Error(r.error)
  return r.blocks
}

describe('personalização', () => {
  it('usa o nome e some com a saudação vazia quando não há nome', () => {
    expect(personalize('Olá, {primeiro_nome}!', { name: 'Maria Souza', email: 'm@x' })).toBe('Olá, Maria!')
    expect(personalize('Olá, {primeiro_nome}!', { name: null, email: 'm@x' })).toBe('Olá!')
    expect(personalize('Seu e-mail: {email}', { name: null, email: 'm@x' })).toBe('Seu e-mail: m@x')
  })

  it('no texto formatado, o nome entra escapado', () => {
    const r = renderEmail(clean([{ type: 'texto', html: 'Oi, {primeiro_nome}' }]), { ...base, person: { name: '<img src=x onerror=alert(1)>', email: 'a@b' } })
    expect(r.html).toContain('Oi, &lt;img')
    expect(r.html).not.toContain('<img src=x')
  })
})

describe('texto formatado', () => {
  it('mantém negrito, itálico, sublinhado, cor e tamanho', () => {
    const html = sanitizeRich('<b>A</b> <i>B</i> <u>C</u> <span style="color: rgb(255, 0, 0); font-size: 20px">D</span> <font color="#00ff00" size="5">E</font>')
    expect(html).toBe('<strong>A</strong> <em>B</em> <u>C</u> <span style="color:#ff0000;font-size:20px;line-height:1.35">D</span> <span style="color:#00ff00;font-size:24px;line-height:1.35">E</span>')
  })

  it('remove script, eventos, estilos perigosos e links inseguros', () => {
    const html = sanitizeRich(
      '<script>alert(1)</script><img src=x onerror="alert(1)"><span style="background:url(javascript:x);color:red;position:fixed" onclick="x">ok</span><a href="javascript:alert(1)">link</a><a href="https://x.com/?a=1&amp;b=2" onmouseover="x">bom</a><style>body{}</style>',
    )
    expect(html).not.toMatch(/script|onerror|onclick|onmouseover|javascript|position|<img|<style/i)
    expect(html).toContain('ok')
    expect(html).toContain('link')
    expect(html).toContain('<a href="https://x.com/?a=1&amp;b=2"')
  })

  it('cor aplicada direto no negrito não se perde', () => {
    expect(sanitizeRich('<b style="color: rgb(220, 38, 38);">Peças</b> ok')).toBe('<strong><span style="color:#dc2626">Peças</span></strong> ok')
  })

  it('fecha tags abertas e ignora fechamentos soltos', () => {
    expect(sanitizeRich('<b>a<i>b')).toBe('<strong>a<em>b</em></strong>')
    expect(sanitizeRich('a</b></div>b')).toBe('ab')
    expect(sanitizeRich('1 < 2 & 3 > 2')).toBe('1 &lt; 2 &amp; 3 &gt; 2')
  })

  it('atributo com > dentro de aspas não quebra a limpeza', () => {
    const html = sanitizeRich('<a title="x>y" href="https://ok.com">t</a><span title=\'"><script>\'>s</span>')
    expect(html).not.toContain('<script')
    expect(html).toContain('href="https://ok.com"')
  })

  it('texto puro para quem não lê HTML', () => {
    expect(htmlToText('<div>Olá <strong>Ana</strong></div><div>Veja <a href="https://x.com/a?b=1&amp;c=2">aqui</a></div>')).toBe('Olá Ana\nVeja aqui (https://x.com/a?b=1&c=2)')
  })
})

describe('montagem do e-mail', () => {
  const blocks: Block[] = clean([
    { type: 'titulo', text: 'Olá, {primeiro_nome}' },
    { type: 'texto', text: 'Peças **JCB** com <script>alert(1)</script> desconto. Veja [o catálogo](https://www.usaparts.com.br/jcb).' },
    { type: 'botao', text: 'Comprar', url: 'https://www.usaparts.com.br/jcb' },
    { type: 'produtos', items: [{ name: 'Filtro', price: 'R$ 75,74', oldPrice: 'R$ 90,00', url: 'https://www.usaparts.com.br/filtro', image: 'https://img/f.jpg' }] },
    { type: 'whatsapp', text: 'Falar com vendas', phone: '(49) 99999-0000', message: 'Vim pelo e-mail' },
  ])

  it('escapa o texto do painel e personaliza', () => {
    const r = renderEmail(blocks, base)
    expect(r.subject).toBe('Ofertas para Maria')
    expect(r.html).toContain('Olá, Maria')
    expect(r.html).toContain('<strong>JCB</strong>')
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;')
    expect(r.html).toContain('text-decoration:line-through')
  })

  it('rodapé sempre com descadastro e dados da empresa', () => {
    const r = renderEmail([], base)
    expect(r.html).toContain('https://crm/descadastro/tok?c=1')
    expect(r.html).toContain('Maravilha/SC')
    expect(r.text).toContain('Para não receber mais: https://crm/descadastro/tok?c=1')
  })

  it('links únicos, na ordem, e trocados pelo endereço rastreado (inclusive o do WhatsApp)', () => {
    expect(collectLinks(blocks)).toEqual(['https://www.usaparts.com.br/jcb', 'https://www.usaparts.com.br/filtro', 'https://wa.me/5549999990000?text=Vim%20pelo%20e-mail'])
    const r = renderEmail(blocks, { ...base, trackLink: (_u, i) => `https://crm/api/public/e/l/T/${i}`, openPixelUrl: 'https://crm/api/public/e/a/T' })
    expect(r.html).toContain('href="https://crm/api/public/e/l/T/0"')
    expect(r.html).toContain('href="https://crm/api/public/e/l/T/1"')
    expect(r.html).toContain('href="https://crm/api/public/e/l/T/2"')
    expect(r.html).not.toContain('href="https://www.usaparts.com.br/jcb"')
    expect(r.html).toContain('src="https://crm/api/public/e/a/T"')
    expect(r.html).toContain('#25D366')
    // O link de descadastro nunca passa pelo rastreamento.
    expect(r.html).toContain('href="https://crm/descadastro/tok?c=1"')
  })

  it('versão em texto para quem não lê HTML', () => {
    const r = renderEmail(blocks, base)
    expect(r.text).toContain('OLÁ, MARIA')
    expect(r.text).toContain('o catálogo (https://www.usaparts.com.br/jcb)')
    expect(r.text).toContain('- Filtro — R$ 75,74')
    expect(r.text).toContain('Falar com vendas: https://wa.me/5549999990000')
  })
})

describe('validação dos blocos', () => {
  it('recusa botão sem link válido, imagem insegura, WhatsApp sem número e tipo desconhecido', () => {
    expect(cleanBlocks([{ type: 'botao', text: 'X', url: 'javascript:alert(1)' }])).toMatchObject({ error: expect.stringMatching(/link válido/) })
    expect(cleanBlocks([{ type: 'imagem', url: 'http://x' }])).toEqual({ blocks: [{ type: 'imagem', url: 'http://x', alt: '', link: undefined, width: undefined }] })
    expect(cleanBlocks([{ type: 'imagem', url: 'data:x' }])).toMatchObject({ error: expect.any(String) })
    expect(cleanBlocks([{ type: 'whatsapp', text: 'x', phone: '123' }])).toMatchObject({ error: expect.stringMatching(/WhatsApp/) })
    expect(cleanBlocks([{ type: 'html', html: '<b>' }])).toMatchObject({ error: expect.stringMatching(/desconhecido/) })
  })

  it('texto formatado é limpo ao salvar e o formato antigo é convertido', () => {
    const [a, b] = clean([
      { type: 'texto', html: '<b onclick="x">oi</b><script>x</script>', color: '#ff0000', size: 99 },
      { type: 'texto', text: '**forte** e [site](https://x.com)' },
    ])
    expect(a).toEqual({ type: 'texto', html: '<strong>oi</strong>', align: 'left', size: 15, color: '#ff0000', bg: undefined })
    expect(b).toMatchObject({ html: '<strong>forte</strong> e <a href="https://x.com" style="color:inherit;text-decoration:underline" target="_blank">site</a>' })
  })

  it('número do WhatsApp com DDI do Brasil', () => {
    expect(whatsappUrl('49 99999-0000')).toBe('https://wa.me/5549999990000')
    expect(whatsappUrl('+55 (49) 3333-0000', 'Olá & tchau')).toBe('https://wa.me/554933330000?text=Ol%C3%A1%20%26%20tchau')
    expect(whatsappUrl('12')).toBeNull()
  })

  it('aceita mailto e tel só em botão e texto', () => {
    expect(safeUrl('mailto:vendas@x.com', true)).toBe('mailto:vendas@x.com')
    expect(safeUrl('mailto:vendas@x.com')).toBeNull()
  })
})
