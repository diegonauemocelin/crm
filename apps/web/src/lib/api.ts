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

/** "unavailable": servidor fora do ar (reiniciando no deploy) — a sessão continua valendo, não é para ir ao login. */
type RefreshResult = 'ok' | 'denied' | 'unavailable'
let refreshing: Promise<RefreshResult> | null = null

async function refreshSession(): Promise<RefreshResult> {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken() },
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
    window.dispatchEvent(new Event('crm:session-expired'))
  }
  // Proxy sem resposta da API (502/503/504): servidor reiniciando, não é erro do usuário.
  if (res.status >= 502 && res.status <= 504) throw new ApiError(res.status, UNAVAILABLE_MESSAGE)

  const text = await res.text()
  let data: { message?: string | string[]; code?: string } | null = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    if (!res.ok) throw new ApiError(res.status, 'Erro inesperado. Tente novamente.')
    throw new ApiError(500, 'Resposta inválida do servidor.')
  }
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Erro inesperado. Tente novamente.')
    throw new ApiError(res.status, res.status === 429 && message.startsWith('ThrottlerException') ? 'Muitas tentativas. Aguarde um minuto.' : message, data?.code)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body),
  put: <T>(path: string, body?: Body) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: Body) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro inesperado. Tente novamente.'
}
