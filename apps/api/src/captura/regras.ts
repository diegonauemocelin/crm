/**
 * Regras puras da captura (formulários, pop-ups, botão de WhatsApp). Testadas em test/captura.spec.ts.
 */
import { normalizePhone, UF_LIST } from '../atendimento/br'
import { normalizeEmail } from '../leads/mapeamento'

/** Campos básicos do lead que um formulário pode pedir. Personalizados usam "custom:<chave>". */
export const BASE_FIELDS = {
  name: { label: 'Nome', type: 'text' },
  email: { label: 'E-mail', type: 'email' },
  phone: { label: 'WhatsApp', type: 'tel' },
  company: { label: 'Empresa', type: 'text' },
  jobTitle: { label: 'Cargo', type: 'text' },
  city: { label: 'Cidade', type: 'text' },
  state: { label: 'Estado', type: 'uf' },
  message: { label: 'Mensagem', type: 'textarea' },
} as const

export type BaseKey = keyof typeof BASE_FIELDS

export interface FormField {
  key: string
  label: string
  required: boolean
  /** Para campos personalizados de lista (definidos no cadastro do campo). */
  type?: string
  options?: string[]
}

export interface CustomDef {
  key: string
  label: string
  type: string
  options: string[]
  active: boolean
}

/** Limpa a definição de campos vinda do painel: só chaves conhecidas, sem repetição, rótulos curtos. */
export function cleanFields(raw: unknown, customs: CustomDef[]): { fields: FormField[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Inclua ao menos um campo.' }
  if (raw.length > 20) return { error: 'No máximo 20 campos por formulário.' }
  const out: FormField[] = []
  for (const f of raw as Record<string, unknown>[]) {
    const key = String(f?.key ?? '')
    if (out.some((x) => x.key === key)) continue
    const base = BASE_FIELDS[key as BaseKey]
    const custom = key.startsWith('custom:') ? customs.find((c) => c.key === key.slice(7) && c.active) : undefined
    if (!base && !custom) return { error: `Campo desconhecido: ${key}` }
    const label = String(f?.label ?? '').trim().slice(0, 80) || base?.label || custom!.label
    out.push({ key, label, required: f?.required === true, type: base?.type ?? custom!.type.toLowerCase(), ...(custom?.options.length ? { options: custom.options } : {}) })
  }
  if (!out.some((f) => f.key === 'email' || f.key === 'phone')) return { error: 'O formulário precisa pedir e-mail ou WhatsApp (é o que identifica o lead).' }
  return { fields: out }
}

export interface SubmittedData {
  contact: { name: string | null; email: string | null; phone: string | null; company: string | null; jobTitle: string | null; city: string | null; state: string | null }
  custom: Record<string, string>
  message: string | null
}

/** Confere o envio contra o formulário. Devolve os dados limpos ou a lista de problemas por campo. */
export function validateSubmission(fields: FormField[], input: Record<string, unknown>): { data: SubmittedData } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const data: SubmittedData = { contact: { name: null, email: null, phone: null, company: null, jobTitle: null, city: null, state: null }, custom: {}, message: null }
  for (const f of fields) {
    const raw = input[f.key]
    const value = (Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '').trim()
    if (!value) {
      if (f.required) errors[f.key] = 'Preencha este campo.'
      continue
    }
    if (value.length > (f.key === 'message' ? 2000 : 200)) {
      errors[f.key] = 'Texto muito longo.'
      continue
    }
    switch (f.key) {
      case 'email': {
        const e = normalizeEmail(value)
        if (!e) errors[f.key] = 'E-mail inválido.'
        else data.contact.email = e
        break
      }
      case 'phone': {
        const p = normalizePhone(value)
        if (!p) errors[f.key] = 'Telefone inválido. Use DDD + número.'
        else data.contact.phone = p
        break
      }
      case 'state': {
        const uf = value.toUpperCase()
        if (!(UF_LIST as readonly string[]).includes(uf)) errors[f.key] = 'Estado inválido.'
        else data.contact.state = uf
        break
      }
      case 'message':
        data.message = value
        break
      case 'name':
      case 'company':
      case 'jobTitle':
      case 'city':
        data.contact[f.key] = value
        break
      default:
        if (f.options?.length && !value.split(',').map((v) => v.trim()).every((v) => f.options!.includes(v))) errors[f.key] = 'Opção inválida.'
        else data.custom[f.key.slice(7)] = value
    }
  }
  if (!Object.keys(errors).length && !data.contact.email && !data.contact.phone) errors[fields.find((f) => f.key === 'phone' || f.key === 'email')?.key ?? '_'] = 'Informe o e-mail ou o WhatsApp.'
  return Object.keys(errors).length ? { errors } : { data }
}

/** A página do site é uma onde o pop-up/botão deve aparecer? Trechos do endereço; "*" no fim = começa com. */
export function pageMatches(url: string, include: string[], exclude: string[]) {
  let path: string
  try {
    const u = new URL(url)
    path = `${u.pathname}${u.search}`.toLowerCase()
  } catch {
    return false
  }
  const hit = (pattern: string) => {
    const p = pattern.trim().toLowerCase()
    if (!p) return false
    return p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p || path.includes(p)
  }
  if (exclude.some(hit)) return false
  return include.filter((p) => p.trim()).length === 0 || include.some(hit)
}

/** Mensagem do WhatsApp com as variáveis {nome} e {pagina}. */
export function whatsappText(template: string, v: { name: string | null; page: string | null }) {
  const first = v.name?.trim().split(/\s+/)[0] ?? ''
  return template.replaceAll('{nome}', first).replaceAll('{pagina}', v.page ?? '').replace(/\s+/g, ' ').trim()
}

export function waLink(phoneE164: string, text: string) {
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

/** Endereço de redirecionamento só http(s) (nada de javascript:). */
export function safeRedirect(url: string | null | undefined) {
  if (!url) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 500) : null
  } catch {
    return null
  }
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
