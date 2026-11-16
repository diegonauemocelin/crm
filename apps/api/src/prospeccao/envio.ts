/**
 * Envio em fila da busca de leads (funções puras): mensagens com variações, variáveis, intervalo aleatório entre
 * envios, limite por dia e o pedido de saída ("SAIR"), para a primeira abordagem não parecer spam nem arriscar o número.
 */

/** Padrão das mensagens automáticas em lote (decisão do usuário): de 2 a 10 minutos entre uma e outra. */
export const GAP_DEFAULT = { min: 2, max: 10 }
export const GAP_LIMITS = { min: 1, max: 120 }
export const DAILY_DEFAULT = 30
export const DAILY_MAX = 100
export const MAX_VARIATIONS = 5
export const MAX_SENDS = 200
export const OPT_OUT_LINE = 'Se não quiser receber mensagens nossas, é só responder SAIR.'

export interface CampaignInput {
  numberId: string
  prospectIds: string[]
  messages: string[]
  gapMin: number
  gapMax: number
  dailyMax: number
  optOut: boolean
}

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

/** Valida e normaliza o pedido de envio. Lança Error com a mensagem para o usuário. */
export function cleanCampaign(raw: Partial<Record<keyof CampaignInput, unknown>>): CampaignInput {
  const messages = (Array.isArray(raw.messages) ? raw.messages : [])
    .map((m) => (typeof m === 'string' ? m.trim().slice(0, 1500) : ''))
    .filter((m) => m.length >= 10)
    .slice(0, MAX_VARIATIONS)
  if (!messages.length) throw new Error('Escreva a mensagem (pelo menos 10 letras).')
  const prospectIds = [...new Set((Array.isArray(raw.prospectIds) ? raw.prospectIds : []).filter((x): x is string => typeof x === 'string'))]
  if (!prospectIds.length) throw new Error('Escolha as empresas que vão receber.')
  if (prospectIds.length > MAX_SENDS) throw new Error(`No máximo ${MAX_SENDS} empresas por envio.`)
  let gapMin = int(raw.gapMin, GAP_LIMITS.min, GAP_LIMITS.max, GAP_DEFAULT.min)
  let gapMax = int(raw.gapMax, GAP_LIMITS.min, GAP_LIMITS.max, GAP_DEFAULT.max)
  if (gapMax < gapMin) [gapMin, gapMax] = [gapMax, gapMin]
  return {
    numberId: typeof raw.numberId === 'string' ? raw.numberId : '',
    prospectIds,
    messages,
    gapMin,
    gapMax,
    dailyMax: int(raw.dailyMax, 1, DAILY_MAX, DAILY_DEFAULT),
    optOut: raw.optOut !== false,
  }
}

export interface MessageVars {
  empresa?: string | null
  cidade?: string | null
  segmento?: string | null
  vendedor?: string | null
}

/** Troca {empresa}, {cidade}, {segmento} e {vendedor}; variável sem valor some sem deixar espaço sobrando. */
export function renderMessage(template: string, v: MessageVars, optOut: boolean) {
  const first = (s?: string | null) => (s ?? '').trim().split(/\s+/)[0] ?? ''
  const text = template
    .replace(/\{empresa\}/gi, (v.empresa ?? '').trim())
    .replace(/\{cidade\}/gi, (v.cidade ?? '').trim())
    .replace(/\{segmento\}/gi, (v.segmento ?? '').trim().toLowerCase())
    .replace(/\{vendedor\}/gi, first(v.vendedor))
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return optOut && !/\bSAIR\b/.test(text) ? `${text}\n\n${OPT_OUT_LINE}` : text
}

/** Uma das variações, ao acaso (cada empresa recebe um texto um pouco diferente). */
export function pickVariation(messages: string[], random = Math.random) {
  return messages[Math.min(messages.length - 1, Math.floor(random() * messages.length))]!
}

/** Próximo envio: intervalo aleatório entre o mínimo e o máximo (minutos). */
export function nextGapMs(gapMin: number, gapMax: number, random = Math.random) {
  return Math.round((gapMin + random() * (gapMax - gapMin)) * 60_000)
}

/** Resposta pedindo para não receber mais ("SAIR", "parar", "não tenho interesse"...). */
export function isOptOut(text: string | null | undefined) {
  const t = (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return false
  if (/^(sair|parar|pare|stop|cancelar|remover|descadastrar)( por favor)?$/.test(t)) return true
  return /\b(nao (me )?(mande|envie|chame) mais|nao tenho interesse|me (tire|remova) da (sua )?lista|nao quero receber)\b/.test(t)
}

/** Celular com WhatsApp para o envio: o confirmado; senão, o primeiro celular não descartado. */
export function sendPhone(phones: { value: string; kind: string; whatsapp: boolean | null }[]) {
  return phones.find((p) => p.whatsapp === true) ?? phones.find((p) => p.kind === 'celular' && p.whatsapp !== false) ?? null
}

/** Pedido à IA para escrever a primeira mensagem (com variações). */
export function messagePrompt(d: { offer: string; segment: string | null; place: string | null; company: string; sender: string | null }) {
  return `Você escreve a PRIMEIRA mensagem de WhatsApp de uma empresa brasileira para outra empresa (B2B), que ainda não conhece.

Quem envia: ${d.company}${d.sender ? ` (atendente: ${d.sender})` : ''}.
O que oferece: ${d.offer}
Empresas que vão receber: ${d.segment || 'empresas da região'}${d.place ? ` em ${d.place}` : ''}.

Regras:
- Português do Brasil, cordial, curta (2 a 4 frases, no máximo 350 caracteres), sem parecer propaganda.
- Use {empresa} onde for o nome da empresa que recebe. Pode usar {vendedor} para o nome de quem envia e {cidade}.
- Termine com uma pergunta simples que convide a responder.
- Não invente preço, desconto, prazo, garantia, estoque nem nada que não esteja em "O que oferece".
- Sem links, sem emojis em excesso (no máximo 1), sem letras maiúsculas para gritar.
- Escreva 3 variações com palavras diferentes (mesma ideia), para cada empresa receber um texto um pouco diferente.

Responda SOMENTE com JSON: {"variacoes": ["...", "...", "..."]}`
}

/** Lê as variações que a IA devolveu (JSON solto no texto ou em bloco de código). */
export function variationsFromAi(text: string): string[] {
  const json = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const v = (JSON.parse(json) as { variacoes?: unknown }).variacoes
    return (Array.isArray(v) ? v : [])
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().slice(0, 1500))
      .filter((x) => x.length >= 10)
      .slice(0, MAX_VARIATIONS)
  } catch {
    return []
  }
}

/**
 * Pode enviar agora? No horário comercial do CRM; sem horário comercial ligado, de segunda a sábado das 8h às 18h
 * (horário de Brasília): mensagem de prospecção à noite ou no domingo irrita e chama denúncia.
 */
export function sendWindowOpen(hoursEnabled: boolean, openNow: boolean, now = new Date()) {
  if (hoursEnabled) return openNow
  const sp = new Date(now.getTime() - 3 * 3_600_000)
  const h = sp.getUTCHours()
  return sp.getUTCDay() !== 0 && h >= 8 && h < 18
}
