import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Delta } from '@/components/atendimento/dashboard'
import { Button } from '@/components/ui/button'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dimLabel, formatValue, type ReportResult } from '@/lib/relatorios'
import { cn } from '@/lib/utils'

const MAX_SERIES = 5
const OTHER = '__outros__'

/**
 * Mostra o resultado de um relatório no formato escolhido (número, tabela ou gráfico).
 * Gráficos sempre têm a tabela ao lado (botão "Ver tabela"), e a série extra vira "Outros" (nunca uma cor nova).
 */
export function ReportView({ result, compact = false }: { result: ReportResult; compact?: boolean }) {
  const [showTable, setShowTable] = useState(false)
  const chart = result.config.chart
  if (chart === 'numero' || result.dimensions.length === 0) return <Numbers result={result} compact={compact} />
  if (result.rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Sem dados no período.</p>
  if (chart === 'tabela') return <ResultTable result={result} compact={compact} />
  return (
    <div className="space-y-2">
      <ResultChart result={result} compact={compact} />
      {result.metrics.length > 1 && !showTable && <p className="text-xs text-muted-foreground">O gráfico mostra "{result.metrics[0]!.label}"; as outras métricas estão na tabela.</p>}
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Esconder tabela' : 'Ver tabela'}
      </Button>
      {showTable && <ResultTable result={result} compact />}
    </div>
  )
}

function Numbers({ result, compact }: { result: ReportResult; compact: boolean }) {
  return (
    <div className={cn('grid gap-4', result.metrics.length > 1 && 'sm:grid-cols-2')}>
      {result.metrics.map((m, i) => (
        <div key={m.key} className="space-y-1">
          <p className="text-sm text-muted-foreground">{m.label}</p>
          <p className={cn('font-semibold tracking-tight tabular-nums', compact ? 'text-2xl' : 'text-4xl')}>{formatValue(result.totals[i], m.format)}</p>
          {result.previousTotals && <Delta now={result.totals[i] ?? null} before={result.previousTotals[i] ?? null} asPoints={m.format === 'pct'} />}
        </div>
      ))}
    </div>
  )
}

function ResultTable({ result, compact }: { result: ReportResult; compact: boolean }) {
  const hasList = result.dimensions.some((d) => d.list)
  return (
    <div className={cn('overflow-auto', compact && 'max-h-80')}>
      <Table>
        <TableHeader>
          <TableRow>
            {result.dimensions.map((d) => (
              <TableHead key={d.key}>{d.label}</TableHead>
            ))}
            {result.metrics.map((m) => (
              <TableHead key={m.key} className="text-right">
                {m.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, i) => (
            <TableRow key={i}>
              {row.dims.map((v, j) => (
                <TableCell key={j} className={cn('max-w-80 truncate', v === null && 'text-muted-foreground')} title={dimLabel(result.dimensions[j], v)}>
                  {dimLabel(result.dimensions[j], v)}
                </TableCell>
              ))}
              {row.values.map((v, j) => (
                <TableCell key={j} className="text-right tabular-nums">
                  {formatValue(v, result.metrics[j]!.format)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={result.dimensions.length} className="font-medium">
              Total do período{hasList ? ' (cada registro conta uma vez)' : ''}
            </TableCell>
            {result.totals.map((v, j) => (
              <TableCell key={j} className="text-right font-medium tabular-nums">
                {formatValue(v, result.metrics[j]!.format)}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

/** Converte as linhas em dados do gráfico: x = 1º campo; séries = valores do 2º campo (até 5 + "Outros"). */
function chartData(result: ReportResult) {
  const [d0, d1] = result.dimensions
  const metric = result.metrics[0]!
  if (!d1) {
    const data = result.rows.map((r) => ({ name: dimLabel(d0, r.dims[0] ?? null), s0: r.values[0] ?? 0 }))
    return { data, series: [{ key: 's0', label: metric.label }] }
  }
  const totals = new Map<string | null, number>()
  for (const r of result.rows) totals.set(r.dims[1] ?? null, (totals.get(r.dims[1] ?? null) ?? 0) + (r.values[0] ?? 0))
  const top = [...totals].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  const kept = top.slice(0, top.length > MAX_SERIES + 1 ? MAX_SERIES : MAX_SERIES + 1)
  const hasOther = top.length > kept.length
  const key = (v: string | null) => (kept.includes(v) ? `s${kept.indexOf(v)}` : OTHER)
  const byX = new Map<string, Record<string, string | number>>()
  // Taxas (%) não podem ser somadas em "Outros": nesse caso as séries extras ficam de fora.
  const sumOther = metric.format !== 'pct'
  for (const r of result.rows) {
    const x = r.dims[0] ?? null
    const name = dimLabel(d0, x)
    const row = byX.get(name) ?? { name }
    const k = key(r.dims[1] ?? null)
    if (k === OTHER && !sumOther) continue
    row[k] = Number(row[k] ?? 0) + (r.values[0] ?? 0)
    byX.set(name, row)
  }
  // Na ordem que vem do banco: por data quando o 1º campo é data, senão do maior para o menor.
  const data = [...byX.values()]
  const series = [...kept.map((v, i) => ({ key: `s${i}`, label: dimLabel(d1, v) })), ...(hasOther && sumOther ? [{ key: OTHER, label: 'Outros' }] : [])]
  return { data, series }
}

function ResultChart({ result, compact }: { result: ReportResult; compact: boolean }) {
  const metric = result.metrics[0]!
  const { data, series } = chartData(result)
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: s.key === OTHER ? 'var(--muted-foreground)' : `var(--chart-${i + 1})` }]))
  const fmt = (v: unknown) => formatValue(Number(v), metric.format, true)
  const tooltip = <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => <span className="flex w-full justify-between gap-3"><span className="text-muted-foreground">{config[String(n)]?.label}</span><span className="tabular-nums">{formatValue(Number(v), metric.format)}</span></span>} />} />
  const legend = series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null
  const stacked = series.length > 1 && metric.format !== 'pct'
  const chart = result.config.chart

  if (chart === 'barras') {
    const height = Math.max(120, data.length * (series.length > 1 ? 30 : 34) + (legend ? 48 : 16))
    return (
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: series.length > 1 ? 16 : 64, top: 0, bottom: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={compact ? 110 : 150} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)} />
          {tooltip}
          {legend}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId={stacked ? 'a' : undefined} fill={`var(--color-${s.key})`} stroke="var(--background)" strokeWidth={stacked ? 1 : 0} radius={stacked ? (i === series.length - 1 ? [0, 4, 4, 0] : 0) : [0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
              {series.length === 1 && <LabelList dataKey={s.key} position="right" className="fill-foreground" fontSize={12} formatter={fmt} />}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    )
  }

  const xAxis = <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tick={{ fontSize: 12 }} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
  const yAxis = <YAxis tickLine={false} axisLine={false} width={metric.format === 'brl' ? 72 : 44} tickFormatter={fmt} allowDecimals={metric.format !== 'int'} />
  const height = compact ? 'h-56' : 'h-72'

  if (chart === 'linha') {
    return (
      <ChartContainer config={config} className={cn('aspect-auto w-full', height)}>
        <LineChart data={data} margin={{ left: 0, right: 16, top: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={data.length <= 31 ? { r: 3 } : false} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={config} className={cn('aspect-auto w-full', height)}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 16 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        {xAxis}
        {yAxis}
        {tooltip}
        {legend}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} stackId={stacked ? 'a' : undefined} fill={`var(--color-${s.key})`} stroke="var(--background)" strokeWidth={stacked ? 1 : 0} radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
            {series.length === 1 && data.length <= 14 && <LabelList dataKey={s.key} position="top" className="fill-foreground" fontSize={11} formatter={fmt} />}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  )
}
