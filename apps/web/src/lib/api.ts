/**
 * Cliente HTTP da aplicação. A sessão vive em cookies HttpOnly; aqui só repetimos o token CSRF
 * no header e renovamos a sessão automaticamente quando o token de acesso (15 min) expira.
 */
export class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function csrfToken(): string {
  return document.cookie.split('; ').find((c) => c.startsWith('crm_csrf='))?.split('=')[1] ?? ''
}

/**
 * App instalado na tela inicial do celular: o servidor dá uma sessão mais longa (30 dias sem uso), para não pedir
 * login toda hora.
 */
function appHeader(): Record<string, string> {
  const app = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return app ? { 'X-CRM-App': '1' } : {}
}

/** "unavailable": servidor fora do ar (reiniciando no deploy) — a sessão continua valendo, não é para ir ao login. */
type RefreshResult = 'ok' | 'denied' | 'unavailable'
let refreshing: Promise<RefreshResult> | null = null

/**
 * Renova a sessão. Sem o cookie CSRF (o iPhone apaga ao fechar o app) busca um novo antes; se a renovação for
 * recusada pelo CSRF (cookie trocado no meio), busca de novo e tenta mais uma vez, em vez de mandar para o login.
 */
async function refreshSession(): Promise<RefreshResult> {
  const attempt = () =>
    fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken(), ...appHeader() },
    })
  refreshing ??= ensureCsrf()
    .then(attempt)
    .then(async (r) => {
      if (r.status !== 403) return r
      await fetch('/api/system/version', { credentials: 'same-origin' })
      return attempt()
    })
    .then((r): RefreshResult => (r.ok ? 'ok' : r.status >= 500 ? 'unavailable' : 'denied'))
    .catch((): RefreshResult => 'unavailable')
    .finally(() => setTimeout(() => (refreshing = null), 0))
  return refreshing
}

export const UNAVAILABLE_MESSAGE = 'O sistema está reiniciando (atualização). Tente de novo em alguns segundos.'

/** Garante que o cookie CSRF exista antes do primeiro POST (ex.: login em aba nova). */
async function ensureCsrf() {
  if (!csrfToken()) await fetch('/api/system/version', { credentials: 'same-origin' })
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined

/**
 * Sessão vencida com a tela aberta: em vez de mandar para o login (e perder o que foi digitado), a tela abre o
 * login por cima e o pedido que falhou é repetido. Registrado pelo layout logado; sem ele, vai para o login.
 */
type ReauthHandler = () => Promise<boolean>
let reauthHandler: ReauthHandler | null = null
let reauthing: Promise<boolean> | null = null
export function setReauthHandler(fn: ReauthHandler | null) {
  reauthHandler = fn
}
async function reauth() {
  if (!reauthHandler) return false
  reauthing ??= reauthHandler().finally(() => setTimeout(() => (reauthing = null), 0))
  return reauthing
}

/**
 * Sessão que caiu numa consulta que não renova sozinha (/auth/me): tenta renovar e, se não der, abre o login
 * por cima da tela. true = sessão de volta.
 */
export async function recoverSession() {
  const r = await refreshSession()
  if (r === 'ok') return true
  return r === 'denied' ? reauth() : false
}

/** Mensagens padrão (em inglês) do servidor e do framework: viram uma explicação em português pelo código. */
const ENGLISH = /^(throttlerexception|unauthorized|forbidden|not found|bad request|internal server error|conflict|unprocessable|request entity too large|payload too large|cannot (get|post|put|patch|delete)\b|too many requests|service unavailable|gateway)|\b(must be|should not|should be|must not|is not allowed|is not a valid|has failed|property \S+ should not exist|each value in)\b/i
const STATUS_MESSAGE: Record<number, string> = {
  400: 'Confira os dados informados: algum campo está inválido ou faltando.',
  401: 'Sua sessão expirou. Entre de novo para continuar.',
  403: 'Seu perfil não tem permissão para isso. Se precisar, fale com o administrador.',
  404: 'Não encontrado: o registro pode ter sido excluído por outra pessoa ou o endereço mudou.',
  409: 'Este registro foi alterado por outra pessoa enquanto você editava. Recarregue a tela e tente de novo.',
  413: 'O arquivo ou o conteúdo é grande demais. Envie um menor.',
  422: 'Confira os dados informados.',
  429: 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.',
}
export function friendlyMessage(status: number, message: string | undefined) {
  const m = (message ?? '').trim()
  if (m && !ENGLISH.test(m)) return m
  return STATUS_MESSAGE[status] ?? (status >= 500 ? 'Erro inesperado no servidor. Tente de novo; se continuar, avise o TI.' : 'Não foi possível concluir. Tente de novo.')
}

async function request<T>(method: string, path: string, body?: Body, retry = true): Promise<T> {
  if (method !== 'GET') await ensureCsrf()
  const isForm = body instanceof FormData
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}),
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...appHeader(),
      },
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(503, UNAVAILABLE_MESSAGE)
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const r = await refreshSession()
    if (r === 'ok') return request<T>(method, path, body, false)
    if (r === 'unavailable') throw new ApiError(503, UNAVAILABLE_MESSAGE)
    if (await reauth()) return request<T>(method, path, body, false)
    window.dispatchEvent(new Event('crm:session-expired'))
  }
  // Proxy sem resposta da API (502/503/504): servidor reiniciando, não é erro do usuário.
  if (res.status >= 502 && res.status <= 504) throw new ApiError(res.status, UNAVAILABLE_MESSAGE)

  const text = await res.text()
  let data: { message?: string | string[]; code?: string } | null = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    if (!res.ok) throw new ApiError(res.status, friendlyMessage(res.status, undefined))
    throw new ApiError(500, 'Resposta inválida do servidor.')
  }
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message[0] : data?.message
    throw new ApiError(res.status, friendlyMessage(res.status, message), data?.code)
  }
  return data as T
}

/** Nome do arquivo que o servidor sugere (Content-Disposition), com acentos. */
function fileNameOf(res: Response) {
  const cd = res.headers.get('content-disposition') ?? ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (star) {
    try {
      return decodeURIComponent(star[1]!)
    } catch {
      // segue para o nome simples
    }
  }
  return /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? null
}

/**
 * Baixa um arquivo da API (CSV, PDF, Excel) com as mesmas regras dos outros pedidos: renova a sessão, abre o
 * login por cima se ela venceu e explica o erro em português. O navegador salva com o nome do servidor ou o informado.
 */
async function download(path: string, fallbackName: string, init: { method?: string; body?: Body } = {}, retry = true): Promise<void> {
  const method = init.method ?? 'GET'
  if (method !== 'GET') await ensureCsrf()
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...appHeader() },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(503, UNAVAILABLE_MESSAGE)
  }
  if (res.status === 401 && retry) {
    const r = await refreshSession()
    if (r === 'ok' || (r === 'denied' && (await reauth()))) return download(path, fallbackName, init, false)
    if (r === 'unavailable') throw new ApiError(503, UNAVAILABLE_MESSAGE)
    window.dispatchEvent(new Event('crm:session-expired'))
  }
  if (res.status >= 502 && res.status <= 504) throw new ApiError(res.status, UNAVAILABLE_MESSAGE)
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null
    throw new ApiError(res.status, friendlyMessage(res.status, Array.isArray(data?.message) ? data.message[0] : data?.message))
  }
  const url = URL.createObjectURL(await res.blob())
  Object.assign(document.createElement('a'), { href: url, download: fileNameOf(res) ?? fallbackName }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body),
  put: <T>(path: string, body?: Body) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: Body) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  download,
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return ENGLISH.test(err.message) ? 'Erro inesperado. Tente novamente.' : err.message
  return 'Erro inesperado. Tente novamente.'
}
