/** Leitura das mensagens que a Evolution manda (evento MESSAGES_UPSERT), sem depender do banco. */

export type MessageType = 'texto' | 'imagem' | 'audio' | 'video' | 'documento' | 'figurinha' | 'localizacao' | 'contato' | 'chamada' | 'outro'

export interface ParsedMessage {
  waId: string
  fromMe: boolean
  /** Identificador do contato na conversa (telefone@s.whatsapp.net, ou @lid quando o WhatsApp esconde o número). */
  jid: string
  /** Dígitos do telefone (com DDI), quando se sabe. */
  phoneDigits: string | null
  /** Nome de quem mandou (num grupo, o participante). */
  pushName: string | null
  /** Mensagem de grupo: fica na aba Grupos, sem lead, pré-venda nem mensagem de ausência. */
  group: boolean
  at: Date
  type: MessageType
  text: string | null
  media: { mime: string | null; fileName: string | null; size: number | null } | null
  /** Resposta (citação) a outra mensagem: id dela no WhatsApp e o trecho citado. */
  quoted?: { waId: string; text: string } | null
  /** Mensagem crua (chave + conteúdo) para pedir a mídia à Evolution. */
  raw: { key: unknown; message: unknown }
}

type Obj = Record<string, unknown>

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage']

const str = (v: unknown, n = 4096) => (typeof v === 'string' && v.trim() ? v.slice(0, n) : null)

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  if (v && typeof v === 'object' && 'low' in v) return Number((v as { low: unknown }).low)
  return null
}

/** Tira as "embalagens" (mensagem temporária, de visualização única, documento com legenda...). */
function unwrap(m: Obj | null | undefined): Obj | null {
  let cur: Obj | null = m ?? null
  for (let i = 0; i < 4 && cur; i++) {
    const c: Obj = cur
    const w = WRAPPERS.find((k) => c[k] && typeof c[k] === 'object')
    if (!w) break
    cur = ((c[w] as { message?: Obj }).message ?? null) as Obj | null
  }
  return cur
}

/**
 * Lê uma mensagem do evento da Evolution. Devolve null para o que não é conversa:
 * status, canais, reações e avisos do sistema (mensagem apagada, chaves de criptografia). Grupos vêm com group = true.
 */
export function parseMessage(data: unknown): ParsedMessage | null {
  const d = data as { key?: Obj; message?: Obj; pushName?: unknown; messageTimestamp?: unknown } | null
  const key = d?.key
  if (!key || typeof key.id !== 'string') return null
  const remote = str(key.remoteJid, 120)
  if (!remote || remote.endsWith('@broadcast') || remote.endsWith('@newsletter')) return null
  const group = remote.endsWith('@g.us')
  // Número escondido (LID): a Evolution manda o telefone em remoteJidAlt / senderPn, quando o WhatsApp informa.
  const alt = group ? null : ([key.remoteJidAlt, key.senderPn, key.participantAlt].map((v) => str(v, 120)).find((v) => !!v && v.endsWith('@s.whatsapp.net')) ?? null)
  const jid = remote.endsWith('@lid') && alt ? alt : remote
  // Num grupo o telefone é o de cada participante, não da conversa: a conversa é o grupo.
  const phoneDigits = group ? null : (/^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid)?.[1] ?? null)
  const m = unwrap(d.message)
  if (!m) return null
  const ts = num(d.messageTimestamp)
  const fromMe = key.fromMe === true
  const base = {
    waId: key.id.slice(0, 120),
    fromMe,
    jid: phoneDigits ? `${phoneDigits}@s.whatsapp.net` : jid,
    phoneDigits,
    pushName: fromMe ? null : str(d.pushName, 120),
    group,
    at: ts ? new Date(ts * 1000) : new Date(),
    raw: { key, message: d.message },
    quoted: quotedOf(m),
  }
  const media = (o: Obj, fileName?: unknown) => ({ mime: str(o.mimetype, 120)?.split(';')[0]?.trim() || null, fileName: str(fileName, 200), size: num(o.fileLength) })
  const o = (k: string) => (m[k] && typeof m[k] === 'object' ? (m[k] as Obj) : null)

  if (str(m.conversation)) return { ...base, type: 'texto', text: str(m.conversation), media: null }
  const ext = o('extendedTextMessage')
  if (ext) return { ...base, type: 'texto', text: str(ext.text), media: null }
  const img = o('imageMessage')
  if (img) return { ...base, type: 'imagem', text: str(img.caption), media: media(img) }
  const vid = o('videoMessage')
  if (vid) return { ...base, type: 'video', text: str(vid.caption), media: media(vid) }
  const aud = o('audioMessage')
  if (aud) return { ...base, type: 'audio', text: null, media: media(aud) }
  const doc = o('documentMessage')
  if (doc) return { ...base, type: 'documento', text: str(doc.caption), media: media(doc, doc.fileName ?? doc.title) }
  const stk = o('stickerMessage')
  if (stk) return { ...base, type: 'figurinha', text: null, media: media(stk) }
  const loc = o('locationMessage') ?? o('liveLocationMessage')
  if (loc) {
    const lat = Number(loc.degreesLatitude)
    const lng = Number(loc.degreesLongitude)
    const where = [str(loc.name, 200), str(loc.address, 300)].filter(Boolean).join(' · ')
    const coords = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : ''
    return { ...base, type: 'localizacao', text: [where, coords].filter(Boolean).join(' · ') || 'Localização', media: null }
  }
  const ctt = o('contactMessage')
  if (ctt) return { ...base, type: 'contato', text: contactLine(ctt), media: null }
  const many = o('contactsArrayMessage')
  if (many) {
    const list = (Array.isArray(many.contacts) ? (many.contacts as Obj[]) : []).slice(0, 10).map(contactLine)
    return { ...base, type: 'contato', text: list.join('\n') || str(many.displayName, 200) || 'Contato', media: null }
  }
  const poll = o('pollCreationMessage') ?? o('pollCreationMessageV3')
  if (poll) return { ...base, type: 'outro', text: `Enquete: ${str(poll.name, 300) ?? ''}`, media: null }
  // Reações, avisos do sistema e chaves de criptografia não viram mensagem na conversa.
  const keys = Object.keys(m).filter((k) => k !== 'messageContextInfo')
  if (!keys.length || keys.some((k) => ['reactionMessage', 'protocolMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'keepInChatMessage'].includes(k))) return null
  return { ...base, type: 'outro', text: 'Mensagem de um tipo que o CRM ainda não mostra (veja no celular).', media: null }
}

/** "Nome · +55 47 99999-0000" a partir do cartão (vCard) que veio na mensagem. */
function contactLine(c: Obj) {
  const name = str(c.displayName, 120)
  const vcard = str(c.vcard, 8000) ?? ''
  const waid = /waid=(\d{8,15})/i.exec(vcard)?.[1]
  const tel = waid ? `+${waid}` : (/\nTEL[^:\n]*:([^\n]+)/i.exec(vcard)?.[1]?.trim() ?? null)
  return [name ?? 'Contato', tel].filter(Boolean).join(' · ').slice(0, 200)
}

/** Trecho curto de uma mensagem citada (resposta), pelo tipo. */
function quotedPreview(q: Obj | null): string {
  if (!q) return 'Mensagem'
  const inner = unwrap(q) ?? q
  const o = (k: string) => (inner[k] && typeof inner[k] === 'object' ? (inner[k] as Obj) : null)
  const t = str(inner.conversation, 300) ?? str(o('extendedTextMessage')?.text, 300)
  if (t) return t
  if (o('imageMessage')) return `Foto${str(o('imageMessage')!.caption, 200) ? `: ${str(o('imageMessage')!.caption, 200)}` : ''}`
  if (o('videoMessage')) return 'Vídeo'
  if (o('audioMessage')) return 'Áudio'
  if (o('documentMessage')) return `Documento${str(o('documentMessage')!.fileName, 120) ? `: ${str(o('documentMessage')!.fileName, 120)}` : ''}`
  if (o('stickerMessage')) return 'Figurinha'
  if (o('contactMessage')) return `Contato: ${str(o('contactMessage')!.displayName, 120) ?? ''}`
  if (o('locationMessage')) return 'Localização'
  return 'Mensagem'
}

/** A mensagem é resposta a outra? (contextInfo.stanzaId e o trecho de quotedMessage). */
function quotedOf(m: Obj): { waId: string; text: string } | null {
  for (const v of Object.values(m)) {
    const ctx = v && typeof v === 'object' ? ((v as Obj).contextInfo as Obj | undefined) : undefined
    const id = str(ctx?.stanzaId, 120)
    if (id) return { waId: id, text: quotedPreview((ctx!.quotedMessage as Obj | undefined) ?? null).slice(0, 300) }
  }
  return null
}

export interface ParsedReaction {
  /** Mensagem que recebeu a reação (id no WhatsApp). */
  targetWaId: string
  /** Emoji; vazio = a pessoa tirou a reação. */
  emoji: string
  fromMe: boolean
  /** Quem reagiu (participante, no grupo; o contato, na conversa). */
  reactor: string
  name: string | null
}

/** Reação de uma mensagem (evento MESSAGES_UPSERT com reactionMessage). */
export function parseReaction(data: unknown): ParsedReaction | null {
  const d = data as { key?: Obj; message?: Obj; pushName?: unknown } | null
  const r = d?.message?.reactionMessage as { key?: Obj; text?: unknown } | undefined
  const target = str(r?.key?.id, 120)
  if (!d?.key || !r || !target) return null
  const fromMe = d.key.fromMe === true
  return { targetWaId: target, emoji: typeof r.text === 'string' ? r.text.slice(0, 16) : '', fromMe, reactor: fromMe ? 'me' : (str(d.key.participant, 120) ?? str(d.key.remoteJid, 120) ?? 'contato'), name: fromMe ? null : str(d.pushName, 120) }
}

export interface Reaction {
  emoji: string
  by: 'me' | 'them'
  key: string
  name: string | null
}

/** Lista de reações depois de uma nova: uma por pessoa (troca a anterior); emoji vazio tira. */
export function withReaction(list: unknown, r: { emoji: string; by: 'me' | 'them'; key: string; name: string | null }): Reaction[] {
  const cur = (Array.isArray(list) ? list : []).filter((x): x is Reaction => !!x && typeof (x as Reaction).emoji === 'string' && typeof (x as Reaction).key === 'string')
  const rest = cur.filter((x) => x.key !== r.key)
  return (r.emoji ? [...rest, { emoji: r.emoji, by: r.by, key: r.key, name: r.name }] : rest).slice(-20)
}

/** Telefone do contato no formato da base (+55...). No Brasil, celular sem o 9 (contas antigas) ganha o 9. */
export function phoneFromDigits(d: string | null): string | null {
  if (!d) return null
  const br = /^55(\d{2})(\d{8})$/.exec(d)
  if (br && /[6-9]/.test(br[2]!.charAt(0))) return `+55${br[1]}9${br[2]}`
  return /^\d{10,15}$/.test(d) ? `+${d}` : null
}

/** As duas formas de um celular brasileiro (com e sem o 9), para achar o lead já cadastrado. */
export function phoneVariants(e164: string | null): string[] {
  if (!e164) return []
  const m = /^\+55(\d{2})9(\d{8})$/.exec(e164)
  return m ? [e164, `+55${m[1]}${m[2]}`] : [e164]
}

const LABEL: Record<MessageType, string> = { texto: '', imagem: 'Foto', audio: 'Áudio', video: 'Vídeo', documento: 'Documento', figurinha: 'Figurinha', localizacao: 'Localização', contato: 'Contato', chamada: '', outro: '' }

/** Texto curto para a lista de conversas. */
export function previewOf(p: Pick<ParsedMessage, 'type' | 'text'>) {
  const t = (p.text ?? '').replace(/\s+/g, ' ').trim()
  const label = LABEL[p.type]
  return (label ? (t ? `${label}: ${t}` : label) : t || 'Mensagem').slice(0, 140)
}

/** Mídia guardada: até 16 MB (limite do WhatsApp para fotos e vídeos). Documento maior fica só no celular. */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024

/** Tipos que o navegador pode abrir direto; o resto vai como download (nunca HTML/SVG/script na tela). */
export const INLINE_MIME = new Set(['audio/webm', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'video/mp4', 'video/3gpp', 'application/pdf'])

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'audio/webm': 'webm', 'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
}
export const extOf = (mime: string | null) => (mime && EXT[mime]) || 'bin'

// ---------- Ligações recebidas (evento CALL) ----------

export interface ParsedCall {
  callId: string
  jid: string
  phoneDigits: string | null
  isVideo: boolean
  at: Date
}

/**
 * Ligação que o cliente fez para o número da empresa. O CRM não atende (o WhatsApp não libera o áudio para aparelhos
 * vinculados): só avisa no chat, para ninguém perder a chamada. Só o primeiro aviso de cada ligação ("offer").
 */
export function parseCalls(data: unknown): ParsedCall[] {
  const list = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[]
  const out: ParsedCall[] = []
  for (const c of list.slice(0, 10)) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue
    if (c.status && c.status !== 'offer') continue
    if (c.isGroup === true) continue
    const from = [c.from, c.chatId].find((v) => typeof v === 'string' && v.endsWith('@s.whatsapp.net')) as string | undefined
    const lid = [c.from, c.chatId].find((v) => typeof v === 'string' && v.endsWith('@lid')) as string | undefined
    const jid = from ?? lid
    if (!jid) continue
    const digits = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid)?.[1] ?? null
    const ts = c.date instanceof Date ? c.date.getTime() : typeof c.date === 'string' || typeof c.date === 'number' ? new Date(c.date).getTime() : NaN
    out.push({ callId: c.id.slice(0, 100), jid: digits ? `${digits}@s.whatsapp.net` : jid, phoneDigits: digits, isVideo: c.isVideo === true, at: Number.isFinite(ts) ? new Date(ts) : new Date() })
  }
  return out
}
