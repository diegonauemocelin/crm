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

let refreshing: Promise<boolean> | null = null

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken() },
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0))
  return refreshing
}

/** Garante que o cookie CSRF exista antes do primeiro POST (ex.: login em aba nova). */
async function ensureCsrf() {
  if (!csrfToken()) await fetch('/api/system/version', { credentials: 'same-origin' })
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined

async function request<T>(method: string, path: string, body?: Body, retry = true): Promise<T> {
  if (method !== 'GET') await ensureCsrf()
  const isForm = body instanceof FormData
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(method, path, body, false)
    window.dispatchEvent(new Event('crm:session-expired'))
  }

  const text = await res.text()
  const data = text ? JSON.parse(text) : null
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
