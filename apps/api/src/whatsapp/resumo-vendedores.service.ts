import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { normalizePhone } from '../atendimento/br'
import { cleanDigest, digestFor, digestMessages, saleSituation, type SellerDigest, todayWindow } from '../atendimento/regras'
import type { AtendimentoSettings } from '../atendimento/service-records.service'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ChatService } from './chat.service'

const TICK_MS = 60_000
const LABEL = 'Resumo do dia (automático)'

/** O que já saiu hoje: vendedor -> ENVIADA, SEM_TELEFONE, ERRO: motivo ou ENVIANDO:n (n mensagens já foram). */
interface DigestLog {
  day?: string
  sellers?: Record<string, string>
}

/**
 * Resumo do dia para cada vendedor: a partir do horário configurado (Configurações › Mensagens automáticas, padrão 18h), cada vendedor
 * escolhido recebe no WhatsApp dele os clientes da pré-venda repassados a ele no dia (telefone, nome e situação da venda), uma vez por dia.
 */
@Injectable()
export class ResumoVendedoresService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ResumoVendedores')
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
        const config = cleanDigest((row.value as Partial<AtendimentoSettings> | null)?.sellerDigest)
        if (!config.enabled) continue
        await this.runTenant(row.tenantId, config, now).catch((err: unknown) => this.logger.warn(`Resumo do dia não enviado: ${(err as Error).message}`))
      }
    } finally {
      this.running = false
    }
  }

  private async runTenant(tenantId: string, config: SellerDigest, now: Date) {
    const w = todayWindow(config.time, now)
    if (!w.due) return
    const saved = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: 'seller_digest_log' } } })
    const log: DigestLog = (saved?.value as DigestLog | null)?.day === w.day ? (saved!.value as DigestLog) : { day: w.day, sellers: {} }
    const done = log.sellers ?? {}
    const records = await this.prisma.serviceRecord.findMany({
      where: { tenantId, kind: 'PRE_VENDAS', deletedAt: null, forwarded: true, sellerId: { not: null }, forwardedAt: { gte: w.from, lt: w.to } },
      orderBy: { forwardedAt: 'asc' },
      select: { name: true, phone: true, saleStatus: true, lostReason: { select: { name: true } }, seller: { select: { id: true, name: true, phone: true, active: true } } },
    })
    const groups = new Map<string, { seller: NonNullable<(typeof records)[number]['seller']>; items: { name: string; phone: string | null; situation: string }[] }>()
    for (const r of records) {
      const status = r.seller ? done[r.seller.id] : undefined
      if (!r.seller || !r.seller.active || (status && !status.startsWith('ENVIANDO:')) || !digestFor(config, r.seller.id)) continue
      const g = groups.get(r.seller.id) ?? { seller: r.seller, items: [] }
      g.items.push({ name: r.name, phone: r.phone, situation: saleSituation(r.saleStatus, r.lostReason?.name) })
      groups.set(r.seller.id, g)
    }
    if (!groups.size) return
    const numbers = await this.prisma.whatsappNumber.findMany({ where: { tenantId, deletedAt: null, status: 'CONECTADO' }, orderBy: { createdAt: 'asc' } })
    // Sem número conectado: tenta de novo no próximo minuto (até o fim do dia).
    if (!numbers.length) return
    const number = numbers.find((n) => n.id === config.numberId) ?? numbers[0]!
    const save = (sellerId: string, status: string) => {
      done[sellerId] = status
      const value = { day: w.day, sellers: done } as unknown as Prisma.InputJsonValue
      return this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: 'seller_digest_log' } }, create: { tenantId, key: 'seller_digest_log', value }, update: { value } })
    }
    for (const { seller, items } of groups.values()) {
      const phone = seller.phone ? normalizePhone(seller.phone) : null
      if (!phone) {
        await save(seller.id, 'SEM_TELEFONE')
        continue
      }
      const messages = digestMessages(config.text, seller.name, w.day, items, config.split)
      // Muitos clientes (uma mensagem por cliente) podem passar do ritmo do número: continua no próximo minuto de onde parou.
      const start = Number(/^ENVIANDO:(\d+)$/.exec(done[seller.id] ?? '')?.[1] ?? 0)
      try {
        for (let i = start; i < messages.length; i++) {
          const sent = await this.chat.sendAutomatic(number, phone, messages[i]!, LABEL, { leadId: null, recordId: null, name: seller.name, colleague: true })
          if (!sent) {
            if (i > start) await save(seller.id, `ENVIANDO:${i}`)
            return
          }
        }
        await save(seller.id, 'ENVIADA')
      } catch (err) {
        await save(seller.id, `ERRO: ${((err as Error).message || 'erro desconhecido').slice(0, 300)}`)
      }
    }
  }
}
