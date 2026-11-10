/**
 * Análises (BI nativo do CRM), fase 1: o modelo do motor de consultas. Funções puras (sem Nest e sem banco), testadas
 * em test/analises.spec.ts.
 *
 * - Fontes: os fatos lidos por SQL (atendimentos de pré-venda e leads) e o WhatsApp (calculado no código, mesma regra
 *   do painel do WhatsApp). Cada fonte segue a permissão de um módulo do CRM (ver e escopo próprios/unidade/todos).
 * - Dimensões e medidas: listas fechadas. O SQL de cada uma é fixo, escrito aqui; o que vem do usuário (datas,
 *   filtros, ids) entra sempre como parâmetro (Prisma.sql), nunca no texto do SQL.
 * - Medidas com a mesma definição das medidas do Power BI (bi/powerbi-medidas.ts): vendas pela data do lead,
 *   conversão = vendas / pré-vendas, ticket = receita / vendas, tempos em mediana.
 *
 * Para as fases 2 e 3 (WhatsApp, Loja/ML, Marketing, Fretes, Cenários): nova fonte em FONTES, medidas em MEDIDAS e
 * a página em PAGINAS (a tela monta a página pela configuração).
 */
import { Prisma } from '../generated/prisma/client'
import type { ModuleKey, Scope } from '../common/permissions'

// ---------- Tipos ----------

export type FonteId = 'atendimentos' | 'leads' | 'whatsapp'
export type Formato = 'inteiro' | 'moeda' | 'pct' | 'decimal' | 'minutos'
export const DIM_IDS = ['ano', 'trimestre', 'mes', 'dia', 'filial', 'vendedor', 'origem', 'canal', 'campanha', 'uf', 'cidade', 'motivo', 'situacao', 'estagio'] as const
export type DimId = (typeof DIM_IDS)[number]
export const TEMPO: DimId[] = ['ano', 'trimestre', 'mes', 'dia']
/** Chave dos valores vazios (sem filial, sem origem...): dá para filtrar e cruzar por ela também. */
export const VAZIO = '__vazio'
export const COMPARACOES = ['anterior', 'mes_anterior', 'ano_anterior'] as const
export type Comparacao = (typeof COMPARACOES)[number]

export interface DimDef {
  id: DimId
  nome: string
  /** De onde vem o nome mostrado: tabela de cadastro (pelo id), texto fixo ou a própria chave. */
  rotulo: 'filial' | 'vendedor' | 'origem' | 'motivo' | 'situacao' | 'estagio' | 'tempo' | 'chave'
  /** Valores são ids (uuid) de cadastro. */
  uuid?: boolean
}

export const DIMENSOES: DimDef[] = [
  { id: 'ano', nome: 'Ano', rotulo: 'tempo' },
  { id: 'trimestre', nome: 'Trimestre', rotulo: 'tempo' },
  { id: 'mes', nome: 'Mês', rotulo: 'tempo' },
  { id: 'dia', nome: 'Dia', rotulo: 'tempo' },
  { id: 'filial', nome: 'Filial', rotulo: 'filial', uuid: true },
  { id: 'vendedor', nome: 'Vendedor', rotulo: 'vendedor', uuid: true },
  { id: 'origem', nome: 'Origem', rotulo: 'origem', uuid: true },
  { id: 'canal', nome: 'Canal de entrada', rotulo: 'chave' },
  { id: 'campanha', nome: 'Campanha (Google Ads)', rotulo: 'chave' },
  { id: 'uf', nome: 'UF', rotulo: 'chave' },
  { id: 'cidade', nome: 'Cidade', rotulo: 'chave' },
  { id: 'motivo', nome: 'Motivo da perda', rotulo: 'motivo', uuid: true },
  { id: 'situacao', nome: 'Situação da venda', rotulo: 'situacao' },
  { id: 'estagio', nome: 'Estágio do lead', rotulo: 'estagio' },
]
export const DIM_BY_ID = new Map(DIMENSOES.map((d) => [d.id, d]))

/** Hierarquias (drill-down): cada clique desce um nível, com o valor clicado virando filtro. */
export const HIERARQUIAS: Record<string, { nome: string; niveis: DimId[] }> = {
  calendario: { nome: 'Calendário', niveis: ['ano', 'trimestre', 'mes', 'dia'] },
  comercial: { nome: 'Filial e vendedor', niveis: ['filial', 'vendedor'] },
  geografia: { nome: 'UF e cidade', niveis: ['uf', 'cidade'] },
  origem: { nome: 'Canal, origem e campanha', niveis: ['canal', 'origem', 'campanha'] },
}

/** Próximo nível da hierarquia (null no último ou fora dela). */
export function proximoNivel(hierarquia: string, nivel: DimId): DimId | null {
  const h = HIERARQUIAS[hierarquia]
  if (!h) return null
  const i = h.niveis.indexOf(nivel)
  return i >= 0 && i < h.niveis.length - 1 ? h.niveis[i + 1]! : null
}

/** Nível em que o gráfico está: o primeiro da hierarquia que ainda não foi filtrado pelo drill-down. */
export function nivelAtual(hierarquia: string, drill: DimId[]): DimId | null {
  const h = HIERARQUIAS[hierarquia]
  if (!h) return null
  return h.niveis.find((n) => !drill.includes(n)) ?? h.niveis[h.niveis.length - 1]!
}

// ---------- Fontes ----------

const TZ = 'America/Sao_Paulo'
/** Timestamp do banco (UTC, sem fuso) no horário de Brasília. */
const sp = (c: string) => `((${c}) AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}'`
const tempo = (c: string): Record<'ano' | 'trimestre' | 'mes' | 'dia', string> => ({
  ano: `to_char(${sp(c)}, 'YYYY')`,
  trimestre: `to_char(${sp(c)}, 'YYYY-"T"Q')`,
  mes: `to_char(${sp(c)}, 'YYYY-MM')`,
  dia: `to_char(${sp(c)}, 'YYYY-MM-DD')`,
})
const texto = (c: string) => `nullif(btrim(${c}), '')`

export interface RegistroColuna {
  id: string
  nome: string
  sql: string
  tipo: 'texto' | 'datahora' | 'moeda' | 'decimal'
  /** Dado pessoal do cliente: aparece na tela (como nas telas do CRM), mas não vai para a planilha (mesma regra da API de BI). */
  pessoal?: boolean
}

export interface FonteDef {
  id: FonteId
  nome: string
  /** Módulo do CRM que libera a fonte (ver, exportar e o escopo). */
  modulo: ModuleKey
  /** Lida por SQL (as outras são calculadas no código). */
  sql?: {
    tabela: string
    tenant: string
    base: string
    data: string
    /** Colunas do escopo: vendedor (próprios) e unidade (da unidade). */
    vendedor: string
    filial: string
    dims: Partial<Record<DimId, string>>
    /** "Ver registros": FROM com os JOINs dos nomes e as colunas. */
    registros: { from: string; chave: string; colunas: RegistroColuna[] }
  }
  /** Dimensões aceitas pelas fontes calculadas no código. */
  dims?: DimId[]
  /** Onde abrir um registro no CRM. */
  abrir?: 'pre-vendas' | 'lead'
}

const R = 'r'
const ATEND_DATA = `${R}."leadAt"`
const LEAD_DATA = 'l."createdAt"'
const dataHora = (c: string) => `to_char(${sp(c)}, 'YYYY-MM-DD"T"HH24:MI')`

export const FONTES: FonteDef[] = [
  {
    id: 'atendimentos',
    nome: 'Atendimentos (pré-vendas)',
    modulo: 'pre_vendas',
    abrir: 'pre-vendas',
    sql: {
      tabela: 'service_records r',
      tenant: 'r."tenantId"',
      base: `r."deletedAt" IS NULL AND r.kind = 'PRE_VENDAS'`,
      data: ATEND_DATA,
      vendedor: 'r."sellerId"',
      filial: 'r."unitId"',
      dims: {
        ...tempo(ATEND_DATA),
        filial: 'r."unitId"::text',
        vendedor: 'r."sellerId"::text',
        origem: 'r."originId"::text',
        canal: texto('r."entryChannel"'),
        campanha: `CASE WHEN r."adsVia" = 'ANUNCIO' THEN ${texto('r."adsCampaign"')} END`,
        uf: texto('upper(r.state)'),
        cidade: texto('r.city'),
        motivo: 'r."lostReasonId"::text',
        situacao: 'r."saleStatus"::text',
      },
      registros: {
        from: `service_records r LEFT JOIN sellers rs ON rs.id = r."sellerId" LEFT JOIN units ru ON ru.id = r."unitId" LEFT JOIN lookup_items ro ON ro.id = r."originId" LEFT JOIN lookup_items rm ON rm.id = r."lostReasonId"`,
        chave: 'r.id',
        colunas: [
          { id: 'id', nome: 'Atendimento', sql: 'r.id::text', tipo: 'texto' },
          { id: 'data', nome: 'Data do lead', sql: dataHora(ATEND_DATA), tipo: 'datahora' },
          { id: 'cliente', nome: 'Cliente', sql: 'r.name', tipo: 'texto', pessoal: true },
          { id: 'vendedor', nome: 'Vendedor', sql: 'rs.name', tipo: 'texto' },
          { id: 'filial', nome: 'Filial', sql: 'ru.name', tipo: 'texto' },
          { id: 'origem', nome: 'Origem', sql: 'ro.name', tipo: 'texto' },
          { id: 'uf', nome: 'UF', sql: 'r.state', tipo: 'texto' },
          { id: 'cidade', nome: 'Cidade', sql: 'r.city', tipo: 'texto' },
          { id: 'situacao', nome: 'Situação', sql: `CASE r."saleStatus" WHEN 'SIM' THEN 'Vendeu' WHEN 'NAO' THEN 'Perdida' ELSE 'Em negociação' END`, tipo: 'texto' },
          { id: 'valor', nome: 'Valor da venda', sql: `CASE WHEN r."saleStatus" = 'SIM' THEN r."saleValue"::float8 END`, tipo: 'moeda' },
          { id: 'motivo', nome: 'Motivo da perda', sql: 'rm.name', tipo: 'texto' },
          { id: 'campanha', nome: 'Campanha (Google Ads)', sql: `CASE WHEN r."adsVia" = 'ANUNCIO' THEN r."adsCampaign" END`, tipo: 'texto' },
          { id: 'resultado', nome: 'Resultado em', sql: dataHora('r."resultAt"'), tipo: 'datahora' },
        ],
      },
    },
  },
  {
    id: 'leads',
    nome: 'Leads',
    modulo: 'leads',
    abrir: 'lead',
    sql: {
      tabela: 'leads l',
      tenant: 'l."tenantId"',
      base: 'l."deletedAt" IS NULL',
      data: LEAD_DATA,
      vendedor: 'l."ownerId"',
      filial: 'l."unitId"',
      dims: {
        ...tempo(LEAD_DATA),
        filial: 'l."unitId"::text',
        vendedor: 'l."ownerId"::text',
        origem: 'l."originId"::text',
        campanha: texto('l."adsFirstCampaign"'),
        uf: texto('upper(l.state)'),
        cidade: texto('l.city'),
        estagio: 'l.stage::text',
      },
      registros: {
        from: `leads l LEFT JOIN sellers ls ON ls.id = l."ownerId" LEFT JOIN units lu ON lu.id = l."unitId" LEFT JOIN lookup_items lo ON lo.id = l."originId"`,
        chave: 'l.id',
        colunas: [
          { id: 'id', nome: 'Lead', sql: 'l.id::text', tipo: 'texto' },
          { id: 'data', nome: 'Entrou em', sql: dataHora(LEAD_DATA), tipo: 'datahora' },
          { id: 'cliente', nome: 'Nome', sql: 'l.name', tipo: 'texto', pessoal: true },
          { id: 'estagio', nome: 'Estágio', sql: `initcap(lower(l.stage::text))`, tipo: 'texto' },
          { id: 'vendedor', nome: 'Responsável', sql: 'ls.name', tipo: 'texto' },
          { id: 'filial', nome: 'Filial', sql: 'lu.name', tipo: 'texto' },
          { id: 'origem', nome: 'Origem', sql: 'lo.name', tipo: 'texto' },
          { id: 'uf', nome: 'UF', sql: 'l.state', tipo: 'texto' },
          { id: 'cidade', nome: 'Cidade', sql: 'l.city', tipo: 'texto' },
          { id: 'campanha', nome: 'Campanha (Google Ads)', sql: 'l."adsFirstCampaign"', tipo: 'texto' },
        ],
      },
    },
  },
  {
    id: 'whatsapp',
    nome: 'WhatsApp',
    modulo: 'chat',
    // Calculado no código: o número dá a filial e a conversa dá o vendedor.
    dims: ['ano', 'trimestre', 'mes', 'dia', 'filial', 'vendedor'],
  },
]
export const FONTE_BY_ID = new Map(FONTES.map((f) => [f.id, f]))

/** A fonte aceita a dimensão (para agrupar ou filtrar)? */
export function aceita(fonte: FonteDef, dim: DimId): boolean {
  return fonte.sql ? fonte.sql.dims[dim] !== undefined : (fonte.dims ?? []).includes(dim)
}

// ---------- Medidas ----------

export interface MedidaDef {
  id: string
  nome: string
  fonte: FonteId
  formato: Formato
  descricao: string
  /** Agregação SQL (fontes por SQL), já em float8. */
  agregado?: string
  /** Linhas que formam o número (o "ver registros" mostra só estas). */
  condicao?: string
  /** Número menor é melhor (tempo de resposta, perdas): a variação para baixo fica verde. */
  menorMelhor?: boolean
}

const VENDEU = `r."saleStatus" = 'SIM'`
const n = (filtro?: string) => (filtro ? `(count(*) FILTER (WHERE ${filtro}))::float8` : 'count(*)::float8')
const receita = `coalesce(sum(r."saleValue") FILTER (WHERE ${VENDEU}), 0)::float8`

export const MEDIDAS: MedidaDef[] = [
  // Comercial (fato_atendimentos, pela data do lead)
  { id: 'atendimentos', nome: 'Atendimentos', fonte: 'atendimentos', formato: 'inteiro', descricao: 'Pré-vendas que chegaram no período (data do lead).', agregado: n() },
  { id: 'repassados', nome: 'Em negociação com o vendedor', fonte: 'atendimentos', formato: 'inteiro', descricao: 'Pré-vendas repassadas ao vendedor (entraram em negociação).', agregado: n('r.forwarded'), condicao: 'r.forwarded' },
  { id: 'negociacao', nome: 'Ainda em negociação', fonte: 'atendimentos', formato: 'inteiro', descricao: 'Pré-vendas sem resultado (nem venda, nem perda).', agregado: n(`r."saleStatus" = 'NEGOCIACAO'`), condicao: `r."saleStatus" = 'NEGOCIACAO'` },
  { id: 'vendas', nome: 'Vendas', fonte: 'atendimentos', formato: 'inteiro', descricao: 'Pré-vendas que viraram venda (pela data do lead).', agregado: n(VENDEU), condicao: VENDEU },
  { id: 'perdas', nome: 'Perdas', fonte: 'atendimentos', formato: 'inteiro', descricao: 'Pré-vendas perdidas.', agregado: n(`r."saleStatus" = 'NAO'`), condicao: `r."saleStatus" = 'NAO'`, menorMelhor: true },
  { id: 'conversao', nome: 'Taxa de conversão', fonte: 'atendimentos', formato: 'pct', descricao: 'Vendas ÷ pré-vendas.', agregado: `((count(*) FILTER (WHERE ${VENDEU}))::float8 / nullif(count(*), 0))::float8` },
  { id: 'taxa_perda', nome: 'Taxa de perda', fonte: 'atendimentos', formato: 'pct', descricao: 'Perdas ÷ pré-vendas.', agregado: `((count(*) FILTER (WHERE r."saleStatus" = 'NAO'))::float8 / nullif(count(*), 0))::float8`, menorMelhor: true },
  { id: 'receita', nome: 'Receita', fonte: 'atendimentos', formato: 'moeda', descricao: 'Soma do valor das vendas das pré-vendas.', agregado: receita, condicao: VENDEU },
  { id: 'ticket', nome: 'Ticket médio', fonte: 'atendimentos', formato: 'moeda', descricao: 'Receita ÷ vendas.', agregado: `(sum(r."saleValue") FILTER (WHERE ${VENDEU}) / nullif(count(*) FILTER (WHERE ${VENDEU}), 0))::float8`, condicao: VENDEU },
  {
    id: 'repasse_min',
    nome: 'Tempo até o repasse',
    fonte: 'atendimentos',
    formato: 'minutos',
    descricao: 'Mediana dos minutos do contato até o repasse ao vendedor.',
    agregado: `(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from (r."forwardedAt" - r."leadAt")) / 60.0))::float8`,
    condicao: 'r."forwardedAt" IS NOT NULL',
    menorMelhor: true,
  },
  { id: 'google_ads', nome: 'Pré-vendas do Google Ads', fonte: 'atendimentos', formato: 'inteiro', descricao: 'Pré-vendas de quem clicou num anúncio do Google antes do contato.', agregado: n(`r."adsVia" = 'ANUNCIO'`), condicao: `r."adsVia" = 'ANUNCIO'` },
  // Leads (fato_leads, pela data em que entrou na base)
  { id: 'leads', nome: 'Leads', fonte: 'leads', formato: 'inteiro', descricao: 'Leads que entraram na base no período.', agregado: 'count(*)::float8' },
  { id: 'leads_clientes', nome: 'Leads que viraram clientes', fonte: 'leads', formato: 'inteiro', descricao: 'Leads do período no estágio Cliente.', agregado: `(count(*) FILTER (WHERE l.stage = 'CLIENTE'))::float8`, condicao: `l.stage = 'CLIENTE'` },
  { id: 'pct_clientes', nome: '% leads que viraram clientes', fonte: 'leads', formato: 'pct', descricao: 'Leads clientes ÷ leads.', agregado: `((count(*) FILTER (WHERE l.stage = 'CLIENTE'))::float8 / nullif(count(*), 0))::float8` },
  // WhatsApp (mesma regra do painel do WhatsApp; calculado no código)
  { id: 'wa_atendimentos', nome: 'Atendimentos WhatsApp', fonte: 'whatsapp', formato: 'inteiro', descricao: 'Atendimentos do WhatsApp que começaram no período (grupos ficam de fora).' },
  { id: 'wa_recebidos', nome: 'Atendimentos recebidos', fonte: 'whatsapp', formato: 'inteiro', descricao: 'Atendimentos do WhatsApp iniciados pelo cliente.' },
  { id: 'wa_primeira_resposta', nome: '1ª resposta no WhatsApp', fonte: 'whatsapp', formato: 'minutos', descricao: 'Mediana dos minutos até a primeira resposta, no horário comercial das regras do WhatsApp.', menorMelhor: true },
  { id: 'wa_pct_15', nome: '% respondidos em 15 min', fonte: 'whatsapp', formato: 'pct', descricao: 'Primeiras respostas em até 15 minutos (horário comercial) ÷ primeiras respostas.' },
  { id: 'wa_sem_resposta', nome: 'Sem resposta', fonte: 'whatsapp', formato: 'inteiro', descricao: 'Vezes do cliente que abriram o atendimento e não tiveram resposta.', menorMelhor: true },
]
export const MEDIDA_BY_ID = new Map(MEDIDAS.map((m) => [m.id, m]))

// ---------- Páginas ----------

export interface PaginaDef {
  id: string
  nome: string
  descricao: string
  /** Fontes que a página usa (cada quadro só aparece com a permissão da sua fonte). */
  fontes: FonteId[]
  /** Precisa de todas estas fontes; sem a lista, basta uma das fontes. */
  exige?: FonteId[]
}

export const PAGINAS: PaginaDef[] = [
  { id: 'visao-geral', nome: 'Visão geral', descricao: 'Leads, atendimentos, vendas, receita, conversão, ticket e WhatsApp.', fontes: ['atendimentos', 'leads', 'whatsapp'] },
  { id: 'comercial', nome: 'Comercial', descricao: 'Funil, conversão por filial e vendedor, perdas, origens e regiões.', fontes: ['atendimentos', 'leads'], exige: ['atendimentos'] },
]

// ---------- Permissões ----------

export interface Perms {
  isSystem: boolean
  permissions: Record<string, { view?: boolean; export?: boolean; scope?: Scope } | undefined>
}

export function podeFonte(p: Perms, fonte: FonteId, acao: 'view' | 'export' = 'view'): boolean {
  if (p.isSystem) return true
  const mod = FONTE_BY_ID.get(fonte)!.modulo
  return p.permissions[mod]?.[acao] === true
}

export function escopoFonte(p: Perms, fonte: FonteId): Scope {
  if (p.isSystem) return 'ALL'
  return p.permissions[FONTE_BY_ID.get(fonte)!.modulo]?.scope ?? 'ALL'
}

export function paginasPermitidas(p: Perms): PaginaDef[] {
  return PAGINAS.filter((pg) => (pg.exige ? pg.exige.every((f) => podeFonte(p, f)) : pg.fontes.some((f) => podeFonte(p, f))))
}

// ---------- Período e comparação ----------

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000
export const MAX_DIAS = 1100

function utc(d: string) {
  return Date.parse(`${d}T00:00:00Z`)
}
function iso(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}
export function diaValido(d: unknown): d is string {
  return typeof d === 'string' && DIA_RE.test(d) && iso(utc(d)) === d
}

/** Confere o período (datas reais, início antes do fim, no máximo ~3 anos). */
export function validarPeriodo(de: unknown, ate: unknown): { de: string; ate: string } | { erro: string } {
  if (!diaValido(de) || !diaValido(ate)) return { erro: 'Período inválido: use datas AAAA-MM-DD.' }
  if (de > ate) return { erro: 'A data inicial precisa ser antes da final.' }
  if ((utc(ate) - utc(de)) / DAY + 1 > MAX_DIAS) return { erro: 'Escolha um período de até 3 anos.' }
  return { de, ate }
}

/** Instantes do período no horário de Brasília (fim exclusivo, dia seguinte à data final). */
export function limites(de: string, ate: string) {
  return { inicio: new Date(`${de}T00:00:00-03:00`), fim: new Date(Date.parse(`${ate}T00:00:00-03:00`) + DAY) }
}

const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/** Soma meses a uma data; o último dia do mês continua no último dia (31/03 − 1 mês = 28/02). */
export function somarMeses(d: string, meses: number): string {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number]
  const alvo = new Date(Date.UTC(y, m - 1 + meses, 1))
  const ty = alvo.getUTCFullYear()
  const tm = alvo.getUTCMonth()
  const fim = dd === ultimoDia(y, m - 1) ? ultimoDia(ty, tm) : Math.min(dd, ultimoDia(ty, tm))
  return iso(Date.UTC(ty, tm, fim))
}

/** Janela de comparação: período anterior do mesmo tamanho, mesmo período do mês anterior ou do ano anterior. */
export function janelaComparacao(de: string, ate: string, tipo: Comparacao): { de: string; ate: string } {
  if (tipo === 'mes_anterior') return { de: somarMeses(de, -1), ate: somarMeses(ate, -1) }
  if (tipo === 'ano_anterior') return { de: somarMeses(de, -12), ate: somarMeses(ate, -12) }
  const dias = (utc(ate) - utc(de)) / DAY + 1
  const fim = utc(de) - DAY
  return { de: iso(fim - (dias - 1) * DAY), ate: iso(fim) }
}

/** Variação: % sobre o anterior (contagens e valores) e a diferença (nas taxas, em pontos percentuais). */
export function variacao(atual: number | null, anterior: number | null): { variacao: number | null; diferenca: number | null } {
  if (atual === null || anterior === null) return { variacao: null, diferenca: null }
  return { variacao: anterior !== 0 ? Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10 : null, diferenca: atual - anterior }
}

// ---------- Chaves e nomes de tempo ----------

/** Chave de tempo de um dia (AAAA-MM-DD), igual à do SQL (to_char). */
export function chaveTempo(dim: DimId, dia: string): string {
  if (dim === 'ano') return dia.slice(0, 4)
  if (dim === 'trimestre') return `${dia.slice(0, 4)}-T${Math.floor((Number(dia.slice(5, 7)) - 1) / 3) + 1}`
  if (dim === 'mes') return dia.slice(0, 7)
  return dia
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function rotuloTempo(dim: DimId, chave: string): string {
  if (dim === 'trimestre' && /^\d{4}-T[1-4]$/.test(chave)) return `${chave.slice(6)}º tri/${chave.slice(0, 4)}`
  if (dim === 'mes' && /^\d{4}-\d{2}$/.test(chave)) return `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(0, 4)}`
  if (dim === 'dia' && DIA_RE.test(chave)) return `${chave.slice(8, 10)}/${chave.slice(5, 7)}/${chave.slice(0, 4)}`
  return chave
}

const SITUACAO: Record<string, string> = { SIM: 'Vendeu', NAO: 'Perdida', NEGOCIACAO: 'Em negociação' }
const ESTAGIO: Record<string, string> = { LEAD: 'Lead', QUALIFICADO: 'Qualificado', OPORTUNIDADE: 'Oportunidade', CLIENTE: 'Cliente' }
const SEM: Partial<Record<DimId, string>> = { filial: 'Sem filial', vendedor: 'Sem vendedor', origem: 'Sem origem', canal: 'Sem canal', campanha: 'Sem campanha', uf: 'Sem UF', cidade: 'Sem cidade', motivo: 'Sem motivo' }

/** Nome mostrado de uma chave (os de cadastro vêm do mapa carregado do banco). */
export function rotulo(dim: DimId, chave: string, nomes?: Map<string, string>): string {
  if (chave === VAZIO) return SEM[dim] ?? '(não informado)'
  const d = DIM_BY_ID.get(dim)!
  if (d.rotulo === 'tempo') return rotuloTempo(dim, chave)
  if (d.rotulo === 'situacao') return SITUACAO[chave] ?? chave
  if (d.rotulo === 'estagio') return ESTAGIO[chave] ?? chave
  if (d.rotulo === 'chave') return chave
  return nomes?.get(chave) ?? 'Removido'
}

// ---------- Pedido (o que vem da tela) ----------

export type Filtros = Partial<Record<DimId, string[]>>
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_VALORES = 30

/** Filtros em JSON ({"filial":["id"],"uf":["PR"]}): só dimensões conhecidas, valores curtos, ids válidos. */
export function lerFiltros(raw: unknown): { filtros: Filtros } | { erro: string } {
  if (raw === undefined || raw === null || raw === '') return { filtros: {} }
  let obj: unknown
  try {
    obj = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { erro: 'Filtros inválidos.' }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { erro: 'Filtros inválidos.' }
  const out: Filtros = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const dim = DIM_BY_ID.get(k as DimId)
    if (!dim) return { erro: `Filtro desconhecido: ${k.slice(0, 40)}.` }
    const lista = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    if (lista.length > MAX_VALORES) return { erro: `Escolha no máximo ${MAX_VALORES} valores em ${dim.nome}.` }
    for (const x of lista) {
      if (x.length > 200) return { erro: `Valor grande demais em ${dim.nome}.` }
      if (dim.uuid && x !== VAZIO && !UUID_RE.test(x)) return { erro: `Valor inválido em ${dim.nome}.` }
    }
    if (lista.length) out[dim.id] = [...new Set(lista)]
  }
  return { filtros: out }
}

/** Lista separada por vírgula, só com itens da lista permitida, sem repetir. */
export function lerLista<T extends string>(raw: unknown, permitidos: ReadonlySet<string>, max: number): { itens: T[] } | { erro: string } {
  const itens = typeof raw === 'string' && raw.trim() ? [...new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))] : []
  if (itens.length > max) return { erro: `No máximo ${max} itens.` }
  const ruim = itens.find((x) => !permitidos.has(x))
  if (ruim) return { erro: `Item desconhecido: ${ruim.slice(0, 40)}.` }
  return { itens: itens as T[] }
}

// ---------- SQL ----------

export type Escopo = { tipo: 'ALL' } | { tipo: 'OWN'; userId: string } | { tipo: 'UNIT'; unitId: string | null }

export function escopoDe(scope: Scope, user: { id: string; unitId: string | null }): Escopo {
  if (scope === 'OWN') return { tipo: 'OWN', userId: user.id }
  if (scope === 'UNIT') return { tipo: 'UNIT', unitId: user.unitId }
  return { tipo: 'ALL' }
}

/** Fontes lidas por SQL. */
type FonteSql = NonNullable<FonteDef['sql']>

/**
 * WHERE de uma fonte: empresa, período (pela data principal), escopo do usuário (mesma regra das telas: próprios =
 * vendedor ligado ao login; unidade = unidade do usuário, sem unidade não vê nada), filtros e a condição da medida.
 */
export function whereSql(f: FonteSql, o: { tenantId: string; inicio: Date; fim: Date; escopo: Escopo; filtros: Filtros; condicao?: string }): Prisma.Sql {
  const partes: Prisma.Sql[] = [
    Prisma.sql`${Prisma.raw(f.tenant)} = ${o.tenantId}::uuid`,
    Prisma.raw(f.base),
    Prisma.sql`${Prisma.raw(f.data)} >= ${o.inicio} AND ${Prisma.raw(f.data)} < ${o.fim}`,
  ]
  if (o.escopo.tipo === 'OWN') partes.push(Prisma.sql`${Prisma.raw(f.vendedor)} IN (SELECT sx.id FROM sellers sx WHERE sx."tenantId" = ${o.tenantId}::uuid AND sx."userId" = ${o.escopo.userId}::uuid)`)
  if (o.escopo.tipo === 'UNIT') partes.push(o.escopo.unitId ? Prisma.sql`${Prisma.raw(f.filial)} = ${o.escopo.unitId}::uuid` : Prisma.raw('FALSE'))
  for (const [dim, valores] of Object.entries(o.filtros) as [DimId, string[]][]) {
    const expr = f.dims[dim]
    if (!expr) throw new Error(`dimensão ${dim} fora da fonte`)
    const cheios = valores.filter((v) => v !== VAZIO)
    const vazio = valores.includes(VAZIO)
    const conds: Prisma.Sql[] = []
    if (cheios.length) conds.push(Prisma.sql`(${Prisma.raw(expr)}) = ANY(${cheios}::text[])`)
    if (vazio) conds.push(Prisma.sql`(${Prisma.raw(expr)}) IS NULL`)
    partes.push(Prisma.sql`(${Prisma.join(conds, ' OR ')})`)
  }
  if (o.condicao) partes.push(Prisma.raw(`(${o.condicao})`))
  return Prisma.join(partes, ' AND ')
}

/** SELECT agregado: chaves das dimensões (k0, k1...) e uma coluna por medida, agrupado e ordenado. */
export function consultaSql(f: FonteSql, medidas: MedidaDef[], dims: DimId[], where: Prisma.Sql, limite: number): Prisma.Sql {
  const cols: string[] = dims.map((d, i) => `(${f.dims[d]!}) AS k${i}`)
  for (const m of medidas) {
    if (!m.agregado || !/^[a-z0-9_]+$/.test(m.id)) throw new Error(`medida ${m.id} sem SQL`)
    cols.push(`${m.agregado} AS "${m.id}"`)
  }
  const grupo = dims.length ? ` GROUP BY ${dims.map((_, i) => i + 1).join(', ')}` : ''
  const tempo = dims.length > 0 && TEMPO.includes(dims[0]!)
  const ordem = !dims.length ? '' : tempo || !medidas.length ? ` ORDER BY ${dims.map((_, i) => `${i + 1} ASC NULLS LAST`).join(', ')}` : ` ORDER BY ${dims.length + 1} DESC NULLS LAST, 1 ASC`
  return Prisma.sql`SELECT ${Prisma.raw(cols.join(', '))} FROM ${Prisma.raw(f.tabela)} WHERE ${where}${Prisma.raw(grupo + ordem)} LIMIT ${limite}`
}

/** Registros por trás de um número (paginados, mais novos primeiro). */
export function registrosSql(f: FonteSql, where: Prisma.Sql, limite: number, offset: number): Prisma.Sql {
  const cols = f.registros.colunas.map((c) => `${c.sql} AS "${c.id}"`).join(', ')
  return Prisma.sql`SELECT ${Prisma.raw(cols)} FROM ${Prisma.raw(f.registros.from)} WHERE ${where} ORDER BY ${Prisma.raw(f.data)} DESC, ${Prisma.raw(f.registros.chave)} DESC LIMIT ${limite} OFFSET ${offset}`
}

export function contagemSql(f: FonteSql, where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`SELECT count(*)::int AS total FROM ${Prisma.raw(f.tabela)} WHERE ${where}`
}

// ---------- Linhas ----------

/** Chave da linha no resultado (várias dimensões): junta as chaves. */
export const chaveLinha = (chaves: string[]) => chaves.join('\u0001')

export interface Linha {
  chaves: string[]
  valores: Record<string, number | null>
}

/** Junta as linhas de várias fontes pela chave das dimensões (ex.: leads e vendas por mês). */
export function juntar(partes: Linha[][], medidas: string[]): Linha[] {
  const map = new Map<string, Linha>()
  for (const linhas of partes) {
    for (const l of linhas) {
      const k = chaveLinha(l.chaves)
      const atual = map.get(k) ?? { chaves: l.chaves, valores: Object.fromEntries(medidas.map((m) => [m, null])) }
      Object.assign(atual.valores, Object.fromEntries(Object.entries(l.valores).filter(([, v]) => v !== undefined)))
      map.set(k, atual)
    }
  }
  return [...map.values()]
}

/** Ordem final: tempo em ordem de data; os outros pela primeira medida (maior primeiro). */
export function ordenar(linhas: Linha[], dims: DimId[], medida: string | undefined): Linha[] {
  if (!dims.length) return linhas
  if (TEMPO.includes(dims[0]!) || !medida) return [...linhas].sort((a, b) => a.chaves.join('|').localeCompare(b.chaves.join('|')))
  return [...linhas].sort((a, b) => (b.valores[medida] ?? -Infinity) - (a.valores[medida] ?? -Infinity) || a.chaves.join('|').localeCompare(b.chaves.join('|')))
}

/**
 * Todas as chaves de tempo do período (respeitando os filtros de tempo do drill-down), para o gráfico não pular os
 * meses ou dias sem nenhum registro.
 */
export function chavesDoPeriodo(dim: DimId, de: string, ate: string, filtros: Filtros = {}, max = 1200): string[] {
  if (!TEMPO.includes(dim)) return []
  const out: string[] = []
  for (let t = utc(de); t <= utc(ate) && out.length < max; t += DAY) {
    const dia = iso(t)
    if (TEMPO.some((f) => filtros[f]?.length && !filtros[f]!.includes(chaveTempo(f, dia)))) continue
    const k = chaveTempo(dim, dia)
    if (out[out.length - 1] !== k) out.push(k)
  }
  return out
}

// ---------- Planilha ----------

/** CSV com ";" e BOM (abre certo no Excel em português); texto que parece fórmula ganha apóstrofo. */
export function csv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v
    const safe = typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
}
