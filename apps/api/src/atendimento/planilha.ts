/**
 * Conversão da planilha de Pré/Pós-Vendas (Google Sheets exportado em CSV) para atendimentos.
 * Só transforma texto em dados; quem grava no banco é o ImportService. Funções puras, testadas.
 */
import { createHash } from 'node:crypto'
import { normalizePhone, parseBrDate, parseMoney, ufFromPhone, ufFromText } from './br'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

const COLUMNS = {
  data: ['data', 'data do lead'],
  codigo: ['cod. cliente', 'cód. cliente', 'codigo do cliente', 'código do cliente'],
  nome: ['nome'],
  telefone: ['numero', 'número', 'telefone', 'celular'],
  email: ['email', 'e-mail'],
  vendedor: ['vendedor', 'vendedor transferido'],
  origem: ['origem', 'origem do lead'],
  tipo: ['tipo cliente', 'tipo de cliente'],
  estado: ['regiao - estado', 'região - estado', 'estado', 'uf'],
  cidade: ['cidade'],
  produto: ['produto/servico', 'produto/serviço', 'produto de interesse'],
  repassou: ['repassou', 'repassou ao vendedor?'],
  retornou: ['retornou', 'vendedor retornou?'],
  vendeu: ['venda realizada', 'venda realizada?'],
  perdeu: ['venda perdida'],
  motivo: ['motivos de perda', 'motivo de perda', 'motivo da venda perdida'],
  nf: ['n° nf', 'nº nf', 'nf', 'numero da nota fiscal', 'número da nota fiscal'],
  valor: ['valor', 'valor da venda'],
  obs: ['observacao pre e pos vendas', 'observação pré e pós vendas', 'observacoes', 'observações', 'observação'],
} as const

type ColumnKey = keyof typeof COLUMNS
const norm = (s: string) => s.trim().toLowerCase()

/** Localiza a linha de cabeçalho (a planilha tem título e linhas soltas antes dela). */
export function findHeader(rows: string[][]): { index: number; map: Partial<Record<ColumnKey, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i]!.map(norm)
    if (!cells.includes('nome')) continue
    const map: Partial<Record<ColumnKey, number>> = {}
    for (const [key, aliases] of Object.entries(COLUMNS) as [ColumnKey, readonly string[]][]) {
      const idx = cells.findIndex((c) => aliases.includes(c))
      if (idx >= 0) map[key] = idx
    }
    if (map.data !== undefined && map.nome !== undefined) return { index: i, map }
  }
  return null
}

/** Tipos de peça conhecidos; qualquer outro item da coluna de produto é tratado como marca da máquina. */
export const PART_TYPES = ['Filtro', 'Motor', 'Material Rodante', 'Tração ou Giro', 'Coroa de Giro', 'FPS']
const PART_SET = new Set(PART_TYPES.map(norm))

/** Nomes da planilha que são a mesma pessoa (confirmado com a empresa). */
export const SELLER_ALIASES: Record<string, string> = { 'evandro - itajaí': 'Evandro', 'evandro - itajai': 'Evandro' }

/** Valores da coluna "Motivos de Perda" que, na verdade, são situação do atendimento. */
const MOTIVO_VENDEU = 'vendeu'
const MOTIVO_AGUARDANDO = 'aguardando vendedor'

const COUNTRIES = ['paraguai', 'bolívia', 'bolivia', 'uruguai', 'venezuela', 'argentina', 'chile', 'peru', 'colômbia', 'colombia']

export interface MappedRecord {
  line: number
  leadAt: Date
  name: string
  customerCode: string | null
  phone: string | null
  email: string | null
  seller: string | null
  origin: string | null
  customerType: string | null
  country: string
  state: string | null
  city: string | null
  brands: string[]
  partTypes: string[]
  forwarded: boolean
  returnStatus: 'SIM' | 'NAO' | 'PENDENTE' | null
  saleStatus: 'SIM' | 'NAO' | 'NEGOCIACAO'
  lostReason: string | null
  invoiceNumber: string | null
  saleValue: number | null
  notes: string | null
  externalKey: string
}

export interface RowIssue {
  line: number
  message: string
}

const bool = (v: string | undefined) => norm(v ?? '') === 'true' || norm(v ?? '') === 'sim'

function titleCase(s: string) {
  return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
}

/** Converte uma linha da planilha. Retorna null para linhas vazias (a planilha tem milhares só com caixas desmarcadas). */
export function mapRow(cells: string[], map: Partial<Record<ColumnKey, number>>, line: number, issues: RowIssue[]): MappedRecord | null {
  const get = (k: ColumnKey) => (map[k] === undefined ? '' : (cells[map[k]!] ?? '').trim())

  const rawName = get('nome')
  const rawDate = get('data')
  const rawPhone = get('telefone')
  if (!rawName && !rawDate && !rawPhone) return null

  const leadAt = parseBrDate(rawDate)
  if (!leadAt) {
    issues.push({ line, message: `Data inválida "${rawDate || '(vazia)'}" — linha não importada (${rawName || 'sem nome'}).` })
    return null
  }

  const notes: string[] = []
  const obs = get('obs')
  if (obs) notes.push(obs)

  const phone = normalizePhone(rawPhone)
  if (rawPhone && !phone) notes.push(`Telefone original: ${rawPhone}`)

  // "~" é o prefixo que o WhatsApp mostra para contatos não salvos.
  const name = rawName.replace(/^~+\s*/, '').trim() || 'Sem nome'
  const code = get('codigo')
  const customerCode = !code || /^s\s*\/?\s*c$/i.test(code) ? null : code

  const regionText = get('estado')
  let state: string | null = ufFromText(regionText)
  let country = 'BR'
  if (!state && regionText) {
    if (COUNTRIES.includes(norm(regionText))) country = titleCase(regionText)
    else notes.push(`Região original: ${regionText}`)
  }
  if (!state && country === 'BR') state = ufFromPhone(phone)

  const tokens = get('produto')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const brands = [...new Set(tokens.filter((t) => !PART_SET.has(norm(t))))]
  const partTypes = [...new Set(tokens.filter((t) => PART_SET.has(norm(t))).map((t) => PART_TYPES.find((p) => norm(p) === norm(t))!))]

  const sellerRaw = get('vendedor')
  const seller = sellerRaw ? (SELLER_ALIASES[norm(sellerRaw)] ?? sellerRaw) : null

  const tipo = get('tipo')
  const customerType = !tipo || norm(tipo) === 'não informado' || norm(tipo) === 'nao informado' ? null : tipo

  const motivo = get('motivo')
  const forwarded = bool(get('repassou'))
  let returnStatus: MappedRecord['returnStatus'] = null
  if (norm(motivo) === MOTIVO_AGUARDANDO) returnStatus = 'PENDENTE'
  else if (bool(get('retornou'))) returnStatus = 'SIM'
  else if (forwarded) returnStatus = 'NAO'

  let saleStatus: MappedRecord['saleStatus'] = 'NEGOCIACAO'
  let lostReason: string | null = null
  if (bool(get('vendeu')) || norm(motivo) === MOTIVO_VENDEU) saleStatus = 'SIM'
  else if (motivo && norm(motivo) !== MOTIVO_AGUARDANDO) {
    saleStatus = 'NAO'
    lostReason = motivo
  } else if (bool(get('perdeu'))) {
    saleStatus = 'NAO'
    lostReason = 'Outro'
  }

  const invoiceNumber = get('nf') || null
  const saleValue = parseMoney(get('valor'))
  if (saleStatus === 'SIM' && (!invoiceNumber || saleValue === null)) {
    issues.push({ line, message: `Venda sem nota fiscal ou valor (${name}). Importada assim; complete no sistema.` })
  }

  const email = get('email')
  const externalKey = createHash('sha256')
    .update([rawDate, rawName, rawPhone, code, sellerRaw, get('produto'), obs].join('|'))
    .digest('hex')
    .slice(0, 40)

  return {
    line,
    leadAt,
    name,
    customerCode,
    phone,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null,
    seller,
    origin: get('origem') || null,
    customerType,
    country,
    state,
    city: get('cidade') || null,
    brands,
    partTypes,
    forwarded,
    returnStatus,
    saleStatus,
    lostReason,
    invoiceNumber: saleStatus === 'SIM' ? invoiceNumber : null,
    saleValue: saleStatus === 'SIM' ? saleValue : null,
    notes: notes.join('\n') || null,
    externalKey,
  }
}

export function mapSheet(csv: string) {
  const rows = parseCsv(csv)
  const header = findHeader(rows)
  if (!header) throw new Error('Cabeçalho não encontrado: a planilha precisa ter as colunas "Data" e "Nome".')
  const issues: RowIssue[] = []
  const records: MappedRecord[] = []
  for (let i = header.index + 1; i < rows.length; i++) {
    const r = mapRow(rows[i]!, header.map, i + 1, issues)
    if (r) records.push(r)
  }
  return { records, issues, columns: Object.keys(header.map) }
}
