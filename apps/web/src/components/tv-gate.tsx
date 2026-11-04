import { useQuery } from '@tanstack/react-query'
import { LockIcon, Loader2Icon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, ApiError, errorMessage, setTvKey } from '@/lib/api'

const storageKey = (token: string) => `crm-tv-key:${token}`

function readKey(token: string) {
  try {
    return localStorage.getItem(storageKey(token))
  } catch {
    return null
  }
}

function saveKey(token: string, key: string | null) {
  try {
    if (key) localStorage.setItem(storageKey(token), key)
    else localStorage.removeItem(storageKey(token))
  } catch {
    /* sem armazenamento: vale enquanto a aba estiver aberta */
  }
}

/**
 * Porta do painel da TV: quando o link tem senha, pede uma vez e guarda a liberação neste navegador (90 dias, ou até a
 * senha mudar). Confere de novo a cada 10 minutos: senha trocada ou link cancelado voltam para esta tela.
 */
export function TvGate({ token, children }: { token: string; children: ReactNode }) {
  const [key, setKey] = useState(() => {
    const k = readKey(token)
    setTvKey(k)
    return k
  })
  const status = useQuery({
    queryKey: ['tv-acesso', token, key],
    queryFn: () => api.direct.get<{ needsPin: boolean; ok: boolean; name: string }>(`/tv/acesso/${encodeURIComponent(token)}`),
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: true,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 5,
  })
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  if (status.error && !status.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-center">
        <p className="max-w-md text-lg">{errorMessage(status.error)}</p>
      </div>
    )
  }
  if (!status.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2Icon className="size-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }
  if (status.data.ok) return <>{children}</>

  const submit = async () => {
    setSending(true)
    setError(null)
    try {
      const r = await api.direct.post<{ key: string | null }>(`/tv/acesso/${encodeURIComponent(token)}`, { pin })
      saveKey(token, r.key)
      setTvKey(r.key)
      setPin('')
      setKey(r.key)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border p-6 text-center"
        onSubmit={(e) => {
          e.preventDefault()
          if (pin) void submit()
        }}
      >
        <LockIcon className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{status.data.name}</h1>
          <p className="text-sm text-muted-foreground">Digite a senha do painel. Este navegador fica liberado e não pede de novo.</p>
        </div>
        <Input type="password" autoFocus autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} aria-label="Senha do painel" className="h-12 text-center text-lg" maxLength={64} />
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        <Button type="submit" className="h-11 w-full" disabled={!pin || sending}>
          {sending && <Loader2Icon className="animate-spin" aria-hidden />} Abrir painel
        </Button>
      </form>
    </div>
  )
}
