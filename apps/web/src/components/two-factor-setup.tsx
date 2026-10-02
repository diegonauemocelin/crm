import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { CheckIcon, CopyIcon, DownloadIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { Skeleton } from '@/components/ui/skeleton'
import { api, errorMessage } from '@/lib/api'
import { useBranding } from '@/lib/branding'

interface SetupData {
  secret: string
  qrDataUrl: string
}

/** Passo a passo do 2FA: QR code → confirmação do código → códigos de recuperação. */
export function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const branding = useBranding()
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api
      .post<SetupData>('/auth/2fa/setup')
      .then(setSetup)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  const confirm = async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code: value })
      setRecovery(res.recoveryCodes)
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  if (recovery) {
    const text = `Códigos de recuperação - ${branding.appName}\nCada código funciona uma única vez.\n\n${recovery.join('\n')}\n`
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Guarde estes códigos em local seguro.</p>
          <p className="mt-1 text-muted-foreground">
            Se perder o celular, cada código permite entrar uma única vez. Eles não serão exibidos novamente.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-4 font-mono text-sm" aria-label="Códigos de recuperação">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(text)
              setCopied(true)
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copiados' : 'Copiar'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
              const a = Object.assign(document.createElement('a'), { href: url, download: 'codigos-recuperacao.txt' })
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <DownloadIcon />
            Baixar .txt
          </Button>
        </div>
        <Button className="w-full" onClick={onDone}>
          Já guardei os códigos
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Instale um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…).</li>
        <li>Escaneie o QR code abaixo com o aplicativo.</li>
        <li>Digite o código de 6 dígitos que aparecer.</li>
      </ol>
      <div className="flex flex-col items-center gap-3 rounded-lg border p-4">
        {setup ? (
          <img src={setup.qrDataUrl} alt="QR code para configurar o autenticador" className="size-44 rounded bg-white p-1" />
        ) : (
          <Skeleton className="size-44" />
        )}
        {setup && (
          <details className="w-full text-center text-xs text-muted-foreground">
            <summary className="cursor-pointer">Não consegue escanear? Digite a chave manualmente</summary>
            <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-foreground">{setup.secret}</code>
          </details>
        )}
      </div>
      <div className="flex flex-col items-center gap-2">
        <InputOTP maxLength={6} pattern={REGEXP_ONLY_DIGITS} value={code} onChange={setCode} onComplete={confirm} disabled={busy || !setup} aria-label="Código do autenticador">
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
        {busy && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Verificando" />}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
