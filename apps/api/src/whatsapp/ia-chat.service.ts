import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { GEMINI_MODELS, SECRET_KEY } from '../assistente/constantes'
import { decrypt } from '../common/crypto'
import type { AuthUser } from '../common/types'
import { FilesService } from '../files/files.service'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { ChatService } from './chat.service'
import { audioMime, type ChatLine, cleanSuggestion, cleanTranscript, searchTerms, suggestPrompt, TRANSCRIBE_KEY, TRANSCRIBE_MAX_BYTES, TRANSCRIBE_PROMPT } from './ia-chat'

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'
const TICK_MS = 30_000
/** Áudios transcritos por volta (o plano gratuito do Gemini tem limite por minuto). */
const PER_TICK = 4
/** Só áudios recentes entram na transcrição automática (o histórico antigo não). */
const RECENT_MS = 2 * 86_400_000

/**
 * IA no chat do WhatsApp com o Gemini (plano gratuito do Google, a chave já cadastrada no CRM):
 * - transcrição dos áudios recebidos (automática, quando ligada em Configurações, ou num clique no áudio);
 * - resposta sugerida para o atendente, com a conversa e a base de conhecimento/aplicações do Assistente ML. Nada é
 *   enviado sozinho: o texto vai para a caixa de mensagem e o atendente revisa.
 */
@Injectable()
export class IaChatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('IaChat')
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly chat: ChatService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  /** Chave do Gemini: a do Assistente ML ou, se não houver, a do e-mail marketing. */
  private async key(tenantId: string) {
    let enc = (await this.settings.get<{ enc?: string }>(tenantId, SECRET_KEY('gemini'), {})).enc
    if (!enc) enc = (await this.settings.get<{ apiKeyEnc?: string | null }>(tenantId, 'email_ia', {})).apiKeyEnc ?? undefined
    if (!enc) return null
    try {
      return decrypt(enc)
    } catch {
      return null
    }
  }

  private async gemini(apiKey: string, parts: Record<string, unknown>[], maxTokens: number) {
    let last = ''
    for (const model of GEMINI_MODELS) {
      const res = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens } }),
        signal: AbortSignal.timeout(2 * 60_000),
      }).catch((e: unknown) => {
        last = (e as Error).message
        return null
      })
      if (!res) continue
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] }
      if (!res.ok) {
        last = data.error?.message ?? `HTTP ${res.status}`
        if (res.status === 400 || res.status === 401 || res.status === 403) break
        continue
      }
      return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    }
    throw new Error(last || 'o Gemini não respondeu')
  }

  // ---------- Transcrição ----------

  async transcribeConfig(tenantId: string) {
    const c = await this.settings.get<{ enabled?: boolean }>(tenantId, TRANSCRIBE_KEY, {})
    return { enabled: c.enabled === true, hasKey: !!(await this.key(tenantId)) }
  }

  async setTranscribe(tenantId: string, enabled: boolean) {
    await this.settings.set(tenantId, TRANSCRIBE_KEY, { enabled })
    return this.transcribeConfig(tenantId)
  }

  private async transcribeOne(tenantId: string, apiKey: string, m: { id: string; fileId: string | null; mime: string | null }) {
    if (!m.fileId) return null
    const { content } = await this.files.read(m.fileId)
    if (content.length > TRANSCRIBE_MAX_BYTES) {
      await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { transcriptStatus: 'GRANDE' } })
      return null
    }
    const text = cleanTranscript(await this.gemini(apiKey, [{ inline_data: { mime_type: audioMime(m.mime), data: content.toString('base64') } }, { text: TRANSCRIBE_PROMPT }], 4096))
    await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { transcript: text, transcriptStatus: text ? 'OK' : 'VAZIO' } })
    return text
  }

  /** Transcrição automática dos áudios recebidos, nas empresas que ligaram. */
  async tick() {
    if (this.running) return
    this.running = true
    try {
      const on = await this.prisma.tenantSetting.findMany({ where: { key: TRANSCRIBE_KEY }, select: { tenantId: true, value: true } })
      for (const t of on.filter((x) => (x.value as { enabled?: boolean } | null)?.enabled === true)) {
        const key = await this.key(t.tenantId)
        if (!key) continue
        const where: Prisma.WhatsappMessageWhereInput = { tenantId: t.tenantId, type: 'audio', fromMe: false, mediaStatus: 'OK', fileId: { not: null }, transcript: null, transcriptStatus: null, deletedAt: null, sentAt: { gte: new Date(Date.now() - RECENT_MS) } }
        const list = await this.prisma.whatsappMessage.findMany({ where, orderBy: { sentAt: 'desc' }, take: PER_TICK, select: { id: true, fileId: true, mime: true } })
        for (const m of list) {
          try {
            await this.transcribeOne(t.tenantId, key, m)
          } catch (e) {
            this.logger.warn(`Áudio não transcrito: ${(e as Error).message}`)
            await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { transcriptStatus: 'ERRO' } }).catch(() => undefined)
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Transcrição: ${(e as Error).message}`)
    } finally {
      this.running = false
    }
  }

  // ---------- Resposta sugerida ----------

  async suggest(user: AuthUser, conversationId: string) {
    const conv = await this.chat.conversationFor(user, conversationId)
    const key = await this.key(user.tenantId)
    if (!key) throw new BadRequestException('Falta a chave do Gemini: cadastre em Marketplaces › Assistente ML › Configurações ou no e-mail marketing.')
    const msgs = await this.prisma.whatsappMessage.findMany({ where: { conversationId, internal: false }, orderBy: { sentAt: 'desc' }, take: 20, select: { fromMe: true, type: true, text: true, transcript: true } })
    const lines: ChatLine[] = msgs
      .reverse()
      .map((m) => ({ fromMe: m.fromMe, text: (m.text || m.transcript || (m.type === 'texto' ? '' : `[${m.type}]`)).slice(0, 800) }))
      .filter((l) => l.text)
    if (!lines.some((l) => !l.fromMe)) throw new BadRequestException('O cliente ainda não escreveu nada nesta conversa.')
    const terms = searchTerms(lines)
    const or = (fields: string[]) => terms.flatMap((t) => fields.map((f) => ({ [f]: { contains: t, mode: 'insensitive' as const } })))
    const [knowledge, apps] = terms.length
      ? await Promise.all([
          this.prisma.assistKnowledge.findMany({ where: { tenantId: user.tenantId, status: 'ativo', OR: or(['title', 'question', 'answer', 'partCode', 'product', 'model']) }, take: 6, select: { title: true, answer: true } }),
          this.prisma.assistApplication.findMany({ where: { tenantId: user.tenantId, validationStatus: 'confirmada', OR: or(['partCode', 'productName', 'machineModel', 'application']) }, take: 8, select: { partCode: true, productName: true, machineBrand: true, machineModel: true, application: true } }),
        ])
      : [[], []]
    const company = (await this.settings.branding(user.tenantId).catch(() => null))?.shortName || 'nossa empresa'
    const prompt = suggestPrompt({
      company,
      agent: user.name.split(' ')[0] ?? user.name,
      client: conv.name ?? null,
      lines,
      knowledge: knowledge.map((k) => `${k.title}: ${k.answer}`.slice(0, 600)),
      products: apps.map((a) => [a.partCode, a.productName, [a.machineBrand, a.machineModel].filter(Boolean).join(' '), a.application].filter(Boolean).join(' · ').slice(0, 300)),
    })
    try {
      const text = cleanSuggestion(await this.gemini(key, [{ text: prompt }], 1024))
      if (!text) throw new Error('resposta vazia')
      return { text, used: { knowledge: knowledge.length, products: apps.length } }
    } catch (e) {
      throw new BadRequestException(`O Gemini não sugeriu uma resposta: ${(e as Error).message}`)
    }
  }
}
