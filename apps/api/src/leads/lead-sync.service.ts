import { Injectable, Logger } from '@nestjs/common'
import type { Prisma, ServiceKind } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LeadConfigService } from './lead-config.service'

interface RecordShape {
  id: string
  tenantId: string
  kind: ServiceKind
  leadAt: Date
  name: string
  phone: string | null
  email: string | null
  state: string | null
  city: string | null
  country: string
  sellerId: string | null
  unitId: string | null
  originId: string | null
  saleStatus: 'SIM' | 'NAO' | 'NEGOCIACAO'
  saleValue: Prisma.Decimal | number | null
  leadId: string | null
}

const KIND_LABEL: Record<ServiceKind, string> = { PRE_VENDAS: 'Pré-Vendas', POS_VENDAS: 'Pós-Vendas' }

/**
 * Liga os atendimentos de Pré/Pós-Vendas à base de leads.
 * Cada atendimento encontra o lead pelo telefone ou e-mail; se não houver, cria um lead novo.
 * Venda realizada torna o lead "Cliente" e alimenta a última venda.
 */
@Injectable()
export class LeadSyncService {
  private readonly logger = new Logger(LeadSyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LeadConfigService,
  ) {}

  private async findLead(tenantId: string, phone: string | null, email: string | null) {
    const or: Prisma.LeadWhereInput[] = []
    if (phone) or.push({ phone })
    if (email) or.push({ email })
    if (!or.length) return null
    return this.prisma.lead.findFirst({ where: { tenantId, deletedAt: null, anonymizedAt: null, OR: or }, orderBy: { createdAt: 'asc' } })
  }

  /** Chamado ao criar/alterar um atendimento. Falhas aqui nunca impedem o registro do atendimento. */
  async syncRecord(record: RecordShape, previous?: { saleStatus: string } | null) {
    try {
      await this.syncOne(record, previous ?? null, true)
    } catch (err) {
      this.logger.error(`Falha ao vincular o atendimento ${record.id} ao lead: ${(err as Error).message}`)
    }
  }

  private async syncOne(record: RecordShape, previous: { saleStatus: string } | null, rescore: boolean) {
    if (!record.phone && !record.email) return null
    let lead = record.leadId ? await this.prisma.lead.findFirst({ where: { id: record.leadId, deletedAt: null } }) : null
    lead ??= await this.findLead(record.tenantId, record.phone, record.email)
    const events: Prisma.LeadEventCreateManyLeadInput[] = []
    const created = !lead

    if (!lead) {
      lead = await this.prisma.lead.create({
        data: {
          tenantId: record.tenantId,
          name: record.name,
          phone: record.phone,
          email: record.email,
          state: record.state,
          city: record.city,
          country: record.country,
          ownerId: record.sellerId,
          unitId: record.unitId,
          originId: record.originId,
          firstConversionAt: record.leadAt,
          lastConversionAt: record.leadAt,
          firstConversion: { origem: `Atendimento de ${KIND_LABEL[record.kind]}` },
          lastActivityAt: record.leadAt,
          events: { create: { tenantId: record.tenantId, type: 'criado', title: `Lead criado a partir de um atendimento de ${KIND_LABEL[record.kind]}`, occurredAt: record.leadAt } },
        },
      })
    }

    if (record.leadId !== lead.id) {
      await this.prisma.serviceRecord.update({ where: { id: record.id }, data: { leadId: lead.id } })
      events.push({ tenantId: record.tenantId, type: 'atendimento', title: `Atendimento de ${KIND_LABEL[record.kind]}`, data: { recordId: record.id }, occurredAt: record.leadAt })
    }

    const data: Prisma.LeadUncheckedUpdateInput = {}
    if (!lead.email && record.email) data.email = record.email
    if (!lead.phone && record.phone) data.phone = record.phone
    if (!lead.unitId && record.unitId) data.unitId = record.unitId
    if (!lead.ownerId && record.sellerId) data.ownerId = record.sellerId
    if (!lead.lastActivityAt || lead.lastActivityAt < record.leadAt) data.lastActivityAt = record.leadAt

    const soldNow = record.saleStatus === 'SIM' && previous?.saleStatus !== 'SIM'
    if (soldNow) {
      const value = record.saleValue === null ? null : Number(record.saleValue)
      if (!lead.lastSaleAt || lead.lastSaleAt <= record.leadAt) {
        data.lastSaleAt = record.leadAt
        data.lastSaleValue = value
      }
      if (lead.stage !== 'CLIENTE') {
        data.stage = 'CLIENTE'
        events.push({ tenantId: record.tenantId, type: 'estagio', title: 'Estágio: virou Cliente (venda registrada no atendimento)', occurredAt: record.leadAt })
      }
      events.push({
        tenantId: record.tenantId,
        type: 'venda',
        title: `Venda registrada em ${KIND_LABEL[record.kind]}${value ? ` — ${value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}`,
        data: { recordId: record.id, valor: value },
        occurredAt: record.leadAt,
      })
    }

    if (Object.keys(data).length || events.length) {
      // E-mail/telefone novos podem já pertencer a outro lead: nesse caso não sobrescreve.
      if (data.email && (await this.prisma.lead.count({ where: { tenantId: record.tenantId, email: data.email as string } }))) delete data.email
      await this.prisma.lead.update({ where: { id: lead.id }, data: { ...data, ...(events.length ? { events: { createMany: { data: events } } } : {}) } })
    }
    if (rescore) await this.config.rescore(record.tenantId, [lead.id])
    return { id: lead.id, created }
  }

  /** Vincula (ou cria lead para) todos os atendimentos ainda sem lead. Usado depois de importações. */
  async linkAll(tenantId: string) {
    const records = await this.prisma.serviceRecord.findMany({
      where: { tenantId, leadId: null, deletedAt: null, OR: [{ phone: { not: null } }, { email: { not: null } }] },
      orderBy: { leadAt: 'asc' },
    })
    const touched = new Set<string>()
    let created = 0
    for (const r of records) {
      const res = await this.syncOne(r, null, false)
      if (!res) continue
      touched.add(res.id)
      if (res.created) created++
    }
    if (touched.size) await this.config.rescore(tenantId, [...touched])
    return { linked: records.length, leadsCreated: created }
  }
}
