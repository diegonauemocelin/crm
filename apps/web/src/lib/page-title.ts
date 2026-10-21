import { useEffect, useSyncExternalStore } from 'react'

/**
 * Nome do registro aberto (ex.: o lead "João Silva") para o caminho no topo e o título da aba do navegador.
 * A tela de detalhe chama `usePageTitle(nome)`; ao sair dela, o nome some sozinho.
 */
let current: { path: string; title: string } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return
    const path = window.location.pathname
    current = { path, title }
    emit()
    return () => {
      if (current?.path === path) current = null
      emit()
    }
  }, [title])
}

export function useCurrentPageTitle(pathname: string) {
  const v = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  )
  return v && v.path === pathname ? v.title : null
}
