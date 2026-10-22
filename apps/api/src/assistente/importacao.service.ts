/**
 * Importação da base de conhecimento por planilha Excel: modelo, validação dos cabeçalhos, prévia, correção de linhas,
 * duplicidade, comparação antigo × novo e relatório. Nunca apaga registros que não estão na planilha.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { AssistKnowledge, Prisma } from '../generated/prisma/client'
import { toXlsx } from '../marketing/arquivos'
import { type Actor, AssistService } from './assist.service'
import { AssistKnowledgeService, type KnowledgeData } from './conhecimento.service'
import { KNOWLEDGE_CATEGORIES } from './constantes'
import { matchKey, norm, str } from './texto'
import { readXlsx } from './xlsx-leitor'

export const COLUMNS = [
  { key: 'category', header: 'Categoria', required: true, hint: 'Motor, hidráulico, filtros etc.' },
  { key: 'brand', header: 'Marca', required: true, hint: 'Fabricante da máquina' },
  { key: 'model', header: 'Modelo', required: true, hint: 'Modelo da máquina' },
  { key: 'part_code', header: 'Código', required: false, hint: 'Código da peça' },
  { key: 'product', header: 'Produto', required: true, hint: 'Nome da peça' },
  { key: 'application', header: 'Aplicação', required: false, hint: 'Compatibilidade confirmada' },
  { key: 'question', header: 'Pergunta', required: false, hint: 'Dúvida que o cliente pode fazer' },
  { key: 'answer', header: 'Resposta', required: true, hint: 'Resposta aprovada para a IA' },
  { key: 'source', header: 'Fonte', required: true, hint: 'Documento, catálogo ou responsável' },
  { key: 'status', header: 'Status', required: true, hint: 'Ativo ou inativo' },
] as const
type ColKey = (typeof COLUMNS)[number]['key']
export type RowData = Record<ColKey, string>

const HEADER_ALIASES: Record<string, ColKey> = Object.fromEntries(COLUMNS.map((c) => [norm(c.header), c.key]))
Object.assign(HEADER_ALIASES, { 'codigo da peca': 'part_code', cod: 'part_code', fabricante: 'brand', 'marca da maquina': 'brand', 'modelo da maquina': 'model', 'nome da peca': 'product', peca: 'product', compatibilidade: 'application', 'resposta aprovada': 'answer', situacao: 'status' })

function normalizeStatus(s: string) {
  const n = norm(s)
  if (n === 'ativo' || n === 'ativa') return 'Ativo'
  if (n === 'inativo' || n === 'inativa') return 'Inativo'
  return null
}

/** Classifica uma linha: novo, atualização, idêntico, duplicado na planilha ou erro. */
export function classifyRow(data: RowData, seenKeys: Map<string, number>, findExisting: (key: string) => AssistKnowledge | undefined) {
  const errors: string[] = []
  const warnings: string[] = []
  for (const c of COLUMNS) if (c.required && !data[c.key]) errors.push(`Campo obrigatório vazio: ${c.header}.`)
  if (data.status && !normalizeStatus(data.status)) errors.push('Status deve ser "Ativo" ou "Inativo".')
  if (!data.part_code) warnings.push('Sem código da peça: não será possível detectar atualizações nem ligar a um produto.')
  if (!data.application) warnings.push('Sem aplicação confirmada: a IA não poderá afirmar compatibilidade com base nesta linha.')
  if (data.category && !KNOWLEDGE_CATEGORIES.includes(data.category)) {
    const match = KNOWLEDGE_CATEGORIES.find((c) => norm(c) === norm(data.category))
    if (match) data.category = match
    else warnings.push(`Categoria "${data.category}" não está na lista padrão; será criada como nova categoria.`)
  }
  if (/(senha|password|token|secret|access_token)\s*[:=]/i.test(`${data.answer} ${data.source}`)) errors.push('A linha parece conter credenciais. Remova senhas e tokens da planilha.')
  const key = matchKey(data.part_code, data.application, data.model)
  if (errors.length) return { action: 'erro', errors, warnings, key, existing: undefined }
  if (key && seenKeys.has(key)) return { action: 'duplicado', errors, warnings: [...warnings, `Mesmo código e aplicação da linha ${seenKeys.get(key)}; esta linha será ignorada.`], key, existing: undefined }
  const existing = key ? findExisting(key) : undefined
  if (!existing) return { action: 'novo', errors, warnings, key, existing: undefined }
  const pairs: [string | null, string][] = [
    [existing.category, data.category],
    [existing.brand, data.brand],
    [existing.model, data.model],
    [existing.product, data.product],
    [existing.question, data.question],
    [existing.answer, data.answer],
    [existing.source, data.source],
  ]
  const same = pairs.every(([a, b]) => norm(a) === norm(b)) && (existing.status === 'ativo') === (normalizeStatus(data.status) === 'Ativo')
  return { action: same ? 'identico' : 'atualizacao', errors, warnings, key, existing }
}

@Injectable()
export class AssistImportService {
  constructor(
    private readonly assist: AssistService,
    private readonly knowledge: AssistKnowledgeService,
  ) {}

  private get prisma() {
    return this.assist.prisma
  }

  /** Modelo da planilha, com a linha de exemplo e as orientações. */
  template() {
    return toXlsx(
      [
        {
          name: 'Conhecimentos',
          header: COLUMNS.map((c) => c.header),
          rows: [['Filtros', 'Caterpillar', '416E', '1R-0750', 'Filtro de combustível', 'Retroescavadeira Caterpillar 416E', 'Esse filtro serve na 416E?', 'Sim. Conforme catálogo, o filtro 1R-0750 tem aplicação confirmada para a retroescavadeira Caterpillar 416E.', 'Catálogo Caterpillar SIS, validado por J. Silva', 'Ativo']],
        },
        {
          name: 'Orientações',
          header: ['Como preencher', ''],
          rows: [
            ['1', 'Use uma linha por conhecimento. Não altere os nomes das colunas da primeira linha.'],
            ['2', 'Obrigatórias: Categoria, Marca, Modelo, Produto, Resposta, Fonte e Status.'],
            ['3', 'Código + Aplicação identificam o registro. Se já existirem na base, a linha é tratada como atualização e você compara antes de confirmar.'],
            ['4', 'Status aceita apenas "Ativo" ou "Inativo".'],
            ['5', 'Em "Aplicação" informe somente compatibilidades confirmadas. A IA só afirma que uma peça serve quando a informação está aprovada.'],
            ['6', 'Nunca inclua senhas, tokens ou dados de clientes na planilha.'],
            ['7', 'Apague a linha de exemplo antes de importar.'],
            ['', ''],
            ['Categorias sugeridas', KNOWLEDGE_CATEGORIES.join(', ')],
          ],
        },
      ],
      'Modelo da base de conhecimento',
    )
  }

  private async existingFinder(tenantId: string) {
    const rows = await this.prisma.assistKnowledge.findMany({ where: { tenantId, deletedAt: null, matchKey: { not: null } }, orderBy: { id: 'asc' } })
    const byKey = new Map<string, AssistKnowledge>()
    for (const r of rows) if (!byKey.has(r.matchKey!)) byKey.set(r.matchKey!, r)
    return (key: string) => byKey.get(key)
  }

  /** Recebe a planilha: valida cabeçalhos, guarda as linhas classificadas e devolve o id da prévia. */
  async upload(tenantId: string, filename: string, buf: Uint8Array, actor: Actor) {
    let sheets
    try {
      sheets = readXlsx(buf)
    } catch (e) {
      throw new BadRequestException((e as Error).message || 'Não foi possível ler o arquivo. Verifique se é um Excel (.xlsx) válido.')
    }
    const ws = sheets.find((s) => s.name === 'Conhecimentos') ?? sheets[0]!
    const header = ws.rows.find((r) => r.rowNumber === 1)?.cells ?? []
    const colMap: Partial<Record<ColKey, number>> = {}
    header.forEach((h, i) => {
      const k = HEADER_ALIASES[norm(h)]
      if (k && colMap[k] === undefined) colMap[k] = i
    })
    const headerErrors = COLUMNS.filter((c) => c.required && colMap[c.key] === undefined).map((c) => `Coluna obrigatória ausente: "${c.header}".`)
    const rows: { rowNumber: number; data: RowData }[] = []
    if (!headerErrors.length) {
      for (const r of ws.rows) {
        if (r.rowNumber === 1) continue
        const data = Object.fromEntries(COLUMNS.map((c) => [c.key, colMap[c.key] !== undefined ? str(r.cells[colMap[c.key]!], 8000) : ''])) as RowData
        if (Object.values(data).every((v) => !v)) continue
        rows.push({ rowNumber: r.rowNumber, data })
      }
    }
    const imp = await this.prisma.assistImport.create({ data: { tenantId, filename: str(filename, 200), userId: actor.id, userName: actor.name, status: headerErrors.length ? 'invalida' : 'previa', totalRows: rows.length, headerErrors } })
    if (!headerErrors.length) {
      const find = await this.existingFinder(tenantId)
      const seen = new Map<string, number>()
      const data: Prisma.AssistImportRowCreateManyInput[] = []
      for (const { rowNumber, data: d } of rows) {
        const c = classifyRow(d, seen, find)
        if (c.key && !seen.has(c.key) && c.action !== 'erro') seen.set(c.key, rowNumber)
        data.push({ importId: imp.id, rowNumber, data: d, action: c.action, existingId: c.existing?.id ?? null, existing: (c.existing ?? undefined) as Prisma.InputJsonValue | undefined, errors: c.errors, warnings: c.warnings, decision: c.action === 'novo' ? 'aceitar' : 'pendente' })
      }
      if (data.length) await this.prisma.assistImportRow.createMany({ data })
    }
    return { id: imp.id, headerErrors }
  }

  async load(tenantId: string, id: number) {
    const imp = await this.prisma.assistImport.findFirst({ where: { id, tenantId } })
    if (!imp) throw new NotFoundException('Importação não encontrada.')
    return imp
  }

  /** Reclassifica todas as linhas (depois de uma correção), mantendo as decisões que continuam válidas. */
  async reclassify(tenantId: string, importId: number) {
    const rows = await this.prisma.assistImportRow.findMany({ where: { importId }, orderBy: { rowNumber: 'asc' } })
    const find = await this.existingFinder(tenantId)
    const seen = new Map<string, number>()
    for (const r of rows) {
      const data = r.data as RowData
      const c = classifyRow(data, seen, find)
      if (c.key && !seen.has(c.key) && c.action !== 'erro') seen.set(c.key, r.rowNumber)
      let decision = r.decision
      if (c.action === 'novo' && r.action !== 'novo') decision = 'aceitar'
      if (c.action !== r.action && c.action !== 'novo') decision = 'pendente'
      await this.prisma.assistImportRow.update({ where: { id: r.id }, data: { data, action: c.action, existingId: c.existing?.id ?? null, existing: (c.existing ?? undefined) as Prisma.InputJsonValue | undefined, errors: c.errors, warnings: c.warnings, decision } })
    }
  }

  async editRow(tenantId: string, importId: number, rowId: number, patch: { data?: Partial<RowData>; decision?: string }) {
    const imp = await this.load(tenantId, importId)
    if (imp.status !== 'previa') throw new ConflictException('Esta importação já foi finalizada.')
    const row = await this.prisma.assistImportRow.findFirst({ where: { id: rowId, importId } })
    if (!row) throw new NotFoundException('Linha não encontrada.')
    if (patch.data) {
      const data = { ...(row.data as RowData) }
      for (const c of COLUMNS) if (patch.data[c.key] !== undefined) data[c.key] = str(patch.data[c.key], 8000)
      await this.prisma.assistImportRow.update({ where: { id: row.id }, data: { data } })
      await this.reclassify(tenantId, importId)
    }
    if (patch.decision) {
      if (!['aceitar', 'rejeitar', 'pendente'].includes(patch.decision)) throw new BadRequestException('Decisão inválida.')
      await this.prisma.assistImportRow.update({ where: { id: row.id }, data: { decision: patch.decision } })
    }
    return { ok: true }
  }

  async decideAll(tenantId: string, importId: number, decision: 'aceitar' | 'rejeitar') {
    const imp = await this.load(tenantId, importId)
    if (imp.status !== 'previa') throw new ConflictException('Esta importação já foi finalizada.')
    await this.prisma.assistImportRow.updateMany({ where: { importId, action: 'atualizacao' }, data: { decision } })
    return { ok: true }
  }

  /** Confirma: só grava as linhas novas aceitas e as atualizações aceitas. Nunca apaga o que não está na planilha. */
  async confirm(tenantId: string, importId: number, actor: Actor, o: { canApprove: boolean }) {
    const imp = await this.load(tenantId, importId)
    if (imp.status !== 'previa') throw new ConflictException('Esta importação já foi finalizada.')
    const pending = await this.prisma.assistImportRow.count({ where: { importId, action: 'atualizacao', decision: 'pendente' } })
    if (pending) throw new ConflictException(`Há ${pending} atualização(ões) aguardando sua decisão. Compare os dados e aceite ou recuse cada uma.`)
    const statusMode = (await this.assist.ai(tenantId)).import_status_mode
    const rows = await this.prisma.assistImportRow.findMany({ where: { importId }, orderBy: { rowNumber: 'asc' } })
    const report = { total: rows.length, imported: 0, updated: 0, ignored: 0, errors: 0, errorDetails: [] as { row: number; reasons: string[] }[], ignoredDetails: [] as { row: number; reason: string }[] }
    for (const r of rows) {
      const data = r.data as RowData
      const sheetActive = normalizeStatus(data.status) === 'Ativo'
      // quem não pode aprovar importa como "em revisão"; o modo "revisao" força revisão para todos
      const status = !sheetActive ? 'inativo' : o.canApprove && statusMode !== 'revisao' ? 'ativo' : 'em_revisao'
      const k: KnowledgeData = { title: [data.product, data.model].filter(Boolean).join(' — ').slice(0, 200), category: data.category, brand: data.brand, model: data.model, partCode: data.part_code, product: data.product, application: data.application, question: data.question, answer: data.answer, source: data.source }
      let result: string
      if (r.action === 'erro') {
        report.errors++
        report.errorDetails.push({ row: r.rowNumber, reasons: (r.errors as string[] | null) ?? [] })
        result = 'erro'
      } else if (r.action === 'novo' && r.decision !== 'rejeitar') {
        const id = await this.knowledge.create(tenantId, k, { actor, status, originImportId: importId, approved: status === 'ativo' })
        await this.linkApplication(tenantId, k, id, status, actor)
        report.imported++
        result = `importado:${id}`
      } else if (r.action === 'atualizacao' && r.decision === 'aceitar' && r.existingId) {
        await this.knowledge.update(tenantId, r.existingId, k, { actor, status, changeType: `importacao:${importId}`, approved: status === 'ativo' })
        await this.linkApplication(tenantId, k, r.existingId, status, actor)
        report.updated++
        result = `atualizado:${r.existingId}`
      } else {
        report.ignored++
        const why = { identico: 'Registro idêntico já existe na base.', duplicado: 'Linha duplicada dentro da planilha.', atualizacao: r.decision === 'rejeitar' ? 'Atualização recusada pelo usuário.' : 'Atualização não confirmada.', novo: 'Linha recusada pelo usuário.' }[r.action] ?? 'Ignorada.'
        report.ignoredDetails.push({ row: r.rowNumber, reason: why })
        result = 'ignorado'
      }
      await this.prisma.assistImportRow.update({ where: { id: r.id }, data: { result } })
    }
    await this.prisma.assistImport.update({ where: { id: imp.id }, data: { status: 'confirmada', finishedAt: new Date(), totalRows: report.total, imported: report.imported, updated: report.updated, ignored: report.ignored, errors: report.errors, report } })
    return report
  }

  async cancel(tenantId: string, importId: number) {
    const imp = await this.load(tenantId, importId)
    if (imp.status !== 'previa') throw new ConflictException('Esta importação já foi finalizada.')
    await this.prisma.assistImport.update({ where: { id: imp.id }, data: { status: 'cancelada', finishedAt: new Date() } })
    return { ok: true }
  }

  private async linkApplication(tenantId: string, k: KnowledgeData, knowledgeId: number, status: string, actor: Actor) {
    if (!k.partCode || !k.model) return
    // aplicação confirmada só quando o conhecimento está ativo (aprovado)
    await this.knowledge.upsertApplication(tenantId, { partCode: k.partCode, productName: k.product, machineBrand: k.brand, machineModel: k.model, system: k.category, application: k.application, knowledgeId, source: k.source, validationStatus: status === 'ativo' && k.application ? 'confirmada' : 'pendente' }, actor)
  }
}
