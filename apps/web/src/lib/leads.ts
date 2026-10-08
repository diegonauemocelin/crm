import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type LeadStage = 'LEAD' | 'QUALIFICADO' | 'OPORTUNIDADE' | 'CLIENTE'
export type Grade = 'A' | 'B' | 'C' | 'D'

export const STAGES: { id: LeadStage; label: string }[] = [
  { id: 'LEAD', label: 'Lead' },
  { id: 'QUALIFICADO', label: 'Lead qualificado' },
  { id: 'OPORTUNIDADE', label: 'Oportunidade' },
  { id: 'CLIENTE', label: 'Cliente' },
]
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<LeadStage, string>

/** Cores das faixas de nota: só como apoio; a letra está sempre escrita. */
export const GRADE_CLASS: Record<Grade, string> = {
  A: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  B: 'border-sky-500/50 bg-sky-500/15 text-sky-800 dark:text-sky-300',
  C: 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300',
  D: 'border-border bg-muted text-muted-foreground',
}

/** Campanha do Google Ads de onde o contato veio (só quando o CRM detecta o anúncio). */
export interface GoogleAdsInfo {
  campaignId: string | null
  campaign: string | null
  label: string
  byOrigin?: boolean
}

export interface Lead {
  id: string
  googleAds?: GoogleAdsInfo | null
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  jobTitle: string | null
  country: string
  state: string | null
  city: string | null
  stage: LeadStage
  ownerId: string | null
  unitId: string | null
  originId: string | null
  tags: string[]
  customFields: Record<string, unknown>
  emailOptIn: boolean
  emailOptOutAt: string | null
  firstConversionAt: string | null
  lastConversionAt: string | null
  lastOpportunityAt: string | null
  lastSaleAt: string | null
  lastSaleValue: number | null
  scoreProfile: number
  scoreInterest: number
  scoreTotal: number
  scoreGrade: Grade | null
  lastActivityAt: string | null
  importBatch: string | null
  anonymizedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CustomField {
  id: string
  key: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTISELECT' | 'BOOLEAN'
  options: string[]
  active: boolean
  position: number
}

export const FIELD_TYPE_LABEL: Record<CustomField['type'], string> = {
  TEXT: 'Texto',
  NUMBER: 'Número',
  DATE: 'Data',
  SELECT: 'Lista (uma opção)',
  MULTISELECT: 'Lista (várias opções)',
  BOOLEAN: 'Sim/Não',
}

export function useCustomFields() {
  return useQuery({ queryKey: ['lead-fields'], queryFn: () => api.get<CustomField[]>('/leads/config/campos'), staleTime: 5 * 60_000 })
}

export function useTags() {
  return useQuery({ queryKey: ['lead-tags'], queryFn: () => api.get<{ tag: string; total: number }[]>('/leads/config/tags'), staleTime: 60_000 })
}

/** Compacta o arquivo no navegador antes de enviar (planilhas de texto ficam ~6x menores). */
export async function gzipFile(file: File): Promise<Blob> {
  if (typeof CompressionStream === 'undefined' || /\.(xlsx|gz)$/i.test(file.name)) return file
  const stream = file.stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).blob()
}
