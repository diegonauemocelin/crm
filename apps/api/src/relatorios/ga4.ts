/**
 * Google Analytics 4 (Data API), com conta de serviço só de leitura.
 * Regras puras (testadas em test/relatorios.spec.ts): leitura do arquivo de chave, assinatura do JWT e leitura das respostas.
 */
import { createPrivateKey, createSign } from 'node:crypto'

export const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
export const GA_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GA_API = 'https://analyticsdata.googleapis.com/v1beta'

export interface Ga4Settings {
  enabled: boolean
  propertyId: string
  clientEmail: string
  privateKeyEnc: string | null
  updatedAt: string | null
}
export const DEFAULT_GA4: Ga4Settings = { enabled: false, propertyId: '', clientEmail: '', privateKeyEnc: null, updatedAt: null }

/** Aceita "123456789" ou "properties/123456789". */
export function cleanPropertyId(input: string): string | null {
  const m = input.trim().match(/^(?:properties\/)?(\d{5,15})$/)
  return m ? m[1]! : null
}

/** Lê o arquivo JSON da conta de serviço baixado do Google Cloud. Só e-mail e chave privada são usados. */
export function parseKeyFile(text: string): { clientEmail: string; privateKey: string } | { error: string } {
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { error: 'O arquivo não é um JSON válido. Use o arquivo de chave (.json) da conta de serviço.' }
  }
  if (json.type !== 'service_account') return { error: 'Este não é um arquivo de conta de serviço (o campo "type" deve ser "service_account").' }
  const clientEmail = typeof json.client_email === 'string' ? json.client_email.trim() : ''
  const privateKey = typeof json.private_key === 'string' ? json.private_key : ''
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) return { error: 'E-mail da conta de serviço não encontrado no arquivo.' }
  if (!privateKey.includes('BEGIN PRIVATE KEY')) return { error: 'Chave privada não encontrada no arquivo.' }
  try {
    createPrivateKey(privateKey)
  } catch {
    return { error: 'A chave privada do arquivo está corrompida.' }
  }
  return { clientEmail, privateKey }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')

/** JWT assinado (RS256) trocado por um token de acesso de 1 hora. */
export function signJwt(clientEmail: string, privateKey: string, now = Date.now(), scope = GA_SCOPE) {
  const iat = Math.floor(now / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope, aud: GA_TOKEN_URL, iat, exp: iat + 3600 }))
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(privateKey).toString('base64url')
  return `${header}.${claims}.${signature}`
}

export interface GaRequest {
  dimensions?: string[]
  metrics: string[]
  limit?: number
  orderBy?: { metric?: string; dimension?: string; desc?: boolean }
}

export function gaBody(range: { from: string; to: string }, r: GaRequest, previous?: { from: string; to: string }) {
  return {
    dateRanges: [{ startDate: range.from, endDate: range.to }, ...(previous ? [{ startDate: previous.from, endDate: previous.to }] : [])],
    dimensions: (r.dimensions ?? []).map((name) => ({ name })),
    metrics: r.metrics.map((name) => ({ name })),
    ...(r.limit ? { limit: r.limit } : {}),
    ...(r.orderBy
      ? { orderBys: [r.orderBy.metric ? { metric: { metricName: r.orderBy.metric }, desc: r.orderBy.desc ?? true } : { dimension: { dimensionName: r.orderBy.dimension }, desc: r.orderBy.desc ?? false }] }
      : {}),
  }
}

interface GaRow {
  dimensionValues?: { value?: string }[]
  metricValues?: { value?: string }[]
}
export interface GaReport {
  dimensionHeaders?: { name: string }[]
  metricHeaders?: { name: string }[]
  rows?: GaRow[]
}

/** Linhas como objetos: { dimensão: valor, métrica: número }. A data do GA (AAAAMMDD) vira AAAA-MM-DD. */
export function gaRows(report: GaReport): Record<string, string | number>[] {
  const dims = (report.dimensionHeaders ?? []).map((h) => h.name)
  const mets = (report.metricHeaders ?? []).map((h) => h.name)
  return (report.rows ?? []).map((row) => {
    const out: Record<string, string | number> = {}
    dims.forEach((d, i) => {
      const v = row.dimensionValues?.[i]?.value ?? ''
      out[d] = d === 'date' && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v
    })
    mets.forEach((m, i) => {
      const n = Number(row.metricValues?.[i]?.value ?? 0)
      out[m] = Number.isFinite(n) ? n : 0
    })
    return out
  })
}

/** Mensagem clara para os erros mais comuns da API do Google. */
export function gaError(status: number, body: unknown, clientEmail: string): string {
  const e = (body as { error?: { status?: string; message?: string; error_description?: string } } | null)?.error
  const code = typeof e === 'object' ? e?.status : undefined
  const raw = typeof e === 'string' ? e : (e?.message ?? '')
  if (status === 403 || code === 'PERMISSION_DENIED') {
    if (/has not been used|is disabled/i.test(raw)) return 'A "Google Analytics Data API" não está ativada no projeto do Google Cloud desta conta de serviço. Ative-a em APIs e serviços → Biblioteca.'
    return `A conta de serviço não tem acesso a esta propriedade. No GA4, em Administrador → Gerenciamento de acesso à propriedade, adicione ${clientEmail} como Leitor.`
  }
  if (status === 400 && /invalid_grant/i.test(JSON.stringify(body))) return 'O Google recusou a chave. Confira se a chave não foi apagada no Google Cloud e se o relógio do servidor está certo.'
  if (status === 404 || code === 'NOT_FOUND') return 'Propriedade do GA4 não encontrada. Confira o ID da propriedade (só números, em Administrador → Detalhes da propriedade).'
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return 'Limite de consultas do Google Analytics atingido. Tente de novo em alguns minutos.'
  if (status === 400) return `O Google Analytics recusou a consulta: ${raw.slice(0, 200) || 'pedido inválido'}.`
  return `O Google Analytics não respondeu (erro ${status}). Tente de novo em alguns minutos.`
}
