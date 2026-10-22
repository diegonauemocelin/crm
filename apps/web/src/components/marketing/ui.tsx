import { toast } from 'sonner'
import { AlertTriangleIcon, ArrowDownIcon, Loader2Icon, ArrowDownRightIcon, ArrowUpDownIcon, ArrowUpIcon, ArrowUpRightIcon, DownloadIcon, FilterIcon, MinusIcon, PlugZapIcon, XIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { formatDateTime } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { type Analysis, type BreakdownRow, dayBr, downloadCsv, type FilterKey, money, num, pct, PRESETS, times, useMktFilters, useMktOptions } from '@/lib/marketing'
import { cn } from '@/lib/utils'

const ALL = '__todos'

/** Filtros globais: valem para todos os cards, gráficos e tabelas da tela (e ficam no endereço da página). */
export function MktFilters({ show = 'all' }: { show?: 'all' | 'period' }) {
  const f = useMktFilters()
  // Só período (ex.: Marketplaces): as opções dos filtros do CRM não são usadas.
  const opts = useMktOptions(show === 'all')
  const o = opts.data
  const [more, setMore] = useState(f.active.length > 0)
  const preset = PRESETS.find((p) => {
    const [a, b] = p.range()
    return a === f.from && b === f.to
  })?.id
  const select = (key: FilterKey, label: string, items: { id: string; name: string }[]) => (
    <Select value={f.filters[key] || ALL} onValueChange={(v) => f.set({ [key]: v === ALL ? null : v })}>
      <SelectTrigger size="sm" className="w-44" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: todos</SelectItem>
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={preset ?? ''} onValueChange={(v) => {
          const p = PRESETS.find((x) => x.id === v)
          if (p) {
            const [a, b] = p.range()
            f.set({ de: a, ate: b })
          }
        }} aria-label="Período">
          {PRESETS.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id} className="px-3">
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-1">
          <Input type="date" className="h-8 w-36" aria-label="De" value={f.from} max={f.to} onChange={(e) => e.target.value && f.set({ de: e.target.value })} />
          <span className="text-sm text-muted-foreground">até</span>
          <Input type="date" className="h-8 w-36" aria-label="Até" value={f.to} min={f.from} onChange={(e) => e.target.value && f.set({ ate: e.target.value })} />
        </div>
        {show === 'all' && (
          <>
            <Select value={f.visao || 'auto'} onValueChange={(v) => f.set({ visao: v === 'auto' ? null : v })}>
              <SelectTrigger size="sm" className="w-36" aria-label="Visão">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Visão automática</SelectItem>
                <SelectItem value="dia">Diária</SelectItem>
                <SelectItem value="semana">Semanal</SelectItem>
                <SelectItem value="mes">Mensal</SelectItem>
                <SelectItem value="trimestre">Trimestral</SelectItem>
                <SelectItem value="ano">Anual</SelectItem>
              </SelectContent>
            </Select>
            <Button variant={more ? 'secondary' : 'outline'} size="sm" onClick={() => setMore((m) => !m)}>
              <FilterIcon /> Filtros{f.active.length ? ` (${f.active.length})` : ''}
            </Button>
            {f.active.length > 0 && (
              <Button variant="ghost" size="sm" onClick={f.clear}>
                <XIcon /> Limpar filtros
              </Button>
            )}
          </>
        )}
      </div>
      {show === 'all' && more && o && (
        <div className="flex flex-wrap gap-2 rounded-md border bg-muted/30 p-2">
          {select('plataforma', 'Plataforma', o.platforms.map((p) => ({ id: p.key, name: p.label })))}
          {select('campanha', 'Campanha', [{ id: '-', name: 'Sem campanha identificada' }, ...o.campaigns])}
          {select('marca', 'Marca', o.brands)}
          {select('tipoPeca', 'Tipo de peça', o.partTypes)}
          {select('regiao', 'Região', o.regions.map((r) => ({ id: r, name: r })))}
          {select('estado', 'Estado', o.states.map((s) => ({ id: s, name: s })))}
          {select('filial', 'Filial', o.units)}
          {select('vendedor', 'Vendedor', o.sellers)}
          {select('origem', 'Origem', o.origins)}
          {select('tipoCliente', 'Tipo de cliente', o.customerTypes)}
          {select('status', 'Situação', [
            { id: 'NEGOCIACAO', name: 'Em negociação' },
            { id: 'SIM', name: 'Vendeu' },
            { id: 'NAO', name: 'Perdida' },
          ])}
          {select('cliente', 'Cliente', [
            { id: 'novo', name: 'Novo' },
            { id: 'recorrente', name: 'Recorrente' },
          ])}
        </div>
      )}
    </div>
  )
}

/** Data das fontes e o modelo de atribuição: todo painel mostra de onde vêm os números. */
export function UpdatedLine({ d }: { d: Analysis }) {
  return (
    <p className="text-xs text-muted-foreground">
      {dayBr(d.period.from)} a {dayBr(d.period.to)} (comparado com {dayBr(d.period.prevFrom)} a {dayBr(d.period.prevTo)}) · CRM consultado em {formatDateTime(d.updatedAt.crm)} · investimento do
      Google Ads {d.updatedAt.googleAdsCost ? `atualizado em ${formatDateTime(d.updatedAt.googleAdsCost)}` : 'ainda não recebido'} · atribuição: {d.rules.attribution.model === 'primeiro' ? 'primeiro toque' : 'último toque'}, janela de{' '}
      {d.rules.attribution.windowDays} dias
    </p>
  )
}

export function CrmOnlyNotice({ d }: { d: Analysis }) {
  if (!d.crmOnlyFilters.length) return null
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
      As plataformas não informam o investimento por marca, estado, vendedor ou outros dados do CRM: com estes filtros, os indicadores de custo (CPL, ROAS, CAC, ROI) ficam como “—”. Para ver custo, filtre só por plataforma ou campanha.
    </p>
  )
}

/** Variação contra o período anterior, verde quando melhora (custo que cai também é verde). */
export function DeltaTag({ value, lowerIsBetter }: { value: number | null | undefined; lowerIsBetter?: boolean }) {
  if (value === null || value === undefined) return <span className="text-xs text-muted-foreground">sem base de comparação</span>
  if (Math.abs(value) < 0.05)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <MinusIcon className="size-3" /> igual ao anterior
      </span>
    )
  const up = value > 0
  const good = lowerIsBetter ? !up : up
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', good ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-[#b42323] dark:text-[#e66767]')}>
      <Icon className="size-3.5" aria-hidden />
      {up ? '+' : ''}
      {value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% <span className="font-normal text-muted-foreground">vs. anterior</span>
    </span>
  )
}

/** Card de indicador: valor, variação, valor anterior e a tendência (mini gráfico do período). */
export function Kpi({ label, value, before, delta, lowerIsBetter, spark, hint, to }: { label: string; value: string; before?: string; delta?: number | null; lowerIsBetter?: boolean; spark?: number[]; hint?: ReactNode; to?: string }) {
  const content = (
    <Card className={cn('h-full gap-1 py-4', to && 'transition-colors hover:border-[color:var(--brand)]')}>
      <CardContent className="space-y-1 px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {spark && spark.length > 1 && <Spark data={spark} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-2">
          {delta !== undefined && <DeltaTag value={delta} lowerIsBetter={lowerIsBetter} />}
          {before !== undefined && <span className="text-xs text-muted-foreground">antes: {before}</span>}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
  return to ? (
    <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      {content}
    </Link>
  ) : (
    content
  )
}

function Spark({ data }: { data: number[] }) {
  const config: ChartConfig = { v: { label: 'Tendência', color: 'var(--chart-1)' } }
  return (
    <ChartContainer config={config} className="aspect-auto h-8 w-20" aria-hidden>
      <LineChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Line dataKey="v" stroke="var(--color-v)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  )
}

/** Evolução no tempo de uma ou duas medidas (linha ou barra). */
export function TrendChart({ title, description, data, series, kind = 'area', format = num }: {
  title: string
  description?: string
  data: Record<string, number | string | null>[]
  series: { key: string; label: string; color: string }[]
  kind?: 'area' | 'bar'
  format?: (v: number) => string
}) {
  const config: ChartConfig = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-60 w-full">
          {kind === 'bar' ? (
            <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v) => format(Number(v))} />
              <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => `${config[String(n)]?.label ?? n}: ${format(Number(v))}`} />} />
              {series.map((s) => (
                <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              ))}
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v) => format(Number(v))} />
              <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => `${config[String(n)]?.label ?? n}: ${format(Number(v))}`} />} />
              {series.map((s) => (
                <Area key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} fill={`var(--color-${s.key})`} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
              ))}
            </AreaChart>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export interface Column {
  key: keyof BreakdownRow
  label: string
  fmt: (v: number | null) => string
  cost?: boolean
}
export const COLS: Record<string, Column> = {
  mediaCost: { key: 'mediaCost', label: 'Investido', fmt: money, cost: true },
  clicks: { key: 'clicks', label: 'Cliques', fmt: num, cost: true },
  ctr: { key: 'ctr', label: 'CTR', fmt: pct, cost: true },
  cpc: { key: 'cpc', label: 'CPC', fmt: money, cost: true },
  leads: { key: 'leads', label: 'Leads', fmt: num },
  attendedRate: { key: 'attendedRate', label: 'Atendidos', fmt: pct },
  opportunities: { key: 'opportunities', label: 'Oportun.', fmt: num },
  qualified: { key: 'qualified', label: 'Qualif.', fmt: num },
  sales: { key: 'sales', label: 'Vendas', fmt: num },
  conversionRate: { key: 'conversionRate', label: 'Conversão', fmt: pct },
  revenue: { key: 'revenue', label: 'Faturamento', fmt: money },
  ticket: { key: 'ticket', label: 'Ticket', fmt: money },
  cpl: { key: 'cpl', label: 'CPL', fmt: money, cost: true },
  cpql: { key: 'cpql', label: 'Custo/qualif.', fmt: money, cost: true },
  roas: { key: 'roas', label: 'ROAS', fmt: times, cost: true },
  lostRate: { key: 'lostRate', label: 'Perdidas', fmt: pct },
}
export const COMMERCIAL_COLS = [COLS.leads, COLS.attendedRate, COLS.opportunities, COLS.qualified, COLS.sales, COLS.conversionRate, COLS.revenue, COLS.ticket, COLS.lostRate]
export const MEDIA_COLS = [COLS.mediaCost, COLS.clicks, COLS.cpc, COLS.leads, COLS.qualified, COLS.sales, COLS.conversionRate, COLS.revenue, COLS.cpl, COLS.cpql, COLS.roas]

/**
 * Tabela de recorte com ordenação, exportação (CSV) e drill-down: clicar na linha filtra a tela por ela.
 * Uma linha pode entrar em mais de um recorte (ex.: atendimento com duas marcas): a tabela avisa.
 */
export function BreakdownTable({ title, description, rows, columns, onPick, exportName, limit = 50, multi }: {
  title: string
  description?: string
  rows: BreakdownRow[]
  columns: Column[]
  onPick?: (row: BreakdownRow) => void
  exportName?: string
  limit?: number
  multi?: boolean
}) {
  const { can } = useAuth()
  const [sort, setSort] = useState<{ key: keyof BreakdownRow; desc: boolean } | null>(null)
  const [all, setAll] = useState(false)
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const x = (a[sort.key] as number | null) ?? -Infinity
        const y = (b[sort.key] as number | null) ?? -Infinity
        return sort.desc ? y - x : x - y
      })
    : rows
  const shown = all ? sorted : sorted.slice(0, limit)
  const canExport = can('mi_executivo', 'export') || can('mi_comercial', 'export') || can('mi_midia', 'export')
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          {(description || multi) && (
            <CardDescription>
              {description}
              {multi ? ' Um atendimento com mais de um item entra em cada um deles: a soma das linhas pode passar do total.' : ''}
            </CardDescription>
          )}
        </div>
        {exportName && canExport && rows.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => downloadCsv(exportName, [title, ...columns.map((c) => c.label)], sorted.map((r) => [r.name, ...columns.map((c) => r[c.key] as number | null)]))}>
            <DownloadIcon /> CSV
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">Sem dados no período.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{firstColumn(title)}</TableHead>
                {columns.map((c) => (
                  <TableHead key={String(c.key)} className="text-right">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true }))}>
                      {c.label}
                      {sort?.key === c.key ? sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" /> : <ArrowUpDownIcon className="size-3 opacity-40" />}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.key} className={cn(onPick && r.key !== '-' && 'cursor-pointer')} onClick={() => onPick && r.key !== '-' && onPick(r)}>
                  <TableCell className="max-w-72 truncate pl-6 font-medium" title={r.name}>
                    {r.name}
                  </TableCell>
                  {columns.map((c) => (
                    <TableCell key={String(c.key)} className="text-right tabular-nums">
                      {c.fmt(r[c.key] as number | null)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rows.length > limit && (
          <div className="px-6 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
              {all ? 'Mostrar menos' : `Mostrar todas (${rows.length})`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Baixa o relatório (PDF ou Excel) com o período e os filtros da tela. */
export async function downloadReport(query: string, format: 'pdf' | 'xlsx', sections: string[]) {
  await api.download(`/marketing/exportar?${query}&formato=${format}&secoes=${sections.join(',')}`, `relatorio.${format}`)
}

export function ExportButtons({ sections }: { sections: string[] }) {
  const f = useMktFilters()
  const { can } = useAuth()
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null)
  if (!can('mi_executivo', 'export') && !can('mi_relatorios')) return null
  const go = async (format: 'pdf' | 'xlsx') => {
    setBusy(format)
    try {
      await downloadReport(f.query, format, sections)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => go('pdf')} disabled={!!busy}>
        {busy === 'pdf' ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} PDF
      </Button>
      <Button size="sm" variant="outline" onClick={() => go('xlsx')} disabled={!!busy}>
        {busy === 'xlsx' ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Excel
      </Button>
    </div>
  )
}

/** Nome da 1ª coluna a partir do título: "Receita por campanha" → "Campanha". */
const firstColumn = (title: string) => {
  const m = /\bpor ([^()]+?)\s*(?:\(|$)/i.exec(title)
  const t = (m?.[1] ?? title).trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Funil em barras: volume de cada etapa, passagem da etapa anterior e onde mais se perde. */
export function FunnelView({ d }: { d: Analysis }) {
  const steps = d.funnel.steps.filter((s) => !s.media || s.value > 0)
  const max = Math.max(1, ...steps.filter((s) => !s.media).map((s) => s.value))
  const worst = steps.slice(1).reduce<{ label: string; rate: number } | null>((w, s) => (s.rate !== null && (!w || s.rate < w.rate) ? { label: s.label, rate: s.rate } : w), null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Funil de marketing e vendas</CardTitle>
        <CardDescription>Cada etapa conta leads únicos. Impressões e cliques vêm das plataformas; o resto, do Pré-Vendas. Conversões das plataformas não são somadas às vendas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((s) => (
          <div key={s.key} className="grid grid-cols-[minmax(0,14rem)_1fr_5rem] items-center gap-3 text-sm">
            <span className="truncate" title={s.label}>
              {s.label}
            </span>
            <div className="h-6 rounded bg-muted">
              <div className={cn('flex h-6 items-center rounded px-2 text-xs font-medium text-[color:var(--brand-foreground)]', s.media ? 'bg-[color:var(--chart-2)]' : 'bg-[color:var(--brand)]')} style={{ width: s.media ? '100%' : `${Math.max(4, (s.value / max) * 100)}%` }}>
                {num(s.value)}
              </div>
            </div>
            <span className="text-right text-xs text-muted-foreground tabular-nums">{s.rate === null ? '' : pct(s.rate)}</span>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,14rem)_1fr_5rem] items-center gap-3 border-t pt-2 text-sm font-medium">
          <span>Faturamento</span>
          <span>{money(d.funnel.revenue)}</span>
          <span />
        </div>
        {worst && <p className="text-xs text-muted-foreground">Maior perda: passagem para “{worst.label}” ({pct(worst.rate)}).</p>}
      </CardContent>
    </Card>
  )
}

/** Integração pronta, ainda sem conta conectada: diz o que vai aparecer e onde configurar. */
export function PendingIntegration({ title, what, steps, configured }: { title: string; what: string[]; steps: ReactNode; configured?: boolean }) {
  const { can } = useAuth()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZapIcon className="size-4" /> {title}
          <Badge variant={configured ? 'default' : 'secondary'}>{configured ? 'Configurado' : 'Aguardando conexão'}</Badge>
        </CardTitle>
        <CardDescription>Nenhum número é inventado: enquanto a conta não estiver conectada, as métricas da plataforma aparecem como “Não disponível”.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="font-medium">O que vai aparecer aqui</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {what.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
        <div className="text-muted-foreground">{steps}</div>
        {can('mi_config', 'edit') && (
          <Button asChild size="sm" variant="outline">
            <Link to="/configuracoes?secao=marketing-inteligente">Configurar em Configurações › Marketing Inteligente</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

