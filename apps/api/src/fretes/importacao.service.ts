import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import readXlsxFile from 'read-excel-file/node'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import { decodeText, isXlsx, maybeGunzip, parseDelimited } from '../leads/arquivo'
import { PrismaService } from '../prisma/prisma.service'
import { cleanText } from '../sugestoes/sugestoes'
import { allowedUnits, assertCan, assertUnitList, unitListWhere } from './acesso'
import { DEFAULT_COMPONENTS, DEFAULT_SETTINGS } from './catalogo'
import { checkMapping, type ColumnMap, labelOf, parseRows, suggestMapping } from './importacao'

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024
const MAX_ROWS = 100_000
const PREVIEW_ROWS = 15
const BATCH = 2_000

type Cell = string | number | boolean | null
interface Sheet {
  name: string
  rows: Cell[][]
}

/** Separador do CSV pelas primeiras linhas (tabelas de transportadora costumam ter título antes do cabeçalho). */
export function csvDelimiter(text: string) {
  const lines = text.split('\n', 20)
  const best = ['\t', ';', ','].map((d) => [d, Math.max(...lines.map((l) => l.split(d).length - 1))] as const).sort((a, b) => b[1] - a[1])[0]!
  return best[1] > 0 ? best[0] : ','
}

/** Lê todas as abas (Excel) ou o CSV. Números do Excel continuam números (CEP sem o zero da frente é corrigido depois). */
export async function readSheets(raw: Buffer, fileName: string): Promise<Sheet[]> {
  const buf = maybeGunzip(raw)
  if (isXlsx(buf)) {
    let sheets: { sheet: string; data: unknown[][] }[]
    try {
      sheets = (await readXlsxFile(buf)) as unknown as { sheet: string; data: unknown[][] }[]
    } catch {
      throw new BadRequestException('Não foi possível ler o Excel. Abra no Excel, salve de novo como .xlsx e envie.')
    }
    return sheets.map((s) => ({
      name: s.sheet,
      rows: s.data.slice(0, MAX_ROWS + 50).map((r) =>
        r.map((c): Cell => (c instanceof Date ? c.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : typeof c === 'number' || typeof c === 'boolean' || typeof c === 'string' ? c : c === null || c === undefined ? null : String(c))),
      ),
    }))
  }
  if (/\.xls$/i.test(fileName) || (buf[0] === 0xd0 && buf[1] === 0xcf)) throw new BadRequestException('Excel antigo (.xls) não é aceito: abra no Excel e salve como .xlsx ou .csv.')
  const text = decodeText(buf)
  if (/[\u0000-\u0008]/.test(text.slice(0, 2000))) throw new BadRequestException('Formato não reconhecido. Envie .xlsx ou .csv.')
  return [{ name: 'CSV', rows: parseDelimited(text, csvDelimiter(text)).slice(0, MAX_ROWS + 50) }]
}

/** Linha do cabeçalho: a primeira (entre as 30 iniciais) em que a sugestão reconhece ao menos duas colunas. */
function guessHeader(rows: Cell[][]) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const m = suggestMapping(rows[i] ?? [], rows.slice(i + 1, i + 9))
    if (m.length >= 2) return { headerRow: i + 1, mapping: m }
  }
  const first = rows.findIndex((r) => r.some((c) => c !== null && String(c).trim() !== ''))
  return { headerRow: Math.max(1, first + 1), mapping: [] as ColumnMap[] }
}

/** Importação assistida: enviar → mapear colunas → validar → confirmar (vira rascunho de nova versão; nunca troca a publicada). */
@Injectable()
export class ImportacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private async table(user: AuthUser, id: string) {
    const t = await this.prisma.freightTable.findFirst({ where: { id, tenantId: user.tenantId, ...unitListWhere(allowedUnits(user, 'fretes_tabelas')) } })
    if (!t) throw new NotFoundException('Tabela de frete não encontrada.')
    return t
  }

  private async load(user: AuthUser, importId: string) {
    const imp = await this.prisma.freightImport.findFirst({ where: { id: importId, tenantId: user.tenantId } })
    if (!imp) throw new NotFoundException('Importação não encontrada.')
    const t = await this.table(user, imp.tableId)
    const { content } = await this.files.read(imp.fileId)
    return { imp, t, sheets: await readSheets(content, imp.fileName) }
  }

  async list(user: AuthUser, tableId: string) {
    assertCan(user, 'fretes_tabelas', 'view')
    await this.table(user, tableId)
    const rows = await this.prisma.freightImport.findMany({ where: { tableId }, orderBy: { createdAt: 'desc' }, take: 100 })
    const versions = await this.prisma.freightTableVersion.findMany({ where: { id: { in: rows.map((r) => r.versionId).filter((x): x is string => !!x) } }, select: { id: true, number: true, status: true } })
    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      status: r.status,
      readLines: r.readLines,
      importedLines: r.importedLines,
      rejectedLines: r.rejectedLines,
      rulesCount: r.rulesCount,
      version: versions.find((v) => v.id === r.versionId) ?? null,
      createdByName: r.createdByName,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    }))
  }

  /** Etapas 1–3: recebe o arquivo, guarda o original e devolve as abas, a prévia e o mapeamento sugerido. */
  async analyze(user: AuthUser, tableId: string, file: Express.Multer.File | undefined, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'create')
    const t = await this.table(user, tableId)
    assertUnitList(user, 'fretes_tabelas', t.unitIds)
    if (!file?.buffer?.length) throw new BadRequestException('Envie a planilha da transportadora (.xlsx ou .csv).')
    if (file.size > IMPORT_MAX_BYTES) throw new BadRequestException('Arquivo maior que 20 MB.')
    const fileName = cleanText(file.originalname, 200) || 'tabela'
    const sheets = await readSheets(file.buffer, fileName)
    if (!sheets.some((s) => s.rows.length)) throw new BadRequestException('A planilha está vazia.')
    const xlsx = isXlsx(maybeGunzip(file.buffer))
    const asset = await this.files.saveBuffer(user.tenantId, 'frete-importacao', file.buffer, xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv', xlsx ? 'xlsx' : 'csv')
    // Aba principal: a que tem destino e valores reconhecidos (planilhas com abas de contrato, generalidades e taxas).
    const guesses = sheets.map((s) => guessHeader(s.rows))
    const score = (i: number) => {
      const fields = new Set(guesses[i]!.mapping.map((m) => m.field))
      const dest = fields.has('cep_start') || fields.has('cep') || fields.has('city') || fields.has('uf') ? 10 : 0
      return dest + guesses[i]!.mapping.filter((m) => m.field.startsWith('var:')).length + Math.min(5, sheets[i]!.rows.length / 100)
    }
    const sheet = sheets.reduce((best, _, i) => (score(i) > score(best) ? i : best), 0)
    const guess = guesses[sheet]!
    const imp = await this.prisma.freightImport.create({
      data: { tenantId: user.tenantId, tableId, fileId: asset.id, fileName, sheet, headerRow: guess.headerRow, mapping: guess.mapping as unknown as Prisma.InputJsonValue, createdById: user.id, createdByName: user.name },
    })
    await this.audit.byUser(user, ctx, 'frete.importacao.enviada', 'freight_table', tableId, { importacao: imp.id, arquivo: fileName, tamanho: file.size })
    return {
      importId: imp.id,
      fileName,
      sheets: sheets.map((s, index) => ({ index, name: s.name, rowCount: s.rows.length, preview: s.rows.slice(0, PREVIEW_ROWS + 30) })),
      suggested: { sheet, headerRow: guess.headerRow, mapping: guess.mapping },
    }
  }

  /** Sugestão de mapeamento para outra aba ou outra linha de cabeçalho (0 = descobrir a linha). */
  async suggest(user: AuthUser, importId: string, sheet: number, headerRow: number) {
    assertCan(user, 'fretes_tabelas', 'create')
    const { sheets } = await this.load(user, importId)
    const s = sheets[sheet]
    if (!s) throw new BadRequestException('Aba inválida.')
    if (!headerRow) return guessHeader(s.rows)
    return { headerRow, mapping: suggestMapping(s.rows[headerRow - 1] ?? [], s.rows.slice(headerRow, headerRow + 8)) }
  }

  private run(sheets: Sheet[], sheetIdx: number, headerRow: number, mapping: ColumnMap[]) {
    const s = sheets[sheetIdx]
    if (!s) throw new BadRequestException('Aba inválida.')
    if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > s.rows.length) throw new BadRequestException('Linha do cabeçalho inválida.')
    const columns = Math.max(0, ...s.rows.slice(0, headerRow + 50).map((r) => r.length))
    const problems = checkMapping(mapping, columns)
    if (problems.length) throw new BadRequestException(problems.join(' '))
    const data = s.rows.slice(headerRow)
    if (data.length > MAX_ROWS) throw new BadRequestException(`A planilha passa de ${MAX_ROWS.toLocaleString('pt-BR')} linhas. Divida em arquivos menores.`)
    return parseRows(data, mapping, headerRow + 1)
  }

  /** Etapas 4–8: aplica o mapeamento e mostra o que vai entrar, os erros e os alertas, sem gravar regras. */
  async validate(user: AuthUser, importId: string, d: { sheet: number; headerRow: number; mapping: ColumnMap[] }) {
    assertCan(user, 'fretes_tabelas', 'create')
    const { imp, sheets } = await this.load(user, importId)
    if (imp.status !== 'ANALISE') throw new BadRequestException('Esta importação já foi concluída ou cancelada. Envie o arquivo de novo.')
    const r = this.run(sheets, d.sheet, d.headerRow, d.mapping)
    await this.prisma.freightImport.update({ where: { id: importId }, data: { sheet: d.sheet, headerRow: d.headerRow, mapping: d.mapping as unknown as Prisma.InputJsonValue } })
    const variables = [...new Set(r.rules.flatMap((x) => Object.keys(x.values)))].sort()
    return {
      readLines: r.readLines,
      importedLines: r.importedLines,
      errorLines: r.errorLines,
      rules: r.rules.length,
      issueCount: r.issueCount,
      issues: r.issues,
      variables: variables.map((code) => ({ code, label: labelOf(`var:${code}`) })),
      sample: r.rules.slice(0, 40),
      ufs: [...new Set(r.rules.map((x) => x.uf).filter(Boolean))].sort(),
    }
  }

  /** Etapas 9–10: grava as regras num rascunho de nova versão e guarda o relatório (linhas importadas, rejeitadas e alertas). */
  async confirm(user: AuthUser, importId: string, d: { sheet: number; headerRow: number; mapping: ColumnMap[]; note?: string | null }, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'create')
    const { imp, t, sheets } = await this.load(user, importId)
    assertUnitList(user, 'fretes_tabelas', t.unitIds)
    if (imp.status !== 'ANALISE') throw new BadRequestException('Esta importação já foi concluída ou cancelada.')
    const r = this.run(sheets, d.sheet, d.headerRow, d.mapping)
    if (!r.rules.length) throw new BadRequestException('Nenhuma linha válida para importar. Confira o mapeamento e os erros apontados.')

    const versionId = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT id FROM freight_tables WHERE id = ${t.id}::uuid FOR UPDATE`
        const draft = await tx.freightTableVersion.findFirst({ where: { tableId: t.id, status: 'RASCUNHO' } })
        if (draft && draft.rulesCount > 0) {
          throw new ConflictException(`Já existe o rascunho da versão ${draft.number} com ${draft.rulesCount} regras. Publique ou descarte esse rascunho antes de importar outra planilha.`)
        }
        let target = draft
        if (!target) {
          // Componentes e parâmetros vêm da versão publicada (a planilha traz só as regras).
          const base = t.publishedVersionId ? await tx.freightTableVersion.findUnique({ where: { id: t.publishedVersionId } }) : null
          const last = await tx.freightTableVersion.aggregate({ where: { tableId: t.id }, _max: { number: true } })
          target = await tx.freightTableVersion.create({
            data: {
              tenantId: user.tenantId,
              tableId: t.id,
              number: (last._max.number ?? 0) + 1,
              components: (base?.components ?? DEFAULT_COMPONENTS) as Prisma.InputJsonValue,
              settings: (base?.settings ?? DEFAULT_SETTINGS) as Prisma.InputJsonValue,
              createdById: user.id,
              createdByName: user.name,
            },
          })
        }
        for (let i = 0; i < r.rules.length; i += BATCH) {
          await tx.freightRule.createMany({
            data: r.rules.slice(i, i + BATCH).map((x) => ({
              versionId: target.id,
              line: x.line,
              cepStart: x.cepStart,
              cepEnd: x.cepEnd,
              uf: x.uf,
              city: x.city,
              cityKey: x.cityKey,
              weightMin: x.weightMin,
              weightMax: x.weightMax,
              deadlineDays: x.deadlineDays,
              restricted: x.restricted,
              values: x.values,
              note: x.note,
            })),
          })
        }
        await tx.freightTableVersion.update({
          where: { id: target.id },
          data: { rulesCount: r.rules.length, source: 'IMPORTACAO', note: cleanText(d.note, 300) || `Importada de ${imp.fileName}` },
        })
        await tx.freightImport.update({
          where: { id: importId },
          data: {
            status: 'CONCLUIDA',
            versionId: target.id,
            sheet: d.sheet,
            headerRow: d.headerRow,
            mapping: d.mapping as unknown as Prisma.InputJsonValue,
            readLines: r.readLines,
            importedLines: r.importedLines,
            rejectedLines: r.errorLines,
            rulesCount: r.rules.length,
            report: { issueCount: r.issueCount, issues: r.issues } as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        })
        return target.id
      },
      { timeout: 120_000 },
    )
    await this.audit.byUser(user, ctx, 'frete.importacao.concluida', 'freight_table', t.id, { importacao: importId, arquivo: imp.fileName, regras: r.rules.length, linhasRejeitadas: r.errorLines })
    return { versionId, rules: r.rules.length, importedLines: r.importedLines, rejectedLines: r.errorLines, issueCount: r.issueCount }
  }

  async cancel(user: AuthUser, importId: string, ctx: RequestCtx) {
    assertCan(user, 'fretes_tabelas', 'create')
    const imp = await this.prisma.freightImport.findFirst({ where: { id: importId, tenantId: user.tenantId } })
    if (!imp) throw new NotFoundException('Importação não encontrada.')
    await this.table(user, imp.tableId)
    if (imp.status !== 'ANALISE') return { ok: true }
    await this.prisma.freightImport.update({ where: { id: importId }, data: { status: 'CANCELADA', finishedAt: new Date() } })
    await this.audit.byUser(user, ctx, 'frete.importacao.cancelada', 'freight_table', imp.tableId, { importacao: importId })
    return { ok: true }
  }

  async report(user: AuthUser, importId: string) {
    assertCan(user, 'fretes_tabelas', 'view')
    const imp = await this.prisma.freightImport.findFirst({ where: { id: importId, tenantId: user.tenantId } })
    if (!imp) throw new NotFoundException('Importação não encontrada.')
    await this.table(user, imp.tableId)
    return { id: imp.id, fileName: imp.fileName, status: imp.status, mapping: imp.mapping, report: imp.report, readLines: imp.readLines, importedLines: imp.importedLines, rejectedLines: imp.rejectedLines, rulesCount: imp.rulesCount, createdAt: imp.createdAt, createdByName: imp.createdByName }
  }

  /** Arquivo original enviado (para conferir depois). */
  async original(user: AuthUser, importId: string) {
    assertCan(user, 'fretes_tabelas', 'view')
    const imp = await this.prisma.freightImport.findFirst({ where: { id: importId, tenantId: user.tenantId } })
    if (!imp) throw new NotFoundException('Importação não encontrada.')
    await this.table(user, imp.tableId)
    const { asset, content } = await this.files.read(imp.fileId)
    return { fileName: imp.fileName, mime: asset.mime, content }
  }
}
