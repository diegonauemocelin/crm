import { useQuery } from '@tanstack/react-query'
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { api, errorMessage } from '@/lib/api'
import { AuthLayout, FormError } from './auth/auth-layout'

/** Descadastro de e-mail marketing em 1 clique (link presente em todos os e-mails). Não exige login. */
export function UnsubscribePage() {
  const { token = '' } = useParams()
  const info = useQuery({ queryKey: ['descadastro', token], queryFn: () => api.get<{ email: string | null; subscribed: boolean }>(`/public/descadastro/${encodeURIComponent(token)}`), retry: false })
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/public/descadastro/${encodeURIComponent(token)}`)
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (info.isLoading) {
    return (
      <AuthLayout title="Descadastro">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </AuthLayout>
    )
  }
  if (info.error) {
    return (
      <AuthLayout title="Link inválido" subtitle="Este link de descadastro não é válido. Use o link do e-mail mais recente que você recebeu." >
        <span />
      </AuthLayout>
    )
  }
  if (done || info.data?.subscribed === false) {
    return (
      <AuthLayout title="Descadastro confirmado" subtitle={`${info.data?.email ?? 'Seu e-mail'} não receberá mais nossos e-mails de marketing.`}>
        <p className="flex gap-2 rounded-md border bg-muted/50 p-3 text-sm">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          Pronto. Se mudar de ideia, basta se cadastrar novamente em um de nossos formulários.
        </p>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title="Não quer mais receber nossos e-mails?" subtitle={`Confirme para descadastrar ${info.data?.email ?? 'seu e-mail'} das nossas comunicações de marketing.`}>
      <div className="space-y-4">
        <Button className="w-full" onClick={confirm} disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" />}
          Confirmar descadastro
        </Button>
        <FormError message={error} />
      </div>
    </AuthLayout>
  )
}
