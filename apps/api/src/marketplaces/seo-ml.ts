/**
 * SEO Marketplace (Mercado Livre): nota de cada anúncio, limpeza dos textos e a IA que sugere a descrição (e o título,
 * quando o Mercado Livre deixa mudar). Funções puras (testadas em test/seo-marketplace.spec.ts).
 *
 * Regras do Mercado Livre seguidas aqui:
 *  - Descrição: só texto simples (PUT /items/{id}/description com {"plain_text": ...}); sem HTML, sem telefone,
 *    e-mail ou link de fora (o Mercado Livre recusa ou modera o anúncio).
 *  - Título: até 60 caracteres e só pode mudar enquanto o anúncio não tem vendas (e não é de catálogo).
 *  - Preço, estoque e o resto do anúncio o CRM nunca altera.
 */

export interface MlSeoFields {
  /** Título do anúncio (até 60 caracteres). */
  title: string
  /** Descrição em texto simples. */
  description: string
}

export type MlSeoField = keyof MlSeoFields
export const ML_TITLE_MAX = 60
export const ML_DESCRIPTION_MAX = 10_000
export const ML_SEO_FIELDS: { key: MlSeoField; label: string; max: number; hint: string }[] = [
  { key: 'description', label: 'Descrição', max: ML_DESCRIPTION_MAX, hint: 'Texto simples (o Mercado Livre não aceita HTML). Sem telefone, e-mail ou link: o Mercado Livre recusa.' },
  { key: 'title', label: 'Título', max: ML_TITLE_MAX, hint: 'Até 60 caracteres: peça + marca/máquina + código. Só dá para mudar enquanto o anúncio não tem vendas.' },
]

export interface MlAttribute {
  id?: string | null
  name?: string | null
  value?: string | null
}

export interface MlItemFacts {
  id: string
  title: string
  description: string
  brand: string | null
  partNumber: string | null
  sellerSku: string | null
  attributes: MlAttribute[]
}

export interface MlSeoIssue {
  field: MlSeoField | 'attributes' | 'geral'
  points: number
  text: string
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Texto simples para a descrição do Mercado Livre: tira HTML, junta espaços e linhas vazias e corta no máximo. */
export function cleanMlDescription(input: string, max = ML_DESCRIPTION_MAX): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e] ?? '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
}

/** Título em uma linha, sem espaços repetidos, até 60 caracteres. */
export const cleanMlTitle = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, ML_TITLE_MAX)

/** Limpa o que vem da tela ou da IA: só os campos conhecidos. */
export function cleanMlSeoFields(raw: Partial<Record<string, unknown>>): Partial<MlSeoFields> {
  const out: Partial<MlSeoFields> = {}
  if (typeof raw.title === 'string') out.title = cleanMlTitle(raw.title)
  if (typeof raw.description === 'string') out.description = cleanMlDescription(raw.description)
  return out
}

/**
 * O que o Mercado Livre não aceita no texto: e-mail, link de fora e telefone/WhatsApp. Códigos de peça (com números e
 * hífens) não contam como telefone: só número com DDD entre parênteses, +55 ou as palavras de contato.
 */
export function forbiddenContent(text: string): string[] {
  const out: string[] = []
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) out.push('e-mail')
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|br)(\.br)?\b/i.test(text.replace(/mercado ?livre/gi, ''))) out.push('link')
  if (/\(\s*\d{2}\s*\)\s*9?\s?\d{4}[-\s.]?\d{4}|\+\s?55\b|\b(whats\s?app|whats|zap|telefone|fone|celular|ligue)\b/i.test(text)) out.push('telefone ou WhatsApp')
  return out
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
const alnum = (s: string) => norm(s).replace(/[^a-z0-9]/g, '')
const isShouting = (s: string) => s.length > 12 && s === s.toUpperCase() && /[A-Z]/.test(s)
const attr = (list: MlAttribute[], id: string) => list.find((a) => a.id === id && (a.value ?? '').trim())?.value?.trim() ?? null

/**
 * Nota de 0 a 100 e os motivos. Pesa a descrição (o que o comprador lê e a busca do Mercado Livre usa), o título
 * (até 60, com marca, peça e código) e os atributos principais.
 */
export function mlSeoScore(item: Pick<MlItemFacts, 'title' | 'description' | 'brand' | 'partNumber' | 'attributes'>): { score: number; issues: MlSeoIssue[] } {
  const issues: MlSeoIssue[] = []
  const add = (field: MlSeoIssue['field'], points: number, text: string) => issues.push({ field, points, text })
  const title = (item.title ?? '').trim()
  const desc = cleanMlDescription(item.description ?? '')
  const attrs = item.attributes ?? []
  const brand = item.brand?.trim() || attr(attrs, 'BRAND')
  const part = item.partNumber?.trim() || attr(attrs, 'PART_NUMBER') || attr(attrs, 'MPN')

  if (!title) add('title', 25, 'Sem título.')
  else {
    if (title.length > ML_TITLE_MAX) add('title', 10, `Título com ${title.length} caracteres (o Mercado Livre aceita até 60).`)
    else if (title.length < 25) add('title', 8, `Título curto (${title.length} caracteres; use até 60 com peça, marca e código).`)
    if (isShouting(title)) add('title', 3, 'Título todo em maiúsculas.')
    if (brand && !alnum(title).includes(alnum(brand))) add('title', 4, `A marca (${brand}) não aparece no título.`)
    if (part && alnum(part).length >= 3 && !alnum(title).includes(alnum(part))) add('title', 5, `O código (${part}) não aparece no título.`)
    if (forbiddenContent(title).length) add('title', 10, `Título com ${forbiddenContent(title).join(', ')} (o Mercado Livre não aceita).`)
  }

  if (!desc) add('description', 30, 'Sem descrição.')
  else {
    if (desc.length < 300) add('description', 18, `Descrição curta (${desc.length} caracteres; o ideal é passar de 600).`)
    else if (desc.length < 600) add('description', 8, `Descrição pode ser mais completa (${desc.length} caracteres).`)
    if (desc.split('\n').filter((l) => l.trim()).length < 4) add('description', 5, 'Descrição sem seções nem parágrafos (tudo num bloco só).')
    const d = norm(desc)
    if (!/aplica|compativ|serve (em|para|no|na)/.test(d)) add('description', 5, 'Descrição sem a seção de aplicação (em quais máquinas a peça vai).')
    if (!/especifica|caracteristica|medida|material|dimens/.test(d)) add('description', 4, 'Descrição sem especificações ou características.')
    if (part && alnum(part).length >= 3 && !alnum(desc).includes(alnum(part))) add('description', 5, `O código (${part}) não aparece na descrição.`)
    const bad = forbiddenContent(desc)
    if (bad.length) add('description', 15, `Descrição com ${bad.join(', ')} (o Mercado Livre não aceita).`)
  }

  if (!brand) add('attributes', 4, 'Atributo Marca vazio (complete no Mercado Livre).')
  if (!part) add('attributes', 4, 'Atributo Número de peça vazio (complete no Mercado Livre).')
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + i.points, 0))
  return { score, issues }
}

// ---------- IA ----------

export function mlSeoSystem(company: string, about: string) {
  return [
    `Você é especialista em anúncios do Mercado Livre e redator da loja da ${company} no Mercado Livre.`,
    about ? `Sobre a empresa: ${about}` : '',
    'Regras obrigatórias:',
    '- Use só os dados informados do anúncio. Nunca invente compatibilidade, aplicação, medida, material, preço, prazo, estoque ou garantia. Se um dado importante faltar, escreva que o cliente deve consultar pelo campo de perguntas (ex.: "Consulte a aplicação para o seu modelo e número de série").',
    '- Português do Brasil, claro e direto, para quem compra peças de máquinas pesadas (linha amarela). Sem exagero ("o melhor do mercado") e sem emojis.',
    '- Nunca escreva telefone, WhatsApp, e-mail, site, link, redes sociais nem peça contato fora do Mercado Livre: o Mercado Livre proíbe.',
    '- Não fale de preço, frete, prazo, estoque ou garantia.',
    '- Mantenha códigos (originais, OEM, part number, SKU) exatamente como vieram.',
    '- Responda só com JSON válido, sem markdown.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function mlSeoPrompt(p: MlItemFacts, opts: { titleAllowed: boolean; instruction?: string }) {
  const attrs = (p.attributes ?? []).filter((a) => (a.name ?? '').trim() && (a.value ?? '').trim()).slice(0, 40)
  const facts = [
    `Anúncio: ${p.id}`,
    `Título atual: ${p.title || '(vazio)'}`,
    p.brand ? `Marca: ${p.brand}` : '',
    p.partNumber ? `Número de peça (part number): ${p.partNumber}` : '',
    p.sellerSku ? `SKU da loja: ${p.sellerSku}` : '',
    attrs.length ? `Atributos cadastrados no Mercado Livre:\n${attrs.map((a) => `- ${a.name}: ${a.value}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const current = cleanMlDescription(p.description ?? '').slice(0, 3000) || '(vazia)'
  const title = opts.titleAllowed
    ? `- title: até 60 caracteres (nunca mais); nome da peça + marca/máquina (se informada) + código; primeira letra maiúscula, não tudo em maiúsculas.`
    : '- title: deixe vazio (o anúncio já tem vendas e o Mercado Livre não deixa mudar o título).'
  return `${facts}

Descrição atual:
${current}

${opts.instruction ? `Pedido de quem está revisando: ${opts.instruction}\n\n` : ''}Reescreva a descrição desse anúncio para vender melhor e aparecer na busca do Mercado Livre. Aproveite o que já existe de bom na descrição atual (principalmente aplicação, medidas e códigos), sem perder informação.
- description: texto simples (sem HTML, sem markdown, sem asteriscos), 600 a 2500 caracteres, com títulos de seção em maiúsculas em linhas próprias e itens começando com "- ". Seções: PRODUTO (o que é e para que serve), ESPECIFICAÇÕES (só as informadas), APLICAÇÃO (só a informada; se não houver, peça para consultar o modelo e o número de série pelo campo de perguntas), CÓDIGOS (part number e referências exatamente como vieram) e DÚVIDAS (use o campo de perguntas do anúncio).
${title}
Formato: {"description":"","title":""}`
}

export function parseMlSeoAnswer(text: string): Partial<MlSeoFields> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const j = JSON.parse(t.slice(a, b + 1)) as Record<string, unknown>
    const out = cleanMlSeoFields(j)
    if (out.title === '') delete out.title
    if (out.description === '') delete out.description
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/** Campos que mudaram de verdade (o que vai para o Mercado Livre). */
export function mlChangedFields(before: Partial<MlSeoFields>, after: Partial<MlSeoFields>): MlSeoField[] {
  return ML_SEO_FIELDS.map((f) => f.key).filter((k) => after[k] !== undefined && (after[k] ?? '').trim() !== (before[k] ?? '').trim())
}

/** O título só pode mudar enquanto o anúncio não tem vendas e não é de catálogo. */
export const mlTitleAllowed = (it: { sold_quantity?: number | null; catalog_listing?: boolean | null }) => (it.sold_quantity ?? 0) === 0 && !it.catalog_listing

/** ID de anúncio do Mercado Livre (ex.: MLB1234567890). */
export const isMlItemId = (s: string) => /^ML[A-Z]\d{5,15}$/.test(s)
