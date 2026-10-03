import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon, MinusIcon } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ErrorState, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { brl, brlCompact, int, type Kind, KIND_INFO, namesOf, pctFmt, todaySP, UF_NAMES, useOptions } from '@/lib/atendimento'
import { cn } from '@/lib/utils'

interface Kpis {
  total: number
  forwarded: number
  forwardRate: number | null
  returned: number
  returnRate: number | null
  avgReturnHours: number | null
  sales: number
  conversion: number | null
  revenue: number
  ticket: number | null
  lost: number
  negotiating: number
  overdue: number
}
interface Group {
  id: string
  leads: number
  sales: number
  revenue: number
}
interface Dashboard {
  period: { from: string; to: string; days: number }
  previousPeriod: { from: string; to: string }
  granularity: 'dia' | 'semana' | 'mes'
  byUnit: { id: string; leads: number; sales: number; revenue: number; conversion: number | null }[]
  kpis: Kpis
  previousKpis: Kpis
  timeline: { bucket: string; leads: number; sales: number; revenue: number }[]
  byOrigin: Group[]
  byCustomerType: Group[]
  byState: Group[]
  byRegion: Group[]
  byBrand: Group[]
  byPartType: Group[]
  lostReasons: { id: string; count: number; cumulative: number }[]
  sellers: { id: string; leads: number; forwarded: number; returned: number; returnRate: number | null; avgReturnHours: number | null; sales: number; revenue: number; conversion: number | null }[]
}

const PRESETS = [
  { id: '30', label: '30 dias', range: () => [todaySP(-29), todaySP()] },
  { id: '90', label: '90 dias', range: () => [todaySP(-89), todaySP()] },
  { id: 'mes', label: 'Este mês', range: () => [`${todaySP().slice(0, 8)}01`, todaySP()] },
  { id: 'ano', label: 'Este ano', range: () => [`${todaySP().slice(0, 4)}-01-01`, todaySP()] },
  { id: '12m', label: '12 meses', range: () => [todaySP(-364), todaySP()] },
] as const

const ALL = '__all__'

const fmtDate = (iso: string) => iso.split('-').reverse().join('/')

function hours(h: number | null) {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
  return `${(h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
}

/** Variação contra o período anterior, com seta + texto (nunca só cor). `lowerIsBetter` inverte o sentido de "bom". */
function Delta({ now, before, lowerIsBetter, asPoints }: { now: number | null; before: number | null; lowerIsBetter?: boolean; asPoints?: boolean }) {
  if (now === null || before === null) return <span className="text-xs text-muted-foreground">sem base de comparação</span>
  if (!asPoints && before === 0) return <span className="text-xs text-muted-foreground">período anterior zerado</span>
  const diff = asPoints ? (now - before) * 100 : (now - before) / before
  if (Math.abs(diff) < (asPoints ? 0.05 : 0.0005)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <MinusIcon className="size-3" /> igual ao período anterior
      </span>
    )
  }
  const up = diff > 0
  const good = lowerIsBetter ? !up : up
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon
  const text = asPoints ? `${up ? '+' : ''}${diff.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.` : `${up ? '+' : ''}${pctFmt.format(diff)}`
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', good ? 'text-[#006300] dark:text-[#0ca30c]' : 'text-[#b42323] dark:text-[#e66767]')}>
      <Icon className="size-3.5" aria-hidden />
      {text} <span className="font-normal text-muted-foreground">vs. anterior</span>
    </span>
  )
}

function Stat({ label, value, delta, hint }: { label: string; value: string; delta: ReactNode; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <div>{delta}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/** Barras horizontais de uma série: título nomeia a série, valores escritos na ponta da barra. */
function HBar({ title, description, data, valueLabel = 'Atendimentos', format = (v: number) => int.format(v), extra }: {
  title: string
  description?: string
  data: { name: string; value: number; extra?: string }[]
  valueLabel?: string
  format?: (v: number) => string
  extra?: string
}) {
  const config: ChartConfig = { value: { label: valueLabel, color: 'var(--chart-1)' } }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(120, data.length * 34 + 16) }}>
            <BarChart data={data} layout="vertical" margin={{ left: 0, right: extra ? 190 : 48, top: 0, bottom: 0 }} barCategoryGap={6}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
              <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<ChartTooltipContent hideIndicator formatter={(v, _n, item) => <span className="tabular-nums">{format(Number(v))}{item.payload.extra ? ` · ${item.payload.extra}` : ''}</span>} />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
                <LabelList
                  dataKey="value"
                  position="right"
                  className="fill-foreground"
                  fontSize={12}
                  formatter={(v: unknown) => format(Number(v))}
                />
                {extra && <LabelList dataKey="extra" position="right" offset={56} className="fill-muted-foreground" fontSize={11} />}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

/** Mapa do Brasil em grade (cada quadrado é um estado), em escala sequencial de um só tom. */
const UF_GRID: Record<string, [number, number]> = {
  RR: [2, 0], AP: [4, 0],
  AM: [1, 1], PA: [3, 1], MA: [4, 1], CE: [5, 1], RN: [6, 1],
  AC: [0, 2], RO: [1, 2], MT: [2, 2], TO: [3, 2], PI: [4, 2], PE: [5, 2], PB: [6, 2],
  MS: [2, 3], GO: [3, 3], DF: [4, 3], BA: [5, 3], AL: [6, 3],
  SP: [3, 4], MG: [4, 4], ES: [5, 4], SE: [6, 4],
  PR: [3, 5], RJ: [4, 5],
  SC: [3, 6],
  RS: [3, 7],
}

function StateMap({ data }: { data: Group[] }) {
  const byUf = new Map(data.map((d) => [d.id, d]))
  const max = Math.max(1, ...data.filter((d) => d.id in UF_GRID).map((d) => d.leads))
  const abroad = byUf.get('EX')?.leads ?? 0
  const unknown = byUf.get('none')?.leads ?? 0
  const steps = [1, 2, 3, 4, 5, 6, 7]
  return (
    <div>
      <div className="mx-auto grid max-w-sm grid-cols-7 gap-1" role="img" aria-label="Atendimentos por estado">
        {Array.from({ length: 8 * 7 }, (_, i) => {
          const col = i % 7
          const row = Math.floor(i / 7)
          const uf = Object.entries(UF_GRID).find(([, [c, r]]) => c === col && r === row)?.[0]
          if (!uf) return <div key={i} />
          const leads = byUf.get(uf)?.leads ?? 0
          const step = leads ? Math.max(1, Math.ceil((leads / max) * 7)) : 0
          return (
            <div
              key={i}
              title={`${UF_NAMES[uf]}: ${int.format(leads)} atendimento(s), ${int.format(byUf.get(uf)?.sales ?? 0)} venda(s)`}
              className="flex aspect-square flex-col items-center justify-center rounded-md text-[11px] leading-tight"
              style={{
                background: step ? `var(--seq-${step})` : 'var(--muted)',
                color: step === 0 ? 'var(--muted-foreground)' : step <= 3 ? 'var(--seq-ink-light)' : step === 4 ? '#ffffff' : 'var(--seq-ink-dark)',
              }}
            >
              <span className="font-semibold">{uf}</span>
              <span className="tabular-nums">{leads ? int.format(leads) : ''}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <span>menos</span>
        {steps.map((s) => (
          <span key={s} className="h-2.5 w-5 rounded-sm" style={{ background: `var(--seq-${s})` }} />
        ))}
        <span>mais</span>
      </div>
      {(abroad > 0 || unknown > 0) && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {abroad > 0 && `Exterior: ${int.format(abroad)}`}
          {abroad > 0 && unknown > 0 && ' · '}
          {unknown > 0 && `Sem estado: ${int.format(unknown)}`}
        </p>
      )}
    </div>
  )
}

export function AtendimentoDashboard({ kind }: { kind: Kind }) {
  const options = useOptions()
  const names = useMemo(() => namesOf(options.data), [options.data])
  const [preset, setPreset] = useState<string>('90')
  const [range, setRange] = useState<[string, string]>(() => PRESETS[1].range() as [string, string])
  const [unitId, setUnitId] = useState<string | null>(null)
  const [sellerId, setSellerId] = useState<string | null>(null)
  const [originId, setOriginId] = useState<string | null>(null)

  const query = new URLSearchParams({ kind, from: range[0], to: range[1] })
  if (unitId) query.set('unitId', unitId)
  if (sellerId) query.set('sellerId', sellerId)
  if (originId) query.set('originId', originId)

  const q = useQuery({
    queryKey: ['atendimento-dashboard', query.toString()],
    queryFn: () => api.get<Dashboard>(`/atendimentos/dashboard?${query}`),
    placeholderData: keepPreviousData,
  })

  const name = (id: string, fallback = 'Não informado') => (id === 'none' ? fallback : (names.get(id) ?? id))
  const d = q.data
  const k = d?.kpis
  const p = d?.previousKpis

  const timelineConfig: ChartConfig = {
    leads: { label: 'Atendimentos', color: 'var(--chart-1)' },
    sales: { label: 'Vendas', color: 'var(--chart-2)' },
  }
  const bucketLabel = (b: string) => (d?.granularity === 'mes' ? `${b.slice(5, 7)}/${b.slice(2, 4)}` : `${b.slice(8, 10)}/${b.slice(5, 7)}`)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={preset}
          onValueChange={(v) => {
            if (!v) return
            setPreset(v)
            const pr = PRESETS.find((x) => x.id === v)
            if (pr) setRange(pr.range() as [string, string])
          }}
          aria-label="Período"
        >
          {PRESETS.map((pr) => (
            <ToggleGroupItem key={pr.id} value={pr.id} className="px-3">
              {pr.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-1">
          <Input type="date" className="h-8 w-36" aria-label="De" value={range[0]} max={range[1]} onChange={(e) => e.target.value && (setPreset(''), setRange([e.target.value, range[1]]))} />
          <span className="text-sm text-muted-foreground">até</span>
          <Input type="date" className="h-8 w-36" aria-label="Até" value={range[1]} min={range[0]} onChange={(e) => e.target.value && (setPreset(''), setRange([range[0], e.target.value]))} />
        </div>
        <Select value={unitId ?? ALL} onValueChange={(v) => setUnitId(v === ALL ? null : v)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Unidade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as unidades</SelectItem>
            {options.data?.units.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sellerId ?? ALL} onValueChange={(v) => setSellerId(v === ALL ? null : v)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Vendedor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os vendedores</SelectItem>
            {options.data?.sellers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={originId ?? ALL} onValueChange={(v) => setOriginId(v === ALL ? null : v)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Origem">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as origens</SelectItem>
            {options.data?.origins.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {d && (
          <span className="text-xs text-muted-foreground">
            Comparando com {fmtDate(d.previousPeriod.from)} a {fmtDate(d.previousPeriod.to)}
          </span>
        )}
      </div>

      {q.isLoading && <TableSkeleton rows={6} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {d && k && p && (
        <>
          {k.overdue > 0 && (
            <Link
              to={`${KIND_INFO[kind].path}?overdue=true`}
              className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm hover:bg-amber-500/15"
            >
              <AlertTriangleIcon className="size-4 text-amber-600" />
              <span>
                <strong>{int.format(k.overdue)}</strong> atendimento(s) repassado(s) sem retorno do vendedor além do prazo.
              </span>
              <ArrowRightIcon className="ml-auto size-4" />
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Atendimentos" value={int.format(k.total)} delta={<Delta now={k.total} before={p.total} />} />
            <Stat label="Repassados ao vendedor" value={k.forwardRate === null ? '—' : pctFmt.format(k.forwardRate)} delta={<Delta now={k.forwardRate} before={p.forwardRate} asPoints />} hint={`${int.format(k.forwarded)} repassado(s)`} />
            <Stat label="Retorno do vendedor" value={k.returnRate === null ? '—' : pctFmt.format(k.returnRate)} delta={<Delta now={k.returnRate} before={p.returnRate} asPoints />} hint={`Tempo médio: ${hours(k.avgReturnHours)}`} />
            <Stat label="Conversão em venda" value={k.conversion === null ? '—' : pctFmt.format(k.conversion)} delta={<Delta now={k.conversion} before={p.conversion} asPoints />} hint={`${int.format(k.sales)} venda(s) · ${int.format(k.negotiating)} em negociação`} />
            <Stat label="Valor vendido" value={brl.format(k.revenue)} delta={<Delta now={k.revenue} before={p.revenue} />} />
            <Stat label="Ticket médio" value={k.ticket === null ? '—' : brl.format(k.ticket)} delta={<Delta now={k.ticket} before={p.ticket} />} />
            <Stat label="Vendas perdidas" value={int.format(k.lost)} delta={<Delta now={k.lost} before={p.lost} lowerIsBetter />} />
            <Stat label="Tempo médio de retorno" value={hours(k.avgReturnHours)} delta={<Delta now={k.avgReturnHours} before={p.avgReturnHours} lowerIsBetter />} hint="Repasse até o retorno, nos registros feitos pelo sistema" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução no período</CardTitle>
              <CardDescription>Atendimentos e vendas por {d.granularity === 'dia' ? 'dia' : d.granularity === 'semana' ? 'semana' : 'mês'}</CardDescription>
            </CardHeader>
            <CardContent>
              {d.timeline.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
              ) : (
                <ChartContainer config={timelineConfig} className="aspect-auto h-64 w-full">
                  <LineChart data={d.timeline} margin={{ left: 0, right: 16, top: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={bucketLabel} />
                    <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => (d.granularity === 'semana' ? `Semana de ${fmtDate(String(v))}` : d.granularity === 'mes' ? bucketLabel(String(v)) : fmtDate(String(v)))} />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line dataKey="leads" type="monotone" stroke="var(--color-leads)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                    <Line dataKey="sales" type="monotone" stroke="var(--color-sales)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <HBar
              title="Por unidade"
              description="Atendimentos; ao lado, vendas e valor vendido"
              data={d.byUnit.map((u) => ({ name: name(u.id, 'Sem unidade'), value: u.leads, extra: `${int.format(u.sales)} vendas · ${brlCompact.format(u.revenue)}` }))}
              extra="vendas"
            />
            <HBar title="Por origem" data={d.byOrigin.map((g) => ({ name: name(g.id), value: g.leads }))} />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por estado</CardTitle>
                <CardDescription>Passe o mouse sobre o estado para ver as vendas</CardDescription>
              </CardHeader>
              <CardContent>
                <StateMap data={d.byState} />
              </CardContent>
            </Card>
            <HBar title="Por tipo de cliente" data={d.byCustomerType.map((g) => ({ name: name(g.id), value: g.leads }))} />
            <HBar title="Por região" data={d.byRegion.map((g) => ({ name: name(g.id, 'Sem estado'), value: g.leads }))} />
            <HBar title="Marca da máquina (10 mais)" data={d.byBrand.slice(0, 10).map((g) => ({ name: name(g.id), value: g.leads }))} />
            <HBar title="Tipo de peça" data={d.byPartType.map((g) => ({ name: name(g.id), value: g.leads }))} />
          </div>

          <HBar
            title="Motivos de perda (Pareto)"
            description="Do mais para o menos frequente; ao lado, o percentual acumulado das vendas perdidas"
            data={d.lostReasons.map((l) => ({ name: name(l.id), value: l.count, extra: `${pctFmt.format(l.cumulative)} acum.` }))}
            valueLabel="Vendas perdidas"
            extra="acumulado"
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ranking de vendedores</CardTitle>
              <CardDescription>Ordenado pelo valor vendido no período</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8 pl-6">#</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead className="text-right">Atendimentos</TableHead>
                      <TableHead className="text-right">Repassados</TableHead>
                      <TableHead className="text-right">Retorno</TableHead>
                      <TableHead className="text-right">Tempo médio</TableHead>
                      <TableHead className="text-right">Vendas</TableHead>
                      <TableHead className="text-right">Conversão</TableHead>
                      <TableHead className="pr-6 text-right">Valor vendido</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.sellers.map((s, i) => (
                      <TableRow key={s.id}>
                        <TableCell className="pl-6 text-muted-foreground tabular-nums">{i + 1}</TableCell>
                        <TableCell className="font-medium">{name(s.id, 'Sem vendedor')}</TableCell>
                        <TableCell className="text-right tabular-nums">{int.format(s.leads)}</TableCell>
                        <TableCell className="text-right tabular-nums">{int.format(s.forwarded)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.returnRate === null ? '—' : pctFmt.format(s.returnRate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{hours(s.avgReturnHours)}</TableCell>
                        <TableCell className="text-right tabular-nums">{int.format(s.sales)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.conversion === null ? '—' : pctFmt.format(s.conversion)}</TableCell>
                        <TableCell className="pr-6 text-right tabular-nums">{s.revenue ? brlCompact.format(s.revenue) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Período: {fmtDate(d.period.from)} a {fmtDate(d.period.to)} ({int.format(d.period.days)} dias).{' '}
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
              <Link to={`${KIND_INFO[kind].path}?from=${d.period.from}&to=${d.period.to}`}>Ver os atendimentos deste período</Link>
            </Button>
          </p>
        </>
      )}
    </div>
  )
}
