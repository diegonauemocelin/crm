import { Link } from 'react-router'
import { money } from '@/lib/format'
import { fmtNum, type QuoteResult } from '@/lib/fretes'
import { cn } from '@/lib/utils'

/** Composição do preço de uma opção: componentes com a fórmula, ICMS, regra usada, pesos e avisos. */
export function ResultDetail({ r }: { r: QuoteResult }) {
  return (
    <div className="grid gap-4 py-2 md:grid-cols-2">
      <div>
        {r.reason && <p className="mb-2 text-sm">{r.reason}</p>}
        {r.components.length > 0 && (
          <table className="w-full text-sm">
            <tbody>
              {r.components.map((c) => (
                <tr key={c.code} className={cn('border-b last:border-0', c.skipped && 'text-muted-foreground')}>
                  <td className="py-1 pr-2">
                    {c.name}
                    {c.skipped && <span className="ml-1 text-xs">(não incide)</span>}
                    {!c.inTax && <span className="ml-1 text-xs text-muted-foreground">(fora do ICMS)</span>}
                    <span className="block font-mono text-[11px] text-muted-foreground">{c.formula}</span>
                  </td>
                  <td className="py-1 text-right tabular-nums">{money(c.value)}</td>
                </tr>
              ))}
              {r.icms && (
                <tr className="border-b">
                  <td className="py-1 pr-2">
                    ICMS {r.icms.rate !== null ? `${fmtNum(r.icms.rate, 2)}%` : ''} <span className="text-xs text-muted-foreground">({r.icms.mode === 'SOMADO' ? 'por dentro, somado' : r.icms.mode === 'INFORMATIVO' ? 'destacado, fora do total' : 'não incide'}; base {money(r.icms.base)})</span>
                  </td>
                  <td className="py-1 text-right tabular-nums">{money(r.icms.value)}</td>
                </tr>
              )}
              {r.total !== null && (
                <tr className="font-semibold">
                  <td className="py-1">Total</td>
                  <td className="py-1 text-right tabular-nums">{money(r.total)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="space-y-1 text-sm">
        {r.rule && <p>Regra usada: {r.rule.label}</p>}
        {r.weights && (
          <p>
            Peso real {fmtNum(r.weights.real)} kg · cubado {fmtNum(r.weights.cubed)} kg · taxado {fmtNum(r.weights.taxed)} kg
          </p>
        )}
        {r.warnings.map((w, i) => (
          <p key={i} className="text-amber-700 dark:text-amber-300">
            {w}
          </p>
        ))}
        {r.tableId && (
          <Link className="text-xs underline underline-offset-2 print:hidden" to={`/fretes/tabelas/${r.tableId}`}>
            Abrir a tabela
          </Link>
        )}
      </div>
    </div>
  )
}
