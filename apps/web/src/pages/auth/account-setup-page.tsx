import { Loader2Icon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { TwoFactorSetup } from '@/components/two-factor-setup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AuthLayout, FormError } from './auth-layout'
import { PasswordRules } from './password-pages'

/** Primeiro acesso: troca da senha provisória e/ou configuração do 2FA exigido pelo perfil. */
export function AccountSetupPage() {
  const { me, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // O total de passos é fixado na primeira renderização para o contador não "voltar" a 1 de 1 após a troca de senha.
  const [totalSteps] = useState(() => (me ? (me.mustChangePassword ? 1 : 0) + (me.pending2faSetup ? 1 : 0) : 0))

  if (!me) return <Navigate to="/login" replace />
  if (!me.mustChangePassword && !me.pending2faSetup) return <Navigate to="/" replace />

  const stepNumber = me.mustChangePassword ? 1 : totalSteps

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/me/password', { currentPassword: current, newPassword: next })
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <button
      type="button"
      className="mt-6 text-sm text-muted-foreground hover:text-foreground hover:underline"
      onClick={async () => {
        await logout()
        navigate('/login')
      }}
    >
      Sair
    </button>
  )

  if (me.mustChangePassword) {
    return (
      <AuthLayout title="Crie sua senha" subtitle={`Passo ${stepNumber} de ${totalSteps}: troque a senha provisória recebida.`}>
        <form onSubmit={changePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current">Senha provisória</Label>
            <Input id="current" type="password" autoComplete="current-password" required autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="next">Nova senha</Label>
            <Input id="next" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirme a nova senha</Label>
            <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <PasswordRules />
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy || !current || !next || !confirm}>
            {busy && <Loader2Icon className="animate-spin" />}
            Continuar
          </Button>
        </form>
        {footer}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Proteja sua conta"
      subtitle={`Passo ${stepNumber} de ${totalSteps}: seu perfil (${me.role.name}) exige verificação em duas etapas.`}
    >
      <TwoFactorSetup
        onDone={async () => {
          await refresh()
          navigate('/', { replace: true })
        }}
      />
      {footer}
    </AuthLayout>
  )
}
