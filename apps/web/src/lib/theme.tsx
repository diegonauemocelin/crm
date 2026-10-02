import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { ThemeMode } from './types'

interface ThemeContextValue {
  theme: ThemeMode
  resolved: 'light' | 'dark'
  setTheme: (t: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'crm-theme'

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'LIGHT' || v === 'DARK' || v === 'SYSTEM') return v
  } catch {
    /* armazenamento indisponível: usa o padrão */
  }
  return 'SYSTEM'
}

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** O tema escolhido fica salvo no perfil do usuário (servidor) e também localmente, para a tela de login. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readStored)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = theme === 'SYSTEM' ? (systemDark ? 'dark' : 'light') : theme === 'DARK' ? 'dark' : 'light'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.style.colorScheme = resolved
  }, [resolved])

  const setTheme = (t: ThemeMode) => {
    setThemeState(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignora */
    }
  }

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme fora do ThemeProvider')
  return ctx
}
