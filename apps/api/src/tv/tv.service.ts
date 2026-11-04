import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { decrypt, encrypt, randomToken, sha256 } from '../common/crypto'
import { hashPassword, verifyPassword } from '../auth/password'
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

/** Senha do link: de 4 a 64 caracteres (dá para digitar com o controle da TV). */
export function pinProblem(pin: string) {
  if (pin.length < 4) return 'A senha da TV precisa ter pelo menos 4 caracteres.'
  if (pin.length > 64) return 'A senha da TV pode ter no máximo 64 caracteres.'
  return null
}

/** Por quanto tempo a TV fica liberada depois de digitar a senha (trocar a senha encerra antes). */
const KEY_DAYS = 90
/** Tentativas erradas por link antes de travar por 15 minutos (além do limite por endereço IP). */
const MAX_FAILS = 10

/**
 * Links de painel para a TV: abrem sem login e só para leitura. O código aparece só ao criar (fica o hash) e o link
 * cancelado deixa de abrir na hora.
 */
@Injectable()
export class TvService {
  private readonly fails = new Map<string, { n: number; until: number }>()

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
    return rows.map((r) => ({ id: r.id, name: r.name, hasPin: !!r.pinHash, unit: r.unitId ? (units.get(r.unitId) ?? null) : null, createdByName: r.createdByName, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }))
  }

  async create(user: AuthUser, d: { kind: string; name?: string | null; unitId?: string | null; pin?: string | null }, ctx: RequestCtx) {
    const kind = this.assertKind(d.kind)
    this.assertAdmin(user, kind)
    const pin = String(d.pin ?? '')
    const problem = pinProblem(pin)
    if (problem) throw new BadRequestException(problem)
    const unitId = kind === 'COLETAS' ? d.unitId || null : null
    if (unitId && !(await this.prisma.unit.count({ where: { id: unitId, tenantId: user.tenantId } }))) throw new BadRequestException('Filial inválida.')
    if ((await this.prisma.tvLink.count({ where: { tenantId: user.tenantId, revokedAt: null } })) >= 30) throw new BadRequestException('Limite de 30 links de TV: cancele um antes de criar outro.')
    const token = randomToken(24)
    const r = await this.prisma.tvLink.create({ data: { tenantId: user.tenantId, kind, unitId, name: cleanText(d.name, 80) || 'TV', tokenHash: sha256(token), pinHash: await hashPassword(pin), createdByName: user.name.slice(0, 120) } })
    await this.audit.byUser(user, ctx, 'tv.link_criado', 'tv_link', r.id, { painel: kind, nome: r.name, filial: unitId })
    return { id: r.id, token }
  }

  /** Define ou troca a senha do link: as TVs já liberadas precisam digitar a nova. */
  async setPin(user: AuthUser, id: string, pin: string, ctx: RequestCtx) {
    const link = await this.prisma.tvLink.findFirst({ where: { id, tenantId: user.tenantId, revokedAt: null } })
    if (!link) throw new NotFoundException('Link não encontrado.')
    this.assertAdmin(user, this.assertKind(link.kind))
    const problem = pinProblem(pin)
    if (problem) throw new BadRequestException(problem)
    await this.prisma.tvLink.update({ where: { id }, data: { pinHash: await hashPassword(pin) } })
    await this.audit.byUser(user, ctx, 'tv.link_senha', 'tv_link', id, { painel: link.kind, nome: link.name })
    return { ok: true }
  }

  async revoke(user: AuthUser, id: string, ctx: RequestCtx) {
    const link = await this.prisma.tvLink.findFirst({ where: { id, tenantId: user.tenantId, revokedAt: null } })
    if (!link) throw new NotFoundException('Link não encontrado.')
    this.assertAdmin(user, this.assertKind(link.kind))
    await this.prisma.tvLink.update({ where: { id }, data: { revokedAt: new Date() } })
    await this.audit.byUser(user, ctx, 'tv.link_cancelado', 'tv_link', id, { painel: link.kind, nome: link.name })
    return { ok: true }
  }

  private async find(token: string, tenantId?: string | null) {
    const link = /^[A-Za-z0-9_-]{20,80}$/.test(token) ? await this.prisma.tvLink.findUnique({ where: { tokenHash: sha256(token) } }) : null
    if (!link || link.revokedAt || (tenantId && link.tenantId !== tenantId)) throw new NotFoundException('Link da TV inválido ou cancelado. Peça um link novo para quem administra o painel.')
    return link
  }

  /** Chave guardada no navegador da TV depois da senha: vale KEY_DAYS e cai quando a senha muda. */
  private keyOk(link: { id: string; pinHash: string | null }, key: string | undefined) {
    if (!link.pinHash) return true
    if (!key || key.length > 500) return false
    try {
      const k = JSON.parse(decrypt(key)) as { l?: string; e?: number; p?: string }
      return k.l === link.id && typeof k.e === 'number' && k.e > Date.now() && k.p === sha256(link.pinHash).slice(0, 16)
    } catch {
      return false
    }
  }

  /** A TV já está liberada? (o link precisa de senha e a chave guardada ainda vale) */
  async status(token: string, key: string | undefined, tenantId?: string | null) {
    const link = await this.find(token, tenantId)
    return { kind: link.kind, name: link.name, needsPin: !!link.pinHash, ok: this.keyOk(link, key) }
  }

  /** Senha digitada na TV: devolve a chave que libera o painel neste navegador. */
  async unlock(token: string, pin: string, tenantId?: string | null) {
    const link = await this.find(token, tenantId)
    if (!link.pinHash) return { key: null }
    const f = this.fails.get(link.id)
    if (f && f.n >= MAX_FAILS && f.until > Date.now()) throw new ForbiddenException('Muitas senhas erradas. Espere 15 minutos e tente de novo.')
    if (!(await verifyPassword(link.pinHash, String(pin ?? '').slice(0, 64)))) {
      const cur = f && f.until > Date.now() ? f : { n: 0, until: 0 }
      this.fails.set(link.id, { n: cur.n + 1, until: Date.now() + 15 * 60_000 })
      throw new ForbiddenException('Senha incorreta.')
    }
    this.fails.delete(link.id)
    return { key: encrypt(JSON.stringify({ l: link.id, e: Date.now() + KEY_DAYS * 86_400_000, p: sha256(link.pinHash).slice(0, 16) })) }
  }

  /** O link do código (sem login), com a chave da senha quando o link tem senha. tenantId: a empresa do endereço. */
  async resolve(token: string, kind: TvKind, key: string | undefined, tenantId?: string | null) {
    const link = await this.find(token, tenantId)
    if (link.kind !== kind) throw new NotFoundException('Link da TV inválido ou cancelado. Peça um link novo para quem administra o painel.')
    if (!this.keyOk(link, key)) throw new ForbiddenException({ code: 'TV_SENHA', message: 'Digite a senha do painel da TV.' })
    if (!link.lastUsedAt || Date.now() - link.lastUsedAt.getTime() > 3_600_000) await this.prisma.tvLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } })
    return link
  }
}
