import { describe, expect, it } from 'vitest'
import { type Block, cleanBlocks, collectLinks, renderEmail } from '../src/email/blocos'
import { cartEmailItems } from '../src/integracoes/magazord'

const brand = { appName: 'Usaparts', color: '#1d4ed8', logoUrl: null, iconBase: 'https://crm.exemplo.com/i', footer: '' } as never
const base = { brand, subject: 'Seu carrinho, {primeiro_nome}', unsubscribeUrl: 'https://crm.exemplo.com/descadastro/x' }
const blocks: Block[] = [
  { type: 'texto', html: '<p>Use o cupom <strong>{cupom}</strong> e finalize a compra.</p>' },
  { type: 'carrinho', columns: 2, buttonText: 'Voltar ao carrinho' },
  { type: 'botao', text: 'Comprar', url: '{link_carrinho}' },
]
const cart = { items: [{ name: 'Filtro de Ar JCB', price: 'R$ 189,90', image: 'https://img.exemplo.com/f.jpg', url: 'https://loja.exemplo.com/filtro' }], url: 'https://loja.exemplo.com/checkout/abc' }

describe('e-mail de carrinho abandonado', () => {
  it('mostra os produtos do carrinho do cliente, o botão de volta e o cupom', () => {
    const out = renderEmail(blocks, { ...base, person: { name: 'João Silva', email: 'j@x.com', vars: { cupom: 'VOLTE10', link_carrinho: cart.url } }, cart, trackLink: (_u, i) => `https://crm/l/${i}` })
    expect(out.html).toContain('Filtro de Ar JCB')
    expect(out.html).toContain('R$ 189,90')
    expect(out.html).toContain('Voltar ao carrinho')
    expect(out.html).toContain('<strong>VOLTE10</strong>')
    // links do carrinho vão direto (mudam a cada cliente): sem contagem de clique
    expect(out.html).toContain('href="https://loja.exemplo.com/checkout/abc"')
    expect(out.html).toContain('href="https://loja.exemplo.com/filtro"')
    expect(out.text).toContain('Voltar ao carrinho: https://loja.exemplo.com/checkout/abc')
  })

  it('campanha comum (sem carrinho): o bloco some; o cupom do e-mail vale para todos', () => {
    const out = renderEmail(blocks, { ...base, person: { name: 'João', email: 'j@x.com', vars: { cupom: 'TODOS5' } } })
    expect(out.html).toContain('TODOS5')
    expect(out.html).not.toContain('Voltar ao carrinho')
    expect(out.html).not.toContain('{cupom')
    expect(out.html).not.toContain('{link_carrinho}')
  })

  it('pré-visualização mostra um carrinho de exemplo', () => {
    const out = renderEmail(blocks, { ...base, person: { name: 'Ana', email: 'a@x.com', vars: { cupom: 'VOLTE10' } }, cart: 'exemplo' })
    expect(out.html).toContain('Produto do carrinho do cliente')
    expect(out.html).toContain('VOLTE10')
  })

  it('o editor aceita o bloco e o botão com {link_carrinho}; o link do carrinho não entra na lista de cliques', () => {
    const r = cleanBlocks([{ type: 'carrinho', columns: 3, showPrices: false }, { type: 'botao', text: 'Comprar', url: '{link_carrinho}' }])
    expect('error' in r).toBe(false)
    if ('blocks' in r) {
      expect(r.blocks[0]).toEqual({ type: 'carrinho', columns: 3, buttonText: undefined, buttonColor: undefined, showPrices: false })
      expect(collectLinks(r.blocks)).toEqual([])
    }
    expect('error' in cleanBlocks([{ type: 'botao', text: 'X', url: '{qualquer}' }])).toBe(true)
  })

  it('itens do carrinho com nome, foto e preço do catálogo da loja', () => {
    const items = cartEmailItems(
      [
        { code: '042442', name: 'Filtro de combustivel re539465', qty: 2, image: null, url: 'https://loja.exemplo.com/filtro' },
        { code: '999', name: 'Sem catalogo', qty: 1, image: 'https://img/x.jpg', url: null },
      ],
      new Map([['042442', { name: 'Filtro de Combustível Racor RE539465', image: 'https://img/f.jpg', url: 'https://loja.exemplo.com/filtro-racor', price: 289.9, priceFrom: 320 }]]),
    )
    expect(items[0]).toEqual({ name: 'Filtro de Combustível Racor RE539465 (2 un.)', image: 'https://img/f.jpg', url: 'https://loja.exemplo.com/filtro-racor', price: 'R$ 289,90', oldPrice: 'R$ 320,00' })
    expect(items[1]).toEqual({ name: 'Sem catalogo', image: 'https://img/x.jpg', url: undefined, price: undefined, oldPrice: undefined })
  })
})
