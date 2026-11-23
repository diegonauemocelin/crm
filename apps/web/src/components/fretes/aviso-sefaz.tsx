import { useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, WifiOffIcon } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Situation {
  state: 'OK' | 'INSTAVEL' | 'FORA' | 'ATRASADA'
  message: string
  since: string | null
  lastRunAt: string | null
}

const TITLE: Record<Exclude<Situation['state'], 'OK'>, string> = {
  FORA: 'SEFAZ fora do ar: a busca de CT-e está parada',
  INSTAVEL: 'SEFAZ instável: a última busca de CT-e falhou',
  ATRASADA: 'Busca de CT-e na SEFAZ atrasada',
}

/** Aviso no topo das telas de fretes quando a SEFAZ está fora do ar ou a busca de CT-e parou. Some sozinho quando volta. */
export function SefazNotice({ className }: { className?: string }) {
  const q = useQuery({ queryKey: ['fretes', 'sefaz-situacao'], queryFn: () => api.get<Situation>('/fretes/sefaz/situacao'), refetchInterval: 5 * 60_000, retry: false })
  const s = q.data
  if (!s || s.state === 'OK') return null
  const strong = s.state !== 'INSTAVEL'
  const Icon = s.state === 'FORA' ? WifiOffIcon : AlertTriangleIcon
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-lg border p-3 text-sm', strong ? 'border-destructive/40 bg-destructive/10' : 'border-amber-500/40 bg-amber-500/10', className)}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', strong ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')} aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold">{TITLE[s.state]}</p>
        <p className="text-muted-foreground">
          {s.message}
          {s.since ? ` Desde ${dateTime(s.since)}.` : ''} Os CT-es emitidos nesse período entram sozinhos quando a SEFAZ voltar; se tiver pressa, importe o XML à mão.
        </p>
      </div>
      <Link to="/fretes/filiais" className="shrink-0 text-sm font-medium underline-offset-4 hover:underline">
        Ver captura
      </Link>
    </div>
  )
}
