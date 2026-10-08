/**
 * Retorno do CRM para o Google Ads (Data Manager API): o resultado de cada contato que veio de anúncio
 * (venda, perda por motivo, negociação) vira uma conversão off-line na conta do Google Ads.
 * Funções puras (testadas em test/googleads.spec.ts).
 */
import { createHash } from 'node:crypto'

export const DM_SCOPE = 'https://www.googleapis.com/auth/datamanager'
export const DM_INGEST_URL = 'https://datamanager.googleapis.com/v1/events:ingest'
/** O Google só aceita conversões até 90 dias depois do clique (63 dias quando casa só pelo e-mail/telefone). */
export const CLICK_WINDOW_DAYS = 90
export const USER_DATA_WINDOW_DAYS = 63
/** Eventos por envio (o limite do Google é maior; lotes menores deixam os erros mais fáceis de achar). */
export const BATCH_SIZE = 500

export type ConversionKind = 'contato' | 'negociacao' | 'venda' | 'perda'

export interface GoogleAdsSettings {
  enabled: boolean
  /** ID da conta (10 dígitos, sem hífen) e, se a conta for gerenciada por uma MCC, o ID da MCC. */
  customerId: string
  loginCustomerId: string
  clientEmail: string
  privateKeyEnc: string | null
  /** ID da ação de conversão no Google Ads (tipo "Importação de cliques"); vazio = não envia esse resultado. */
  actions: {
    contato: string
    negociacao: string
    venda: string
    /** Perda sem motivo mapeado. */
    perda: string
    /** Por motivo de perda (id da lista "Motivos de perda"). Vazio = usa o padrão de perda. "-" = não envia. */
    perdaPorMotivo: Record<string, string>
  }
  /** Envia e-mail e telefone criptografados (SHA-256) para o Google casar quem chamou direto no WhatsApp ou ligou. */
  sendUserData: boolean
  /** Só contatos que vieram de anúncio do Google (recomendado) ou todos os atendimentos. */
  onlyGoogle: boolean
  /** Atendimentos a partir desta data (não manda o histórico antigo de uma vez ao ligar). */
  startDate: string | null
  updatedAt: string | null
}

export const DEFAULT_GOOGLE_ADS: GoogleAdsSettings = {
  enabled: false,
  customerId: '',
  loginCustomerId: '',
  clientEmail: '',
  privateKeyEnc: null,
  actions: { contato: '', negociacao: '', venda: '', perda: '', perdaPorMotivo: {} },
  sendUserData: true,
  onlyGoogle: true,
  startDate: null,
  updatedAt: null,
}

/** Aceita "123-456-7890" ou "1234567890". */
export function cleanCustomerId(v: string): string | null {
  const d = v.replace(/[\s-]/g, '')
  return /^\d{10}$/.test(d) ? d : null
}

/** ID numérico da ação de conversão (aparece na URL da ação: ctId=...). */
export function cleanActionId(v: unknown): string {
  const s = String(v ?? '').trim()
  if (s === '-') return '-'
  return /^\d{1,20}$/.test(s) ? s : ''
}

export interface ClickIds {
  gclid?: string
  gbraid?: string
  wbraid?: string
}

const CLICK_RE = /^[A-Za-z0-9_-]{10,200}$/

/** Códigos de clique do Google numa URL guardada (página de entrada da visita ou da conversão). */
export function clickIdsFromUrl(url: string | null | undefined): ClickIds | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const out: ClickIds = {}
  for (const k of ['gclid', 'gbraid', 'wbraid'] as const) {
    const v = u.searchParams.get(k)
    if (v && CLICK_RE.test(v)) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

interface TouchLike {
  source?: string
  medium?: string
  landing?: string
  [k: string]: unknown
}

/** A visita veio de anúncio do Google? (código de clique na página de entrada ou utm google/cpc). */
export function isGoogleAdsTouch(t: TouchLike | null | undefined) {
  if (!t) return false
  if (clickIdsFromUrl(t.landing)) return true
  const src = String(t.source ?? '').toLowerCase()
  const med = String(t.medium ?? '').toLowerCase()
  return (src === 'google' || src === 'googleads' || src === 'adwords') && ['cpc', 'ppc', 'paid', 'pago', 'anuncio', 'ads'].includes(med)
}

export const sha256Hex = (v: string) => createHash('sha256').update(v).digest('hex')

/** Regras do Google: e-mail sem espaços e minúsculo; telefone em E.164 (+5549999990000). */
export function normalizeEmail(email: string | null | undefined) {
  const e = email?.trim().toLowerCase()
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null
}
export function normalizeE164(phone: string | null | undefined) {
  if (!phone) return null
  const d = phone.replace(/\D/g, '')
  return d.length >= 10 && d.length <= 15 ? `+${d}` : null
}

/** Data com fuso de Brasília no formato que o Google pede (ISO 8601 com deslocamento). */
export function isoWithOffset(d: Date) {
  const sp = new Date(d.getTime() - 3 * 3_600_000)
  return `${sp.toISOString().slice(0, 19)}-03:00`
}

export interface PendingConversion {
  transactionId: string
  eventAt: Date
  value: number | null
  clickIds: ClickIds | null
  email: string | null
  phone: string | null
}

/** Um evento do Data Manager. Sem código de clique e sem dado do cliente, não há como o Google casar: devolve null. */
export function buildEvent(c: PendingConversion, sendUserData: boolean) {
  const ids = c.clickIds ?? {}
  const userIdentifiers: { emailAddress?: string; phoneNumber?: string }[] = []
  if (sendUserData) {
    const e = normalizeEmail(c.email)
    const p = normalizeE164(c.phone)
    if (e) userIdentifiers.push({ emailAddress: sha256Hex(e) })
    if (p) userIdentifiers.push({ phoneNumber: sha256Hex(p) })
  }
  const hasClick = !!(ids.gclid || ids.gbraid || ids.wbraid)
  if (!hasClick && userIdentifiers.length === 0) return null
  return {
    transactionId: c.transactionId,
    eventTimestamp: isoWithOffset(c.eventAt),
    eventSource: 'OTHER',
    ...(hasClick ? { adIdentifiers: { ...(ids.gclid ? { gclid: ids.gclid } : {}), ...(ids.gbraid ? { gbraid: ids.gbraid } : {}), ...(ids.wbraid ? { wbraid: ids.wbraid } : {}) } } : {}),
    ...(userIdentifiers.length ? { userData: { userIdentifiers } } : {}),
    ...(c.value !== null && c.value > 0 ? { conversionValue: Math.round(c.value * 100) / 100, currency: 'BRL' } : {}),
  }
}

export function ingestBody(s: GoogleAdsSettings, actionId: string, events: object[], validateOnly = false) {
  const login = s.loginCustomerId || s.customerId
  return {
    destinations: [
      {
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: s.customerId },
        loginAccount: { accountType: 'GOOGLE_ADS', accountId: login },
        productDestinationId: actionId,
      },
    ],
    encoding: 'HEX',
    // Dados do cliente só para medir o resultado do anúncio, nunca para personalizar anúncios.
    consent: { adUserData: s.sendUserData ? 'CONSENT_GRANTED' : 'CONSENT_DENIED', adPersonalization: 'CONSENT_DENIED' },
    events,
    ...(validateOnly ? { validateOnly: true } : {}),
  }
}

/** Qual ação de conversão recebe o resultado (vazio = não envia). */
export function actionFor(s: GoogleAdsSettings, kind: ConversionKind, lostReasonId: string | null) {
  if (kind !== 'perda') return s.actions[kind] || ''
  const byReason = lostReasonId ? s.actions.perdaPorMotivo[lostReasonId] : undefined
  if (byReason === '-') return ''
  return byReason || s.actions.perda || ''
}

/** Mensagem clara para os erros mais comuns da API do Google. */
export function adsError(status: number, body: unknown, clientEmail: string): string {
  const e = (body as { error?: { status?: string; message?: string } | string } | null)?.error
  const code = typeof e === 'object' ? e?.status : undefined
  const raw = typeof e === 'string' ? e : (e?.message ?? '')
  if (status === 403 || code === 'PERMISSION_DENIED') {
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(raw)) return 'A “Data Manager API” não está ativada no projeto do Google Cloud desta conta de serviço. Ative em APIs e serviços → Biblioteca.'
    return `A conta de serviço não tem acesso à conta do Google Ads. Adicione ${clientEmail} como usuário (acesso padrão) em Google Ads → Administrador → Acesso e segurança.`
  }
  if (status === 400 && /invalid_grant/i.test(JSON.stringify(body))) return 'O Google recusou a chave. Confira se a chave não foi apagada no Google Cloud e se o relógio do servidor está certo.'
  if (status === 404 || code === 'NOT_FOUND') return 'Conta ou ação de conversão não encontrada. Confira o ID da conta e os IDs das conversões (tipo “Importação → Cliques”).'
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return 'Limite de envios do Google atingido. O CRM tenta de novo mais tarde.'
  if (status === 400 || code === 'INVALID_ARGUMENT') return `O Google recusou o envio: ${raw.slice(0, 300) || 'dados inválidos'}.`
  return `O Google não respondeu (erro ${status}). O CRM tenta de novo mais tarde.`
}
