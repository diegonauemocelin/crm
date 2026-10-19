import { describe, expect, it } from 'vitest'
import { type Block, cleanBlocks, collectLinks, htmlToText, personalize, renderEmail, safeUrl, sanitizeRich, whatsappUrl } from '../src/email/blocos'

const brand = { appName: 'Usaparts', color: '#1d4ed8', logoUrl: 'https://crm.usaparts.com.br/api/files/public/logo', footerText: 'Usaparts Importadora\nMaravilha/SC' }
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

describe('redes sociais no e-mail', () => {
  it('só aceita o endereço da própria rede; bloco com ícones que abrem em nova aba e entram no rastreio', async () => {
    const { socialUrl, cleanSocial } = await import('../src/email/blocos')
    expect(socialUrl('instagram', 'instagram.com/usaparts')).toBe('https://instagram.com/usaparts')
    expect(socialUrl('facebook', 'http://www.facebook.com/usaparts')).toBe('https://www.facebook.com/usaparts')
    expect(socialUrl('youtube', 'https://youtu.be/abc')).toBe('https://youtu.be/abc')
    expect(socialUrl('tiktok', 'https://www.tiktok.com/@usaparts')).toBe('https://www.tiktok.com/@usaparts')
    expect(socialUrl('facebook', 'https://facebook.com.golpe.com/x')).toBeNull()
    expect(socialUrl('instagram', 'javascript:alert(1)')).toBeNull()
    expect(cleanSocial({ facebook: 'https://facebook.com/usaparts', youtube: 'https://evil.com', x: 'y' })).toEqual({ facebook: 'https://facebook.com/usaparts' })
    expect('error' in cleanBlocks([{ type: 'redes', links: { tiktok: 'https://tiktok.golpe.com/a' } }])).toBe(true)

    const blocks = clean([{ type: 'redes', links: { facebook: 'https://facebook.com/usaparts', instagram: 'https://instagram.com/usaparts' }, style: 'cor' }])
    expect(collectLinks(blocks)).toEqual(['https://facebook.com/usaparts', 'https://instagram.com/usaparts'])
    const r = renderEmail(blocks, { ...base, brand: { ...brand, iconBase: 'https://crm/api/public/e/icones', social: { youtube: 'https://youtube.com/@usaparts' }, socialInFooter: true }, trackLink: (_u, i) => `https://crm/l/${i}` })
    expect(r.html).toContain('src="https://crm/api/public/e/icones/facebook-cor.png"')
    expect(r.html).toContain('href="https://crm/l/1" target="_blank"')
    // Com o bloco no e-mail, o rodapé não repete os ícones.
    expect(r.html).not.toContain('youtube-cinza.png')
    expect(r.text).toContain('Instagram: https://instagram.com/usaparts')
    // Sem o bloco: ícones cinza no rodapé.
    const f = renderEmail(clean([{ type: 'texto', html: 'Oi' }]), { ...base, brand: { ...brand, iconBase: 'https://crm/api/public/e/icones', social: { youtube: 'https://youtube.com/@usaparts' }, socialInFooter: true } })
    expect(f.html).toContain('youtube-cinza.png')
  })
})

describe('2 colunas, texto justificado e cores mais usadas', () => {
  it('colunas fluidas (lado a lado / empilhadas), links rastreados e justificado', async () => {
    const { topColors } = await import('../src/email/blocos')
    const blocks = clean([
      { type: 'texto', html: '<p>Texto</p>', align: 'justify' },
      {
        type: 'colunas',
        ratio: 40,
        align: 'justify',
        columns: [
          { html: '<p>Filtro <strong>JCB</strong></p>', image: 'https://cdn.usaparts.com.br/f.jpg', imageLink: 'https://www.usaparts.com.br/f', buttonText: 'Comprar', buttonUrl: 'https://www.usaparts.com.br/f' },
          { html: '<p>Veja a <a href="https://www.usaparts.com.br/ofertas">oferta</a></p><script>x</script>' },
        ],
      },
    ])
    expect(collectLinks(blocks)).toEqual(['https://www.usaparts.com.br/f', 'https://www.usaparts.com.br/ofertas'])
    const r = renderEmail(blocks, { ...base, trackLink: (_u, i) => `https://crm/l/${i}` })
    expect(r.html).toContain('text-align:justify')
    expect(r.html).toContain('max-width:221px') // 40% de 552
    expect(r.html).toContain('max-width:331px')
    expect(r.html).toContain('<!--[if mso]>')
    expect(r.html).toContain('href="https://crm/l/1"')
    expect(r.html).not.toContain('<script')
    expect(r.text).toContain('Comprar: https://www.usaparts.com.br/f')
    expect('error' in cleanBlocks([{ type: 'colunas', columns: [{ html: '', buttonText: 'Ir', buttonUrl: 'javascript:alert(1)' }, {}] }])).toBe(true)
    expect(topColors([[{ type: 'botao', color: '#1D4ED8' }, { type: 'texto', html: '<span style="color: #dc2626">a</span><span style="color:rgb(220, 38, 38)">b</span>', bg: '#ffffff' }], [{ type: 'titulo', color: '#1d4ed8' }]])).toEqual(['#1d4ed8', '#dc2626'])
  })

  it('IA: pedidos, limpeza da resposta (sem tags vindas do modelo) e chamada ao Gemini', async () => {
    const { userPrompt, systemPrompt, answerHtml, answerOptions, cleanAnswer } = await import('../src/email/ia')
    expect(userPrompt('escrever', '', '')).toBeNull()
    expect(userPrompt('escrever', '', 'promoção de filtros JCB')).toContain('promoção de filtros JCB')
    expect(userPrompt('melhorar', 'Olá {primeiro_nome}', '')).toContain('Olá {primeiro_nome}')
    expect(systemPrompt('Usaparts', 'peças para máquinas')).toContain('{primeiro_nome}')
    expect(cleanAnswer('"**Olá**, tudo bem?"')).toBe('Olá, tudo bem?')
    expect(answerHtml('Primeiro <b>parágrafo</b>.\n\nSegundo.')).toBe('<p>Primeiro &lt;b&gt;parágrafo&lt;/b&gt;.</p><p>Segundo.</p>')
    expect(answerOptions('1. Assunto um\n2. "Assunto dois"\n- Assunto três')).toEqual(['Assunto um', 'Assunto dois', 'Assunto três'])

    const { EmailAiService } = await import('../src/email/ia.service')
    const { encrypt } = await import('../src/common/crypto')
    const store = new Map<string, object>([['email_ia', { apiKeyEnc: encrypt('AIzaFakeKeyForTests1234567890'), model: 'gemini-2.5-flash', about: '' }]])
    const settings = { get: async (_t: string, k: string, d: object) => store.get(k) ?? d, set: async () => undefined, branding: async () => ({ appName: 'Usaparts' }) }
    const svc = new EmailAiService(settings as never, { byUser: async () => undefined } as never)
    const user = { tenantId: 't', role: { isSystem: true }, permissions: {} } as never
    const original = globalThis.fetch
    let sent: { url: string; headers: Record<string, string>; body: { contents: { parts: { text: string }[] }[]; generationConfig: Record<string, unknown> } } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      // Lista de modelos da chave: escolhe o Flash-Lite estável mais novo (a configuração antiga "gemini-2.5-flash" vira "rapido").
      if (!url.includes(':generateContent')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }))
      sent = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Olá {primeiro_nome}!\n\nConfira os filtros.' }] } }] }))
    }) as typeof fetch
    try {
      const r = await svc.generate(user, { action: 'melhorar', html: '<p>Oi {primeiro_nome}, veja os filtros</p>' })
      expect(r).toEqual({ html: '<p>Olá {primeiro_nome}!</p><p>Confira os filtros.</p>', text: 'Olá {primeiro_nome}!\n\nConfira os filtros.' })
      expect(sent!.url).toContain('/models/gemini-2.5-flash-lite:generateContent')
      expect(sent!.body.generationConfig).toMatchObject({ thinkingConfig: { thinkingBudget: 0 } })
      expect(sent!.headers['x-goog-api-key']).toBe('AIzaFakeKeyForTests1234567890')
      expect(sent!.body.contents[0]!.parts[0]!.text).toContain('Oi {primeiro_nome}, veja os filtros')
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 })) as typeof fetch
      await expect(svc.generate(user, { action: 'assunto', text: 'Filtros JCB' })).rejects.toThrow(/Limite do plano gratuito/)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('chave do Gemini', () => {
  it('aceita o formato novo (AQ.) e o antigo (AIza), recusa texto estranho', async () => {
    const { EmailAiService } = await import('../src/email/ia.service')
    let saved: { apiKeyEnc: string | null } | null = null
    const settings = { get: async (_t: string, _k: string, d: object) => d, set: async (_t: string, _k: string, v: { apiKeyEnc: string | null }) => void (saved = v), branding: async () => ({ appName: 'Usaparts' }) }
    const svc = new EmailAiService(settings as never, { byUser: async () => undefined } as never)
    const user = { tenantId: 't', role: { isSystem: true }, permissions: {} } as never
    await svc.save(user, { apiKey: 'AQ.FakeNewFormatKey_for-tests1234567890' }, {} as never)
    expect(saved!.apiKeyEnc).toBeTruthy()
    await svc.save(user, { apiKey: 'AIzaFakeKeyForTests1234567890' }, {} as never)
    await expect(svc.save(user, { apiKey: 'AQ.chave com espaço 1234567890' }, {} as never)).rejects.toThrow(/inválida/)
    await expect(svc.save(user, { apiKey: '.AQcomecaComPonto1234567890' }, {} as never)).rejects.toThrow(/inválida/)
  })
})

describe('modelo do Gemini', () => {
  it('escolhe o mais rápido estável e mais novo disponível para a chave', async () => {
    const { rankModels } = await import('../src/email/ia')
    const m = (name: string, gen = true) => ({ name: `models/${name}`, supportedGenerationMethods: gen ? ['generateContent'] : ['embedContent'] })
    const models = [m('gemini-2.5-flash'), m('gemini-2.5-flash-lite'), m('gemini-3.0-flash-lite'), m('gemini-3.1-flash-lite-preview'), m('gemini-2.5-pro'), m('gemini-flash-lite-latest'), m('gemini-2.5-flash-image'), m('text-embedding-004', false)]
    expect(rankModels(models, 'rapido')).toEqual(['gemini-3.0-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash'])
    expect(rankModels(models, 'caprichado')[0]).toBe('gemini-2.5-flash')
  })

  it('modelo aposentado (404): consulta a lista de novo e usa outro, sem erro para o usuário', async () => {
    const { EmailAiService } = await import('../src/email/ia.service')
    const { encrypt } = await import('../src/common/crypto')
    const store = new Map<string, object>([['email_ia', { apiKeyEnc: encrypt('AQ.FakeNewFormatKey_for-tests1234567890'), model: 'rapido', about: '' }]])
    const settings = { get: async (_t: string, k: string, d: object) => store.get(k) ?? d, set: async () => undefined, branding: async () => ({ appName: 'Usaparts' }) }
    const svc = new EmailAiService(settings as never, { byUser: async () => undefined } as never)
    const user = { tenantId: 't', role: { isSystem: true }, permissions: {} } as never
    const original = globalThis.fetch
    const asked: string[] = []
    let lists = 0
    globalThis.fetch = (async (url: string) => {
      if (!url.includes(':generateContent')) {
        lists++
        // Primeira lista ainda tem o modelo velho; a segunda (depois do 404) já não tem.
        const names = lists === 1 ? ['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'] : ['gemini-2.5-flash-lite']
        return new Response(JSON.stringify({ models: names.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }))
      }
      const model = /models\/([^:]+):/.exec(url)![1]!
      asked.push(model)
      if (model === 'gemini-2.5-flash-lite') return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Assunto 1\nAssunto 2' }] } }] }))
      return new Response(JSON.stringify({ error: { message: 'models/x is not found' } }), { status: 404 })
    }) as typeof fetch
    try {
      const r = await svc.generate(user, { action: 'assunto', text: 'Filtros JCB' })
      expect(r).toEqual({ options: ['Assunto 1', 'Assunto 2'] })
      expect(asked).toEqual(['gemini-2.5-flash-lite'])
      expect((await svc.test(user)).message).toMatch(/gemini-2\.5-flash-lite/)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('espaçamento dos blocos', () => {
  it('imagens encostadas nas bordas e sem espaço emendam sem faixa branca', () => {
    const blocks = clean([
      { type: 'imagem', url: 'https://cdn.exemplo.com/a.jpg', edge: true, space: 0 },
      { type: 'imagem', url: 'https://cdn.exemplo.com/b.jpg', edge: true, space: 0 },
      { type: 'imagem', url: 'https://cdn.exemplo.com/c.jpg' },
    ])
    expect(blocks[0]).toMatchObject({ edge: true, space: 0 })
    const html = renderEmail(blocks, base).html
    expect(html.match(/padding:0px 0px;font-size:0;line-height:0/g)).toHaveLength(2)
    expect(html).toContain('width="600"')
    // Sem as opções, fica como antes (margem de 32 px e canto arredondado).
    expect(html).toContain('padding:8px 32px;font-size:0;line-height:0')
    expect(html).toContain('border-radius:6px')
  })

  it('espaço por bloco (0 a 48) e entrelinha do texto (100% a 200%)', () => {
    const blocks = clean([
      { type: 'texto', html: 'Linha', space: 2, lineHeight: 110 },
      { type: 'botao', text: 'Comprar', url: 'https://usaparts.com.br', space: 99 },
      { type: 'divisor', space: -5 },
      { type: 'espaco', height: 24, space: 0 },
    ])
    expect(blocks.map((b) => b.space)).toEqual([2, 48, 0, undefined])
    const html = renderEmail(blocks, base).html
    expect(html).toContain('padding:2px 32px;font-size:15px;line-height:17px')
    expect(html).toContain('padding:48px 32px')
  })
})

describe('vídeo do YouTube e botões personalizados', () => {
  it('reconhece os links do YouTube e desenha a capa com o link para assistir', async () => {
    const { youtubeId } = await import('../src/email/blocos')
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://vimeo.com/123')).toBeNull()
    expect(cleanBlocks([{ type: 'video', url: 'https://vimeo.com/123' }])).toMatchObject({ error: expect.stringMatching(/YouTube/) })
    const blocks = clean([{ type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Como trocar o filtro' }])
    expect(blocks[0]).toMatchObject({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    const r = renderEmail(blocks, base)
    expect(r.html).toContain('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(r.html).toContain('Assistir ao vídeo')
    expect(r.text).toContain('Vídeo: https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(collectLinks(blocks)).toEqual(['https://www.youtube.com/watch?v=dQw4w9WgXcQ'])
  })

  it('botão com tamanho, fonte, canto, ícone e largura total; valores desconhecidos são ignorados', () => {
    const blocks = clean([
      { type: 'botao', text: 'Comprar', url: 'https://usaparts.com.br', size: 'G', font: 'georgia', radius: 99, icon: '🛒', full: true },
      { type: 'botao', text: 'Ver', url: 'https://usaparts.com.br', size: 'X', font: 'comic', icon: '<b>' },
      { type: 'whatsapp', text: 'Chamar', phone: '49999990000', color: '#111111', icon: '💬' },
    ])
    expect(blocks[0]).toMatchObject({ size: 'G', font: 'georgia', radius: 30, icon: '🛒', full: true })
    expect(blocks[1]).not.toHaveProperty('size')
    expect(blocks[1]).not.toHaveProperty('icon')
    const html = renderEmail(blocks, base).html
    expect(html).toContain('padding:17px 38px;border-radius:30px;display:block;text-align:center;font-weight:700;font-size:18px;font-family:Georgia,serif">🛒 Comprar')
    expect(html).toContain('background:#111111')
    expect(html).toContain('💬 Chamar')
  })
})

describe('colunas (2 a 4) com blocos dentro', () => {
  it('desenha as colunas lado a lado, com botão, imagem, vídeo e texto, e junta os links', () => {
    const blocks = clean([
      {
        type: 'linha',
        cols: [
          [{ type: 'imagem', url: 'https://cdn.exemplo.com/a.jpg' }, { type: 'texto', html: 'Filtro JCB' }, { type: 'botao', text: 'Comprar', url: 'https://usaparts.com.br/a' }],
          [{ type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' }],
          [{ type: 'botao', text: 'Ver mais', url: 'https://usaparts.com.br/b', size: 'P' }],
        ],
      },
    ])
    expect(blocks[0]).toMatchObject({ type: 'linha' })
    const r = renderEmail(blocks, base)
    // 3 colunas de 194 px ((600 - 16 de margem) ÷ 3) com margem interna de 6 px (largura útil 182).
    expect(r.html.match(/display:inline-block;width:100%;max-width:194px/g)).toHaveLength(3)
    expect(r.html).toContain('width="182"')
    expect(r.html).toContain('padding:16px 6px"><a href')
    expect(r.html).toContain('img.youtube.com/vi/dQw4w9WgXcQ')
    expect(r.text).toContain('Comprar: https://usaparts.com.br/a')
    expect(collectLinks(blocks)).toEqual(['https://cdn.exemplo.com/a.jpg', 'https://usaparts.com.br/a', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://usaparts.com.br/b'].filter((u) => u !== 'https://cdn.exemplo.com/a.jpg'))
  })

  it('exige de 2 a 4 colunas e só blocos simples dentro (nada de colunas dentro de colunas)', () => {
    expect(cleanBlocks([{ type: 'linha', cols: [[{ type: 'texto', html: 'a' }]] }])).toMatchObject({ error: expect.stringMatching(/2 a 4/) })
    expect(cleanBlocks([{ type: 'linha', cols: [[{ type: 'produtos', items: [] }], []] }])).toMatchObject({ error: expect.stringMatching(/Dentro das colunas/) })
    expect(cleanBlocks([{ type: 'linha', cols: [[{ type: 'linha', cols: [[], []] }], []] }])).toMatchObject({ error: expect.stringMatching(/Dentro das colunas/) })
    const five = clean([{ type: 'linha', cols: [[], [], [], [], []] }])
    expect((five[0] as { cols: unknown[] }).cols).toHaveLength(4)
  })
})

describe('Recusa temporária do servidor de e-mail (4xx)', () => {
  it('separa o temporário (tenta de novo) do definitivo (não entregue)', async () => {
    const { isTemporary, isTemporaryText } = await import('../src/email/limite')
    expect([452, 451, 421, 450].map(isTemporary)).toEqual([true, true, true, true])
    expect([550, 554, undefined, null].map(isTemporary)).toEqual([false, false, false, false])
    expect(isTemporaryText('452 452 4.7.1 <x@y.com>: Recipient address rejected: you are sending too many mails, slow down')).toBe(true)
    expect(isTemporaryText('451 451 4.3.0 Error: queue file write error')).toBe(true)
    expect(isTemporaryText('550 5.1.1 user unknown')).toBe(false)
    expect(isTemporaryText('Sem consentimento no momento do envio.')).toBe(false)
  })

  it('espera cada vez mais e envia mais devagar, respeitando o limite do SMTP', async () => {
    const { backoffMinutes, batchSize } = await import('../src/email/limite')
    expect([1, 2, 3, 4, 5, 9].map(backoffMinutes)).toEqual([1, 2, 5, 10, 15, 15])
    expect(batchSize(60, 0, 0)).toBe(15)
    expect(batchSize(60, 0, 1)).toBe(7)
    expect(batchSize(60, 0, 3)).toBe(1)
    // O limite do servidor (Configurações › E-mail) vale quando é menor que o da campanha.
    expect(batchSize(600, 20, 0)).toBe(5)
    expect(batchSize(0, 0, 0)).toBe(15)
  })
})
