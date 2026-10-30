import { useQuery } from '@tanstack/react-query'
import { BellIcon, DownloadIcon, FileBarChartIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { FilialSwitch } from '@/components/fretes/filial-switch'
import { Can, EmptyState, ErrorState, PageHeader, RequirePermission, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { money, num, pct, todaySP } from '@/lib/format'
import { fmtNum, useActiveUnit } from '@/lib/fretes'
import { AlertList, type FreightAlert } from './painel'

type ColType = 'text' | 'money' | 'int' | 'pct' | 'date' | 'num'

interface Report {
  title: string
  description: string
  columns: { key: string; label: string; type: ColType }[]
  rows: Record<string, string | number | null>[]
}

/** Relatórios que olham um período de CT-es (os demais são uma foto da situação atual). */
const PERIOD_FREE = new Set(['tabelas'])
/** Módulo que libera cada relatório (o mesmo que a API confere). */
const MODULE: Record<string, string> = { faturas: 'fretes_financeiro', tabelas: 'fretes_tabelas' }

const cell = (v: string | number | null | undefined, t: ColType) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  if (t === 'money') return money(v)
  if (t === 'pct') return pct(v)
  if (t === 'int') return num(v)
  if (t === 'num') return fmtNum(v, 2)
  return String(v)
}

export function FretesRelatoriosPage() {
  return (
    <RequirePermission module="fretes_cte">
      <Reports />
    </RequirePermission>
  )
}

function Reports() {
  const active = useActiveUnit()
  const [params, setParams] = useSearchParams()
  const key = params.get('relatorio') ?? 'transportadoras'
  const [from, setFrom] = useState(todaySP(-89))
  const [to, setTo] = useState(todaySP())
  const list = useQuery({ queryKey: ['fretes', 'relatorios'], queryFn: () => api.get<{ key: string; title: string }[]>('/fretes/relatorios') })
  const qs = new URLSearchParams({ de: from, ate: to, ...(active.unitId ? { filial: active.unitId } : {}) })
  const r = useQuery({ queryKey: ['fretes', 'relatorio', key, qs.toString()], queryFn: () => api.get<Report>(`/fretes/relatorios/${key}?${qs}`), enabled: !!active.ctx.data })
  const totals = r.data?.columns.filter((c) => c.type === 'money' || c.type === 'int').map((c) => ({ key: c.key, type: c.type, sum: r.data!.rows.reduce((s, row) => s + (typeof row[c.key] === 'number' ? (row[c.key] as number) : 0), 0) }))
  const showTotals = !!r.data?.rows.length && ['transportadoras', 'filiais', 'ufs', 'mensal', 'divergencias'].includes(key)
  return (
    <div className="space-y-4">
      <PageHeader
        title="Relatórios de frete"
        description="Calculados dos CT-es, pedidos, faturas e tabelas cadastradas. Exporte em CSV para abrir no Excel."
        actions={
          <>
            <Select value={key} onValueChange={(v) => setParams({ relatorio: v })}>
              <SelectTrigger className="w-72" aria-label="Relatório">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.data?.map((x) => (
                  <SelectItem key={x.key} value={x.key}>
                    {x.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!PERIOD_FREE.has(key) && (
              <>
                <Input type="date" className="w-40" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="date" className="w-40" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
            <FilialSwitch active={active} />
            <Can module={MODULE[key] ?? 'fretes_cte'} action="export">
              <Button variant="outline" onClick={() => api.download(`/fretes/relatorios/${key}/csv?${qs}`, `fretes-${key}.csv`).catch((e) => toast.error(errorMessage(e)))}>
                <DownloadIcon aria-hidden /> CSV
              </Button>
            </Can>
          </>
        }
      />
      {r.isLoading ? (
        <TableSkeleton />
      ) : r.error || !r.data ? (
        <ErrorState error={r.error} onRetry={() => r.refetch()} />
      ) : (
        <>
          <div>
            <h2 className="font-semibold">{r.data.title}</h2>
            <p className="text-sm text-muted-foreground">{r.data.description}</p>
          </div>
          {!r.data.rows.length ? (
            <EmptyState icon={FileBarChartIcon} title="Sem dados" description="Nada no período e na filial escolhidos." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {r.data.columns.map((c) => (
                    <TableHead key={c.key} className={c.type === 'text' ? undefined : 'text-right'}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.data.rows.map((row, i) => (
                  <TableRow key={i}>
                    {r.data!.columns.map((c) => (
                      <TableCell key={c.key} className={c.type === 'text' ? 'text-sm' : 'text-right tabular-nums'}>
                        {cell(row[c.key], c.type)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {showTotals && (
                  <TableRow className="font-semibold">
                    {r.data.columns.map((c, i) => {
                      const t = totals?.find((x) => x.key === c.key)
                      return (
                        <TableCell key={c.key} className={c.type === 'text' ? undefined : 'text-right tabular-nums'}>
                          {i === 0 ? 'Total' : t ? cell(t.sum, t.type) : ''}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  )
}

export function FretesAlertasPage() {
  return (
    <RequirePermission module="fretes_painel">
      <Alerts />
    </RequirePermission>
  )
}

function Alerts() {
  const q = useQuery({ queryKey: ['fretes', 'alertas'], queryFn: () => api.get<FreightAlert[]>('/fretes/alertas') })
  return (
    <div className="space-y-4">
      <PageHeader title="Alertas de frete" description="Tabelas vencendo, pedidos sem cotação ou sem CT-e, entregas atrasadas, CT-es divergentes, contestações paradas e faturas vencendo. Cada alerta abre a lista que o forma." />
      {q.isLoading ? <TableSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? <EmptyState icon={BellIcon} title="Nenhum alerta" description="Tudo em dia nas filiais que você acessa." /> : <AlertList alerts={q.data} />}
    </div>
  )
}
