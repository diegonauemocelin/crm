import { CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { AuthLayout, FormError } from './auth-layout'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ message: string }>('/auth/forgot-password', { email })
      setDone(res.message)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Recuperar senha" subtitle="Informe seu e-mail e enviaremos um link para criar uma nova senha.">
      {done ? (
        <div className="space-y-4">
          <p className="flex gap-2 rounded-md border bg-muted/50 p-3 text-sm">
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            {done}
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">Voltar para o login</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy || !email}>
            {busy && <Loader2Icon className="animate-spin" />}
            Enviar link
          </Button>
          <Link to="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
            Voltar para o login
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}

export function PasswordRules() {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
      <li>Pelo menos 12 caracteres (uma frase curta é ótima).</li>
      <li>Não pode conter seu e-mail nem sequências óbvias.</li>
    </ul>
  )
}

/** Usada tanto para recuperação de senha quanto para o convite de novos usuários. */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Link inválido" subtitle="Abra o link exatamente como recebido no e-mail ou solicite um novo.">
        <Button asChild className="w-full">
          <Link to="/esqueci-senha">Solicitar novo link</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Definir senha" subtitle="Crie sua senha de acesso.">
      {done ? (
        <div className="space-y-4">
          <p className="flex gap-2 rounded-md border bg-muted/50 p-3 text-sm">
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Senha definida com sucesso.
          </p>
          <Button asChild className="w-full">
            <Link to="/login">Ir para o login</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input id="password" type="password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirme a nova senha</Label>
            <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <PasswordRules />
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy || !password || !confirm}>
            {busy && <Loader2Icon className="animate-spin" />}
            Salvar senha
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
