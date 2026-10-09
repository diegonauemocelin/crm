/** Leitura das mensagens que a Evolution manda (evento MESSAGES_UPSERT), sem depender do banco. */

export type MessageType = 'texto' | 'imagem' | 'audio' | 'video' | 'documento' | 'figurinha' | 'localizacao' | 'contato' | 'outro'

export interface ParsedMessage {
  waId: string
  fromMe: boolean
  /** Identificador do contato na conversa (telefone@s.whatsapp.net, ou @lid quando o WhatsApp esconde o número). */
  jid: string
  /** Dígitos do telefone (com DDI), quando se sabe. */
  phoneDigits: string | null
  pushName: string | null
  at: Date
  type: MessageType
  text: string | null
  media: { mime: string | null; fileName: string | null; size: number | null } | null
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
 * Lê uma mensagem do evento da Evolution. Devolve null para o que não é conversa com cliente:
 * grupos, status, canais, reações e avisos do sistema (mensagem apagada, chaves de criptografia).
 */
export function parseMessage(data: unknown): ParsedMessage | null {
  const d = data as { key?: Obj; message?: Obj; pushName?: unknown; messageTimestamp?: unknown } | null
  const key = d?.key
  if (!key || typeof key.id !== 'string') return null
  const remote = str(key.remoteJid, 120)
  if (!remote || remote.endsWith('@g.us') || remote.endsWith('@broadcast') || remote.endsWith('@newsletter')) return null
  // Número escondido (LID): a Evolution manda o telefone em remoteJidAlt / senderPn, quando o WhatsApp informa.
  const alt = [key.remoteJidAlt, key.senderPn, key.participantAlt].map((v) => str(v, 120)).find((v) => !!v && v.endsWith('@s.whatsapp.net')) ?? null
  const jid = remote.endsWith('@lid') && alt ? alt : remote
  const phoneDigits = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid)?.[1] ?? null
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
    at: ts ? new Date(ts * 1000) : new Date(),
    raw: { key, message: d.message },
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
  const ctt = o('contactMessage') ?? o('contactsArrayMessage')
  if (ctt) return { ...base, type: 'contato', text: str(ctt.displayName, 200) ?? 'Contato', media: null }
  const poll = o('pollCreationMessage') ?? o('pollCreationMessageV3')
  if (poll) return { ...base, type: 'outro', text: `Enquete: ${str(poll.name, 300) ?? ''}`, media: null }
  // Reações, avisos do sistema e chaves de criptografia não viram mensagem na conversa.
  const keys = Object.keys(m).filter((k) => k !== 'messageContextInfo')
  if (!keys.length || keys.some((k) => ['reactionMessage', 'protocolMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'keepInChatMessage'].includes(k))) return null
  return { ...base, type: 'outro', text: 'Mensagem de um tipo que o CRM ainda não mostra (veja no celular).', media: null }
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

const LABEL: Record<MessageType, string> = { texto: '', imagem: 'Foto', audio: 'Áudio', video: 'Vídeo', documento: 'Documento', figurinha: 'Figurinha', localizacao: 'Localização', contato: 'Contato', outro: '' }

/** Texto curto para a lista de conversas. */
export function previewOf(p: Pick<ParsedMessage, 'type' | 'text'>) {
  const t = (p.text ?? '').replace(/\s+/g, ' ').trim()
  const label = LABEL[p.type]
  return (label ? (t ? `${label}: ${t}` : label) : t || 'Mensagem').slice(0, 140)
}

/** Mídia guardada: até 16 MB (limite do WhatsApp para fotos e vídeos). Documento maior fica só no celular. */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024

/** Tipos que o navegador pode abrir direto; o resto vai como download (nunca HTML/SVG/script na tela). */
export const INLINE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'video/mp4', 'video/3gpp', 'application/pdf'])

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
}
export const extOf = (mime: string | null) => (mime && EXT[mime]) || 'bin'
