import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { cleanNextDay, conversationClosed, nextDayRoute, nextDayWindow, nextGapMs } from '../atendimento/regras'
import type { AtendimentoSettings } from '../atendimento/service-records.service'
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
  /** Próximo envio liberado em cada número (intervalo sorteado entre as mensagens). */
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
    const connected = numbers.map((n) => n.id)
    const skip = (id: string, reason: string) =>
      this.prisma.serviceRecord.updateMany({ where: { id, autoMessageAt: null }, data: { autoMessageAt: new Date(), autoMessageStatus: `NÃO ENVIADA: ${reason}` } })
    for (const r of records) {
      const conv = await this.conversationOf(tenantId, r.id, r.phone!, config.numberIds)
      // Atendimento finalizado ou conversa arquivada: não manda, e fica registrado o motivo.
      if (conversationClosed(conv, r.leadAt)) {
        await skip(r.id, 'conversa finalizada ou arquivada')
        continue
      }
      const route = nextDayRoute(conv, config, connected)
      if ('skip' in route) {
        await skip(r.id, route.skip)
        continue
      }
      // Número escolhido desconectado: tenta de novo no próximo minuto (nunca por outro número).
      if ('wait' in route) continue
      const number = numbers.find((n) => n.id === route.send)!
      // Uma mensagem por vez em cada número, com o intervalo sorteado: as outras ficam para os próximos minutos.
      if (now.getTime() < (await this.releasedAt(number.id, config))) continue
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
        this.nextAt.set(number.id, now.getTime() + nextGapMs(config, this.random))
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

  /** Quando o número pode mandar a próxima: depois de reiniciar o servidor, conta do último envio gravado (com o intervalo mínimo). */
  private async releasedAt(numberId: string, config: { gapMin: number }) {
    const known = this.nextAt.get(numberId)
    if (known !== undefined) return known
    const last = await this.prisma.whatsappMessage.findFirst({ where: { sentByName: LABEL, conversation: { numberId } }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } })
    const at = last ? last.sentAt.getTime() + config.gapMin * 60_000 : 0
    this.nextAt.set(numberId, at)
    return at
  }

  /**
   * Conversa do cliente: a ligada à pré-venda; sem ela, a mais recente com o telefone nos números escolhidos e, por
   * último, em qualquer número (atendimento por outro número não recebe).
   */
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
