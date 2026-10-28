/**
 * Conferência de legenda e roteiro de Reels (ideias do /ig-caption e do /ig-reel do instagram-agent-skill, MIT),
 * adaptadas ao português e ao público de peças para máquinas pesadas. Funções puras, testadas.
 */
import { CAPTION_MAX } from './postagens'

/** O feed mostra mais ou menos isso da legenda antes do "... mais". */
export const FEED_CHARS = 125
/** O Instagram passou a aceitar no máximo 5 hashtags por post. */
export const IG_HASHTAGS = 5
/** Ritmo de fala em português para calcular o tempo de cada fala (palavras por minuto). */
export const WPM = 160

type Status = 'ok' | 'atencao' | 'erro'
export interface Check {
  status: Status
  label: string
  detail: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

const GREETING = /^(ola|oi|oie|bom dia|boa tarde|boa noite|fala,? (pessoal|galera)|e ai|eai|hoje (eu )?(vou|vamos|quero)|pessoal|galera|salve)\b/
const STOP_SCROLL = /\b(pare de rolar|para de rolar|nao role|nao passe)\b/

/** Número, medida, código ou modelo (JS200, 320D, PC200-8) e nomes próprios: o que deixa um texto concreto. */
export function concreteCount(text: string) {
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []
  let n = 0
  tokens.forEach((t, i) => {
    if (/\d/.test(t)) n++
    else if (i > 0 && /^\p{Lu}[\p{L}]{2,}/u.test(t)) n++
  })
  return n
}

const CTAS: [string, RegExp][] = [
  ['WhatsApp', /\b(whatsapp|whats|zap|chame|chama a gente|fale com|fala com)\b/],
  ['comentar', /\b(comente|comenta|deixe (seu|um) comentario)\b/],
  ['link ou site', /\b(link na bio|link do perfil|acesse|clique|toque no link|no site)\b/],
  ['direct', /\b(direct|dm|mande (uma )?mensagem|envie (uma )?mensagem|chama no direct)\b/],
  ['salvar', /\b(salve|salva (esse|este)|guarde (esse|este))\b/],
  ['compartilhar', /\b(compartilhe|marque (um|o|quem)|envie para|mande para)\b/],
  ['ligar', /\b(ligue|ligacao|telefone para)\b/],
]

/** O que a legenda mostra no feed e a lista de conferências (tamanho, primeira linha, gancho, hashtags, pedido, busca). */
export function checkCaption(caption: string, keywords: string[] = []) {
  const text = caption.replace(/\r\n/g, '\n').trim()
  const truncated = text.length > FEED_CHARS
  const preview = truncated ? text.slice(0, FEED_CHARS) : text
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  const hashtags = [...text.matchAll(/(^|\s)(#[\p{L}\p{N}_]+)/gu)].map((m) => m[2]!)
  const n = norm(text)
  const checks: Check[] = []

  checks.push(text.length > CAPTION_MAX ? { status: 'erro', label: 'Tamanho', detail: `${text.length} de ${CAPTION_MAX} caracteres: passa do limite do Instagram.` } : { status: 'ok', label: 'Tamanho', detail: `${text.length} de ${CAPTION_MAX} caracteres.` })
  if (!text) return { preview, truncated, length: 0, hashtags, checks: [{ status: 'atencao' as Status, label: 'Legenda', detail: 'Sem legenda.' }] }

  checks.push(
    firstLine.length > FEED_CHARS
      ? { status: 'atencao', label: 'Primeira linha', detail: `${firstLine.length} caracteres: o feed corta em ${FEED_CHARS}, no meio da frase. Encurte ou quebre a linha antes.` }
      : { status: 'ok', label: 'Primeira linha', detail: `${firstLine.length} caracteres: aparece inteira no feed.` },
  )
  const opening = norm(firstLine)
  if (GREETING.test(opening)) checks.push({ status: 'atencao', label: 'Abertura', detail: 'Começa com cumprimento. Ninguém abre o feed para ser cumprimentado: comece pelo assunto.' })
  else if (STOP_SCROLL.test(opening)) checks.push({ status: 'atencao', label: 'Abertura', detail: 'Pedir para "parar de rolar" mostra que o texto ainda não ganhou a atenção. Comece pelo assunto.' })
  const concrete = concreteCount(preview)
  checks.push(concrete ? { status: 'ok', label: 'Gancho concreto', detail: `${concrete} número(s), modelo(s) ou nome(s) no trecho que aparece no feed.` } : { status: 'atencao', label: 'Gancho concreto', detail: 'Nada concreto no trecho do feed. Ponha o modelo da máquina, a peça ou um número logo no começo.' })

  checks.push(
    hashtags.length > IG_HASHTAGS
      ? { status: 'atencao', label: 'Hashtags', detail: `${hashtags.length} hashtags: o Instagram passou a aceitar no máximo ${IG_HASHTAGS} por post. Fique com as ${IG_HASHTAGS} mais ligadas ao assunto.` }
      : hashtags.length === 0
        ? { status: 'atencao', label: 'Hashtags', detail: `Sem hashtags. Use de 3 a ${IG_HASHTAGS}, ligadas ao assunto.` }
        : { status: 'ok', label: 'Hashtags', detail: `${hashtags.length}: ${hashtags.join(' ')}` },
  )

  const asks = CTAS.filter(([, re]) => re.test(n)).map(([k]) => k)
  checks.push(
    asks.length === 1
      ? { status: 'ok', label: 'Um pedido', detail: `Um pedido só: ${asks[0]}.` }
      : asks.length === 0
        ? { status: 'atencao', label: 'Um pedido', detail: 'Sem pedido no fim (ex.: "chame no WhatsApp"). Diga o que a pessoa deve fazer.' }
        : { status: 'atencao', label: 'Um pedido', detail: `${asks.length} pedidos (${asks.join(', ')}): quem recebe vários pedidos não faz nenhum. Escolha um.` },
  )

  const terms = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 10)
  if (terms.length) {
    const body = norm(text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, ' '))
    const missing = terms.filter((k) => !body.includes(norm(k)))
    checks.push(
      missing.length
        ? { status: 'atencao', label: 'Palavras de busca', detail: `${terms.length - missing.length} de ${terms.length} no texto. Faltam: ${missing.join(', ')}. A busca do Instagram lê a legenda, não só as hashtags.` }
        : { status: 'ok', label: 'Palavras de busca', detail: `Todas no texto: ${terms.join(', ')}.` },
    )
  }
  return { preview, truncated, length: text.length, hashtags, checks }
}

// ---------- Reels: nota do gancho e tempo das falas ----------

const STAKES = /\b(perd\w*|prejuizo|custo|caro|cara|quebr\w*|parad\w*|erro|errad\w*|nunca|evite|evitar|cuidado|r\$|dinheiro|garantia|falh\w*|vazamento|desgaste|troca errada|pirata|falsificad\w*)/
const ADDRESS = /\b(voce|seu|sua|seus|suas|te|tua|teu)\b/
const CURIOUS = /(\?|\bpor que\b|\bcomo\b|\bo que\b|\bninguem\b|\bsegredo\b|\bantes de\b|\bdescobr\w*|\bverdade\b)/

export interface HookScore {
  text: string
  score: number
  label: 'FORTE' | 'OK' | 'FRACO'
  /** O ponto mais fraco (para o que melhorar). */
  weakest: string
  dealbreaker: string | null
  parts: Record<string, number>
}

/** Nota de 0 a 100 para a abertura de um Reels: começa pelo assunto, é concreta, curta, tem algo em jogo e fala com você. */
export function hookScore(raw: string): HookScore {
  const text = raw.replace(/\s+/g, ' ').trim()
  const n = norm(text)
  const w = words(text).length
  const concrete = concreteCount(text)
  const parts: Record<string, number> = {
    'COMEÇA PELO ASSUNTO': GREETING.test(n) ? 0 : 100,
    'CONCRETO': concrete >= 2 ? 100 : concrete === 1 ? 75 : 35,
    'CURTO': w <= 8 ? 100 : w <= 12 ? 75 : w <= 16 ? 45 : 15,
    'ALGO EM JOGO': STAKES.test(n) ? 100 : 55,
    'CURIOSIDADE': CURIOUS.test(n) ? 100 : 60,
    'FALA COM VOCÊ': ADDRESS.test(n) ? 100 : 60,
  }
  const weights: Record<string, number> = { 'COMEÇA PELO ASSUNTO': 0.25, 'CONCRETO': 0.2, 'CURTO': 0.15, 'ALGO EM JOGO': 0.15, 'CURIOSIDADE': 0.15, 'FALA COM VOCÊ': 0.1 }
  let score = Object.entries(parts).reduce((s, [k, v]) => s + v * weights[k]!, 0)
  let dealbreaker: string | null = null
  if (!text) dealbreaker = 'Abertura vazia.'
  else if (GREETING.test(n)) dealbreaker = 'Começa com cumprimento: ninguém abre o Reels para ser cumprimentado.'
  else if (STOP_SCROLL.test(n)) dealbreaker = 'Pede para "parar de rolar": pedir atenção mostra que ela ainda não foi ganha.'
  if (dealbreaker) score = Math.min(score * 0.6, 45)
  score = Math.round(score * 10) / 10
  const weakest = Object.entries(parts).sort((a, b) => a[1] - b[1])[0]![0]
  return { text, score, label: score >= 75 ? 'FORTE' : score >= 50 ? 'OK' : 'FRACO', weakest, dealbreaker, parts }
}

const STOPWORDS = new Set('para pela pelo com sem que uma uns umas dos das nos nas este esta esse essa isso aqui voce seu sua mais muito como porque quando onde qual quem tem sao foi ser ter vai vou'.split(' '))
const keyWords = (s: string) => new Set(words(norm(s).replace(/[^a-z0-9 ]/g, ' ')).filter((x) => x.length >= 4 && !STOPWORDS.has(x)))

export interface Beat {
  start: number
  seconds: number
  text: string
  screen: string
  tag: 'GANCHO' | 'MEIO' | 'CHAMADA'
  long: boolean
}

/** Tempo de cada fala (a 160 palavras por minuto), em sequência, e os avisos que mais derrubam um Reels na edição. */
export function beatSheet(lines: { text: string; screen?: string }[], target = 30) {
  const list = lines.map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), screen: (l.screen ?? '').trim() })).filter((l) => l.text)
  let t = 0
  const beats: Beat[] = list.map((l, i) => {
    const seconds = Math.round(Math.max(0.8, (words(l.text).length / WPM) * 60) * 10) / 10
    const b: Beat = { start: Math.round(t * 10) / 10, seconds, text: l.text, screen: l.screen, tag: i === 0 ? 'GANCHO' : i === list.length - 1 && list.length > 1 ? 'CHAMADA' : 'MEIO', long: i > 0 && seconds > 4 }
    t += seconds
    return b
  })
  const total = Math.round(t * 10) / 10
  const notes: string[] = []
  if (!beats.length) return { beats, total, words: 0, notes: ['Sem falas.'] }
  if (beats[0]!.seconds > 3) notes.push(`A abertura leva ${beats[0]!.seconds.toLocaleString('pt-BR')}s: passe para menos de 3s, ou a pessoa sai antes de saber do que se trata.`)
  beats.forEach((b, i) => {
    if (b.long) notes.push(`Fala ${i + 1} leva ${b.seconds.toLocaleString('pt-BR')}s: divida a frase ou mude o que aparece na tela no meio dela. Tela parada é onde as pessoas saem.`)
  })
  let run = 0
  for (let i = 1; i < beats.length; i++) {
    run = concreteCount(beats[i]!.text) ? 0 : run + 1
    if (run === 3) notes.push(`Falas ${i - 1} a ${i + 1} sem nada concreto (modelo, peça, número): ponha um exemplo real.`)
  }
  if (beats.length > 1) {
    const first = keyWords(beats[0]!.text)
    const back = [...keyWords(beats.at(-1)!.text)].filter((x) => first.has(x))
    notes.push(back.length ? `Volta ao começo ("${back[0]}"): quem chega ao fim tende a assistir de novo.` : 'Termine retomando uma palavra da abertura: o vídeo vira um ciclo e ganha a segunda visualização.')
  }
  const diff = Math.round((total - target) * 10) / 10
  if (diff < -3) notes.push(`${Math.abs(diff).toLocaleString('pt-BR')}s abaixo dos ${target}s. Curto costuma ser melhor: só complete se faltar informação.`)
  else if (diff > 3) notes.push(`${diff.toLocaleString('pt-BR')}s acima dos ${target}s: corte as falas sem nada concreto.`)
  return { beats, total, words: list.reduce((s, l) => s + words(l.text).length, 0), notes }
}

/** Pedido do roteiro de Reels para a IA (JSON). */
export function reelsPrompt(d: { topic: string; seconds: number; product?: { name: string; brand: string | null; code: string } | null; instruction?: string }) {
  return [
    `Escreva o roteiro de um Reels de cerca de ${d.seconds} segundos para o Instagram.`,
    `Tema: ${d.topic || '(livre)'}`,
    d.product ? `Produto: ${d.product.name}${d.product.brand ? ` · marca ${d.product.brand}` : ''} · código ${d.product.code}` : '',
    d.instruction ? `Instrução: ${d.instruction}` : '',
    'Primeiro, 3 aberturas (ganchos) diferentes, de até 10 palavras cada: comece pelo assunto (nunca por cumprimento), cite o modelo da máquina, a peça ou um número, e mostre o que está em jogo para quem assiste (custo, máquina parada, erro comum).',
    'Depois, as falas do roteiro (de 6 a 10), uma frase curta por fala, para ser dita em voz alta, com o texto que aparece na tela em cada uma (até 6 palavras).',
    'A primeira fala é a melhor abertura. A última é um único pedido (ex.: chamar no WhatsApp) e retoma uma palavra da abertura.',
    'Por fim, a legenda: primeira linha de até 125 caracteres com o gancho concreto, um único pedido e de 3 a 5 hashtags no fim.',
    'Responda SÓ com JSON, sem texto fora dele, no formato:',
    '{"ganchos":["...","...","..."],"falas":[{"fala":"...","tela":"..."}],"legenda":"..."}',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Lê o JSON do roteiro: 1 a 3 ganchos, até 14 falas. */
export function parseReels(raw: string) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const hooks = (Array.isArray(data.ganchos) ? data.ganchos : []).map((h) => String(h ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean).slice(0, 3)
  const lines = (Array.isArray(data.falas) ? data.falas : [])
    .map((l) => (typeof l === 'string' ? { text: l, screen: '' } : { text: String((l as Record<string, unknown>)?.fala ?? ''), screen: String((l as Record<string, unknown>)?.tela ?? '') }))
    .map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim().slice(0, 300), screen: l.screen.replace(/\s+/g, ' ').trim().slice(0, 80) }))
    .filter((l) => l.text)
    .slice(0, 14)
  if (!hooks.length || !lines.length) return null
  return { hooks, lines, caption: String(data.legenda ?? '').trim().slice(0, CAPTION_MAX) }
}
