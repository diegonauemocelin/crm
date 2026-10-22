/**
 * SEO do e-commerce (Magazord): nota de cada produto, limpeza do HTML da descrição e a IA que sugere os textos.
 * Funções puras (testadas em test/seo-ecommerce.spec.ts).
 *
 * Campos que o CRM lê e altera na Magazord:
 *  - Aba SEO do produto (Páginas, /v2/site/paginas/{id}): title (Título página de produto), titleSeo (Título SEO),
 *    metaDescription (Meta-Description, até 160) e url (Url da página). As palavras-chave da página só são lidas:
 *    o PATCH da página não aceita metaKeywords.
 *  - Aba Descrição Geral (produto x loja, PATCH /v2/site/produto/{código}): titulo, descricao (texto com formatação) e
 *    descricaoResumida. E palavraChave (palavras de busca da loja).
 *  - O Subtítulo (tituloComplemento) fica como está na loja: o CRM não lê, não sugere e não envia.
 */

export interface SeoFields {
  /** Aba SEO › Título página de produto. */
  pageTitle: string
  /** Aba SEO › Título SEO (o que aparece no Google). */
  seoTitle: string
  /** Aba SEO › Meta-Description (até 160 caracteres). */
  metaDescription: string
  /** Aba SEO › Url da página (só o final, sem domínio). */
  url: string
  /** Descrição Geral › Título. */
  title: string
  /** Descrição Geral › descrição (HTML). */
  description: string
  /** Descrição resumida (vitrines). */
  summary: string
  /** Palavras de busca da loja (o atual não é informado pela Magazord). */
  searchKeywords: string
}

export type SeoField = keyof SeoFields
export const SEO_FIELDS: { key: SeoField; label: string; group: 'seo' | 'descricao'; max: number; hint: string }[] = [
  { key: 'seoTitle', label: 'Título SEO', group: 'seo', max: 70, hint: 'O que aparece no Google. Ideal: 50 a 60 caracteres, com o produto, a máquina e a marca.' },
  { key: 'metaDescription', label: 'Meta-Description', group: 'seo', max: 160, hint: 'Texto abaixo do título no Google. Até 160 caracteres, com um convite para clicar.' },
  { key: 'pageTitle', label: 'Título página de produto', group: 'seo', max: 150, hint: 'Título da página do produto na loja.' },
  { key: 'url', label: 'Url da página', group: 'seo', max: 250, hint: 'Mudar a URL de um produto que já tem visitas pode perder posição no Google. Só altere se a atual estiver ruim.' },
  { key: 'title', label: 'Título (Descrição Geral)', group: 'descricao', max: 150, hint: 'Título exibido na página do produto.' },
  { key: 'description', label: 'Descrição', group: 'descricao', max: 8000, hint: 'Texto completo da página do produto, com parágrafos e listas.' },
  { key: 'summary', label: 'Descrição resumida', group: 'descricao', max: 400, hint: 'Resumo usado nas vitrines e listagens.' },
  { key: 'searchKeywords', label: 'Palavras de busca da loja', group: 'descricao', max: 1500, hint: 'A Magazord não informa as atuais: enviar substitui as que existem.' },
]
const MAX = Object.fromEntries(SEO_FIELDS.map((f) => [f.key, f.max])) as Record<SeoField, number>

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4'])
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'template', 'head', 'title'])

/** HTML da descrição só com parágrafos, listas, negrito, itálico e títulos; sem atributos, scripts nem estilos. */
export function cleanHtml(input: string, max = 8000): string {
  const out: string[] = []
  let skip: string | null = null
  const esc = (t: string) => t.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  for (const m of input.slice(0, max * 2).matchAll(/<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>|([^<]+)|(<)/g)) {
    const [, slash, raw, text, lt] = m
    if (skip) {
      if (slash && raw?.toLowerCase() === skip) skip = null
      continue
    }
    if (text !== undefined) out.push(esc(text))
    else if (lt) out.push('&lt;')
    else if (raw) {
      const tag = raw.toLowerCase()
      if (!slash && DROP.has(tag)) skip = tag
      else if (ALLOWED.has(tag)) out.push(tag === 'br' ? '<br>' : `<${slash}${tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag}>`)
    }
  }
  return out.join('').replace(/(<p>\s*<\/p>)+/g, '').trim().slice(0, max)
}

/** Texto puro (sem HTML), para contar caracteres e para a IA. */
export const plainText = (html: string) =>
  html
    .replace(/<(br|\/p|\/li|\/h[2-4])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim()

/** URL amigável: minúsculas, sem acento, palavras com hífen. */
export const cleanSlug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 250)

/** Limpa o que vem da tela ou da IA: só os campos conhecidos, cada um no tamanho máximo. */
export function cleanSeoFields(raw: Partial<Record<SeoField, unknown>>): Partial<SeoFields> {
  const out: Partial<SeoFields> = {}
  for (const f of SEO_FIELDS) {
    const v = raw[f.key]
    if (typeof v !== 'string') continue
    out[f.key] =
      f.key === 'description'
        ? cleanHtml(v, MAX.description)
        : f.key === 'url'
          ? cleanSlug(v)
          : v.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, f.max)
  }
  return out
}

export interface SeoIssue {
  field: SeoField | 'geral'
  points: number
  text: string
}

const isShouting = (s: string) => s.length > 12 && s === s.toUpperCase() && /[A-Z]/.test(s)

/**
 * Nota de 0 a 100 e os motivos. Pesa o que mais conta para aparecer e ser clicado no Google (título SEO e
 * meta-description) e o que ajuda quem já está na página (descrição completa e resumo).
 */
export function seoScore(f: Partial<SeoFields>, duplicateTitle = false): { score: number; issues: SeoIssue[] } {
  const issues: SeoIssue[] = []
  const add = (field: SeoIssue['field'], points: number, text: string) => issues.push({ field, points, text })
  const seoTitle = (f.seoTitle ?? '').trim()
  const meta = (f.metaDescription ?? '').trim()
  const desc = plainText(f.description ?? '')
  if (!seoTitle) add('seoTitle', 25, 'Sem título SEO.')
  else {
    if (seoTitle.length < 30) add('seoTitle', 10, `Título SEO curto (${seoTitle.length} caracteres; o ideal é de 50 a 60).`)
    if (seoTitle.length > 65) add('seoTitle', 5, `Título SEO longo (${seoTitle.length} caracteres): o Google corta depois de uns 60.`)
    if (isShouting(seoTitle)) add('seoTitle', 5, 'Título SEO todo em maiúsculas (fica pior de ler no Google).')
  }
  if (duplicateTitle) add('seoTitle', 10, 'Título SEO igual ao de outro produto.')
  if (!meta) add('metaDescription', 20, 'Sem meta-description (o Google escolhe um trecho qualquer da página).')
  else if (meta.length < 70) add('metaDescription', 8, `Meta-description curta (${meta.length} de até 160 caracteres).`)
  else if (meta.length > 160) add('metaDescription', 4, `Meta-description longa (${meta.length}; o limite é 160).`)
  if (!desc) add('description', 25, 'Sem descrição do produto.')
  else if (desc.length < 300) add('description', 15, `Descrição curta (${desc.length} caracteres; o ideal é passar de 600).`)
  else if (desc.length < 600) add('description', 5, `Descrição pode ser mais completa (${desc.length} caracteres).`)
  if (!(f.summary ?? '').trim()) add('summary', 5, 'Sem descrição resumida.')
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + i.points, 0))
  return { score, issues }
}

// ---------- IA ----------

export interface ProductFacts {
  name: string
  code: string
  brand: string | null
  categories: string[]
  attributes: { name: string; value: string }[]
  ean: string | null
}

export function seoSystem(company: string, about: string) {
  return [
    `Você é especialista em SEO de e-commerce e redator da loja virtual da ${company}.`,
    about ? `Sobre a empresa: ${about}` : '',
    'Regras obrigatórias:',
    '- Use só os dados informados do produto. Nunca invente compatibilidade, aplicação, medida, material, preço, prazo, estoque ou garantia. Se um dado importante faltar, escreva [conferir: ...] no lugar.',
    '- Português do Brasil, claro e direto, para quem compra peças de máquinas pesadas. Sem exagero ("o melhor do mercado") e sem emojis.',
    '- Mantenha códigos (originais, OEM, SKU) exatamente como vieram.',
    '- Responda só com JSON válido, sem markdown.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function seoPrompt(p: ProductFacts, current: Partial<SeoFields>, instruction = '') {
  const facts = [
    `Produto: ${p.name}`,
    `Código (SKU): ${p.code}`,
    p.brand ? `Marca do produto: ${p.brand}` : '',
    p.categories.length ? `Categorias: ${p.categories.join(' › ')}` : '',
    p.attributes.length ? `Características cadastradas:\n${p.attributes.map((a) => `- ${a.name}: ${a.value}`).join('\n')}` : '',
    p.ean ? `EAN: ${p.ean}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const now = [
    `Título SEO atual: ${current.seoTitle || '(vazio)'}`,
    `Meta-description atual: ${current.metaDescription || '(vazia)'}`,
    `Título atual: ${current.title || '(vazio)'}`,
    `Descrição atual: ${plainText(current.description ?? '').slice(0, 2500) || '(vazia)'}`,
  ].join('\n')
  return `${facts}

Textos atuais:
${now}

${instruction ? `Pedido de quem está revisando: ${instruction}\n\n` : ''}Escreva os textos de SEO desse produto. Aproveite o que já existe de bom na descrição atual (principalmente aplicação e códigos), sem perder informação.
- seoTitle: 50 a 60 caracteres; produto + máquina/modelo (se informado) + marca; primeira letra maiúscula, não tudo em maiúsculas.
- metaDescription: 130 a 155 caracteres, com o benefício e um convite (ex.: "Peça seu orçamento").
- pageTitle: título da página do produto, até 120 caracteres.
- title: título da Descrição Geral (pode ser igual ao pageTitle).
- summary: até 300 caracteres.
- description: HTML simples só com <p>, <h3>, <ul>, <li> e <strong>; 600 a 1500 caracteres; seções: o que é, características (das informadas), aplicação (só se informada) e por que comprar na loja (importação direta, estoque, suporte técnico, envio para todo o Brasil).
- searchKeywords: termos que o cliente digita (nome da peça, sinônimos, modelo, código), separados por vírgula.
- url: só o final da URL, em minúsculas com hífens.
Formato: {"seoTitle":"","metaDescription":"","pageTitle":"","title":"","summary":"","description":"","searchKeywords":"","url":""}`
}

export function parseSeoAnswer(text: string): Partial<SeoFields> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const j = JSON.parse(t.slice(a, b + 1)) as Record<string, unknown>
    const out = cleanSeoFields(j)
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/** Campos que mudaram de verdade (o que vai para a Magazord). */
export function changedFields(before: Partial<SeoFields>, after: Partial<SeoFields>): SeoField[] {
  return SEO_FIELDS.map((f) => f.key).filter((k) => after[k] !== undefined && (after[k] ?? '').trim() !== (before[k] ?? '').trim())
}
