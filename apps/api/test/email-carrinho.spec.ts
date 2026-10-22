import { describe, expect, it } from 'vitest'
import { type Block, cleanBlocks, collectLinks, renderEmail } from '../src/email/blocos'
import { cartEmailItems, cleanCoupon, couponBody, couponCode, couponTexts } from '../src/integracoes/magazord'

const brand = { appName: 'Usaparts', color: '#1d4ed8', logoUrl: null, iconBase: 'https://crm.exemplo.com/i', footer: '' } as never
const base = { brand, subject: 'Seu carrinho, {primeiro_nome}', unsubscribeUrl: 'https://crm.exemplo.com/descadastro/x' }
const blocks: Block[] = [
  { type: 'texto', html: '<p>Use o cupom <strong>{cupom}</strong> ({cupom_desconto}) até {cupom_validade}.</p>' },
  { type: 'carrinho', columns: 2, buttonText: 'Voltar ao carrinho' },
  { type: 'botao', text: 'Comprar', url: '{link_carrinho}' },
]
const cart = { items: [{ name: 'Filtro de Ar JCB', price: 'R$ 189,90', image: 'https://img.exemplo.com/f.jpg', url: 'https://loja.exemplo.com/filtro' }], url: 'https://loja.exemplo.com/checkout/abc' }

describe('e-mail de carrinho abandonado', () => {
  it('mostra os produtos do carrinho do cliente, o botão de volta e o cupom', () => {
    const out = renderEmail(blocks, { ...base, person: { name: 'João Silva', email: 'j@x.com', vars: { cupom: 'VOLTEABC123', cupom_desconto: '10%', cupom_validade: '31/10', link_carrinho: cart.url } }, cart, trackLink: (_u, i) => `https://crm/l/${i}` })
    expect(out.html).toContain('Filtro de Ar JCB')
    expect(out.html).toContain('R$ 189,90')
    expect(out.html).toContain('Voltar ao carrinho')
    expect(out.html).toContain('VOLTEABC123')
    expect(out.html).toContain('(10%) até 31/10')
    // links do carrinho vão direto (mudam a cada cliente): sem contagem de clique
    expect(out.html).toContain('href="https://loja.exemplo.com/checkout/abc"')
    expect(out.html).toContain('href="https://loja.exemplo.com/filtro"')
    expect(out.text).toContain('Voltar ao carrinho: https://loja.exemplo.com/checkout/abc')
  })

  it('campanha comum (sem carrinho): o bloco some e as variáveis ficam vazias', () => {
    const out = renderEmail(blocks, { ...base, person: { name: 'João', email: 'j@x.com' } })
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

describe('cupom do e-mail de carrinho abandonado', () => {
  it('confere a configuração do passo', () => {
    expect(cleanCoupon(undefined)).toEqual({ mode: 'loja' })
    expect(cleanCoupon({ mode: 'fixo', code: 'volte10' })).toEqual({ mode: 'fixo', code: 'VOLTE10' })
    expect(cleanCoupon({ mode: 'fixo', code: 'a b' })).toMatch(/Cupom fixo/)
    expect(cleanCoupon({ mode: 'unico', kind: 'percentual', value: 95 })).toMatch(/1% a 90%/)
    expect(cleanCoupon({ mode: 'unico', kind: 'percentual', value: 10, days: 90 })).toMatch(/1 a 60 dias/)
    expect(cleanCoupon({ mode: 'unico', kind: 'valor', value: 50, days: 5, minOrder: 300, onlyCartProducts: true })).toEqual({ mode: 'unico', kind: 'valor', value: 50, days: 5, minOrder: 300, onlyCartProducts: true })
  })

  it('cupom único: só do cliente (com cadastro) ou uso único geral, validade e produtos do carrinho', () => {
    const now = new Date('2026-10-22T15:00:00Z')
    const c = { mode: 'unico' as const, kind: 'percentual' as const, value: 10, days: 7, onlyCartProducts: true }
    const b = couponBody(c, { code: 'VOLTEABC234', storeId: 1, customerId: '102', productCodes: ['042442', '042442'], who: 'Oficina Pesada', now })
    expect(b).toMatchObject({ codigo: 'VOLTEABC234', loja: 1, pessoa: 102, tipoDesconto: 2, valorDesconto: 10, tipoLimite: 2, restricaoTipo: 1, restricaoProdutos: ['042442'], validoDe: '2026-10-22T15:00:00.000Z', validoAte: '2026-10-29T15:00:00.000Z' })
    const anon = couponBody({ ...c, onlyCartProducts: false }, { code: 'X', storeId: 1, customerId: null, productCodes: [], who: 'x', now })
    expect(anon).not.toHaveProperty('pessoa')
    expect(anon).toMatchObject({ tipoLimite: 3, restricaoTipo: 0 })
    expect(couponTexts(c, now)).toEqual({ discount: '10%', until: '29/10' })
    expect(couponTexts({ mode: 'unico', kind: 'valor', value: 50, days: 1 }, now).discount).toBe('R$ 50,00')
  })

  it('código legível: VOLTE + 6 caracteres sem 0, O, 1 e I', () => {
    const code = couponCode()
    expect(code).toMatch(/^VOLTE[A-HJ-NP-Z2-9]{6}$/)
  })
})
