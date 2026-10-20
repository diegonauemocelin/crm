import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { cleanSector } from './atendentes'

/**
 * Setores de atendimento da empresa e gestores de cada pessoa (Configurações › Setores e equipes).
 * Quem pode: permissão "Números de WhatsApp" (ver/editar).
 */
@Injectable()
export class SetoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Setores, pessoas (com os gestores de cada uma) e números, para a tela. */
  async list(user: AuthUser) {
    const [sectors, users, numbers] = await Promise.all([
      this.prisma.whatsappSector.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({ where: { tenantId: user.tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, managerIds: true } }),
      this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, phone: true, splitAttendance: true } }),
    ])
    return {
      sectors: sectors.map(({ tenantId: _t, ...s }) => s),
      users,
      numbers,
    }
  }

  /** Confere se pessoas e números são da empresa (evita usar id de outra empresa). */
  private async assertRefs(tenantId: string, d: { numberIds: string[]; userIds: string[]; managerIds: string[] }) {
    const people = [...new Set([...d.userIds, ...d.managerIds])]
    if (people.length && (await this.prisma.user.count({ where: { tenantId, id: { in: people } } })) !== people.length) throw new BadRequestException('Pessoa inválida.')
    if (d.numberIds.length && (await this.prisma.whatsappNumber.count({ where: { tenantId, id: { in: d.numberIds }, deletedAt: null } })) !== d.numberIds.length) throw new BadRequestException('Número inválido.')
  }

  async save(user: AuthUser, id: string | null, raw: Parameters<typeof cleanSector>[0], ctx: RequestCtx) {
    const d = cleanSector(raw)
    if (d.name.length < 2) throw new BadRequestException('Dê um nome ao setor.')
    await this.assertRefs(user.tenantId, d)
    const same = await this.prisma.whatsappSector.findFirst({ where: { tenantId: user.tenantId, active: true, name: { equals: d.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } })
    if (same) throw new BadRequestException('Já existe um setor com este nome.')
    if (id && !(await this.prisma.whatsappSector.count({ where: { id, tenantId: user.tenantId, active: true } }))) throw new NotFoundException('Setor não encontrado.')
    const row = id ? await this.prisma.whatsappSector.update({ where: { id }, data: d }) : await this.prisma.whatsappSector.create({ data: { ...d, tenantId: user.tenantId } })
    await this.audit.byUser(user, ctx, id ? 'whatsapp.setor_alterado' : 'whatsapp.setor_criado', 'whatsapp_sector', row.id, { nome: row.name, atendentes: row.userIds.length, gestores: row.managerIds.length, visibilidade: row.visibility })
    return row
  }

  /** Desativa o setor: as conversas na fila dele voltam para a fila geral do número. */
  async remove(user: AuthUser, id: string, ctx: RequestCtx) {
    const s = await this.prisma.whatsappSector.findFirst({ where: { id, tenantId: user.tenantId, active: true } })
    if (!s) throw new NotFoundException('Setor não encontrado.')
    await this.prisma.whatsappSector.update({ where: { id }, data: { active: false } })
    await this.prisma.whatsappConversation.updateMany({ where: { tenantId: user.tenantId, sectorId: id }, data: { sectorId: null } })
    await this.audit.byUser(user, ctx, 'whatsapp.setor_removido', 'whatsapp_sector', id, { nome: s.name })
  }

  /** Gestores de uma pessoa (quem acompanha as conversas dela). Ninguém é gestor de si mesmo. */
  async setManagers(user: AuthUser, userId: string, managerIds: string[], ctx: RequestCtx) {
    const person = await this.prisma.user.findFirst({ where: { id: userId, tenantId: user.tenantId } })
    if (!person) throw new NotFoundException('Pessoa não encontrada.')
    const ids = [...new Set(managerIds)].filter((m) => m !== userId)
    if (ids.length && (await this.prisma.user.count({ where: { tenantId: user.tenantId, id: { in: ids } } })) !== ids.length) throw new BadRequestException('Gestor inválido.')
    await this.prisma.user.update({ where: { id: userId }, data: { managerIds: ids } })
    await this.audit.byUser(user, ctx, 'whatsapp.gestores_alterados', 'user', userId, { pessoa: person.name, gestores: ids.length })
    return { id: userId, managerIds: ids }
  }
}
