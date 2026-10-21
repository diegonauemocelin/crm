import { useEffect } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Lista que lembra o último filtro: voltando pelo menu (endereço sem filtros), reaplica os da última visita
 * neste navegador. Filtros continuam no endereço (dá para mandar o link). Página e ordem não são lembradas.
 */
export function usePersistedSearch(key: string, ignore: string[] = ['page']) {
  const [params, setParams] = useSearchParams()
  const storageKey = `crm:filtros:${key}`
  const current = params.toString()

  useEffect(() => {
    if (current) return
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) setParams(new URLSearchParams(saved), { replace: true })
    } catch {
      // navegador sem armazenamento: segue sem lembrar
    }
    // Só ao abrir a tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      const p = new URLSearchParams(current)
      for (const k of ignore) p.delete(k)
      const v = p.toString()
      if (v) localStorage.setItem(storageKey, v)
      else localStorage.removeItem(storageKey)
    } catch {
      // idem
    }
  }, [current, storageKey, ignore])
}
