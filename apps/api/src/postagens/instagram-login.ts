/**
 * Conexão de contas do Instagram pelo login do próprio Instagram (API do Instagram com login do Instagram).
 * A pessoa digita usuário e senha na tela do Instagram; o CRM recebe só o token de cada conta (60 dias, renovado
 * antes de vencer). Cada conta conectada publica com o próprio token, sem depender do token da Meta.
 * O fetch é injetável para os testes.
 */
import type { Fetcher } from './meta'

export const IG_AUTH_URL = 'https://www.instagram.com/oauth/authorize'
export const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
export const IG_GRAPH = 'https://graph.instagram.com/v23.0'
const IG_GRAPH_ROOT = 'https://graph.instagram.com'
/** Só o que a publicação e as métricas usam (sem mensagens nem comentários). */
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights']
/** Tela do CRM que recebe a volta do Instagram (cadastrada no app da Meta como URL de redirecionamento). */
export const IG_CALLBACK_PATH = '/postagens/instagram/retorno'
/** Renova quando faltam menos dias que isto (o token vale 60 dias e só renova depois de 24 h de criado). */
export const RENEW_BEFORE_DAYS = 20

export interface IgApp {
  appId: string
  secretEnc: string | null
}
export interface IgToken {
  tokenEnc: string
  username: string
  expiresAt: string
  /** Quando foi criado ou renovado. */
  issuedAt: string
  connectedBy: string
  lastError: string | null
}
export interface IgConnected {
  userId: string
  username: string
  accountType: string | null
  token: string
  expiresAt: string
}

export class IgLoginError extends Error {}

/** Endereço do login do Instagram. force_authentication pede usuário e senha de novo (para conectar outra conta). */
export function authorizeUrl(appId: string, redirectUri: string, state: string) {
  const url = new URL(IG_AUTH_URL)
  url.search = new URLSearchParams({ enable_fb_login: '0', force_authentication: '1', client_id: appId, redirect_uri: redirectUri, response_type: 'code', scope: IG_SCOPES.join(','), state }).toString()
  return url.toString()
}

/** O Instagram devolve o code com "#_" no fim. */
export const cleanCode = (code: string) => code.trim().replace(/#_$/, '')

/** Token perto de vencer e com mais de 24 h (a Meta só renova depois disso). */
export function needsRenewal(t: Pick<IgToken, 'expiresAt' | 'issuedAt'>, now = Date.now()) {
  const left = Date.parse(t.expiresAt) - now
  return left < RENEW_BEFORE_DAYS * 86_400_000 && now - Date.parse(t.issuedAt) > 86_400_000
}

function igMessage(status: number, body: unknown) {
  const b = body as { error?: { message?: string; code?: number } | string; error_message?: string; error_type?: string } | null
  const e = typeof b?.error === 'object' ? b.error : null
  const msg = e?.message || b?.error_message || (typeof b?.error === 'string' ? b.error : '') || `erro ${status}`
  if (e?.code === 190 || /expired|invalid.*token|session/i.test(msg)) return `A conexão do Instagram venceu ou foi removida: conecte a conta de novo em Postagens › Contas. (${msg})`
  if (/redirect_uri/i.test(msg)) return `O endereço de retorno não está cadastrado no app da Meta (Instagram › Configurar o login da empresa). (${msg})`
  if (/client_secret|client_id|app/i.test(msg) && status === 400) return `ID ou chave secreta do app do Instagram não conferem. (${msg})`
  return msg.slice(0, 300)
}

export class InstagramLogin {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  private async json(url: string, init?: RequestInit) {
    const res = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(30_000), redirect: 'error' })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !body || body.error || body.error_message) throw new IgLoginError(igMessage(res.status, body))
    return body
  }

  /** Troca o code pelo token de 60 dias e lê a conta (id profissional, que é o usado para publicar, e o @). */
  async connect(app: { appId: string; secret: string }, code: string, redirectUri: string): Promise<IgConnected> {
    const short = await this.json(IG_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.appId, client_secret: app.secret, grant_type: 'authorization_code', redirect_uri: redirectUri, code: cleanCode(code) }).toString(),
    })
    const shortToken = String((short.data as { access_token?: string }[] | undefined)?.[0]?.access_token ?? short.access_token ?? '')
    if (!shortToken) throw new IgLoginError('O Instagram não devolveu o acesso. Tente conectar de novo.')
    const long = await this.json(`${IG_GRAPH_ROOT}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: app.secret, access_token: shortToken })}`)
    const token = String(long.access_token ?? '')
    if (!token) throw new IgLoginError('O Instagram não devolveu o acesso de longa duração.')
    const me = await this.json(`${IG_GRAPH}/me?${new URLSearchParams({ fields: 'user_id,username,account_type', access_token: token })}`)
    const userId = String(me.user_id ?? '')
    if (!/^\d{5,25}$/.test(userId)) throw new IgLoginError('O Instagram não informou o ID da conta.')
    return { userId, username: String(me.username ?? ''), accountType: (me.account_type as string | undefined) ?? null, token, expiresAt: new Date(Date.now() + (Number(long.expires_in) || 60 * 86_400) * 1000).toISOString() }
  }

  /** Renova o token por mais 60 dias. */
  async refresh(token: string) {
    const r = await this.json(`${IG_GRAPH_ROOT}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`)
    const next = String(r.access_token ?? '')
    if (!next) throw new IgLoginError('O Instagram não renovou o acesso.')
    return { token: next, expiresAt: new Date(Date.now() + (Number(r.expires_in) || 60 * 86_400) * 1000).toISOString() }
  }
}
