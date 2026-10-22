import { describe, expect, it } from 'vitest'
import { BLOCKS, cleanBlocks, cleanSeo, cleanSlug, cleanTheme, cleanUrl, DEFAULT_THEME, type Block } from '../src/landing/blocos'
import { blockCatalog, outlinePrompt, parseJson, parseOutlines } from '../src/landing/ia'
import { TEMPLATES } from '../src/landing/modelos'
import { onColor, renderLanding, type RenderInput } from '../src/landing/render'
import { LP_RUNTIME } from '../src/landing/runtime'

const FORM = '11111111-1111-1111-1111-111111111111'
const input = (blocks: Block[], extra: Partial<RenderInput> = {}): RenderInput => ({
  page: { id: '22222222-2222-2222-2222-222222222222', name: 'Filtros', slug: 'filtros', theme: cleanTheme({ ...DEFAULT_THEME, whatsapp: '5549988632548' }), blocks, seo: cleanSeo({ title: 'Filtros Komatsu', description: 'Orçamento' }) },
  variant: 'A',
  brand: { name: 'Usaparts', logoUrl: null, companyInfo: 'Maravilha/SC', privacyUrl: 'https://usaparts.com.br/privacidade' },
  forms: { [FORM]: { fields: [{ key: 'name', label: 'Nome', required: true }, { key: 'phone', label: 'WhatsApp', required: true }, { key: 'state', label: 'Estado', required: false }], submitLabel: 'Enviar', successMessage: 'Recebido!', consentText: 'Aceito receber ofertas.' } },
  whatsapps: {},
  tracking: { ga4: 'G-ABC123', pixel: null, ads: null, crmScript: null, cookieText: 'Cookies' },
  url: 'https://lp.usaparts.com.br/filtros',
  ...extra,
})
const blocks = (raw: unknown[]) => {
  const c = cleanBlocks(raw)
  if ('error' in c) throw new Error(c.error)
  return c.blocks
}

describe('landing pages: blocos e limpeza', () => {
  it('só tipos e campos conhecidos; textos cortados; ids gerados', () => {
    const [b] = blocks([{ type: 'hero', title: 'x'.repeat(500), inventado: 'não entra', action: 'qualquer', variant: 'nao-existe' }])
    expect(b!.title).toHaveLength(140)
    expect(b).not.toHaveProperty('inventado')
    expect(b!.action).toBe('formulario')
    expect(b!.variant).toBe('imagem-direita')
    expect(b!.id).toMatch(/^b1-/)
    expect(cleanBlocks([{ type: 'script' }])).toEqual({ error: 'Tipo de bloco desconhecido: script' })
    expect(cleanBlocks(Array.from({ length: 31 }, () => ({ type: 'texto' })))).toEqual({ error: 'No máximo 30 blocos por página.' })
  })

  it('endereços perigosos são descartados; imagens só https ou do próprio CRM', () => {
    expect(cleanUrl('javascript:alert(1)')).toBe('')
    expect(cleanUrl('data:text/html,x', 'image')).toBe('')
    expect(cleanUrl('#formulario')).toBe('#formulario')
    expect(cleanUrl('/api/files/public/33333333-3333-3333-3333-333333333333', 'image')).toBe('/api/files/public/33333333-3333-3333-3333-333333333333')
    const [p] = blocks([{ type: 'produtos', items: [{ name: 'Filtro', url: 'javascript:x', image: 'https://cdn.exemplo.com/f.jpg' }] }])
    expect((p!.items as Record<string, unknown>[])[0]).toMatchObject({ url: '', image: 'https://cdn.exemplo.com/f.jpg' })
  })

  it('endereço da página e tema', () => {
    expect(cleanSlug('Filtros Komatsu PC-200 / Promoção!')).toBe('filtros-komatsu-pc-200-promocao')
    expect(cleanTheme({ primary: 'red', accent: '#16a34a', font: 'Comic Sans', whatsapp: '+55 (49) 98863-2548' })).toMatchObject({ primary: DEFAULT_THEME.primary, accent: '#16a34a', font: DEFAULT_THEME.font, whatsapp: '5549988632548' })
    expect(onColor('#ffffff')).toBe('#0f172a')
    expect(onColor('#1f2937')).toBe('#ffffff')
  })

  it('todos os modelos prontos passam pela limpeza, têm topo e formulário ou WhatsApp e não trazem preço', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8)
    for (const t of TEMPLATES) {
      const bs = blocks(t.blocks)
      expect(bs[0]!.type, t.key).toBe('hero')
      expect(bs.some((b) => b.type === 'formulario' || b.type === 'whatsapp' || b.action === 'whatsapp'), t.key).toBe(true)
      expect(JSON.stringify(bs), t.key).not.toMatch(/R\$\s?\d/)
    }
  })
})

describe('landing pages: HTML', () => {
  it('escapa o texto, monta o formulário com consentimento e leva o botão até ele', () => {
    const html = renderLanding(input(blocks([{ type: 'hero', title: '<script>alert(1)</script>', ctaText: 'Pedir', action: 'formulario' }, { type: 'formulario', formId: FORM, title: 'Orçamento' }])))
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('id="formulario"')
    expect(html).toContain('href="#formulario"')
    expect(html).toContain('data-lp-form data-kind="form"')
    expect(html).toContain('name="_consent"')
    expect(html).toContain('<option>SC</option>')
    expect(html).toContain('src="/api/public/lp/runtime.js"')
    expect(html).toContain('"ga4":"G-ABC123"')
  })

  it('botão de WhatsApp com a mensagem da página; prévia sem scripts e com aviso de imagem', () => {
    const bs = blocks([{ type: 'hero', title: 'Oi', ctaText: 'WhatsApp', action: 'whatsapp' }])
    const html = renderLanding(input(bs))
    expect(html).toContain('https://wa.me/5549988632548?text=')
    expect(html).toContain('data-lp-wa')
    const preview = renderLanding(input(bs, { preview: true }))
    expect(preview).not.toContain('runtime.js')
    expect(preview).toContain('Adicione uma imagem')
    expect(preview).toContain('noindex')
  })

  it('oferta: contagem só antes do fim; vídeo do YouTube sem cookies', () => {
    const now = Date.parse('2026-10-22T12:00:00Z')
    const live = renderLanding({ ...input(blocks([{ type: 'oferta', title: 'Oferta', endsAt: '2026-10-30T18:00' }, { type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }])), now })
    expect(live).toContain('data-lp-ate="')
    expect(live).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    const over = renderLanding({ ...input(blocks([{ type: 'oferta', title: 'Oferta', endsAt: '2026-10-01T18:00' }])), now })
    expect(over).not.toContain('data-lp-ate')
  })

  it('o script da página não usa eval e pede aceite antes de carregar GA4 e Pixel', () => {
    expect(LP_RUNTIME).not.toMatch(/\beval\(|new Function/)
    expect(LP_RUNTIME).toContain("setCookie('_lp_ok', '1'")
    expect(LP_RUNTIME).toContain('generate_lead')
  })
})

describe('landing pages: IA', () => {
  it('catálogo dos blocos para a IA e pedido de estruturas', () => {
    const cat = blockCatalog()
    for (const b of BLOCKS) expect(cat).toContain(`"${b.type}"`)
    expect(outlinePrompt({ goal: 'Captar orçamentos de filtros Komatsu', language: 'es' })).toContain('espanhol')
  })

  it('lê o JSON da resposta (com ou sem ```json) e só aceita estruturas com topo e contato', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJson('não sei')).toBeNull()
    const out = parseOutlines(JSON.stringify({ opcoes: [{ titulo: 'Direta', angulo: 'Curta', blocos: ['hero', 'formulario', 'inexistente'] }, { titulo: 'Sem contato', angulo: 'x', blocos: ['hero', 'faq'] }] }))
    expect(out).toEqual([{ title: 'Direta', angle: 'Curta', blocks: ['hero', 'formulario'] }])
  })
})
