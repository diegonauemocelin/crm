import { ClockAlertIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

/**
 * O código do 2FA depende da hora certa no celular e no servidor. Compara o relógio do servidor com o
 * deste computador e avisa quando a diferença passa de 30 s (aí códigos certos podem ser recusados).
 */
export function ClockWarning() {
  const [offset, setOffset] = useState<number | null>(null)
  useEffect(() => {
    const t0 = Date.now()
    api
      .get<{ now: number }>('/system/time')
      .then((r) => {
        const t1 = Date.now()
        setOffset(Math.round((r.now - (t0 + t1) / 2) / 1000))
      })
      .catch(() => undefined)
  }, [])
  if (offset === null || Math.abs(offset) < 30) return null
  const abs = Math.abs(offset)
  const amount = abs >= 120 ? `${Math.round(abs / 60)} minutos` : `${abs} segundos`
  return (
    <p role="alert" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
      <ClockAlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>
        O relógio do servidor está {amount} {offset > 0 ? 'adiantado' : 'atrasado'} em relação a este computador. Se o código for recusado, confira se o celular está com data e hora automáticas e avise o administrador para acertar a hora do servidor.
      </span>
    </p>
  )
}
