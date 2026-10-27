import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { api } from '@/lib/api'

export interface FreightUnit {
  id: string
  name: string
  city: string | null
  state: string | null
  zip: string | null
  cnpj: string | null
  legalName: string | null
  address: string | null
  isHeadquarters: boolean
  active: boolean
}

export interface VariableDef {
  code: string
  label: string
  source: 'ENTRADA' | 'REGRA'
  unit: string
  help?: string
}

export interface ComponentDef {
  code: string
  name: string
  formula: string
  condition?: string | null
  inTax: boolean
  cteName?: string | null
  order: number
  active: boolean
  description?: string | null
}

export type IcmsMode = 'SOMADO' | 'NAO_INCIDE' | 'INFORMATIVO'
export interface CalcSettings {
  icmsMode: IcmsMode
  icmsRate: number | null
  icmsRateIntra?: number | null
  cubageFactor: number
  useCubage: boolean
  cubageExemptM3?: number | null
}

export interface FreightContext {
  global: boolean
  defaultUnitId: string | null
  units: FreightUnit[]
  carriers: { id: string; name: string }[]
  catalog: {
    inputVariables: VariableDef[]
    ruleVariables: VariableDef[]
    functions: { name: string; help: string }[]
    defaultComponents: ComponentDef[]
    defaultSettings: CalcSettings
    icmsModes: Record<IcmsMode, string>
    modals: { value: string; label: string }[]
    tableKinds: string[]
    tableStatus: string[]
    personTypes: string[]
    usages: string[]
    loadTypes: string[]
    goodsTypes: string[]
    importFields: { field: string; label: string }[]
  }
}

export function useFreightContext() {
  return useQuery({ queryKey: ['fretes', 'contexto'], queryFn: () => api.get<FreightContext>('/fretes/contexto'), staleTime: 60_000 })
}

const UNIT_KEY = 'crm-fretes-filial'
export const ALL_UNITS = '__todas__'

/**
 * Filial ativa do módulo (fica salva no navegador). Quem tem visão global pode escolher "Todas as filiais";
 * quem não tem fica sempre numa das suas filiais.
 */
export function useActiveUnit() {
  const ctx = useFreightContext()
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(UNIT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const data = ctx.data
  const valid = data ? (value === ALL_UNITS ? data.global : data.units.some((u) => u.id === value)) : true
  const fallback = data ? (data.global ? ALL_UNITS : (data.defaultUnitId ?? data.units[0]?.id ?? '')) : ''
  const current = valid && value ? value : fallback
  const set = useCallback((v: string) => {
    setValue(v)
    try {
      localStorage.setItem(UNIT_KEY, v)
    } catch {
      /* sem armazenamento: vale só nesta aba */
    }
  }, [])
  /** Filial para filtrar listas (undefined = todas). */
  const unitId = current && current !== ALL_UNITS ? current : undefined
  return { value: current, unitId, set, ctx }
}

export const formatCep = (c: string | number | null | undefined) => {
  if (c === null || c === undefined || c === '') return '—'
  const s = String(c).replace(/\D/g, '').padStart(8, '0')
  return `${s.slice(0, 5)}-${s.slice(5)}`
}
export const maskCep = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}
export const formatCnpj = (c: string | null | undefined) => {
  const d = (c ?? '').replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c || '—'
}
export const maskCnpj = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** Número digitado no formato brasileiro ("1.234,5" ou "1234.5") → número. Vazio = null. */
export function parseBr(raw: string): number | null {
  const s = raw.trim().replace(/\s|r\$|%/gi, '')
  if (!s) return null
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : NaN
}
export const fmtNum = (v: number | null | undefined, digits = 3) => (v === null || v === undefined ? '' : v.toLocaleString('pt-BR', { maximumFractionDigits: digits }))

export const KIND_LABEL: Record<string, string> = { COMPRA_VENDA: 'Compra/Venda', COMPRA: 'Compra', VENDA: 'Venda' }
export const STATUS_LABEL: Record<string, string> = { ATIVA: 'Ativa', INATIVA: 'Inativa', RASCUNHO: 'Rascunho' }
export const PERSON_LABEL: Record<string, string> = { AMBOS: 'Física e jurídica', PF: 'Física', PJ: 'Jurídica' }
export const USAGE_LABEL: Record<string, string> = { COTACAO_CONCILIACAO: 'Conciliação e cotação', COTACAO: 'Somente cotação', CONCILIACAO: 'Somente conciliação' }
export const LOAD_LABEL: Record<string, string> = { FRACIONADA: 'Fracionada', LOTACAO: 'Lotação', DEDICADA: 'Dedicada' }
export const VERSION_STATUS: Record<string, { label: string; className: string }> = {
  RASCUNHO: { label: 'Rascunho', className: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
  PUBLICADA: { label: 'Publicada', className: 'border-[#006300]/40 text-[#006300] dark:text-[#0ca30c]' },
  SUBSTITUIDA: { label: 'Substituída', className: 'text-muted-foreground' },
  DESCARTADA: { label: 'Descartada', className: 'text-muted-foreground line-through' },
}
export const VALIDITY: Record<string, { label: string; className: string }> = {
  VIGENTE: { label: 'Vigente', className: 'border-[#006300]/40 text-[#006300] dark:text-[#0ca30c]' },
  VENCIDA: { label: 'Vencida', className: 'border-destructive/50 text-destructive' },
  FUTURA: { label: 'Futura', className: 'border-sky-500/40 text-sky-700 dark:text-sky-300' },
}

export type ResultStatus = 'OK' | 'SEM_COBERTURA' | 'RESTRITO' | 'FORA_FAIXA' | 'NAO_APLICAVEL' | 'VENCIDA' | 'SEM_VERSAO' | 'ERRO' | 'SEM_TABELA'
export const RESULT_STATUS: Record<ResultStatus, { label: string; className: string }> = {
  OK: { label: 'Calculado', className: 'border-[#006300]/40 text-[#006300] dark:text-[#0ca30c]' },
  SEM_COBERTURA: { label: 'Sem cobertura', className: 'text-muted-foreground' },
  RESTRITO: { label: 'Restrição', className: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
  FORA_FAIXA: { label: 'Fora da faixa', className: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
  NAO_APLICAVEL: { label: 'Não se aplica', className: 'text-muted-foreground' },
  VENCIDA: { label: 'Tabela vencida', className: 'border-destructive/50 text-destructive' },
  SEM_VERSAO: { label: 'Sem versão publicada', className: 'text-muted-foreground' },
  ERRO: { label: 'Erro na fórmula', className: 'border-destructive/50 text-destructive' },
  SEM_TABELA: { label: 'Sem tabela', className: 'text-muted-foreground' },
}

export interface QuoteComponent {
  code: string
  name: string
  cteName: string | null
  value: number
  inTax: boolean
  formula: string
  skipped: boolean
  missing: string[]
}

export interface QuoteResult {
  tableId: string | null
  tableName: string | null
  quoteName: string
  carrierId: string
  carrierName: string
  versionId: string | null
  versionNumber: number | null
  status: ResultStatus
  reason: string | null
  total: number | null
  subtotal: number | null
  icms: { mode: IcmsMode; rate: number | null; base: number; value: number } | null
  components: QuoteComponent[]
  weights: { real: number; cubed: number; taxed: number } | null
  deadlineDays: number | null
  deliveryDate: string | null
  validUntil: string | null
  rule: { id: string | null; by: string; label: string } | null
  warnings: string[]
  expiredUsed: boolean
}

export interface Quote {
  id: string
  code: number
  unitId: string
  unitName: string | null
  reference: string | null
  customerName: string | null
  customerDoc: string | null
  personType: 'PF' | 'PJ'
  originZip: string
  destZip: string
  destCity: string | null
  destUf: string | null
  cargoValue: number
  realWeight: number
  cubicMeters: number
  volumes: { quantity: number; weight: number; length: number; width: number; height: number }[]
  quoteDate: string
  results: QuoteResult[]
  bestTotal: number | null
  status: 'CALCULADA' | 'SELECIONADA' | 'CANCELADA'
  selectedTableId: string | null
  selectedTotal: number | null
  selectedAt: string | null
  selectedByName: string | null
  selectionNote: string | null
  expiredAllowedReason: string | null
  notes: string | null
  createdByName: string
  createdAt: string
}

export const QUOTE_STATUS: Record<Quote['status'], { label: string; className: string }> = {
  CALCULADA: { label: 'Calculada', className: 'border-sky-500/40 text-sky-700 dark:text-sky-300' },
  SELECIONADA: { label: 'Transportadora escolhida', className: 'border-[#006300]/40 text-[#006300] dark:text-[#0ca30c]' },
  CANCELADA: { label: 'Cancelada', className: 'text-muted-foreground' },
}
