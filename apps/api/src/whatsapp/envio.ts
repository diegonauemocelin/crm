/** Regras do envio pelo CRM: tipos de arquivo aceitos, variáveis das respostas rápidas e ritmo por número. */

export interface OutgoingFile {
  /** Como vai para o WhatsApp. */
  kind: 'image' | 'video' | 'audio' | 'document'
  mime: string
  ext: string
}

const DOCS: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
}

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)

/**
 * Tipo do arquivo pelos bytes (não pela extensão nem pelo tipo informado pelo navegador).
 * Aceita foto (JPG/PNG/WEBP), vídeo MP4, áudio (OGG/MP3/M4A) e documentos comuns. Nada de executável, HTML ou SVG.
 */
export function detectOutgoing(buf: Buffer, fileName: string, voice = false): OutgoingFile | null {
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1] ?? '').toLowerCase()
  // Áudio gravado no navegador (mensagem de voz): Chrome grava WebM, Firefox OGG, Safari MP4. A Evolution converte.
  if (voice) {
    if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'audio', mime: 'audio/webm', ext: 'webm' }
    if (buf.toString('ascii', 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' }
    if (buf.toString('ascii', 4, 8) === 'ftyp') return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' }
    return null
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' }
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return { kind: 'image', mime: 'image/png', ext: 'png' }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' }
  if (buf.toString('ascii', 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' }
  if (buf.toString('ascii', 0, 3) === 'ID3' || startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3])) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' }
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    if (/^M4A/.test(brand)) return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' }
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' }
  }
  if (buf.toString('ascii', 0, 5) === '%PDF-') return { kind: 'document', mime: DOCS.pdf!, ext: 'pdf' }
  // Office novo (docx/xlsx) é um zip; o antigo (doc/xls) é OLE. Só com a extensão certa.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) && (ext === 'docx' || ext === 'xlsx')) return { kind: 'document', mime: DOCS[ext]!, ext }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0]) && (ext === 'doc' || ext === 'xls')) return { kind: 'document', mime: DOCS[ext]!, ext }
  if ((ext === 'csv' || ext === 'txt') && !buf.subarray(0, 4096).includes(0)) return { kind: 'document', mime: DOCS[ext]!, ext }
  return null
}

/**
 * Nome do arquivo enviado pelo navegador: o leitor de formulários entrega acentos como latin1 ("OrÃ§amento").
 * Só corrige quando o nome vem nesse formato; nome já certo fica como está.
 */
export function uploadName(name: string | undefined) {
  const n = name ?? 'arquivo'
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(n)) return n
  const fixed = Buffer.from(n, 'latin1').toString('utf8')
  return fixed.includes('\ufffd') ? n : fixed
}

/** Nome de arquivo seguro para mostrar e mandar ao WhatsApp. */
export function safeFileName(name: string, ext: string) {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^\p{L}\p{N} ._-]+/gu, '_').trim().slice(0, 80) || 'arquivo'
  return `${base}.${ext}`
}

/** Troca {nome} (primeiro nome do cliente) e {vendedor} (quem envia). */
export function applyVariables(text: string, v: { nome?: string | null; vendedor?: string | null }) {
  const first = (s?: string | null) => (s ?? '').trim().split(/\s+/)[0] ?? ''
  return text.replace(/\{nome\}/gi, first(v.nome)).replace(/\{vendedor\}/gi, first(v.vendedor)).replace(/[ \t]+([,.!?])/g, '$1')
}

/** Nome escolhido pelo usuário para as mensagens: uma linha, sem os sinais de formatação do WhatsApp, até 40 letras. */
export function cleanSignature(raw: string | null | undefined) {
  const s = (raw ?? '').replace(/[*_~`\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[:\s]+$/, '')
  return s.slice(0, 40).trim() || null
}

/** Assinatura no começo da mensagem: *Diego:* ou o nome escolhido em Meu perfil (*Diego - Vendas:*), em negrito no WhatsApp. */
export function signed(text: string, name: string, signature?: string | null) {
  const label = cleanSignature(signature) ?? name.trim().split(/\s+/)[0]
  return label ? `*${label}:*\n${text}` : text
}

/** Limites do WhatsApp para mexer numa mensagem já enviada: editar até 15 minutos; apagar para todos até 2 dias. */
export const EDIT_WINDOW_MS = 15 * 60_000
export const DELETE_WINDOW_MS = 2 * 86_400_000

/**
 * O que ainda dá para fazer com uma mensagem: só as enviadas pela empresa (não as do cliente nem as notas internas),
 * dentro do prazo do WhatsApp. Editar só texto; apagar qualquer tipo.
 */
export function sentActions(m: { fromMe: boolean; internal: boolean; type: string; sentAt: Date; deletedAt: Date | null; status?: string | null }, now = Date.now()) {
  if (!m.fromMe || m.internal || m.deletedAt || m.status === 'ERRO') return { edit: false, delete: false }
  const age = now - m.sentAt.getTime()
  return { edit: m.type === 'texto' && age <= EDIT_WINDOW_MS, delete: age <= DELETE_WINDOW_MS }
}

/**
 * Ritmo de envio por número (proteção contra bloqueio do WhatsApp): no máximo 20 mensagens por minuto e 300 por hora.
 * Atendimento normal fica bem abaixo disso; o limite pega cópia e cola em massa.
 */
export class SendRate {
  private readonly hits = new Map<string, number[]>()
  constructor(
    private readonly perMinute = 20,
    private readonly perHour = 300,
  ) {}

  /** null = pode enviar; senão, em quantos segundos tentar de novo. */
  check(key: string, now = Date.now()): number | null {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < 3_600_000)
    const lastMinute = list.filter((t) => now - t < 60_000)
    if (lastMinute.length >= this.perMinute) return Math.ceil((60_000 - (now - lastMinute[0]!)) / 1000)
    if (list.length >= this.perHour) return Math.ceil((3_600_000 - (now - list[0]!)) / 1000)
    list.push(now)
    this.hits.set(key, list)
    return null
  }
}

// ---------- Regras do WhatsApp (definidas pelo administrador) ----------

export interface WaRules {
  /** Contato que não é lead nem está na lista da empresa. */
  newContact: 'LEAD_E_PREVENDA' | 'SO_LEAD' | 'NADA'
  /** Contato que já é lead da base. */
  knownLead: 'HISTORICO_E_PREVENDA' | 'SO_HISTORICO'
  /** Dias sem conversa para a próxima mensagem do cliente abrir um novo atendimento. */
  reopenDays: number
  /** Cores do tempo sem resposta (desde a última mensagem do cliente): verde até yellowMinutes, amarelo até redMinutes, depois vermelho. */
  yellowMinutes: number
  redMinutes: number
  /** Horário comercial (horário de Brasília): um intervalo por dia da semana (0 = domingo); null = fechado. */
  businessHours: BusinessHours
  /** Mensagem automática para quem chama fora do horário comercial (uma vez a cada cooldownHours por contato). */
  away: { enabled: boolean; text: string; cooldownHours: number }
  /** Prazo de guarda das conversas (LGPD): em meses, por tipo de contato; as mídias saem antes (só fica o texto). */
  retention: Retention
  /** Finalizar atendimento: mensagem de encerramento enviada ao cliente (quando ligada; dá para não enviar na hora). */
  close: { enabled: boolean; text: string }
}

export const DEFAULT_CLOSE_TEXT = 'Seu atendimento foi finalizado. Obrigado pelo contato! Se precisar de algo, é só chamar por aqui.'
export interface Retention {
  enabled: boolean
  clientMonths: number
  otherMonths: number
  mediaMonths: number
}
/**
 * Padrão: cliente 5 anos (prazo do CDC, art. 27, para reclamações; a LGPD permite guardar para o exercício de
 * direitos, art. 7º VI e art. 16 I), demais contatos 2 anos, mídias 12 meses (necessidade, art. 6º III).
 */
export const DEFAULT_RETENTION: Retention = { enabled: true, clientMonths: 60, otherMonths: 24, mediaMonths: 12 }

export function cleanRetention(raw: Partial<Retention> | null | undefined): Retention {
  const int = (v: unknown, min: number, max: number, d: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : d)
  const clientMonths = int(raw?.clientMonths, 6, 120, DEFAULT_RETENTION.clientMonths)
  const otherMonths = int(raw?.otherMonths, 3, 120, DEFAULT_RETENTION.otherMonths)
  // A mídia nunca fica mais que as mensagens (assim, mensagem apagada nunca deixa arquivo para trás).
  const mediaMonths = Math.min(int(raw?.mediaMonths, 1, 120, DEFAULT_RETENTION.mediaMonths), clientMonths, otherMonths)
  return { enabled: raw?.enabled !== false, clientMonths, otherMonths, mediaMonths }
}

/** Datas de corte do prazo de guarda (meses de 30 dias). */
export function retentionCutoffs(r: Retention, now = Date.now()) {
  const ago = (m: number) => new Date(now - m * 30 * 86_400_000)
  return { client: ago(r.clientMonths), other: ago(r.otherMonths), media: ago(r.mediaMonths) }
}
export interface BusinessHours {
  enabled: boolean
  days: ({ start: string; end: string } | null)[]
}
export const DEFAULT_HOURS: BusinessHours = {
  enabled: false,
  days: [null, { start: '08:00', end: '18:00' }, { start: '08:00', end: '18:00' }, { start: '08:00', end: '18:00' }, { start: '08:00', end: '18:00' }, { start: '08:00', end: '18:00' }, { start: '08:00', end: '12:00' }],
}
export const DEFAULT_AWAY_TEXT =
  'Olá! Recebemos sua mensagem fora do nosso horário de atendimento (segunda a sexta, das 8h às 18h, e sábado, das 8h às 12h). Responderemos assim que voltarmos. Obrigado!'
export const DEFAULT_RULES: WaRules = {
  newContact: 'LEAD_E_PREVENDA',
  knownLead: 'HISTORICO_E_PREVENDA',
  reopenDays: 7,
  yellowMinutes: 15,
  redMinutes: 60,
  businessHours: DEFAULT_HOURS,
  away: { enabled: false, text: DEFAULT_AWAY_TEXT, cooldownHours: 12 },
  retention: DEFAULT_RETENTION,
  close: { enabled: true, text: DEFAULT_CLOSE_TEXT },
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export function cleanHours(raw: Partial<BusinessHours> | null | undefined): BusinessHours {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = Array.isArray(raw?.days) ? raw!.days[i] : DEFAULT_HOURS.days[i]
    if (!d || typeof d !== 'object' || !HHMM.test(String(d.start)) || !HHMM.test(String(d.end)) || minutesOf(d.end) <= minutesOf(d.start)) return null
    return { start: d.start, end: d.end }
  })
  return { enabled: raw?.enabled === true, days }
}

/** Aberto agora pelo horário comercial (horário de Brasília, sem horário de verão). Desligado = sempre aberto. */
export function isOpen(h: BusinessHours, now = new Date()) {
  if (!h.enabled) return true
  const sp = new Date(now.getTime() - 3 * 3_600_000)
  const d = h.days[sp.getUTCDay()]
  if (!d) return false
  const m = sp.getUTCHours() * 60 + sp.getUTCMinutes()
  return m >= minutesOf(d.start) && m < minutesOf(d.end)
}

export type ReceiptStatus = 'ENVIADA' | 'ENTREGUE' | 'LIDA' | 'ERRO'
const RECEIPT_RANK: Record<string, number> = { ERRO: 0, ENVIADA: 1, ENTREGUE: 2, LIDA: 3 }
const RECEIPT_MAP: Record<string, ReceiptStatus> = { SERVER_ACK: 'ENVIADA', DELIVERY_ACK: 'ENTREGUE', READ: 'LIDA', PLAYED: 'LIDA', ERROR: 'ERRO', '2': 'ENVIADA', '3': 'ENTREGUE', '4': 'LIDA', '5': 'LIDA', '0': 'ERRO' }

/**
 * Confirmações de entrega e leitura (evento messages.update da Evolution): id da mensagem no WhatsApp + situação.
 * Só as mensagens enviadas pela empresa (fromMe) importam.
 */
export function parseReceipts(data: unknown): { waId: string; status: ReceiptStatus }[] {
  const out: { waId: string; status: ReceiptStatus }[] = []
  for (const raw of (Array.isArray(data) ? data : [data]).slice(0, 200)) {
    const d = (raw ?? {}) as Record<string, unknown>
    const key = (d.key ?? {}) as Record<string, unknown>
    if (d.fromMe === false || key.fromMe === false) continue
    const waId = [d.keyId, key.id].find((x) => typeof x === 'string' && x.length >= 6 && x.length <= 120) as string | undefined
    const update = (d.update ?? {}) as Record<string, unknown>
    const status = RECEIPT_MAP[String(d.status ?? update.status ?? '').toUpperCase()]
    if (waId && status) out.push({ waId, status })
  }
  return out
}

/** A situação só avança (enviada → entregue → lida); erro só antes de entregar. */
export function receiptUpgrades(current: string | null, next: ReceiptStatus) {
  if (current === 'NOTA') return false
  if (next === 'ERRO') return !current || current === 'ENVIADA'
  return (RECEIPT_RANK[next] ?? 0) > (RECEIPT_RANK[current ?? ''] ?? 0) || current === 'ERRO'
}

// Agradecimento / despedida do cliente: depois da última fala da empresa, não pede resposta.
const CLOSING_WORDS = [
  'muito obrigado', 'muito obrigada', 'obrigado', 'obrigada', 'obrigados', 'obrigadas', 'obrigadao', 'obrigadinho', 'obrigadinha', 'brigado', 'brigada', 'obg', 'obgd', 'obgda', 'obgdo',
  'grato', 'grata', 'agradeco', 'agradecido', 'agradecida', 'valeu', 'vlw', 'ok', 'okay', 'okey', 'blz', 'beleza', 'certo', 'ta certo', 'perfeito', 'show', 'top', 'otimo', 'combinado',
  'fechado', 'tmj', 'tamo junto', 'de nada', 'ate mais', 'ate logo', 'ate breve', 'ate a proxima', 'abraco', 'abracos', 'abs', 'entendi', 'entendido', 'joia', 'tranquilo', 'tranquila',
  'igualmente', 'deus abencoe', 'amem', 'disponha',
]
// Palavras que acompanham o agradecimento, mas sozinhas não encerram ("bom dia" sozinho costuma abrir um pedido).
const CLOSING_FILLER = [
  'muito', 'mto', 'mt', 'muitissimo', 'mesmo', 'pela atencao', 'pela ajuda', 'pelo atendimento', 'por tudo', 'entao', 'e', 'sim', 'tudo', 'ai', 'bom dia', 'boa tarde', 'boa noite',
  'bom fim de semana', 'otimo dia', 'boa semana', 'bom trabalho', 'pra voce tambem', 'para voce tambem', 'voce tambem', 'vc tambem', 'tambem', 'amigo', 'amiga', 'sr', 'sra', 'senhor',
  'senhora', 'kkk', 'kkkk', 'rs', 'ta', 'bem', 'demais',
]
const PHRASES = [...CLOSING_WORDS.map((w) => ({ w: w.split(' '), closing: true })), ...CLOSING_FILLER.map((w) => ({ w: w.split(' '), closing: false }))].sort((a, b) => b.w.length - a.w.length)

/** A mensagem do cliente só agradece ou se despede ("Muito obrigada!", "ok 👍", figurinha), sem pedir nada. */
export function isClosingMessage(m: { type: string; text: string | null }): boolean {
  if (m.type === 'figurinha') return true
  if (m.type !== 'texto') return false
  const raw = (m.text ?? '').trim()
  if (!raw || raw.length > 80) return false
  const plain = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  // Só emoji (👍🙏): também é encerramento.
  if (!/[\p{L}\p{N}]/u.test(plain)) return true
  const words = plain.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').map((w) => (/^k{3,}$/.test(w) ? 'kkk' : w.replace(/(.)\1{2,}$/, '$1')))
  let closing = false
  for (let i = 0; i < words.length; ) {
    const hit = PHRASES.find((p) => p.w.every((x, j) => words[i + j] === x))
    if (!hit) return false
    closing ||= hit.closing
    i += hit.w.length
  }
  return closing
}

/** Cor do atraso de resposta: só quando a última mensagem é do cliente. */
export function responseColor(lastFromMe: boolean, lastMessageAt: Date | null, r: Pick<WaRules, 'yellowMinutes' | 'redMinutes'>, now = Date.now()): 'verde' | 'amarelo' | 'vermelho' | null {
  if (lastFromMe || !lastMessageAt) return null
  const min = (now - lastMessageAt.getTime()) / 60_000
  return min < r.yellowMinutes ? 'verde' : min < r.redMinutes ? 'amarelo' : 'vermelho'
}

export function cleanRules(raw: Partial<WaRules> | null | undefined): WaRules {
  const r = raw ?? {}
  return {
    newContact: r.newContact === 'SO_LEAD' || r.newContact === 'NADA' ? r.newContact : 'LEAD_E_PREVENDA',
    knownLead: r.knownLead === 'SO_HISTORICO' ? 'SO_HISTORICO' : 'HISTORICO_E_PREVENDA',
    reopenDays: Number.isInteger(r.reopenDays) && r.reopenDays! >= 1 && r.reopenDays! <= 90 ? r.reopenDays! : 7,
    ...(() => {
      const y = Number.isInteger(r.yellowMinutes) && r.yellowMinutes! >= 1 && r.yellowMinutes! <= 1440 ? r.yellowMinutes! : 15
      const red = Number.isInteger(r.redMinutes) && r.redMinutes! > y && r.redMinutes! <= 2880 ? r.redMinutes! : Math.max(y + 1, 60)
      return { yellowMinutes: y, redMinutes: red }
    })(),
    businessHours: cleanHours(r.businessHours),
    away: {
      enabled: r.away?.enabled === true,
      text: typeof r.away?.text === 'string' && r.away.text.trim() ? r.away.text.trim().slice(0, 1000) : DEFAULT_AWAY_TEXT,
      cooldownHours: Number.isInteger(r.away?.cooldownHours) && r.away!.cooldownHours >= 1 && r.away!.cooldownHours <= 168 ? r.away!.cooldownHours : 12,
    },
    retention: cleanRetention(r.retention),
    close: {
      enabled: r.close?.enabled !== false,
      text: typeof r.close?.text === 'string' && r.close.text.trim() ? r.close.text.trim().slice(0, 1000) : DEFAULT_CLOSE_TEXT,
    },
  }
}

/**
 * O que fazer com uma mensagem, sem o operador precisar decidir:
 * - contato da empresa (colega, fornecedor, outro): fica só no chat;
 * - lead já cadastrado: entra no histórico dele e, pela regra, abre pré-venda depois de X dias sem conversa;
 * - contato novo: pela regra, vira lead (com o histórico) e abre pré-venda, ou fica "A classificar".
 * Pré-venda só em número que abre pré-venda e quando é o cliente que chama (não quando a empresa inicia).
 */
export function decide(
  r: WaRules,
  s: { marked: string | null; hasLead: boolean; idle: boolean; fromMe: boolean; hasPhone: boolean; numberOpensRecords: boolean },
): { category: string; linkLead: boolean; createLead: boolean; openRecord: boolean } {
  if (s.marked && s.marked !== 'CLIENTE') return { category: s.marked, linkLead: false, createLead: false, openRecord: false }
  const clientCalled = !s.fromMe && s.idle
  if (s.hasLead) return { category: 'CLIENTE', linkLead: true, createLead: false, openRecord: clientCalled && r.knownLead === 'HISTORICO_E_PREVENDA' && s.numberOpensRecords }
  // Marcado como cliente no chat vale como venda, mesmo com a regra "A classificar".
  const rule = s.marked === 'CLIENTE' && r.newContact === 'NADA' ? 'LEAD_E_PREVENDA' : r.newContact
  if (rule === 'NADA') return { category: 'NOVO', linkLead: false, createLead: false, openRecord: false }
  const create = clientCalled && s.hasPhone
  return { category: 'CLIENTE', linkLead: create, createLead: create, openRecord: create && rule === 'LEAD_E_PREVENDA' && s.numberOpensRecords }
}

// ---------- Contatos da empresa (colegas, fornecedores...) ----------

export type CompanyCategory = 'COLEGA' | 'FORNECEDOR' | 'OUTRO'
/** Tipos da agenda de contatos: cliente (venda) ou contato da empresa. */
export type AgendaCategory = 'CLIENTE' | CompanyCategory
export const AGENDA_CATEGORIES: AgendaCategory[] = ['CLIENTE', 'COLEGA', 'FORNECEDOR', 'OUTRO']
const CATEGORY_WORDS: Record<string, AgendaCategory> = { cliente: 'CLIENTE', colega: 'COLEGA', funcionario: 'COLEGA', funcionário: 'COLEGA', equipe: 'COLEGA', fornecedor: 'FORNECEDOR', outro: 'OUTRO', outros: 'OUTRO' }

/** Divide uma linha de CSV respeitando aspas. */
function splitLine(line: string, sep: string) {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/**
 * Lista de contatos colada ou exportada (Google Contatos, Excel em CSV, "Nome;Telefone;Tipo").
 * Em cada linha: o telefone é a célula com 10 a 13 dígitos; o nome, a primeira célula de texto; o tipo, se houver
 * (colega, fornecedor, outro). A normalização do telefone fica com quem chama.
 */
export function parseContactList(text: string, fallback: AgendaCategory | null) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  const sep = [';', '\t', ','].map((s) => [s, (lines[0] ?? '').split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0]
  const rows: { name: string | null; phone: string; category: AgendaCategory | null }[] = []
  let skipped = 0
  for (const line of lines.slice(0, 5000)) {
    const cells = splitLine(line, sep)
    const phones = cells.flatMap((c) => c.split(/\s*:::\s*/)).filter((c) => /^[\d\s()+.-]+$/.test(c) && c.replace(/\D/g, '').length >= 10 && c.replace(/\D/g, '').length <= 13)
    if (!phones.length) {
      skipped++
      continue
    }
    const name = cells.find((c) => c && !/^[\d\s()+.-]+$/.test(c) && !CATEGORY_WORDS[c.toLowerCase()] && !/@/.test(c)) ?? null
    const category = cells.map((c) => CATEGORY_WORDS[c.toLowerCase()]).find(Boolean) ?? fallback
    for (const p of phones) rows.push({ name: name?.slice(0, 120) ?? null, phone: p, category })
  }
  return { rows, skipped }
}

const GOOGLE_PHONE = /^(phone|telefone) \d+ - (value|valor)$/i
const GOOGLE_COL = {
  full: /^(name|nome completo|display name|nome de exibição)$/i,
  first: /^(first name|given name|primeiro nome|nome)$/i,
  middle: /^(middle name|additional name|nome do meio)$/i,
  last: /^(last name|family name|sobrenome)$/i,
  org: /^(organization name|organization 1 - name|organização - nome|organização 1 - nome|empresa)$/i,
  labels: /^(labels|group membership|marcadores|associação a grupos)$/i,
}

/**
 * CSV exportado do Google Contatos (contacts.google.com › Exportar › "Google CSV"), no formato novo
 * (Nome, Sobrenome, "Telefone 1 - Valor") ou no antigo (Name, Given Name, "Phone 1 - Value"), em português ou inglês.
 * Nome montado das partes (ou a empresa), todos os telefones de cada contato e o tipo pelos marcadores
 * (um marcador "Cliente", "Fornecedor" ou "Colega" já define o tipo). Devolve null se o arquivo não for desse formato.
 */
export function parseGoogleContacts(table: string[][]) {
  const head = (table[0] ?? []).map((h) => h.replace(/^﻿/, '').trim())
  const phoneCols = head.map((h, i) => (GOOGLE_PHONE.test(h) ? i : -1)).filter((i) => i >= 0)
  if (!phoneCols.length) return null
  const col = (re: RegExp) => head.findIndex((h) => re.test(h))
  const idx = { full: col(GOOGLE_COL.full), first: col(GOOGLE_COL.first), middle: col(GOOGLE_COL.middle), last: col(GOOGLE_COL.last), org: col(GOOGLE_COL.org), labels: col(GOOGLE_COL.labels) }
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const rows: { name: string | null; phone: string; category: AgendaCategory | null }[] = []
  let skipped = 0
  for (const r of table.slice(1, 5001)) {
    if (!r.some((c) => c.trim())) continue
    const parts = [cell(r, idx.first), cell(r, idx.middle), cell(r, idx.last)].filter(Boolean).join(' ')
    const name = (cell(r, idx.full) || parts || cell(r, idx.org)).replace(/\s+/g, ' ').slice(0, 120) || null
    const phones = phoneCols.flatMap((i) => cell(r, i).split(/\s*:::\s*/)).map((p) => p.trim()).filter((p) => p.replace(/\D/g, '').length >= 8)
    if (!phones.length) {
      skipped++
      continue
    }
    // Marcadores: "* myContacts ::: Fornecedor" — o primeiro que for um tipo da agenda vale.
    const category = cell(r, idx.labels).split(/\s*:::\s*/).map((l) => CATEGORY_WORDS[l.replace(/^\*\s*/, '').trim().toLowerCase()]).find(Boolean) ?? null
    for (const p of [...new Set(phones)]) rows.push({ name, phone: p, category })
  }
  return { rows, skipped }
}

/**
 * Cartão de contato para enviar no chat: nome (1 a 80 letras) e telefone. Celular do Brasil sem DDI ganha o 55;
 * o WhatsApp usa os dígitos (wuid) para mostrar o botão "Conversar". Devolve o erro em português quando não dá.
 */
export function contactCard(nameRaw: string, phoneRaw: string): { fullName: string; wuid: string; phoneNumber: string; text: string } | { error: string } {
  const fullName = nameRaw.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!fullName) return { error: 'Informe o nome do contato.' }
  let d = phoneRaw.replace(/\D/g, '')
  if (phoneRaw.trim().startsWith('+')) {
    if (d.length < 10 || d.length > 15) return { error: 'Telefone inválido.' }
  } else {
    if (d.startsWith('0')) d = d.replace(/^0+/, '')
    if (d.length === 10 || d.length === 11) d = `55${d}`
    if (d.length < 12 || d.length > 15) return { error: 'Telefone inválido. Use DDD e número, ex.: (47) 99999-0000.' }
  }
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d)
  const phoneNumber = br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${d}`
  return { fullName, wuid: d, phoneNumber, text: `${fullName} · ${phoneNumber}` }
}

/** Quoted-printable (vCard 2.1 do Android): "=C3=A9" vira "é". */
function decodeQuotedPrintable(v: string) {
  const bytes: number[] = []
  const s = v.replace(/=\r?\n/g, '')
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(...Buffer.from(s[i]!, 'utf8'))
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Valor de uma linha do vCard ("FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jo=C3=A3o"), sem os escapes. */
function vcardValue(line: string) {
  const i = line.indexOf(':')
  if (i < 0) return ''
  const params = line.slice(0, i)
  let v = line.slice(i + 1)
  if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) v = decodeQuotedPrintable(v)
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

/**
 * Contatos exportados do celular em vCard (.vcf: Android "Exportar contatos", iPhone "Exportar vCard", Google
 * Contatos): nome (FN, ou o N montado, ou a empresa) e todos os telefones de cada contato.
 */
export function parseVcf(text: string) {
  // Linhas dobradas (continuação começa com espaço) e, no quoted-printable, linha terminada em "=" continua na seguinte.
  const raw = text.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const joined: string[] = []
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]!
    if (/ENCODING=QUOTED-PRINTABLE/i.test(line.slice(0, line.indexOf(':') + 1))) while (line.endsWith('=') && i + 1 < raw.length) line = line.slice(0, -1) + raw[++i]
    joined.push(line)
  }
  const rows: { name: string | null; phone: string; category: null }[] = []
  let skipped = 0
  for (const card of joined.join('\n').split(/BEGIN:VCARD/i).slice(1, 5001)) {
    const lines = card.split('\n').map((l) => l.replace(/^item\d+\./i, ''))
    const fn = lines.find((l) => /^FN[;:]/i.test(l))
    const n = lines.find((l) => /^N[;:]/i.test(l))
    const org = lines.find((l) => /^ORG[;:]/i.test(l))
    let name = fn ? vcardValue(fn) : ''
    if (!name && n) {
      const [family = '', given = '', middle = ''] = vcardValue(n).split(';')
      name = [given, middle, family].filter(Boolean).join(' ')
    }
    if (!name && org) name = vcardValue(org).split(';')[0] ?? ''
    const phones = lines.filter((l) => /^TEL[;:]/i.test(l)).map((l) => vcardValue(l).replace(/^tel:/i, '').trim()).filter((p) => p.replace(/\D/g, '').length >= 8)
    if (!phones.length) {
      skipped++
      continue
    }
    for (const p of [...new Set(phones)]) rows.push({ name: name.slice(0, 120) || null, phone: p, category: null })
  }
  return { rows, skipped }
}

/** Campos em que a Evolution pode trazer o telefone do contato (com o número escondido, vem só no "alternativo"). */
const PHONE_FIELDS = ['remoteJid', 'id', 'jid', 'remoteJidAlt', 'jidAlt', 'senderPn', 'pn', 'phoneNumber', 'phone', 'number']

/**
 * Contatos do número conectado (Evolution: chat/findContacts). Aceita a lista solta ou dentro de contacts/data/records.
 * Só pessoas com telefone (…@s.whatsapp.net, …@c.us ou só os dígitos); grupos, listas de transmissão e contatos com o
 * número escondido pelo WhatsApp (@lid, sem telefone alternativo) ficam de fora e são contados.
 */
export function contactsFromWhatsapp(list: unknown) {
  const o = list as Record<string, unknown> | null
  const raw = Array.isArray(list) ? list : ([o?.contacts, o?.data, o?.records, o?.response].find(Array.isArray) ?? [])
  const rows: { name: string | null; phone: string; category: null }[] = []
  const stats = { total: raw.length, hidden: 0, groups: 0 }
  const seen = new Set<string>()
  for (const c of raw as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue
    const values = PHONE_FIELDS.map((k) => c[k]).filter((v): v is string => typeof v === 'string')
    if (values.some((v) => /@(g\.us|broadcast|newsletter)$/.test(v))) {
      stats.groups++
      continue
    }
    const digits = values.map((v) => /^\+?(\d{10,15})(?:@s\.whatsapp\.net|@c\.us)?$/.exec(v.trim())?.[1]).find(Boolean)
    if (!digits) {
      if (values.some((v) => v.endsWith('@lid'))) stats.hidden++
      continue
    }
    if (seen.has(digits)) continue
    seen.add(digits)
    const name = [c.name, c.verifiedName, c.pushName, c.notify].find((x) => typeof x === 'string' && x.trim()) as string | undefined
    rows.push({ name: name?.trim().slice(0, 120) ?? null, phone: `+${digits}`, category: null })
  }
  return Object.assign(rows, { stats })
}

/** Cores das etiquetas do chat (a tela mapeia cada uma para a sua cor). */
export const LABEL_COLORS = ['cinza', 'vermelho', 'laranja', 'amarelo', 'verde', 'azul', 'roxo', 'rosa'] as const
export type LabelColor = (typeof LABEL_COLORS)[number]

/** Por onde o lead "para chamar" chegou: formulário (qual), pop-up, botão de WhatsApp sem mensagem, loja virtual. */
export function toCallVia(sub: { channel: string; formName: string | null } | null, conv: { conversao?: string; source?: string } | null, ecommerce: boolean, origin: string | null) {
  if (sub) {
    if (sub.channel === 'whatsapp') return { kind: 'whatsapp', label: 'Botão de WhatsApp: preencheu e não mandou mensagem' }
    if (sub.channel === 'popup') return { kind: 'formulario', label: sub.formName ? `Pop-up: ${sub.formName}` : 'Pop-up do site' }
    return { kind: 'formulario', label: sub.formName ? `Formulário: ${sub.formName}` : 'Formulário do site' }
  }
  if (conv?.conversao) return { kind: /whatsapp/i.test(conv.conversao) ? 'whatsapp' : 'formulario', label: conv.conversao.charAt(0).toUpperCase() + conv.conversao.slice(1) }
  if (ecommerce || conv?.source === 'ecommerce') return { kind: 'ecommerce', label: 'Loja virtual' }
  return { kind: 'outro', label: origin ?? 'Cadastro no CRM' }
}

/**
 * Promessa de retorno ("só um momento", "vou verificar e lhe retorno", "assim que tiver eu aviso"): o cliente
 * continua aguardando. Texto sem acento e em minúsculas.
 */
const HOLDING = new RegExp(
  `\\b(${[
    'so um (momento|minuto|minutinho|instante|pouquinho)',
    'um (momento|minuto|minutinho|instante|pouquinho)',
    'aguard(e|a|ar)',
    'vou (verificar|ver|consultar|checar|conferir|confirmar|olhar|levantar|analisar|cotar|orcar|pesquisar|perguntar|falar com|dar uma olhada)',
    'vamos (verificar|ver|consultar|checar|conferir|confirmar|analisar|cotar)',
    'deixa eu (ver|verificar|olhar|conferir|confirmar)',
    '(estou|to|tou|estamos) (vendo|verificando|consultando|checando|conferindo|confirmando|analisando|cotando|levantando)',
    'verificando|consultando|checando',
    'ja (te |lhe )?(retorno|volto|respondo|aviso|verifico|confirmo|envio|mando|passo|falo)',
    '(te|lhe|vos) (retorno|aviso|confirmo|respondo|envio|mando|passo|falo)',
    '(retorno|volto|respondo) (em breve|ja|logo|assim|daqui)',
    'assim que (eu )?(tiver|souber|conseguir|possivel|verificar|confirmar|receber|chegar|liberar)',
    'em breve (te |lhe )?(retorno|respondo|aviso|envio|mando)',
    'mais tarde (te |lhe )?(retorno|respondo|aviso|envio|mando)',
  ].join('|')})\\b`,
)

/**
 * A mensagem da empresa responde o cliente e para o tempo de "aguardando retorno"? Responde: texto, áudio, foto,
 * documento, contato ou localização. Não responde: promessa de retorno ("vou verificar e lhe retorno") e figurinha.
 */
export function answersClient(m: { type: string; text: string | null }): boolean {
  if (m.type === 'figurinha' || m.type === 'chamada' || m.type === 'outro') return false
  if (m.type !== 'texto') return true
  // Tira a assinatura do atendente ("*Fabíola:*") antes de ler.
  const plain = (m.text ?? '').replace(/^\*[^*\n]{1,40}:\*\s*/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!plain) return false
  return !HOLDING.test(plain)
}
