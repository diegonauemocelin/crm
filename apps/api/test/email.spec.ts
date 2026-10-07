import { describe, expect, it } from 'vitest'
import { type Block, cleanBlocks, collectLinks, personalize, renderEmail, safeUrl } from '../src/email/blocos'

const brand = { appName: 'USA Parts', color: '#1d4ed8', logoUrl: 'https://crm.usaparts.com.br/api/files/public/logo', footerText: 'USA Parts Importadora\nMaravilha/SC' }
const base = { brand, subject: 'Ofertas para {primeiro_nome}', person: { name: 'Maria Souza', email: 'maria@x.com' }, unsubscribeUrl: 'https://crm/descadastro/tok?c=1' }

describe('personalização', () => {
  it('usa o nome e some com a saudação vazia quando não há nome', () => {
    expect(personalize('Olá, {primeiro_nome}!', { name: 'Maria Souza', email: 'm@x' })).toBe('Olá, Maria!')
    expect(personalize('Olá, {primeiro_nome}!', { name: null, email: 'm@x' })).toBe('Olá!')
    expect(personalize('Seu e-mail: {email}', { name: null, email: 'm@x' })).toBe('Seu e-mail: m@x')
  })
})

describe('montagem do e-mail', () => {
  const blocks: Block[] = [
    { type: 'titulo', text: 'Olá, {primeiro_nome}' },
    { type: 'texto', text: 'Peças **JCB** com <script>alert(1)</script> desconto. Veja [o catálogo](https://www.usaparts.com.br/jcb).' },
    { type: 'botao', text: 'Comprar', url: 'https://www.usaparts.com.br/jcb' },
    { type: 'produtos', items: [{ name: 'Filtro', price: 'R$ 75,74', url: 'https://www.usaparts.com.br/filtro', image: 'https://img/f.jpg' }] },
    { type: 'imagem', url: 'javascript:alert(1)' },
  ]

  it('escapa o texto do painel e personaliza', () => {
    const r = renderEmail(blocks, base)
    expect(r.subject).toBe('Ofertas para Maria')
    expect(r.html).toContain('Olá, Maria')
    expect(r.html).toContain('<strong>JCB</strong>')
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;')
    expect(r.html).not.toContain('javascript:')
  })

  it('rodapé sempre com descadastro e dados da empresa', () => {
    const r = renderEmail([], base)
    expect(r.html).toContain('https://crm/descadastro/tok?c=1')
    expect(r.html).toContain('Maravilha/SC')
    expect(r.text).toContain('Para não receber mais: https://crm/descadastro/tok?c=1')
  })

  it('links únicos, na ordem, e trocados pelo endereço rastreado', () => {
    expect(collectLinks(blocks)).toEqual(['https://www.usaparts.com.br/jcb', 'https://www.usaparts.com.br/filtro'])
    const r = renderEmail(blocks, { ...base, trackLink: (_u, i) => `https://crm/api/public/e/l/T/${i}`, openPixelUrl: 'https://crm/api/public/e/a/T' })
    expect(r.html).toContain('href="https://crm/api/public/e/l/T/0"')
    expect(r.html).toContain('href="https://crm/api/public/e/l/T/1"')
    expect(r.html).not.toContain('href="https://www.usaparts.com.br/jcb"')
    expect(r.html).toContain('src="https://crm/api/public/e/a/T"')
    // O link de descadastro nunca passa pelo rastreamento.
    expect(r.html).toContain('href="https://crm/descadastro/tok?c=1"')
  })

  it('versão em texto para quem não lê HTML', () => {
    const r = renderEmail(blocks, base)
    expect(r.text).toContain('OLÁ, MARIA')
    expect(r.text).toContain('o catálogo (https://www.usaparts.com.br/jcb)')
    expect(r.text).toContain('- Filtro — R$ 75,74')
  })
})

describe('validação dos blocos', () => {
  it('recusa botão sem link válido, imagem insegura e tipo desconhecido', () => {
    expect(cleanBlocks([{ type: 'botao', text: 'X', url: 'javascript:alert(1)' }])).toMatchObject({ error: expect.stringMatching(/link válido/) })
    expect(cleanBlocks([{ type: 'imagem', url: 'http://x' }])).toEqual({ blocks: [{ type: 'imagem', url: 'http://x', alt: '', link: undefined }] })
    expect(cleanBlocks([{ type: 'imagem', url: 'data:x' }])).toMatchObject({ error: expect.any(String) })
    expect(cleanBlocks([{ type: 'html', html: '<b>' }])).toMatchObject({ error: expect.stringMatching(/desconhecido/) })
  })

  it('aceita mailto e tel só em botão e texto', () => {
    expect(safeUrl('mailto:vendas@x.com', true)).toBe('mailto:vendas@x.com')
    expect(safeUrl('mailto:vendas@x.com')).toBeNull()
  })
})
