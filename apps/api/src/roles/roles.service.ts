import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { MODULE_KEYS, type ModuleKey } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'

export interface PermissionInput {
  module: ModuleKey
  view: boolean
  create: boolean
  edit: boolean
  delete: boolean
  export: boolean
  scope: 'OWN' | 'ALL'
}

export interface RoleInput {
  name: string
  description?: string
  require2fa: boolean
  active: boolean
  permissions: PermissionInput[]
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    })
    return roles.map(view)
  }

  async get(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, tenantId },
      include: { permissions: true, _count: { select: { users: true } } },
    })
    if (!role) throw new NotFoundException('Perfil não encontrado.')
    return view(role)
  }

  async create(actor: AuthUser, input: RoleInput, ctx: RequestCtx) {
    await this.assertUniqueName(actor.tenantId, input.name)
    const role = await this.prisma.role.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name.trim(),
        description: input.description,
        require2fa: input.require2fa,
        active: input.active,
        permissions: { create: toRows(input.permissions) },
      },
      include: { permissions: true, _count: { select: { users: true } } },
    })
    await this.audit.byUser(actor, ctx, 'role.created', 'role', role.id, { name: role.name, permissions: input.permissions })
    return view(role)
  }

  async update(actor: AuthUser, id: string, input: RoleInput, ctx: RequestCtx) {
    const current = await this.prisma.role.findFirst({ where: { id, tenantId: actor.tenantId } })
    if (!current) throw new NotFoundException('Perfil não encontrado.')
    if (current.isSystem) throw new BadRequestException('O perfil Administrador é do sistema e não pode ser alterado.')
    if (input.name.trim() !== current.name) await this.assertUniqueName(actor.tenantId, input.name)

    const role = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } })
      return tx.role.update({
        where: { id },
        data: {
          name: input.name.trim(),
          description: input.description,
          require2fa: input.require2fa,
          active: input.active,
          permissions: { create: toRows(input.permissions) },
        },
        include: { permissions: true, _count: { select: { users: true } } },
      })
    })
    await this.audit.byUser(actor, ctx, 'role.updated', 'role', id, { name: role.name, permissions: input.permissions })
    return view(role)
  }

  async remove(actor: AuthUser, id: string, ctx: RequestCtx) {
    const role = await this.prisma.role.findFirst({ where: { id, tenantId: actor.tenantId }, include: { _count: { select: { users: true } } } })
    if (!role) throw new NotFoundException('Perfil não encontrado.')
    if (role.isSystem) throw new BadRequestException('O perfil Administrador não pode ser excluído.')
    if (role._count.users > 0) {
      throw new BadRequestException(`Há ${role._count.users} usuário(s) neste perfil. Mova-os para outro perfil ou desative o perfil.`)
    }
    await this.prisma.role.delete({ where: { id } })
    await this.audit.byUser(actor, ctx, 'role.deleted', 'role', id, { name: role.name })
  }

  private async assertUniqueName(tenantId: string, name: string) {
    const exists = await this.prisma.role.findFirst({ where: { tenantId, name: { equals: name.trim(), mode: 'insensitive' } } })
    if (exists) throw new ConflictException('Já existe um perfil com este nome.')
  }
}

function toRows(perms: PermissionInput[]) {
  const seen = new Set<string>()
  return perms
    .filter((p) => MODULE_KEYS.includes(p.module) && !seen.has(p.module) && seen.add(p.module))
    .map((p) => ({
      module: p.module,
      // Quem pode criar, editar, excluir ou exportar precisa ao menos ver o módulo.
      canView: p.view || p.create || p.edit || p.delete || p.export,
      canCreate: p.create,
      canEdit: p.edit,
      canDelete: p.delete,
      canExport: p.export,
      scope: p.scope,
    }))
}

function view(role: {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  require2fa: boolean
  active: boolean
  permissions: { module: string; canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean; scope: 'OWN' | 'ALL' }[]
  _count: { users: number }
}) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    require2fa: role.require2fa,
    active: role.active,
    userCount: role._count.users,
    permissions: role.permissions.map((p) => ({
      module: p.module,
      view: p.canView,
      create: p.canCreate,
      edit: p.canEdit,
      delete: p.canDelete,
      export: p.canExport,
      scope: p.scope,
    })),
  }
}
