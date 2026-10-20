import { BadRequestException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { PrismaService } from '../prisma/prisma.service'
import { namePattern, RENAME_TARGETS, renameJson, renameText, validNames } from './renomear'

type Row = Record<string, unknown> & { id: string }

/** Troca o nome da empresa nos textos salvos de todo o sistema, com prévia antes de aplicar. */
@Injectable()
export class RenomearService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Prévia (apply = false) ou troca (apply = true). Devolve, por área, quantos registros mudam e um exemplo. */
  async run(user: AuthUser, from: string, to: string, apply: boolean, ctx?: RequestCtx) {
    const problem = validNames(from, to)
    if (problem) throw new BadRequestException(problem)
    const re = namePattern(from)!
    const name = to.trim()
    const areas: { key: string; label: string; records: number; example: string | null }[] = []

    // Nome da empresa (tenant).
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true } })
    const tenantName = renameText(tenant.name, new RegExp(re.source, re.flags), name)
    if (tenantName !== tenant.name) {
      if (apply) await this.prisma.tenant.update({ where: { id: user.tenantId }, data: { name: tenantName } })
      areas.push({ key: 'empresa', label: 'Nome da empresa', records: 1, example: tenantName })
    }

    for (const t of RENAME_TARGETS) {
      const cols = [...t.text, ...t.json].map((c) => `"${c}"`).join(', ')
      // Nomes de tabela e coluna vêm da lista fixa acima; o único dado de fora (tenant) vai como parâmetro.
      const rows = await this.prisma.$queryRawUnsafe<Row[]>(`SELECT "id", ${cols} FROM "${t.table}" WHERE "tenantId" = $1::uuid${t.where ? ` AND ${t.where}` : ''}`, user.tenantId)
      let records = 0
      let example: string | null = null
      for (const row of rows) {
        const patch: Record<string, unknown> = {}
        for (const c of t.text) {
          const v = row[c]
          if (typeof v !== 'string') continue
          const n = renameText(v, new RegExp(re.source, re.flags), name)
          if (n !== v) {
            patch[c] = n
            example ??= n.slice(0, 120)
          }
        }
        for (const c of t.json) {
          if (row[c] === null || row[c] === undefined) continue
          const r = renameJson(row[c], new RegExp(re.source, re.flags), name)
          if (r.changes) patch[c] = r.value
        }
        if (!Object.keys(patch).length) continue
        records++
        if (!apply) continue
        const sets = Object.keys(patch).map((c, i) => `"${c}" = $${i + 2}${t.json.includes(c) ? '::jsonb' : ''}`)
        const values = Object.keys(patch).map((c) => (t.json.includes(c) ? JSON.stringify(patch[c]) : patch[c]))
        await this.prisma.$executeRawUnsafe(`UPDATE "${t.table}" SET ${sets.join(', ')} WHERE "id" = $1::uuid`, row.id, ...values)
      }
      if (records) areas.push({ key: t.key, label: t.label, records, example })
    }
    if (apply) await this.audit.byUser(user, ctx!, 'settings.company_renamed', 'settings', 'empresa', { de: from.trim(), para: name, areas: areas.map((a) => `${a.label}: ${a.records}`) })
    return { from: from.trim(), to: name, applied: apply, total: areas.reduce((s, a) => s + a.records, 0), areas }
  }
}
