import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Loader2Icon, LockIcon } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { api, errorMessage, setReauthHandler } from '@/lib/api'
import { useAuth } from '@/lib/auth'

/**
 * Sessão venceu com a tela aberta (ex.: computador parado): abre o login por cima, sem sair da tela.
 * O que estava digitado continua no lugar e o pedido que falhou é repetido depois de entrar.
 */
export function ReauthDialog() {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'senha' | 'codigo'>('senha')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)
  const email = me?.email ?? ''

  useEffect(() => {
    if (!email) return
    setReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve
          setStep('senha')
          setPassword('')
          setCode('')
          setError(null)
          setOpen(true)
        }),
    )
    return () => setReauthHandler(null)
  }, [email])

  const done = (ok: boolean) => {
    setOpen(false)
    resolver.current?.(ok)
    resolver.current = null
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ status: string }>('/auth/login', { email, password })
      if (r.status === 'mfa_required') {
        setStep('codigo')
        setPassword('')
      } else done(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/2fa/verify', { code: value })
      done(true)
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
      if (errorMessage(err).includes('expirada')) setStep('senha')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        // O e-mail já vem preenchido: o cursor começa na senha.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          document.getElementById('reauth-senha')?.focus()
        }}
        className="sm:max-w-sm"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockIcon className="size-4" /> Sua sessão expirou
          </DialogTitle>
          <DialogDescription>Por segurança, entre de novo para continuar. O que você estava fazendo nesta tela foi mantido.</DialogDescription>
        </DialogHeader>
        {step === 'senha' ? (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reauth-email">E-mail</Label>
              <Input id="reauth-email" value={email} readOnly tabIndex={-1} className="bg-muted" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reauth-senha">Senha</Label>
              <Input id="reauth-senha" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => done(false)}>
                Sair do sistema
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2Icon className="animate-spin" />} Entrar e continuar
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Digite o código de 6 dígitos do aplicativo autenticador.</p>
            <InputOTP maxLength={6} pattern={REGEXP_ONLY_DIGITS} value={code} onChange={setCode} onComplete={verify} disabled={busy} autoFocus aria-label="Código de verificação">
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
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => done(false)}>
                Sair do sistema
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
