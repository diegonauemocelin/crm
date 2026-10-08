import { describe, expect, it } from 'vitest'
import { cleanFields, pageMatches, safeRedirect, validateSubmission, waLink, whatsappText } from '../src/captura/regras'

const CUSTOMS = [{ key: 'marca', label: 'Marca da máquina', type: 'SELECT', options: ['John Deere', 'Case'], active: true }]

describe('definição do formulário', () => {
  it('aceita campos do lead e personalizados ativos, sem repetição', () => {
    const r = cleanFields(
      [
        { key: 'name', label: '', required: true },
        { key: 'phone', label: 'Celular', required: true },
        { key: 'phone', label: 'de novo' },
        { key: 'custom:marca', required: false },
      ],
      CUSTOMS,
    )
    expect(r).toEqual({
      fields: [
        { key: 'name', label: 'Nome', required: true, type: 'text' },
        { key: 'phone', label: 'Celular', required: true, type: 'tel' },
        { key: 'custom:marca', label: 'Marca da máquina', required: false, type: 'select', options: ['John Deere', 'Case'] },
      ],
    })
  })

  it('recusa campo desconhecido e formulário sem e-mail nem telefone', () => {
    expect(cleanFields([{ key: 'cpf' }], CUSTOMS)).toEqual({ error: 'Campo desconhecido: cpf' })
    expect(cleanFields([{ key: 'name' }], CUSTOMS)).toMatchObject({ error: expect.stringMatching(/e-mail ou WhatsApp/) })
    expect(cleanFields([], CUSTOMS)).toMatchObject({ error: expect.any(String) })
  })
})

describe('envio do formulário', () => {
  const fields = [
    { key: 'name', label: 'Nome', required: true },
    { key: 'email', label: 'E-mail', required: false },
    { key: 'phone', label: 'WhatsApp', required: true },
    { key: 'state', label: 'Estado', required: false },
    { key: 'custom:marca', label: 'Marca', required: false, options: ['John Deere', 'Case'] },
    { key: 'message', label: 'Mensagem', required: false },
  ]

  it('normaliza contato e separa respostas personalizadas', () => {
    const r = validateSubmission(fields, { name: ' Ana ', email: 'Ana@X.com', phone: '(47) 99647-0159', state: 'sc', 'custom:marca': 'Case', message: 'Preciso de filtro' })
    expect(r).toEqual({
      data: {
        contact: { name: 'Ana', email: 'ana@x.com', phone: '+5547996470159', company: null, jobTitle: null, city: null, state: 'SC' },
        custom: { marca: 'Case' },
        message: 'Preciso de filtro',
      },
    })
  })

  it('aponta os erros por campo', () => {
    const r = validateSubmission(fields, { name: '', phone: '123', email: 'x@', state: 'ZZ', 'custom:marca': 'Volvo' })
    expect(r).toEqual({ errors: { name: 'Preencha este campo.', phone: 'Telefone inválido. Use DDD + número.', email: 'E-mail inválido.', state: 'Estado inválido.', 'custom:marca': 'Opção inválida.' } })
  })

  it('ignora campos que não estão no formulário', () => {
    const r = validateSubmission([{ key: 'email', label: 'E-mail', required: true }], { email: 'a@b.com', isAdmin: true, tenantId: 'x' })
    expect('data' in r && r.data.contact.email).toBe('a@b.com')
    expect(JSON.stringify(r)).not.toMatch(/isAdmin|tenantId/)
  })
})

describe('onde o pop-up/botão aparece', () => {
  it('trechos do endereço, prefixo com * e exclusões', () => {
    expect(pageMatches('https://loja.com/produto/filtro', [], [])).toBe(true)
    expect(pageMatches('https://loja.com/produto/filtro', ['/produto/*'], [])).toBe(true)
    expect(pageMatches('https://loja.com/carrinho', ['/produto/*'], [])).toBe(false)
    expect(pageMatches('https://loja.com/checkout/pagamento', [], ['checkout'])).toBe(false)
  })

  it('aceita domínio: só no site das LPs e nunca na loja', () => {
    const inc = ['teste.usaparts.com.br']
    const exc = ['usaparts.com.br']
    expect(pageMatches('http://teste.usaparts.com.br/', inc, exc)).toBe(true)
    expect(pageMatches('https://teste.usaparts.com.br/ofertas-jcb', inc, exc)).toBe(true)
    expect(pageMatches('https://www.usaparts.com.br/produto/x', inc, exc)).toBe(false)
    expect(pageMatches('https://usaparts.com.br/', [], exc)).toBe(false)
    expect(pageMatches('https://teste.usaparts.com.br/a', ['https://teste.usaparts.com.br/ofertas*'], [])).toBe(false)
    expect(pageMatches('https://teste.usaparts.com.br/ofertas-jcb', ['https://teste.usaparts.com.br/ofertas*'], [])).toBe(true)
  })
})

describe('WhatsApp e redirecionamento', () => {
  it('mensagem com o primeiro nome e link wa.me', () => {
    const text = whatsappText('Olá! Meu nome é {nome}. Vim pela página {pagina}', { name: 'Maria Souza', page: 'https://loja.com/x' })
    expect(text).toBe('Olá! Meu nome é Maria. Vim pela página https://loja.com/x')
    expect(waLink('+5547996470159', 'Oi tudo bem')).toBe('https://wa.me/554796470159?text=Oi%20tudo%20bem')
  })

  it('só aceita endereços http(s)', () => {
    expect(safeRedirect('javascript:alert(1)')).toBeNull()
    expect(safeRedirect('https://usaparts.com.br/obrigado')).toBe('https://usaparts.com.br/obrigado')
  })
})

describe('editor visual: layout', () => {
  const form = { id: 'f', type: 'formulario' }
  it('exige exatamente um bloco Formulário', async () => {
    const { cleanDesign } = await import('../src/captura/design')
    expect(cleanDesign({ blocks: [] }, 'popup')).toMatchObject({ error: expect.stringMatching(/Formulário/) })
    expect(cleanDesign({ blocks: [form, { ...form, id: 'g' }] }, 'popup')).toMatchObject({ error: expect.stringMatching(/só um/) })
    expect(cleanDesign({ blocks: [{ type: 'script' }, form] }, 'popup')).toMatchObject({ error: expect.stringMatching(/desconhecido/) })
    expect(cleanDesign({ blocks: Array.from({ length: 21 }, () => ({ type: 'espaco' })) }, 'popup')).toMatchObject({ error: expect.stringMatching(/20/) })
  })

  it('limpa cores, números, textos e links', async () => {
    const { cleanDesign } = await import('../src/captura/design')
    const r = cleanDesign(
      {
        box: { width: 9999, radius: -3, bg: 'red', font: 'comic', position: 'meio', overlayOpacity: 500 },
        mobile: { position: 'tela_cheia', fontScale: 300 },
        blocks: [
          { id: 'i', type: 'imagem', url: 'javascript:alert(1)' },
        ],
      },
      'popup',
    )
    expect(r).toMatchObject({ error: expect.stringMatching(/https/) })
    const ok = cleanDesign(
      {
        box: { width: 9999, radius: -3, bg: 'red', font: 'comic', position: 'meio', overlayOpacity: 500 },
        mobile: { position: 'tela_cheia', fontScale: 300 },
        blocks: [
          { id: 't', type: 'titulo', text: 'Oi\u0007 <b>x</b>', size: 200, color: '#ABCDEF', align: 'centro' },
          { id: 'c', type: 'cupom', code: 'usa10', label: 'Seu cupom' },
          { id: 'r', type: 'recusar' },
          { id: 'f', type: 'formulario', columns: 2, buttonBg: '#000000', buttonText: '  Quero  ' },
          { id: 'im', type: 'imagem', url: 'https://cdn.loja.com/a.png', link: 'http://inseguro.com' },
        ],
      },
      'popup',
    )
    if ('error' in ok) throw new Error(ok.error)
    const d = ok.design
    expect(d.box).toMatchObject({ width: 760, radius: 0, bg: '#ffffff', font: 'sistema', position: 'centro', overlayOpacity: 90 })
    expect(d.mobile).toEqual({ position: 'tela_cheia', fontScale: 120, hideImages: false })
    expect(d.blocks[0]).toMatchObject({ type: 'titulo', text: 'Oi <b>x</b>', size: 48, color: '#abcdef', align: 'centro' })
    expect(d.blocks[1]).toMatchObject({ type: 'cupom', code: 'USA10', afterSubmit: true })
    expect(d.blocks[3]).toMatchObject({ type: 'formulario', columns: 2, buttonText: 'Quero' })
    expect(d.blocks[4]).toMatchObject({ type: 'imagem', link: null })
    // "Não, obrigado" só existe no pop-up.
    const asForm = cleanDesign({ blocks: [{ type: 'recusar' }, form] }, 'form')
    expect('design' in asForm && asForm.design.blocks.map((b) => b.type)).toEqual(['formulario'])
  })

  it('imagem enviada pelo próprio CRM vale mesmo sem https (ambiente local)', async () => {
    const { cleanDesign } = await import('../src/captura/design')
    const r = cleanDesign({ blocks: [{ type: 'imagem', url: 'http://localhost:5173/api/files/public/x' }, form] }, 'popup', 'http://localhost:5173')
    expect('design' in r).toBe(true)
    expect(cleanDesign({ blocks: [{ type: 'imagem', url: 'http://outro.com/x.png' }, form] }, 'popup', 'http://localhost:5173')).toMatchObject({ error: expect.any(String) })
  })

  it('scripts do site e da prévia são JavaScript válido', async () => {
    const { PREVIEW_JS } = await import('../src/captura/widget')
    const { buildScript } = await import('../src/rastreamento/script')
    expect(() => new Function(PREVIEW_JS)).not.toThrow()
    expect(() => new Function(buildScript({ key: 'k'.repeat(24), endpoint: 'https://crm/x', requireConsent: false, cookieDomains: ['usaparts.com.br'] }))).not.toThrow()
  })
})

describe('link do WhatsApp', () => {
  it('celular de DDD 31 em diante vai sem o nono dígito; DDD 11 a 28 mantém', async () => {
    const { waDigits, waLink } = await import('../src/captura/regras')
    expect(waDigits('+5549988861936')).toBe('554988861936')
    expect(waDigits('+5547996470159')).toBe('554796470159')
    expect(waDigits('+5511987654321')).toBe('5511987654321')
    expect(waDigits('+5521998887766')).toBe('5521998887766')
    expect(waDigits('+554933221100')).toBe('554933221100')
    expect(waDigits('+351912345678')).toBe('351912345678')
    expect(waLink('+5549988861936', 'Olá')).toBe('https://wa.me/554988861936?text=Ol%C3%A1')
  })
})
