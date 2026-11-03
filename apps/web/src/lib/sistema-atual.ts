import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from './auth'
import { findNavItem, visibleNavigation } from './navigation'
import { sistemaDoGrupo, sistemasVisiveis } from './sistemas'

const ULTIMO_KEY = 'crm-sistema'
const DIRETO_KEY = 'crm-sistema-direto'

/** Preferências do visual "Por sistema" (deste navegador): o último sistema usado e se entra direto nele. */
export const prefsSistema = {
  ultimo(): string | null {
    try {
      return localStorage.getItem(ULTIMO_KEY)
    } catch {
      return null
    }
  },
  direto(): boolean {
    try {
      return localStorage.getItem(DIRETO_KEY) === '1'
    } catch {
      return false
    }
  },
  setDireto(v: boolean) {
    try {
      localStorage.setItem(DIRETO_KEY, v ? '1' : '0')
    } catch {
      // navegador sem armazenamento: vale só nesta tela
    }
  },
  setUltimo(id: string) {
    try {
      localStorage.setItem(ULTIMO_KEY, id)
    } catch {
      // idem
    }
  },
}

/** Menu da pessoa, os sistemas dela e o sistema aberto (o da tela atual; fora do menu, o último usado). */
export function useSistemaAtual() {
  const { can, me } = useAuth()
  const { pathname, search } = useLocation()
  const grupos = visibleNavigation(can, !!me?.role.isSystem)
  const sistemas = sistemasVisiveis(grupos)
  const daRota = sistemaDoGrupo(findNavItem(pathname, search)?.group.title)
  useEffect(() => {
    if (daRota) prefsSistema.setUltimo(daRota)
  }, [daRota])
  const guardado = prefsSistema.ultimo()
  const atual = daRota ?? (sistemas.some((s) => s.id === guardado) ? guardado : (sistemas[0]?.id ?? null))
  return { grupos, sistemas, atual }
}
