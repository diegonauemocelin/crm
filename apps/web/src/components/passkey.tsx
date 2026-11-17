import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { FingerprintIcon, Loader2Icon, ScanFaceIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { api, errorMessage } from '@/lib/api'

/** Este aparelho já tem o Face ID / digital ativado no CRM (só para mostrar o botão em destaque no login). */
const FLAG = 'crm-passkey'
const flag = {
  get: () => {
    try {
      return localStorage.getItem(FLAG) === '1'
    } catch {
      return false
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(FLAG, '1')
      else localStorage.removeItem(FLAG)
    } catch {
      // sem armazenamento: o botão aparece igual
    }
  },
}

const isApple = () => /iPhone|iPad|Macintosh/i.test(navigator.userAgent)
export const biometricName = () => (isApple() ? 'Face ID' : 'digital')

/** O aparelho tem biometria que serve de chave de acesso (Face ID, Touch ID, digital do Android, Windows Hello). */
export function usePasskeyAvailable() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    if (!browserSupportsWebAuthn()) return
    void platformAuthenticatorIsAvailable()
      .then(setOk)
      .catch(() => setOk(false))
  }, [])
  return ok
}

/** Cancelado pela pessoa (fechou o Face ID): não é erro para mostrar. */
const cancelled = (e: unknown) => (e as Error)?.name === 'NotAllowedError' || (e as Error)?.name === 'AbortError'

/** Entrar com Face ID / digital: a pessoa só olha para o celular. */
export function PasskeyLoginButton({ onDone, onError }: { onDone: () => void | Promise<void>; onError?: (msg: string) => void }) {
  const available = usePasskeyAvailable()
  const [busy, setBusy] = useState(false)
  if (!available) return null
  const go = async () => {
    setBusy(true)
    try {
      const { options, handle } = await api.post<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; handle: string }>('/auth/passkey/login/options')
      const response = await startAuthentication({ optionsJSON: options })
      await api.post('/auth/passkey/login', { handle, response })
      flag.set(true)
      await onDone()
    } catch (e) {
      if (!cancelled(e)) onError?.(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const Icon = isApple() ? ScanFaceIcon : FingerprintIcon
  return (
    <Button type="button" variant={flag.get() ? 'default' : 'outline'} className="w-full" disabled={busy} onClick={() => void go()}>
      {busy ? <Loader2Icon className="animate-spin" /> : <Icon />} Entrar com {biometricName()}
    </Button>
  )
}

interface PasskeyRow {
  id: string
  deviceName: string
  createdAt: string
  lastUsedAt: string | null
}

/** Conta: ativar o Face ID / digital neste aparelho e ver (ou tirar) os aparelhos ativados. */
export function PasskeySection() {
  const available = usePasskeyAvailable()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const list = useQuery({ queryKey: ['passkeys'], queryFn: () => api.get<PasskeyRow[]>('/auth/passkeys') })
  const add = useMutation({
    mutationFn: async () => {
      const { options, handle } = await api.post<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; handle: string }>('/auth/passkeys/options')
      const response = await startRegistration({ optionsJSON: options })
      return api.post('/auth/passkeys', { handle, response })
    },
    onSuccess: () => {
      flag.set(true)
      toast.success(`${biometricName()} ativado: da próxima vez, é só olhar para o celular (ou tocar no sensor).`)
      void qc.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: (e) => {
      if (cancelled(e)) return
      toast.error(/excluded|InvalidStateError/i.test(String((e as Error)?.name) + String((e as Error)?.message)) ? 'Este aparelho já está ativado.' : errorMessage(e))
    },
  })
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/passkeys/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['passkeys'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const Icon = isApple() ? ScanFaceIcon : FingerprintIcon
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <Icon className="size-4" /> Entrar com {biometricName()}
      </span>
      <p className="text-muted-foreground">
        Sem digitar a senha: quando a sessão cair, o app pede só o {biometricName()} deste aparelho. A chave fica guardada no aparelho e só abre com o seu rosto ou a sua digital.
      </p>
      {available ? (
        <Button size="sm" variant="outline" disabled={add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? <Loader2Icon className="animate-spin" /> : <Icon />} Ativar neste aparelho
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Este aparelho não tem Face ID, Touch ID ou digital disponível para isso.</p>
      )}
      {!!list.data?.length && (
        <ul className="divide-y rounded-md border">
          {list.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                {p.deviceName}
                <span className="block text-xs text-muted-foreground">
                  ativado em {new Date(p.createdAt).toLocaleDateString('pt-BR')}
                  {p.lastUsedAt ? ` · último uso ${new Date(p.lastUsedAt).toLocaleDateString('pt-BR')}` : ''}
                </span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Tirar ${p.deviceName}`}
                disabled={del.isPending}
                onClick={async () => {
                  if (await confirm({ title: `Tirar o ${p.deviceName}?`, description: 'Esse aparelho volta a pedir a senha.', confirmLabel: 'Tirar' })) del.mutate(p.id)
                }}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
