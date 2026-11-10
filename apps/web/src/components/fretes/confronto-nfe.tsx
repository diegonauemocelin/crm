import { AlertTriangleIcon, CheckCircle2Icon, MinusCircleIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { money } from '@/lib/format'
import { fmtNum, NFE_CHECK_STATUS, type NfeCheck, type NfeConfront } from '@/lib/fretes'
import { cn } from '@/lib/utils'

const show = (code: NfeCheck['code'], v: string | number | null) => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return code === 'VALOR' || code === 'FRETE' ? money(v) : code === 'PESO' ? `${fmtNum(v, 3)} kg` : fmtNum(v, 0)
  if (/^\d{14}$/.test(v)) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  return v
}

/** Confronto NF-e × CT-e: cada conferência com o valor da nota e o do CT-e. */
export function NfeConfrontView({ c }: { c: NfeConfront }) {
  const st = NFE_CHECK_STATUS[c.status]
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={st.className}>
          {st.label}
        </Badge>
        {c.notes.length > 0 && <span className="text-xs text-muted-foreground">{c.notes.map((n) => `NF ${n.number ?? n.key.slice(25, 34)}${n.found ? '' : ' (não importada)'}`).join(' · ')}</span>}
      </div>
      {c.status === 'SEM_NOTA' && <p className="text-xs text-muted-foreground">Importe o XML da nota em Fretes › Pedidos para conferir peso, valor, volumes e destino.</p>}
      {c.checks.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">Conferência</th>
              <th className="py-1 text-right font-normal">NF-e</th>
              <th className="py-1 text-right font-normal">CT-e</th>
            </tr>
          </thead>
          <tbody>
            {c.checks.map((k) => (
              <tr key={k.code} className="border-t align-top">
                <td className="py-1 pr-2">
                  <span className="inline-flex items-start gap-1">
                    {k.status === 'OK' ? (
                      <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-[#006300] dark:text-[#0ca30c]" aria-label="confere" />
                    ) : k.status === 'DIVERGENTE' ? (
                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-label="diverge" />
                    ) : (
                      <MinusCircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="sem dado" />
                    )}
                    <span>
                      {k.name}
                      {k.label && <span className={cn('block', k.status === 'DIVERGENTE' ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{k.label}</span>}
                    </span>
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums">{show(k.code, k.nfe)}</td>
                <td className="py-1 text-right tabular-nums">{show(k.code, k.cte)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
