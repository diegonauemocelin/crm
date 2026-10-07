import { AlertTriangleIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'

/** Módulos em que o perfil pode ser "somente os próprios" (base do vendedor). */
const OWN_MODULES = ['leads', 'pre_vendas', 'pos_vendas']

/**
 * Perfil "somente os próprios" sem vendedor vinculado vê listas vazias sem saber por quê.
 * Este aviso explica e diz como resolver.
 */
export function SellerLinkWarning() {
  const { me } = useAuth()
  if (!me || me.role.isSystem || me.seller) return null
  const own = OWN_MODULES.some((m) => me.permissions[m]?.view && me.permissions[m]?.scope === 'OWN')
  if (!own) return null
  return (
    <p role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <span>
        Seu usuário ainda não está vinculado a um vendedor, então sua base aparece vazia. Peça ao administrador para vincular em{' '}
        <strong>Cadastros → Vendedores</strong> (ou cadastrar o vendedor com o mesmo e-mail do seu login: <strong>{me.email}</strong>).
      </span>
    </p>
  )
}
