/** Marketing Inteligente: tipos das respostas da API, filtros na URL, formatação e exportação. */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { api } from './api'
import { brl, int, pctFmt, todaySP } from './atendimento'

export const MKT_BASE = '/marketing-inteligente'

export type Unit = 'brl' | 'int' | 'pct' | 'x'

export interface Kpi {
  id: string
  label: string
  unit: Unit
  better: 'up' | 'down' | 'neutro'
  value: number | null
  previous: number | null
  variation: number | null
  trend: 'alta' | 'queda' | 'estavel' | null
  series: (number | null)[]
  formula?: string | null
  reason?: string | null
}

export interface Meta {
  period: { from: string; to: string; days: number }
  previousPeriod: { from: string; to: string }
  granularity: string
  filters: Record<string, string>
  attribution: { model: string; modelLabel: string; windowDays: number; qualifiedRule: string }
  costFollowsFilters: boolean
  storeIncluded: boolean
  scopeAll: boolean
  updatedAt: { googleAdsCost: string | null; generatedAt: string }
  notes: string[]
}

export interface BreakdownRow {
  key: string
  label: string
  channel?: string
  leads: number
  qualified: number
  attended: number
  opportunities: number
  sales: number
  revenue: number
  cost: number | null
  impressions: number | null
  clicks: number | null
  platformConversions: number | null
  cpl: number | null
  roas: number | null
  conversion: number | null
  ticket: number | null
  ctr: number | null
  cpc: number | null
}

export interface Timing {
  avgHours: number | null
  medianHours: number | null
  n: number
  missing: number
}

export interface FunnelStage {
  id: string
  label: string
  value: number
  passRate: number | null
  costPer: number | null
}

export interface Attention {
  level: 'alta' | 'media' | 'info'
  title: string
  evidence: string
  action: string
}

export interface Source {
  id: string
  name: string
  status: 'ok' | 'atrasado' | 'nunca' | 'atencao' | 'sem_dados' | 'desligado' | 'pendente'
  lastSync: string | null
  detail: string
}

export interface Options {
  channels: { id: string; name: string; paid: boolean }[]
  sellers: { id: string; name: string; active: boolean }[]
  units: { id: string; name: string; active: boolean }[]
  brands: { id: string; name: string; active: boolean }[]
  partTypes: { id: string; name: string; active: boolean }[]
  origins: { id: string; name: string; active: boolean }[]
  customerTypes: { id: string; name: string; active: boolean }[]
}

/** Parâmetros da URL que são filtros (os mesmos nomes da API). */
export const FILTER_KEYS = ['de', 'ate', 'agrupar', 'canal', 'campanha', 'marca', 'peca', 'uf', 'regiao', 'filial', 'vendedor', 'origem', 'tipoCliente', 'status', 'cliente'] as const

/** Filtros da tela atual, guardados na URL: a visão pode ser salva nos favoritos e compartilhada. */
export function useMktFilters() {
  const [params, setParams] = useSearchParams()
  const query = new URLSearchParams()
  for (const k of FILTER_KEYS) {
    const v = params.get(k)
    if (v) query.set(k, v)
  }
  if (!query.get('de')) query.set('de', todaySP(-29))
  if (!query.get('ate')) query.set('ate', todaySP())
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }
  return { params, query, qs: query.toString(), set }
}

export function useMkt<T>(path: string, qs: string, enabled = true) {
  return useQuery({
    queryKey: ['marketing', path, qs],
    queryFn: () => api.get<T>(`/marketing/${path}${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useMktOptions() {
  return useQuery({ queryKey: ['marketing', 'opcoes'], queryFn: () => api.get<Options>('/marketing/opcoes'), staleTime: 5 * 60_000 })
}

const NA = 'Não disponível'
const dec = (v: number, d = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: d })

export function fmt(v: number | null | undefined, unit: Unit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA
  if (unit === 'brl') return brl.format(v)
  if (unit === 'pct') return pctFmt.format(v)
  if (unit === 'x') return `${dec(v, 2)}x`
  return int.format(Math.round(v))
}

/** Formato curto para tabelas: "—" no lugar de "Não disponível". */
export const cell = (v: number | null | undefined, unit: Unit) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : fmt(v, unit))

export function hoursText(h: number | null) {
  if (h === null) return NA
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${dec(h)} h`
  return `${dec(h / 24)} dias`
}

export const isoToBr = (iso: string) => iso.split('-').reverse().join('/')

/** Rótulo do grupo do gráfico: dia (dd/mm), semana (sem. dd/mm), mês (mm/aaaa), trimestre e ano. */
export function bucketLabel(b: string, g: string) {
  if (g === 'dia') return `${b.slice(8, 10)}/${b.slice(5, 7)}`
  if (g === 'semana') return `sem. ${b.slice(8, 10)}/${b.slice(5, 7)}`
  if (g === 'mes') return `${b.slice(5, 7)}/${b.slice(0, 4)}`
  if (g === 'trimestre') return `${b.slice(5)} ${b.slice(0, 4)}`
  return b
}

/** Baixa um CSV (separador ";" e BOM, que o Excel em português abre direto). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v
    // Proteção contra fórmula no Excel (=, +, -, @ no começo).
    const safe = /^[=+\-@]/.test(s) && typeof v !== 'number' ? `'${s}` : s
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const csv = `﻿${[header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const campaignPath = (key: string, qs: string) => `${MKT_BASE}/campanhas/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`
