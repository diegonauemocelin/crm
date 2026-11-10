/**
 * Análises (BI nativo): regras da tela sem React (testadas em apps/api/test/analises.spec.ts). Filtros no endereço
 * (link interno compartilhável), períodos prontos, drill-down nas hierarquias e os formatos dos números.
 */

export const DIMS = ['ano', 'trimestre', 'mes', 'dia', 'filial', 'vendedor', 'origem', 'canal', 'campanha', 'uf', 'cidade', 'motivo', 'situacao', 'estagio'] as const
export type Dim = (typeof DIMS)[number]
export type Formato = 'inteiro' | 'moeda' | 'pct' | 'decimal' | 'minutos'
export type Comparacao = 'anterior' | 'mes_anterior' | 'ano_anterior'
export type Filtros = Partial<Record<Dim, string[]>>
export const VAZIO = '__vazio'
/** Separador dos valores de um filtro no endereço (filial=a|b). */
const SEP = '|'

export const COMPARACOES: { id: Comparacao; nome: string }[] = [
  { id: 'anterior', nome: 'Período anterior' },
  { id: 'mes_anterior', nome: 'Mês anterior' },
  { id: 'ano_anterior', nome: 'Ano anterior' },
]

// ---------- Períodos ----------

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`)
const addDias = (d: string, n: number) => iso(utc(d) + n * DAY)
const fimDoMes = (y: number, m: number) => iso(Date.UTC(y, m + 1, 0))

export const PERIODOS = [
  { id: '7', nome: '7 dias' },
  { id: '30', nome: '30 dias' },
  { id: 'mes', nome: 'Este mês' },
  { id: 'mes_passado', nome: 'Mês passado' },
  { id: '90', nome: '90 dias' },
  { id: 'ano', nome: 'Este ano' },
  { id: '12m', nome: '12 meses' },
] as const
export type PeriodoId = (typeof PERIODOS)[number]['id']

/** Datas de um período pronto, contado a partir de hoje (dia de Brasília). */
export function datasDoPeriodo(id: string, hoje: string): { de: string; ate: string } | null {
  const y = Number(hoje.slice(0, 4))
  const m = Number(hoje.slice(5, 7)) - 1
  switch (id) {
    case '7':
      return { de: addDias(hoje, -6), ate: hoje }
    case '30':
      return { de: addDias(hoje, -29), ate: hoje }
    case '90':
      return { de: addDias(hoje, -89), ate: hoje }
    case 'mes':
      return { de: `${hoje.slice(0, 8)}01`, ate: hoje }
    case 'mes_passado':
      return { de: iso(Date.UTC(y, m - 1, 1)), ate: fimDoMes(y, m - 1) }
    case 'ano':
      return { de: `${y}-01-01`, ate: hoje }
    case '12m':
      return { de: iso(Date.UTC(y, m - 11, 1)), ate: hoje }
    default:
      return null
  }
}

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/
const valido = (d: string | null): d is string => !!d && DIA_RE.test(d) && iso(utc(d)) === d

/** Período da tela: o pronto (periodo=30) ou as datas (de/ate); sem nada, os últimos 30 dias. */
export function periodoDaUrl(params: URLSearchParams, hoje: string): { de: string; ate: string; periodo: string | null } {
  const p = params.get('periodo')
  const pronto = p ? datasDoPeriodo(p, hoje) : null
  if (pronto) return { ...pronto, periodo: p }
  const de = params.get('de')
  const ate = params.get('ate')
  if (valido(de) && valido(ate) && de <= ate) return { de, ate, periodo: null }
  return { ...datasDoPeriodo('30', hoje)!, periodo: '30' }
}

// ---------- Filtros no endereço ----------

export function filtrosDaUrl(params: URLSearchParams): Filtros {
  const out: Filtros = {}
  for (const d of DIMS) {
    const v = params.get(d)
    if (!v) continue
    const lista = [...new Set(v.split(SEP).map((x) => x.trim()).filter(Boolean))].slice(0, 30)
    if (lista.length) out[d] = lista
  }
  return out
}

/** Muda um filtro (lista vazia ou null tira) e devolve o novo endereço. */
export function comFiltro(params: URLSearchParams, dim: Dim, valores: string[] | null): URLSearchParams {
  const next = new URLSearchParams(params)
  if (valores && valores.length) next.set(dim, valores.join(SEP))
  else next.delete(dim)
  return next
}

/** Junta filtros (os do drill-down de um quadro valem só nele, por cima dos da página). */
export function juntarFiltros(...partes: Filtros[]): Filtros {
  const out: Filtros = {}
  for (const p of partes) for (const [k, v] of Object.entries(p) as [Dim, string[]][]) if (v?.length) out[k] = v
  return out
}

/** Filtros para a API (JSON), em ordem estável (a mesma consulta usa o mesmo cache). */
export function filtrosParaApi(f: Filtros): string {
  const chaves = (Object.keys(f) as Dim[]).filter((k) => f[k]?.length).sort()
  return chaves.length ? JSON.stringify(Object.fromEntries(chaves.map((k) => [k, [...f[k]!].sort()]))) : ''
}

// ---------- Drill-down ----------

export interface PassoDrill {
  dim: Dim
  chave: string
  rotulo: string
}

/** Nível atual de um quadro com hierarquia: o primeiro ainda não aberto (ou já filtrado na página). */
export function nivelDoDrill(niveis: Dim[], drill: PassoDrill[], filtrosPagina: Filtros = {}): Dim {
  const usados = new Set(drill.map((p) => p.dim))
  // Nível filtrado na página com um valor só já está "aberto": o quadro mostra o de baixo.
  for (const n of niveis) {
    if (usados.has(n)) continue
    if (filtrosPagina[n]?.length === 1 && n !== niveis[niveis.length - 1]) continue
    return n
  }
  return niveis[niveis.length - 1]!
}

export function podeDescer(niveis: Dim[], nivel: Dim): Dim | null {
  const i = niveis.indexOf(nivel)
  return i >= 0 && i < niveis.length - 1 ? niveis[i + 1]! : null
}

/** Desce um nível com o valor clicado. */
export function descer(drill: PassoDrill[], passo: PassoDrill): PassoDrill[] {
  return [...drill.filter((p) => p.dim !== passo.dim), passo]
}

/** Volta ao ponto i do caminho (−1 = topo). */
export function subir(drill: PassoDrill[], i: number): PassoDrill[] {
  return drill.slice(0, Math.max(0, i + 1))
}

export function filtrosDoDrill(drill: PassoDrill[]): Filtros {
  return Object.fromEntries(drill.map((p) => [p.dim, [p.chave]]))
}

// ---------- Nomes ----------

export const NOME_DIM: Record<Dim, string> = {
  ano: 'Ano',
  trimestre: 'Trimestre',
  mes: 'Mês',
  dia: 'Dia',
  filial: 'Filial',
  vendedor: 'Vendedor',
  origem: 'Origem',
  canal: 'Canal',
  campanha: 'Campanha',
  uf: 'UF',
  cidade: 'Cidade',
  motivo: 'Motivo da perda',
  situacao: 'Situação',
  estagio: 'Estágio',
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const SITUACAO: Record<string, string> = { SIM: 'Vendeu', NAO: 'Perdida', NEGOCIACAO: 'Em negociação' }
const ESTAGIO: Record<string, string> = { LEAD: 'Lead', QUALIFICADO: 'Qualificado', OPORTUNIDADE: 'Oportunidade', CLIENTE: 'Cliente' }

/** Nome de um valor de filtro (os de cadastro vêm de `nomes`, carregados das opções). Mesma regra da API. */
export function rotuloChave(dim: Dim, chave: string, nomes?: Map<string, string>): string {
  if (chave === VAZIO) return `Sem ${NOME_DIM[dim].toLowerCase()}`
  if (dim === 'trimestre' && /^\d{4}-T[1-4]$/.test(chave)) return `${chave.slice(6)}º tri/${chave.slice(0, 4)}`
  if (dim === 'mes' && /^\d{4}-\d{2}$/.test(chave)) return `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(0, 4)}`
  if (dim === 'dia' && DIA_RE.test(chave)) return `${chave.slice(8, 10)}/${chave.slice(5, 7)}/${chave.slice(0, 4)}`
  if (dim === 'situacao') return SITUACAO[chave] ?? chave
  if (dim === 'estagio') return ESTAGIO[chave] ?? chave
  return nomes?.get(chave) ?? chave
}

/** Nível inicial do gráfico de tempo pelo tamanho do período (até 2 meses: dias; até 2 anos: meses; mais: anos). */
export function nivelInicialTempo(de: string, ate: string): Dim {
  const dias = (utc(ate) - utc(de)) / DAY + 1
  if (dias <= 62) return 'dia'
  if (dias <= 731) return 'mes'
  return 'ano'
}

// ---------- Formatos ----------

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCurto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

export function minutos(v: number): string {
  if (v < 60) return `${decimal.format(v)} min`
  if (v < 48 * 60) return `${decimal.format(v / 60)} h`
  return `${decimal.format(v / 1440)} dias`
}

/** Número no formato da medida (taxas vêm como fração: 0,25 = 25%). */
export function formatar(formato: Formato, v: number | null | undefined, curto = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (formato === 'moeda') return curto && Math.abs(v) >= 10_000 ? brlCurto.format(v) : brl.format(v)
  if (formato === 'pct') return `${decimal.format(v * 100)}%`
  if (formato === 'minutos') return minutos(v)
  if (formato === 'decimal') return decimal.format(v)
  return inteiro.format(v)
}

/** Variação para o cartão: % nas contagens e valores; pontos percentuais nas taxas. */
export function textoVariacao(formato: Formato, c: { variacao: number | null; diferenca: number | null } | undefined): { valor: number | null; texto: string } {
  if (!c) return { valor: null, texto: '' }
  if (formato === 'pct') {
    if (c.diferenca === null) return { valor: null, texto: 'sem base de comparação' }
    const pp = Math.round(c.diferenca * 1000) / 10
    return { valor: pp, texto: `${pp > 0 ? '+' : ''}${decimal.format(pp)} p.p.` }
  }
  if (c.variacao === null) return { valor: null, texto: 'sem base de comparação' }
  return { valor: c.variacao, texto: `${c.variacao > 0 ? '+' : ''}${decimal.format(c.variacao)}%` }
}
