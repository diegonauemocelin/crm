import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AuditService } from '../audit/audit.service'
import { env } from '../config/env'
import type { RequestCtx } from '../common/decorators'
import { can } from '../common/permissions'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { readTable } from './arquivo'
import { LeadConfigService } from './lead-config.service'
import { LeadSyncService } from './lead-sync.service'
import { type ConvertedLead, convertCustom, convertRow, type ImportOptions, isRdExport, type LeadStageValue, type Mapping, suggestMapping } from './mapeamento'

const STAGE_ORDER: LeadStageValue[] = ['LEAD', 'QUALIFICADO', 'OPORTUNIDADE', 'CLIENTE']
const higherStage = (a: LeadStageValue, b: LeadStageValue | null) => (b && STAGE_ORDER.indexOf(b) > STAGE_ORDER.indexOf(a) ? b : a)
const MAX_FILE = 60 * 1024 * 1024

/**
 * Quem é a mesma pessoa: com e-mail, só o e-mail identifica (telefones como o fixo da empresa são compartilhados
 * por pessoas diferentes); sem e-mail, identifica pelo telefone.
 */
function matchOf(l: { email: string | null; phone: string | null }, idx: { byEmail: Map<string, string>; byPhone: Map<string, string> }) {
  if (l.email) return idx.byEmail.get(l.email) ?? null
  return l.phone ? (idx.byPhone.get(l.phone) ?? null) : null
}

interface Prepared {
  rows: { line: number; lead: ConvertedLead; custom: Record<string, unknown>; problems: string[] }[]
  invalid: { line: number; reason: string }[]
}

@Injectable()
export class LeadImportService {
  private readonly logger = new Logger(LeadImportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: LeadConfigService,
    private readonly sync: LeadSyncService,
  ) {}

  private assertCan(user: AuthUser) {
    if (!can(user.permissions, user.role.isSystem, 'leads', 'create')) throw new ForbiddenException('Você não tem permissão para importar leads.')
  }

  private dir(tenantId: string) {
    return resolve(env.uploadDir, tenantId, 'importacoes')
  }

  async upload(user: AuthUser, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    this.assertCan(user)
    if (!file) throw new BadRequestException('Envie o arquivo da planilha.')
    if (file.size > MAX_FILE) throw new BadRequestException('Arquivo maior que 60 MB.')
    let rows: string[][]
    try {
      rows = await readTable(file.buffer)
    } catch (err) {
      throw new BadRequestException(`Não foi possível ler o arquivo: ${(err as Error).message}`)
    }
    if (rows.length < 2) throw new BadRequestException('A planilha precisa ter a linha de títulos e ao menos um lead.')
    const headers = rows[0]!.map((h, i) => h.trim() || `Coluna ${i + 1}`)
    const fields = await this.config.listFields(user.tenantId)
    const rd = isRdExport(headers)
    const mapping = suggestMapping(headers, fields)

    // Modelo do RD Station: tags de importações antigas descartadas e responsável = Pré-Vendas (comercial@usaparts.com.br).
    const options: ImportOptions = { duplicates: 'update', discardTags: rd ? '^importacao-' : null, defaultStage: 'LEAD' }
    if (rd) {
      const owner = await this.prisma.seller.findFirst({ where: { tenantId: user.tenantId, email: 'comercial@usaparts.com.br' } })
      if (owner) options.forceOwnerId = owner.id
    }

    const id = randomUUID()
    await mkdir(this.dir(user.tenantId), { recursive: true })
    const path = resolve(this.dir(user.tenantId), `${id}.bin`)
    await writeFile(path, file.buffer, { mode: 0o600 })
    const name = file.originalname.replace(/\.gz$/i, '').slice(0, 200)
    await this.prisma.leadImport.create({
      data: {
        id,
        tenantId: user.tenantId,
        fileName: name,
        filePath: path,
        headers,
        totalRows: rows.length - 1,
        mapping: mapping as Prisma.InputJsonValue,
        options: options as Prisma.InputJsonValue,
        createdById: user.id,
      },
    })
    await this.audit.byUser(user, ctx, 'lead_import.uploaded', 'lead_import', id, { arquivo: name, linhas: rows.length - 1 })
    return { id, fileName: name, headers, totalRows: rows.length - 1, sample: rows.slice(1, 6), mapping, options, isRdExport: rd }
  }

  private async load(user: AuthUser, id: string) {
    const imp = await this.prisma.leadImport.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!imp) throw new NotFoundException('Importação não encontrada.')
    return imp
  }

  private async prepare(tenantId: string, filePath: string, headers: string[], mapping: Mapping, options: ImportOptions): Promise<Prepared> {
    const rows = await readTable(await readFile(filePath))
    const fields = await this.config.listFields(tenantId)
    let discard: RegExp | null = null
    if (options.discardTags) {
      try {
        discard = new RegExp(options.discardTags, 'i')
      } catch {
        throw new BadRequestException('Padrão de tags a descartar inválido.')
      }
    }
    const out: Prepared = { rows: [], invalid: [] }
    rows.slice(1).forEach((cells, i) => {
      const line = i + 2
      const { lead, problems } = convertRow(headers, cells, mapping, discard)
      const custom: Record<string, unknown> = {}
      for (const [key, raw] of Object.entries(lead.custom)) {
        const def = fields.find((f) => f.key === key)
        if (!def) continue
        const c = convertCustom(def, raw)
        if ('error' in c) problems.push(`${def.label}: ${c.error}`)
        else if (c.value !== null) custom[key] = c.value
      }
      if (!lead.email && !lead.phone) out.invalid.push({ line, reason: problems[0] ?? 'sem e-mail e sem telefone válidos' })
      else out.rows.push({ line, lead, custom, problems })
    })
    return out
  }

  /** Analisa sem gravar nada: quantos entram, quantos atualizam, problemas encontrados. */
  async analyze(user: AuthUser, id: string, mapping: Mapping, options: ImportOptions) {
    this.assertCan(user)
    const imp = await this.load(user, id)
    if (!imp.filePath) throw new BadRequestException('O arquivo desta importação não está mais disponível.')
    if (!Object.values(mapping).some((t) => t === 'email' || t === 'phone' || t === 'mobile')) {
      throw new BadRequestException('Indique ao menos a coluna de e-mail ou de telefone.')
    }
    const prepared = await this.prepare(user.tenantId, imp.filePath, imp.headers, mapping, options)
    const existing = await this.existingIndex(user.tenantId)
    let toCreate = 0
    let toUpdate = 0
    const seen = new Set<string>()
    let duplicatedInFile = 0
    const stages: Record<string, number> = {}
    const tags: Record<string, number> = {}
    let optOut = 0
    for (const r of prepared.rows) {
      const key = r.lead.email ?? r.lead.phone!
      const match = matchOf(r.lead, existing)
      if (seen.has(key)) duplicatedInFile++
      else if (match) toUpdate++
      else toCreate++
      seen.add(key)
      const stage = r.lead.stage ?? options.defaultStage ?? 'LEAD'
      stages[stage] = (stages[stage] ?? 0) + 1
      for (const t of [...r.lead.tags, ...(options.addTags ?? [])]) tags[t] = (tags[t] ?? 0) + 1
      if (r.lead.emailOptIn === false) optOut++
    }
    const problems = prepared.rows.filter((r) => r.problems.length).map((r) => ({ line: r.line, reason: r.problems.join('; ') }))
    const report = {
      total: imp.totalRows,
      valid: prepared.rows.length,
      invalid: prepared.invalid.length,
      toCreate,
      toUpdate: options.duplicates === 'skip' ? 0 : toUpdate,
      skipped: options.duplicates === 'skip' ? toUpdate : 0,
      duplicatedInFile,
      stages,
      tags,
      optOut,
      sales: prepared.rows.filter((r) => r.lead.lastSaleAt).length,
      invalidRows: prepared.invalid.slice(0, 200),
      problemRows: problems.slice(0, 200),
      problemsTotal: problems.length,
    }
    await this.prisma.leadImport.update({
      where: { id },
      data: { status: 'ANALISADO', mapping: mapping as Prisma.InputJsonValue, options: options as Prisma.InputJsonValue, report: report as Prisma.InputJsonValue },
    })
    return report
  }

  private async existingIndex(tenantId: string) {
    const leads = await this.prisma.lead.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, email: true, phone: true } })
    const byEmail = new Map<string, string>()
    const byPhone = new Map<string, string>()
    for (const l of leads) {
      if (l.email) byEmail.set(l.email, l.id)
      if (l.phone && !byPhone.has(l.phone)) byPhone.set(l.phone, l.id)
    }
    return { byEmail, byPhone }
  }

  /** Inicia a importação em segundo plano; a tela acompanha o andamento consultando o status. */
  async start(user: AuthUser, id: string, ctx: RequestCtx) {
    this.assertCan(user)
    const imp = await this.load(user, id)
    if (imp.status !== 'ANALISADO') throw new BadRequestException(imp.status === 'PROCESSANDO' ? 'Esta importação já está em andamento.' : 'Analise a planilha antes de importar.')
    await this.prisma.leadImport.update({ where: { id }, data: { status: 'PROCESSANDO', processed: 0 } })
    await this.audit.byUser(user, ctx, 'lead_import.started', 'lead_import', id, { arquivo: imp.fileName })
    void this.process(user, id).catch(async (err) => {
      this.logger.error(`Importação ${id} falhou: ${(err as Error).message}`)
      await this.prisma.leadImport.update({ where: { id }, data: { status: 'ERRO', report: { ...(imp.report as object), erro: (err as Error).message } as Prisma.InputJsonValue, finishedAt: new Date() } })
    })
    return { id, status: 'PROCESSANDO' }
  }

  private async process(user: AuthUser, id: string) {
    const imp = await this.prisma.leadImport.findUniqueOrThrow({ where: { id } })
    const mapping = imp.mapping as Mapping
    const options = (imp.options ?? {}) as ImportOptions
    const tenantId = imp.tenantId
    const batch = `importacao-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 8)}`
    const prepared = await this.prepare(tenantId, imp.filePath!, imp.headers, mapping, options)
    const existing = await this.existingIndex(tenantId)

    const sellers = await this.prisma.seller.findMany({ where: { tenantId }, select: { id: true, email: true, unitId: true } })
    const sellerByEmail = new Map(sellers.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s]))
    const sellerUnit = new Map(sellers.map((s) => [s.id, s.unitId]))
    const originCache = new Map<string, string>()
    const resolveOrigin = async (name: string) => {
      const k = name.toLowerCase()
      if (originCache.has(k)) return originCache.get(k)!
      const found = await this.prisma.lookupItem.findFirst({ where: { tenantId, type: 'ORIGEM', name: { equals: name, mode: 'insensitive' } } })
      const oid = found?.id ?? (await this.prisma.lookupItem.create({ data: { tenantId, type: 'ORIGEM', name } })).id
      originCache.set(k, oid)
      return oid
    }

    let created = 0
    let updated = 0
    let skipped = 0
    let mergedInFile = 0
    const touched: string[] = []
    const now = new Date()
    const source = isRdExport(imp.headers) ? 'importado do RD Station' : `importado de ${imp.fileName}`

    for (let i = 0; i < prepared.rows.length; i += 250) {
      const chunk = prepared.rows.slice(i, i + 250)
      const newLeads: Prisma.LeadCreateManyInput[] = []
      const newEvents: Prisma.LeadEventCreateManyInput[] = []
      const newConsents: Prisma.LeadConsentCreateManyInput[] = []
      const updates: Prisma.PrismaPromise<unknown>[] = []
      // Leads criados neste mesmo lote (ainda não gravados): repetições na planilha são somadas a eles.
      const pending = new Map<string, Prisma.LeadCreateManyInput>()

      for (const r of chunk) {
        const l = r.lead
        const ownerId = options.forceOwnerId ?? (l.ownerEmail ? sellerByEmail.get(l.ownerEmail)?.id : undefined) ?? options.defaultOwnerId ?? null
        const unitId = options.unitId ?? (ownerId ? (sellerUnit.get(ownerId) ?? null) : null)
        const originId = l.origin ? await resolveOrigin(l.origin) : (options.originId ?? null)
        const tags = [...new Set([...l.tags, ...(options.addTags ?? []).map((t) => t.toLowerCase())])]
        const stage = l.stage ?? options.defaultStage ?? 'LEAD'
        const matchId = matchOf(l, existing)

        const pend = matchId ? pending.get(matchId) : undefined
        if (pend) {
          pend.tags = [...new Set([...((pend.tags as string[]) ?? []), ...tags])]
          for (const k of ['name', 'company', 'jobTitle', 'city', 'state', 'email'] as const) if (!pend[k] && l[k]) pend[k] = l[k]
          mergedInFile++
          continue
        }

        if (!matchId) {
          const leadId = randomUUID()
          if (l.email) existing.byEmail.set(l.email, leadId)
          if (l.phone && !existing.byPhone.has(l.phone)) existing.byPhone.set(l.phone, leadId)
          newLeads.push({
            id: leadId,
            tenantId,
            name: l.name,
            email: l.email,
            phone: l.phone,
            company: l.company,
            jobTitle: l.jobTitle,
            country: l.country ?? 'BR',
            state: l.state,
            city: l.city,
            stage,
            ownerId,
            unitId,
            originId,
            tags,
            customFields: r.custom as Prisma.InputJsonValue,
            emailOptIn: l.emailOptIn === true,
            emailOptOutAt: l.emailOptIn === false ? now : null,
            lastOpportunityAt: l.lastOpportunityAt,
            lastSaleAt: l.lastSaleAt,
            lastSaleValue: l.lastSaleValue,
            lastActivityAt: [l.lastSaleAt, l.lastOpportunityAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
            importBatch: batch,
            createdById: user.id,
          })
          pending.set(leadId, newLeads[newLeads.length - 1]!)
          newEvents.push({ tenantId, leadId, type: 'importado', title: `Importado da planilha ${imp.fileName}`, userId: user.id, userName: user.name })
          if (l.lastSaleAt) {
            newEvents.push({
              tenantId,
              leadId,
              type: 'venda_historica',
              title: `Última venda (histórico)${l.lastSaleValue ? ` — ${l.lastSaleValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}`,
              occurredAt: l.lastSaleAt,
            })
          }
          if (l.emailOptIn !== null) newConsents.push({ leadId, purpose: 'email_marketing', granted: l.emailOptIn, source, text: `Situação de comunicação por e-mail na origem: ${l.emailOptIn ? 'autorizado' : 'não autorizado'}` })
          touched.push(leadId)
          created++
          continue
        }

        if (options.duplicates === 'skip') {
          skipped++
          continue
        }

        const current = await this.prisma.lead.findUnique({ where: { id: matchId } })
        if (!current || current.anonymizedAt) {
          skipped++
          continue
        }
        const data: Prisma.LeadUncheckedUpdateInput = {}
        for (const k of ['name', 'company', 'jobTitle', 'city', 'state'] as const) if (l[k]) data[k] = l[k]
        if (l.email && !current.email) data.email = l.email
        if (l.phone && !current.phone) data.phone = l.phone
        if (ownerId) data.ownerId = ownerId
        if (unitId && !current.unitId) data.unitId = unitId
        if (originId && !current.originId) data.originId = originId
        data.stage = higherStage(current.stage, l.stage)
        data.tags = [...new Set([...current.tags, ...tags])]
        data.customFields = { ...(current.customFields as object), ...r.custom } as Prisma.InputJsonValue
        if (l.lastOpportunityAt && (!current.lastOpportunityAt || l.lastOpportunityAt > current.lastOpportunityAt)) data.lastOpportunityAt = l.lastOpportunityAt
        if (l.lastSaleAt && (!current.lastSaleAt || l.lastSaleAt > current.lastSaleAt)) {
          data.lastSaleAt = l.lastSaleAt
          data.lastSaleValue = l.lastSaleValue
        }
        // LGPD: quem se descadastrou nunca é reinscrito por importação; um "não" da planilha sempre vale.
        if (l.emailOptIn === false && current.emailOptIn) {
          data.emailOptIn = false
          data.emailOptOutAt = now
          newConsents.push({ leadId: matchId, purpose: 'email_marketing', granted: false, source, text: 'Descadastrado na origem' })
        } else if (l.emailOptIn === true && !current.emailOptIn && !current.emailOptOutAt) {
          data.emailOptIn = true
          newConsents.push({ leadId: matchId, purpose: 'email_marketing', granted: true, source })
        }
        newEvents.push({ tenantId, leadId: matchId, type: 'importado', title: `Atualizado pela planilha ${imp.fileName}`, userId: user.id, userName: user.name })
        updates.push(this.prisma.lead.update({ where: { id: matchId }, data }))
        touched.push(matchId)
        updated++
      }

      await this.prisma.$transaction([
        this.prisma.lead.createMany({ data: newLeads, skipDuplicates: true }),
        ...updates,
        this.prisma.leadEvent.createMany({ data: newEvents }),
        this.prisma.leadConsent.createMany({ data: newConsents }),
      ])
      await this.prisma.leadImport.update({ where: { id }, data: { processed: Math.min(prepared.rows.length, i + chunk.length) } })
    }

    // Liga os atendimentos de Pré/Pós-Vendas aos leads (pelo telefone/e-mail) e recalcula as notas.
    const link = await this.sync.linkAll(tenantId)
    await this.config.rescore(tenantId)

    const report = { ...(imp.report as object), created, updated, skipped, mergedInFile, invalid: prepared.invalid.length, atendimentosVinculados: link.linked, leadsCriadosDeAtendimentos: link.leadsCreated, lote: batch }
    await this.prisma.leadImport.update({ where: { id }, data: { status: 'CONCLUIDO', report: report as Prisma.InputJsonValue, finishedAt: new Date(), filePath: null } })
    await unlink(imp.filePath!).catch(() => undefined)
    await this.audit.log({ tenantId, userId: user.id, userEmail: user.email, action: 'lead_import.finished', entity: 'lead_import', entityId: id, data: { criados: created, atualizados: updated, ignorados: skipped } })
    this.logger.log(`Importação ${id}: ${created} criados, ${updated} atualizados, ${skipped} ignorados`)
  }

  async status(user: AuthUser, id: string) {
    this.assertCan(user)
    const imp = await this.load(user, id)
    const { filePath: _f, tenantId: _t, ...rest } = imp
    return rest
  }

  async list(user: AuthUser) {
    this.assertCan(user)
    const rows = await this.prisma.leadImport.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 30 })
    return rows.map(({ filePath: _f, tenantId: _t, mapping: _m, ...r }) => r)
  }
}
