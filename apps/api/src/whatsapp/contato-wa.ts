/**
 * Funções puras sobre os contatos do WhatsApp: tipo do identificador (telefone, @lid escondido, grupo), a menção
 * clicada no grupo e a foto do perfil (endereço da Evolution, download com limite e a fila que busca devagar).
 * Sem Nest: os testes (apps/api/test/contato-wa.spec.ts) importam este arquivo direto.
 */

export type JidKind = 'telefone' | 'lid' | 'grupo' | 'outro'

/** Mensagem quando o WhatsApp esconde o telefone de quem foi mencionado (@lid sem telefone conhecido). */
export const HIDDEN_NUMBER_MESSAGE = 'O WhatsApp esconde o número desta pessoa (privacidade). Peça o número para ela ou procure pelo nome.'

/** Tira o aparelho do identificador ("5549...:12@s.whatsapp.net" → "5549...@s.whatsapp.net"). */
export function cleanJid(jid: string) {
  return jid.trim().replace(/:\d+@/, '@')
}

export function jidKind(jid: string | null | undefined): JidKind {
  if (typeof jid !== 'string') return 'outro'
  const j = cleanJid(jid)
  if (/^\d{8,15}@s\.whatsapp\.net$/.test(j)) return 'telefone'
  if (/^\d{5,20}@lid$/.test(j)) return 'lid'
  if (/^[\d-]{5,40}@g\.us$/.test(j)) return 'grupo'
  return 'outro'
}

/** Telefone (+dígitos) de um identificador de telefone; @lid e grupo não têm. */
export function phoneOfJid(jid: string | null | undefined): string | null {
  if (jidKind(jid) !== 'telefone') return null
  return `+${cleanJid(jid!).split('@')[0]}`
}

/** Telefone para mostrar: +5549988632548 → +55 (49) 98863-2548; estrangeiro fica +dígitos. */
export function formatPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length < 8 || d.length > 15) return null
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d)
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : `+${d}`
}

/**
 * Menção antiga (só "@número" no texto, sem o identificador): o número pode ser o telefone ou o @lid. Celular do
 * Brasil (55 + DDD + 8 ou 9 dígitos) é telefone; o resto, identificador escondido.
 */
export function guessMentionJid(digits: string) {
  return /^55[1-9]\d(9?\d{8})$/.test(digits) ? `${digits}@s.whatsapp.net` : `${digits}@lid`
}

/**
 * Como a menção vai para a tela: identificador, telefone (quando se sabe) e se o número está escondido.
 * phones: @lid → telefone (+dígitos) já conhecido (participantes do grupo).
 */
export function mentionView(id: string, jids: string[], name: string | null, phones: Map<string, string>) {
  const known = jids.find((j) => phones.has(j))
  const jid = known ?? (jids.length === 1 ? cleanJid(jids[0]!) : guessMentionJid(id))
  const phone = phoneOfJid(jid) ?? phones.get(jid) ?? null
  return { id, jid, name, phone, hidden: !phone }
}

// ---------- Foto do perfil ----------

/** A foto é conferida de novo depois deste tempo (o contato pode ter trocado). */
export const PHOTO_REFRESH_MS = 7 * 24 * 3_600_000
/** Foto maior que isto não é guardada (as do WhatsApp têm ~10–60 KB). */
export const PHOTO_MAX_BYTES = 1024 * 1024
export const PHOTO_TIMEOUT_MS = 15_000

export function photoDue(checkedAt: Date | string | null | undefined, now = Date.now()) {
  if (!checkedAt) return true
  const t = new Date(checkedAt).getTime()
  return !Number.isFinite(t) || now - t >= PHOTO_REFRESH_MS
}

/**
 * Endereço da foto na resposta da Evolution (/chat/fetchProfilePictureUrl): só https do próprio WhatsApp
 * (pps.whatsapp.net), para o servidor nunca baixar de outro lugar. Sem foto (ou perfil fechado) → null.
 */
export function profilePictureUrl(data: unknown): string | null {
  const raw = (data as { profilePictureUrl?: unknown } | null)?.profilePictureUrl
  if (typeof raw !== 'string' || raw.length > 2000) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
    return u.hostname === 'whatsapp.net' || u.hostname.endsWith('.whatsapp.net') ? u.toString() : null
  } catch {
    return null
  }
}

export type DetectImage = (b: Buffer) => { mime: string; ext: string } | null
const PHOTO_TYPES = ['jpg', 'png', 'webp']

/**
 * Baixa a foto (endereço já conferido) com limite de tamanho e de tempo. Devolve null quando não é uma imagem
 * aceita (JPG, PNG, WEBP) ou passa do limite; erro de rede/HTTP vira exceção (quem chama tenta mais tarde).
 */
export async function downloadPhoto(url: string, detect: DetectImage, fetchImpl: typeof fetch = fetch, opts: { maxBytes?: number; timeoutMs?: number } = {}) {
  const max = opts.maxBytes ?? PHOTO_MAX_BYTES
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? PHOTO_TIMEOUT_MS), redirect: 'error', headers: { accept: 'image/*' } })
  if (!res.ok) throw new Error(`foto respondeu ${res.status}`)
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined)
    return null
  }
  const chunks: Buffer[] = []
  let size = 0
  if (res.body) {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(Buffer.from(value))
    }
  }
  const buffer = Buffer.concat(chunks)
  const type = buffer.length ? detect(buffer) : null
  if (!type || !PHOTO_TYPES.includes(type.ext)) return null
  return { buffer, mime: type.mime, ext: type.ext }
}

/**
 * Fila das fotos: uma (ou poucas) por vez, com pausa entre elas, para não encher o WhatsApp de pedidos. Uma conversa
 * entra uma vez só (não repete enquanto espera nem logo depois de tentar: cooldownMs).
 */
export class PhotoQueue {
  private readonly waiting: string[] = []
  private readonly pending = new Set<string>()
  private readonly tried = new Map<string, number>()
  private running = 0

  constructor(
    private readonly worker: (id: string) => Promise<void>,
    private readonly opts: { concurrency?: number; delayMs?: number; max?: number; cooldownMs?: number; now?: () => number } = {},
  ) {}

  get size() {
    return this.pending.size
  }

  /** Põe na fila (first = na frente, ex.: a conversa que a pessoa abriu). false = já estava ou tentou há pouco. */
  add(id: string, first = false) {
    const now = (this.opts.now ?? Date.now)()
    const last = this.tried.get(id)
    if (this.pending.has(id) || (last !== undefined && now - last < (this.opts.cooldownMs ?? 3_600_000))) return false
    if (this.pending.size >= (this.opts.max ?? 500)) return false
    this.pending.add(id)
    if (first) this.waiting.unshift(id)
    else this.waiting.push(id)
    this.pump()
    return true
  }

  private pump() {
    while (this.running < (this.opts.concurrency ?? 1) && this.waiting.length) {
      const id = this.waiting.shift()!
      this.running++
      void this.run(id)
    }
  }

  private async run(id: string) {
    try {
      await this.worker(id)
    } catch {
      // Quem trabalha registra o erro; a conversa volta depois do cooldown.
    } finally {
      const now = (this.opts.now ?? Date.now)()
      this.tried.set(id, now)
      if (this.tried.size > 20_000) for (const [k, t] of this.tried) if (now - t >= (this.opts.cooldownMs ?? 3_600_000)) this.tried.delete(k)
      this.pending.delete(id)
      const delay = this.opts.delayMs ?? 1_500
      if (delay > 0) await new Promise((r) => setTimeout(r, delay).unref?.())
      this.running--
      this.pump()
    }
  }
}
