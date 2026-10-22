import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { api } from './api'
import { dayBr, money, moneyShort, num, pct, todaySP } from './format'

/** Marketing Inteligente: tipos e utilidades das telas (as contas ficam na API, em marketing/metricas.ts). */

export type Platform = 'google' | 'meta' | 'tiktok' | 'outros'
export type Granularity = 'dia' | 'semana' | 'mes' | 'trimestre' | 'ano'

export interface Indicators {
  leads: number
  attended: number
  opportunities: number
  qualified: number
  sales: number
  lost: number
  revenue: number
  mktLeads: number
  mktSales: number
  mktRevenue: number
  newCustomers: number
  mediaCost: number
  clicks: number
  impressions: number
  platformConversions: number
  fixedCost: number
  totalCost: number
  lostRate: number | null
  ctr: number | null
  cpc: number | null
  cpm: number | null
  cpl: number | null
  cpql: number | null
  cac: number | null
  conversionRate: number | null
  qualificationRate: number | null
  attendedRate: number | null
  notAttendedRate: number | null
  roas: number | null
  roi: number | null
  ticket: number | null
}
export interface BreakdownRow extends Indicators {
  key: string
  name: string
  platform: Platform | null
}
export interface Recommendation {
  id: string
  area: string
  priority: 'alta' | 'media' | 'baixa'
  confidence: 'alta' | 'media' | 'baixa'
  problem: string
  evidence: string[]
  impact: string
  action: string
  metric: string
  validate: string
  source: string
}
export interface Analysis {
  period: { from: string; to: string; days: number; prevFrom: string; prevTo: string }
  granularity: Granularity
  crmOnlyFilters: string[]
  rules: { qualified: 'repassado_retorno' | 'repassado'; marginPct: number; fixedMonthly: number; marketingOriginIds: string[]; attribution: { model: 'ultimo' | 'primeiro'; windowDays: number } }
  updatedAt: { crm: string; googleAdsCost: string | null; googleAdsScript: string | null; googleAdsCampaigns: string | null }
  now: Indicators
  before: Indicators
  deltas: Record<string, number | null>
  series: { bucket: string; label: string; leads: number; qualified: number; attended: number; sales: number; revenue: number; mktRevenue: number; mediaCost: number; totalCost: number; cpl: number | null; roas: number | null; conversionRate: number | null }[]
  byPlatform: BreakdownRow[]
  byCampaign: BreakdownRow[]
  bySeller: BreakdownRow[]
  byState: BreakdownRow[]
  byRegion: BreakdownRow[]
  byUnit: BreakdownRow[]
  byOrigin: BreakdownRow[]
  byBrand: BreakdownRow[]
  byPartType: BreakdownRow[]
  byCustomerType: BreakdownRow[]
  byCliente: BreakdownRow[]
  funnel: {
    steps: { key: string; label: string; value: number; rate: number | null; media?: boolean }[]
    revenue: number
    times: { toForwardHours: number | null; toForwardMedianHours: number | null; toReturnHours: number | null; toReturnMedianHours: number | null }
  }
  recommendations: Recommendation[]
  quality: { records: number; withOrigin: number; withState: number; withSeller: number; withBrand: number; withPartType: number; googleLeads: number; googleWithCampaign: number; duplicates: number; regionsKnown: number }
}

export interface Options {
  platforms: { key: Platform; label: string; paid: boolean }[]
  campaigns: { id: string; name: string }[]
  brands: { id: string; name: string; active: boolean }[]
  partTypes: { id: string; name: string; active: boolean }[]
  origins: { id: string; name: string; active: boolean }[]
  customerTypes: { id: string; name: string; active: boolean }[]
  units: { id: string; name: string }[]
  sellers: { id: string; name: string }[]
  states: string[]
  regions: string[]
}

/** Filtros na URL (nomes em português): dá para mandar o link da tela já filtrada. */
export const FILTER_KEYS = ['plataforma', 'campanha', 'marca', 'tipoPeca', 'estado', 'regiao', 'filial', 'vendedor', 'origem', 'tipoCliente', 'status', 'cliente'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

export const todayLocal = todaySP

export const PRESETS = [
  { id: '7', label: '7 dias', range: () => [todayLocal(-6), todayLocal()] },
  { id: '30', label: '30 dias', range: () => [todayLocal(-29), todayLocal()] },
  { id: 'mes', label: 'Este mês', range: () => [`${todayLocal().slice(0, 8)}01`, todayLocal()] },
  { id: '90', label: '90 dias', range: () => [todayLocal(-89), todayLocal()] },
  { id: 'ano', label: 'Este ano', range: () => [`${todayLocal().slice(0, 4)}-01-01`, todayLocal()] },
] as const

export function useMktFilters() {
  const [params, setParams] = useSearchParams()
  const from = params.get('de') ?? todayLocal(-29)
  const to = params.get('ate') ?? todayLocal()
  const visao = params.get('visao') ?? ''
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<FilterKey, string>
  const active = FILTER_KEYS.filter((k) => filters[k])
  const q = new URLSearchParams({ de: from, ate: to })
  if (visao) q.set('visao', visao)
  for (const k of FILTER_KEYS) if (filters[k]) q.set(k, filters[k])
  const query = q.toString()
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )
  const clear = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))
  return { from, to, visao, filters, active, query, set, clear }
}

export function useAnalysis(query: string, enabled = true) {
  return useQuery({ queryKey: ['mkt-analise', query], queryFn: () => api.get<Analysis>(`/marketing/analise?${query}`), placeholderData: keepPreviousData, enabled, staleTime: 60_000 })
}

export function useMktOptions(enabled = true) {
  return useQuery({ queryKey: ['mkt-opcoes'], queryFn: () => api.get<Options>('/marketing/opcoes'), staleTime: 5 * 60_000, enabled })
}

// ---------- Formatos ----------

export { money, moneyShort, num, pct }
export const times = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`)
export const hours = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—'
  if (v < 1) return `${Math.round(v * 60)} min`
  if (v < 48) return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
  return `${(v / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
}
export { dayBr }

export const PLATFORM_LABEL: Record<Platform, string> = { google: 'Google Ads', meta: 'Meta Ads', tiktok: 'TikTok Ads', outros: 'Outros canais' }

/** Baixa uma tabela como CSV (separador ";" e BOM, para abrir certo no Excel em português). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    if (v === null) return ''
    const s = typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false }) : v
    // Evita fórmula no Excel (=, +, -, @) e escapa aspas.
    const safe = /^[=+\-@]/.test(s) && typeof v !== 'number' ? `'${s}` : s
    return /[;"\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
