/**
 * Regras puras do Meta Lead Ads (testadas em test/rastreamento.spec.ts): assinatura do webhook,
 * leitura do aviso e conversão das respostas do formulário em dados do lead.
 */
import { createHmac } from 'node:crypto'
import { safeEqual } from '../common/crypto'
import type { CapturedContact } from '../leads/lead-capture.service'

/** O Meta assina o corpo bruto com o "App Secret": cabeçalho X-Hub-Signature-256 = "sha256=<hex>". */
export function validSignature(rawBody: Buffer, header: string | undefined, appSecret: string) {
  if (!header?.startsWith('sha256=') || !appSecret) return false
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
  return safeEqual(header, expected)
}

export interface LeadgenNotice {
  leadgenId: string
  formId: string | null
  pageId: string | null
  createdTime: number | null
}

/** Extrai os avisos de "novo lead" do corpo do webhook (ignora qualquer outro tipo de aviso). */
export function leadgenNotices(body: unknown): LeadgenNotice[] {
  const out: LeadgenNotice[] = []
  const b = body as { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] }
  if (b?.object !== 'page' || !Array.isArray(b.entry)) return out
  for (const entry of b.entry.slice(0, 100)) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : []).slice(0, 100)) {
      const v = change?.value
      if (change?.field !== 'leadgen' || !v) continue
      const id = String(v.leadgen_id ?? '')
      if (!/^\d{1,30}$/.test(id)) continue
      const num = (x: unknown) => (typeof x === 'number' || (typeof x === 'string' && /^\d{1,30}$/.test(x)) ? String(x) : null)
      out.push({ leadgenId: id, formId: num(v.form_id), pageId: num(v.page_id), createdTime: typeof v.created_time === 'number' ? v.created_time : null })
    }
  }
  return out
}

export interface MetaLead {
  field_data?: { name?: string; values?: unknown[] }[]
  created_time?: string
  form_id?: string
  ad_name?: string
  adset_name?: string
  campaign_name?: string
  platform?: string
  is_organic?: boolean
}

const FIELD_MAP: Record<string, keyof CapturedContact> = {
  email: 'email',
  e_mail: 'email',
  phone_number: 'phone',
  phone: 'phone',
  telefone: 'phone',
  whatsapp: 'phone',
  full_name: 'name',
  nome_completo: 'name',
  nome: 'name',
  city: 'city',
  cidade: 'city',
  state: 'state',
  estado: 'state',
  company_name: 'company',
  empresa: 'company',
  job_title: 'jobTitle',
  cargo: 'jobTitle',
}

/** Respostas do formulário -> contato. Perguntas personalizadas vão para "respostas" (ficam no evento do lead). */
export function contactFromMeta(lead: MetaLead): { contact: CapturedContact; answers: Record<string, string> } {
  const contact: CapturedContact = {}
  const answers: Record<string, string> = {}
  let first = ''
  let last = ''
  for (const f of (lead.field_data ?? []).slice(0, 60)) {
    const name = String(f.name ?? '').trim().toLowerCase().slice(0, 80)
    const value = (Array.isArray(f.values) ? f.values : []).map((v) => String(v)).join(', ').trim().slice(0, 500)
    if (!name || !value) continue
    const target = FIELD_MAP[name]
    if (target) contact[target] = value
    else if (name === 'first_name') first = value
    else if (name === 'last_name') last = value
    else answers[name] = value
  }
  if (!contact.name && (first || last)) contact.name = `${first} ${last}`.trim()
  return { contact, answers }
}

/** Origem da conversão no formato do rastreamento do site, para os relatórios tratarem tudo igual. */
export function touchFromMeta(lead: MetaLead, formId: string | null) {
  const instagram = lead.platform === 'ig'
  return {
    source: instagram ? 'instagram' : 'facebook',
    medium: lead.is_organic ? 'social' : 'cpc',
    campaign: lead.campaign_name?.slice(0, 120),
    content: lead.ad_name?.slice(0, 120),
    landing: `Formulário do Meta${formId ? ` ${formId}` : ''}`,
  }
}

export const GRAPH_VERSION = /^v\d{1,2}\.\d{1,2}$/
