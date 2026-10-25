import { createHash } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { SettingsService } from '../settings/settings.service'
import { htmlToText } from './blocos'
import { type AiAction, type AiMode, AI_MODES, aiError, answerHtml, answerOptions, cleanAnswer, cleanTranscript, TRANSCRIBE_SYSTEM, FALLBACK_MODELS, type GeminiModel, rankModels, systemPrompt, userPrompt } from './ia'

interface AiSettings {
  apiKeyEnc: string | null
  /** rapido (Flash-Lite, recomendado) ou caprichado (Flash). Configurações antigas com nome de modelo viram "rapido". */
  model: AiMode
  /** Contexto da empresa para o texto (o que vende, para quem). */
  about: string
}
const DEFAULT_AI: AiSettings = { apiKeyEnc: null, model: 'rapido', about: '' }
const KEY = 'email_ia'
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'
/** Lista de modelos da chave guardada por 12 h (o Google lança e aposenta modelos sem aviso). */
const MODELS_TTL_MS = 12 * 3_600_000
/** Espera pela resposta: os modelos rápidos respondem em poucos segundos. */
const TIMEOUT_MS = 25_000

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

class GeminiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Gemini ${status}`)
  }
}

/** Assistente de texto do e-mail marketing pelo Google Gemini (plano gratuito ou pago, conforme a chave). */
@Injectable()
export class EmailAiService {
  private readonly logger = new Logger(EmailAiService.name)
  /** Por chave (resumo da chave, nunca ela) e modo: modelos em ordem de preferência. */
  private readonly models = new Map<string, { list: string[]; at: number }>()

  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private assertCan(user: AuthUser, action: 'view' | 'edit') {
    if (!can(user.permissions, user.role.isSystem, 'email_marketing', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  private async config(tenantId: string): Promise<AiSettings> {
    const s = await this.settings.get<AiSettings>(tenantId, KEY, DEFAULT_AI)
    return { ...DEFAULT_AI, ...s, model: (AI_MODES as readonly string[]).includes(s.model) ? s.model : 'rapido' }
  }

  async view(user: AuthUser) {
    this.assertCan(user, 'view')
    const s = await this.config(user.tenantId)
    return { configured: !!s.apiKeyEnc, model: s.model, about: s.about, models: AI_MODES }
  }

  async save(user: AuthUser, d: { apiKey?: string; model?: string; about?: string; removeKey?: boolean }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const cur = await this.config(user.tenantId)
    const key = d.apiKey?.trim()
    // Formatos do Google AI Studio: o antigo (AIza...) e o novo (AQ.xxxx), só letras, números, ponto, hífen e sublinhado.
    if (key && !/^[A-Za-z0-9][A-Za-z0-9._-]{19,199}$/.test(key)) throw new BadRequestException('Chave do Gemini inválida. No Google AI Studio, use o botão “Copiar chave” e cole aqui a chave inteira (começa com AQ. ou AIza).')
    const next: AiSettings = {
      apiKeyEnc: d.removeKey ? null : key ? encrypt(key) : cur.apiKeyEnc,
      model: (AI_MODES as readonly string[]).includes(d.model ?? '') ? (d.model as AiMode) : cur.model,
      about: (d.about ?? cur.about).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500),
    }
    await this.settings.set(user.tenantId, KEY, next)
    await this.audit.byUser(user, ctx, 'email.ia_configurada', 'settings', KEY, { chave: next.apiKeyEnc ? (key ? 'nova' : 'mantida') : 'sem chave', modo: next.model })
    return this.view(user)
  }

  /** Modelos da chave em ordem de preferência (consulta a lista do Google; se não der, usa os apelidos estáveis). */
  private async candidates(apiKey: string, mode: AiMode, refresh = false) {
    const id = `${createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}:${mode}`
    const hit = this.models.get(id)
    if (!refresh && hit && Date.now() - hit.at < MODELS_TTL_MS) return hit.list
    let list: string[] = []
    try {
      const res = await fetch(`${GEMINI}?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(10_000), redirect: 'error' })
      if (res.ok) list = rankModels(((await res.json()) as { models?: GeminiModel[] }).models ?? [], mode)
    } catch {
      /* sem a lista: usa os apelidos estáveis */
    }
    if (!list.length) list = FALLBACK_MODELS[mode]
    this.models.set(id, { list, at: Date.now() })
    return list
  }

  private async request(apiKey: string, model: string, system: string, prompt: string, temperature: number, extra: GeminiPart[] = [], maxOutputTokens = 1024) {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [...extra, { text: prompt }] }],
      // Sem "raciocínio" nos modelos 2.5 (é o que mais demora); nos outros, o padrão do modelo.
      generationConfig: { temperature, maxOutputTokens, ...(/2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
    }
    let res: Response
    try {
      res = await fetch(`${GEMINI}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      })
    } catch (err) {
      const timeout = (err as Error).name === 'TimeoutError'
      throw new BadRequestException(timeout ? 'O Gemini demorou demais para responder. Tente de novo.' : 'Não foi possível falar com o Gemini agora. Tente de novo em instantes.')
    }
    const data = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } } | null
    if (!res.ok) throw new GeminiError(res.status, data)
    const c = data?.candidates?.[0]
    const text = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
    if (!text) throw new BadRequestException(data?.promptFeedback?.blockReason || c?.finishReason === 'SAFETY' ? 'O Gemini não quis responder a este pedido. Mude o texto ou o tema.' : 'O Gemini não devolveu texto. Tente de novo.')
    return text
  }

  /**
   * Pede o texto ao modelo preferido. Modelo aposentado ou indisponível para a chave (404, ou 400 falando do modelo):
   * consulta a lista de novo e tenta o próximo, até 3 modelos.
   */
  private async call(s: AiSettings, system: string, prompt: string, temperature: number, extra: GeminiPart[] = [], maxOutputTokens = 1024) {
    if (!s.apiKeyEnc) throw new BadRequestException('Cadastre a chave do Gemini em Configurações → E-mail marketing (é gratuita no Google AI Studio).')
    const apiKey = decrypt(s.apiKeyEnc)
    let list = await this.candidates(apiKey, s.model)
    const tried = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const model = list.find((m) => !tried.has(m))
      if (!model) break
      tried.add(model)
      try {
        return { text: await this.request(apiKey, model, system, prompt, temperature, extra, maxOutputTokens), model }
      } catch (err) {
        if (!(err instanceof GeminiError)) throw err
        const msg = String((err.body as { error?: { message?: string } } | null)?.error?.message ?? '')
        const modelGone = err.status === 404 || (err.status === 400 && /model/i.test(msg) && !/api key/i.test(msg))
        if (!modelGone) throw new BadRequestException(aiError(err.status, err.body))
        this.logger.warn(`Gemini: modelo ${model} indisponível (${err.status}); tentando outro.`)
        list = await this.candidates(apiKey, s.model, true)
      }
    }
    throw new BadRequestException('Nenhum modelo do Gemini disponível para esta chave agora. Confira a chave no Google AI Studio ou tente mais tarde.')
  }

  /**
   * Texto livre com a mesma chave do Gemini (ex.: resumo do Marketing Inteligente). Quem chama manda só dados agregados,
   * nunca dados pessoais de leads.
   */
  async complete(tenantId: string, system: string, prompt: string, maxOutputTokens = 1024) {
    const s = await this.config(tenantId)
    return (await this.call(s, system, prompt, 0.3, [], maxOutputTokens)).text
  }

  /** Texto "sobre a empresa" cadastrado para a IA (usado também nas landing pages). */
  async about(tenantId: string) {
    return (await this.config(tenantId)).about
  }

  /** Há chave do Gemini cadastrada (Configurações → E-mail marketing)? */
  async available(tenantId: string) {
    return !!(await this.config(tenantId)).apiKeyEnc
  }

  /**
   * Transcreve um áudio do chat (mensagem de voz) com a mesma chave do Gemini do e-mail marketing. Só quando alguém
   * pede (botão "Transcrever"): o áudio vai para o Google e o texto volta para a conversa.
   */
  async transcribe(tenantId: string, audio: Buffer, mime: string) {
    const s = await this.config(tenantId)
    if (!s.apiKeyEnc) throw new BadRequestException('Para transcrever áudios, cadastre a chave do Gemini em Configurações → E-mail marketing (é gratuita no Google AI Studio).')
    const r = await this.call(s, TRANSCRIBE_SYSTEM, 'Transcreva este áudio.', 0, [{ inlineData: { mimeType: mime, data: audio.toString('base64') } }], 4096)
    return cleanTranscript(r.text)
  }

  /**
   * Imagem com a mesma chave do Gemini (modelos de imagem, ex.: gemini-2.5-flash-image). A cota gratuita de imagens
   * é pequena e muda: sem cota, avisa para usar uma imagem própria.
   */
  async image(tenantId: string, prompt: string, aspect: '1:1' | '9:16' | '4:5') {
    const s = await this.config(tenantId)
    if (!s.apiKeyEnc) throw new BadRequestException('Para gerar imagens, cadastre a chave do Gemini em Configurações → E-mail marketing (é gratuita no Google AI Studio).')
    const apiKey = decrypt(s.apiKeyEnc)
    let names: string[] = []
    try {
      const res = await fetch(`${GEMINI}?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(10_000), redirect: 'error' })
      if (res.ok) {
        const models = ((await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }).models ?? []
        names = models.filter((m) => /image/i.test(m.name) && /gemini/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''))
      }
    } catch {
      /* sem a lista: tenta os nomes conhecidos */
    }
    const prefer = (n: string) => (/2\.5-flash-image$/.test(n) ? 0 : /2\.5-flash-image/.test(n) ? 1 : /flash.*image/.test(n) ? 2 : 3)
    const list = [...new Set([...names.sort((a, b) => prefer(a) - prefer(b)), 'gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation'])].slice(0, 3)
    let last = 'Nenhum modelo de imagem do Gemini disponível para esta chave.'
    for (const model of list) {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(/2\.5-flash-image/.test(model) ? { imageConfig: { aspectRatio: aspect } } : {}) },
      }
      let res: Response
      try {
        res = await fetch(`${GEMINI}/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS * 2), redirect: 'error' })
      } catch {
        last = 'O Gemini não respondeu a tempo. Tente de novo.'
        continue
      }
      const data = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] } | null
      if (res.status === 429) throw new BadRequestException('A cota gratuita de imagens do Gemini acabou (ou a sua chave não tem imagens no plano gratuito). Use uma imagem própria, uma foto do catálogo ou tente amanhã.')
      if (res.status === 404 || (res.status === 400 && /model|modalit/i.test(JSON.stringify(data ?? '')))) {
        last = `Modelo ${model} indisponível para esta chave.`
        continue
      }
      if (!res.ok) throw new BadRequestException(aiError(res.status, data))
      const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
      if (!part?.inlineData?.data) throw new BadRequestException('O Gemini não devolveu imagem para este pedido. Mude a descrição e tente de novo.')
      return { mime: part.inlineData.mimeType ?? 'image/png', data: part.inlineData.data, model }
    }
    throw new BadRequestException(last)
  }

  async test(user: AuthUser) {
    this.assertCan(user, 'edit')
    const s = await this.config(user.tenantId)
    const r = await this.call(s, 'Responda em português do Brasil, em uma frase curta.', 'Diga "Conexão com o CRM funcionando".', 0)
    return { ok: true, message: `O Gemini respondeu (${r.model}): ${cleanAnswer(r.text).slice(0, 120)}` }
  }

  /** Gera o texto para aprovação: html (para o bloco) e texto puro; para assuntos, uma lista de opções. */
  async generate(user: AuthUser, d: { action: AiAction; html?: string; text?: string; topic?: string }) {
    this.assertCan(user, 'edit')
    const s = await this.config(user.tenantId)
    const company = (await this.settings.branding(user.tenantId)).appName
    const draft = d.html ? htmlToText(d.html) : (d.text ?? '')
    const prompt = userPrompt(d.action, draft, d.topic ?? '')
    if (!prompt) throw new BadRequestException(d.action === 'escrever' ? 'Escreva o tema do e-mail (ex.: promoção de filtros para retroescavadeira JCB).' : 'Escreva algum texto no bloco antes de pedir para a IA.')
    const { text: raw } = await this.call(s, systemPrompt(company, s.about), prompt, d.action === 'corrigir' ? 0.2 : 0.7)
    if (d.action === 'assunto' || d.action === 'preheader') return { options: answerOptions(raw, d.action === 'assunto' ? 5 : 3) }
    return { html: answerHtml(raw), text: cleanAnswer(raw) }
  }
}
