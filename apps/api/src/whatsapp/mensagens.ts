/** Leitura das mensagens que a Evolution manda (evento MESSAGES_UPSERT), sem depender do banco. */
import { createDecipheriv, hkdfSync } from 'node:crypto'

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
  /** Identificador escondido (@lid) do contato, quando a mensagem veio por ele com o telefone junto. */
  lid?: string | null
  /** Mensagem crua (chave + conteúdo) para pedir a mídia à Evolution. */
  raw: { key: unknown; message: unknown }
  /** Chave da mensagem (messageSecret, em base64): abre as edições que o WhatsApp manda criptografadas. */
  secret?: string | null
}

type Obj = Record<string, unknown>

export const UNKNOWN_TEXT = 'Mensagem de um tipo que o CRM ainda não mostra (veja no celular).'

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
    lid: remote.endsWith('@lid') && phoneDigits ? remote : null,
    phoneDigits,
    pushName: fromMe ? null : str(d.pushName, 120),
    group,
    at: ts ? new Date(ts * 1000) : new Date(),
    raw: { key, message: d.message },
    quoted: quotedOf(m, d.contextInfo),
    secret: bytesOf(obj(obj(d.message)?.messageContextInfo)?.messageSecret)?.toString('base64') ?? null,
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
  if (!keys.length || keys.some((k) => ['reactionMessage', 'protocolMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'keepInChatMessage', 'secretEncryptedMessage'].includes(k))) return null
  const found = anyText(m)
  if (found) return { ...base, type: 'texto', text: found, media: null }
  return { ...base, type: 'outro', text: UNKNOWN_TEXT, media: null }
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
  if (!d?.key) return null
  return revisionOf(unwrap(d.message)?.protocolMessage)
}

/** protocolMessage de edição ou de "apagar para todos": a chave é a da mensagem original. */
function revisionOf(raw: unknown): ParsedRevision | null {
  const p = obj(raw) as { key?: Obj; type?: unknown; editedMessage?: Obj } | null
  const target = str(p?.key?.id, 120)
  if (!p || !target) return null
  if (p.type === 'REVOKE' || p.type === 0) return { targetWaId: target, kind: 'apagada', text: null }
  if (p.type === 'MESSAGE_EDIT' || p.type === 14) {
    const text = editedText(p.editedMessage)
    return text ? { targetWaId: target, kind: 'editada', text } : null
  }
  return null
}

function editedText(raw: unknown): string | null {
  const m = unwrap(obj(raw))
  const ext = m?.extendedTextMessage as Obj | undefined
  const media = ['imageMessage', 'videoMessage', 'documentMessage'].map((k) => m?.[k] as Obj | undefined).find((x) => !!x)
  return str(m?.conversation) ?? str(ext?.text) ?? str(media?.caption)
}

/**
 * Evolution 2.3: edição e "apagar para todos" não chegam como mensagem. A edição vem no evento MESSAGES_EDITED
 * (o próprio protocolMessage) e também no MESSAGES_UPDATE (keyId + message.editedMessage); a exclusão vem no
 * MESSAGES_DELETE (a chave da mensagem apagada).
 */
export function parseRevisionEvent(event: string, data: unknown): ParsedRevision[] {
  const out: ParsedRevision[] = []
  for (const raw of (Array.isArray(data) ? data : [data]).slice(0, 50)) {
    const d = obj(raw)
    if (!d) continue
    if (event === 'messages.edited') {
      const r = revisionOf(d.protocolMessage ?? d)
      if (r) out.push(r)
    } else if (event === 'messages.delete') {
      const id = str(d.id, 120) ?? str(obj(d.key)?.id, 120) ?? str(d.keyId, 120)
      if (id) out.push({ targetWaId: id, kind: 'apagada', text: null })
    } else if (event === 'messages.update') {
      const id = str(d.keyId, 120) ?? str(obj(d.key)?.id, 120)
      const edited = obj(obj(d.message)?.editedMessage) ?? obj(obj(obj(d.update)?.message)?.editedMessage)
      // Edição embalada num protocolMessage (formato antigo) ou o conteúdo novo direto.
      const inner = obj(edited?.message)
      const r = inner?.protocolMessage ? revisionOf(inner.protocolMessage) : null
      const text = r ? null : editedText(inner ?? edited)
      if (r) out.push(r)
      else if (id && text) out.push({ targetWaId: id, kind: 'editada', text })
    }
  }
  return out
}

/** Chaves de uma mensagem que o CRM não soube ler (para o registro do servidor; sem o conteúdo). */
export function unknownKeys(data: unknown): string {
  const m = obj(obj(data)?.message)
  return m ? Object.keys(m).slice(0, 10).join(', ') : '(sem conteúdo)'
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

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/webm': 'webm',
  'application/pdf': 'pdf',
}

/**
 * Nome do arquivo ao baixar a mídia: foto, vídeo e áudio chegam sem nome, então ganham um nome com a extensão
 * do tipo (ex.: foto-20261020-1745.jpg), para o computador abrir com o programa certo. Nome sem extensão também ganha.
 */
export function mediaFileName(fileName: string | null | undefined, mime: string, sentAt?: Date | null) {
  const type = mime.split(';')[0]!.trim().toLowerCase()
  const ext = MIME_EXT[type]
  const kind = type.startsWith('image/') ? 'foto' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'arquivo'
  const stamp = sentAt ? new Date(sentAt.getTime() - 3 * 3_600_000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-') : ''
  const name = (fileName ?? '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '_').trim().slice(0, 120) || (stamp ? `${kind}-${stamp}` : kind)
  return ext && !/\.[a-z0-9]{2,5}$/i.test(name) ? `${name}.${ext}` : name
}

/** Content-Disposition com o nome em ASCII (navegadores antigos) e em UTF-8 (acentos). */
export function contentDisposition(name: string, inline: boolean) {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\- ]+/g, '_')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

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
    // Número escondido (LID): a Evolution 2.3 manda o telefone de quem ligou em callerPn.
    const pn = [c.callerPn, c.fromPn, c.chatIdPn].find((v) => typeof v === 'string' && v.endsWith('@s.whatsapp.net')) as string | undefined
    const jid = from ?? pn ?? lid
    if (!jid) continue
    const digits = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid)?.[1] ?? null
    const ts = c.date instanceof Date ? c.date.getTime() : typeof c.date === 'string' || typeof c.date === 'number' ? new Date(c.date).getTime() : NaN
    out.push({ callId: c.id.slice(0, 100), jid: digits ? `${digits}@s.whatsapp.net` : jid, phoneDigits: digits, isVideo: c.isVideo === true, at: Number.isFinite(ts) ? new Date(ts) : new Date() })
  }
  return out
}

// ---------- Edição criptografada (secretEncryptedMessage) ----------

/**
 * Bytes vindos no JSON da Evolution: base64, hexadecimal, { type: 'Buffer', data: [...] }, o BufferJSON do Baileys
 * ({ type: 'Buffer', data: 'base64' }) ou { "0": 12, "1": 34, ... }.
 */
export function bytesOf(v: unknown): Buffer | null {
  if (typeof v === 'string') {
    if (!v) return null
    // 32 bytes em hexadecimal (64 caracteres) também passariam como base64, com o tamanho errado.
    if (/^[0-9a-f]+$/i.test(v) && v.length % 2 === 0 && v.length >= 32) return Buffer.from(v, 'hex')
    return Buffer.from(v, 'base64')
  }
  const o = obj(v)
  if (!o) return null
  if (Array.isArray(o.data)) return Buffer.from(o.data as number[])
  if (typeof o.data === 'string') return bytesOf(o.data)
  const keys = Object.keys(o)
  if (!keys.length || !keys.every((k) => /^\d+$/.test(k))) return null
  return Buffer.from(keys.sort((a, b) => Number(a) - Number(b)).map((k) => Number(o[k]) & 0xff))
}

export interface ParsedSecretEdit {
  /** Mensagem editada (id no WhatsApp). */
  targetWaId: string
  fromMe: boolean
  encPayload: Buffer
  encIv: Buffer
  /** Quem editou (e escreveu a original): as formas do contato que vieram no evento (telefone e @lid). */
  senders: string[]
}

/**
 * Edição que o WhatsApp novo manda criptografada (secretEncryptedMessage, MESSAGE_EDIT). Só abre com a chave da
 * mensagem original (messageSecret), que o CRM guarda quando a mensagem chega.
 */
export function parseSecretEdit(data: unknown): ParsedSecretEdit | null {
  const d = obj(data)
  const key = obj(d?.key)
  const sem = obj(unwrap(obj(d?.message))?.secretEncryptedMessage)
  if (!key || !sem) return null
  const type = sem.secretEncType
  if (type !== undefined && type !== 2 && type !== 'MESSAGE_EDIT') return null
  const target = str(obj(sem.targetMessageKey)?.id, 120)
  const encPayload = bytesOf(sem.encPayload)
  const encIv = bytesOf(sem.encIv ?? sem.encIV)
  if (!target || !encPayload || !encIv || encPayload.length < 17) return null
  const senders = [key.participant, key.participantAlt, key.remoteJid, key.remoteJidAlt, key.senderPn, key.senderLid].map((v) => str(v, 120)).filter((v): v is string => !!v && !v.endsWith('@g.us'))
  return { targetWaId: target, fromMe: key.fromMe === true, encPayload, encIv, senders: [...new Set(senders)] }
}

/** JID sem o aparelho ("5511999999999:12@s.whatsapp.net" → "5511999999999@s.whatsapp.net"). */
const plainJid = (j: string) => j.replace(/:\d+@/, '@')

/**
 * Abre a edição: chave = HKDF-SHA256(messageSecret, info = id da original + quem escreveu + quem editou + tipo),
 * AES-256-GCM com o IV do evento (o mesmo esquema dos votos de enquete do WhatsApp). Tenta as formas do contato
 * (telefone e @lid); a autenticação do GCM garante que só a combinação certa abre. Devolve o texto novo ou null.
 */
export function decryptSecretEdit(secretB64: string, targetWaId: string, senders: string[], encPayload: Buffer, encIv: Buffer): string | null {
  return openSecretEdit(secretB64, targetWaId, senders, encPayload, encIv).text
}

/** Resultado da abertura, com o motivo quando não abre (para o registro do servidor; sem conteúdo nem chave). */
export interface SecretEditResult {
  text: string | null
  /** A autenticação do AES-GCM passou com alguma combinação (a chave e os remetentes estavam certos). */
  opened: boolean
  reason: string
}

export function openSecretEdit(secretB64: string, targetWaId: string, senders: string[], encPayload: Buffer, encIv: Buffer): SecretEditResult {
  const secret = Buffer.from(secretB64, 'base64')
  const shape = `chave ${secret.length} bytes, iv ${encIv.length}, dados ${encPayload.length}, remetentes ${senders.map(maskJid).join(' ') || '(nenhum)'}`
  if (secret.length !== 32) return { text: null, opened: false, reason: `chave da original com tamanho errado (${shape})` }
  const jids = [...new Set(senders.map(plainJid))]
  const data = encPayload.subarray(0, encPayload.length - 16)
  const tag = encPayload.subarray(encPayload.length - 16)
  for (const kind of ['Message Edit', 'Edit Message']) {
    for (const orig of jids) {
      for (const editor of jids) {
        const info = Buffer.from(`${targetWaId}${orig}${editor}${kind}`)
        const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(32), info, 32))
        for (const aad of [null, Buffer.from(`${targetWaId}\u0000${editor}`)]) {
          try {
            const d = createDecipheriv('aes-256-gcm', key, encIv)
            if (aad) d.setAAD(aad)
            d.setAuthTag(tag)
            const plain = Buffer.concat([d.update(data), d.final()])
            const text = protoMessageText(plain)
            return text ? { text, opened: true, reason: 'ok' } : { text: null, opened: true, reason: `abriu, mas o texto não foi achado (campos ${protoShape(plain)})` }
          } catch {
            // Combinação errada: a autenticação do GCM falha; tenta a próxima.
          }
        }
      }
    }
  }
  return { text: null, opened: false, reason: `nenhuma combinação abriu (${shape})` }
}

/** JID para o registro: só o tipo e os 4 últimos dígitos (ex.: …1234@lid). */
const maskJid = (j: string) => {
  const at = j.indexOf('@')
  return at < 0 ? '…' : `…${j.slice(Math.max(0, at - 4), at)}${j.slice(at)}`
}

/** Estrutura do protobuf (números dos campos, até dois níveis), sem o conteúdo. */
function protoShape(buf: Buffer) {
  try {
    return protoFields(buf)
      .map((f) => {
        if (!f.bytes) return String(f.no)
        try {
          return `${f.no}{${protoFields(f.bytes).map((g) => g.no).join(',')}}`
        } catch {
          return String(f.no)
        }
      })
      .join(' ')
  } catch {
    return '(ilegível)'
  }
}

type ProtoField = { no: number; wire: number; bytes: Buffer | null }

/** Leitor mínimo de protobuf: só os campos de primeiro nível (os de tamanho variável vêm com os bytes). */
function protoFields(buf: Buffer): ProtoField[] {
  const out: ProtoField[] = []
  let i = 0
  const varint = () => {
    let v = 0
    let shift = 0
    for (;;) {
      if (i >= buf.length) throw new Error('fim')
      const b = buf[i++]!
      v += (b & 0x7f) * 2 ** shift
      if (b < 0x80) return v
      shift += 7
      if (shift > 49) throw new Error('varint')
    }
  }
  while (i < buf.length) {
    const tag = varint()
    const no = Math.floor(tag / 8)
    const wire = tag % 8
    if (wire === 0) varint()
    else if (wire === 1) i += 8
    else if (wire === 5) i += 4
    else if (wire === 2) {
      const len = varint()
      if (i + len > buf.length) throw new Error('tamanho')
      out.push({ no, wire, bytes: buf.subarray(i, i + len) })
      i += len
      continue
    } else throw new Error('wire')
    out.push({ no, wire, bytes: null })
  }
  return out
}

/**
 * Texto de uma Message do WhatsApp em protobuf: conversation (1), extendedTextMessage.text (6.1), legenda de foto
 * (3.3) ou vídeo (9.7), ou o editedMessage (14) de um protocolMessage (12); embalagens (editedMessage 58,
 * ephemeralMessage 40) são abertas.
 */
export function protoMessageText(buf: Buffer, depth = 0): string | null {
  if (depth > 4) return null
  let fields: ProtoField[]
  try {
    fields = protoFields(buf)
  } catch {
    return null
  }
  const get = (no: number, list = fields) => list.find((f) => f.no === no && f.bytes)?.bytes ?? null
  const sub = (b: Buffer | null) => {
    if (!b) return null
    try {
      return protoFields(b)
    } catch {
      return null
    }
  }
  const text = (b: Buffer | null) => (b && b.length ? str(b.toString('utf8')) : null)
  const conv = text(get(1))
  if (conv) return conv
  const ext = sub(get(6))
  if (ext && text(get(1, ext))) return text(get(1, ext))
  const img = sub(get(3))
  if (img && text(get(3, img))) return text(get(3, img))
  const vid = sub(get(9))
  if (vid && text(get(7, vid))) return text(get(7, vid))
  const proto = sub(get(12))
  const edited = proto ? get(14, proto) : null
  if (edited) return protoMessageText(edited, depth + 1)
  for (const wrap of [58, 40, 37, 55]) {
    const w = sub(get(wrap))
    const inner = w ? get(1, w) : null
    if (inner) {
      const t = protoMessageText(inner, depth + 1)
      if (t) return t
    }
  }
  return null
}
