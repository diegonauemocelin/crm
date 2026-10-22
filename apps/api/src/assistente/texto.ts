// Assistente de perguntas do Mercado Livre: funções de texto sem banco (vieram do painel, com a mesma lógica).

/** Remove acentos, caixa e espaços extras: usado em comparações e chaves. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normaliza códigos de peça: sem espaços, hífens, pontos e barras. */
export const normCode = (s: unknown) => norm(s).replace(/[\s\-./]/g, '').toUpperCase()

/** Texto aparado e limitado. */
export const str = (v: unknown, max = 5000) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max))

/** Hora local de Brasília (0 a 23). */
export function localHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(date))
}

/** Saudação conforme o horário do atendimento. */
export function greetingFor(date = new Date()) {
  const h = localHour(date)
  if (h >= 5 && h < 12) return 'Bom dia!'
  if (h >= 12 && h < 18) return 'Boa tarde!'
  return 'Boa noite!'
}

/** Início do dia (ou do mês) em Brasília, em UTC. */
export function startOfLocalDay(date = new Date()) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  return new Date(`${d}T00:00:00-03:00`)
}
export function startOfLocalMonth(date = new Date()) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(date)
  return new Date(`${d}-01T00:00:00-03:00`)
}

/** "AAAA-MM-DD" (data local) em Date; fim do dia quando end=true. */
export function localDate(d: string | undefined | null, end = false) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  return new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}-03:00`)
}

// ---------- Conhecimento ----------

const STOP = new Set(
  'a o e de da do das dos em no na nos nas um uma para por com sem que qual quais se sim nao voce voces tem ter ser esta este essa esse isso serve servem peca pecas produto maquina favor bom dia boa tarde noite ola obrigado ate mais meu minha'.split(' '),
)

export function tokenize(text: unknown) {
  return [...new Set(norm(text).replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))]
}

/** Códigos candidatos: sequências alfanuméricas com ao menos um dígito. */
export function extractCodes(text: unknown) {
  const found = String(text ?? '').toUpperCase().match(/\b[A-Z0-9]*\d[A-Z0-9]*(?:[-./][A-Z0-9]+)*\b/g) ?? []
  return [...new Set(found.filter((c) => c.replace(/[-./]/g, '').length >= 4).map(normCode))]
}

/** Semelhança entre duas perguntas (0 a 1), ignorando saudações, acentos e palavras comuns. */
export function questionSimilarity(a: unknown, b: unknown) {
  const A = new Set(tokenize(a))
  const B = new Set(tokenize(b))
  if (!A.size || !B.size) return norm(a) === norm(b) && norm(a) ? 1 : 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return (2 * inter) / (A.size + B.size)
}

/** Chave de duplicidade do conhecimento: mesmo código + mesma aplicação (ou modelo). */
export function matchKey(partCode: unknown, application: unknown, model: unknown) {
  const code = normCode(partCode)
  if (!code) return null
  return `${code}|${norm(application || model)}`
}

/** Chave da aplicação peça × máquina. */
export const appKey = (a: { partCode?: string | null; machineBrand?: string | null; machineModel?: string | null }) => `${normCode(a.partCode)}|${norm(a.machineBrand)}|${norm(a.machineModel)}`

// ---------- Busca nos anúncios da loja ----------

const SEARCH_STOP = new Set(
  ('a o e de da do das dos em no na nos nas um uma uns umas para pra pro por pela pelo com sem que qual quais se sim nao ' +
    'voce voces vcs tem ter tenho ser esta este essa esse isso serve servem servir boa bom dia tarde noite ola oi obrigado ' +
    'obrigada favor gostaria saber preciso quero queria meu minha meus minhas ai la aqui ja mas ou tambem como onde quanto ' +
    'quando peca pecas produto produtos maquina ainda vende vendem vocês disponivel algum alguma').split(' '),
)
// plural simples: "filtros" = "filtro"
const singular = (w: string) => (w.length > 4 && w.endsWith('s') && !/\d/.test(w) ? w.slice(0, -1) : w)
export const searchTokens = (t: unknown) => [...new Set(norm(t).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 2 && !SEARCH_STOP.has(w)).map(singular))]

const REF_ATTR = /^(SELLER_SKU|PART_NUMBER|MPN|REFERENCE|REFERENCE_CODE|MANUFACTURER_CODE|MODEL_CODE)$/
/** Comparação de códigos ignora qualquer caractere especial: 32/925682 = 32-925682 = 32925682. */
export const codeKey = (s: unknown) => normCode(s).replace(/[^A-Z0-9]/g, '')
const splitCodes = (v: unknown) => String(v ?? '').split(/[,;|\s]+/).map(codeKey).filter((c) => c.length >= 3)

export interface ItemAttr {
  id?: string
  name?: string
  value?: string | null
}

/** Códigos de referência e OEM de um anúncio (ficha técnica sincronizada do Mercado Livre). */
export function itemCodes(r: { sellerSku?: string | null; partNumber?: string | null; attributes?: unknown }) {
  const attrs = (Array.isArray(r.attributes) ? r.attributes : []) as ItemAttr[]
  const ref = new Set([...splitCodes(r.sellerSku), ...splitCodes(r.partNumber)])
  const oem = new Set<string>()
  for (const a of attrs) {
    const id = String(a.id ?? '').toUpperCase()
    if (id.includes('OEM') || /\boem\b/i.test(a.name ?? '')) splitCodes(a.value).forEach((c) => oem.add(c))
    else if (REF_ATTR.test(id) || /refer[eê]ncia/i.test(a.name ?? '')) splitCodes(a.value).forEach((c) => ref.add(c))
  }
  for (const c of oem) ref.delete(c)
  return { ref, oem }
}

// ---------- Aprendizado ----------

const COMPAT = /\b(serve|servem|compativel|compatibilidade|aplica|aplicacao|encaixa|funciona|cabe|da certo|vale para|usa n[ao])\b/
const TECH = /\b(medida|medidas|dimens\w*|diametro|altura|largura|comprimento|rosca|material|peso|especifica\w*|original|paralel\w*|marca|fabricante|litros|polegada\w*|mm)\b/
const VOLATILE = /\b(estoque|disponive\w*|pronta entrega|preco|valor|quanto (custa|sai|fica)|promo\w*|desconto)\b/
const SHIPPING = /\b(frete|prazo|entrega|envio|enviam|transportadora|retirar|retirada)\b/
const WARRANTY = /\b(garantia|troca|devolu\w*|defeito)\b/
const COMMERCIAL = /\b(nota fiscal|nf|pix|boleto|parcel\w*|cnpj|fatura\w*)\b/

/** Classifica a pergunta para aprender a resposta. Compatibilidade e dados técnicos ficam presos ao anúncio. */
export function classifyForLearning(question: string): { skip: string } | { category: string; scoped: boolean } {
  const q = norm(question)
  if (VOLATILE.test(q)) return { skip: 'preço/estoque mudam com o tempo' }
  // frete muda com o CEP e com a tabela: vem sempre do cálculo da Magazord, nunca de resposta aprendida
  if (SHIPPING.test(q)) return { skip: 'frete é calculado na hora pela Magazord' }
  if (COMPAT.test(q)) return { category: 'Aplicações e compatibilidade', scoped: true }
  if (TECH.test(q)) return { category: 'Informações técnicas', scoped: true }
  if (WARRANTY.test(q)) return { category: 'Garantia e troca', scoped: false }
  if (COMMERCIAL.test(q)) return { category: 'Informações comerciais', scoped: false }
  const aboutItem = /\b(esse|este|essa|esta|desse|deste|dessa|desta|isso|ele|ela|dele|dela|item|peca|produto)\b/.test(q) || /\b\w*\d\w*\b/.test(q)
  return { category: 'Dúvidas frequentes', scoped: aboutItem }
}

/** Tira a saudação (o sistema coloca a do horário) e troca links de anúncios da loja por marcadores {{LINK:ID}}. */
export function cleanAnswer(text: string, items: { id: string; permalink: string | null }[]) {
  let t = String(text ?? '').trim()
  t = t.replace(/^(bom dia|boa tarde|boa noite|ol[aá]|oi)\s*[!,.]*\s*/i, '')
  t = t.replace(/https?:\/\/\S+/g, (u) => {
    const url = u.replace(/[).,;]+$/, '')
    const hit = items.find((i) => i.permalink && (i.permalink === url || url.startsWith(i.permalink) || url.includes(i.id.replace(/^(ML[A-Z])/, '$1-')) || url.includes(i.id)))
    return hit ? `{{LINK:${hit.id}}}` : ''
  })
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------- Prioridade (organização da fila; não é previsão de compra) ----------

export function computePriority(q: { receivedAt: Date | string; purchaseIntent?: boolean | null; partCode?: string | null; text: string; pendingReason?: string | null; relevance?: number | null }, now = Date.now()) {
  const ageH = (now - new Date(q.receivedAt).getTime()) / 3_600_000
  let score = 0
  if (ageH > 24) score += 3
  else if (ageH > 8) score += 2
  else if (ageH > 2) score += 1
  if (q.purchaseIntent) score += 2
  if (q.partCode || /serve|compat|aplica|codigo|original/.test(norm(q.text))) score += 1
  if (q.pendingReason && ['A', 'C', 'D'].includes(q.pendingReason)) score += 1
  if (q.pendingReason === 'F') score += 1
  score += Number(q.relevance ?? 0)
  const level = score >= 5 ? 'alta' : score >= 3 ? 'media' : 'baixa'
  return { score, level, ageHours: Math.round(ageH * 10) / 10 }
}
