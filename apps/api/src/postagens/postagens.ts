/**
 * Postagens no Instagram e no Facebook: regras de cada formato, limpeza do que vem da tela e textos da IA.
 * Funções puras, testadas em test/postagens.spec.ts.
 */

export const NETWORKS = ['instagram', 'facebook'] as const
export type Network = (typeof NETWORKS)[number]
export const FORMATS = ['FEED', 'STORIES', 'REELS'] as const
export type PostFormat = (typeof FORMATS)[number]
export const STATUSES = ['RASCUNHO', 'EM_APROVACAO', 'APROVADO', 'PUBLICANDO', 'PUBLICADO', 'ERRO'] as const
export type PostStatus = (typeof STATUSES)[number]

export const NETWORK_LABEL: Record<Network, string> = { instagram: 'Instagram', facebook: 'Facebook' }
export const FORMAT_LABEL: Record<PostFormat, string> = { FEED: 'Feed', STORIES: 'Stories', REELS: 'Reels' }

/** Legenda do Instagram: até 2.200 caracteres e 30 hashtags. */
export const CAPTION_MAX = 2200
export const HASHTAG_MAX = 30
/** Carrossel do Instagram e do Facebook: até 10 itens. */
export const CAROUSEL_MAX = 10
/** Imagem: JPEG (o Instagram só aceita JPEG) até 8 MB. Vídeo: MP4 até 64 MB (limite de envio do servidor). */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const VIDEO_MAX_BYTES = 64 * 1024 * 1024

/** Conta de publicação: um Instagram profissional ou uma página do Facebook (a empresa pode ter várias). */
export interface Account {
  /** Identificador no CRM (as postagens guardam este). */
  id: string
  network: Network
  /** ID na Meta (Instagram profissional ou página). */
  externalId: string
  /** @usuario do Instagram ou nome da página. */
  name: string
  /** Grupo para escolher várias de uma vez e somar as métricas (ex.: Oficial, Vendedores). */
  group: string
}

/** Limpa a lista de contas que vem da tela: rede válida, ID numérico, sem repetir. No máximo 30. */
export function cleanAccounts(list: unknown): Account[] | { error: string } {
  if (!Array.isArray(list)) return { error: 'Lista de contas inválida.' }
  const out: Account[] = []
  for (const raw of list.slice(0, 30) as Record<string, unknown>[]) {
    const network = String(raw.network ?? '')
    const externalId = String(raw.externalId ?? '').trim()
    const name = String(raw.name ?? '').trim().slice(0, 80)
    if (!(NETWORKS as readonly string[]).includes(network)) return { error: 'Escolha Instagram ou Facebook em cada conta.' }
    if (!/^\d{5,25}$/.test(externalId)) return { error: `ID inválido${name ? ` em ${name}` : ''}: use só os números do ID da Meta.` }
    if (out.some((a) => a.network === network && a.externalId === externalId)) continue
    const id = /^[a-z0-9-]{4,40}$/.test(String(raw.id ?? '')) ? String(raw.id) : `${network === 'instagram' ? 'ig' : 'fb'}-${externalId}`
    const group = String(raw.group ?? '').trim().slice(0, 40) || 'Geral'
    out.push({ id, network: network as Network, externalId, name: name || (network === 'instagram' ? `Instagram ${externalId}` : `Página ${externalId}`), group })
  }
  return out
}

/** Redes das contas escolhidas (para as regras de formato e os ícones). */
export const networksOf = (accountIds: string[], accounts: Account[]) => [...new Set(accountIds.map((id) => accounts.find((a) => a.id === id)?.network).filter((n): n is Network => !!n))]

export interface MediaInfo {
  id: string
  kind: 'imagem' | 'video'
  width: number | null
  height: number | null
}

export interface PostInput {
  title?: string
  caption?: string
  networks?: string[]
  accountIds?: string[]
  format?: string
  mediaIds?: string[]
  scheduledAt?: string | null
}

export interface CleanPost {
  title: string
  caption: string
  /** Contas escolhidas (Account.id). */
  accountIds: string[]
  /** Redes dessas contas. */
  networks: Network[]
  format: PostFormat
  mediaIds: string[]
  scheduledAt: Date | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Limpa o rascunho (aceita incompleto: o que falta é conferido ao enviar para aprovação). Só contas cadastradas. */
export function cleanPost(d: PostInput, accounts: Account[]): CleanPost | { error: string } {
  const accountIds = [...new Set((d.accountIds ?? []).filter((id) => accounts.some((a) => a.id === id)))]
  const networks = networksOf(accountIds, accounts)
  const format = (FORMATS as readonly string[]).includes(d.format ?? '') ? (d.format as PostFormat) : 'FEED'
  const mediaIds = [...new Set((d.mediaIds ?? []).filter((id) => UUID.test(id)))].slice(0, CAROUSEL_MAX)
  const caption = (d.caption ?? '').replace(/\r\n/g, '\n').trim()
  if (caption.length > CAPTION_MAX) return { error: `Legenda com ${caption.length} caracteres: o Instagram aceita até ${CAPTION_MAX}.` }
  let scheduledAt: Date | null = null
  if (d.scheduledAt) {
    const t = Date.parse(d.scheduledAt)
    if (!Number.isFinite(t)) return { error: 'Data e hora inválidas.' }
    scheduledAt = new Date(t)
  }
  const title = (d.title ?? '').trim().slice(0, 120) || caption.split('\n')[0]!.slice(0, 60) || 'Postagem sem título'
  return { title, caption, accountIds, networks, format, mediaIds, scheduledAt }
}

export const hashtagsOf = (caption: string) => caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0

/**
 * O que falta para a postagem poder ir para aprovação (e ser publicada). Lista vazia = pronta.
 * Feed: 1 a 10 imagens, ou 1 vídeo (no Instagram, vídeo no feed sai como Reels). Stories: 1 imagem ou 1 vídeo.
 * Reels: 1 vídeo.
 */
export function missingForApproval(p: CleanPost, media: MediaInfo[], now = Date.now()): string[] {
  const out: string[] = []
  if (!p.accountIds.length) out.push('Escolha em quais contas publicar.')
  if (!media.length) out.push('Escolha a imagem ou o vídeo.')
  const videos = media.filter((m) => m.kind === 'video').length
  const images = media.length - videos
  if (p.format === 'REELS' && (videos !== 1 || images)) out.push('Reels: escolha um vídeo (só um).')
  if (p.format === 'STORIES' && media.length > 1) out.push('Stories: uma imagem ou um vídeo por postagem.')
  if (p.format === 'FEED' && videos && media.length > 1) out.push('Feed: vídeo vai sozinho (o carrossel é só de imagens).')
  if (p.format !== 'STORIES' && !p.caption.trim()) out.push('Escreva a legenda.')
  if (hashtagsOf(p.caption) > HASHTAG_MAX) out.push(`O Instagram aceita até ${HASHTAG_MAX} hashtags por postagem.`)
  if (p.networks.includes('instagram')) {
    for (const m of media) {
      if (m.kind !== 'imagem' || !m.width || !m.height) continue
      const r = m.width / m.height
      // Feed do Instagram: entre 4:5 (retrato) e 1,91:1 (paisagem).
      if (p.format === 'FEED' && (r < 0.8 - 0.01 || r > 1.91 + 0.01)) out.push('Instagram (feed): a imagem precisa estar entre 4:5 (retrato) e 1,91:1 (paisagem). Ajuste o enquadramento.')
    }
  }
  if (p.scheduledAt && p.scheduledAt.getTime() < now - 5 * 60_000) out.push('A data marcada já passou: escolha outra (ou deixe em branco para publicar assim que aprovar).')
  return [...new Set(out)]
}

/** Situação na tela. */
export const STATUS_LABEL: Record<PostStatus, string> = {
  RASCUNHO: 'Rascunho',
  EM_APROVACAO: 'Aguardando aprovação',
  APROVADO: 'Aprovada (agendada)',
  PUBLICANDO: 'Publicando',
  PUBLICADO: 'Publicada',
  ERRO: 'Erro ao publicar',
}

/** Resultado da publicação em cada conta. */
export interface NetworkResult {
  id?: string
  permalink?: string | null
  at?: string
  error?: string
  network?: Network
  name?: string
}
/** Por conta (Account.id). */
export type PostResults = Record<string, NetworkResult>

/** Contas que ainda faltam (as que já saíram não são publicadas de novo numa nova tentativa). */
export const pendingAccounts = (accountIds: string[], results: PostResults | null | undefined) => accountIds.filter((id) => !results?.[id]?.id)

// ---------- IA (Gemini gratuito) ----------

export function postSystem(company: string, about: string) {
  return [
    `Você escreve postagens de Instagram e Facebook para a ${company}, em português do Brasil.`,
    about ? `Sobre a empresa: ${about}` : '',
    'Público: donos de máquinas pesadas, mecânicos, compradores de oficinas e construtoras. Tom profissional, direto e próximo, sem exagero.',
    'Regras: nunca invente preço, desconto, prazo, estoque, garantia, frete ou compatibilidade. Onde faltar um dado, escreva [conferir: ...].',
    'Não prometa o que a empresa não confirmou. Use poucos emojis (no máximo 3) e hashtags relevantes (de 5 a 12), no fim.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function captionPrompt(d: { topic: string; network: string; format: string; product?: { name: string; brand: string | null; code: string; url: string | null } | null; current?: string; instruction?: string }) {
  return [
    `Escreva a legenda de uma postagem (${d.format === 'STORIES' ? 'Stories: texto curto, de 1 a 2 frases' : d.format === 'REELS' ? 'Reels: gancho forte na primeira linha' : 'feed'}) para ${d.network}.`,
    `Tema: ${d.topic || '(livre)'}`,
    d.product ? `Produto: ${d.product.name}${d.product.brand ? ` · marca ${d.product.brand}` : ''} · código ${d.product.code}${d.product.url ? ` · link ${d.product.url}` : ''}` : '',
    d.current ? `Legenda atual (melhore a partir dela):\n${d.current}` : '',
    d.instruction ? `Instrução: ${d.instruction}` : '',
    'Termine com uma chamada para ação (WhatsApp, site ou direct) e as hashtags.',
    'Responda só com a legenda pronta, sem comentários antes ou depois.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Tira aspas, cercas de código e "Legenda:" que a IA às vezes coloca em volta. */
export function cleanCaption(raw: string) {
  return raw
    .replace(/^```[a-z]*\s*|```\s*$/gi, '')
    .replace(/^\s*(legenda|texto)\s*:\s*/i, '')
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim()
    .slice(0, CAPTION_MAX)
}

export interface PlanInput {
  from: string
  to: string
  perWeek: number
  themes: string
  /** Redes das contas escolhidas (para o texto do pedido). */
  networks: Network[]
  formats: PostFormat[]
  times: string[]
}

export interface PlanItem {
  date: string
  time: string
  format: PostFormat
  title: string
  caption: string
  imageIdea: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function planPrompt(d: PlanInput) {
  return [
    `Monte um calendário de postagens de ${d.from} a ${d.to}, com cerca de ${d.perWeek} postagem(ns) por semana.`,
    `Redes: ${d.networks.map((n) => NETWORK_LABEL[n]).join(' e ')}. Formatos possíveis: ${d.formats.map((f) => FORMAT_LABEL[f]).join(', ')}.`,
    `Temas e campanhas do período: ${d.themes || 'peças e filtros para máquinas pesadas, dicas de manutenção, marcas atendidas, institucional'}.`,
    `Horários preferidos: ${d.times.join(', ') || '09:00, 12:00, 18:00'}. Varie os temas e os formatos; evite domingos.`,
    'Responda SÓ com JSON, sem texto fora dele, no formato:',
    '{"posts":[{"date":"AAAA-MM-DD","time":"HH:MM","format":"FEED|STORIES|REELS","title":"título curto interno","caption":"legenda pronta com chamada e hashtags","imageIdea":"descrição da imagem ou vídeo a usar"}]}',
  ].join('\n')
}

/** Lê o JSON do calendário sugerido: só datas dentro do período e formatos pedidos; no máximo 40 postagens. */
export function parsePlan(raw: string, d: PlanInput): PlanItem[] {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let data: unknown
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  const list = (data as { posts?: unknown }).posts
  if (!Array.isArray(list)) return []
  const out: PlanItem[] = []
  for (const it of list as Record<string, unknown>[]) {
    const date = String(it.date ?? '')
    const time = String(it.time ?? '')
    const format = String(it.format ?? '').toUpperCase()
    if (!DAY.test(date) || date < d.from || date > d.to) continue
    if (!(d.formats as string[]).includes(format)) continue
    const caption = cleanCaption(String(it.caption ?? ''))
    if (!caption) continue
    out.push({
      date,
      time: TIME.test(time) ? time : (d.times[0] ?? '09:00'),
      format: format as PostFormat,
      title: String(it.title ?? '').trim().slice(0, 120) || caption.slice(0, 60),
      caption,
      imageIdea: String(it.imageIdea ?? '').trim().slice(0, 400),
    })
    if (out.length >= 40) break
  }
  return out.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
}

/** Pedido de imagem para a IA: foto de produto/arte de redes sociais, sem texto escrito (texto em imagem sai errado). */
export function imagePrompt(idea: string, format: PostFormat) {
  return [
    `Crie uma imagem para ${format === 'STORIES' || format === 'REELS' ? 'Stories do Instagram, vertical 9:16' : 'o feed do Instagram, quadrada 1:1'}.`,
    `Assunto: ${idea}`,
    'Estilo: fotografia realista e profissional, boa luz, contexto de máquinas pesadas e oficina quando fizer sentido.',
    'Não escreva textos, letras, números nem logotipos na imagem.',
  ].join('\n')
}

// ---------- Arquivos ----------

/** Confere o arquivo pelos bytes: JPEG (imagem) ou MP4/MOV (vídeo). */
export function detectPostFile(b: Buffer): { kind: 'imagem' | 'video'; mime: string; ext: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'imagem', mime: 'image/jpeg', ext: 'jpg' }
  if (b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12)
    return brand === 'qt  ' ? { kind: 'video', mime: 'video/quicktime', ext: 'mov' } : { kind: 'video', mime: 'video/mp4', ext: 'mp4' }
  }
  return null
}

/** Largura e altura de um JPEG (marcador SOF), sem biblioteca de imagem. */
export function jpegSize(b: Buffer): { width: number; height: number } | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    const len = b.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    i += 2 + len
  }
  return null
}

// ---------- Métricas ----------

export interface MetricRow {
  followers: number | null
  reach: number | null
  interactions: number | null
}

/** Engajamento: interações ÷ alcance (em %, 1 casa). Sem alcance, interações ÷ seguidores. */
export function engagementRate(m: MetricRow): number | null {
  const base = m.reach || m.followers
  if (!base || m.interactions === null) return null
  return Math.round((m.interactions / base) * 1000) / 10
}

/** Soma das contas por grupo (contas que a Meta não informou não entram na soma daquele número). */
export function groupTotals<T extends MetricRow & { group: string }>(rows: T[]) {
  const out = new Map<string, MetricRow & { group: string; accounts: number }>()
  for (const r of rows) {
    const g = out.get(r.group) ?? { group: r.group, accounts: 0, followers: null, reach: null, interactions: null }
    g.accounts++
    for (const k of ['followers', 'reach', 'interactions'] as const) if (r[k] !== null) g[k] = (g[k] ?? 0) + r[k]!
    out.set(r.group, g)
  }
  return [...out.values()].map((g) => ({ ...g, engagement: engagementRate(g) })).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
}
