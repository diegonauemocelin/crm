import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { cleanNextDay, conversationClosed, nextDayWindow } from '../atendimento/regras'
import type { AtendimentoSettings } from '../atendimento/service-records.service'
import type { WhatsappNumber } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ChatService } from './chat.service'
import { applyVariables } from './envio'
import { phoneVariants } from './mensagens'

const TICK_MS = 60_000
/** Por minuto e por empresa: o ritmo do número (20/min) segura o resto para o minuto seguinte. */
const BATCH = 20
const LABEL = 'Mensagem automática (dia seguinte)'

/**
 * Mensagem de WhatsApp do dia seguinte: a partir do horário configurado (Configurações › Mensagens automáticas), quem abriu pré-venda
 * ontem recebe a mensagem, uma vez só, pelo número em que chamou (ou pelo número escolhido na configuração).
 * O resultado fica na pré-venda (enviada ou o motivo) e no histórico dela.
 */
@Injectable()
export class DiaSeguinteService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('DiaSeguinte')
  private timer: NodeJS.Timeout | null = null
  private running = false

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
        const config = cleanNextDay((row.value as Partial<AtendimentoSettings> | null)?.nextDayMessage)
        if (!config.enabled) continue
        await this.runTenant(row.tenantId, config, now).catch((err: unknown) => this.logger.warn(`Mensagem do dia seguinte não enviada: ${(err as Error).message}`))
      }
    } finally {
      this.running = false
    }
  }

  private async runTenant(tenantId: string, config: ReturnType<typeof cleanNextDay>, now: Date) {
    const window = nextDayWindow(config.time, now)
    if (!window) return
    const day = { gte: window.from, lt: window.to }
    // Só repassadas: o dia seguinte conta do repasse ao vendedor (sem a data do repasse, do dia em que o cliente chamou).
    const when = config.onlyForwarded ? { forwarded: true, OR: [{ forwardedAt: day }, { forwardedAt: null, leadAt: day }] } : { leadAt: day }
    const records = await this.prisma.serviceRecord.findMany({
      where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, importBatch: null, phone: { not: null }, autoMessageAt: null, saleStatus: { in: config.saleStatuses }, ...when },
      orderBy: { leadAt: 'asc' },
      take: BATCH,
      select: { id: true, name: true, phone: true, leadId: true, leadAt: true, seller: { select: { name: true } } },
    })
    if (!records.length) return
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { tenantId, deletedAt: null, status: 'CONECTADO' }, orderBy: { createdAt: 'asc' } })
    // Sem número conectado não marca nada: tenta de novo no próximo minuto.
    if (!numbers.length) return
    const fallback = numbers.find((n) => n.id === config.numberId) ?? numbers[0]!
    for (const r of records) {
      // Atendimento finalizado ou conversa arquivada: não manda, e fica registrado o motivo.
      if (conversationClosed(await this.conversationOf(tenantId, r.id, r.phone!), r.leadAt)) {
        await this.prisma.serviceRecord.updateMany({ where: { id: r.id, autoMessageAt: null }, data: { autoMessageAt: new Date(), autoMessageStatus: 'NÃO ENVIADA: conversa finalizada ou arquivada' } })
        continue
      }
      const number = (await this.numberOf(tenantId, r.id, r.phone!, numbers)) ?? fallback
      // Marca antes de enviar: dois servidores (ou dois minutos) não mandam a mesma mensagem duas vezes.
      const claimed = await this.prisma.serviceRecord.updateMany({ where: { id: r.id, autoMessageAt: null }, data: { autoMessageAt: new Date(), autoMessageStatus: 'ENVIANDO' } })
      if (!claimed.count) continue
      const text = applyVariables(config.text, { nome: r.name, vendedor: r.seller?.name })
      try {
        const sent = await this.chat.sendAutomatic(number, r.phone!, text, LABEL, { leadId: r.leadId, recordId: r.id, name: r.name })
        if (!sent) {
          // Número no limite de envio: volta para a fila e sai no próximo minuto.
          await this.prisma.serviceRecord.update({ where: { id: r.id }, data: { autoMessageAt: null, autoMessageStatus: null } })
          return
        }
        await this.prisma.serviceRecord.update({
          where: { id: r.id },
          data: { autoMessageStatus: 'ENVIADA', history: { create: { userName: 'Sistema', action: `enviou a mensagem automática do dia seguinte (WhatsApp ${number.name}) sobre`, changes: {} } } },
        })
      } catch (err) {
        const reason = ((err as Error).message || 'erro desconhecido').slice(0, 300)
        await this.prisma.serviceRecord.update({
          where: { id: r.id },
          data: { autoMessageStatus: `ERRO: ${reason}`, history: { create: { userName: 'Sistema', action: 'não conseguiu enviar a mensagem automática do dia seguinte sobre', changes: { motivo: { de: null, para: reason } } } } },
        })
      }
    }
  }

  /** Conversa do cliente: a ligada à pré-venda ou, sem ela, a mais recente com o telefone (em qualquer número). */
  private async conversationOf(tenantId: string, recordId: string, phone: string) {
    const select = { status: true, closedAt: true }
    return (
      (await this.prisma.whatsappConversation.findFirst({ where: { tenantId, recordId }, orderBy: { lastMessageAt: 'desc' }, select })) ??
      (await this.prisma.whatsappConversation.findFirst({ where: { tenantId, phone: { in: phoneVariants(phone) } }, orderBy: { lastMessageAt: 'desc' }, select }))
    )
  }

  /** Número em que o cliente chamou: o da conversa ligada à pré-venda ou, sem ela, o da conversa mais recente com o telefone. */
  private async numberOf(tenantId: string, recordId: string, phone: string, connected: WhatsappNumber[]) {
    const ids = connected.map((n) => n.id)
    const conv =
      (await this.prisma.whatsappConversation.findFirst({ where: { tenantId, recordId, numberId: { in: ids } }, select: { numberId: true } })) ??
      (await this.prisma.whatsappConversation.findFirst({ where: { tenantId, phone, numberId: { in: ids } }, orderBy: { lastMessageAt: 'desc' }, select: { numberId: true } }))
    return conv ? connected.find((n) => n.id === conv.numberId) : undefined
  }
}
