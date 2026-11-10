/**
 * Power BI (fase 2): modelo semântico do projeto do Power BI (.pbip) em TMDL, montado a partir do catálogo das tabelas
 * (bi-tabelas.ts) e da função do Power Query do contrato (bi-contrato.ts). Puro: sem Nest nem banco (testado em
 * bi-powerbi.spec.ts, que também confere se a pasta bi/powerbi do repositório está em dia).
 *
 * TMDL: um tab por nível; objeto (nível 0 ou 1), propriedades um nível abaixo e expressões de várias linhas um nível
 * abaixo das propriedades. Nomes com espaço, ponto, dois-pontos, igual ou aspas vão entre aspas simples.
 */
import { M_CRM_TABELA, M_TYPE } from './bi-contrato'
import { type BiColumn, type BiTable, type ColType, TABLES } from './bi-tabelas'

/** Endereço da API de BI gravado no arquivo do repositório (o download troca pelo endereço real do CRM). */
export const POWERBI_BASE_PADRAO = 'https://crm.usaparts.com.br/api/bi/v1/'

export const MEDIDAS = '_Medidas'
export const CALENDARIO = 'Calendario'

// ---------- Formatos (cultura pt-BR: o Power BI troca ponto e vírgula na exibição) ----------

export const FMT = {
  moeda: '\\R$ #,0.00;-\\R$ #,0.00;\\R$ #,0.00',
  inteiro: '#,0',
  decimal: '#,0.0',
  razao: '#,0.00',
  pct: '0.0%',
  variacao: '+0.0%;-0.0%;0.0%',
  data: 'dd/MM/yyyy',
  datahora: 'dd/MM/yyyy HH:mm',
} as const

// ---------- Estrutura ----------

export interface PbiColumn {
  nome: string
  dataType: 'string' | 'int64' | 'double' | 'decimal' | 'dateTime' | 'boolean'
  /** Coluna de origem (importada) ou [Nome] (tabela calculada). */
  sourceColumn?: string
  /** Coluna calculada (DAX). */
  expressao?: string
  formatString?: string
  summarizeBy: 'none' | 'sum' | 'average'
  isHidden?: boolean
  isKey?: boolean
  sortByColumn?: string
  descricao?: string
  /** Data sem hora (anotação que o Power BI Desktop usa). */
  soData?: boolean
}

export interface PbiHierarchy {
  nome: string
  niveis: { nome: string; coluna: string }[]
}

export interface PbiMeasure {
  nome: string
  expressao: string
  formato: string
  pasta: string
  descricao?: string
}

export interface PbiTable {
  nome: string
  descricao?: string
  dataCategory?: 'Time'
  colunas: PbiColumn[]
  medidas: PbiMeasure[]
  hierarquias: PbiHierarchy[]
  particao: { tipo: 'm' | 'calculated'; fonte: string }
}

export interface PbiRelationship {
  nome: string
  de: { tabela: string; coluna: string }
  para: { tabela: string; coluna: string }
  ativa: boolean
}

// ---------- Tabelas do contrato ----------

const DATA_TYPE: Record<ColType, PbiColumn['dataType']> = {
  texto: 'string',
  inteiro: 'int64',
  decimal: 'double',
  moeda: 'decimal',
  data: 'dateTime',
  datahora: 'dateTime',
  booleano: 'boolean',
}

const isIdLike = (c: BiColumn) => c.nome.endsWith('_id') || /^(codigo|situacao_codigo|relevancia|numero|serie|cfop|pedido_ml|pedido_codigo)$/.test(c.nome)

function formatOf(c: BiColumn): string | undefined {
  if (c.tipo === 'moeda') return FMT.moeda
  if (c.tipo === 'data') return FMT.data
  if (c.tipo === 'datahora') return FMT.datahora
  if (c.tipo === 'inteiro') return isIdLike(c) || c.nome.startsWith('pontos_') ? '0' : FMT.inteiro
  if (c.tipo === 'decimal') return FMT.decimal
  return undefined
}

function summarizeOf(c: BiColumn): PbiColumn['summarizeBy'] {
  if (isIdLike(c) || c.nome.startsWith('pontos_')) return 'none'
  if (c.tipo === 'moeda' || c.tipo === 'inteiro') return 'sum'
  if (c.tipo === 'decimal') return /^(minutos|horas|confianca)/.test(c.nome) ? 'average' : 'sum'
  return 'none'
}

/** Consulta do Power Query de uma tabela do contrato (a mesma do exemplo do contrato). */
export function particaoM(t: BiTable): string {
  const pairs = t.colunas.map((c) => `{"${c.nome}", ${M_TYPE[c.tipo]}}`)
  return ['let', `    Fonte = CRM_Tabela("${t.nome}"),`, `    Tipada = Table.TransformColumnTypes(Fonte, {${pairs.join(', ')}})`, 'in', '    Tipada'].join('\n')
}

function tabelaDoContrato(t: BiTable): PbiTable {
  const colunas: PbiColumn[] = t.colunas.map((c) => ({
    nome: c.nome,
    dataType: DATA_TYPE[c.tipo],
    sourceColumn: c.nome,
    formatString: formatOf(c),
    summarizeBy: summarizeOf(c),
    isHidden: c.nome.endsWith('_id') || undefined,
    isKey: (t.tipo === 'dimensao' && c.nome === t.chave) || undefined,
    descricao: c.descricao,
    soData: c.tipo === 'data' || undefined,
  }))
  const hierarquias: PbiHierarchy[] = []
  const extra = EXTRAS[t.nome]
  if (extra) {
    colunas.push(...extra.colunas)
    hierarquias.push(...extra.hierarquias)
  }
  return { nome: t.nome, descricao: t.descricao, colunas, medidas: [], hierarquias, particao: { tipo: 'm', fonte: particaoM(t) } }
}

const calc = (nome: string, expressao: string, descricao: string): PbiColumn => ({ nome, dataType: 'string', expressao, summarizeBy: 'none', descricao })
const geo = (prefixo = ''): PbiHierarchy => ({ nome: 'Geografia', niveis: [{ nome: 'UF', coluna: `${prefixo}uf` }, { nome: 'Cidade', coluna: `${prefixo}cidade` }] })

/** Colunas calculadas e hierarquias (drill-down) além das colunas do contrato. */
const EXTRAS: Record<string, { colunas: PbiColumn[]; hierarquias: PbiHierarchy[] }> = {
  dim_vendedor: {
    colunas: [calc('filial', 'LOOKUPVALUE ( dim_filial[nome], dim_filial[filial_id], dim_vendedor[filial_id] )', 'Unidade do vendedor (nome), para a hierarquia Comercial.')],
    hierarquias: [{ nome: 'Comercial', niveis: [{ nome: 'Filial', coluna: 'filial' }, { nome: 'Vendedor', coluna: 'nome' }] }],
  },
  dim_produto: {
    colunas: [],
    hierarquias: [
      { nome: 'Marca e produto', niveis: [{ nome: 'Marca', coluna: 'marca' }, { nome: 'Produto', coluna: 'nome' }] },
      { nome: 'Grupo do ERP', niveis: [{ nome: 'Grupo', coluna: 'grupo' }, { nome: 'Subgrupo', coluna: 'subgrupo' }, { nome: 'Produto', coluna: 'nome' }] },
    ],
  },
  fato_atendimentos: {
    colunas: [calc('origem', 'RELATED ( dim_origem[nome] )', 'Nome da origem (dim_origem), para a hierarquia Canal e origem.')],
    hierarquias: [geo(), { nome: 'Canal e origem', niveis: [{ nome: 'Canal', coluna: 'canal_entrada' }, { nome: 'Origem', coluna: 'origem' }, { nome: 'Campanha', coluna: 'campanha_google' }] }],
  },
  fato_leads: { colunas: [], hierarquias: [geo()] },
  fato_pedidos_loja: { colunas: [], hierarquias: [geo()] },
  fato_carrinhos: { colunas: [], hierarquias: [geo()] },
  fato_frete_cotacoes: { colunas: [], hierarquias: [{ nome: 'Destino', niveis: [{ nome: 'UF', coluna: 'uf_destino' }, { nome: 'Cidade', coluna: 'cidade_destino' }] }] },
  fato_ctes: { colunas: [], hierarquias: [{ nome: 'Destino', niveis: [{ nome: 'UF', coluna: 'uf_fim' }, { nome: 'Cidade', coluna: 'cidade_fim' }] }] },
  fato_anuncios_diario: { colunas: [], hierarquias: [{ nome: 'Plataforma e campanha', niveis: [{ nome: 'Plataforma', coluna: 'plataforma' }, { nome: 'Campanha', coluna: 'campanha' }] }] },
  fato_ml_ads_diario: { colunas: [], hierarquias: [{ nome: 'Campanha e anúncio', niveis: [{ nome: 'Campanha', coluna: 'campanha' }, { nome: 'Anúncio', coluna: 'anuncio' }] }] },
}

// ---------- Calendário ----------

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo']

function calendario(): PbiTable {
  const fonte = [
    'VAR Datas =',
    '    CALENDAR ( DATE ( YEAR ( TODAY () ) - 5, 1, 1 ), DATE ( YEAR ( TODAY () ), 12, 31 ) )',
    'RETURN',
    '    ADDCOLUMNS (',
    '        SELECTCOLUMNS ( Datas, "Data", [Date] ),',
    '        "Ano", YEAR ( [Data] ),',
    '        "Trimestre", "T" & QUARTER ( [Data] ),',
    '        "Trimestre nº", QUARTER ( [Data] ),',
    '        "Mês nº", MONTH ( [Data] ),',
    `        "Mês", SWITCH ( MONTH ( [Data] ), ${MESES.map((m, i) => `${i + 1}, "${m}"`).join(', ')} ),`,
    `        "Mês/Ano", SWITCH ( MONTH ( [Data] ), ${MESES.map((m, i) => `${i + 1}, "${m.slice(0, 3)}"`).join(', ')} ) & "/" & RIGHT ( YEAR ( [Data] ), 2 ),`,
    '        "Ano-Mês nº", YEAR ( [Data] ) * 100 + MONTH ( [Data] ),',
    '        "Semana", WEEKNUM ( [Data], 21 ),',
    '        "Dia", DAY ( [Data] ),',
    `        "Dia da semana", SWITCH ( WEEKDAY ( [Data], 2 ), ${DIAS.map((d, i) => `${i + 1}, "${d}"`).join(', ')} ),`,
    '        "Dia da semana nº", WEEKDAY ( [Data], 2 )',
    '    )',
  ].join('\n')
  const c = (nome: string, dataType: PbiColumn['dataType'], extra: Partial<PbiColumn> = {}): PbiColumn => ({ nome, dataType, sourceColumn: `[${nome}]`, summarizeBy: 'none', formatString: dataType === 'int64' ? '0' : undefined, ...extra })
  return {
    nome: CALENDARIO,
    descricao: 'Calendário (dias de 5 anos atrás até o fim do ano atual). Marcado como tabela de datas.',
    dataCategory: 'Time',
    colunas: [
      c('Data', 'dateTime', { isKey: true, formatString: FMT.data, soData: true }),
      c('Ano', 'int64'),
      c('Trimestre', 'string', { sortByColumn: 'Trimestre nº' }),
      c('Trimestre nº', 'int64', { isHidden: true }),
      c('Mês nº', 'int64', { isHidden: true }),
      c('Mês', 'string', { sortByColumn: 'Mês nº' }),
      c('Mês/Ano', 'string', { sortByColumn: 'Ano-Mês nº' }),
      c('Ano-Mês nº', 'int64', { isHidden: true }),
      c('Semana', 'int64', { descricao: 'Semana ISO do ano.' }),
      c('Dia', 'int64'),
      c('Dia da semana', 'string', { sortByColumn: 'Dia da semana nº' }),
      c('Dia da semana nº', 'int64', { isHidden: true }),
    ],
    medidas: [],
    hierarquias: [
      {
        nome: 'Calendário',
        niveis: [
          { nome: 'Ano', coluna: 'Ano' },
          { nome: 'Trimestre', coluna: 'Trimestre' },
          { nome: 'Mês', coluna: 'Mês' },
          { nome: 'Dia', coluna: 'Dia' },
        ],
      },
    ],
    particao: { tipo: 'calculated', fonte },
  }
}

// ---------- Cenários (what-if) ----------

export interface Cenario {
  /** Nome da tabela e da coluna (o que aparece no controle deslizante). */
  nome: string
  /** Medida com o valor escolhido (fração: 10% = 0,1). */
  medida: string
  min: number
  max: number
  passo: number
}

export const CENARIOS: Cenario[] = [
  { nome: 'Variação da taxa de conversão (%)', medida: 'Cenário: variação da conversão', min: -50, max: 100, passo: 5 },
  { nome: 'Variação do investimento em anúncios (%)', medida: 'Cenário: variação do investimento', min: -50, max: 200, passo: 10 },
  { nome: 'Variação do ticket médio (%)', medida: 'Cenário: variação do ticket médio', min: -30, max: 50, passo: 5 },
  { nome: 'Variação do frete (%)', medida: 'Cenário: variação do frete', min: -30, max: 50, passo: 5 },
]

function tabelaCenario(c: Cenario): PbiTable {
  return {
    nome: c.nome,
    descricao: `Parâmetro de cenário (what-if): de ${c.min}% a ${c.max}%, de ${c.passo} em ${c.passo}. Use no controle deslizante da página Cenários.`,
    colunas: [{ nome: c.nome, dataType: 'int64', sourceColumn: '[Value]', formatString: '0', summarizeBy: 'none' }],
    medidas: [],
    hierarquias: [],
    particao: { tipo: 'calculated', fonte: `GENERATESERIES ( ${c.min}, ${c.max}, ${c.passo} )` },
  }
}

// ---------- Relações ----------

export function relacoes(): PbiRelationship[] {
  const out: PbiRelationship[] = []
  for (const t of TABLES) {
    for (const r of t.relacoes) {
      out.push({ nome: `${t.nome}_${r.coluna}`, de: { tabela: t.nome, coluna: r.coluna }, para: { tabela: r.tabela, coluna: r.chave }, ativa: r.ativa !== false })
    }
    t.datas.forEach((d, i) => out.push({ nome: `${t.nome}_${d}_calendario`, de: { tabela: t.nome, coluna: d }, para: { tabela: CALENDARIO, coluna: 'Data' }, ativa: i === 0 }))
  }
  return out
}

// ---------- Modelo completo ----------

export function tabelasDoModelo(medidas: PbiMeasure[]): PbiTable[] {
  const medidasTabela: PbiTable = {
    nome: MEDIDAS,
    descricao: 'Medidas do relatório, em pastas por área.',
    colunas: [{ nome: 'Coluna', dataType: 'int64', sourceColumn: '[Coluna]', formatString: '0', summarizeBy: 'none', isHidden: true }],
    medidas,
    hierarquias: [],
    particao: { tipo: 'calculated', fonte: 'ROW ( "Coluna", 0 )' },
  }
  return [medidasTabela, calendario(), ...TABLES.map(tabelaDoContrato), ...CENARIOS.map(tabelaCenario)]
}

// ---------- TMDL ----------

const SIMPLES = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Nome de objeto no TMDL (aspas simples quando não é um identificador simples). */
export const tmdlName = (n: string) => (SIMPLES.test(n) ? n : `'${n.replace(/'/g, "''")}'`)

/** Tabela no DAX: 'Nome' (sempre entre aspas simples quando não é identificador simples). */
export const daxTable = (n: string) => (SIMPLES.test(n) ? n : `'${n.replace(/'/g, "''")}'`)

const tabs = (n: number) => '\t'.repeat(n)

/** Expressão de várias linhas, recuada no nível pedido (sem linhas em branco). */
function bloco(expr: string, nivel: number): string[] {
  return expr.split('\n').filter((l) => l.trim() !== '').map((l) => tabs(nivel) + l.replace(/\s+$/, ''))
}

function descricao(d: string | undefined, nivel: number): string[] {
  if (!d) return []
  return [tabs(nivel) + '/// ' + d.replace(/\s*\n\s*/g, ' ')]
}

function objetoComExpressao(cabecalho: string, expr: string, nivel: number): string[] {
  if (!expr.includes('\n')) return [`${tabs(nivel)}${cabecalho} = ${expr}`]
  return [`${tabs(nivel)}${cabecalho} =`, ...bloco(expr, nivel + 2)]
}

export function tableTmdl(t: PbiTable): string {
  const L: string[] = [...descricao(t.descricao, 0), `table ${tmdlName(t.nome)}`]
  if (t.dataCategory) L.push(`\tdataCategory: ${t.dataCategory}`)
  L.push('')
  for (const m of t.medidas) {
    L.push(...descricao(m.descricao, 1), ...objetoComExpressao(`measure ${tmdlName(m.nome)}`, m.expressao, 1))
    L.push(`\t\tformatString: ${m.formato}`, `\t\tdisplayFolder: ${m.pasta}`, '')
  }
  for (const c of t.colunas) {
    L.push(...descricao(c.descricao, 1))
    if (c.expressao) L.push(...objetoComExpressao(`column ${tmdlName(c.nome)}`, c.expressao, 1))
    else L.push(`\tcolumn ${tmdlName(c.nome)}`)
    L.push(`\t\tdataType: ${c.dataType}`)
    if (c.isHidden) L.push('\t\tisHidden')
    if (c.isKey) L.push('\t\tisKey')
    if (c.formatString) L.push(`\t\tformatString: ${c.formatString}`)
    L.push(`\t\tsummarizeBy: ${c.summarizeBy}`)
    if (c.sourceColumn) L.push(`\t\tsourceColumn: ${c.sourceColumn}`)
    if (c.sortByColumn) L.push(`\t\tsortByColumn: ${tmdlName(c.sortByColumn)}`)
    if (c.soData) L.push('', '\t\tannotation UnderlyingDateTimeDataType = Date')
    L.push('')
  }
  for (const h of t.hierarquias) {
    L.push(`\thierarchy ${tmdlName(h.nome)}`, '')
    for (const n of h.niveis) L.push(`\t\tlevel ${tmdlName(n.nome)}`, `\t\t\tcolumn: ${tmdlName(n.coluna)}`, '')
  }
  L.push(`\tpartition ${tmdlName(t.nome)} = ${t.particao.tipo}`, '\t\tmode: import', '\t\tsource =', ...bloco(t.particao.fonte, 3), '')
  return L.join('\n')
}

export function relationshipsTmdl(rels: PbiRelationship[]): string {
  const L: string[] = []
  for (const r of rels) {
    L.push(`relationship ${tmdlName(r.nome)}`)
    if (!r.ativa) L.push('\tisActive: false')
    L.push(`\tfromColumn: ${tmdlName(r.de.tabela)}.${tmdlName(r.de.coluna)}`, `\ttoColumn: ${tmdlName(r.para.tabela)}.${tmdlName(r.para.coluna)}`, '')
  }
  return L.join('\n')
}

export function expressionsTmdl(base = POWERBI_BASE_PADRAO): string {
  return [
    '/// Endereço da API de BI do CRM (termina em /api/bi/v1/).',
    `expression CRM_BaseUrl = "${base}" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`,
    '',
    '\tannotation PBI_ResultType = Text',
    '',
    '/// Chave de acesso criada em Configurações › Power BI no CRM (crmbi_...).',
    'expression CRM_Chave = "" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=false]',
    '',
    '\tannotation PBI_ResultType = Text',
    '',
    '/// Lê uma tabela da API de BI do CRM, página por página (contrato de dados, seção 3).',
    'expression CRM_Tabela =',
    ...bloco(M_CRM_TABELA, 2),
    '',
    '\tannotation PBI_ResultType = Function',
    '',
  ].join('\n')
}

export function modelTmdl(tabelas: PbiTable[]): string {
  return [
    'model Model',
    '\tculture: pt-BR',
    '\tdefaultPowerBIDataSourceVersion: powerBI_V3',
    '\tsourceQueryCulture: pt-BR',
    '\tdataAccessOptions',
    '\t\tlegacyRedirects',
    '\t\treturnErrorValuesAsNull',
    '',
    'annotation __PBI_TimeIntelligenceEnabled = 0',
    '',
    ...tabelas.map((t) => `ref table ${tmdlName(t.nome)}`),
    '',
  ].join('\n')
}

export const DATABASE_TMDL = ['database', '\tcompatibilityLevel: 1567', ''].join('\n')

/** Arquivo da tabela (o nome do arquivo é o nome da tabela). */
export const tableFile = (nome: string) => `tables/${nome.replace(/[\\/:*?"<>|]/g, '_')}.tmdl`
