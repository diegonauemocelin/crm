import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Loader2Icon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { AuthLayout, FormError } from './auth-layout'

type Step = 'credentials' | 'mfa' | 'recovery'

export function LoginPage() {
  const b = useBranding()
  const { me, refresh } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (me) return <Navigate to="/" replace />

  const finish = async () => {
    await refresh()
    navigate('/', { replace: true })
  }

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ status: string }>('/auth/login', { email, password })
      if (res.status === 'mfa_required') {
        setStep('mfa')
        setPassword('')
      } else {
        await finish()
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/2fa/verify', { code: value })
      await finish()
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
      if (errorMessage(err).includes('expirada')) setStep('credentials')
    } finally {
      setBusy(false)
    }
  }

  if (step === 'credentials') {
    return (
      <AuthLayout title={b.loginTitle} subtitle={b.loginSubtitle}>
        <form onSubmit={submitCredentials} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Senha</Label>
              <Link to="/esqueci-senha" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                Esqueci minha senha
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <FormError message={error} />
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy && <Loader2Icon className="animate-spin" />}
            Entrar
          </Button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Verificação em duas etapas"
      subtitle={
        step === 'mfa'
          ? 'Digite o código de 6 dígitos do seu aplicativo autenticador.'
          : 'Digite um dos códigos de recuperação que você guardou ao ativar o 2FA.'
      }
    >
      <div className="space-y-4">
        {step === 'mfa' ? (
          <InputOTP
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
            onChange={setCode}
            onComplete={submitCode}
            disabled={busy}
            autoFocus
            aria-label="Código de verificação"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitCode(code)
            }}
            className="space-y-3"
          >
            <Label htmlFor="recovery">Código de recuperação</Label>
            <Input id="recovery" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value.trim())} />
            <Button type="submit" className="w-full" disabled={busy || code.length < 10}>
              {busy && <Loader2Icon className="animate-spin" />}
              Verificar
            </Button>
          </form>
        )}
        <FormError message={error} />
        <div className="flex flex-col gap-1 text-sm">
          <button
            type="button"
            className="text-left text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => {
              setStep(step === 'mfa' ? 'recovery' : 'mfa')
              setCode('')
              setError(null)
            }}
          >
            {step === 'mfa' ? 'Perdi o acesso ao autenticador: usar código de recuperação' : 'Usar o código do aplicativo autenticador'}
          </button>
          <button
            type="button"
            className="text-left text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => {
              setStep('credentials')
              setCode('')
              setError(null)
            }}
          >
            Voltar para o login
          </button>
        </div>
      </div>
    </AuthLayout>
  )
}
