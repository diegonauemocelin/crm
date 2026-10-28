import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { cleanReactivation, nextGapMs, type Reactivation, REACTIVATION_STEPS, reactivationText } from '../atendimento/regras'
import type { AtendimentoSettings } from '../atendimento/service-records.service'
import { PrismaService } from '../prisma/prisma.service'
import { ChatService } from './chat.service'
import { applyVariables, isOpen } from './envio'
import { phoneVariants } from './mensagens'

const TICK_MS = 60_000
const BATCH = 20
const DAY_MS = 86_400_000
const LABEL = 'Mensagem automática (chamar o cliente de novo)'

/**
 * Chamar o cliente de novo (Cadastros › Mensagens automáticas): depois que a pré-venda fechou, sem venda ou com venda
 * (recompra), até 3 mensagens, cada uma X dias depois do resultado, todas pelo número escolhido. Só no horário
 * comercial, com intervalo sorteado entre uma e outra (padrão 2 a 10 minutos). Para quando o cliente responde a uma
 * delas ou volta a falar com a empresa (pré-venda nova). Ligar não dispara para a base antiga: só as mensagens que
 * vencem depois disso.
 */
@Injectable()
export class ReativacaoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Reativacao')
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
        const config = cleanReactivation((row.value as Partial<AtendimentoSettings> | null)?.reactivation)
        if (!config.enabled || !config.since || !config.numberId) continue
        await this.runTenant(row.tenantId, config, now).catch((err: unknown) => this.logger.warn(`Não chamou os clientes de novo: ${(err as Error).message}`))
      }
    } finally {
      this.running = false
    }
  }

  async runTenant(tenantId: string, config: Reactivation, now: Date) {
    if (!isOpen((await this.chat.rules(tenantId)).businessHours, now)) return
    const number = await this.prisma.whatsappNumber.findFirst({ where: { id: config.numberId!, tenantId, deletedAt: null } })
    // Número desconectado: espera ele voltar (nada é perdido).
    if (number?.status !== 'CONECTADO') return
    if (now.getTime() < (await this.releasedAt(number.id, config))) return
    const since = Date.parse(config.since!)
    for (const [saleStatus, steps] of [['NAO', config.lost], ['SIM', config.sold]] as const) {
      // Da última para a primeira: quem tem duas vencidas (servidor parado) recebe só a mais recente.
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i]!
        if (!step.enabled) continue
        const days = step.days * DAY_MS
        const records = await this.prisma.serviceRecord.findMany({
          where: {
            tenantId,
            kind: 'PRE_VENDAS',
            deletedAt: null,
            importBatch: null,
            phone: { not: null },
            saleStatus,
            reactivationStep: { lte: i },
            // Venceu agora, e depois de ligada.
            resultAt: { lte: new Date(now.getTime() - days), gte: new Date(since - days) },
          },
          orderBy: { resultAt: 'asc' },
          take: BATCH,
          select: { id: true, name: true, phone: true, leadId: true, resultAt: true, reactivationAt: true, brandIds: true, seller: { select: { name: true } } },
        })
        for (const r of records) {
          const stop = await this.stopReason(tenantId, r)
          if (stop) {
            await this.prisma.serviceRecord.update({ where: { id: r.id }, data: { reactivationStep: REACTIVATION_STEPS, reactivationStatus: `PAROU: ${stop}` } })
            continue
          }
          const claimed = await this.prisma.serviceRecord.updateMany({ where: { id: r.id, reactivationStep: { lte: i } }, data: { reactivationStep: i + 1, reactivationAt: now, reactivationStatus: 'ENVIANDO' } })
          if (!claimed.count) continue
          const brands = r.brandIds.length ? await this.prisma.lookupItem.findMany({ where: { id: { in: r.brandIds } }, select: { name: true }, orderBy: { name: 'asc' } }) : []
          const text = applyVariables(reactivationText(step.text, { marcas: brands.map((b) => b.name) }), { nome: r.name, vendedor: r.seller?.name })
          const what = `a ${i + 1}ª mensagem para chamar o cliente de novo (${saleStatus === 'SIM' ? 'comprou' : 'sem venda'}, ${step.days} dias)`
          try {
            const sent = await this.chat.sendAutomatic(number, r.phone!, text, LABEL, { leadId: r.leadId, recordId: r.id, name: r.name })
            if (!sent) {
              // Limite de envios do número: tenta de novo na próxima volta.
              await this.prisma.serviceRecord.update({ where: { id: r.id }, data: { reactivationStep: i, reactivationAt: r.reactivationAt, reactivationStatus: null } })
              return
            }
            await this.prisma.serviceRecord.update({
              where: { id: r.id },
              data: { reactivationStatus: 'ENVIADA', history: { create: { userName: 'Sistema', action: `enviou ${what} (WhatsApp ${number.name}) sobre`, changes: {} } } },
            })
          } catch (err) {
            const reason = ((err as Error).message || 'erro desconhecido').slice(0, 300)
            await this.prisma.serviceRecord.update({
              where: { id: r.id },
              data: { reactivationStatus: `ERRO: ${reason}`, history: { create: { userName: 'Sistema', action: `não conseguiu enviar ${what} sobre`, changes: { motivo: { de: null, para: reason } } } } },
            })
          }
          // Uma por volta: a próxima espera o intervalo sorteado.
          this.nextAt.set(number.id, now.getTime() + nextGapMs(config, this.random))
          return
        }
      }
    }
  }

  /** O cliente já voltou: respondeu a uma mensagem anterior da sequência ou abriu uma pré-venda nova depois do resultado. */
  private async stopReason(tenantId: string, r: { id: string; phone: string | null; leadId: string | null; resultAt: Date | null; reactivationAt: Date | null }) {
    const phones = { in: phoneVariants(r.phone!) }
    const newer = await this.prisma.serviceRecord.count({
      where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, id: { not: r.id }, leadAt: { gt: r.resultAt! }, OR: [{ phone: phones }, ...(r.leadId ? [{ leadId: r.leadId }] : [])] },
    })
    if (newer) return 'cliente voltou a falar com a empresa (pré-venda nova)'
    if (r.reactivationAt) {
      const replied = await this.prisma.whatsappMessage.count({ where: { tenantId, fromMe: false, internal: false, sentAt: { gt: r.reactivationAt }, conversation: { phone: phones } } })
      if (replied) return 'cliente respondeu'
    }
    return null
  }

  private async releasedAt(numberId: string, config: { gapMin: number }) {
    const known = this.nextAt.get(numberId)
    if (known !== undefined) return known
    const last = await this.prisma.whatsappMessage.findFirst({ where: { sentByName: LABEL, conversation: { numberId } }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } })
    const at = last ? last.sentAt.getTime() + config.gapMin * 60_000 : 0
    this.nextAt.set(numberId, at)
    return at
  }
}
