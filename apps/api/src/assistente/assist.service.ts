import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { decrypt, encrypt } from '../common/crypto'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import {
  AI_DEFAULTS,
  OLD_UPSELL_RULES,
  AI_KEY,
  type AiSettings,
  type AssistState,
  INTEGRATION_DEFAULTS,
  INTEGRATION_KEY,
  type IntegrationSettings,
  PENDING_STATUSES,
  QUESTION_STATUSES,
  SECRET_KEY,
  STATE_KEY,
  STORE_KEY,
  type StoreSettings,
} from './constantes'

export interface Actor {
  id: string | null
  name: string | null
}
export const SYSTEM: Actor = { id: null, name: null }

interface SecretRow {
  enc?: string
  masked?: string
  updated_at?: string
  updated_by?: string
}

/** Exibe só o começo e o fim de um segredo. */
export const mask = (s: string) => (s.length <= 8 ? '••••' : `${s.slice(0, 4)}••••${s.slice(-4)}`)

/** Base do assistente: configurações, chaves de IA, registro e trajetória das perguntas. */
@Injectable()
export class AssistService {
  private readonly logger = new Logger('Assistente')

  constructor(
    readonly prisma: PrismaService,
    readonly settings: SettingsService,
  ) {}

  // ---------- Configurações ----------

  async ai(tenantId: string): Promise<AiSettings> {
    const s = { ...AI_DEFAULTS, ...(await this.settings.get<Partial<AiSettings>>(tenantId, AI_KEY, {})) }
    // regra padrão antiga ("apenas aplicação confirmada") segurava a venda adicional: passa para a nova
    if (s.upsell_rules.trim() === OLD_UPSELL_RULES) s.upsell_rules = AI_DEFAULTS.upsell_rules
    return s
  }
  async saveAi(tenantId: string, s: AiSettings) {
    return this.settings.set(tenantId, AI_KEY, s)
  }
  async store(tenantId: string): Promise<StoreSettings> {
    return { seller_id: null, ...(await this.settings.get<Partial<StoreSettings>>(tenantId, STORE_KEY, {})) }
  }
  async saveStore(tenantId: string, s: StoreSettings) {
    return this.settings.set(tenantId, STORE_KEY, s)
  }
  async integration(tenantId: string): Promise<IntegrationSettings> {
    return { ...INTEGRATION_DEFAULTS, ...(await this.settings.get<Partial<IntegrationSettings>>(tenantId, INTEGRATION_KEY, {})) }
  }
  async saveIntegration(tenantId: string, s: IntegrationSettings) {
    return this.settings.set(tenantId, INTEGRATION_KEY, s)
  }
  async state(tenantId: string): Promise<AssistState> {
    return this.settings.get<AssistState>(tenantId, STATE_KEY, {})
  }
  async patchState(tenantId: string, patch: AssistState) {
    return this.settings.set(tenantId, STATE_KEY, { ...(await this.state(tenantId)), ...patch })
  }

  /** Registro curto do que aconteceu com o Mercado Livre (mostrado na tela de integração). */
  async log(tenantId: string, level: 'info' | 'warn' | 'error', message: string) {
    if (level === 'error') this.logger.warn(message)
    const st = await this.state(tenantId)
    const logs = [{ level, message: message.slice(0, 500), at: new Date().toISOString() }, ...(st.logs ?? [])].slice(0, 30)
    await this.patchState(tenantId, { logs, ...(level === 'error' ? { lastError: message.slice(0, 1000), lastErrorAt: new Date().toISOString() } : {}) })
  }

  // ---------- Chaves de IA (criptografadas; nunca voltam inteiras para a tela) ----------

  async apiKey(tenantId: string, provider: 'claude' | 'gemini'): Promise<string | null> {
    const r = await this.settings.get<SecretRow>(tenantId, SECRET_KEY(provider), {})
    if (!r.enc) return null
    try {
      return decrypt(r.enc)
    } catch {
      return null
    }
  }
  async keyStatus(tenantId: string, provider: 'claude' | 'gemini') {
    const r = await this.settings.get<SecretRow>(tenantId, SECRET_KEY(provider), {})
    return r.enc ? { source: 'painel', masked: r.masked ?? null, updated_at: r.updated_at ?? null, updated_by: r.updated_by ?? null } : { source: null }
  }
  async saveApiKey(tenantId: string, provider: 'claude' | 'gemini', key: string, by: string) {
    await this.settings.set(tenantId, SECRET_KEY(provider), { enc: encrypt(key), masked: mask(key), updated_at: new Date().toISOString(), updated_by: by })
  }
  async removeApiKey(tenantId: string, provider: 'claude' | 'gemini') {
    await this.settings.set(tenantId, SECRET_KEY(provider), {})
  }

  // ---------- Trajetória da pergunta ----------

  async addEvent(tenantId: string, questionId: number, type: string, o: { from?: string | null; to?: string | null; actor?: Actor; note?: string | null; data?: Record<string, unknown> } = {}) {
    await this.prisma.assistEvent.create({
      data: {
        tenantId,
        questionId,
        type,
        fromStatus: o.from ?? null,
        toStatus: o.to ?? null,
        userId: o.actor?.id ?? null,
        userName: o.actor?.name ?? null,
        note: o.note ?? null,
        data: (o.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
  }

  /** Altera a situação preservando o histórico. */
  async setStatus(tenantId: string, questionId: number, status: string, o: { actor?: Actor; note?: string | null; reason?: string | null; type?: string } = {}) {
    if (!QUESTION_STATUSES.includes(status)) throw new BadRequestException('Situação inválida.')
    const q = await this.prisma.assistQuestion.findFirst({ where: { id: questionId, tenantId } })
    if (!q) throw new NotFoundException('Pergunta não encontrada.')
    const now = new Date()
    const pending = PENDING_STATUSES.includes(status) && status !== 'nova'
    await this.prisma.assistQuestion.update({
      where: { id: q.id },
      data: {
        status,
        pendingReason: pending ? (o.reason ?? q.pendingReason) : null,
        pendingSince: pending ? (q.pendingSince ?? now) : q.pendingSince,
        answeredAt: status === 'respondida' ? (q.answeredAt ?? now) : q.answeredAt,
        resolvedAt: ['resolvida', 'respondida', 'nao_aplicavel'].includes(status) ? now : null,
      },
    })
    if (q.status !== status || o.reason) await this.addEvent(tenantId, q.id, o.type ?? 'status', { from: q.status, to: status, actor: o.actor, note: o.note, data: o.reason ? { reason: o.reason } : undefined })
    return q
  }
}
