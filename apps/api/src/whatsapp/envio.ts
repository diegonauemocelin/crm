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
}
export const DEFAULT_RULES: WaRules = { newContact: 'LEAD_E_PREVENDA', knownLead: 'HISTORICO_E_PREVENDA', reopenDays: 7 }

export function cleanRules(raw: Partial<WaRules> | null | undefined): WaRules {
  const r = raw ?? {}
  return {
    newContact: r.newContact === 'SO_LEAD' || r.newContact === 'NADA' ? r.newContact : 'LEAD_E_PREVENDA',
    knownLead: r.knownLead === 'SO_HISTORICO' ? 'SO_HISTORICO' : 'HISTORICO_E_PREVENDA',
    reopenDays: Number.isInteger(r.reopenDays) && r.reopenDays! >= 1 && r.reopenDays! <= 90 ? r.reopenDays! : 7,
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
const CATEGORY_WORDS: Record<string, CompanyCategory> = { colega: 'COLEGA', funcionario: 'COLEGA', funcionário: 'COLEGA', equipe: 'COLEGA', fornecedor: 'FORNECEDOR', outro: 'OUTRO', outros: 'OUTRO' }

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
export function parseContactList(text: string, fallback: CompanyCategory) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  const sep = [';', '\t', ','].map((s) => [s, (lines[0] ?? '').split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0]
  const rows: { name: string | null; phone: string; category: CompanyCategory }[] = []
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
