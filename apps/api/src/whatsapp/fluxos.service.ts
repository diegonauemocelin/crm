import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { type BotState, continueFlow, type Flow, type FlowStep, MAX_OPTIONS, MAX_STEPS, startFlow, type StepType, validateFlow } from './fluxo'

export interface FlowInput {
  name: string
  description?: string | null
  numberIds: string[]
  trigger: 'NOVA_CONVERSA' | 'PALAVRA'
  keywords: string[]
  onlyAfterHours: boolean
  timeoutMinutes: number
  steps: unknown[]
  startStepId: string
}

const TYPES: StepType[] = ['mensagem', 'menu', 'pergunta', 'transferir', 'encerrar']
const id36 = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)
const stepId = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null)

/** Etapas vindas da tela, só com os campos conhecidos e nos tamanhos certos. */
export function cleanSteps(raw: unknown[]): FlowStep[] {
  return raw.slice(0, MAX_STEPS).map((r) => {
    const x = (r ?? {}) as Record<string, unknown>
    const go = (g: unknown) => {
      const o = (g ?? {}) as Record<string, unknown>
      return { next: stepId(o.next), sectorId: id36(o.sectorId), userId: id36(o.userId) }
    }
    const type = TYPES.includes(x.type as StepType) ? (x.type as StepType) : 'mensagem'
    return {
      id: stepId(x.id) ?? randomUUID().slice(0, 8),
      type,
      text: String(x.text ?? '').slice(0, 1000),
      ...(type === 'menu' ? { options: (Array.isArray(x.options) ? x.options : []).slice(0, MAX_OPTIONS).map((o) => ({ label: String((o as { label?: unknown })?.label ?? '').trim().slice(0, 60), ...go(o) })) } : {}),
      ...(type !== 'menu' ? { go: go(x.go) } : {}),
      ...(type === 'pergunta' ? { label: String(x.label ?? '').trim().slice(0, 60) } : {}),
    }
  })
}

/** Chatbot de atendimento: fluxos (Configurações › Chatbot de atendimento). Permissão: Números de WhatsApp. */
@Injectable()
export class FluxosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const [flows, sectors, users, numbers] = await Promise.all([
      this.prisma.whatsappFlow.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.whatsappSector.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    ])
    return { flows: flows.map(({ tenantId: _t, ...f }) => f), sectors, users, numbers }
  }

  /** Setores, pessoas e números usados no fluxo são da empresa. */
  private async assertRefs(tenantId: string, numberIds: string[], steps: FlowStep[]) {
    const gos = steps.flatMap((s) => (s.type === 'menu' ? (s.options ?? []) : [s.go ?? {}]))
    const sectorIds = [...new Set(gos.map((g) => g.sectorId).filter((x): x is string => !!x))]
    const userIds = [...new Set(gos.map((g) => g.userId).filter((x): x is string => !!x))]
    if (sectorIds.length && (await this.prisma.whatsappSector.count({ where: { tenantId, active: true, id: { in: sectorIds } } })) !== sectorIds.length) throw new BadRequestException('Setor inválido no fluxo.')
    if (userIds.length && (await this.prisma.user.count({ where: { tenantId, active: true, id: { in: userIds } } })) !== userIds.length) throw new BadRequestException('Pessoa inválida no fluxo.')
    if (numberIds.length && (await this.prisma.whatsappNumber.count({ where: { tenantId, deletedAt: null, id: { in: numberIds } } })) !== numberIds.length) throw new BadRequestException('Número inválido.')
  }

  private clean(d: FlowInput) {
    const name = d.name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (name.length < 2) throw new BadRequestException('Dê um nome ao fluxo.')
    const steps = cleanSteps(d.steps)
    const flow: Flow = { steps, startStepId: stepId(d.startStepId) ?? '' }
    const problem = validateFlow(flow)
    if (problem) throw new BadRequestException(problem)
    const keywords = [...new Set(d.keywords.map((k) => k.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20)
    if (d.trigger === 'PALAVRA' && !keywords.length) throw new BadRequestException('Escreva ao menos uma palavra-chave.')
    return {
      name,
      description: d.description?.trim().slice(0, 200) || null,
      numberIds: [...new Set(d.numberIds)],
      trigger: d.trigger === 'PALAVRA' ? 'PALAVRA' : 'NOVA_CONVERSA',
      keywords,
      onlyAfterHours: !!d.onlyAfterHours,
      timeoutMinutes: Math.min(Math.max(Math.round(d.timeoutMinutes || 30), 5), 1440),
      steps: steps as unknown as Prisma.InputJsonValue,
      startStepId: flow.startStepId,
    }
  }

  async save(user: AuthUser, id: string | null, d: FlowInput, ctx: RequestCtx) {
    const data = this.clean(d)
    await this.assertRefs(user.tenantId, data.numberIds, data.steps as unknown as FlowStep[])
    if (id && !(await this.prisma.whatsappFlow.count({ where: { id, tenantId: user.tenantId } }))) throw new NotFoundException('Fluxo não encontrado.')
    const row = id ? await this.prisma.whatsappFlow.update({ where: { id }, data }) : await this.prisma.whatsappFlow.create({ data: { ...data, tenantId: user.tenantId } })
    await this.audit.byUser(user, ctx, id ? 'whatsapp.fluxo_alterado' : 'whatsapp.fluxo_criado', 'whatsapp_flow', row.id, { nome: row.name, etapas: (data.steps as unknown as FlowStep[]).length })
    const { tenantId: _t, ...rest } = row
    return rest
  }

  /** Ligar ou desligar: desligado, as conversas que estavam no fluxo saem do robô (ficam na fila). */
  async setActive(user: AuthUser, id: string, active: boolean, ctx: RequestCtx) {
    const f = await this.prisma.whatsappFlow.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!f) throw new NotFoundException('Fluxo não encontrado.')
    await this.prisma.whatsappFlow.update({ where: { id }, data: { active } })
    if (!active) await this.prisma.whatsappConversation.updateMany({ where: { tenantId: user.tenantId, botFlowId: id }, data: { botFlowId: null } })
    await this.audit.byUser(user, ctx, active ? 'whatsapp.fluxo_ligado' : 'whatsapp.fluxo_desligado', 'whatsapp_flow', id, { nome: f.name })
    return { id, active }
  }

  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    const f = await this.prisma.whatsappFlow.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!f) throw new NotFoundException('Fluxo não encontrado.')
    await this.prisma.whatsappConversation.updateMany({ where: { tenantId: user.tenantId, botFlowId: id }, data: { botFlowId: null } })
    await this.prisma.whatsappFlow.delete({ where: { id } })
    await this.audit.byUser(user, ctx, 'whatsapp.fluxo_excluido', 'whatsapp_flow', id, { nome: f.name })
  }

  /** Testar o fluxo na tela, sem WhatsApp: a mesma lógica do robô de verdade. */
  simulate(d: { steps: unknown[]; startStepId: string; state: BotState | null; text: string; name?: string | null }) {
    const flow: Flow = { steps: cleanSteps(d.steps), startStepId: stepId(d.startStepId) ?? '' }
    const problem = validateFlow(flow)
    if (problem) throw new BadRequestException(problem)
    return d.state ? continueFlow(flow, d.state, d.text, d.name ?? null) : startFlow(flow, d.name ?? null)
  }
}
