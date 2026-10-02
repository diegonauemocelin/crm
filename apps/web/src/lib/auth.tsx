import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect } from 'react'
import { api, ApiError } from './api'
import { useTheme } from './theme'
import type { Action, Me } from './types'

interface AuthContextValue {
  me: Me | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  can: (module: string, action?: Action) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { setTheme } = useTheme()
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me')
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 60_000,
    retry: false,
  })

  // Tema salvo no perfil vale em qualquer computador em que o usuário entrar.
  useEffect(() => {
    if (data?.theme) setTheme(data.theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.theme])

  useEffect(() => {
    const onExpired = () => qc.setQueryData(['me'], null)
    window.addEventListener('crm:session-expired', onExpired)
    return () => window.removeEventListener('crm:session-expired', onExpired)
  }, [qc])

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['me'] })
  }, [qc])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      qc.clear()
      qc.setQueryData(['me'], null)
    }
  }, [qc])

  const can = useCallback(
    (module: string, action: Action = 'view') => {
      if (!data) return false
      if (data.role.isSystem) return true
      return data.permissions[module]?.[action] === true
    },
    [data],
  )

  return (
    <AuthContext.Provider value={{ me: data ?? null, loading: isLoading, refresh, logout, can }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
