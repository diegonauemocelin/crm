// Frete nas perguntas do Mercado Livre: reconhecer a pergunta, achar o CEP, ler a cotação da Magazord e montar a
// resposta. Sem banco e sem rede (testado em test/assistente-frete.spec.ts).

/** O Mercado Livre aceita respostas de até 2.000 caracteres. */
export const ANSWER_MAX = 2000

export type QuestionKind = 'frete' | 'frete_sem_cep' | 'misto'

const FREIGHT = /\bfrete|\benvi[oa]m?\b|\benvios?\b|\bmanda(m|r)?\b|\bentreg(a|am|ar|ue)|\bchega(r|m)?\b|\bprazo|\bcep\b|correios|transportadora|sedex|\bpac\b|\bposta(gem|r)\b|\bdespach|quanto fica (pra|para|at[eé])|\bvalor (do|de) envio|\bcusto (do|de) envio|retir(ar|ada)\b/i
/** Assuntos que pedem uma pessoa (o frete sozinho não responde). */
const OTHER = /estoque|dispon[ií]vel|\btem\b.*\b(a pe[cç]a|o produto|pronta)|compat[ií]v|\bserve\b|\bservir|encaixa|original|paralel|genu[ií]n|garantia|nota fiscal|\bnf\b|nfe|desconto|parcel|pix|boleto|\bano\b|modelo|vers[aã]o|motor|chassi|medida|tamanho|cor\b|\bkit\b|instala|defeito|troca|devolu|quantidade|unidades|atacado|\bcnpj\b|nota\b/i
const CEP = /\b(\d{2})\.?(\d{3})\s?-?\s?(\d{3})\b/

/** CEP da pergunta (00000-000, 00000000, 00.000-000). */
export function extractCep(text: string): string | null {
  const m = CEP.exec(text)
  if (!m) return null
  const cep = `${m[1]}${m[2]}${m[3]}`
  return /^0{8}$/.test(cep) ? null : cep
}

export const formatCep = (cep: string) => `${cep.slice(0, 5)}-${cep.slice(5)}`

/** Pergunta sobre frete? Com outro assunto junto, vira "misto" (uma pessoa responde). Sem frete: null. */
export function classifyQuestion(text: string): { kind: QuestionKind; cep: string | null } | null {
  const t = text.normalize('NFC')
  const freightWords = FREIGHT.test(t)
  // Oito números soltos podem ser código de peça ("tem o 32925682?"): só é CEP com hífen/ponto ou falando de frete.
  const cep = freightWords || /\b\d{2}\.?\d{3}-\d{3}\b/.test(t) ? extractCep(t) : null
  if (!freightWords && !cep) return null
  // Um CEP sozinho ("01310-100?") também é pedido de frete.
  const rest = t.replace(CEP, ' ')
  if (OTHER.test(rest)) return { kind: 'misto', cep }
  return { kind: cep ? 'frete' : 'frete_sem_cep', cep }
}

export interface FreightOption {
  name: string
  price: number
  /** Prazo em dias (úteis, como a Magazord informa); null quando não vem. */
  days: number | null
}

const PRICE_KEYS = ['valor', 'valorFrete', 'valorTotal', 'valorCalculado', 'preco', 'price', 'custo', 'vlFrete', 'frete']
const NAME_KEYS = ['nome', 'descricao', 'servico', 'nomeServico', 'servicoNome', 'transportadoraServico', 'modalidade', 'tipo', 'name']
const CARRIER_KEYS = ['transportadora', 'transportadoraNome', 'nomeTransportadora', 'carrier']
const DAYS_KEYS = ['prazo', 'prazoEntrega', 'prazoDias', 'diasUteis', 'prazoDiasUteis', 'dias', 'prazoMaximo', 'deliveryTime', 'prazoEntregaDias']

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const s = v.trim().replace(/[^\d,.-]/g, '')
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
    return Number.isFinite(n) ? n : null
  }
  return null
}
const text = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['nome', 'descricao', 'name']) if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim()
  }
  return null
}
const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (k in o && o[k] !== null && o[k] !== undefined) return o[k]
  return undefined
}

/**
 * Opções de frete da resposta da Magazord. A documentação não descreve o formato: procura, em qualquer nível, objetos
 * com valor e nome (serviço ou transportadora). Junta transportadora + serviço e tira repetidas. Mais barata primeiro.
 */
export function parseFreightOptions(data: unknown, inherited: string | null = null, out: FreightOption[] = [], depth = 0): FreightOption[] {
  if (depth > 6 || data === null || data === undefined) return out
  if (Array.isArray(data)) {
    for (const x of data) parseFreightOptions(x, inherited, out, depth + 1)
  } else if (typeof data === 'object') {
    const o = data as Record<string, unknown>
    const carrier = text(pick(o, CARRIER_KEYS)) ?? inherited
    const price = num(pick(o, PRICE_KEYS))
    const service = text(pick(o, NAME_KEYS))
    const days = num(pick(o, DAYS_KEYS))
    const hasError = typeof o.erro === 'string' || o.erro === true || typeof o.error === 'string' || o.disponivel === false
    if (price !== null && price >= 0 && (service || carrier) && !hasError) {
      const name = service && carrier && !service.toLowerCase().includes(carrier.toLowerCase()) ? `${carrier} ${service}` : (service ?? carrier)!
      out.push({ name: name.slice(0, 80), price: Math.round(price * 100) / 100, days: days === null ? null : Math.max(0, Math.round(days)) })
    } else {
      for (const v of Object.values(o)) if (v && typeof v === 'object') parseFreightOptions(v, carrier, out, depth + 1)
    }
  }
  if (depth > 0) return out
  const seen = new Set<string>()
  return out
    .filter((x) => {
      const k = `${x.name.toLowerCase()}|${x.price}|${x.days}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => a.price - b.price || (a.days ?? 99) - (b.days ?? 99))
    .slice(0, 6)
}

// Espaço comum depois do R$ (o formato de moeda usa espaço não separável, que aparece estranho no Mercado Livre).
const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Resposta com as opções (o Mercado Livre não aceita telefone, e-mail ou link: os textos fixos não devem ter). */
export function buildAnswer(cfg: { intro: string; outro: string }, cep: string, options: FreightOption[]) {
  const lines = options.map((o) => `- ${o.name}: ${o.price === 0 ? 'grátis' : brl(o.price)}${o.days !== null ? `, entrega em até ${o.days} ${o.days === 1 ? 'dia útil' : 'dias úteis'}` : ''}`)
  const head = cfg.intro.replace(/\{cep\}/g, formatCep(cep)).trim()
  const tail = cfg.outro.trim()
  return [head, ...lines, tail].filter(Boolean).join('\n').slice(0, ANSWER_MAX)
}

/** Telefone, e-mail ou link nos textos fixos: o Mercado Livre bloqueia a resposta. */
export function forbiddenContent(t: string) {
  if (/https?:\/\/|www\.|\.com(\.br)?\b/i.test(t)) return 'link ou endereço de site'
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) return 'e-mail'
  if (/(\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}/.test(t.replace(/\{cep\}/g, ''))) return 'número de telefone'
  if (/whats\s?app|zap\b/i.test(t)) return 'WhatsApp'
  return null
}

/** SKU do anúncio: o do anúncio (SELLER_SKU ou seller_custom_field) ou o da primeira variação. */
export function itemSku(item: { seller_custom_field?: string | null; attributes?: { id?: string; value_name?: string | null }[]; variations?: { seller_custom_field?: string | null; attributes?: { id?: string; value_name?: string | null }[] }[] }): string | null {
  const fromAttrs = (a?: { id?: string; value_name?: string | null }[]) => a?.find((x) => x.id === 'SELLER_SKU')?.value_name?.trim() || null
  const direct = fromAttrs(item.attributes) ?? (item.seller_custom_field?.trim() || null)
  if (direct) return direct
  for (const v of item.variations ?? []) {
    const s = fromAttrs(v.attributes) ?? (v.seller_custom_field?.trim() || null)
    if (s) return s
  }
  return null
}
