import { ArrowDownRightIcon, ArrowUpDownIcon, ArrowUpRightIcon, DownloadIcon, InfoIcon, MinusIcon } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Can, formatDateTime } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pctFmt } from '@/lib/atendimento'
import { type Attention, bucketLabel, cell, downloadCsv, fmt, isoToBr, type Kpi, type Meta, type Source, type Unit } from '@/lib/marketing'
import { cn } from '@/lib/utils'

export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions}
      </CardHeader>
      <CardContent className="px-0 sm:px-6">{children}</CardContent>
    </Card>
  )
}

/** Variação contra o período anterior: seta + texto (nunca só cor). Investimento é neutro: subir não é bom nem ruim. */
export function Variation({ k }: { k: Pick<Kpi, 'value' | 'previous' | 'variation' | 'better'> }) {
  if (k.value === null || k.previous === null) return <span className="text-xs text-muted-foreground">sem base de comparação</span>
  if (k.variation === null) return <span className="text-xs text-muted-foreground">período anterior zerado</span>
  if (Math.abs(k.variation) < 0.0005) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <MinusIcon className="size-3" /> igual ao anterior
      </span>
    )
  }
  const up = k.variation > 0
  const good = k.better === 'neutro' ? null : k.better === 'up' ? up : !up
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', good === null ? 'text-foreground' : good ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-[#b42323] dark:text-[#e66767]')}>
      <Icon className="size-3.5" aria-hidden />
      {up ? '+' : ''}
      {pctFmt.format(k.variation)} <span className="font-normal text-muted-foreground">vs. anterior</span>
    </span>
  )
}

const TREND: Record<string, string> = { alta: 'tendência de alta', queda: 'tendência de queda', estavel: 'estável no período' }

function Sparkline({ series }: { series: (number | null)[] }) {
  const data = series.map((v, i) => ({ i, v }))
  if (series.filter((v) => v !== null).length < 2) return null
  return (
    <ChartContainer config={{ v: { label: 'Valor', color: 'var(--chart-1)' } }} className="aspect-auto h-8 w-full">
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Line dataKey="v" type="monotone" stroke="var(--color-v)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  )
}

/** Indicador: valor, anterior, variação, tendência e histórico. Indisponível mostra o porquê, nunca zero. */
export function KpiCard({ k, onClick, active }: { k: Kpi; onClick?: () => void; active?: boolean }) {
  const na = k.value === null
  return (
    <Card className={cn('gap-1 py-3', onClick && 'cursor-pointer transition-colors hover:border-primary/50', active && 'border-primary ring-1 ring-primary/30')} onClick={onClick}>
      <CardContent className="space-y-1 px-4">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm text-muted-foreground">{k.label}</p>
          {(k.formula || k.reason) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Como é calculado: ${k.label}`} onClick={(e) => e.stopPropagation()}>
                  <InfoIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">{[k.formula, k.reason].filter(Boolean).join(' ')}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className={cn('font-semibold tracking-tight', na ? 'text-base text-muted-foreground' : 'text-2xl')}>{fmt(k.value, k.unit)}</p>
        {na ? (
          <p className="text-xs text-muted-foreground">{k.reason ?? 'Sem base para o cálculo.'}</p>
        ) : (
          <>
            <Variation k={k} />
            <p className="text-xs text-muted-foreground">
              Anterior: {fmt(k.previous, k.unit)}
              {k.trend ? ` · ${TREND[k.trend]}` : ''}
            </p>
            <Sparkline series={k.series} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Gráfico de linha da evolução de um indicador (uma série por gráfico). */
export function TrendChart({ title, description, buckets, series, unit, granularity, kind = 'line' }: { title: string; description?: string; buckets: string[]; series: (number | null)[]; unit: Unit; granularity: string; kind?: 'line' | 'bar' }) {
  const data = buckets.map((b, i) => ({ b, v: series[i] ?? null }))
  const config: ChartConfig = { v: { label: title, color: 'var(--chart-1)' } }
  const tick = (v: number) => (unit === 'brl' ? `R$ ${Math.round(v).toLocaleString('pt-BR', { notation: 'compact' } as Intl.NumberFormatOptions)}` : unit === 'pct' ? pctFmt.format(v) : unit === 'x' ? `${v}x` : v.toLocaleString('pt-BR'))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {series.every((v) => v === null) ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Não disponível no período.</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-56 w-full">
            {kind === 'bar' ? (
              <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="b" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={(b) => bucketLabel(String(b), granularity)} />
                <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v) => tick(Number(v))} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(b) => bucketLabel(String(b), granularity)} formatter={(v) => fmt(Number(v), unit)} />} />
                <Bar dataKey="v" fill="var(--color-v)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            ) : (
              <LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="b" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={(b) => bucketLabel(String(b), granularity)} />
                <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v) => tick(Number(v))} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(b) => bucketLabel(String(b), granularity)} formatter={(v) => fmt(Number(v), unit)} />} />
                <Line dataKey="v" type="monotone" stroke="var(--color-v)" strokeWidth={2} dot={data.length <= 31} connectNulls isAnimationActive={false} />
              </LineChart>
            )}
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

/** Fontes, critérios e data da atualização: aparece no fim de toda tela do módulo. */
export function DataNotes({ meta }: { meta: Meta }) {
  return (
    <div className="space-y-1 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">Período:</span> {isoToBr(meta.period.from)} a {isoToBr(meta.period.to)} ({meta.period.days} dias) · comparado com {isoToBr(meta.previousPeriod.from)} a {isoToBr(meta.previousPeriod.to)}
      </p>
      <p>
        <span className="font-medium text-foreground">Atualização:</span> calculado em {formatDateTime(meta.updatedAt.generatedAt)} a partir do CRM (atendimentos, leads, loja e e-mail)
        {meta.updatedAt.googleAdsCost ? `; investimento do Google Ads recebido em ${formatDateTime(meta.updatedAt.googleAdsCost)}` : '; investimento do Google Ads ainda não recebido'}.
      </p>
      <p>
        <span className="font-medium text-foreground">Atribuição:</span> {meta.attribution.modelLabel}, janela de {meta.attribution.windowDays} dias. <span className="font-medium text-foreground">Lead qualificado:</span> {meta.attribution.qualifiedRule}.
      </p>
      <ul className="list-disc space-y-0.5 pl-4">
        {meta.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  )
}

export interface Column<T> {
  key: string
  label: string
  unit?: Unit
  value: (r: T) => number | string | null
  render?: (r: T) => ReactNode
  className?: string
  /** Texto da coluna no CSV quando difere da tela. */
  csv?: (r: T) => string | number | null
}

/** Tabela com ordenação por coluna, paginação e exportação CSV (para quem pode exportar). */
export function DataTable<T>({ rows, columns, rowKey, exportName, exportModule = 'mkt_paineis', pageSize = 25, initialSort, empty = 'Sem dados no período.' }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; exportName?: string; exportModule?: string; pageSize?: number; initialSort?: string; empty?: string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ? { key: initialSort, dir: -1 } : null)
  const [page, setPage] = useState(0)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    return [...rows].sort((a, b) => {
      const x = col.value(a)
      const y = col.value(b)
      if (x === y) return 0
      if (x === null) return 1
      if (y === null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR')) * sort.dir
    })
  }, [rows, columns, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize)
  return (
    <div className="space-y-2">
      {exportName && (
        <Can module={exportModule} action="export">
          <div className="flex justify-end px-4 sm:px-0">
            <Button
              variant="outline"
              size="sm"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  exportName,
                  columns.map((c) => c.label),
                  sorted.map((r) => columns.map((c) => (c.csv ? c.csv(r) : c.value(r)))),
                )
              }
            >
              <DownloadIcon /> Exportar CSV
            </Button>
          </div>
        </Can>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead key={c.key} className={cn(i > 0 && c.unit && 'text-right', c.className)} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                <button
                  type="button"
                  className={cn('inline-flex items-center gap-1 hover:text-foreground', i > 0 && c.unit && 'flex-row-reverse')}
                  onClick={() => {
                    setPage(0)
                    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.unit ? -1 : 1 }))
                  }}
                >
                  {c.label}
                  <ArrowUpDownIcon className={cn('size-3', sort?.key === c.key ? 'opacity-100' : 'opacity-30')} aria-hidden />
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
          {visible.map((r) => (
            <TableRow key={rowKey(r)}>
              {columns.map((c, i) => (
                <TableCell key={c.key} className={cn(i > 0 && c.unit && 'text-right whitespace-nowrap tabular-nums', c.className)}>
                  {c.render ? c.render(r) : c.unit ? cell(c.value(r) as number | null, c.unit) : (c.value(r) ?? '—')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-4 text-sm sm:px-0">
          <span className="text-muted-foreground">
            Página {current + 1} de {pages} · {sorted.length} linhas
          </span>
          <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  )
}

const SOURCE_STATUS: Record<Source['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  ok: { label: 'Conectado', variant: 'default' },
  atrasado: { label: 'Atrasado', variant: 'destructive' },
  atencao: { label: 'Atenção', variant: 'destructive' },
  nunca: { label: 'Sem dados ainda', variant: 'secondary' },
  sem_dados: { label: 'Sem dados ainda', variant: 'secondary' },
  desligado: { label: 'Desligado', variant: 'outline' },
  pendente: { label: 'A integrar', variant: 'outline' },
}

export function SourceBadge({ status }: { status: Source['status'] }) {
  const s = SOURCE_STATUS[status]
  return <Badge variant={s.variant}>{s.label}</Badge>
}

const LEVEL: Record<Attention['level'], { label: string; className: string }> = {
  alta: { label: 'Prioridade alta', className: 'border-l-[#b42323] dark:border-l-[#e66767]' },
  media: { label: 'Prioridade média', className: 'border-l-amber-500' },
  info: { label: 'Informação', className: 'border-l-muted-foreground/40' },
}

/** Pontos de atenção: sempre com os números que sustentam e a ação sugerida. São sinais para investigar, não prova de causa. */
export function AttentionList({ items }: { items: Attention[] }) {
  if (!items.length) return <p className="px-4 py-6 text-sm text-muted-foreground sm:px-0">Nada fora do esperado no período, pelas regras atuais.</p>
  return (
    <ul className="space-y-2 px-4 sm:px-0">
      {items.map((a) => (
        <li key={a.title + a.evidence} className={cn('rounded-md border border-l-4 p-3', LEVEL[a.level].className)}>
          <p className="text-sm font-medium">
            {a.title} <span className="text-xs font-normal text-muted-foreground">· {LEVEL[a.level].label}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{a.evidence}</p>
          <p className="mt-1 text-sm">
            <span className="font-medium">Sugestão:</span> {a.action}
          </p>
        </li>
      ))}
    </ul>
  )
}
