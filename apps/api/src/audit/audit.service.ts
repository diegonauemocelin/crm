import { Injectable } from '@nestjs/common'
import { sha256, stableStringify } from '../common/crypto'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'

export interface AuditEntry {
  tenantId?: string | null
  userId?: string | null
  userEmail?: string | null
  action: string
  entity?: string | null
  entityId?: string | null
  ip?: string | null
  userAgent?: string | null
  data?: Record<string, unknown> | null
}

const SENSITIVE_KEY = /pass|secret|token|code|key|hash/i
const GENESIS = 'GENESIS'
const AUDIT_LOCK_ID = 7_310_001

/** Remove valores sensíveis antes de gravar. Senhas, segredos e tokens nunca vão para a auditoria. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[omitido]' : redact(v)]),
    )
  }
  return value
}

function canonical(entry: AuditEntry, createdAt: Date) {
  return stableStringify({
    tenantId: entry.tenantId ?? null,
    userId: entry.userId ?? null,
    userEmail: entry.userEmail ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    data: entry.data ?? null,
    createdAt: createdAt.toISOString(),
  })
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grava um evento encadeado ao anterior (hash = sha256(hashAnterior + evento)). */
  async log(entry: AuditEntry): Promise<void> {
    const data = entry.data ? (redact(entry.data) as Record<string, unknown>) : null
    const normalized = { ...entry, data }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_ID})`
      const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } })
      const prevHash = last?.hash ?? GENESIS
      const createdAt = new Date()
      const hash = sha256(prevHash + canonical(normalized, createdAt))
      await tx.auditLog.create({
        data: {
          tenantId: normalized.tenantId ?? null,
          userId: normalized.userId ?? null,
          userEmail: normalized.userEmail ?? null,
          action: normalized.action,
          entity: normalized.entity ?? null,
          entityId: normalized.entityId ?? null,
          ip: normalized.ip ?? null,
          userAgent: normalized.userAgent ?? null,
          data: data ? (data as Prisma.InputJsonValue) : Prisma.DbNull,
          prevHash,
          hash,
          createdAt,
        },
      })
    })
  }

  /** Atalho para ações feitas por um usuário logado. */
  async byUser(user: AuthUser, ctx: RequestCtx, action: string, entity?: string, entityId?: string, data?: Record<string, unknown>) {
    await this.log({ tenantId: user.tenantId, userId: user.id, userEmail: user.email, action, entity, entityId, ...ctx, data })
  }

  /** Recalcula a cadeia inteira. Qualquer alteração direta no banco quebra a verificação a partir do registro alterado. */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAtId: string | null }> {
    let prevHash = GENESIS
    let cursor: bigint | undefined
    let checked = 0
    for (;;) {
      const batch = await this.prisma.auditLog.findMany({
        take: 1000,
        ...(cursor !== undefined ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      })
      if (batch.length === 0) break
      for (const row of batch) {
        const expected = sha256(
          prevHash +
            canonical(
              {
                tenantId: row.tenantId,
                userId: row.userId,
                userEmail: row.userEmail,
                action: row.action,
                entity: row.entity,
                entityId: row.entityId,
                ip: row.ip,
                userAgent: row.userAgent,
                data: (row.data as Record<string, unknown> | null) ?? null,
              },
              row.createdAt,
            ),
        )
        if (row.prevHash !== prevHash || row.hash !== expected) {
          return { ok: false, checked, brokenAtId: row.id.toString() }
        }
        prevHash = row.hash
        checked++
      }
      cursor = batch[batch.length - 1]!.id
    }
    return { ok: true, checked, brokenAtId: null }
  }
}
