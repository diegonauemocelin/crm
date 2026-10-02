import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { LookupType, Prisma, ServiceKind } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CadastrosService } from './cadastros.service'
import { mapSheet, type MappedRecord } from './planilha'

const MAX_BYTES = 20 * 1024 * 1024

/**
 * Aceita apenas links do Google Sheets e monta o endereço de exportação CSV a partir do id da planilha.
 * Nenhuma outra URL é buscada pelo servidor (proteção contra SSRF).
 */
export function sheetCsvUrl(link: string): string {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    throw new BadRequestException('Link inválido.')
  }
  const id = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(url.pathname)?.[1]
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !id) {
    throw new BadRequestException('Use um link do Google Planilhas (https://docs.google.com/spreadsheets/d/...).')
  }
  const gid = /gid=(\d+)/.exec(url.hash + url.search)?.[1] ?? '0'
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`
}

async function download(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  const finalHost = new URL(res.url).hostname
  if (!finalHost.endsWith('google.com') && !finalHost.endsWith('googleusercontent.com')) throw new BadRequestException('Redirecionamento inesperado.')
  if (!res.ok) throw new BadRequestException('Não foi possível baixar a planilha. Ela está compartilhada como "Qualquer pessoa com o link"?')
  if (!(res.headers.get('content-type') ?? '').includes('text/csv')) {
    throw new BadRequestException('A planilha não está acessível pelo link. Compartilhe como "Qualquer pessoa com o link: leitor" durante a importação, ou envie o arquivo CSV.')
  }
  const body = await res.arrayBuffer()
  if (body.byteLength > MAX_BYTES) throw new BadRequestException('Planilha maior que 20 MB.')
  return new TextDecoder('utf-8').decode(body)
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cadastros: CadastrosService,
    private readonly audit: AuditService,
  ) {}

  /** Importação em massa é restrita ao perfil Administrador. */
  async run(user: AuthUser, source: { url?: string; csv?: string }, kind: ServiceKind, dryRun: boolean, ctx: RequestCtx) {
    if (!user.role.isSystem) throw new ForbiddenException('Somente administradores podem importar planilhas.')
    const csv = source.csv ?? (source.url ? await download(sheetCsvUrl(source.url)) : null)
    if (!csv) throw new BadRequestException('Informe o link da planilha ou envie o arquivo CSV.')

    let mapped: ReturnType<typeof mapSheet>
    try {
      mapped = mapSheet(csv)
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }
    const { records, issues, columns } = mapped

    const keys = [...new Set(records.map((r) => r.externalKey))]
    const existing = new Set<string>()
    for (let i = 0; i < keys.length; i += 1000) {
      const found = await this.prisma.serviceRecord.findMany({
        where: { tenantId: user.tenantId, externalKey: { in: keys.slice(i, i + 1000) } },
        select: { externalKey: true },
      })
      for (const f of found) existing.add(f.externalKey!)
    }
    const seen = new Set<string>()
    const fresh = records.filter((r) => !existing.has(r.externalKey) && !seen.has(r.externalKey) && seen.add(r.externalKey))

    const summary = {
      columns,
      rowsRead: records.length,
      alreadyImported: records.length - fresh.length,
      toImport: fresh.length,
      sales: fresh.filter((r) => r.saleStatus === 'SIM').length,
      revenue: Math.round(fresh.reduce((s, r) => s + (r.saleValue ?? 0), 0) * 100) / 100,
      sellers: count(fresh.map((r) => r.seller)),
      origins: count(fresh.map((r) => r.origin)),
      brands: count(fresh.flatMap((r) => r.brands)),
      partTypes: count(fresh.flatMap((r) => r.partTypes)),
      lostReasons: count(fresh.map((r) => r.lostReason)),
      issues: issues.slice(0, 200),
      issuesTotal: issues.length,
    }
    if (dryRun || fresh.length === 0) return { dryRun: true, ...summary }

    const batch = `planilha-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`
    const cache = new Map<string, string>()
    const resolve = (type: LookupType, name: string | null) => (name ? this.cadastros.resolveLookup(user.tenantId, type, name, cache) : null)

    const data: Prisma.ServiceRecordCreateManyInput[] = []
    for (const r of fresh) data.push(await this.toRow(user, r, kind, batch, cache, resolve))
    // Tudo ou nada: um erro no meio não deixa a importação pela metade.
    const inserted = await this.prisma.$transaction(
      async (tx) => {
        let count = 0
        for (let i = 0; i < data.length; i += 500) {
          count += (await tx.serviceRecord.createMany({ data: data.slice(i, i + 500), skipDuplicates: true })).count
        }
        return count
      },
      { timeout: 120_000 },
    )

    await this.audit.byUser(user, ctx, 'atendimento.imported', 'service_record', batch, { kind, quantidade: inserted, lote: batch })
    return { dryRun: false, batch, imported: inserted, ...summary }
  }

  private async toRow(
    user: AuthUser,
    r: MappedRecord,
    kind: ServiceKind,
    batch: string,
    cache: Map<string, string>,
    resolve: (type: LookupType, name: string | null) => Promise<string> | null,
  ): Promise<Prisma.ServiceRecordCreateManyInput> {
    return {
      tenantId: user.tenantId,
      kind,
      leadAt: r.leadAt,
      name: r.name,
      customerCode: r.customerCode,
      phone: r.phone,
      email: r.email,
      sellerId: r.seller ? await this.cadastros.resolveSeller(user.tenantId, r.seller, cache) : null,
      originId: await resolve('ORIGEM', r.origin),
      customerTypeId: await resolve('TIPO_CLIENTE', r.customerType),
      country: r.country,
      state: r.state,
      city: r.city,
      brandIds: await Promise.all(r.brands.map((b) => resolve('MARCA', b)!)),
      partTypeIds: await Promise.all(r.partTypes.map((p) => resolve('TIPO_PECA', p)!)),
      forwarded: r.forwarded,
      returnStatus: r.returnStatus,
      saleStatus: r.saleStatus,
      lostReasonId: await resolve('MOTIVO_PERDA', r.lostReason),
      invoiceNumber: r.invoiceNumber,
      saleValue: r.saleValue,
      notes: r.notes,
      externalKey: r.externalKey,
      importBatch: batch,
      createdById: user.id,
      updatedById: user.id,
    }
  }
}

function count(values: (string | null)[]) {
  const m = new Map<string, number>()
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, total]) => ({ name, total }))
}
