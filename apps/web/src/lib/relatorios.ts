import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { brl, brlCompact, int, pctFmt, todaySP } from './atendimento'

export type Format = 'int' | 'brl' | 'pct' | 'num'
export type Chart = 'tabela' | 'barras' | 'colunas' | 'linha' | 'numero'
export type Preset = 'hoje' | 'ontem' | '7' | '30' | '90' | 'mes' | 'mes_anterior' | 'ano' | '12m' | 'personalizado'

export interface DimensionInfo {
  key: string
  label: string
  labels: Record<string, string> | null
  time: boolean
  list: boolean
}
export interface MetricInfo {
  key: string
  label: string
  format: Format
}
export interface SourceInfo {
  key: string
  label: string
  description: string
  dateLabel: string
  available: boolean
  dimensions: DimensionInfo[]
  metrics: MetricInfo[]
}
export interface Catalog {
  scope: 'OWN' | 'UNIT' | 'ALL'
  sources: SourceInfo[]
}

export interface Filter {
  field: string
  op: 'igual' | 'diferente'
  values: (string | null)[]
}
export interface ReportConfig {
  source: string
  dimensions: string[]
  metrics: string[]
  filters: Filter[]
  period: { preset: Preset; from?: string; to?: string }
  chart: Chart
  limit: number
  compare: boolean
}

export interface Period {
  from: string
  to: string
  days: number
  previous: { from: string; to: string }
}
export interface ReportResult {
  config: ReportConfig
  period: Period
  dimensions: DimensionInfo[]
  metrics: MetricInfo[]
  rows: { dims: (string | null)[]; values: (number | null)[] }[]
  totals: (number | null)[]
  previousTotals: (number | null)[] | null
}

export interface SavedReport {
  id: string
  name: string
  description: string | null
  config: ReportConfig
  visibility: 'privado' | 'equipe'
  pinned: boolean
  position: number
  width: 1 | 2
  createdById: string | null
  createdByName: string | null
  mine: boolean
  updatedAt: string
}

export const PRESET_LABEL: Record<Preset, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7': 'Últimos 7 dias',
  '30': 'Últimos 30 dias',
  '90': 'Últimos 90 dias',
  mes: 'Este mês',
  mes_anterior: 'Mês passado',
  ano: 'Este ano',
  '12m': 'Últimos 12 meses',
  personalizado: 'Personalizado',
}

export const CHART_LABEL: Record<Chart, string> = {
  tabela: 'Tabela',
  barras: 'Barras',
  colunas: 'Colunas',
  linha: 'Linha',
  numero: 'Número',
}

export const fmtDate = (iso: string) => iso.split('-').reverse().join('/')

/** Período em texto (um dia ou 'de a até'). */
export function periodText(p: { from: string; to: string }) {
  return p.from === p.to ? fmtDate(p.from) : `${fmtDate(p.from)} a ${fmtDate(p.to)}`
}
const numFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

export function formatValue(v: number | null | undefined, format: Format, compact = false) {
  if (v === null || v === undefined) return '—'
  if (format === 'brl') return compact ? brlCompact.format(v) : brl.format(v)
  if (format === 'pct') return pctFmt.format(v)
  if (format === 'num') return numFmt.format(v)
  return int.format(Math.round(v))
}

/** Nome exibido de um valor agrupado (rótulo da lista, data em formato brasileiro, ou "Não informado"). */
export function dimLabel(d: DimensionInfo | undefined, v: string | null) {
  if (v === null || v === '') return 'Não informado'
  if (d?.labels?.[v]) return d.labels[v]
  if (d?.time) {
    if (d.key === 'mes') return `${v.slice(5, 7)}/${v.slice(0, 4)}`
    if (d.key === 'semana') return `Sem. ${fmtDate(v)}`
    return fmtDate(v)
  }
  return v
}

export function useCatalog() {
  return useQuery({ queryKey: ['relatorios-catalogo'], queryFn: () => api.get<Catalog>('/relatorios/catalogo'), staleTime: 10 * 60_000 })
}

export function newConfig(source: SourceInfo): ReportConfig {
  const time = source.dimensions.find((d) => d.key === 'dia')
  return { source: source.key, dimensions: time ? [time.key] : [], metrics: [source.metrics[0]!.key], filters: [], period: { preset: '30' }, chart: time ? 'linha' : 'tabela', limit: 20, compare: true }
}

export const RANGE_PRESETS = [
  { id: '7', label: '7 dias', range: () => [todaySP(-6), todaySP()] },
  { id: '30', label: '30 dias', range: () => [todaySP(-29), todaySP()] },
  { id: '90', label: '90 dias', range: () => [todaySP(-89), todaySP()] },
  { id: 'mes', label: 'Este mês', range: () => [`${todaySP().slice(0, 8)}01`, todaySP()] },
  { id: 'ano', label: 'Este ano', range: () => [`${todaySP().slice(0, 4)}-01-01`, todaySP()] },
] as const

/** Baixa o CSV do relatório (a API devolve o arquivo; o navegador salva). */
export async function downloadReport(config: ReportConfig, name: string) {
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('crm_csrf='))?.split('=')[1] ?? ''
  const res = await fetch('/api/relatorios/exportar', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ config }),
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Falha ao exportar.')
  const url = URL.createObjectURL(await res.blob())
  const safe = name.normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'relatorio'
  Object.assign(document.createElement('a'), { href: url, download: `${safe}-${todaySP()}.csv` }).click()
  URL.revokeObjectURL(url)
}
