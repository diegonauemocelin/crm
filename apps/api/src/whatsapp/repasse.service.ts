import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { cleanContactCheck, cleanForwardMessage, conversationClosed, type ForwardMessage, nextDayRoute, nextGapMs } from '../atendimento/regras'
import type { AtendimentoSettings } from '../atendimento/service-records.service'
import { PrismaService } from '../prisma/prisma.service'
import { ChatService } from './chat.service'
import { applyVariables, isOpen, subBusinessMs } from './envio'
import { phoneVariants } from './mensagens'

const TICK_MS = 60_000
const BATCH = 20
/**
 * As duas mensagens do repasse: a de aviso (na hora, ou depois do tempo escolhido) e a que pergunta se o vendedor já
 * entrou em contato (padrão: 30 minutos depois). Cada uma grava o próprio resultado na pré-venda.
 */
const KINDS = {
  forward: { setting: 'forwardMessage', clean: cleanForwardMessage, at: 'forwardMessageAt', status: 'forwardMessageStatus', label: 'Mensagem automática (depois do repasse)', what: 'a mensagem automática depois do repasse', needsSeller: false },
  check: { setting: 'contactCheck', clean: cleanContactCheck, at: 'contactCheckAt', status: 'contactCheckStatus', label: 'Mensagem automática (o vendedor já chamou?)', what: 'a pergunta se o vendedor já entrou em contato', needsSeller: true },
} as const
type Kind = keyof typeof KINDS
/** Repasse mais antigo que isto não recebe mais (servidor parado, número desconectado por dias). */
const MAX_AGE_MS = 3 * 86_400_000

/**
 * Mensagens do repasse ao vendedor (Cadastros › Alertas e mensagens): a de aviso, na hora do repasse (ou depois do
 * tempo escolhido), e a que pergunta se o vendedor já entrou em contato (padrão: 30 minutos). O tempo conta no horário
 * comercial, quando ele está ligado. Cada uma vai uma vez só, pelo número em que o cliente foi atendido. Só pré-venda ainda em negociação, e nunca de madrugada ou com o atendimento finalizado.
 * O resultado fica na pré-venda e no histórico dela.
 */
@Injectable()
export class RepasseService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Repasse')
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly nextAt = new Map<string, number>()
  random = Math.random

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async tick(now = new Date()) {
    if (this.running) return
    this.running = true
    try {
      const rows = await this.prisma.tenantSetting.findMany({ where: { key: 'atendimento' }, select: { tenantId: true, value: true } })
      for (const row of rows) {
        for (const kind of Object.keys(KINDS) as Kind[]) {
          const k = KINDS[kind]
          const config = k.clean((row.value as Partial<AtendimentoSettings> | null)?.[k.setting])
          if (!config.enabled || !config.since) continue
          await this.runTenant(row.tenantId, config, now, kind).catch((err: unknown) => this.logger.warn(`Não enviou ${k.what}: ${(err as Error).message}`))
        }
      }
    } finally {
      this.running = false
    }
  }

  async runTenant(tenantId: string, config: ForwardMessage, now: Date, kind: Kind = 'forward') {
    const k = KINDS[kind]
    const hours = (await this.chat.rules(tenantId)).businessHours
    // Fora do horário comercial nada sai: o que venceu de noite vai na abertura.
    if (!isOpen(hours, now)) return
    const due = subBusinessMs(hours, now, config.delayMinutes * 60_000)
    const oldest = new Date(Math.max(Date.parse(config.since!), now.getTime() - MAX_AGE_MS))
    const records = await this.prisma.serviceRecord.findMany({
      where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, importBatch: null, phone: { not: null }, forwarded: true, saleStatus: 'NEGOCIACAO', [k.at]: null, ...(k.needsSeller ? { sellerId: { not: null } } : {}), forwardedAt: { gte: oldest, lte: due } },
      orderBy: { forwardedAt: 'asc' },
      take: BATCH,
      select: { id: true, name: true, phone: true, leadId: true, leadAt: true, seller: { select: { name: true } } },
    })
    if (!records.length) return
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { tenantId, deletedAt: null, status: 'CONECTADO' }, orderBy: { createdAt: 'asc' } })
    const connected = numbers.map((n) => n.id)
    const skip = (id: string, reason: string) =>
      this.prisma.serviceRecord.updateMany({ where: { id, [k.at]: null }, data: { [k.at]: new Date(), [k.status]: `NÃO ENVIADA: ${reason}` } })
    for (const r of records) {
      const conv = await this.conversationOf(tenantId, r.id, r.phone!, config.numberIds)
      if (conversationClosed(conv, r.leadAt)) {
        await skip(r.id, 'conversa finalizada ou arquivada')
        continue
      }
      const route = nextDayRoute(conv, config, connected)
      if ('skip' in route) {
        await skip(r.id, route.skip)
        continue
      }
      if ('wait' in route) continue
      const number = numbers.find((n) => n.id === route.send)!
      if (now.getTime() < (await this.releasedAt(number.id, config, kind))) continue
      const claimed = await this.prisma.serviceRecord.updateMany({ where: { id: r.id, [k.at]: null }, data: { [k.at]: new Date(), [k.status]: 'ENVIANDO' } })
      if (!claimed.count) continue
      const text = applyVariables(config.text, { nome: r.name, vendedor: r.seller?.name })
      try {
        const sent = await this.chat.sendAutomatic(number, r.phone!, text, k.label, { leadId: r.leadId, recordId: r.id, name: r.name })
        if (!sent) {
          await this.prisma.serviceRecord.update({ where: { id: r.id }, data: { [k.at]: null, [k.status]: null } })
          return
        }
        this.nextAt.set(`${kind}:${number.id}`, now.getTime() + nextGapMs(config, this.random))
        await this.prisma.serviceRecord.update({
          where: { id: r.id },
          data: { [k.status]: 'ENVIADA', history: { create: { userName: 'Sistema', action: `enviou ${k.what} (WhatsApp ${number.name}) sobre`, changes: {} } } },
        })
      } catch (err) {
        const reason = ((err as Error).message || 'erro desconhecido').slice(0, 300)
        await this.prisma.serviceRecord.update({
          where: { id: r.id },
          data: { [k.status]: `ERRO: ${reason}`, history: { create: { userName: 'Sistema', action: `não conseguiu enviar ${k.what} sobre`, changes: { motivo: { de: null, para: reason } } } } },
        })
      }
    }
  }

  private async releasedAt(numberId: string, config: { gapMin: number }, kind: Kind) {
    const key = `${kind}:${numberId}`
    const known = this.nextAt.get(key)
    if (known !== undefined) return known
    const last = await this.prisma.whatsappMessage.findFirst({ where: { sentByName: KINDS[kind].label, conversation: { numberId } }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } })
    const at = last ? last.sentAt.getTime() + config.gapMin * 60_000 : 0
    this.nextAt.set(key, at)
    return at
  }

  /** Conversa do cliente: a ligada à pré-venda; sem ela, a mais recente com o telefone nos números escolhidos ou em qualquer um. */
  private async conversationOf(tenantId: string, recordId: string, phone: string, numberIds: string[]) {
    const select = { numberId: true, status: true, closedAt: true }
    const orderBy = { lastMessageAt: 'desc' as const }
    const phones = { in: phoneVariants(phone) }
    return (
      (await this.prisma.whatsappConversation.findFirst({ where: { tenantId, recordId }, orderBy, select })) ??
      (await this.prisma.whatsappConversation.findFirst({ where: { tenantId, phone: phones, numberId: { in: numberIds } }, orderBy, select })) ??
      (await this.prisma.whatsappConversation.findFirst({ where: { tenantId, phone: phones }, orderBy, select }))
    )
  }
}
