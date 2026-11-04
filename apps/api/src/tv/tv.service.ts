import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { randomToken, sha256 } from '../common/crypto'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'

/** Painéis que podem ir para a TV por link, e o módulo que o usuário precisa poder editar para criar o link. */
export const TV_KINDS = { COLETAS: 'fretes_painel', EXECUTIVO: 'mi_executivo' } as const
export type TvKind = keyof typeof TV_KINDS

/** Usuário de leitura do painel aberto pelo link da TV: vê a empresa inteira, sem poder mudar nada. */
export function tvUser(tenantId: string): AuthUser {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    tenantId,
    email: 'tv@sistema',
    name: 'Painel na TV',
    familyId: '',
    unitId: null,
    extraUnitIds: [],
    pending2faSetup: false,
    role: { id: '', name: 'TV', isSystem: true, require2fa: false },
    permissions: {} as AuthUser['permissions'],
  }
}

/**
 * Links de painel para a TV: abrem sem login e só para leitura. O código aparece só ao criar (fica o hash) e o link
 * cancelado deixa de abrir na hora.
 */
@Injectable()
export class TvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertKind(kind: string): TvKind {
    if (!(kind in TV_KINDS)) throw new BadRequestException('Painel inválido.')
    return kind as TvKind
  }

  private assertAdmin(user: AuthUser, kind: TvKind) {
    if (!can(user.permissions, user.role.isSystem, TV_KINDS[kind], 'edit') && !can(user.permissions, user.role.isSystem, TV_KINDS[kind], 'export'))
      throw new ForbiddenException('Só quem pode editar este painel cria ou cancela o link da TV.')
  }

  async list(user: AuthUser, rawKind: string) {
    const kind = this.assertKind(rawKind)
    this.assertAdmin(user, kind)
    const rows = await this.prisma.tvLink.findMany({ where: { tenantId: user.tenantId, kind, revokedAt: null }, orderBy: { createdAt: 'desc' } })
    const units = new Map((await this.prisma.unit.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    return rows.map((r) => ({ id: r.id, name: r.name, unit: r.unitId ? (units.get(r.unitId) ?? null) : null, createdByName: r.createdByName, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }))
  }

  async create(user: AuthUser, d: { kind: string; name?: string | null; unitId?: string | null }, ctx: RequestCtx) {
    const kind = this.assertKind(d.kind)
    this.assertAdmin(user, kind)
    const unitId = kind === 'COLETAS' ? d.unitId || null : null
    if (unitId && !(await this.prisma.unit.count({ where: { id: unitId, tenantId: user.tenantId } }))) throw new BadRequestException('Filial inválida.')
    if ((await this.prisma.tvLink.count({ where: { tenantId: user.tenantId, revokedAt: null } })) >= 30) throw new BadRequestException('Limite de 30 links de TV: cancele um antes de criar outro.')
    const token = randomToken(24)
    const r = await this.prisma.tvLink.create({ data: { tenantId: user.tenantId, kind, unitId, name: cleanText(d.name, 80) || 'TV', tokenHash: sha256(token), createdByName: user.name.slice(0, 120) } })
    await this.audit.byUser(user, ctx, 'tv.link_criado', 'tv_link', r.id, { painel: kind, nome: r.name, filial: unitId })
    return { id: r.id, token }
  }

  async revoke(user: AuthUser, id: string, ctx: RequestCtx) {
    const link = await this.prisma.tvLink.findFirst({ where: { id, tenantId: user.tenantId, revokedAt: null } })
    if (!link) throw new NotFoundException('Link não encontrado.')
    this.assertAdmin(user, this.assertKind(link.kind))
    await this.prisma.tvLink.update({ where: { id }, data: { revokedAt: new Date() } })
    await this.audit.byUser(user, ctx, 'tv.link_cancelado', 'tv_link', id, { painel: link.kind, nome: link.name })
    return { ok: true }
  }

  /** O link do código (sem login). tenantId: a empresa do endereço, quando o sistema atende várias. */
  async resolve(token: string, kind: TvKind, tenantId?: string | null) {
    const link = /^[A-Za-z0-9_-]{20,80}$/.test(token) ? await this.prisma.tvLink.findUnique({ where: { tokenHash: sha256(token) } }) : null
    if (!link || link.revokedAt || link.kind !== kind || (tenantId && link.tenantId !== tenantId)) throw new NotFoundException('Link da TV inválido ou cancelado. Peça um link novo para quem administra o painel.')
    if (!link.lastUsedAt || Date.now() - link.lastUsedAt.getTime() > 3_600_000) await this.prisma.tvLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } })
    return link
  }
}
