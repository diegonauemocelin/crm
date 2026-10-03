import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { AuthService } from '../auth/auth.service'
import { hashPassword, passwordProblems } from '../auth/password'
import { randomToken } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'

export interface CreateUserInput {
  name: string
  email: string
  roleId: string
  unitId?: string | null
  password?: string
  sendInvite: boolean
}

export interface UpdateUserInput {
  name?: string
  email?: string
  roleId?: string
  unitId?: string | null
  active?: boolean
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  active: true,
  totpEnabled: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  avatarFileId: true,
  createdAt: true,
  role: { select: { id: true, name: true, isSystem: true } },
  unit: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(tenantId: string, q: { search?: string; status?: 'active' | 'inactive' }) {
    const rows = await this.prisma.user.findMany({
      where: {
        tenantId,
        ...(q.status ? { active: q.status === 'active' } : {}),
        ...(q.search
          ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] }
          : {}),
      },
      select: USER_SELECT,
      orderBy: { name: 'asc' },
    })
    return rows.map(view)
  }

  async get(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId }, select: USER_SELECT })
    if (!user) throw new NotFoundException('Usuário não encontrado.')
    return view(user)
  }

  async create(actor: AuthUser, input: CreateUserInput, ctx: RequestCtx) {
    const email = input.email.trim().toLowerCase()
    await this.assertRole(actor.tenantId, input.roleId)
    await this.assertUnit(actor.tenantId, input.unitId)
    if (await this.prisma.user.findUnique({ where: { tenantId_email: { tenantId: actor.tenantId, email } } })) {
      throw new ConflictException('Já existe um usuário com este e-mail.')
    }
    if (!input.password && !input.sendInvite) {
      throw new BadRequestException('Informe uma senha provisória ou marque o envio de convite por e-mail.')
    }
    if (input.password) {
      const problem = passwordProblems(input.password, email)
      if (problem) throw new BadRequestException(problem)
    }

    // Sem senha, o usuário recebe um hash inutilizável e define a própria senha pelo link do convite.
    const passwordHash = await hashPassword(input.password ?? randomToken(48))
    const user = await this.prisma.user.create({
      data: {
        tenantId: actor.tenantId,
        roleId: input.roleId,
        unitId: input.unitId || null,
        name: input.name.trim(),
        email,
        passwordHash,
        mustChangePassword: !!input.password,
      },
      select: USER_SELECT,
    })
    await this.audit.byUser(actor, ctx, 'user.created', 'user', user.id, { email, roleId: input.roleId, convite: input.sendInvite })
    if (input.sendInvite) await this.auth.sendPasswordLink(user.id, actor.tenantId, email, user.name, 'invite')
    return view(user)
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput, ctx: RequestCtx) {
    const current = await this.prisma.user.findFirst({ where: { id, tenantId: actor.tenantId }, include: { role: true } })
    if (!current) throw new NotFoundException('Usuário não encontrado.')

    if (id === actor.id && (input.active === false || (input.roleId && input.roleId !== current.roleId))) {
      throw new BadRequestException('Você não pode desativar nem trocar o perfil do seu próprio usuário.')
    }
    if (input.roleId) await this.assertRole(actor.tenantId, input.roleId)
    await this.assertUnit(actor.tenantId, input.unitId)

    const losingAdmin =
      current.role.isSystem && current.active && (input.active === false || (input.roleId !== undefined && input.roleId !== current.roleId))
    if (losingAdmin) await this.assertAnotherAdmin(actor.tenantId, id)

    const email = input.email?.trim().toLowerCase()
    if (email && email !== current.email) {
      const exists = await this.prisma.user.findUnique({ where: { tenantId_email: { tenantId: actor.tenantId, email } } })
      if (exists) throw new ConflictException('Já existe um usuário com este e-mail.')
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { name: input.name?.trim(), email, roleId: input.roleId, active: input.active, unitId: input.unitId },
      select: USER_SELECT,
    })
    // Desativar ou trocar o perfil encerra as sessões abertas na hora.
    if (input.active === false || (input.roleId && input.roleId !== current.roleId)) await this.auth.revokeAllSessions(id)
    await this.audit.byUser(actor, ctx, 'user.updated', 'user', id, { ...input })
    return view(user)
  }

  async unlock(actor: AuthUser, id: string, ctx: RequestCtx) {
    await this.get(actor.tenantId, id)
    await this.prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } })
    await this.audit.byUser(actor, ctx, 'user.unlocked', 'user', id)
  }

  async sendReset(actor: AuthUser, id: string, ctx: RequestCtx) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId: actor.tenantId } })
    if (!user) throw new NotFoundException('Usuário não encontrado.')
    await this.auth.sendPasswordLink(user.id, user.tenantId, user.email, user.name, 'invite')
    await this.audit.byUser(actor, ctx, 'user.password_link_sent', 'user', id)
  }

  private async assertRole(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId, active: true } })
    if (!role) throw new BadRequestException('Perfil de acesso inválido.')
  }

  private async assertUnit(tenantId: string, unitId: string | null | undefined) {
    if (unitId && !(await this.prisma.unit.count({ where: { id: unitId, tenantId } }))) throw new BadRequestException('Unidade inválida.')
  }

  private async assertAnotherAdmin(tenantId: string, exceptId: string) {
    const others = await this.prisma.user.count({ where: { tenantId, active: true, role: { isSystem: true }, NOT: { id: exceptId } } })
    if (others === 0) throw new BadRequestException('É preciso manter ao menos um administrador ativo.')
  }
}

function view(u: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>) {
  const { avatarFileId, lockedUntil, ...rest } = u
  return {
    ...rest,
    avatarUrl: avatarFileId ? `/api/files/${avatarFileId}` : null,
    locked: !!lockedUntil && lockedUntil > new Date(),
  }
}
