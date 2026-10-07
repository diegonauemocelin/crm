import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type Kind = 'PRE_VENDAS' | 'POS_VENDAS'
export type SaleStatus = 'SIM' | 'NAO' | 'NEGOCIACAO'
export type ReturnStatus = 'SIM' | 'NAO' | 'PENDENTE'

export const KIND_INFO: Record<Kind, { title: string; path: string; module: string; other: Kind }> = {
  PRE_VENDAS: { title: 'Pré-Vendas', path: '/pre-vendas', module: 'pre_vendas', other: 'POS_VENDAS' },
  POS_VENDAS: { title: 'Pós-Vendas', path: '/pos-vendas', module: 'pos_vendas', other: 'PRE_VENDAS' },
}

export const SALE_LABEL: Record<SaleStatus, string> = { SIM: 'Vendeu', NAO: 'Perdida', NEGOCIACAO: 'Em negociação' }
export const RETURN_LABEL: Record<ReturnStatus, string> = { SIM: 'Sim', NAO: 'Não', PENDENTE: 'Pendente' }

export type FollowStatus = 'PENDENTE' | 'CONTATADO' | 'ANALISANDO' | 'RESOLVIDO' | 'VOLTOU_AO_VENDEDOR'
export const FOLLOW_LABEL: Record<FollowStatus, string> = {
  PENDENTE: 'Aguardando contato',
  CONTATADO: 'Cliente contatado',
  ANALISANDO: 'Analisando',
  RESOLVIDO: 'Resolvido',
  VOLTOU_AO_VENDEDOR: 'Voltou ao vendedor',
}
export const FOLLOW_STATUSES = Object.keys(FOLLOW_LABEL) as FollowStatus[]

/** "vence em 5 h", "atrasado há 2 h", "contato em 3 h" (prazo do primeiro contato do pós-venda). */
export function followDeadline(r: { followStatus: FollowStatus | null; dueAt: string | null; firstActionAt: string | null }, now: number) {
  if (!r.followStatus || !r.dueAt) return null
  const due = new Date(r.dueAt).getTime()
  const h = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${Math.round(ms / 3_600_000)} h`)
  if (r.firstActionAt) {
    const late = new Date(r.firstActionAt).getTime() > due
    return { tone: late ? ('late' as const) : ('ok' as const), text: late ? 'Contato fora do prazo' : 'Contato no prazo' }
  }
  return due < now ? { tone: 'late' as const, text: `Atrasado há ${h(now - due)}` } : { tone: 'pending' as const, text: `Vence em ${h(due - now)}` }
}

export interface Option {
  id: string
  name: string
  active: boolean
}
export interface SellerOption extends Option {
  unitId: string | null
  userId: string | null
}
export interface UnitOption extends Option {
  city: string | null
  state: string | null
  isHeadquarters: boolean
}
export interface Options {
  units: UnitOption[]
  sellers: SellerOption[]
  origins: Option[]
  customerTypes: Option[]
  brands: Option[]
  partTypes: Option[]
  lostReasons: Option[]
}

export interface ServiceRecord {
  id: string
  kind: Kind
  leadAt: string
  name: string
  customerCode: string | null
  phone: string | null
  email: string | null
  sellerId: string | null
  unitId: string | null
  originId: string | null
  customerTypeId: string | null
  country: string
  state: string | null
  city: string | null
  region: string | null
  brandIds: string[]
  partTypeIds: string[]
  forwarded: boolean
  forwardedAt: string | null
  returnStatus: ReturnStatus | null
  returnedAt: string | null
  saleStatus: SaleStatus
  lostReasonId: string | null
  invoiceNumber: string | null
  saleValue: number | null
  notes: string | null
  importBatch: string | null
  overdue: boolean
  parentId: string | null
  followStatus: FollowStatus | null
  followNote: string | null
  dueAt: string | null
  firstActionAt: string | null
  followOverdue: boolean
  /** Só na consulta individual: a pré-venda de origem e os pós-vendas gerados. */
  parent?: { id: string; sellerId: string | null; leadAt: string; saleStatus: SaleStatus } | null
  children?: { id: string; sellerId: string | null; followStatus: FollowStatus | null; followNote: string | null; dueAt: string | null; firstActionAt: string | null }[]
  createdAt: string
  updatedAt: string
}

export function useOptions() {
  return useQuery({ queryKey: ['atendimento-options'], queryFn: () => api.get<Options>('/cadastros/opcoes'), staleTime: 5 * 60_000 })
}

/** Mapa id → nome de todas as listas (inclui itens desativados, para o histórico continuar legível). */
export function namesOf(o: Options | undefined) {
  const m = new Map<string, string>()
  if (!o) return m
  for (const list of [o.units, o.sellers, o.origins, o.customerTypes, o.brands, o.partTypes, o.lostReasons]) for (const i of list) m.set(i.id, i.name)
  return m
}

export const UF_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
}
export const UF_LIST = Object.keys(UF_NAMES)
export const REGIONS = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul']

const DDD_UF: Record<string, string> = {}
for (const [uf, ddds] of Object.entries({
  SP: [11, 12, 13, 14, 15, 16, 17, 18, 19], RJ: [21, 22, 24], ES: [27, 28], MG: [31, 32, 33, 34, 35, 37, 38], PR: [41, 42, 43, 44, 45, 46],
  SC: [47, 48, 49], RS: [51, 53, 54, 55], DF: [61], GO: [62, 64], TO: [63], MT: [65, 66], MS: [67], AC: [68], RO: [69],
  BA: [71, 73, 74, 75, 77], SE: [79], PE: [81, 87], AL: [82], PB: [83], RN: [84], CE: [85, 88], PI: [86, 89], PA: [91, 93, 94],
  AM: [92, 97], RR: [95], AP: [96], MA: [98, 99],
})) for (const d of ddds) DDD_UF[String(d)] = uf

/** Sugestão de estado a partir do DDD digitado (o operador pode trocar). */
export function ufFromPhoneInput(value: string): string | null {
  let d = value.replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  return d.length >= 10 ? (DDD_UF[d.slice(0, 2)] ?? null) : null
}

/** +5547996470159 → (47) 99647-0159 */
export function formatPhone(e164: string | null) {
  if (!e164) return ''
  const d = e164.replace(/^\+55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return e164
}

/** Máscara de digitação de telefone BR. */
export function maskPhone(value: string) {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
export const int = new Intl.NumberFormat('pt-BR')
export const pctFmt = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })

export function formatDay(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso))
}

/** Data de hoje em São Paulo no formato AAAA-MM-DD. */
export function todaySP(offsetDays = 0) {
  const d = new Date(Date.now() - 3 * 3_600_000 + offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export function whatsappLink(e164: string | null) {
  return e164 ? `https://wa.me/${e164.replace(/\D/g, '')}` : null
}
