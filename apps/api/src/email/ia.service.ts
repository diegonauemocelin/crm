import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decrypt, encrypt } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { SettingsService } from '../settings/settings.service'
import { htmlToText } from './blocos'
import { type AiAction, AI_MODELS, type AiModel, aiError, answerHtml, answerOptions, cleanAnswer, systemPrompt, userPrompt } from './ia'

interface AiSettings {
  apiKeyEnc: string | null
  model: AiModel
  /** Contexto da empresa para o texto (o que vende, para quem). */
  about: string
}
const DEFAULT_AI: AiSettings = { apiKeyEnc: null, model: 'gemini-2.5-flash', about: '' }
const KEY = 'email_ia'
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Assistente de texto do e-mail marketing pelo Google Gemini (plano gratuito ou pago, conforme a chave). */
@Injectable()
export class EmailAiService {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private assertCan(user: AuthUser, action: 'view' | 'edit') {
    if (!can(user.permissions, user.role.isSystem, 'email_marketing', action)) throw new ForbiddenException('Você não tem permissão para esta ação.')
  }

  private async config(tenantId: string) {
    const s = await this.settings.get<AiSettings>(tenantId, KEY, DEFAULT_AI)
    return { ...DEFAULT_AI, ...s, model: (AI_MODELS as readonly string[]).includes(s.model) ? s.model : DEFAULT_AI.model }
  }

  async view(user: AuthUser) {
    this.assertCan(user, 'view')
    const s = await this.config(user.tenantId)
    return { configured: !!s.apiKeyEnc, model: s.model, about: s.about, models: AI_MODELS }
  }

  async save(user: AuthUser, d: { apiKey?: string; model?: string; about?: string; removeKey?: boolean }, ctx: RequestCtx) {
    this.assertCan(user, 'edit')
    const cur = await this.config(user.tenantId)
    const key = d.apiKey?.trim()
    if (key && !/^[A-Za-z0-9_-]{20,100}$/.test(key)) throw new BadRequestException('Chave do Gemini inválida. Copie a chave inteira do Google AI Studio (começa com AIza...).')
    const next: AiSettings = {
      apiKeyEnc: d.removeKey ? null : key ? encrypt(key) : cur.apiKeyEnc,
      model: (AI_MODELS as readonly string[]).includes(d.model ?? '') ? (d.model as AiModel) : cur.model,
      about: (d.about ?? cur.about).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500),
    }
    await this.settings.set(user.tenantId, KEY, next)
    await this.audit.byUser(user, ctx, 'email.ia_configurada', 'settings', KEY, { chave: next.apiKeyEnc ? (key ? 'nova' : 'mantida') : 'sem chave', modelo: next.model })
    return this.view(user)
  }

  private async call(s: AiSettings, system: string, prompt: string, temperature: number) {
    if (!s.apiKeyEnc) throw new BadRequestException('Cadastre a chave do Gemini em E-mail marketing → Configurações (é gratuita no Google AI Studio).')
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: 1024, ...(s.model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
    }
    let res: Response
    try {
      res = await fetch(`${GEMINI}/${s.model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': decrypt(s.apiKeyEnc) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(40_000),
        redirect: 'error',
      })
    } catch {
      throw new BadRequestException('Não foi possível falar com o Gemini agora. Tente de novo em instantes.')
    }
    const data = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } } | null
    if (!res.ok) throw new BadRequestException(aiError(res.status, data))
    const c = data?.candidates?.[0]
    const text = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
    if (!text) throw new BadRequestException(data?.promptFeedback?.blockReason || c?.finishReason === 'SAFETY' ? 'O Gemini não quis responder a este pedido. Mude o texto ou o tema.' : 'O Gemini não devolveu texto. Tente de novo.')
    return text
  }

  async test(user: AuthUser) {
    this.assertCan(user, 'edit')
    const s = await this.config(user.tenantId)
    const t = await this.call(s, 'Responda em português do Brasil, em uma frase curta.', 'Diga "Conexão com o CRM funcionando".', 0)
    return { ok: true, message: `O Gemini respondeu: ${cleanAnswer(t).slice(0, 120)}` }
  }

  /** Gera o texto para aprovação: html (para o bloco) e texto puro; para assuntos, uma lista de opções. */
  async generate(user: AuthUser, d: { action: AiAction; html?: string; text?: string; topic?: string }) {
    this.assertCan(user, 'edit')
    const s = await this.config(user.tenantId)
    const company = (await this.settings.branding(user.tenantId)).appName
    const draft = d.html ? htmlToText(d.html) : (d.text ?? '')
    const prompt = userPrompt(d.action, draft, d.topic ?? '')
    if (!prompt) throw new BadRequestException(d.action === 'escrever' ? 'Escreva o tema do e-mail (ex.: promoção de filtros para retroescavadeira JCB).' : 'Escreva algum texto no bloco antes de pedir para a IA.')
    const raw = await this.call(s, systemPrompt(company, s.about), prompt, d.action === 'corrigir' ? 0.2 : 0.7)
    if (d.action === 'assunto' || d.action === 'preheader') return { options: answerOptions(raw, d.action === 'assunto' ? 5 : 3) }
    return { html: answerHtml(raw), text: cleanAnswer(raw) }
  }
}
