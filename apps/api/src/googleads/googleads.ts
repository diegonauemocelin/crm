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
  /** Inclui os contatos em que o CRM detectou anúncio do Google (código de clique, google/cpc ou origem com "Google" no nome). */
  onlyGoogle: boolean
  /** Inclui também os atendimentos destas origens do Pré-Vendas (ex.: WhatsApp, Ligação). Pode ser mais de uma. */
  originIds: string[]
  /** Nomes das campanhas pelo número (aprendidos do utm_campaign ou cadastrados à mão). */
  campaigns: Record<string, string>
  /** Chave secreta do endereço que recebe os nomes das campanhas enviados pelo script do Google Ads. */
  campaignsToken: string | null
  campaignsSyncedAt: string | null
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
  originIds: [],
  campaigns: {},
  campaignsToken: null,
  campaignsSyncedAt: null,
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

/** Meios que indicam anúncio pago (inclui "cpa", usado por engano em alguns modelos de rastreamento). */
export const PAID_MEDIUMS = ['cpc', 'ppc', 'paid', 'pago', 'anuncio', 'ads', 'cpa', 'cpm', 'cpv']

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
  return (src === 'google' || src === 'googleads' || src === 'adwords') && PAID_MEDIUMS.includes(med)
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
  /** Por onde o contato chegou (WhatsApp = MESSAGE, ligação = PHONE, site = WEB). */
  source?: 'WEB' | 'MESSAGE' | 'PHONE'
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
    eventSource: c.source ?? 'WEB',
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

const CAMPAIGN_ID = /^\d{4,20}$/

/** Tag aplicada ao lead que chegou por anúncio do Google. */
export const GOOGLE_ADS_TAG = 'google-ads'

/** Número da campanha numa URL: gad_campaignid (o Google acrescenta sozinho com a marcação automática) ou utm_id. */
export function campaignIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const p = new URL(url).searchParams
    const v = p.get('gad_campaignid') ?? p.get('utm_id')
    return v && CAMPAIGN_ID.test(v) ? v : null
  } catch {
    return null
  }
}

export interface AdsInfo {
  campaignId: string | null
  /** Nome da campanha (do utm_campaign ou do cadastro de nomes); null quando só se sabe o número. */
  campaign: string | null
  at: Date | null
}

/**
 * De qual campanha do Google Ads o contato veio: o toque de anúncio mais recente.
 * O nome vem do utm_campaign (quando não é só o número) ou da lista de nomes cadastrada em Configurações → Google Ads.
 */
export function adsInfoOf(touches: { t: TouchLike | null | undefined; at: Date | null }[], names: Record<string, string> = {}): AdsInfo | null {
  const google = touches
    .filter((x) => isGoogleAdsTouch(x.t))
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))[0]
  if (!google?.t) return null
  const t = google.t
  const rawName = typeof t.campaign === 'string' ? t.campaign.trim() : ''
  const id = (typeof t.campaignId === 'string' && CAMPAIGN_ID.test(t.campaignId) ? t.campaignId : null) ?? campaignIdFromUrl(t.landing) ?? (CAMPAIGN_ID.test(rawName) ? rawName : null)
  // O nome oficial (vindo do Google Ads pelo script, ou cadastrado) vale mais que o utm_campaign digitado no link.
  const name = (id && names[id]) || (rawName && !CAMPAIGN_ID.test(rawName) ? rawName : null)
  return { campaignId: id, campaign: name, at: google.at }
}

/** Texto curto: o nome da campanha; só quando o nome não é conhecido, o número ("campanha nº 1234567"). */
export function campaignLabel(a: Pick<AdsInfo, 'campaign' | 'campaignId'>) {
  if (a.campaign) return a.campaign
  if (a.campaignId) return `campanha nº ${a.campaignId}`
  return 'campanha não identificada'
}

export interface CampaignSync {
  campaigns: Record<string, string>
  count: number
}

/** Lista enviada pelo script do Google Ads: [{ id, name }]. Só números como id e nomes de texto simples. */
export function cleanCampaignList(raw: unknown): CampaignSync | { error: string } {
  const list = (raw as { campaigns?: unknown } | null)?.campaigns
  if (!Array.isArray(list)) return { error: 'Lista de campanhas ausente.' }
  if (list.length > 10_000) return { error: 'Campanhas demais.' }
  const out: Record<string, string> = {}
  for (const c of list) {
    const id = String((c as { id?: unknown })?.id ?? '').trim()
    const name = String((c as { name?: unknown })?.name ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 160)
    if (CAMPAIGN_ID.test(id) && name) out[id] = name
  }
  return { campaigns: out, count: Object.keys(out).length }
}

/** Script para colar em Google Ads → Ferramentas → Ações em massa → Scripts (programar: diariamente). */
export function campaignsScript(url: string) {
  return `/** CRM USA Parts: envia ao CRM o número e o nome de todas as campanhas desta conta (programe para rodar diariamente). */
function main() {
  var lista = [];
  var fontes = ['campaigns', 'performanceMaxCampaigns', 'shoppingCampaigns', 'videoCampaigns'];
  for (var i = 0; i < fontes.length; i++) {
    try {
      var it = AdsApp[fontes[i]]().get();
      while (it.hasNext()) { var c = it.next(); lista.push({ id: String(c.getId()), name: c.getName() }); }
    } catch (e) { Logger.log('Pulando ' + fontes[i] + ': ' + e); }
  }
  var r = UrlFetchApp.fetch('${url}', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ campaigns: lista }), muteHttpExceptions: true });
  Logger.log('CRM respondeu ' + r.getResponseCode() + ': ' + r.getContentText() + ' (' + lista.length + ' campanhas)');
}
`
}

/**
 * Quem entra no retorno: origem do atendimento marcada OU anúncio do Google detectado.
 * Com as duas opções desligadas (nenhuma origem e sem detecção), vão todos.
 */
export function shouldSend(s: Pick<GoogleAdsSettings, 'onlyGoogle' | 'originIds'>, fromGoogle: boolean, originId: string | null) {
  const origins = s.originIds ?? []
  if (!s.onlyGoogle && origins.length === 0) return true
  return (s.onlyGoogle && fromGoogle) || (!!originId && origins.includes(originId))
}

/** Detalhes do erro do Google (BadRequest.fieldViolations e ErrorInfo.reason), em texto curto. */
export function errorDetails(details: unknown[] | undefined): string {
  if (!Array.isArray(details)) return ''
  const parts: string[] = []
  for (const d of details as Record<string, unknown>[]) {
    const fv = d.fieldViolations
    if (Array.isArray(fv)) for (const v of fv.slice(0, 3) as { field?: string; description?: string; reason?: string }[]) parts.push([v.field, v.description ?? v.reason].filter(Boolean).join(': '))
    if (typeof d.reason === 'string') parts.push(`motivo ${d.reason}`)
    const md = d.metadata as Record<string, unknown> | undefined
    if (md && typeof md === 'object') for (const [k, v] of Object.entries(md).slice(0, 3)) if (typeof v === 'string') parts.push(`${k}=${v}`)
  }
  return parts.filter(Boolean).join(' | ').slice(0, 400)
}

/** Origem do evento para o Google: WhatsApp = mensagem, ligação = telefone; o resto = site. */
export function eventSourceFor(originName: string | null | undefined): 'WEB' | 'MESSAGE' | 'PHONE' {
  const n = (originName ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/whats|zap|mensagem|chat/.test(n)) return 'MESSAGE'
  if (/liga|telefone|fone|call/.test(n)) return 'PHONE'
  return 'WEB'
}

/** Mensagem clara para os erros mais comuns da API do Google. */
export function adsError(status: number, body: unknown, clientEmail: string): string {
  const e = (body as { error?: { status?: string; message?: string; details?: unknown[] } | string } | null)?.error
  const code = typeof e === 'object' ? e?.status : undefined
  // O motivo de verdade vem nos detalhes (campo recusado e o porquê); a mensagem principal é genérica.
  const extra = typeof e === 'object' ? errorDetails(e?.details) : ''
  const raw = (typeof e === 'string' ? e : (e?.message ?? '')) + (extra ? ` ${extra}` : '')
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
