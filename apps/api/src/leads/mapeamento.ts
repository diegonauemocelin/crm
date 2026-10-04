/**
 * Mapeamento de colunas da planilha para os campos do lead e conversão de cada linha.
 * Funções puras (testadas em test/leads.spec.ts).
 */
import { normalizePhone, parseMoney, ufFromPhone, ufFromText } from '../atendimento/br'

export type LeadStageValue = 'LEAD' | 'QUALIFICADO' | 'OPORTUNIDADE' | 'CLIENTE'

export const BASE_FIELDS = {
  email: 'E-mail',
  name: 'Nome',
  phone: 'Telefone',
  mobile: 'Celular',
  company: 'Empresa',
  jobTitle: 'Cargo',
  country: 'País',
  state: 'Estado',
  city: 'Cidade',
  stage: 'Estágio no funil',
  owner: 'Responsável (e-mail do vendedor)',
  tags: 'Tags',
  emailOptIn: 'Aceita receber e-mail',
  origin: 'Origem',
  lastOpportunityAt: 'Data da última oportunidade',
  lastSaleAt: 'Data da última venda',
  lastSaleValue: 'Valor da última venda',
} as const

export type BaseField = keyof typeof BASE_FIELDS
/** Destino de uma coluna: campo do lead, campo personalizado ("custom:chave") ou "ignore". */
export type Target = BaseField | `custom:${string}` | 'ignore'
export type Mapping = Record<string, Target>

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Nomes de coluna reconhecidos automaticamente (inclui o export do RD Station). */
const ALIASES: Record<string, BaseField> = {
  email: 'email',
  'e mail': 'email',
  nome: 'name',
  'nome completo': 'name',
  name: 'name',
  telefone: 'phone',
  fone: 'phone',
  phone: 'phone',
  whatsapp: 'mobile',
  celular: 'mobile',
  'telefone celular': 'mobile',
  empresa: 'company',
  company: 'company',
  cargo: 'jobTitle',
  pais: 'country',
  estado: 'state',
  uf: 'state',
  cidade: 'city',
  'estagio no funil': 'stage',
  'estagio do funil': 'stage',
  'estagio do lead': 'stage',
  'dono do lead': 'owner',
  responsavel: 'owner',
  tags: 'tags',
  'status para comunicacao por email': 'emailOptIn',
  'aceita receber email': 'emailOptIn',
  origem: 'origin',
  'origem do lead': 'origin',
  'data da ultima oportunidade': 'lastOpportunityAt',
  'data da ultima venda': 'lastSaleAt',
  'valor da ultima venda': 'lastSaleValue',
}

/** Colunas do export do RD que não têm uso (sempre vazias ou substituídas pelo scoring do sistema). */
const RD_IGNORED = new Set(['facebook', 'linkedin', 'website', 'lead scoring perfil', 'lead scoring interesse'])

export function suggestMapping(headers: string[], customFields: { key: string; label: string }[]): Mapping {
  const mapping: Mapping = {}
  const used = new Set<string>()
  for (const h of headers) {
    const p = plain(h)
    const base = ALIASES[p]
    const custom = customFields.find((f) => plain(f.label) === p || plain(f.key) === p)
    let target: Target = 'ignore'
    if (base && !used.has(base)) target = base
    else if (custom && !used.has(`custom:${custom.key}`)) target = `custom:${custom.key}`
    else if (RD_IGNORED.has(p)) target = 'ignore'
    if (target !== 'ignore') used.add(target)
    mapping[h] = target
  }
  return mapping
}

export function isRdExport(headers: string[]) {
  const p = headers.map(plain)
  return p.includes('dono do lead') && p.includes('estagio no funil') && p.includes('lead scoring perfil')
}

const STAGES: Record<string, LeadStageValue> = {
  lead: 'LEAD',
  visitante: 'LEAD',
  'lead qualificado': 'QUALIFICADO',
  qualificado: 'QUALIFICADO',
  oportunidade: 'OPORTUNIDADE',
  cliente: 'CLIENTE',
}

export function parseStage(v: string): LeadStageValue | null {
  return STAGES[plain(v)] ?? null
}

export function parseBool(v: string): boolean | null {
  const p = plain(v)
  if (['true', 'sim', 's', '1', 'yes', 'x', 'verdadeiro', 'aceito'].includes(p)) return true
  if (['false', 'nao', 'n', '0', 'no', 'falso', 'recusado'].includes(p)) return false
  return null
}

/** Aceita "2026-10-02 12:33:24 -0300" (RD), ISO, "dd/mm/aaaa" e "dd/mm/aaaa hh:mm". */
export function parseAnyDate(v: string): Date | null {
  const s = v.trim()
  if (!s) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}):?(\d{2})$/.exec(s)
  if (m) return valid(new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${m[7]}:${m[8]}`))
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s)
  if (m) {
    const [d, mo, y, h, mi] = [m[1], m[2], m[3], m[4] ?? '12', m[5] ?? '00']
    return valid(new Date(`${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T${h!.padStart(2, '0')}:${mi}:00-03:00`))
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return valid(new Date(s))
  return null
}

function valid(d: Date) {
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100 ? null : d
}

export function normalizeEmail(v: string): string | null {
  const e = v.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !/@.*@/.test(e) ? e : null
}

/** Etiquetas normalizadas: minúsculas, sem espaços nas pontas, sem repetição; descarta as que casam com o padrão. */
export function normalizeTags(values: string[], discard?: RegExp | null): string[] {
  const out = new Set<string>()
  for (const raw of values) {
    for (const t of raw.split(/[,;|]/)) {
      const tag = t.trim().toLowerCase()
      if (tag && tag.length <= 60 && !(discard && discard.test(tag))) out.add(tag)
    }
  }
  return [...out]
}

export interface ImportOptions {
  /** Responsável aplicado a todos os leads (ignora a coluna de responsável). */
  forceOwnerId?: string | null
  /** Responsável quando a coluna estiver vazia ou o e-mail não for de um vendedor cadastrado. */
  defaultOwnerId?: string | null
  defaultStage?: LeadStageValue
  addTags?: string[]
  /** Expressão regular de tags a descartar (ex.: "^importacao-"). */
  discardTags?: string | null
  /** O que fazer com quem já existe na base: atualizar com os dados da planilha ou manter como está. */
  duplicates?: 'update' | 'skip'
  originId?: string | null
  unitId?: string | null
}

export interface ConvertedLead {
  email: string | null
  name: string | null
  phone: string | null
  company: string | null
  jobTitle: string | null
  country: string | null
  state: string | null
  city: string | null
  stage: LeadStageValue | null
  ownerEmail: string | null
  tags: string[]
  emailOptIn: boolean | null
  origin: string | null
  lastOpportunityAt: Date | null
  lastSaleAt: Date | null
  lastSaleValue: number | null
  custom: Record<string, string>
}

export interface CustomFieldShape {
  key: string
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTISELECT' | 'BOOLEAN'
  options: string[]
}

/** Converte o texto da planilha para o tipo do campo personalizado (ou devolve erro). */
export function convertCustom(field: CustomFieldShape, raw: string): { value: unknown } | { error: string } {
  const v = raw.trim()
  if (!v) return { value: null }
  switch (field.type) {
    case 'NUMBER': {
      const n = parseMoney(v)
      return n === null ? { error: `"${v}" não é número` } : { value: n }
    }
    case 'DATE': {
      const d = parseAnyDate(v)
      return d ? { value: d.toISOString().slice(0, 10) } : { error: `"${v}" não é data` }
    }
    case 'BOOLEAN': {
      const b = parseBool(v)
      return b === null ? { error: `"${v}" não é sim/não` } : { value: b }
    }
    case 'SELECT': {
      const opt = field.options.find((o) => plain(o) === plain(v))
      return opt ? { value: opt } : { error: `"${v}" não está nas opções` }
    }
    case 'MULTISELECT': {
      const parts = v.split(/[,;|]/).map((p) => p.trim()).filter(Boolean)
      const opts = parts.map((p) => field.options.find((o) => plain(o) === plain(p)))
      return opts.every(Boolean) ? { value: opts } : { error: `"${v}" tem itens fora das opções` }
    }
    default:
      return { value: v.slice(0, 1000) }
  }
}

export function convertRow(headers: string[], cells: string[], mapping: Mapping, discard: RegExp | null): { lead: ConvertedLead; problems: string[] } {
  const problems: string[] = []
  const lead: ConvertedLead = {
    email: null,
    name: null,
    phone: null,
    company: null,
    jobTitle: null,
    country: null,
    state: null,
    city: null,
    stage: null,
    ownerEmail: null,
    tags: [],
    emailOptIn: null,
    origin: null,
    lastOpportunityAt: null,
    lastSaleAt: null,
    lastSaleValue: null,
    custom: {},
  }
  let phoneRaw = ''
  let mobileRaw = ''
  const tagValues: string[] = []

  headers.forEach((h, i) => {
    const target = mapping[h] ?? 'ignore'
    const v = (cells[i] ?? '').trim()
    if (target === 'ignore' || !v) return
    if (target.startsWith('custom:')) {
      lead.custom[target.slice(7)] = v
      return
    }
    switch (target as BaseField) {
      case 'email':
        lead.email = normalizeEmail(v)
        if (!lead.email) problems.push(`e-mail inválido "${v}"`)
        break
      case 'name':
        lead.name = v.replace(/^~+\s*/, '').slice(0, 160)
        break
      case 'phone':
        phoneRaw = v
        break
      case 'mobile':
        mobileRaw = v
        break
      case 'company':
        lead.company = v.slice(0, 160)
        break
      case 'jobTitle':
        lead.jobTitle = v.slice(0, 120)
        break
      case 'country':
        lead.country = v.slice(0, 40)
        break
      case 'state':
        lead.state = ufFromText(v)
        if (!lead.state) problems.push(`estado não reconhecido "${v}"`)
        break
      case 'city':
        lead.city = v.slice(0, 80)
        break
      case 'stage':
        lead.stage = parseStage(v)
        if (!lead.stage) problems.push(`estágio não reconhecido "${v}"`)
        break
      case 'owner':
        lead.ownerEmail = v.toLowerCase()
        break
      case 'tags':
        tagValues.push(v)
        break
      case 'emailOptIn':
        lead.emailOptIn = parseBool(v)
        break
      case 'origin':
        lead.origin = v.slice(0, 80)
        break
      case 'lastOpportunityAt':
        lead.lastOpportunityAt = parseAnyDate(v)
        break
      case 'lastSaleAt':
        lead.lastSaleAt = parseAnyDate(v)
        break
      case 'lastSaleValue':
        lead.lastSaleValue = parseMoney(v)
        break
    }
  })

  // Celular tem preferência (é o que chega no WhatsApp); se não for válido, usa o telefone.
  lead.phone = normalizePhone(mobileRaw) ?? normalizePhone(phoneRaw)
  if (!lead.phone && (mobileRaw || phoneRaw)) problems.push(`telefone não reconhecido "${mobileRaw || phoneRaw}"`)
  if (!lead.state) lead.state = ufFromPhone(lead.phone)
  lead.tags = normalizeTags(tagValues, discard)
  return { lead, problems }
}
