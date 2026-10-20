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
  const d = data as { key?: Obj; message?: Obj; pushName?: unknown; messageTimestamp?: unknown; contextInfo?: unknown } | null
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
    quoted: quotedOf(m, d.contextInfo),
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
  // Menu de robô (botões, lista, mensagem interativa): o texto e as opções numeradas, para escolher pelo chat.
  const menu = menuOf(m)
  if (menu) return { ...base, type: 'texto', text: menu, media: null }
  // Resposta a um menu (tocada no celular): o texto da opção escolhida.
  const picked = pickedOption(m)
  if (picked) return { ...base, type: 'texto', text: picked, media: null }
  const poll = o('pollCreationMessage') ?? o('pollCreationMessageV3')
  if (poll) return { ...base, type: 'outro', text: `Enquete: ${str(poll.name, 300) ?? ''}`, media: null }
  // Reações, avisos do sistema e chaves de criptografia não viram mensagem na conversa.
  const keys = Object.keys(m).filter((k) => k !== 'messageContextInfo')
  if (!keys.length || keys.some((k) => ['reactionMessage', 'protocolMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'keepInChatMessage'].includes(k))) return null
  const found = anyText(m)
  if (found) return { ...base, type: 'texto', text: found, media: null }
  return { ...base, type: 'outro', text: 'Mensagem de um tipo que o CRM ainda não mostra (veja no celular).', media: null }
}

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Obj) : null)

/** Texto do menu com as opções numeradas ("1 Marketing"), como o chat mostra e o cliente vê no celular. */
function menuText(body: string | null, options: string[]) {
  const opts = options.map((t) => t.trim()).filter(Boolean).slice(0, 30)
  if (!opts.length) return null
  return [body?.trim() || 'Escolha uma opção:', ...opts.map((t, i) => `${i + 1} ${t.slice(0, 80)}`)].join('\n').slice(0, 4000)
}

/** Botões, lista ou mensagem interativa (WhatsApp Business / robôs): o texto e as opções. */
function menuOf(m: Obj): string | null {
  const btn = obj(m.buttonsMessage)
  if (btn) return menuText(str(btn.contentText) ?? str(btn.text), (Array.isArray(btn.buttons) ? btn.buttons : []).map((b) => str(obj(obj(b)?.buttonText)?.displayText, 120) ?? ''))
  const list = obj(m.listMessage)
  if (list) {
    const rows = (Array.isArray(list.sections) ? list.sections : []).flatMap((sec) => (Array.isArray(obj(sec)?.rows) ? (obj(sec)!.rows as unknown[]) : []))
    return menuText([str(list.title, 300), str(list.description)].filter(Boolean).join('\n') || null, rows.map((r) => str(obj(r)?.title, 120) ?? ''))
  }
  const tm = obj(m.templateMessage)
  // Modelo com mensagem interativa dentro: lê como a interativa.
  const tplInter = obj(tm?.interactiveMessageTemplate)
  if (tplInter) return menuOf({ interactiveMessage: tplInter })
  const tpl = obj(tm?.hydratedTemplate) ?? obj(tm?.hydratedFourRowTemplate) ?? obj(tm?.fourRowTemplate)
  if (tpl) {
    const buttons = Array.isArray(tpl.hydratedButtons) ? tpl.hydratedButtons : []
    const label = (b: unknown) => str(obj(obj(b)?.quickReplyButton)?.displayText, 120) ?? str(obj(obj(b)?.urlButton)?.displayText, 120) ?? str(obj(obj(b)?.callButton)?.displayText, 120) ?? ''
    return menuText(str(tpl.hydratedContentText) ?? str(obj(tpl.content)?.namespace), buttons.map(label)) ?? str(tpl.hydratedContentText)
  }
  const inter = obj(m.interactiveMessage)
  if (inter) {
    const body = [str(obj(inter.header)?.title, 300), str(obj(inter.body)?.text)].filter(Boolean).join('\n') || null
    const flow = obj(inter.nativeFlowMessage)
    const options: string[] = []
    for (const b of Array.isArray(flow?.buttons) ? (flow!.buttons as unknown[]) : []) {
      let params: Obj = {}
      try {
        params = JSON.parse(str(obj(b)?.buttonParamsJson, 20_000) ?? '{}') as Obj
      } catch {
        /* botão sem parâmetros legíveis */
      }
      const rows = (Array.isArray(params.sections) ? params.sections : []).flatMap((sec) => (Array.isArray(obj(sec)?.rows) ? (obj(sec)!.rows as unknown[]) : []))
      if (rows.length) options.push(...rows.map((r) => str(obj(r)?.title, 120) ?? ''))
      else if (str(params.display_text, 120) && obj(b)?.name === 'quick_reply') options.push(str(params.display_text, 120)!)
    }
    return menuText(body, options) ?? body
  }
  return null
}

/** Resposta de botão de fluxo (paramsJson com o texto ou o id da opção). */
function nativeReply(r: Obj | null): string | null {
  if (!r) return null
  try {
    const p = JSON.parse(str(r.paramsJson, 20_000) ?? '{}') as Obj
    return str(p.display_text, 300) ?? str(p.title, 300) ?? str(p.id, 300)
  } catch {
    return null
  }
}

/**
 * Último recurso para mensagem de um tipo novo: junta o texto e os nomes dos botões que vierem dentro dela, em vez de
 * mostrar só "tipo que o CRM ainda não mostra".
 */
function anyText(m: Obj): string | null {
  const texts: string[] = []
  const buttons: string[] = []
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || texts.length + buttons.length > 40) return
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1))
    const o = obj(v)
    if (!o) return
    for (const [k, x] of Object.entries(o)) {
      if (k === 'contextInfo' || k === 'messageContextInfo' || k === 'jpegThumbnail') continue
      if (typeof x === 'string' && x.trim()) {
        if (['displayText', 'display_text', 'selectedDisplayText'].includes(k)) buttons.push(x.trim())
        else if (['text', 'contentText', 'conversation', 'caption', 'description', 'hydratedContentText', 'footerText', 'title'].includes(k)) texts.push(x.trim())
        else if (k === 'buttonParamsJson' || k === 'paramsJson') {
          try {
            walk(JSON.parse(x), depth + 1)
          } catch {
            /* não é JSON */
          }
        }
      } else walk(x, depth + 1)
    }
  }
  walk(m, 0)
  const body = [...new Set(texts)].join('\n').slice(0, 3000)
  return menuText(body || null, [...new Set(buttons)]) ?? (body || null)
}

/** Opção tocada num menu (resposta de botão ou de lista). */
function pickedOption(m: Obj): string | null {
  return (
    str(obj(m.buttonsResponseMessage)?.selectedDisplayText, 300) ??
    str(obj(m.listResponseMessage)?.title, 300) ??
    str(obj(m.templateButtonReplyMessage)?.selectedDisplayText, 300) ??
    str(obj(obj(m.interactiveResponseMessage)?.body)?.text, 300) ??
    nativeReply(obj(obj(m.interactiveResponseMessage)?.nativeFlowResponseMessage)) ??
    null
  )
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
  // Menu de robô (botões, lista): o texto dele.
  return (menuOf(inner) ?? anyText(inner) ?? 'Mensagem').slice(0, 300)
}

/** Citação a partir do contextInfo: stanzaId é a mensagem respondida e quotedMessage, o trecho dela. */
function quotedFrom(ctx: unknown): { waId: string; text: string } | null {
  const c = ctx && typeof ctx === 'object' ? (ctx as Obj) : null
  const id = str(c?.stanzaId, 120)
  return id ? { waId: id, text: quotedPreview((c!.quotedMessage as Obj | undefined) ?? null).slice(0, 300) } : null
}

/**
 * A mensagem é resposta a outra? O contextInfo vem dentro do conteúdo (imageMessage, extendedTextMessage...) ou no
 * nível de cima do evento: a Evolution v2 transforma a resposta de texto em "conversation" e leva o contextInfo para fora.
 */
function quotedOf(m: Obj, top: unknown): { waId: string; text: string } | null {
  for (const v of Object.values(m)) {
    const q = v && typeof v === 'object' ? quotedFrom((v as Obj).contextInfo) : null
    if (q) return q
  }
  return quotedFrom(top)
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

export interface ParsedRevision {
  /** Mensagem alterada (id no WhatsApp). */
  targetWaId: string
  /** Apagada para todos ou editada (com o texto novo). */
  kind: 'apagada' | 'editada'
  text: string | null
}

/**
 * Mensagem apagada para todos ou editada, pelo cliente ou pelo celular da empresa (evento MESSAGES_UPSERT com
 * protocolMessage: REVOKE = 0, MESSAGE_EDIT = 14).
 */
export function parseRevision(data: unknown): ParsedRevision | null {
  const d = data as { key?: Obj; message?: Obj } | null
  const p = unwrap(d?.message)?.protocolMessage as { key?: Obj; type?: unknown; editedMessage?: Obj } | undefined
  const target = str(p?.key?.id, 120)
  if (!d?.key || !p || !target) return null
  if (p.type === 'REVOKE' || p.type === 0) return { targetWaId: target, kind: 'apagada', text: null }
  if (p.type === 'MESSAGE_EDIT' || p.type === 14) {
    const m = unwrap(p.editedMessage)
    const ext = m?.extendedTextMessage as Obj | undefined
    const media = ['imageMessage', 'videoMessage', 'documentMessage'].map((k) => m?.[k] as Obj | undefined).find((x) => !!x)
    const text = str(m?.conversation) ?? str(ext?.text) ?? str(media?.caption)
    return text ? { targetWaId: target, kind: 'editada', text } : null
  }
  return null
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

/** +5549988632548 → (49) 98863-2548; número estrangeiro fica como está. */
export function phoneLabel(e164: string) {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

/**
 * Resultado da conferência no WhatsApp (o celular vai nas duas formas, com e sem o 9): tem conta em alguma delas →
 * o identificador dela; nenhuma → não tem WhatsApp; resposta vazia → não deu para saber (null).
 */
export function whatsappOf(checks: { number: string; exists: boolean; jid: string | null }[]): { exists: boolean; jid: string | null } | null {
  if (!checks.length) return null
  const hit = checks.find((c) => c.exists)
  if (!hit) return { exists: false, jid: null }
  return { exists: true, jid: hit.jid ?? (/^\d{8,15}$/.test(hit.number) ? `${hit.number}@s.whatsapp.net` : null) }
}

const LABEL: Record<MessageType, string> = { texto: '', imagem: 'Foto', audio: 'Áudio', video: 'Vídeo', documento: 'Documento', figurinha: 'Figurinha', localizacao: 'Localização', contato: 'Contato', chamada: '', outro: '' }

/** Texto curto para a lista de conversas. */
export function previewOf(p: Pick<ParsedMessage, 'type' | 'text'>) {
  const t = (p.text ?? '').replace(/\s+/g, ' ').trim()
  const label = LABEL[p.type]
  return (label ? (t ? `${label}: ${t}` : label) : t || 'Mensagem').slice(0, 140)
}

/** Mídia guardada: até 16 MB (limite do WhatsApp para fotos e vídeos). Documento maior fica só no celular. */
/** Maior arquivo enviado ou baixado pelo chat (o WhatsApp aceita documentos bem maiores; o limite protege a memória do servidor). */
export const MEDIA_MAX_BYTES = 64 * 1024 * 1024
/** Foto e vídeo acima disto vão como documento (o WhatsApp não manda mídia maior como foto/vídeo). */
export const INLINE_MEDIA_MAX_BYTES = 16 * 1024 * 1024

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
