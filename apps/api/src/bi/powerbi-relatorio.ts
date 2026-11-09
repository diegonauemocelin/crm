/**
 * Power BI (fase 2): relatório do projeto (.pbip) no formato PBIR (uma pasta por página e um visual.json por visual).
 * Só visuais nativos (cartão, linhas, colunas, barras, rosca, funil, matriz, tabela, segmentação). Puro (testado em
 * bi-powerbi.spec.ts, que confere se todo campo usado existe no modelo).
 */
import { CALENDARIO, CENARIOS, MEDIDAS } from './powerbi-modelo'

export const SCHEMA = {
  report: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/2.0.0/schema.json',
  version: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json',
  pages: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json',
  page: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json',
  visual: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.1.0/schema.json',
} as const

export const TEMA = 'CY25SU12'

// ---------- Campos ----------

/** Campo usado num visual: coluna, medida (sempre da _Medidas) ou nível de hierarquia. */
export type Campo = { tipo: 'coluna'; tabela: string; coluna: string } | { tipo: 'medida'; nome: string } | { tipo: 'nivel'; tabela: string; hierarquia: string; nivel: string }

export const col = (tabela: string, coluna: string): Campo => ({ tipo: 'coluna', tabela, coluna })
export const med = (nome: string): Campo => ({ tipo: 'medida', nome })
/** Todos os níveis de uma hierarquia (o visual começa no primeiro e desce com o drill-down). */
export const hier = (tabela: string, hierarquia: string, niveis: string[]): Campo[] => niveis.map((nivel) => ({ tipo: 'nivel', tabela, hierarquia, nivel }))

const CALENDARIO_H = hier(CALENDARIO, 'Calendário', ['Ano', 'Trimestre', 'Mês', 'Dia'])
const MES_ANO = col(CALENDARIO, 'Mês/Ano')

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const texto = (s: string) => lit(`'${s.replace(/'/g, "''")}'`)

function fieldOf(c: Campo) {
  const src = (e: string) => ({ SourceRef: { Entity: e } })
  if (c.tipo === 'coluna') return { field: { Column: { Expression: src(c.tabela), Property: c.coluna } }, queryRef: `${c.tabela}.${c.coluna}`, nativeQueryRef: c.coluna }
  if (c.tipo === 'medida') return { field: { Measure: { Expression: src(MEDIDAS), Property: c.nome } }, queryRef: `${MEDIDAS}.${c.nome}`, nativeQueryRef: c.nome }
  return {
    field: { HierarchyLevel: { Expression: { Hierarchy: { Expression: src(c.tabela), Hierarchy: c.hierarquia } }, Level: c.nivel } },
    queryRef: `${c.tabela}.${c.hierarquia}.${c.nivel}`,
    nativeQueryRef: `${c.hierarquia} ${c.nivel}`,
  }
}

/** Projeções de um papel: com vários campos de categoria, só o primeiro fica ativo (os outros são o drill-down). */
function projecoes(campos: Campo[], drill: boolean) {
  return { projections: campos.map((c, i) => ({ ...fieldOf(c), ...(drill && campos.length > 1 ? { active: i === 0 } : {}) })) }
}

// ---------- Visuais ----------

export interface Posicao {
  x: number
  y: number
  w: number
  h: number
}

export interface Visual {
  nome: string
  tipo: string
  pos: Posicao
  papeis: Record<string, Campo[]>
  titulo?: string
  /** Segmentação: 'Dropdown' (texto), 'Single' (valor único, para os cenários) ou padrão (datas: intervalo). */
  modoSegmentacao?: 'Dropdown' | 'Single'
}

export interface Pagina {
  nome: string
  titulo: string
  visuais: Visual[]
}

/** Papéis (roles) de cada tipo de visual: o de categoria aceita drill-down. */
const DRILL_ROLE: Record<string, string> = {
  lineChart: 'Category',
  clusteredColumnChart: 'Category',
  clusteredBarChart: 'Category',
  donutChart: 'Category',
  funnel: 'Category',
  pivotTable: 'Rows',
}

export function visualJson(v: Visual, z: number) {
  const queryState: Record<string, unknown> = {}
  for (const [papel, campos] of Object.entries(v.papeis)) queryState[papel] = projecoes(campos, DRILL_ROLE[v.tipo] === papel)
  const visual: Record<string, unknown> = { visualType: v.tipo, query: { queryState } }
  if (v.modoSegmentacao) visual.objects = { data: [{ properties: { mode: texto(v.modoSegmentacao) } }] }
  if (v.titulo) visual.visualContainerObjects = { title: [{ properties: { show: lit('true'), text: texto(v.titulo) } }] }
  if (v.tipo !== 'slicer' && v.tipo !== 'card') visual.drillFilterOtherVisuals = true
  return {
    $schema: SCHEMA.visual,
    name: v.nome,
    position: { x: v.pos.x, y: v.pos.y, z, height: v.pos.h, width: v.pos.w, tabOrder: z },
    visual,
  }
}

// ---------- Layout (página 1280 x 720) ----------

const M = 16
const LARGURA = 1280

/** Distribui n itens numa linha (x de 16 a 1264). */
function linha(n: number, y: number, h: number, inicio = M, fim = LARGURA - M): Posicao[] {
  const gap = 8
  const w = Math.floor((fim - inicio - gap * (n - 1)) / n)
  return Array.from({ length: n }, (_, i) => ({ x: inicio + i * (w + gap), y, w, h }))
}

function montar(pagina: string, titulo: string, partes: { tipo: string; papeis: Record<string, Campo[]>; titulo?: string; modo?: Visual['modoSegmentacao']; pos: Posicao }[]): Pagina {
  return {
    nome: pagina,
    titulo,
    visuais: partes.map((p, i) => ({ nome: `${pagina}_${String(i + 1).padStart(2, '0')}`, tipo: p.tipo, pos: p.pos, papeis: p.papeis, titulo: p.titulo, modoSegmentacao: p.modo })),
  }
}

const seg = (campo: Campo, titulo: string, pos: Posicao, modo?: Visual['modoSegmentacao']) => ({ tipo: 'slicer', papeis: { Values: [campo] }, titulo, modo, pos })
const segTexto = (tabela: string, coluna: string, titulo: string, pos: Posicao) => seg(col(tabela, coluna), titulo, pos, 'Dropdown')
const cartoes = (nomes: string[], y = 72, h = 96) => linha(nomes.length, y, h).map((pos, i) => ({ tipo: 'card', papeis: { Values: [med(nomes[i]!)] }, pos }))
const grafico = (tipo: string, titulo: string, categoria: Campo[], valores: string[], pos: Posicao) => ({ tipo, titulo, papeis: { Category: categoria, Y: valores.map(med) }, pos })
const tabela = (titulo: string, campos: Campo[], pos: Posicao) => ({ tipo: 'tableEx', titulo, papeis: { Values: campos }, pos })
const matriz = (titulo: string, linhas: Campo[], valores: string[], pos: Posicao) => ({ tipo: 'pivotTable', titulo, papeis: { Rows: linhas, Values: valores.map(med) }, pos })

/** Linha de segmentações: período (mais larga) e as outras. */
function segmentacoes(outras: [string, string, string][]) {
  const [periodo, ...resto] = linha(outras.length + 2, 8, 56)
  const p = { ...periodo!, w: periodo!.w * 2 + 8 }
  const posicoes = resto.slice(1)
  return [seg(col(CALENDARIO, 'Data'), 'Período', p), ...outras.map(([t, c, titulo], i) => segTexto(t, c, titulo, posicoes[i]!))]
}

const FILIAL: [string, string, string] = ['dim_filial', 'nome', 'Filial']
const VENDEDOR: [string, string, string] = ['dim_vendedor', 'nome', 'Vendedor']
const ORIGEM: [string, string, string] = ['dim_origem', 'nome', 'Origem']

// Áreas abaixo dos cartões: duas linhas de gráficos.
const A1 = 180
const H1 = 262
const A2 = 452
const H2 = 256

export function paginas(): Pagina[] {
  const visao = montar('visao_geral', 'Visão geral', [
    ...segmentacoes([FILIAL, VENDEDOR, ORIGEM]),
    ...cartoes(['Receita total (pré-vendas + loja)', 'Receita das pré-vendas', 'Receita das pré-vendas vs. ano anterior (%)', 'Vendas', 'Taxa de conversão', 'Ticket médio', 'Atendimentos WhatsApp']),
    grafico('lineChart', 'Receita das pré-vendas e da loja (drill-down: ano, trimestre, mês, dia)', CALENDARIO_H, ['Receita das pré-vendas', 'Receita das pré-vendas (ano anterior)', 'Receita da loja'], { x: M, y: A1, w: 820, h: H1 }),
    grafico('donutChart', 'Receita das pré-vendas por filial', [col('dim_filial', 'nome')], ['Receita das pré-vendas'], { x: 844, y: A1, w: 420, h: H1 }),
    grafico('clusteredColumnChart', 'Pré-vendas e vendas por mês', [MES_ANO], ['Pré-vendas', 'Vendas'], { x: M, y: A2, w: 616, h: H2 }),
    grafico('clusteredBarChart', 'Vendas por origem (drill-down: canal, origem, campanha)', hier('fato_atendimentos', 'Origem', ['Canal', 'Origem', 'Campanha']), ['Vendas', 'Receita das pré-vendas'], { x: 640, y: A2, w: 624, h: H2 }),
  ])

  const comercial = montar('comercial', 'Comercial', [
    ...segmentacoes([FILIAL, VENDEDOR, ORIGEM]),
    ...cartoes(['Pré-vendas', 'Vendas', 'Perdas', 'Em negociação', 'Taxa de conversão', 'Taxa de conversão vs. ano anterior (p.p.)', 'Tempo até o repasse (min, mediana)']),
    grafico('funnel', 'Funil de leads por estágio', [col('fato_leads', 'estagio')], ['Leads'], { x: M, y: A1, w: 400, h: H1 }),
    grafico('clusteredBarChart', 'Conversão por filial e vendedor (drill-down)', hier('dim_vendedor', 'Comercial', ['Filial', 'Vendedor']), ['Taxa de conversão'], { x: 424, y: A1, w: 420, h: H1 }),
    grafico('clusteredBarChart', 'Perdas por motivo', [col('dim_motivo_perda', 'nome')], ['Perdas'], { x: 852, y: A1, w: 412, h: H1 }),
    matriz('Resultado por filial e vendedor (expanda as linhas)', [col('dim_filial', 'nome'), col('dim_vendedor', 'nome')], ['Pré-vendas', 'Vendas', 'Taxa de conversão', 'Receita das pré-vendas', 'Ticket médio', 'Perdas', 'Receita das pré-vendas vs. ano anterior (%)'], { x: M, y: A2, w: 1248, h: H2 }),
  ])

  const whatsapp = montar('whatsapp', 'WhatsApp', [
    ...segmentacoes([
      ['dim_numero_whatsapp', 'nome', 'Número'],
      ['dim_setor', 'nome', 'Setor'],
      ['dim_usuario', 'nome', 'Atendente'],
    ]),
    ...cartoes(['Atendimentos WhatsApp', 'Atendimentos recebidos', 'Primeira resposta comercial (min, mediana)', '% respondidos em 15 min', 'Sem resposta', 'Aguardando agora']),
    grafico('lineChart', 'Tempo da primeira resposta (min, mediana)', CALENDARIO_H, ['Primeira resposta comercial (min, mediana)', 'Primeira resposta (min, mediana)'], { x: M, y: A1, w: 616, h: H1 }),
    grafico('clusteredBarChart', 'Atendimentos por número', [col('dim_numero_whatsapp', 'nome')], ['Atendimentos WhatsApp'], { x: 640, y: A1, w: 308, h: H1 }),
    grafico('clusteredBarChart', 'Atendimentos por setor', [col('dim_setor', 'nome')], ['Atendimentos WhatsApp'], { x: 956, y: A1, w: 308, h: H1 }),
    tabela('Atendentes', [col('dim_usuario', 'nome'), med('Atendimentos recebidos'), med('Primeira resposta comercial (min, mediana)'), med('% respondidos em 15 min'), med('Sem resposta'), med('Mensagens enviadas')], { x: M, y: A2, w: 820, h: H2 }),
    grafico('clusteredColumnChart', 'Atendimentos recebidos por dia da semana', [col(CALENDARIO, 'Dia da semana')], ['Atendimentos recebidos'], { x: 844, y: A2, w: 420, h: H2 }),
  ])

  const loja = montar('loja_ml', 'Loja e Mercado Livre', [
    ...segmentacoes([['fato_pedidos_loja', 'canal', 'Canal da loja']]),
    ...cartoes(['Receita da loja', 'Pedidos pagos', 'Ticket médio da loja', 'Valor em carrinhos abandonados', 'Receita ML Ads', 'ROAS ML', 'Perguntas', '% respondidas pelo CRM']),
    grafico('lineChart', 'Receita da loja (drill-down por data)', CALENDARIO_H, ['Receita da loja', 'Receita da loja (ano anterior)'], { x: M, y: A1, w: 616, h: H1 }),
    grafico('clusteredBarChart', 'Receita por marca e produto (drill-down)', hier('dim_produto', 'Produto', ['Marca', 'Produto']), ['Receita dos itens'], { x: 640, y: A1, w: 308, h: H1 }),
    grafico('clusteredBarChart', 'Receita da loja por UF e cidade (drill-down)', hier('fato_pedidos_loja', 'Geografia', ['UF', 'Cidade']), ['Receita da loja'], { x: 956, y: A1, w: 308, h: H1 }),
    grafico('clusteredColumnChart', 'Mercado Livre Ads por mês', [MES_ANO], ['Investimento ML Ads', 'Receita ML Ads'], { x: M, y: A2, w: 616, h: H2 }),
    tabela('Campanhas do Mercado Livre Ads', [col('fato_ml_ads_diario', 'campanha'), med('Investimento ML Ads'), med('Receita ML Ads'), med('ROAS ML'), med('ACOS ML')], { x: 640, y: A2, w: 624, h: H2 }),
  ])

  const marketing = montar('marketing', 'Marketing', [
    ...segmentacoes([['fato_anuncios_diario', 'plataforma', 'Plataforma']]),
    ...cartoes(['Investimento', 'Cliques', 'CTR', 'CPC', 'CPL Google', 'CPA Google', 'ROAS Google']),
    grafico('clusteredColumnChart', 'Investimento por plataforma e campanha (drill-down)', hier('fato_anuncios_diario', 'Campanha', ['Plataforma', 'Campanha']), ['Investimento'], { x: M, y: A1, w: 400, h: H1 }),
    tabela('Campanhas: CPL, CPA e ROAS', [col('fato_anuncios_diario', 'campanha'), med('Investimento'), med('Cliques'), med('CTR'), med('CPC'), med('Leads dos anúncios'), med('CPL (plataforma)'), med('CPA (plataforma)'), med('ROAS da campanha')], { x: 424, y: A1, w: 840, h: H1 }),
    matriz('Resultado por origem (expanda: canal, origem, campanha)', hier('fato_atendimentos', 'Origem', ['Canal', 'Origem', 'Campanha']), ['Pré-vendas', 'Vendas', 'Taxa de conversão', 'Receita das pré-vendas'], { x: M, y: A2, w: 616, h: H2 }),
    tabela('Campanhas de e-mail', [col('fato_email_campanhas', 'nome'), med('E-mails enviados'), med('Taxa de abertura'), med('Taxa de clique (e-mail)'), med('Descadastro')], { x: 640, y: A2, w: 624, h: H2 }),
  ])

  const fretes = montar('fretes', 'Fretes', [
    ...segmentacoes([FILIAL, ['dim_transportadora', 'nome', 'Transportadora']]),
    ...cartoes(['Frete pago (CT-e)', 'Frete sobre a venda', 'Frete sobre a carga', 'Frete por kg', 'Cotações', '% cotações escolhidas', 'Divergência cobrada']),
    grafico('lineChart', 'Frete pago (drill-down por data)', CALENDARIO_H, ['Frete pago (CT-e)', 'Frete pago (CT-e) (ano anterior)'], { x: M, y: A1, w: 616, h: H1 }),
    grafico('clusteredBarChart', 'Frete por transportadora', [col('dim_transportadora', 'nome')], ['Frete pago (CT-e)'], { x: 640, y: A1, w: 308, h: H1 }),
    grafico('clusteredBarChart', 'Frete por destino (drill-down: UF, cidade)', hier('fato_ctes', 'Destino', ['UF', 'Cidade']), ['Frete pago (CT-e)'], { x: 956, y: A1, w: 308, h: H1 }),
    tabela('Transportadoras', [col('dim_transportadora', 'nome'), med('CT-es'), med('Frete pago (CT-e)'), med('Frete sobre a carga'), med('% CT-es conciliados'), med('Divergência cobrada'), med('Crédito das contestações')], { x: M, y: A2, w: 820, h: H2 }),
    grafico('clusteredColumnChart', 'Cotações por mês', [MES_ANO], ['Cotações'], { x: 844, y: A2, w: 420, h: H2 }),
  ])

  const sliders = linha(CENARIOS.length + 1, 8, 72)
  const cenarios = montar('cenarios', 'Cenários', [
    seg(col(CALENDARIO, 'Data'), 'Período', sliders[0]!),
    ...CENARIOS.map((c, i) => seg(col(c.nome, c.nome), c.nome, sliders[i + 1]!, 'Single')),
    ...linha(6, 88, 84).map((pos, i) => ({ tipo: 'card', papeis: { Values: [med(['Receita das pré-vendas', 'Receita projetada', 'Diferença de receita', 'Vendas', 'Vendas projetadas', 'Diferença de vendas'][i]!)] }, pos })),
    ...linha(6, 180, 84).map((pos, i) => ({ tipo: 'card', papeis: { Values: [med(['ROAS Google', 'ROAS projetado', 'Diferença de ROAS', 'Frete pago (CT-e)', 'Frete projetado', 'Diferença de frete'][i]!)] }, pos })),
    grafico('clusteredColumnChart', 'Receita real x projetada', [MES_ANO], ['Receita das pré-vendas', 'Receita projetada'], { x: M, y: 276, w: 616, h: 212 }),
    grafico('lineChart', 'Frete real x projetado', CALENDARIO_H, ['Frete pago (CT-e)', 'Frete projetado'], { x: 640, y: 276, w: 624, h: 212 }),
    matriz('Cenário por filial e vendedor', [col('dim_filial', 'nome'), col('dim_vendedor', 'nome')], ['Receita das pré-vendas', 'Receita projetada', 'Diferença de receita', 'Vendas', 'Vendas projetadas', 'Taxa de conversão projetada'], { x: M, y: 496, w: 1248, h: 212 }),
  ])

  return [visao, comercial, whatsapp, loja, marketing, fretes, cenarios]
}

// ---------- Arquivos do relatório ----------

export function reportJson() {
  return {
    $schema: SCHEMA.report,
    themeCollection: { baseTheme: { name: TEMA, reportVersionAtImport: '5.69', type: 'SharedResources' } },
    resourcePackages: [{ name: 'SharedResources', type: 'SharedResources', items: [{ name: TEMA, path: `BaseThemes/${TEMA}.json`, type: 'BaseTheme' }] }],
    settings: {
      useStylableVisualContainerHeader: true,
      defaultDrillFilterOtherVisuals: true,
      allowChangeFilterTypes: true,
      useEnhancedTooltips: true,
    },
  }
}

export function pageJson(p: Pagina) {
  return { $schema: SCHEMA.page, name: p.nome, displayName: p.titulo, displayOption: 'FitToPage', height: 720, width: 1280 }
}

export function pagesJson(ps: Pagina[]) {
  return { $schema: SCHEMA.pages, pageOrder: ps.map((p) => p.nome), activePageName: ps[0]!.nome }
}

export const versionJson = () => ({ $schema: SCHEMA.version, version: '2.0.0' })
